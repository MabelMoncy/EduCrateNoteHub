const API_BASE = '/api';
let searchTimeout;
let cachedFolders = null;
let cachedFiles = {}; // Cache files per folder for faster navigation
let isMobile = window.innerWidth < 768;

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
function naturalSort(a, b) {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return collator.compare(a.name, b.name);
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
    pdfViewer: document.getElementById('pdfViewer'),
    pdfLoading: document.getElementById('pdfLoading'),
    closePdfBtn: document.getElementById('closePdfBtn'),
    pdfDownload: document.getElementById('pdfDownload'),
    mobileViewBtn: document.getElementById('mobileViewBtn'),
    mobileViewOptions: document.getElementById('mobileViewOptions'),
    logoContainer: document.getElementById('logoContainer'),
    mobileSearchTrigger: document.getElementById('mobileSearchTrigger'),
    searchBarContainer: document.getElementById('searchBarContainer'),
    closeSearchBtn: document.getElementById('closeSearchBtn'),
    rightNav: document.getElementById('rightNav'),
    searchInput: document.getElementById('searchInput'),
    searchResults: document.getElementById('searchResults'),
    browseSubjectsBtn: document.getElementById('browseSubjectsBtn')
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
    if (cachedFolders) return renderFolders(cachedFolders);
    try {
        const res = await fetch(API_BASE + '/folders');
        const data = await res.json();
        if(data.success) {
            cachedFolders = data.data.sort(naturalSort);
            renderFolders(cachedFolders);
        }
    } catch(e) { console.error(e); }
}

function renderFolders(folders) {
    const html = folders.map(f => 
        '<button data-folder-id="' + escapeHtml(f.id) + '" data-folder-name="' + escapeHtml(f.name) + '" class="folder-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-slate-600 dark:text-slate-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-600 transition-all group active:scale-[0.98]">' +
            '<svg class="w-5 h-5 opacity-50 group-hover:opacity-100 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>' +
            '<span class="font-medium text-sm truncate">' + escapeHtml(f.name) + '</span>' +
        '</button>'
    ).join('');
    
    requestAnimationFrame(() => {
        elements.foldersList.innerHTML = html;
        elements.foldersList.addEventListener('click', handleFolderClick, { passive: true });
    });
}

function handleFolderClick(e) {
    const btn = e.target.closest('.folder-btn');
    if (btn) selectFolder(btn.dataset.folderId, btn.dataset.folderName);
}

async function selectFolder(id, name) {
    elements.welcomeState.classList.add('hidden');
    elements.contentHeader.classList.remove('hidden');
    elements.contentTitle.textContent = name;
    elements.emptyState.classList.add('hidden');

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

function renderFiles(files) {
    const html = files.map(f => {
        const escapedName = escapeHtml(f.name.replace('.pdf', ''));
        const escapedSize = escapeHtml(f.size);
        const fileJson = JSON.stringify(f).replace(/'/g, '&#39;');
        
        return '<div class="file-card cursor-pointer bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 hover:shadow-xl hover:border-primary-400 transition-all group active:scale-[0.98]" data-file=\'' + fileJson + '\'>' +
            '<div class="flex items-start gap-3 sm:gap-4">' +
                '<div class="p-2.5 sm:p-3 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-xl group-hover:scale-110 transition-transform flex-shrink-0">' +
                    '<svg class="w-6 h-6 sm:w-8 sm:h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>' +
                '</div>' +
                '<div class="min-w-0 flex-1">' +
                    '<h4 class="font-bold dark:text-white truncate mb-1 text-sm sm:text-base leading-tight">' + escapedName + '</h4>' +
                    '<p class="text-xs text-slate-400 font-medium">' + escapedSize + '</p>' +
                '</div>' +
            '</div>' +
        '</div>';
    }).join('');
    
    requestAnimationFrame(() => {
        elements.filesGrid.innerHTML = html;
        elements.filesGrid.addEventListener('click', handleFileClick, { passive: true });
    });
}

function handleFileClick(e) {
    const card = e.target.closest('.file-card');
    if (card) openPdf(JSON.parse(card.dataset.file));
}

// --- MODAL ENGINE ---
function openPdf(file) {
    if (!file || typeof file !== 'object') {
        console.error('Invalid file data');
        return;
    }
    
    document.body.classList.add('modal-open');
    elements.pdfModal.classList.remove('hidden');
    elements.pdfTitle.textContent = file.name || 'Unknown';
    elements.pdfDownload.href = file.downloadUrl || '#';
    
    // Mobile: Show view options instead of loading iframe
    if (isMobile) {
        elements.pdfLoading.classList.add('hidden');
        elements.mobileViewBtn.href = file.viewUrl || '#';
        elements.mobileViewOptions.classList.remove('hidden');
        elements.pdfViewer.src = 'about:blank';
        return;
    }
    
    // Desktop: Load iframe
    elements.mobileViewOptions.classList.add('hidden');
    elements.pdfLoading.classList.remove('hidden');
    elements.pdfViewer.classList.add('hidden');
    elements.pdfViewer.src = 'about:blank';
    
    requestAnimationFrame(() => {
        setTimeout(() => {
            elements.pdfViewer.src = file.viewUrl || 'about:blank';
        }, 50);
    });

    elements.pdfViewer.onload = () => {
        requestAnimationFrame(() => {
            elements.pdfLoading.classList.add('hidden');
            elements.pdfViewer.classList.remove('hidden');
        });
    };
}

function closePdf() {
    document.body.classList.remove('modal-open');
    elements.pdfModal.classList.add('hidden');
    elements.mobileViewOptions.classList.add('hidden');
    elements.pdfLoading.classList.add('hidden');
    setTimeout(() => { elements.pdfViewer.src = 'about:blank'; }, 100);
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
        elements.searchResults.innerHTML = html;
        elements.searchResults.classList.remove('hidden');
        elements.searchResults.addEventListener('click', handleSearchResultClick, { passive: true });
    });
}

function handleSearchResultClick(e) {
    const result = e.target.closest('.search-result');
    if (result) openPdf(JSON.parse(result.dataset.file));
}
