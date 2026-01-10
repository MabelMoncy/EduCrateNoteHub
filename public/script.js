const API_BASE = '/api';
let searchTimeout;
let cachedFolders = null;

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
    // Search & UI Elements
    logoContainer: document.getElementById('logoContainer'),
    mobileSearchTrigger: document.getElementById('mobileSearchTrigger'),
    searchBarContainer: document.getElementById('searchBarContainer'),
    closeSearchBtn: document.getElementById('closeSearchBtn'),
    rightNav: document.getElementById('rightNav'),
    searchInput: document.getElementById('searchInput'),
    searchResults: document.getElementById('searchResults')
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadFolders();
    setupEventListeners();
});

function setupEventListeners() {
    // Sidebar Toggle
    elements.menuBtn.onclick = () => {
        elements.sidebar.classList.remove('-translate-x-full');
        elements.sidebarOverlay.classList.remove('hidden');
    };

    elements.sidebarOverlay.onclick = () => {
        elements.sidebar.classList.add('-translate-x-full');
        elements.sidebarOverlay.classList.add('hidden');
    };

    // Mobile Search Logic
    elements.mobileSearchTrigger.onclick = () => toggleMobileSearch(true);
    elements.closeSearchBtn.onclick = () => toggleMobileSearch(false);
    
    // Auto-close search on mobile when a result is clicked
    elements.searchResults.addEventListener('click', (e) => {
        if (window.innerWidth < 768) toggleMobileSearch(false);
    });

    // Hide search results when clicking outside (Desktop/Mobile)
    document.addEventListener('click', (e) => {
        if (!elements.searchInput.contains(e.target) && !elements.searchResults.contains(e.target)) {
            elements.searchResults.classList.add('hidden');
        }
    });

    elements.themeToggle.onclick = toggleTheme;
    elements.closePdfBtn.onclick = closePdf;
    elements.searchInput.oninput = handleSearch;
}

function toggleMobileSearch(isActive) {
    if (window.innerWidth >= 768) return; 

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
        const res = await fetch(`${API_BASE}/folders`);
        const data = await res.json();
        if(data.success) {
            cachedFolders = data.data;
            renderFolders(cachedFolders);
        }
    } catch(e) { console.error(e); }
}

function renderFolders(folders) {
    elements.foldersList.innerHTML = folders.map(f => `
        <button onclick="selectFolder('${f.id}', '${f.name.replace(/'/g, "\\'")}')" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-slate-600 dark:text-slate-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-600 transition-all group">
            <svg class="w-5 h-5 opacity-50 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
            <span class="font-medium text-sm truncate">${f.name}</span>
        </button>
    `).join('');
}

async function selectFolder(id, name) {
    elements.welcomeState.classList.add('hidden');
    elements.contentHeader.classList.remove('hidden');
    elements.contentTitle.textContent = name;
    elements.filesGrid.innerHTML = '<div class="h-32 shimmer rounded-2xl"></div>'.repeat(3);
    elements.emptyState.classList.add('hidden');

    if (window.innerWidth < 768) {
        elements.sidebar.classList.add('-translate-x-full');
        elements.sidebarOverlay.classList.add('hidden');
    }

    try {
        const res = await fetch(`${API_BASE}/files/${id}`);
        const data = await res.json();
        if(data.success && data.data.length > 0) {
            elements.filesGrid.innerHTML = data.data.map(f => `
                <div onclick='openPdf(${JSON.stringify(f)})' class="cursor-pointer bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 hover:shadow-xl hover:border-primary-400 transition-all group">
                    <div class="flex items-start gap-4">
                        <div class="p-3 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-xl group-hover:scale-110 transition-transform">
                            <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>
                        </div>
                        <div class="min-w-0">
                            <h4 class="font-bold dark:text-white truncate mb-1 text-sm sm:text-base">${f.name.replace('.pdf', '')}</h4>
                            <p class="text-xs text-slate-400 font-medium">${f.size}</p>
                        </div>
                    </div>
                </div>
            `).join('');
        } else {
            elements.filesGrid.innerHTML = '';
            elements.emptyState.classList.remove('hidden');
        }
    } catch(e) { console.error(e); }
}

// --- MODAL ENGINE ---
function openPdf(file) {
    document.body.style.overflow = 'hidden'; 
    elements.pdfModal.classList.remove('hidden');
    elements.pdfTitle.textContent = file.name;
    elements.pdfDownload.href = file.downloadUrl;
    elements.pdfLoading.classList.remove('hidden');
    elements.pdfViewer.classList.add('hidden');
    
    elements.pdfViewer.src = 'about:blank';
    setTimeout(() => {
        elements.pdfViewer.src = file.viewUrl;
    }, 50);

    elements.pdfViewer.onload = () => {
        elements.pdfLoading.classList.add('hidden');
        elements.pdfViewer.classList.remove('hidden');
    };
}

function closePdf() {
    document.body.style.overflow = ''; 
    elements.pdfModal.classList.add('hidden');
    elements.pdfViewer.src = 'about:blank';
}

// --- SEARCH ENGINE ---
function handleSearch(e) {
    const q = e.target.value.trim();
    clearTimeout(searchTimeout);
    
    if(q.length < 2) { 
        elements.searchResults.classList.add('hidden'); 
        return; 
    }

    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`${API_BASE}/search?q=${q}`);
            const data = await res.json();
            if(data.success && data.data.length > 0) {
                elements.searchResults.classList.remove('hidden');
                elements.searchResults.innerHTML = data.data.map(f => `
                    <div onclick='openPdf(${JSON.stringify(f)})' class="cursor-pointer p-3 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-3 border-b border-slate-100 dark:border-slate-700 last:border-0 transition-colors">
                        <svg class="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/></svg>
                        <span class="text-xs font-medium dark:text-slate-200 truncate">${f.name}</span>
                    </div>
                `).join('');
            } else {
                elements.searchResults.classList.add('hidden');
            }
        } catch(e) { console.error(e); }
    }, 500);
}