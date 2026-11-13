const API_BASE = '/api';
let searchTimeout;
let cachedTree = null;
let cachedFiles = {}; // Cache files per folder for faster navigation
let activeSearchIndex = -1;
let isMobile = window.innerWidth < 768;
let currentFolderId = null; // Track current folder for refresh
let currentFolderName = null; // Track current folder name
// Files are always sorted alphabetically + numerically (natural sort)
let folderPollTimer = null; // Auto-poll timer for folders
let filePollTimer = null; // Auto-poll timer for files
let pdfLoadFallbackTimer = null; // Fallback timer when inline PDF stream is slow/unavailable
let fileRenderToken = 0; // Cancels stale chunked file renders
const FOLDER_POLL_INTERVAL = 60000; // Poll folders every 60 seconds
const FILE_POLL_INTERVAL = 30000; // Poll files every 30 seconds

// Update isMobile on resize (debounced)
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        const wasMobile = isMobile;
        isMobile = window.innerWidth < 768;
        if (wasMobile && !isMobile) {
            elements.logoContainer.classList.remove('hidden');
            elements.rightNav.classList.remove('hidden');
            elements.mobileSearchTrigger.classList.remove('hidden');
            elements.searchBarContainer.classList.remove('block');
            elements.closeSearchBtn.classList.add('hidden');
        }
    }, 150);
}, { passive: true });

// Helper function to escape HTML and prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Natural sort function for proper alphabetical + numerical ordering
// Handles: "Module 1", "Module 2", "Module 10" correctly
const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/**
 * Compares two objects by their name property using natural alphanumeric ordering.
 * Correctly sorts numbered sequences such as "Module 1", "Module 2", "Module 10".
 *
 * @param {{ name: string }} a - First item with a name property.
 * @param {{ name: string }} b - Second item with a name property.
 * @returns {number} Negative if a < b, positive if a > b, 0 if equal.
 */
function naturalSort(a, b) {
    return naturalCollator.compare(a.name, b.name);
}

const elements = {
    menuBtn: document.getElementById('menuBtn'),
    sidebarCloseBtn: document.getElementById('sidebarCloseBtn'),
    sidebar: document.getElementById('sidebar'),
    sidebarOverlay: document.getElementById('sidebarOverlay'),
    foldersList: document.getElementById('foldersList'),
    welcomeState: document.getElementById('welcomeState'),
    contentHeader: document.getElementById('contentHeader'),
    contentTitle: document.getElementById('contentTitle'),
    filesGrid: document.getElementById('filesGrid'),
    emptyState: document.getElementById('emptyState'),
    themeToggle: document.getElementById('themeToggle'),
    sunIcon: document.getElementById('sunIcon'),
    moonIcon: document.getElementById('moonIcon'),
    pdfModal: document.getElementById('pdfModal'),
    pdfTitle: document.getElementById('pdfTitle'),
    pdfLoading: document.getElementById('pdfLoading'),
    pdfIframe: document.getElementById('pdfIframe'),
    closePdfBtn: document.getElementById('closePdfBtn'),
    pdfDownload: document.getElementById('pdfDownload'),
    logoContainer: document.getElementById('logoContainer'),
    mobileSearchTrigger: document.getElementById('mobileSearchTrigger'),
    searchBarContainer: document.getElementById('searchBarContainer'),
    closeSearchBtn: document.getElementById('closeSearchBtn'),
    rightNav: document.getElementById('rightNav'),
    searchInput: document.getElementById('searchInput'),
    searchResults: document.getElementById('searchResults'),
    browseSubjectsBtn: document.getElementById('browseSubjectsBtn'),
    themeColorMeta: document.querySelector('meta[name="theme-color"]'),
    lcpImagePreload: document.getElementById('lcpImagePreload'),
    // sortContainer and sortSelect removed — files sorted alphabetically always
    backToHomeBtn: document.getElementById('backToHomeBtn'),
    navHomeBtn: document.getElementById('navHomeBtn'),
    openFeedbackBtn: document.getElementById('openFeedbackBtn'),
    feedbackModal: document.getElementById('feedbackModal'),
    feedbackBackdrop: document.getElementById('feedbackBackdrop'),
    closeFeedbackBtn: document.getElementById('closeFeedbackBtn'),
    feedbackForm: document.getElementById('feedbackForm'),
    feedbackName: document.getElementById('feedbackName'),
    feedbackEmail: document.getElementById('feedbackEmail'),
    feedbackCategoryBtn: document.getElementById('feedbackCategoryBtn'),
    feedbackCategorySelected: document.getElementById('feedbackCategorySelected'),
    feedbackCategoryChevron: document.getElementById('feedbackCategoryChevron'),
    feedbackCategoryMenu: document.getElementById('feedbackCategoryMenu'),
    feedbackCategory: document.getElementById('feedbackCategory'),
    feedbackMessage: document.getElementById('feedbackMessage'),
    feedbackAlert: document.getElementById('feedbackAlert'),
    feedbackSubmitBtn: document.getElementById('feedbackSubmitBtn'),
    feedbackSubmitIcon: document.getElementById('feedbackSubmitIcon'),
    feedbackSubmitText: document.getElementById('feedbackSubmitText')
};

// --- INTERMEDIATE & CLIENT-SIDE CACHING ENGINE ---
const TREE_STORAGE_KEY = 'educrate_tree_cache_v2';
const TREE_STORAGE_TTL = 10 * 60 * 1000; // 10 minutes
const FOLDER_STORAGE_PREFIX = 'educrate_folder_cache_v2_';
const FOLDER_STORAGE_TTL = 5 * 60 * 1000; // 5 minutes
const searchCache = new Map();
const MAX_SEARCH_CACHE = 50;

function getStorageTree() {
    try {
        const raw = sessionStorage.getItem(TREE_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.timestamp < TREE_STORAGE_TTL && parsed.data) {
            return parsed.data;
        }
    } catch (_) { }
    return null;
}

function setStorageTree(data) {
    try {
        sessionStorage.setItem(TREE_STORAGE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
    } catch (_) { }
}

function getStorageFolder(id) {
    try {
        const raw = sessionStorage.getItem(FOLDER_STORAGE_PREFIX + id);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.timestamp < FOLDER_STORAGE_TTL && parsed.data) {
            return parsed.data;
        }
    } catch (_) { }
    return null;
}

function setStorageFolder(id, data) {
    try {
        sessionStorage.setItem(FOLDER_STORAGE_PREFIX + id, JSON.stringify({ timestamp: Date.now(), data }));
    } catch (_) { }
}

function removeStorageFolder(id) {
    try {
        sessionStorage.removeItem(FOLDER_STORAGE_PREFIX + id);
    } catch (_) { }
}

function getCachedSearchResults(query) {
    return searchCache.get(query.toLowerCase()) || null;
}

function setCachedSearchResults(query, results) {
    if (searchCache.size >= MAX_SEARCH_CACHE) {
        const firstKey = searchCache.keys().next().value;
        searchCache.delete(firstKey);
    }
    searchCache.set(query.toLowerCase(), results);
}

function updateLcpImagePreload(url) {
    if (!elements.lcpImagePreload) return;
    if (!url) {
        elements.lcpImagePreload.removeAttribute('href');
        return;
    }
    elements.lcpImagePreload.setAttribute('href', url);
}

function scheduleNonBlockingTask(callback) {
    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(callback, { timeout: 120 });
        return;
    }
    setTimeout(() => callback(), 0);
}

// --- URL HELPERS ---
function getUrlState() {
    const params = new URLSearchParams(window.location.search);
    const folderId = params.get('folder');
    const fileId = params.get('file');
    return {
        folderId: folderId && folderId.trim() ? folderId.trim() : null,
        fileId: fileId && fileId.trim() ? fileId.trim() : null
    };
}

function buildAppUrl(folderId, fileId) {
    const params = new URLSearchParams();
    if (folderId) params.set('folder', folderId);
    if (fileId) params.set('file', fileId);
    const query = params.toString();
    return query ? `${window.location.pathname}?${query}` : window.location.pathname;
}

/**
 * Updates the browser address bar and history state without creating a new history entry.
 *
 * @param {string|null} folderId - The active folder ID.
 * @param {string|null} fileId - The active file ID, or null if no file is open.
 * @returns {void}
 */
function replaceUrlState(folderId, fileId) {
    const url = buildAppUrl(folderId, fileId);
    const newState = { ...(history.state || {}), folderId, fileId };
    if (!fileId) {
        delete newState.fileId;
        delete newState.pdfOpen;
    }
    history.replaceState(newState, '', url);
}

function pushUrlState(folderId, fileId) {
    const url = buildAppUrl(folderId, fileId);
    history.pushState({ folderId, fileId }, '', url);
}

function pushFileState(folderId, fileId) {
    const url = buildAppUrl(folderId, fileId);
    history.pushState({ pdfOpen: true, folderId, fileId }, '', url);
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    const { fileId } = getUrlState();
    if (fileId) {
        updateLcpImagePreload(`${API_BASE}/thumbnail/${encodeURIComponent(fileId)}`);
    }
    initTheme();
    setupEventListeners();
    await loadFolderTree();
    await hydrateFromUrl();

    // Back to top button
    const backToTopBtn = document.getElementById('backToTopBtn');
    if (backToTopBtn) {
        window.addEventListener('scroll', () => {
            backToTopBtn.classList.toggle('visible', window.scrollY > 400);
        }, { passive: true });
        backToTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // PDF retry button
    const pdfRetryBtn = document.getElementById('pdfRetryBtn');
    if (pdfRetryBtn) {
        pdfRetryBtn.addEventListener('click', () => {
            const fileId = elements.pdfDownload.dataset.fileId;
            if (fileId && window.currentPdfFile) {
                openPdf(window.currentPdfFile, { skipHistoryPush: true });
            }
        });
    }
});

function setupEventListeners() {
    // Sidebar Toggle - passive listeners for better scroll performance
    elements.menuBtn.addEventListener('click', () => {
        elements.sidebar.classList.remove('-translate-x-full');
        elements.sidebarOverlay.classList.remove('hidden');
    }, { passive: true });

    if (elements.sidebarCloseBtn) {
        elements.sidebarCloseBtn.addEventListener('click', closeSidebar, { passive: true });
    }

    elements.sidebarOverlay.addEventListener('click', () => {
        closeSidebar();
    }, { passive: true });

    // Mobile Search Logic
    elements.mobileSearchTrigger.addEventListener('click', () => toggleMobileSearch(true), { passive: true });
    elements.closeSearchBtn.addEventListener('click', () => toggleMobileSearch(false), { passive: true });

    elements.searchResults.addEventListener('click', (e) => {
        if (isMobile) toggleMobileSearch(false);
    }, { passive: true });

    document.addEventListener('click', (e) => {
        if (!elements.searchInput.contains(e.target) && !elements.searchResults.contains(e.target)) {
            elements.searchResults.classList.add('hidden');
        }
    }, { passive: true });

    elements.themeToggle.addEventListener('click', toggleTheme, { passive: true });
    elements.closePdfBtn.addEventListener('click', () => closePdf(false), { passive: true });
    const modalBackdrop = document.getElementById('modalBackdrop');
    if (modalBackdrop) {
        modalBackdrop.addEventListener('click', () => closePdf(false), { passive: true });
    }

    // Download button - uses fetch+blob to force real download on all devices
    elements.pdfDownload.addEventListener('click', handleDownloadClick);

    // Browse Subjects button opens sidebar on mobile, scrolls to first folder on desktop
    elements.browseSubjectsBtn.addEventListener('click', () => {
        if (isMobile) {
            elements.sidebar.classList.remove('-translate-x-full');
            elements.sidebarOverlay.classList.remove('hidden');
        } else {
            // On desktop, click the first folder automatically
            const firstFolder = elements.foldersList.querySelector('.tree-toggle');
            if (firstFolder) firstFolder.click();
        }
    }, { passive: true });
    elements.searchInput.addEventListener('input', handleSearch, { passive: true });
    elements.searchInput.addEventListener('keydown', handleSearchKeydown);
    elements.searchInput.addEventListener('focus', handleSearchFocus, { passive: true });

    // Sort dropdown removed — natural alphabetical sort is always used

    // Keyboard shortcut to close PDF or Feedback viewer
    document.addEventListener('keydown', (e) => {
        if (!elements.pdfModal.classList.contains('hidden') && e.key === 'Escape') {
            closePdf();
        }
        if (elements.feedbackModal && !elements.feedbackModal.classList.contains('hidden') && e.key === 'Escape') {
            closeFeedbackModal();
        }

        if (
            e.key === '/' &&
            !e.metaKey &&
            !e.ctrlKey &&
            !e.altKey &&
            !isEditableTarget(e.target) &&
            elements.pdfModal.classList.contains('hidden')
        ) {
            e.preventDefault();
            if (isMobile) {
                toggleMobileSearch(true);
            } else {
                elements.searchInput.focus();
            }
        }
    });

    // Hide loading when iframe loads
    elements.pdfIframe.addEventListener('load', () => {
        if (pdfLoadFallbackTimer) {
            clearTimeout(pdfLoadFallbackTimer);
            pdfLoadFallbackTimer = null;
        }
        elements.pdfLoading.classList.add('hidden');
        elements.pdfIframe.classList.remove('hidden');
    });

    // Handle browser back/forward for deep links and PDF modal
    window.addEventListener('popstate', async () => {
        const { folderId, fileId } = getUrlState();

        if (fileId) {
            const folderReady = await ensureFolderSelectedById(folderId, { skipUrlSync: true });
            if (!folderReady) {
                closePdf(true);
                replaceUrlState(null, null);
                return;
            }

            let cache = cachedFiles[folderId] || { files: [] };
            let targetFile = cache.files.find(f => f.id === fileId);
            if (!targetFile) {
                delete cachedFiles[folderId];
                const resolvedName = getFolderNameById(folderId);
                await selectFolder(folderId, resolvedName, { skipUrlSync: true });
                cache = cachedFiles[folderId] || { files: [] };
                targetFile = cache.files.find(f => f.id === fileId);
            }
            if (targetFile) openPdf(targetFile, { skipHistoryPush: true, skipUrlSync: true });
            return;
        }

        if (!elements.pdfModal.classList.contains('hidden')) {
            closePdf(true); // true = already popped, don't pop again
        }

        if (folderId) {
            await ensureFolderSelectedById(folderId, { skipUrlSync: true });
        } else {
            goHome(false);
        }
    });

    // Pause polling when tab is hidden to save battery and bandwidth
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (folderPollTimer) { clearInterval(folderPollTimer); folderPollTimer = null; }
            if (filePollTimer) { clearInterval(filePollTimer); filePollTimer = null; }
        } else {
            // Resume polling and do an immediate check
            startFolderPolling();
            pollFolderTree();
            if (currentFolderId) {
                startFilePolling();
                pollFiles();
            }
        }
    });

    const breadcrumbTrail = document.getElementById('breadcrumbTrail');
    if (breadcrumbTrail) {
        breadcrumbTrail.addEventListener('click', (e) => {
            const item = e.target.closest('.breadcrumb-item');
            if (item) {
                if (item.dataset.home === 'true') {
                    goHome();
                } else if (item.dataset.folderId) {
                    selectFolder(item.dataset.folderId, item.dataset.folderName);
                }
            }
        }, { passive: true });
    }

    if (elements.backToHomeBtn) {
        elements.backToHomeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            goHome();
        });
    }

    if (elements.navHomeBtn) {
        elements.navHomeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            goHome();
        });
    }

    // Delegated click handler for reliable home navigation
    document.addEventListener('click', (e) => {
        const homeBtn = e.target.closest('#backToHomeBtn, #navHomeBtn, [data-action="go-home"]');
        if (homeBtn) {
            e.preventDefault();
            goHome();
        }
    });

    if (elements.logoContainer) {
        elements.logoContainer.addEventListener('click', (e) => {
            e.preventDefault();
            goHome();
        });
    }

    // Feedback Modal Event Listeners
    if (elements.openFeedbackBtn) {
        elements.openFeedbackBtn.addEventListener('click', openFeedbackModal);
    }
    if (elements.closeFeedbackBtn) {
        elements.closeFeedbackBtn.addEventListener('click', closeFeedbackModal);
    }
    if (elements.feedbackBackdrop) {
        elements.feedbackBackdrop.addEventListener('click', closeFeedbackModal);
    }
    if (elements.feedbackCategoryBtn) {
        elements.feedbackCategoryBtn.addEventListener('click', toggleFeedbackCategoryMenu);
    }
    if (elements.feedbackCategoryMenu) {
        elements.feedbackCategoryMenu.addEventListener('click', handleFeedbackCategorySelect);
    }
    if (elements.feedbackForm) {
        elements.feedbackForm.addEventListener('submit', handleFeedbackSubmit);
    }

    // Close category dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (elements.feedbackCategoryMenu && !elements.feedbackCategoryMenu.classList.contains('hidden')) {
            if (elements.feedbackCategoryBtn && !elements.feedbackCategoryBtn.contains(e.target) && !elements.feedbackCategoryMenu.contains(e.target)) {
                elements.feedbackCategoryMenu.classList.add('hidden');
                if (elements.feedbackCategoryChevron) elements.feedbackCategoryChevron.classList.remove('rotate-180');
                if (elements.feedbackCategoryBtn) elements.feedbackCategoryBtn.setAttribute('aria-expanded', 'false');
            }
        }
    });
}

window.goHome = goHome;

/**
 * Resets the application state and navigates back to the welcome/home screen.
 * Closes any open modals, hides folder headers, clears file grids, and stops polling.
 *
 * @param {boolean} [pushState=true] - Whether to push a new browser history entry.
 */
function goHome(pushState = true) {
    if (!elements.pdfModal.classList.contains('hidden')) {
        closePdf(true);
    }
    if (pushState) {
        pushUrlState(null, null);
    } else {
        replaceUrlState(null, null);
    }
    currentFolderId = null;
    currentFolderName = null;
    updateActiveFolderButton();
    stopFilePolling();
    elements.contentHeader.classList.add('hidden');
    elements.filesGrid.innerHTML = '';
    elements.emptyState.classList.add('hidden');
    elements.welcomeState.classList.remove('hidden');
    document.title = 'EduCrate | CS2 Notes';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeSidebar() {
    elements.sidebar.classList.add('-translate-x-full');
    elements.sidebarOverlay.classList.add('hidden');
}

function isEditableTarget(target) {
    if (!target) return false;
    const tagName = target.tagName;
    return target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

function toggleMobileSearch(isActive) {
    if (!isMobile) return;
    requestAnimationFrame(() => {
        if (isActive) {
            elements.logoContainer.classList.add('hidden');
            elements.rightNav.classList.add('hidden');
            elements.mobileSearchTrigger.classList.add('hidden');
            elements.searchBarContainer.classList.remove('hidden');
            elements.searchBarContainer.classList.add('block');
            elements.closeSearchBtn.classList.remove('hidden');
            elements.searchInput.focus();
        } else {
            elements.logoContainer.classList.remove('hidden');
            elements.rightNav.classList.remove('hidden');
            elements.mobileSearchTrigger.classList.remove('hidden');
            elements.searchBarContainer.classList.add('hidden');
            elements.searchBarContainer.classList.remove('block');
            elements.closeSearchBtn.classList.add('hidden');
            elements.searchInput.value = '';
            elements.searchInput.removeAttribute('aria-activedescendant');
            elements.searchInput.setAttribute('aria-expanded', 'false');
            elements.searchResults.classList.add('hidden');
        }
    });
}

// --- THEME ENGINE ---
function initTheme() {
    const isDark = localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
    updateThemeIcons(isDark);
    updateThemeColor(isDark);
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.theme = isDark ? 'dark' : 'light';
    updateThemeIcons(isDark);
    updateThemeColor(isDark);
}

function updateThemeIcons(isDark) {
    elements.sunIcon.classList.toggle('hidden', !isDark);
    elements.moonIcon.classList.toggle('hidden', isDark);
}

function updateThemeColor(isDark) {
    if (!elements.themeColorMeta) return;
    elements.themeColorMeta.setAttribute('content', isDark ? '#07091f' : '#f6f8ff');
}

// --- DATA ENGINE ---
async function loadFolderTree() {
    if (cachedTree) {
        renderFolderTree(cachedTree);
        startFolderPolling();
        return;
    }
    const storedTree = getStorageTree();
    if (storedTree) {
        cachedTree = storedTree;
        renderFolderTree(cachedTree);
        startFolderPolling();
        // Background revalidation
        pollFolderTree();
        return;
    }
    try {
        const res = await fetch(API_BASE + '/tree');
        const data = await res.json();
        if (data.success) {
            cachedTree = data.data;
            setStorageTree(cachedTree);
            renderFolderTree(cachedTree);
            startFolderPolling();
        }
    } catch (e) { console.error(e); }
}

/**
 * Ensures that a folder with the given ID is selected and its contents loaded.
 * Resolves the folder name automatically from local caches or the navigation tree.
 *
 * @param {string} folderId - The ID of the folder to select.
 * @param {object} [options={}] - Additional configuration options.
 * @param {boolean} [options.skipUrlSync=false] - Whether to skip syncing the URL state.
 * @returns {Promise<boolean>} True if folder selection succeeded, false otherwise.
 */
async function ensureFolderSelectedById(folderId, options = {}) {
    if (!folderId) return false;
    if (folderId === currentFolderId && cachedFiles[folderId]) return true;
    const resolvedName = getFolderNameById(folderId);
    await selectFolder(folderId, resolvedName, options);
    return true;
}

/**
 * Restores folder selection and active PDF preview based on current query parameters.
 *
 * @returns {Promise<void>}
 */
async function hydrateFromUrl() {
    const { folderId, fileId } = getUrlState();
    if (!folderId) return;
    const folderReady = await ensureFolderSelectedById(folderId, { skipUrlSync: true });
    if (!folderReady) return;
    // Create a base history entry for the folder so Back closes the PDF
    replaceUrlState(folderId, null);

    if (fileId) {
        const cache = cachedFiles[folderId] || { files: [] };
        let targetFile = cache.files.find(f => f.id === fileId);
        if (!targetFile) {
            delete cachedFiles[folderId];
            removeStorageFolder(folderId);
            const resolvedName = getFolderNameById(folderId);
            await selectFolder(folderId, resolvedName, { skipUrlSync: true });
            const refreshed = cachedFiles[folderId] || { files: [] };
            targetFile = refreshed.files.find(f => f.id === fileId);
        }
        if (targetFile) openPdf(targetFile);
    }
}

// --- AUTO-SYNC POLLING ENGINE ---
function startFolderPolling() {
    if (folderPollTimer) clearInterval(folderPollTimer);
    folderPollTimer = setInterval(pollFolderTree, FOLDER_POLL_INTERVAL);
}

function startFilePolling() {
    if (filePollTimer) clearInterval(filePollTimer);
    filePollTimer = setInterval(pollFiles, FILE_POLL_INTERVAL);
}

function stopFilePolling() {
    if (filePollTimer) {
        clearInterval(filePollTimer);
        filePollTimer = null;
    }
}

async function pollFolderTree() {
    try {
        const res = await fetch(API_BASE + '/tree', {
            headers: { 'Cache-Control': 'no-cache' }
        });
        const data = await res.json();
        if (data.success) {
            if (JSON.stringify(cachedTree) !== JSON.stringify(data.data)) {
                cachedTree = data.data;
                setStorageTree(cachedTree);
                renderFolderTree(cachedTree);
            }
        }
    } catch (e) { console.error('Tree poll error:', e); }
}

/**
 * Periodically polls the active folder contents from the server and re-renders if changes occur.
 * Files are rendered in natural alphanumeric sort order and folder metadata is preserved.
 *
 * @returns {Promise<void>}
 */
async function pollFiles() {
    if (!currentFolderId) return;
    try {
        const res = await fetch(API_BASE + '/folder-contents/' + currentFolderId, {
            headers: { 'Cache-Control': 'no-cache' }
        });
        const data = await res.json();
        if (data.success) {
            const newFiles = data.data.files || [];
            const newFolders = data.data.folders || [];
            const breadcrumbs = data.data.breadcrumbs || [];
            const currentCache = cachedFiles[currentFolderId] || { files: [], folders: [] };
            const resolvedFolderName = (data.data.folderName && data.data.folderName !== 'Loading...')
                ? data.data.folderName
                : ((currentCache.folderName && currentCache.folderName !== 'Loading...')
                    ? currentCache.folderName
                    : ((currentFolderName && currentFolderName !== 'Loading...')
                        ? currentFolderName
                        : getFolderNameById(currentFolderId)));

            if (resolvedFolderName && (elements.contentTitle.textContent === 'Loading...' || !elements.contentTitle.textContent)) {
                elements.contentTitle.textContent = resolvedFolderName;
                currentFolderName = resolvedFolderName;
                document.title = `${resolvedFolderName} | EduCrate CS2 Notes`;
            }

            if (!areFilesEqual(currentCache.files, newFiles) || !areFoldersEqual(currentCache.folders, newFolders) || currentCache.folderName !== resolvedFolderName) {
                cachedFiles[currentFolderId] = { folders: newFolders, files: newFiles, breadcrumbs, folderName: resolvedFolderName };
                setStorageFolder(currentFolderId, cachedFiles[currentFolderId]);
                if (newFiles.length > 0 || newFolders.length > 0) {
                    renderFolderContents(newFolders, [...newFiles].sort(naturalSort));
                    elements.emptyState.classList.add('hidden');
                } else {
                    elements.filesGrid.innerHTML = '';
                    elements.emptyState.classList.remove('hidden');
                }
                renderBreadcrumbs(breadcrumbs);
            }
        }
    } catch (e) { console.error('File poll error:', e); }
}
function areFoldersEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].id !== b[i].id || a[i].name !== b[i].name) return false;
    }
    return true;
}


function areFilesEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (
            a[i].id !== b[i].id ||
            a[i].name !== b[i].name ||
            a[i].size !== b[i].size ||
            (a[i].modifiedTime || '') !== (b[i].modifiedTime || '')
        ) return false;
    }
    return true;
}

/**
 * Icon rules configuration for dynamic subject categorization.
 * Maps subjects across Semester 4 through Semester 8 (including electives and labs)
 * to concept-tailored SVG icons based on keywords and KTU course codes.
 */
const SUBJECT_ICON_RULES = [
    // 1. Labs and Practicals (Evaluated first so e.g. "ML LAB" gets a Lab Flask)
    {
        patterns: [/\blab\b/i, /laboratory/i, /practical/i, /workshop/i, /\bpccsl/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M10 2v5.5L4.4 18.2A2 2 0 0 0 6.1 21h11.8a2 2 0 0 0 1.7-2.8L14 7.5V2m-5 0h6m-7 12h8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    },
    // 2. Quantum Computing
    {
        patterns: [/quantum/i, /\bpecst638\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="2" stroke-width="2"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(30 12 12)" stroke-width="2"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(-30 12 12)" stroke-width="2"/></svg>'
    },
    // 3. Bioinformatics
    {
        patterns: [/bioinformatics/i, /\bpecst743\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="m8 3 4 4 4-4M8 21l4-4 4 4M4 8l16 0M4 16l16 0M9 8a5 5 0 0 0 6 8M15 8a5 5 0 0 1-6 8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    },
    // 4. Natural Language Processing, Audio & Prompt Engineering
    {
        patterns: [/\bnlp\b/i, /natural\s*language/i, /speech/i, /audio\s*processing/i, /prompt\s*engineering/i, /\bpecst862\b/i, /\bpecst866\b/i, /\bpecst868\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 9h8m-8 4h5" stroke-width="2" stroke-linecap="round"/></svg>'
    },
    // 5. Hardware, Microcontrollers, Embedded & IoT
    {
        patterns: [/micro\s*controller/i, /microprocessor/i, /microcontrollers/i, /\biot\b/i, /internet\s*of\s*things/i, /\bvlsi\b/i, /embedded/i, /architecture/i, /\bcoa\b/i, /\bpbcst504\b/i, /\bpecst415\b/i, /\bpecst528\b/i, /\bpecst746\b/i, /\bpecst755\b/i, /\boecst834\b/i, /\bpbcst404\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" stroke-width="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M20 9h3M20 15h3M1 9h4M1 15h4" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="2" stroke-width="2"/></svg>'
    },
    // 6. Artificial Intelligence & Machine Learning
    {
        patterns: [/\bai\b/i, /\bml\b/i, /artificial/i, /machine\s*learning/i, /deep\s*learning/i, /soft\s*computing/i, /pattern\s*recognition/i, /fuzzy/i, /\bpecst503\b/i, /\bpecst522\b/i, /\bpecst632\b/i, /\bpecst752\b/i, /\bpecst753\b/i, /\boecst614\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 3a3 3 0 0 0-3 3v1a3 3 0 0 0 0 6v1a3 3 0 0 0 4.5 2.6M15 3a3 3 0 0 1 3 3v1a3 3 0 0 1 0 6v1a3 3 0 0 1-4.5 2.6" stroke-width="2" stroke-linecap="round"/><path d="M12 5v14M8 9h2M14 9h2M8 15h2M14 15h2" stroke-width="2" stroke-linecap="round"/></svg>'
    },
    // 7. Algorithms & Data Structures (DAA, DSA, Graph, Parallel, etc.)
    {
        patterns: [/\bdaa\b/i, /\bdsa\b/i, /algorithm/i, /data\s*structure/i, /tcs/i, /\bpccst502\b/i, /\bpecst495\b/i, /\bpecst595\b/i, /\bpecst639\b/i, /\bpecst749\b/i, /\bpecst759\b/i, /\bpecst785\b/i, /\boecst611\b/i, /\boecst831\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="3" stroke-width="2"/><circle cx="5" cy="19" r="3" stroke-width="2"/><circle cx="19" cy="19" r="3" stroke-width="2"/><path d="M12 8v4m0 0L5 16m7-4l7 4" stroke-width="2" stroke-linecap="round"/></svg>'
    },
    // 8. Computer Networks & Wireless Communication
    {
        patterns: [/network/i, /\bcn\b/i, /wireless/i, /data\s*communication/i, /telecom/i, /\bpccst501\b/i, /\bpecst633\b/i, /\bpecst751\b/i, /\boecst612\b/i, /\boecst724\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0 1 14.08 0M8.5 16a6 6 0 0 1 7 0M12 20h.01" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 8.82a16 16 0 0 1 20 0" stroke-width="2" stroke-linecap="round"/></svg>'
    },
    // 9. Cybersecurity, Privacy & Digital Forensics
    {
        patterns: [/security/i, /cyber/i, /forensic/i, /\bpbcst604\b/i, /\bpecst419\b/i, /\bpecst744\b/i, /\bpecst754\b/i, /\bpecst863\b/i, /\boecst721\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 3 20 7v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7l8-4Z" stroke-width="2" stroke-linejoin="round"/><path d="m9.5 12 1.7 1.7 3.8-4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    },
    // 10. Cryptography & Blockchain
    {
        patterns: [/crypto/i, /blockchain/i, /coding\s*theory/i, /\bpecst414\b/i, /\bpecst637\b/i, /\bpecst747\b/i, /\boecst613\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" stroke-width="2"/><circle cx="12" cy="16" r="1.5" stroke-width="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke-width="2" stroke-linecap="round"/></svg>'
    },
    // 11. Databases, Data Mining & Storage Systems
    {
        patterns: [/\bdbms\b/i, /database/i, /data\s*mining/i, /data\s*compression/i, /data\s*analytics/i, /storage/i, /\bpccst402\b/i, /\bpecst523\b/i, /\bpecst524\b/i, /\bpecst525\b/i, /\bpecst634\b/i, /\bpecst867\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="3" stroke-width="2"/><path d="M5 5v6c0 1.66 3.13 3 7 3s7-1.34 7-3V5" stroke-width="2" stroke-linecap="round"/><path d="M5 11v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" stroke-width="2" stroke-linecap="round"/></svg>'
    },
    // 12. Operating Systems & Computing Systems
    {
        patterns: [/\bos\b/i, /operating\s*system/i, /real\s*time\s*system/i, /high\s*performance/i, /computing\s*system/i, /\bpccst403\b/i, /\bpccst602\b/i, /\bpecst748\b/i, /\bpecst757\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2" stroke-width="2"/><path d="M8 20h8M12 16v4" stroke-width="2" stroke-linecap="round"/><path d="m7 8 2 2-2 2M12 12h4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    },
    // 13. Compilers & Programming Languages
    {
        patterns: [/compiler/i, /\bcd\b/i, /automata/i, /\btoc\b/i, /programming\s*language/i, /formal\s*method/i, /functional\s*programming/i, /\boop\b/i, /\bpccst601\b/i, /\bpecst413\b/i, /\bpecst741\b/i, /\bpecst758\b/i, /\boecst615\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="m8 8-4 4 4 4M16 8l4 4-4 4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="m14 4-4 16" stroke-width="2" stroke-linecap="round"/></svg>'
    },
    // 14. Graphics, Computer Vision & Multimedia
    {
        patterns: [/graphic/i, /image\s*processing/i, /vision/i, /multimedia/i, /interaction\s*design/i, /\bpecst527\b/i, /\bpecst636\b/i, /\bpecst745\b/i, /\bpecst865\b/i, /\boecst835\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke-width="2"/><circle cx="9" cy="9" r="1.5" fill="currentColor"/><circle cx="15" cy="9" r="1.5" fill="currentColor"/><circle cx="15" cy="14" r="1.5" fill="currentColor"/><circle cx="8" cy="14" r="1.5" fill="currentColor"/></svg>'
    },
    // 15. Cloud Computing
    {
        patterns: [/cloud/i, /\bpecst635\b/i, /\boecst722\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 13v6m-3-3 3 3 3-3" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    },
    // 16. Software Engineering, Management & Testing
    {
        patterns: [/software/i, /project\s*management/i, /\bspm\b/i, /\bse\b/i, /testing/i, /\bpecst411\b/i, /\bpecst521\b/i, /\bpecst631\b/i, /\bpecst861\b/i, /\boecst723\b/i, /\boecst833\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="8" y="2" width="8" height="4" rx="1" stroke-width="2"/><rect x="4" y="4" width="16" height="18" rx="2" stroke-width="2"/><path d="m9 12 2 2 4-4m-6 6h6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    },
    // 17. Web & Mobile App Development
    {
        patterns: [/web/i, /mobile/i, /android/i, /\bpecst695\b/i, /\bpecst742\b/i, /\boecst725\b/i, /\boecst832\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="14" rx="2" stroke-width="2"/><path d="M3 8h18M7 5.5h.01M10 5.5h.01M14 19h5a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2Z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    },
    // 18. Mathematics, Economics & Engineering Sciences
    {
        patterns: [/mathematics/i, /\bmath\b/i, /geometry/i, /economic/i, /ethics/i, /sustainable/i, /game\s*theory/i, /complexity/i, /number\s*theory/i, /signal/i, /\bgamat401\b/i, /\buchut346\b/i, /\buchut347\b/i, /\bpecst416\b/i, /\bpecst418\b/i, /\bpecst753\b/i, /\bpecst795\b/i, /\bpecst864\b/i, /\bpecst869\b/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M18 4H6l7 8-7 8h12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 9h-4m4 6h-4" stroke-width="2" stroke-linecap="round"/></svg>'
    },
    // 19. Syllabus & Question Papers
    {
        patterns: [/syllabus/i, /question\s*paper/i, /\bpyq\b/i, /model/i],
        svg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke-width="2" stroke-linejoin="round"/><path d="M14 2v6h6M16 13H8m8 4H8m2-8H8" stroke-width="2" stroke-linecap="round"/></svg>'
    }
];

const DEFAULT_SUBJECT_ICON_SVG = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke-width="2" stroke-linecap="round"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" stroke-width="2" stroke-linejoin="round"/></svg>';

/**
 * Returns a concept-tailored SVG icon string for a given subject or folder name.
 * Uses pattern matching against subject names, course codes, and domain concepts.
 *
 * @param {string} [name=''] - Name of the subject or folder.
 * @returns {string} Safe SVG markup string representing the subject.
 */
function getSubjectIconSvg(name = '') {
    if (!name || typeof name !== 'string') {
        return DEFAULT_SUBJECT_ICON_SVG;
    }
    const cleanName = name.trim();
    const matchedRule = SUBJECT_ICON_RULES.find(rule => rule.patterns.some(pattern => pattern.test(cleanName)));
    return matchedRule ? matchedRule.svg : DEFAULT_SUBJECT_ICON_SVG;
}

/**
 * Recursively searches a folder tree or node list for a node matching the specified ID.
 *
 * @param {object|Array<object>} tree - The root tree node or array of nodes to search.
 * @param {string} id - The folder ID to find.
 * @returns {object|null} The matching tree node, or null if not found.
 */
function findNodeInTree(tree, id) {
    if (!tree || !id) return null;
    if (Array.isArray(tree)) {
        for (const item of tree) {
            const found = findNodeInTree(item, id);
            if (found) return found;
        }
        return null;
    }
    if (tree.id === id) return tree;
    if (Array.isArray(tree.children)) {
        for (const child of tree.children) {
            const found = findNodeInTree(child, id);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Resolves a folder's display name using available in-memory cache, session storage, or the folder tree.
 *
 * @param {string} id - The folder ID to resolve.
 * @returns {string} The resolved folder name, or an empty string if unknown.
 */
function getFolderNameById(id) {
    if (!id) return '';
    if (cachedFiles[id] && cachedFiles[id].folderName && cachedFiles[id].folderName !== 'Loading...') {
        return cachedFiles[id].folderName;
    }
    const storage = getStorageFolder(id);
    if (storage && storage.folderName && storage.folderName !== 'Loading...') {
        return storage.folderName;
    }
    const tree = cachedTree || getStorageTree();
    const node = findNodeInTree(tree, id);
    if (node && node.name && node.name !== 'Loading...') {
        return node.name;
    }
    if (storage && Array.isArray(storage.breadcrumbs) && storage.breadcrumbs.length > 0) {
        const last = storage.breadcrumbs[storage.breadcrumbs.length - 1];
        if (last && last.name && last.name !== 'Loading...') {
            return last.name;
        }
    }
    return '';
}

function buildTreeHtml(node, level = 0, isInitial = false) {
    const count = cachedFiles[node.id] ? cachedFiles[node.id].files.length : null;
    const countBadge = count !== null ? '<span class="tree-count-badge">' + count + '</span>' : '';

    if (!node.children || node.children.length === 0) {
        return '<li class="tree-item">' +
            '<button class="tree-toggle tree-leaf ' + (node.id === currentFolderId ? 'is-active' : '') + '" data-folder-id="' + escapeHtml(node.id) + '" data-folder-name="' + escapeHtml(node.name) + '" style="padding-left: ' + (level * 0.75 + 0.5) + 'rem">' +
            '<span class="tree-icon">' + getSubjectIconSvg(node.name) + '</span>' +
            '<span class="tree-label">' + escapeHtml(node.name) + '</span>' +
            countBadge +
            '</button>' +
            '</li>';
    }

    function isParentOfCurrent(n) {
        if (n.id === currentFolderId) return true;
        if (n.children) return n.children.some(isParentOfCurrent);
        return false;
    }

    const isExpanded = isInitial ? isParentOfCurrent(node) : false;
    const childrenHtml = isExpanded ? node.children.map(child => buildTreeHtml(child, level + 1, isInitial)).join('') : '';

    return '<li class="tree-item ' + (isExpanded ? 'is-expanded' : '') + '">' +
        '<button class="tree-toggle ' + (node.id === currentFolderId ? 'is-active' : '') + '" data-folder-id="' + escapeHtml(node.id) + '" data-folder-name="' + escapeHtml(node.name) + '" style="padding-left: ' + (level * 0.75 + 0.5) + 'rem">' +
        '<span class="tree-chevron flex items-center justify-center">' +
        '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9 5l7 7-7 7"/></svg>' +
        '</span>' +
        '<span class="tree-icon">' + getSubjectIconSvg(node.name) + '</span>' +
        '<span class="tree-label">' + escapeHtml(node.name) + '</span>' +
        countBadge +
        '</button>' +
        '<ul class="tree-children ' + (isExpanded ? '' : 'hidden') + '" data-level="' + (level + 1) + '" data-rendered="' + (isExpanded ? 'true' : 'false') + '">' +
        childrenHtml +
        '</ul>' +
        '</li>';
}

function renderFolderTree(tree) {
    if (!tree || !tree.children) return;
    const html = '<ul class="tree-list">' + tree.children.map(child => buildTreeHtml(child, 0, true)).join('') + '</ul>';

    requestAnimationFrame(() => {
        elements.foldersList.removeEventListener('click', handleTreeClick);
        elements.foldersList.innerHTML = html;
        elements.foldersList.addEventListener('click', handleTreeClick, { passive: true });
    });
}

function updateActiveFolderButton() {
    const buttons = elements.foldersList.querySelectorAll('.tree-toggle');
    buttons.forEach(btn => {
        const folderId = btn.dataset.folderId;
        const isActive = folderId === currentFolderId;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-current', isActive ? 'page' : 'false');

        // Update badge
        const count = cachedFiles[folderId] ? cachedFiles[folderId].files.length : null;
        if (count !== null) {
            let badge = btn.querySelector('.tree-count-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'tree-count-badge';
                btn.appendChild(badge);
            }
            badge.textContent = count;
        }

        if (isActive) {
            let parentItem = btn.closest('.tree-children')?.closest('.tree-item');
            while (parentItem) {
                parentItem.classList.add('is-expanded');

                const childrenList = parentItem.querySelector('.tree-children');
                if (childrenList.dataset.rendered === 'false') {
                    const node = findNodeInTree(cachedTree, parentItem.querySelector('.tree-toggle').dataset.folderId);
                    const level = parseInt(childrenList.dataset.level || '1', 10);
                    if (node && node.children) {
                        childrenList.innerHTML = node.children.map(child => buildTreeHtml(child, level, false)).join('');
                    }
                    childrenList.dataset.rendered = 'true';
                }

                childrenList.classList.remove('hidden');
                parentItem = parentItem.parentElement.closest('.tree-item');
            }
        }
    });
}

function handleTreeClick(e) {
    const toggleBtn = e.target.closest('.tree-toggle');
    if (!toggleBtn) return;

    const chevron = e.target.closest('.tree-chevron');
    if (chevron && !toggleBtn.classList.contains('tree-leaf')) {
        const treeItem = toggleBtn.closest('.tree-item');
        const childrenList = treeItem.querySelector('.tree-children');
        const isExpanded = treeItem.classList.contains('is-expanded');

        if (isExpanded) {
            treeItem.classList.remove('is-expanded');
            childrenList.classList.add('hidden');
        } else {
            if (childrenList.dataset.rendered === 'false') {
                const node = findNodeInTree(cachedTree, toggleBtn.dataset.folderId);
                const level = parseInt(childrenList.dataset.level || '1', 10);
                if (node && node.children) {
                    childrenList.innerHTML = node.children.map(child => buildTreeHtml(child, level, false)).join('');
                }
                childrenList.dataset.rendered = 'true';
            }
            treeItem.classList.add('is-expanded');
            childrenList.classList.remove('hidden');
        }
        return;
    }

    selectFolder(toggleBtn.dataset.folderId, toggleBtn.dataset.folderName);
}

/**
 * Loads and displays the contents of a selected folder by its ID.
 * Renders folders and files using natural sort order and updates the browser history and breadcrumbs.
 *
 * @param {string} id - The folder ID to select and fetch.
 * @param {string} [name=''] - The display name of the folder.
 * @param {object} [options={}] - Additional configuration options.
 * @param {boolean} [options.skipUrlSync=false] - Whether to skip syncing the URL state.
 * @returns {Promise<void>}
 */
async function selectFolder(id, name, options = {}) {
    currentFolderId = id; // Track for refresh
    let resolvedName = (name && name !== 'Loading...') ? name : getFolderNameById(id);
    currentFolderName = resolvedName || ''; // Track for refresh
    updateActiveFolderButton();
    elements.welcomeState.classList.add('hidden');
    elements.contentHeader.classList.remove('hidden');

    if (resolvedName) {
        elements.contentTitle.textContent = resolvedName;
        document.title = `${resolvedName} | EduCrate CS2 Notes`;
    } else {
        elements.contentTitle.textContent = 'Loading...';
        document.title = 'Loading... | EduCrate CS2 Notes';
    }

    // Remove dynamic noindex tag if it exists (for valid folders)
    const existingNoIndex = document.querySelector('meta[name="robots"][content="noindex"]');
    if (existingNoIndex) {
        existingNoIndex.remove();
    }
    elements.emptyState.classList.add('hidden');
    updateLcpImagePreload(null);
    if (!options.skipUrlSync) {
        replaceUrlState(id, null);
    }

    if (isMobile) {
        closeSidebar();
    }

    renderSkeletons();

    if (cachedFiles[id] || getStorageFolder(id)) {
        if (!cachedFiles[id]) {
            cachedFiles[id] = getStorageFolder(id);
        }
        const cache = cachedFiles[id];
        if (!resolvedName && cache.folderName && cache.folderName !== 'Loading...') {
            resolvedName = cache.folderName;
        }
        if (resolvedName) {
            cache.folderName = resolvedName;
            currentFolderName = resolvedName;
            elements.contentTitle.textContent = resolvedName;
            document.title = `${resolvedName} | EduCrate CS2 Notes`;
            setStorageFolder(id, cache);
        }
        renderFolderContents(cache.folders, [...cache.files].sort(naturalSort));
        renderBreadcrumbs(cache.breadcrumbs);
        // Start polling after initial render is done
        startFilePolling();

        if (resolvedName) {
            return;
        }
        // If we still do not have a real folder name, fall through to fetch from API so the title is updated
    }

    try {
        const res = await fetch(API_BASE + '/folder-contents/' + id);
        const data = await res.json();
        if (data.success) {
            const { folders, files, breadcrumbs, folderName } = data.data;
            const finalFolderName = (folderName && folderName !== 'Loading...')
                ? folderName
                : (resolvedName || getFolderNameById(id) || 'Folder');
            cachedFiles[id] = { folders, files, breadcrumbs, folderName: finalFolderName };
            setStorageFolder(id, cachedFiles[id]);
            if (id === currentFolderId) {
                currentFolderName = finalFolderName;
                elements.contentTitle.textContent = finalFolderName;
                document.title = `${finalFolderName} | EduCrate CS2 Notes`;
                renderFolderContents(folders, [...files].sort(naturalSort));
                renderBreadcrumbs(breadcrumbs);
                if (folders.length === 0 && files.length === 0) {
                    elements.emptyState.classList.remove('hidden');
                }
            }
            // Start polling after initial render is done
            startFilePolling();
        } else {
            if (id === currentFolderId) {
                elements.filesGrid.innerHTML = '';
                elements.emptyState.classList.remove('hidden');
                document.title = `Folder Not Found | EduCrate CS2 Notes`;
                if (!document.querySelector('meta[name="robots"][content="noindex"]')) {
                    const meta = document.createElement('meta');
                    meta.name = 'robots';
                    meta.content = 'noindex';
                    document.head.appendChild(meta);
                }
            }
        }
    } catch (e) {
        console.error(e);
        if (id === currentFolderId) {
            elements.filesGrid.innerHTML = '';
            elements.emptyState.classList.remove('hidden');
            document.title = `Folder Not Found | EduCrate CS2 Notes`;
            if (!document.querySelector('meta[name="robots"][content="noindex"]')) {
                const meta = document.createElement('meta');
                meta.name = 'robots';
                meta.content = 'noindex';
                document.head.appendChild(meta);
            }
        }
    }
}

function renderSkeletons() {
    const skeletonCount = isMobile ? 4 : 6;
    elements.filesGrid.innerHTML = Array.from({ length: skeletonCount }, () =>
        '<div class="file-skeleton p-3 sm:p-4">' +
        '<div class="thumbnail-shell shimmer rounded-xl mb-3"></div>' +
        '<div class="h-4 shimmer rounded mb-2"></div>' +
        '<div class="h-3 w-20 shimmer rounded"></div>' +
        '</div>'
    ).join('');
}

/**
 * Generates the HTML card markup for a folder item displayed in the main content grid.
 * Dynamically uses the concept-tailored icon associated with the subject/folder.
 *
 * @param {{ id: string, name: string }} folder - The folder object with id and name.
 * @returns {string} HTML markup string for the folder card.
 */
function buildFolderCardHtml(folder) {
    return '<div class="folder-card" data-folder-id="' + escapeHtml(folder.id) + '" data-folder-name="' + escapeHtml(folder.name) + '">' +
        '<div class="folder-card-icon">' +
        getSubjectIconSvg(folder.name) +
        '</div>' +
        '<div class="folder-card-name">' + escapeHtml(folder.name) + '</div>' +
        '</div>';
}

function renderBreadcrumbs(breadcrumbs) {
    const nav = document.getElementById('breadcrumbTrail');
    if (!nav) return;

    const homeCrumb = '<span class="breadcrumb-item cursor-pointer hover:text-primary-600 dark:hover:text-primary-400 font-semibold" data-home="true">Home</span>';

    if (!breadcrumbs || breadcrumbs.length === 0) {
        nav.innerHTML = homeCrumb;
        return;
    }

    const html = breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1;
        if (isLast) {
            return '<span class="breadcrumb-item cursor-default text-primary-600 dark:text-primary-400 font-bold">' + escapeHtml(crumb.name) + '</span>';
        }
        return '<span class="breadcrumb-item cursor-pointer hover:text-primary-600 dark:hover:text-primary-400" data-folder-id="' + escapeHtml(crumb.id) + '" data-folder-name="' + escapeHtml(crumb.name) + '">' + escapeHtml(crumb.name) + '</span>' +
            '<span class="breadcrumb-separator">›</span>';
    }).join('');

    nav.innerHTML = homeCrumb + '<span class="breadcrumb-separator">›</span>' + html;

    // SEO JSON-LD Breadcrumbs
    let ldScript = document.getElementById('breadcrumb-ld');
    if (breadcrumbs && breadcrumbs.length > 0) {
        if (!ldScript) {
            ldScript = document.createElement('script');
            ldScript.id = 'breadcrumb-ld';
            ldScript.type = 'application/ld+json';
            document.head.appendChild(ldScript);
        }

        const itemListElement = breadcrumbs.map((crumb, index) => ({
            "@type": "ListItem",
            "position": index + 1,
            "name": crumb.name,
            "item": "https://edunoteshub.netlify.app/?folder=" + crumb.id
        }));

        ldScript.textContent = JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": itemListElement
        });
    } else if (ldScript) {
        ldScript.remove();
    }
}

function renderFolderContents(folders, files) {
    const lcpIndex = files.findIndex(file => file.thumbnailUrl);
    updateLcpImagePreload(lcpIndex === -1 ? null : files[lcpIndex].thumbnailUrl);

    const folderHtml = (folders || []).map(buildFolderCardHtml).join('');
    const cards = new Array(files.length);
    const currentToken = ++fileRenderToken;
    let cursor = 0;

    if (files.length === 0) {
        elements.filesGrid.removeEventListener('click', handleFileClick);
        elements.filesGrid.innerHTML = folderHtml;
        elements.filesGrid.addEventListener('click', handleFileClick, { passive: true });
        return;
    }

    const processChunk = (deadline) => {
        if (currentToken !== fileRenderToken) return;

        let processed = 0;
        while (cursor < files.length) {
            if (deadline && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() <= 4 && processed > 0) {
                break;
            }
            if (!deadline && processed >= 8) {
                break;
            }

            cards[cursor] = buildFileCardHtml(files[cursor], cursor === lcpIndex);
            cursor += 1;
            processed += 1;
        }

        if (cursor < files.length) {
            scheduleNonBlockingTask(processChunk);
            return;
        }

        requestAnimationFrame(() => {
            if (currentToken !== fileRenderToken) return;
            elements.filesGrid.removeEventListener('click', handleFileClick);
            elements.filesGrid.innerHTML = folderHtml + cards.join('');
            elements.filesGrid.addEventListener('click', handleFileClick, { passive: true });
        });
    };

    scheduleNonBlockingTask(processChunk);
}

function getRelativeDate(isoString) {
    if (!isoString) return null;

    const time = new Date(isoString).getTime();
    if (isNaN(time)) return null; // Handle invalid date strings

    // Ensure we don't get negative diffs for future dates
    const diff = Math.max(0, Date.now() - time);
    const days = Math.floor(diff / 86400000);

    if (days === 0) return 'Last Updated: Today';
    if (days === 1) return 'Last Updated: Yesterday';
    if (days < 7) return "Last Updated: " + days + 'd ago';
    if (days < 30) return "Last Updated: " + Math.floor(days / 7) + 'w ago';
    if (days < 365) return "Last Updated: " + Math.floor(days / 30) + 'mo ago';
    return "Last Updated: " + Math.floor(days / 365) + 'y ago';
}



function buildFileCardHtml(file, isLcpImage) {
    const escapedName = escapeHtml(file.name.replace('.pdf', ''));
    const escapedSize = escapeHtml(file.size);
    const relativeDate = getRelativeDate(file.modifiedTime);
    const dateHtml = relativeDate ? '<span class="note-size">' + relativeDate + '</span>' : '';
    const fileJson = JSON.stringify({ ...file, folderId: currentFolderId }).replace(/'/g, '&#39;');
    const imageLoadingAttrs = isLcpImage ? 'fetchpriority="high"' : 'loading="lazy"';

    const thumbnailHtml = file.thumbnailUrl
        ? '<div class="note-thumb thumbnail-shell bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden mb-3">' +
        '<img src="' + escapeHtml(file.thumbnailUrl) + '" alt="' + escapedName + '" width="320" height="180" class="w-full h-full object-cover object-top" ' + imageLoadingAttrs + ' decoding="async" onerror="this.parentElement.innerHTML=\'<div class=\\\'flex items-center justify-center h-full text-red-400\\\'><svg class=\\\'w-12 h-12\\\' fill=\\\'currentColor\\\' viewBox=\\\'0 0 24 24\\\'><path d=\\\'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z\\\'/><path d=\\\'M14 2v6h6\\\'/></svg></div>\'">' +
        '</div>'
        : '<div class="note-thumb note-fallback thumbnail-shell bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden mb-3 flex items-center justify-center text-red-400">' +
        '<svg class="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>' +
        '</div>';

    return '<div class="file-card note-card cursor-pointer bg-white dark:bg-slate-900 p-3 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:shadow-xl hover:border-primary-400 transition-all group active:scale-[0.98]" data-file=\'' + fileJson + '\'>' +
        thumbnailHtml +
        '<div class="note-body px-1">' +
        '<h4 class="note-title font-bold dark:text-white text-sm sm:text-base leading-tight">' + escapedName + '</h4>' +
        '<div class="note-meta">' +
        '<span class="note-size">' +
        '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 2v6h6"/></svg>' +
        escapedSize +
        '</span>' +
        dateHtml +
        '<span class="note-open">' +
        'Open' +
        '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>' +
        '</span>' +
        '</div>' +
        '</div>' +
        '</div>';
}

function handleFileClick(e) {
    const folderCard = e.target.closest('.folder-card');
    if (folderCard && folderCard.dataset.folderId) {
        selectFolder(folderCard.dataset.folderId, folderCard.dataset.folderName);
        return;
    }

    const card = e.target.closest('.file-card');
    if (card) openPdf(JSON.parse(card.dataset.file));
}

// --- MODAL ENGINE (Google Drive PDF Viewer - Mobile Optimized) ---
function openPdf(file, options = {}) {
    if (!file || typeof file !== 'object') {
        console.error('Invalid file data');
        return;
    }

    document.body.classList.add('modal-open');
    elements.pdfModal.classList.remove('hidden');
    elements.pdfTitle.textContent = file.name || 'Unknown';

    // Store file data for download handler
    elements.pdfDownload.dataset.fileId = file.id;
    elements.pdfDownload.dataset.fileName = file.name || 'document.pdf';
    elements.pdfDownload.href = '#'; // Prevent default navigation
    elements.pdfDownload.removeAttribute('download'); // Remove download attr, handled via JS

    // Reset viewer state
    window.currentPdfFile = file;
    elements.pdfLoading.classList.remove('hidden');
    elements.pdfIframe.classList.add('hidden');
    const pdfError = document.getElementById('pdfError');
    if (pdfError) pdfError.classList.add('hidden');
    elements.pdfIframe.src = '';

    // Prefer in-app stream preview first. If it takes too long, fall back to Drive preview.
    const streamPreviewUrl = file.viewUrl || `${API_BASE}/pdf/${encodeURIComponent(file.id)}`;

    elements.pdfIframe.onerror = () => showPdfError(file);
    elements.pdfIframe.src = streamPreviewUrl;

    if (pdfLoadFallbackTimer) {
        clearTimeout(pdfLoadFallbackTimer);
    }
    pdfLoadFallbackTimer = setTimeout(() => {
        if (!elements.pdfModal.classList.contains('hidden') && elements.pdfIframe.classList.contains('hidden')) {
            showPdfError(file);
        }
    }, 15000);

    function showPdfError(file) {
        elements.pdfLoading.classList.add('hidden');
        if (pdfError) {
            pdfError.classList.remove('hidden');
            const driveLink = document.getElementById('pdfOpenInDrive');
            if (driveLink) driveLink.href = `https://drive.google.com/file/d/${file.id}/view`;
        }
    }

    const folderForUrl = currentFolderId || file.folderId || null;
    if (!options.skipHistoryPush) {
        pushFileState(folderForUrl, file.id);
    } else if (!options.skipUrlSync) {
        replaceUrlState(folderForUrl, file.id);
    }
}

/**
 * Closes the PDF modal viewer, stops active streams, and resets browser URL/history state.
 *
 * @param {boolean|Event} [fromPopState=false] - True if triggered by a browser popstate navigation.
 * @returns {void}
 */
function closePdf(fromPopState) {
    if (pdfLoadFallbackTimer) {
        clearTimeout(pdfLoadFallbackTimer);
        pdfLoadFallbackTimer = null;
    }
    document.body.classList.remove('modal-open');
    elements.pdfModal.classList.add('hidden');
    elements.pdfLoading.classList.add('hidden');
    elements.pdfIframe.classList.add('hidden');
    elements.pdfIframe.src = ''; // Clear iframe to stop loading/playing

    // If closed via X button, Escape, or backdrop (not from browser back), pop or reset history
    const isFromPopState = fromPopState === true;
    if (!isFromPopState) {
        if (history.state && history.state.pdfOpen) {
            history.back();
        } else {
            replaceUrlState(currentFolderId, null);
        }
    }
}

// --- DOWNLOAD ENGINE (fetch+blob for reliable mobile download) ---
async function handleDownloadClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const fileId = elements.pdfDownload.dataset.fileId;
    const fileName = elements.pdfDownload.dataset.fileName || 'document.pdf';

    if (!fileId) return;

    // Show downloading state on button
    const btn = elements.pdfDownload;
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<svg class="w-3 h-3 sm:w-4 sm:h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg><span>DOWNLOADING...</span>';
    btn.style.pointerEvents = 'none';

    try {
        // Fetch PDF bytes through our server (bypasses Google account picker on mobile)
        const res = await fetch(API_BASE + '/download/' + fileId, {
            headers: { 'Accept': 'application/json, application/pdf, */*' }
        });
        const contentType = (res.headers.get('content-type') || '').toLowerCase();

        // Check for JSON response (either oversized file or API error)
        if (contentType.includes('application/json')) {
            const data = await res.json();
            if (data && data.oversized && (data.downloadUrl || data.fallbackUrl)) {
                // Large file exceeds serverless function payload limit (6MB Lambda limit):
                // Trigger direct download from Google Drive
                const targetUrl = data.downloadUrl || data.fallbackUrl;
                const a = document.createElement('a');
                a.href = targetUrl;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    if (document.body.contains(a)) document.body.removeChild(a);
                }, 100);
                return;
            }
            if (!res.ok) {
                throw new Error(data.error || data.errorMessage || 'Download failed');
            }
        }

        if (!res.ok) {
            let message = 'Download failed';
            try {
                const errorText = await res.text();
                if (errorText) {
                    try {
                        const parsed = JSON.parse(errorText);
                        message = parsed.errorMessage || parsed.error || message;
                    } catch (_) {
                        message = errorText;
                    }
                }
            } catch (_) {
                // Ignore parse errors and keep fallback message
            }
            throw new Error(message);
        }

        if (!contentType.includes('application/pdf')) {
            throw new Error('Invalid file format received');
        }

        const blob = await res.blob();
        if (!blob || blob.size === 0) {
            throw new Error('Downloaded file is empty');
        }

        const url = URL.createObjectURL(blob);

        // Create temporary link and trigger download
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();

        // Cleanup
        setTimeout(() => {
            if (document.body.contains(a)) document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    } catch (err) {
        console.error('Download error:', err);
        const errMsg = err?.message || '';
        // If file exceeded serverless size or network failed, fallback directly to Google Drive download
        if (errMsg.includes('ResponseSizeTooLarge') || errMsg.includes('payload size') || errMsg.includes('Failed to fetch')) {
            const directUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;
            window.open(directUrl, '_blank', 'noopener,noreferrer');
            return;
        }
        alert(errMsg || 'Download failed. Please try again.');
    } finally {
        // Restore button state
        btn.innerHTML = originalHTML;
        btn.style.pointerEvents = '';
    }
}

// --- SEARCH ENGINE ---
function handleSearchFocus() {
    const q = elements.searchInput.value.trim();
    if (q.length >= 2 && elements.searchResults.children.length > 0) {
        elements.searchResults.classList.remove('hidden');
        elements.searchInput.setAttribute('aria-expanded', 'true');
    }
}

function handleSearch(e) {
    const q = e.target.value.trim();
    clearTimeout(searchTimeout);
    if (q.length < 2) {
        activeSearchIndex = -1;
        elements.searchInput.removeAttribute('aria-activedescendant');
        elements.searchInput.setAttribute('aria-expanded', 'false');
        elements.searchResults.classList.add('hidden');
        return;
    }

    // Check intermediate frontend cache first
    const cached = getCachedSearchResults(q);
    if (cached) {
        if (cached.length > 0) {
            renderSearchResults(cached);
        } else {
            activeSearchIndex = -1;
            elements.searchInput.removeAttribute('aria-activedescendant');
            elements.searchInput.setAttribute('aria-expanded', 'false');
            elements.searchResults.classList.add('hidden');
        }
        return;
    }

    const debounceTime = isMobile ? 500 : 350;
    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(API_BASE + '/search?q=' + encodeURIComponent(q));
            const data = await res.json();
            if (data.success && data.data.length > 0) {
                const sorted = data.data.sort(naturalSort);
                setCachedSearchResults(q, sorted);
                renderSearchResults(sorted);
            } else {
                setCachedSearchResults(q, []);
                activeSearchIndex = -1;
                elements.searchInput.removeAttribute('aria-activedescendant');
                elements.searchInput.setAttribute('aria-expanded', 'false');
                elements.searchResults.classList.add('hidden');
            }
        } catch (e) { console.error(e); }
    }, debounceTime);
}

function renderSearchResults(results) {
    const html = results.map((f, index) => {
        const escapedName = escapeHtml(f.name);
        const displayName = escapedName.replace(/\.pdf$/i, '');
        const fileJson = JSON.stringify(f).replace(/'/g, '&#39;');
        return '<div id="searchResult-' + index + '" role="option" aria-selected="false" tabindex="-1" class="search-result cursor-pointer p-3 flex items-center gap-3 active:bg-slate-100 dark:active:bg-slate-600" data-file=\'' + fileJson + '\'>' +
            '<span class="search-result-icon" aria-hidden="true"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/></svg></span>' +
            '<span class="search-result-text">' +
            '<span class="search-result-name">' + displayName + '</span>' +
            '<span class="search-result-label">' + escapeHtml(f.breadcrumbLabel || f.folderName || 'PDF note') + '</span>' +
            '</span>' +
            '</div>';
    }).join('');

    requestAnimationFrame(() => {
        activeSearchIndex = -1;
        elements.searchInput.removeAttribute('aria-activedescendant');
        elements.searchResults.removeEventListener('click', handleSearchResultClick);
        elements.searchResults.innerHTML = html;
        elements.searchResults.classList.remove('hidden');
        elements.searchInput.setAttribute('aria-expanded', 'true');
        elements.searchResults.addEventListener('click', handleSearchResultClick, { passive: true });
    });
}

function handleSearchKeydown(e) {
    const results = elements.searchResults.querySelectorAll('.search-result');
    if (!results.length || elements.searchResults.classList.contains('hidden')) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSearchResult((activeSearchIndex + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSearchResult((activeSearchIndex - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        const targetIndex = activeSearchIndex >= 0 ? activeSearchIndex : 0;
        const target = results[targetIndex];
        if (target) {
            const file = JSON.parse(target.dataset.file);
            const openWithFolder = async () => {
                if (file.folderId && file.folderId !== currentFolderId) {
                    const targetFolderName = (file.folderName && file.folderName !== 'Loading...')
                        ? file.folderName
                        : getFolderNameById(file.folderId);
                    await selectFolder(file.folderId, targetFolderName, { skipUrlSync: true });
                }
                openPdf(file);
            };
            openWithFolder().catch(console.error);
        }
    } else if (e.key === 'Escape') {
        activeSearchIndex = -1;
        elements.searchInput.removeAttribute('aria-activedescendant');
        elements.searchInput.setAttribute('aria-expanded', 'false');
        elements.searchResults.classList.add('hidden');
    }
}

function setActiveSearchResult(index) {
    const results = elements.searchResults.querySelectorAll('.search-result');
    if (!results.length) return;

    results.forEach((item, itemIndex) => {
        const isActive = itemIndex === index;
        item.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    activeSearchIndex = index;
    const activeEl = results[activeSearchIndex];
    elements.searchInput.setAttribute('aria-activedescendant', activeEl.id);
    activeEl.scrollIntoView({ block: 'nearest' });
}

function handleSearchResultClick(e) {
    const result = e.target.closest('.search-result');
    if (result) {
        const file = JSON.parse(result.dataset.file);
        const openWithFolder = async () => {
            if (file.folderId && file.folderId !== currentFolderId) {
                const targetFolderName = (file.folderName && file.folderName !== 'Loading...')
                    ? file.folderName
                    : getFolderNameById(file.folderId);
                await selectFolder(file.folderId, targetFolderName, { skipUrlSync: true });
            }
            openPdf(file);
        };
        openWithFolder().catch(console.error);
    }
}

// --- SUPPORT & FEEDBACK ENGINE ---
function openFeedbackModal() {
    if (elements.sidebar && !elements.sidebar.classList.contains('-translate-x-full')) {
        closeSidebar();
    }
    if (elements.feedbackModal) {
        elements.feedbackModal.classList.remove('hidden');
        document.body.classList.add('modal-open');
        clearFeedbackAlert();
    }
}

function closeFeedbackModal() {
    if (elements.feedbackModal) {
        elements.feedbackModal.classList.add('hidden');
        if (elements.pdfModal && elements.pdfModal.classList.contains('hidden')) {
            document.body.classList.remove('modal-open');
        }
        if (elements.feedbackCategoryMenu) {
            elements.feedbackCategoryMenu.classList.add('hidden');
            if (elements.feedbackCategoryChevron) elements.feedbackCategoryChevron.classList.remove('rotate-180');
            if (elements.feedbackCategoryBtn) elements.feedbackCategoryBtn.setAttribute('aria-expanded', 'false');
        }
    }
}

function toggleFeedbackCategoryMenu(e) {
    if (e) e.stopPropagation();
    if (!elements.feedbackCategoryMenu || !elements.feedbackCategoryBtn) return;
    const isHidden = elements.feedbackCategoryMenu.classList.toggle('hidden');
    const isExpanded = !isHidden;
    elements.feedbackCategoryBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    if (elements.feedbackCategoryChevron) {
        elements.feedbackCategoryChevron.classList.toggle('rotate-180', isExpanded);
    }
}

function handleFeedbackCategorySelect(e) {
    const opt = e.target.closest('.feedback-option');
    if (!opt) return;
    e.stopPropagation();

    const val = opt.dataset.value || '';
    if (elements.feedbackCategory) elements.feedbackCategory.value = val;

    if (elements.feedbackCategorySelected) {
        elements.feedbackCategorySelected.innerHTML = opt.innerHTML;
        elements.feedbackCategorySelected.classList.remove('text-slate-400');
        elements.feedbackCategorySelected.classList.add('text-slate-100');
    }

    if (elements.feedbackCategoryMenu) elements.feedbackCategoryMenu.classList.add('hidden');
    if (elements.feedbackCategoryChevron) elements.feedbackCategoryChevron.classList.remove('rotate-180');
    if (elements.feedbackCategoryBtn) elements.feedbackCategoryBtn.setAttribute('aria-expanded', 'false');
    clearFeedbackAlert();
}

function clearFeedbackAlert() {
    if (elements.feedbackAlert) {
        elements.feedbackAlert.className = 'hidden text-xs rounded-xl p-3 items-center gap-2';
        elements.feedbackAlert.innerHTML = '';
    }
}

function showFeedbackAlert(type, message) {
    if (!elements.feedbackAlert) return;
    elements.feedbackAlert.classList.remove('hidden');
    if (type === 'success') {
        elements.feedbackAlert.className = 'flex items-center gap-2 p-3 rounded-xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-medium';
        elements.feedbackAlert.innerHTML = '<svg class="w-4 h-4 shrink-0 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg><span>' + escapeHtml(message) + '</span>';
    } else {
        elements.feedbackAlert.className = 'flex items-center gap-2 p-3 rounded-xl bg-rose-950/80 border border-rose-500/40 text-rose-300 text-xs font-medium';
        elements.feedbackAlert.innerHTML = '<svg class="w-4 h-4 shrink-0 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><span>' + escapeHtml(message) + '</span>';
    }
}

async function handleFeedbackSubmit(e) {
    e.preventDefault();

    const name = (elements.feedbackName ? elements.feedbackName.value : '').trim();
    const email = (elements.feedbackEmail ? elements.feedbackEmail.value : '').trim();
    const category = (elements.feedbackCategory ? elements.feedbackCategory.value : '').trim();
    const message = (elements.feedbackMessage ? elements.feedbackMessage.value : '').trim();

    if (!category) {
        showFeedbackAlert('error', 'Please select a feedback category.');
        if (elements.feedbackCategoryBtn) elements.feedbackCategoryBtn.focus();
        return;
    }

    if (!message || message.length < 3) {
        showFeedbackAlert('error', 'Please write a message before submitting.');
        if (elements.feedbackMessage) elements.feedbackMessage.focus();
        return;
    }

    const submitBtn = elements.feedbackSubmitBtn;
    const submitText = elements.feedbackSubmitText;
    const submitIcon = elements.feedbackSubmitIcon;
    if (submitBtn) submitBtn.disabled = true;
    if (submitText) submitText.textContent = 'Sending...';
    if (submitIcon) submitIcon.classList.add('animate-spin');
    clearFeedbackAlert();

    const payload = {
        name: name || 'EduCrate Student',
        email: email || '',
        category,
        message
    };

    let isSuccess = false;
    let feedbackMsg = '';

    try {
        const res = await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const data = await res.json();
            if (data.success) {
                isSuccess = true;
                feedbackMsg = data.message || 'Thank you! Your feedback has been sent.';
            } else {
                feedbackMsg = data.error || 'Failed to submit feedback.';
            }
        } else {
            // Direct Web3Forms submission fallback
            const fallbackBody = {
                access_key: '59b7bc7b-da8b-400a-bcf1-4357d6e3e81a',
                name: payload.name || 'EduCrate Student',
                email: payload.email || 'no-reply@web3forms.com',
                replyto: payload.email || 'no-reply@web3forms.com',
                subject: '[EduCrate Feedback] ' + payload.category,
                category: payload.category,
                message: payload.message,
                from_name: 'EduCrate Support & Feedback'
            };

            const fallbackRes = await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(fallbackBody)
            });
            const fallbackData = await fallbackRes.json();
            if (fallbackRes.ok && fallbackData.success) {
                isSuccess = true;
                feedbackMsg = 'Thank you! Your feedback has been sent.';
            } else {
                feedbackMsg = (fallbackData && fallbackData.message) || 'Submission failed. Please try again.';
            }
        }
    } catch (err) {
        console.error('Feedback submission error:', err);
        feedbackMsg = 'Network error. Please check your connection and try again.';
    }

    if (submitBtn) submitBtn.disabled = false;
    if (submitText) submitText.textContent = 'Send Feedback';
    if (submitIcon) submitIcon.classList.remove('animate-spin');

    if (isSuccess) {
        showFeedbackAlert('success', feedbackMsg);
        if (elements.feedbackForm) elements.feedbackForm.reset();
        if (elements.feedbackCategory) elements.feedbackCategory.value = '';
        if (elements.feedbackCategorySelected) {
            elements.feedbackCategorySelected.textContent = 'Select a category...';
            elements.feedbackCategorySelected.className = 'flex items-center gap-2 truncate text-slate-400';
        }
        setTimeout(() => {
            closeFeedbackModal();
        }, 1800);
    } else {
        showFeedbackAlert('error', feedbackMsg);
    }
}
