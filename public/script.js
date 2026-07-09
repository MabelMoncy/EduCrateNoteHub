const API_BASE = '/api';
let searchTimeout;
let cachedTree = null;
let cachedFiles = {}; // Cache files per folder for faster navigation
let activeSearchIndex = -1;
let isMobile = window.innerWidth < 768;
let currentFolderId = null; // Track current folder for refresh
let currentFolderName = null; // Track current folder name
let currentSortOrder = 'newToOld'; // Date modified sort order
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
        isMobile = window.innerWidth < 768;
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
    pdfContainer: document.getElementById('pdfContainer'),
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
    pullRefreshIndicator: document.getElementById('pullRefreshIndicator'),
    pullRefreshText: document.getElementById('pullRefreshText'),
    themeColorMeta: document.querySelector('meta[name="theme-color"]'),
    lcpImagePreload: document.getElementById('lcpImagePreload'),
    sortContainer: document.getElementById('sortContainer'),
    sortSelect: document.getElementById('sortSelect')
};

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

function replaceUrlState(folderId, fileId) {
    const url = buildAppUrl(folderId, fileId);
    history.replaceState(history.state, '', url);
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
    elements.closePdfBtn.addEventListener('click', closePdf, { passive: true });
    
    // Download button - uses fetch+blob to force real download on all devices
    elements.pdfDownload.addEventListener('click', handleDownloadClick);

    // Browse Subjects button opens sidebar on mobile, scrolls to first folder on desktop
    elements.browseSubjectsBtn.addEventListener('click', () => {
        if (isMobile) {
            elements.sidebar.classList.remove('-translate-x-full');
            elements.sidebarOverlay.classList.remove('hidden');
        } else {
            // On desktop, click the first folder automatically
            const firstFolder = elements.foldersList.querySelector('.folder-btn');
            if (firstFolder) firstFolder.click();
        }
    }, { passive: true });
    elements.searchInput.addEventListener('input', handleSearch, { passive: true });
    elements.searchInput.addEventListener('keydown', handleSearchKeydown);
    elements.searchInput.addEventListener('focus', handleSearchFocus, { passive: true });

    if (elements.sortSelect) {
        elements.sortSelect.addEventListener('change', handleSortChange, { passive: true });
    }
    
    // Pull-to-refresh for mobile
    setupPullToRefresh();
    
    // Keyboard shortcut to close PDF viewer
    document.addEventListener('keydown', (e) => {
        if (!elements.pdfModal.classList.contains('hidden') && e.key === 'Escape') {
            closePdf();
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
                await selectFolder(folderId, 'Loading...', { skipUrlSync: true });
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
            replaceUrlState(null, null);
            currentFolderId = null;
            currentFolderName = null;
            updateActiveFolderButton();
            stopFilePolling();
            setSortVisibility(false);
            elements.contentHeader.classList.add('hidden');
            elements.filesGrid.innerHTML = '';
            elements.emptyState.classList.add('hidden');
            elements.welcomeState.classList.remove('hidden');
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
            if (item && item.dataset.folderId) {
                selectFolder(item.dataset.folderId, item.dataset.folderName);
            }
        }, { passive: true });
    }
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
    try {
        const res = await fetch(API_BASE + '/tree');
        const data = await res.json();
        if(data.success) {
            cachedTree = data.data;
            renderFolderTree(cachedTree);
            startFolderPolling();
        }
    } catch(e) { console.error(e); }
}

async function ensureFolderSelectedById(folderId, options = {}) {
    if (!folderId) return false;
    if (folderId === currentFolderId && cachedFiles[folderId]) return true;
    await selectFolder(folderId, 'Loading...', options);
    return true;
}

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
            await selectFolder(folderId, 'Loading...', { skipUrlSync: true });
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
                renderFolderTree(cachedTree);
            }
        }
    } catch (e) { console.error('Tree poll error:', e); }
}

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
            
            if (!areFilesEqual(currentCache.files, newFiles) || !areFoldersEqual(currentCache.folders, newFolders)) {
                cachedFiles[currentFolderId] = { folders: newFolders, files: newFiles, breadcrumbs };
                if (newFiles.length > 0 || newFolders.length > 0) {
                    renderFolderContents(newFolders, sortFilesByModified(newFiles));
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

function getModifiedTimestamp(file) {
    const ts = Date.parse(file?.modifiedTime || '');
    return Number.isFinite(ts) ? ts : 0;
}

function sortFilesByModified(files, order = currentSortOrder) {
    const direction = order === 'oldToNew' ? 1 : -1;
    return [...files].sort((a, b) => {
        const timeDiff = getModifiedTimestamp(a) - getModifiedTimestamp(b);
        if (timeDiff !== 0) return timeDiff * direction;
        return naturalSort(a, b);
    });
}

function handleSortChange(e) {
    currentSortOrder = e.target.value === 'oldToNew' ? 'oldToNew' : 'newToOld';

    if (currentFolderId && cachedFiles[currentFolderId]) {
        const cache = cachedFiles[currentFolderId];
        renderFolderContents(cache.folders, sortFilesByModified(cache.files));
    }
}

function setSortVisibility(visible) {
    if (!elements.sortContainer) return;
    elements.sortContainer.classList.toggle('hidden', !visible);
}

function getSubjectIconSvg(name = '') {
    const normalizedName = name.toLowerCase();
    const iconClass = 'w-5 h-5';

    if (normalizedName.includes('dbms') || normalizedName.includes('database')) {
        return '<svg class="' + iconClass + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="7" ry="3" stroke-width="2"/><path d="M5 5v6c0 1.66 3.13 3 7 3s7-1.34 7-3V5" stroke-width="2" stroke-linecap="round"/><path d="M5 11v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" stroke-width="2" stroke-linecap="round"/></svg>';
    }

    if (normalizedName.includes('operating') || normalizedName === 'os' || normalizedName.includes(' os')) {
        return '<svg class="' + iconClass + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2" stroke-width="2"/><path d="M8 20h8M12 16v4" stroke-width="2" stroke-linecap="round"/><path d="M8 8h.01M11 8h.01M14 8h.01" stroke-width="2" stroke-linecap="round"/></svg>';
    }

    if (normalizedName.includes('coa') || normalizedName.includes('architecture')) {
        return '<svg class="' + iconClass + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" stroke-width="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" stroke-width="2" stroke-linecap="round"/><path d="M10 10h4v4h-4z" stroke-width="2"/></svg>';
    }

    if (normalizedName.includes('dsa') || normalizedName.includes('data structure') || normalizedName.includes('algorithm')) {
        return '<svg class="' + iconClass + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 8 4 12l4 4M16 8l4 4-4 4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="m14 5-4 14" stroke-width="2" stroke-linecap="round"/></svg>';
    }

    if (normalizedName.includes('network')) {
        return '<svg class="' + iconClass + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0 1 14.08 0M8.5 16a6 6 0 0 1 7 0M12 20h.01" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 8.82a16 16 0 0 1 20 0" stroke-width="2" stroke-linecap="round"/></svg>';
    }

    if (normalizedName.includes('cyber') || normalizedName.includes('security')) {
        return '<svg class="' + iconClass + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 3 20 7v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7l8-4Z" stroke-width="2" stroke-linejoin="round"/><path d="m9.5 12 1.7 1.7 3.8-4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    if (normalizedName.includes('ai') || normalizedName.includes('ml') || normalizedName.includes('machine') || normalizedName.includes('artificial')) {
        return '<svg class="' + iconClass + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 3a3 3 0 0 0-3 3v1a3 3 0 0 0 0 6v1a3 3 0 0 0 4.5 2.6M15 3a3 3 0 0 1 3 3v1a3 3 0 0 1 0 6v1a3 3 0 0 1-4.5 2.6" stroke-width="2" stroke-linecap="round"/><path d="M12 5v14M8 9h2M14 9h2M8 15h2M14 15h2" stroke-width="2" stroke-linecap="round"/></svg>';
    }

    // Default book icon
    return '<svg class="' + iconClass + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke-width="2" stroke-linecap="round"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" stroke-width="2" stroke-linejoin="round"/></svg>';
}

function renderFolderTree(tree) {
    if (!tree || !tree.children) return;
    
    const expandedIds = new Set();
    document.querySelectorAll('.tree-item.is-expanded > .tree-toggle').forEach(el => {
        expandedIds.add(el.dataset.folderId);
    });

    function isParentOfCurrent(node) {
        if (node.id === currentFolderId) return true;
        if (node.children) {
            return node.children.some(isParentOfCurrent);
        }
        return false;
    }

    function buildTreeHtml(node, level = 0) {
        if (!node.children || node.children.length === 0) {
            return '<li class="tree-item">' +
                    '<button class="tree-toggle tree-leaf ' + (node.id === currentFolderId ? 'is-active' : '') + '" data-folder-id="' + escapeHtml(node.id) + '" data-folder-name="' + escapeHtml(node.name) + '" style="padding-left: ' + (level * 0.75 + 0.5) + 'rem">' +
                        '<span class="tree-icon">' + getSubjectIconSvg(node.name) + '</span>' +
                        '<span class="tree-label">' + escapeHtml(node.name) + '</span>' +
                    '</button>' +
                '</li>';
        }

        const isExpanded = expandedIds.has(node.id) || isParentOfCurrent(node);
        const childrenHtml = node.children.map(child => buildTreeHtml(child, level + 1)).join('');
        
        return '<li class="tree-item ' + (isExpanded ? 'is-expanded' : '') + '">' +
                '<button class="tree-toggle ' + (node.id === currentFolderId ? 'is-active' : '') + '" data-folder-id="' + escapeHtml(node.id) + '" data-folder-name="' + escapeHtml(node.name) + '" style="padding-left: ' + (level * 0.75 + 0.5) + 'rem">' +
                    '<span class="tree-chevron flex items-center justify-center">' +
                        '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9 5l7 7-7 7"/></svg>' +
                    '</span>' +
                    '<span class="tree-icon">' + getSubjectIconSvg(node.name) + '</span>' +
                    '<span class="tree-label">' + escapeHtml(node.name) + '</span>' +
                '</button>' +
                '<ul class="tree-children ' + (isExpanded ? '' : 'hidden') + '">' +
                    childrenHtml +
                '</ul>' +
            '</li>';
    }

    const html = '<ul class="tree-list">' + tree.children.map(child => buildTreeHtml(child, 0)).join('') + '</ul>';
    
    requestAnimationFrame(() => {
        elements.foldersList.removeEventListener('click', handleTreeClick);
        elements.foldersList.innerHTML = html;
        elements.foldersList.addEventListener('click', handleTreeClick, { passive: true });
        expandedIds.add('initial');
    });
}

function updateActiveFolderButton() {
    const buttons = elements.foldersList.querySelectorAll('.tree-toggle');
    buttons.forEach(btn => {
        const isActive = btn.dataset.folderId === currentFolderId;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-current', isActive ? 'page' : 'false');
        
        if (isActive) {
            let parentItem = btn.closest('.tree-children')?.closest('.tree-item');
            while (parentItem) {
                parentItem.classList.add('is-expanded');
                parentItem.querySelector('.tree-children').classList.remove('hidden');
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
            treeItem.classList.add('is-expanded');
            childrenList.classList.remove('hidden');
        }
        return;
    }

    selectFolder(toggleBtn.dataset.folderId, toggleBtn.dataset.folderName);
}

async function selectFolder(id, name, options = {}) {
    currentFolderId = id; // Track for refresh
    currentFolderName = name; // Track for refresh
    updateActiveFolderButton();
    elements.welcomeState.classList.add('hidden');
    elements.contentHeader.classList.remove('hidden');
    setSortVisibility(true);
    if (elements.sortSelect) {
        elements.sortSelect.value = currentSortOrder;
    }
    elements.contentTitle.textContent = name;
    elements.emptyState.classList.add('hidden');
    updateLcpImagePreload(null);
    if (!options.skipUrlSync) {
        replaceUrlState(id, null);
    }

    if (isMobile) {
        closeSidebar();
    }

    renderSkeletons();

    if (cachedFiles[id]) {
        const cache = cachedFiles[id];
        elements.contentTitle.textContent = cache.folderName || name;
        renderFolderContents(cache.folders, sortFilesByModified(cache.files));
        renderBreadcrumbs(cache.breadcrumbs);
        // Start polling after initial render is done
        startFilePolling();
        return;
    }

    try {
        const res = await fetch(API_BASE + '/folder-contents/' + id);
        const data = await res.json();
        if(data.success) {
            const { folders, files, breadcrumbs, folderName } = data.data;
            cachedFiles[id] = { folders, files, breadcrumbs, folderName };
            if (id === currentFolderId) {
                elements.contentTitle.textContent = folderName;
                renderFolderContents(folders, sortFilesByModified(files));
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
            }
        }
    } catch(e) { 
        console.error(e);
        if (id === currentFolderId) {
            elements.filesGrid.innerHTML = '';
            elements.emptyState.classList.remove('hidden');
        }
    }
}

// --- PULL-TO-REFRESH ENGINE ---
function setupPullToRefresh() {
    let startY = 0;
    let currentY = 0;
    let pulling = false;
    let isRefreshing = false;
    const PULL_THRESHOLD = 80;
    const mainEl = document.querySelector('main');
    
    mainEl.addEventListener('touchstart', (e) => {
        // Only activate when scrolled to top and not in modal
        if (window.scrollY > 5 || isRefreshing || !elements.pdfModal.classList.contains('hidden')) return;
        startY = e.touches[0].clientY;
        pulling = true;
    }, { passive: true });
    
    mainEl.addEventListener('touchmove', (e) => {
        if (!pulling || isRefreshing) return;
        currentY = e.touches[0].clientY;
        const pullDistance = currentY - startY;
        
        if (pullDistance < 0) { pulling = false; return; }
        
        // Show indicator proportional to pull distance
        const progress = Math.min(pullDistance / PULL_THRESHOLD, 1);
        const translateY = Math.min(pullDistance * 0.5, 50) - 60;
        elements.pullRefreshIndicator.style.transform = `translateX(-50%) translateY(${translateY}px)`;
        elements.pullRefreshIndicator.classList.add('visible');
        
        if (progress >= 1) {
            elements.pullRefreshText.textContent = 'Release to refresh';
        } else {
            elements.pullRefreshText.textContent = 'Pull to refresh';
        }
    }, { passive: true });
    
    mainEl.addEventListener('touchend', async () => {
        if (!pulling || isRefreshing) return;
        const pullDistance = currentY - startY;
        pulling = false;
        
        if (pullDistance >= PULL_THRESHOLD) {
            // Trigger refresh
            isRefreshing = true;
            elements.pullRefreshIndicator.classList.add('refreshing');
            elements.pullRefreshText.textContent = 'Refreshing...';
            elements.pullRefreshIndicator.style.transform = 'translateX(-50%) translateY(0px)';
            
            await performFullRefresh();
            
            // Delay hiding for visual feedback
            setTimeout(() => {
                isRefreshing = false;
                hideRefreshIndicator();
            }, 500);
        } else {
            hideRefreshIndicator();
        }
        
        startY = 0;
        currentY = 0;
    }, { passive: true });
}

function hideRefreshIndicator() {
    elements.pullRefreshIndicator.classList.remove('visible', 'refreshing');
    elements.pullRefreshIndicator.style.transform = 'translateX(-50%) translateY(-60px)';
    elements.pullRefreshText.textContent = 'Pull to refresh';
}

async function performFullRefresh() {
    // Refresh folders
    try {
        const folderRes = await fetch(API_BASE + '/tree', { headers: { 'Cache-Control': 'no-cache' } });
        const folderData = await folderRes.json();
        if (folderData.success) {
            cachedTree = folderData.data;
            renderFolderTree(cachedTree);
        }
    } catch (e) { console.error('Refresh folders error:', e); }
    
    // Refresh current folder's files if viewing one
    if (currentFolderId) {
        delete cachedFiles[currentFolderId];
        try {
            const res = await fetch(API_BASE + '/folder-contents/' + currentFolderId, {
                headers: { 'Cache-Control': 'no-cache' }
            });
            const data = await res.json();
            if (data.success) {
                const { folders, files, breadcrumbs, folderName } = data.data;
                cachedFiles[currentFolderId] = { folders, files, breadcrumbs, folderName };
                renderFolderContents(folders, sortFilesByModified(files));
                renderBreadcrumbs(breadcrumbs);
                if (folders.length > 0 || files.length > 0) {
                    elements.emptyState.classList.add('hidden');
                } else {
                    elements.filesGrid.innerHTML = '';
                    elements.emptyState.classList.remove('hidden');
                }
            }
        } catch (e) {
            console.error('Refresh files error:', e);
        }
    }
}

function renderSkeletons() {
    const skeletonCount = isMobile ? 2 : 3;
    elements.filesGrid.innerHTML = Array.from({ length: skeletonCount }, () =>
        '<div class="file-skeleton p-3 sm:p-4">' +
            '<div class="thumbnail-shell shimmer rounded-xl mb-3"></div>' +
            '<div class="h-4 shimmer rounded mb-2"></div>' +
            '<div class="h-3 w-20 shimmer rounded"></div>' +
        '</div>'
    ).join('');
}

function buildFolderCardHtml(folder) {
    return '<div class="folder-card" data-folder-id="' + escapeHtml(folder.id) + '" data-folder-name="' + escapeHtml(folder.name) + '">' +
        '<div class="folder-card-icon">' +
            '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>' +
        '</div>' +
        '<div class="folder-card-name">' + escapeHtml(folder.name) + '</div>' +
    '</div>';
}

function renderBreadcrumbs(breadcrumbs) {
    const nav = document.getElementById('breadcrumbTrail');
    if (!nav) return;
    
    if (!breadcrumbs || breadcrumbs.length === 0) {
        nav.innerHTML = '';
        return;
    }

    const html = breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1;
        if (isLast) {
            return '<span class="breadcrumb-item cursor-default text-primary-600 dark:text-primary-400 font-bold">' + escapeHtml(crumb.name) + '</span>';
        }
        return '<span class="breadcrumb-item" data-folder-id="' + escapeHtml(crumb.id) + '" data-folder-name="' + escapeHtml(crumb.name) + '">' + escapeHtml(crumb.name) + '</span>' +
               '<span class="breadcrumb-separator">›</span>';
    }).join('');
    
    nav.innerHTML = html;
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

function buildFileCardHtml(file, isLcpImage) {
    const escapedName = escapeHtml(file.name.replace('.pdf', ''));
    const escapedSize = escapeHtml(file.size);
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
    elements.pdfLoading.classList.remove('hidden');
    elements.pdfIframe.classList.add('hidden');
    elements.pdfIframe.src = '';

    // Prefer in-app stream preview first. If it takes too long, fall back to Drive preview.
    const streamPreviewUrl = file.viewUrl || `${API_BASE}/pdf/${encodeURIComponent(file.id)}`;
    const drivePreviewUrl = `${API_BASE}/view/${encodeURIComponent(file.id)}`;
    elements.pdfIframe.src = streamPreviewUrl;

    if (pdfLoadFallbackTimer) {
        clearTimeout(pdfLoadFallbackTimer);
    }
    pdfLoadFallbackTimer = setTimeout(() => {
        if (!elements.pdfModal.classList.contains('hidden') && elements.pdfIframe.classList.contains('hidden')) {
            elements.pdfIframe.src = drivePreviewUrl;
        }
    }, 8000);

    const folderForUrl = currentFolderId || file.folderId || null;
    if (!options.skipHistoryPush) {
        pushFileState(folderForUrl, file.id);
    } else if (!options.skipUrlSync) {
        replaceUrlState(folderForUrl, file.id);
    }
}

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
    
    // If closed via X button or Escape (not from back swipe), pop the history entry we pushed
    if (!fromPopState) {
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
        const res = await fetch(API_BASE + '/download/' + fileId);
        const contentType = (res.headers.get('content-type') || '').toLowerCase();

        if (!res.ok) {
            let message = 'Download failed';
            try {
                if (contentType.includes('application/json')) {
                    const errorData = await res.json();
                    message = errorData.error || message;
                } else {
                    const errorText = await res.text();
                    if (errorText) message = errorText;
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
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    } catch (err) {
        console.error('Download error:', err);
        alert(err.message || 'Download failed. Please try again.');
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
    if(q.length < 2) { 
        activeSearchIndex = -1;
        elements.searchInput.removeAttribute('aria-activedescendant');
        elements.searchInput.setAttribute('aria-expanded', 'false');
        elements.searchResults.classList.add('hidden'); 
        return; 
    }
    const debounceTime = isMobile ? 600 : 400;
    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(API_BASE + '/search?q=' + encodeURIComponent(q));
            const data = await res.json();
            if(data.success && data.data.length > 0) {
                renderSearchResults(data.data.sort(naturalSort));
            } else {
                activeSearchIndex = -1;
                elements.searchInput.removeAttribute('aria-activedescendant');
                elements.searchInput.setAttribute('aria-expanded', 'false');
                elements.searchResults.classList.add('hidden');
            }
        } catch(e) { console.error(e); }
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
                '<span class="search-result-label">PDF note</span>' +
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
        if (target) openPdf(JSON.parse(target.dataset.file));
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
    if (result) openPdf(JSON.parse(result.dataset.file));
}
