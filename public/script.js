const API_BASE = '/api';
let searchTimeout;
let cachedFolders = null;
let cachedFiles = {}; // Cache files per folder for faster navigation
let isMobile = window.innerWidth < 768;
let currentFolderId = null; // Track current folder for refresh
let currentFolderName = null; // Track current folder name
let folderPollTimer = null; // Auto-poll timer for folders
let filePollTimer = null; // Auto-poll timer for files
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
    pullRefreshText: document.getElementById('pullRefreshText')
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadFolders();
    setupEventListeners();
});

function setupEventListeners() {
    // Sidebar Toggle - passive listeners for better scroll performance
    elements.menuBtn.addEventListener('click', () => {
        elements.sidebar.classList.remove('-translate-x-full');
        elements.sidebarOverlay.classList.remove('hidden');
    }, { passive: true });

    elements.sidebarOverlay.addEventListener('click', () => {
        elements.sidebar.classList.add('-translate-x-full');
        elements.sidebarOverlay.classList.add('hidden');
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
    
    // Pull-to-refresh for mobile
    setupPullToRefresh();
    
    // Keyboard shortcut to close PDF viewer
    document.addEventListener('keydown', (e) => {
        if (!elements.pdfModal.classList.contains('hidden') && e.key === 'Escape') {
            closePdf();
        }
    });
    
    // Hide loading when iframe loads
    elements.pdfIframe.addEventListener('load', () => {
        elements.pdfLoading.classList.add('hidden');
        elements.pdfIframe.classList.remove('hidden');
    });
    
    // Handle browser back button / swipe-back to close PDF modal
    window.addEventListener('popstate', (e) => {
        if (!elements.pdfModal.classList.contains('hidden')) {
            closePdf(true); // true = already popped, don't pop again
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
            pollFolders();
            if (currentFolderId) {
                startFilePolling();
                pollFiles();
            }
        }
    });
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
            elements.searchResults.classList.add('hidden');
        }
    });
}

// --- THEME ENGINE ---
function initTheme() {
    const isDark = localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', isDark);
    updateThemeIcons(isDark);
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.theme = isDark ? 'dark' : 'light';
    updateThemeIcons(isDark);
}

function updateThemeIcons(isDark) {
    elements.sunIcon.classList.toggle('hidden', !isDark);
    elements.moonIcon.classList.toggle('hidden', isDark);
}

// --- DATA ENGINE ---
async function loadFolders() {
    if (cachedFolders) {
        renderFolders(cachedFolders);
        startFolderPolling(); // Start polling even if cached
        return;
    }
    try {
        const res = await fetch(API_BASE + '/folders');
        const data = await res.json();
        if(data.success) {
            cachedFolders = data.data.sort(naturalSort);
            renderFolders(cachedFolders);
            startFolderPolling();
        }
    } catch(e) { console.error(e); }
}

// --- AUTO-SYNC POLLING ENGINE ---
function startFolderPolling() {
    if (folderPollTimer) clearInterval(folderPollTimer);
    folderPollTimer = setInterval(pollFolders, FOLDER_POLL_INTERVAL);
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

async function pollFolders() {
    try {
        const res = await fetch(API_BASE + '/folders', {
            headers: { 'Cache-Control': 'no-cache' }
        });
        const data = await res.json();
        if (data.success) {
            const newFolders = data.data.sort(naturalSort);
            if (!areFoldersEqual(cachedFolders, newFolders)) {
                cachedFolders = newFolders;
                renderFolders(cachedFolders);
                // If a folder was deleted that we're currently viewing, go back to welcome
                if (currentFolderId && !newFolders.find(f => f.id === currentFolderId)) {
                    currentFolderId = null;
                    currentFolderName = null;
                    stopFilePolling();
                    elements.contentHeader.classList.add('hidden');
                    elements.filesGrid.innerHTML = '';
                    elements.emptyState.classList.add('hidden');
                    elements.welcomeState.classList.remove('hidden');
                }
            }
        }
    } catch (e) { console.error('Folder poll error:', e); }
}

async function pollFiles() {
    if (!currentFolderId) return;
    try {
        const res = await fetch(API_BASE + '/files/' + currentFolderId, {
            headers: { 'Cache-Control': 'no-cache' }
        });
        const data = await res.json();
        if (data.success) {
            const newFiles = data.data.sort(naturalSort);
            if (!areFilesEqual(cachedFiles[currentFolderId], newFiles)) {
                cachedFiles[currentFolderId] = newFiles;
                if (newFiles.length > 0) {
                    renderFiles(newFiles);
                    elements.emptyState.classList.add('hidden');
                } else {
                    elements.filesGrid.innerHTML = '';
                    elements.emptyState.classList.remove('hidden');
                }
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
        if (a[i].id !== b[i].id || a[i].name !== b[i].name || a[i].size !== b[i].size) return false;
    }
    return true;
}

function renderFolders(folders) {
    const html = folders.map(f => 
        '<button data-folder-id="' + escapeHtml(f.id) + '" data-folder-name="' + escapeHtml(f.name) + '" class="folder-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-slate-600 dark:text-slate-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-600 transition-all group active:scale-[0.98]">' +
            '<svg class="w-5 h-5 opacity-50 group-hover:opacity-100 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>' +
            '<span class="font-medium text-sm truncate">' + escapeHtml(f.name) + '</span>' +
        '</button>'
    ).join('');
    
    requestAnimationFrame(() => {
        elements.foldersList.removeEventListener('click', handleFolderClick);
        elements.foldersList.innerHTML = html;
        elements.foldersList.addEventListener('click', handleFolderClick, { passive: true });
    });
}

function handleFolderClick(e) {
    const btn = e.target.closest('.folder-btn');
    if (btn) selectFolder(btn.dataset.folderId, btn.dataset.folderName);
}

async function selectFolder(id, name) {
    currentFolderId = id; // Track for refresh
    currentFolderName = name; // Track for refresh
    elements.welcomeState.classList.add('hidden');
    elements.contentHeader.classList.remove('hidden');
    elements.contentTitle.textContent = name;
    elements.emptyState.classList.add('hidden');
    
    // Start polling files for this folder
    startFilePolling();

    if (isMobile) {
        elements.sidebar.classList.add('-translate-x-full');
        elements.sidebarOverlay.classList.add('hidden');
    }

    if (cachedFiles[id]) {
        renderFiles(cachedFiles[id]);
        return;
    }

    elements.filesGrid.innerHTML = '<div class="h-32 shimmer rounded-2xl"></div>'.repeat(isMobile ? 2 : 3);

    try {
        const res = await fetch(API_BASE + '/files/' + id);
        const data = await res.json();
        if(data.success && data.data.length > 0) {
            const sortedFiles = data.data.sort(naturalSort);
            cachedFiles[id] = sortedFiles;
            renderFiles(sortedFiles);
        } else {
            elements.filesGrid.innerHTML = '';
            elements.emptyState.classList.remove('hidden');
        }
    } catch(e) { 
        console.error(e);
        elements.filesGrid.innerHTML = '';
        elements.emptyState.classList.remove('hidden');
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
        const folderRes = await fetch(API_BASE + '/folders', { headers: { 'Cache-Control': 'no-cache' } });
        const folderData = await folderRes.json();
        if (folderData.success) {
            cachedFolders = folderData.data.sort(naturalSort);
            renderFolders(cachedFolders);
        }
    } catch (e) { console.error('Refresh folders error:', e); }
    
    // Refresh current folder's files if viewing one
    if (currentFolderId) {
        delete cachedFiles[currentFolderId];
        try {
            const res = await fetch(API_BASE + '/files/' + currentFolderId, {
                headers: { 'Cache-Control': 'no-cache' }
            });
            const data = await res.json();
            if (data.success && data.data.length > 0) {
                const sortedFiles = data.data.sort(naturalSort);
                cachedFiles[currentFolderId] = sortedFiles;
                renderFiles(sortedFiles);
                elements.emptyState.classList.add('hidden');
            } else {
                elements.filesGrid.innerHTML = '';
                elements.emptyState.classList.remove('hidden');
            }
        } catch (e) {
            console.error('Refresh files error:', e);
        }
    }
}

function renderFiles(files) {
    const html = files.map(f => {
        const escapedName = escapeHtml(f.name.replace('.pdf', ''));
        const escapedSize = escapeHtml(f.size);
        const fileJson = JSON.stringify(f).replace(/'/g, '&#39;');
        
        const thumbnailHtml = f.thumbnailUrl 
            ? '<div class="w-full aspect-[16/9] bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden mb-3">' +
                '<img src="' + escapeHtml(f.thumbnailUrl) + '" alt="' + escapedName + '" class="w-full h-full object-cover object-top" loading="lazy" decoding="async" onerror="this.parentElement.innerHTML=\'<div class=\\\'flex items-center justify-center h-full text-red-400\\\'><svg class=\\\'w-12 h-12\\\' fill=\\\'currentColor\\\' viewBox=\\\'0 0 24 24\\\'><path d=\\\'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z\\\'/><path d=\\\'M14 2v6h6\\\'/></svg></div>\'">' +
              '</div>'
            : '<div class="w-full aspect-[16/9] bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden mb-3 flex items-center justify-center text-red-400">' +
                '<svg class="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>' +
              '</div>';
        
        return '<div class="file-card cursor-pointer bg-white dark:bg-slate-900 p-3 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:shadow-xl hover:border-primary-400 transition-all group active:scale-[0.98]" data-file=\'' + fileJson + '\'>' +
            thumbnailHtml +
            '<div class="px-1">' +
                '<h4 class="font-bold dark:text-white truncate mb-1 text-sm sm:text-base leading-tight">' + escapedName + '</h4>' +
                '<p class="text-xs text-slate-400 font-medium">' + escapedSize + '</p>' +
            '</div>' +
        '</div>';
    }).join('');
    
    requestAnimationFrame(() => {
        elements.filesGrid.removeEventListener('click', handleFileClick);
        elements.filesGrid.innerHTML = html;
        elements.filesGrid.addEventListener('click', handleFileClick, { passive: true });
    });
}

function handleFileClick(e) {
    const card = e.target.closest('.file-card');
    if (card) openPdf(JSON.parse(card.dataset.file));
}

// --- MODAL ENGINE (Google Drive PDF Viewer - Mobile Optimized) ---
function openPdf(file) {
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
    
    // Use the proxied PDF stream so previews work without public Drive sharing
    const previewUrl = file.viewUrl || (API_BASE + '/pdf/' + file.id);
    elements.pdfIframe.src = previewUrl;
    
    // Push history state so back button/swipe closes the modal instead of leaving the site
    history.pushState({ pdfOpen: true }, '');
}

function closePdf(fromPopState) {
    document.body.classList.remove('modal-open');
    elements.pdfModal.classList.add('hidden');
    elements.pdfLoading.classList.add('hidden');
    elements.pdfIframe.classList.add('hidden');
    elements.pdfIframe.src = ''; // Clear iframe to stop loading/playing
    
    // If closed via X button or Escape (not from back swipe), pop the history entry we pushed
    if (!fromPopState && history.state && history.state.pdfOpen) {
        history.back();
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
        
        if (!res.ok) throw new Error('Download failed');
        
        const blob = await res.blob();
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
        alert('Download failed. Please try again.');
    } finally {
        // Restore button state
        btn.innerHTML = originalHTML;
        btn.style.pointerEvents = '';
    }
}

// --- SEARCH ENGINE ---
function handleSearch(e) {
    const q = e.target.value.trim();
    clearTimeout(searchTimeout);
    if(q.length < 2) { 
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
                elements.searchResults.classList.add('hidden');
            }
        } catch(e) { console.error(e); }
    }, debounceTime);
}

function renderSearchResults(results) {
    const html = results.map(f => {
        const escapedName = escapeHtml(f.name);
        const fileJson = JSON.stringify(f).replace(/'/g, '&#39;');
        return '<div class="search-result cursor-pointer p-3 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-3 border-b border-slate-100 dark:border-slate-700 last:border-0 transition-colors active:bg-slate-100 dark:active:bg-slate-600" data-file=\'' + fileJson + '\'>' +
            '<svg class="w-4 h-4 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/></svg>' +
            '<span class="text-xs font-medium dark:text-slate-200 truncate">' + escapedName + '</span>' +
        '</div>';
    }).join('');
    
    requestAnimationFrame(() => {
        elements.searchResults.removeEventListener('click', handleSearchResultClick);
        elements.searchResults.innerHTML = html;
        elements.searchResults.classList.remove('hidden');
        elements.searchResults.addEventListener('click', handleSearchResultClick, { passive: true });
    });
}

function handleSearchResultClick(e) {
    const result = e.target.closest('.search-result');
    if (result) openPdf(JSON.parse(result.dataset.file));
}
