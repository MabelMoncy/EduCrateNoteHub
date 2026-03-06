const API_BASE = '/api';
let searchTimeout;
let cachedFolders = null;
let cachedFiles = {}; // Cache files per folder for faster navigation
let isMobile = window.innerWidth < 768;

// PDF Viewer State
let pdfDoc = null;
let currentScale = 1.0;
let renderedPages = new Map();
let isRendering = false;
let renderQueue = [];

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
    pdfLoading: document.getElementById('pdfLoading'),
    pdfLoadProgress: document.getElementById('pdfLoadProgress'),
    pdfPages: document.getElementById('pdfPages'),
    pdfPagesContainer: document.getElementById('pdfPagesContainer'),
    closePdfBtn: document.getElementById('closePdfBtn'),
    pdfDownload: document.getElementById('pdfDownload'),
    currentPage: document.getElementById('currentPage'),
    totalPages: document.getElementById('totalPages'),
    zoomIn: document.getElementById('zoomIn'),
    zoomOut: document.getElementById('zoomOut'),
    zoomLevel: document.getElementById('zoomLevel'),
    fitWidth: document.getElementById('fitWidth'),
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
    
    // PDF Viewer Controls
    elements.zoomIn.addEventListener('click', () => setZoom(currentScale + 0.25), { passive: true });
    elements.zoomOut.addEventListener('click', () => setZoom(currentScale - 0.25), { passive: true });
    elements.fitWidth.addEventListener('click', fitToWidth, { passive: true });
    
    // Track current page on scroll
    elements.pdfPagesContainer.addEventListener('scroll', updateCurrentPage, { passive: true });
    
    // Keyboard shortcuts for PDF viewer
    document.addEventListener('keydown', (e) => {
        if (!elements.pdfModal.classList.contains('hidden')) {
            if (e.key === 'Escape') closePdf();
            if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(currentScale + 0.25); }
            if (e.key === '-') { e.preventDefault(); setZoom(currentScale - 0.25); }
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

// --- MODAL ENGINE (PDF.js Viewer) ---
async function openPdf(file) {
    if (!file || typeof file !== 'object') {
        console.error('Invalid file data');
        return;
    }
    
    document.body.classList.add('modal-open');
    elements.pdfModal.classList.remove('hidden');
    elements.pdfTitle.textContent = file.name || 'Unknown';
    elements.pdfDownload.href = file.downloadUrl || '#';
    
    // Reset viewer state
    elements.pdfLoading.classList.remove('hidden');
    elements.pdfPages.classList.add('hidden');
    elements.pdfPages.innerHTML = '';
    elements.pdfLoadProgress.textContent = '0%';
    elements.currentPage.textContent = '1';
    elements.totalPages.textContent = '1';
    pdfDoc = null;
    renderedPages.clear();
    renderQueue = [];
    currentScale = isMobile ? 1.0 : 1.2;
    
    try {
        // Dynamically import PDF.js
        const pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
        
        // Build the PDF URL - use the streaming endpoint
        const pdfUrl = `/api/pdf/${file.id}`;
        
        // Load PDF with progress tracking
        const loadingTask = pdfjsLib.getDocument({
            url: pdfUrl,
            cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/cmaps/',
            cMapPacked: true,
        });
        
        loadingTask.onProgress = (progress) => {
            if (progress.total > 0) {
                const percent = Math.round((progress.loaded / progress.total) * 100);
                elements.pdfLoadProgress.textContent = `${percent}%`;
            }
        };
        
        pdfDoc = await loadingTask.promise;
        elements.totalPages.textContent = pdfDoc.numPages;
        
        // Create page containers
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const wrapper = document.createElement('div');
            wrapper.className = 'pdf-page-wrapper';
            wrapper.id = `page-${i}`;
            wrapper.dataset.page = i;
            
            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-page-canvas';
            wrapper.appendChild(canvas);
            elements.pdfPages.appendChild(wrapper);
        }
        
        // Hide loading, show pages
        elements.pdfLoading.classList.add('hidden');
        elements.pdfPages.classList.remove('hidden');
        
        // Fit to width on initial load
        await fitToWidth();
        
        // Set up intersection observer for lazy rendering
        setupLazyRendering();
        
    } catch (error) {
        console.error('PDF load error:', error);
        elements.pdfLoadProgress.textContent = 'Failed to load PDF';
    }
}

function setupLazyRendering() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const pageNum = parseInt(entry.target.dataset.page);
            if (entry.isIntersecting && !renderedPages.has(pageNum)) {
                queueRenderPage(pageNum);
            }
        });
    }, {
        root: elements.pdfPagesContainer,
        rootMargin: '200px 0px',
        threshold: 0.01
    });
    
    document.querySelectorAll('.pdf-page-wrapper').forEach(wrapper => {
        observer.observe(wrapper);
    });
}

async function queueRenderPage(pageNum) {
    if (renderedPages.has(pageNum) || renderQueue.includes(pageNum)) return;
    renderQueue.push(pageNum);
    processRenderQueue();
}

async function processRenderQueue() {
    if (isRendering || renderQueue.length === 0) return;
    isRendering = true;
    
    const pageNum = renderQueue.shift();
    await renderPage(pageNum);
    
    isRendering = false;
    if (renderQueue.length > 0) {
        requestAnimationFrame(() => processRenderQueue());
    }
}

async function renderPage(pageNum) {
    if (!pdfDoc || renderedPages.has(pageNum)) return;
    
    try {
        const page = await pdfDoc.getPage(pageNum);
        const wrapper = document.getElementById(`page-${pageNum}`);
        const canvas = wrapper.querySelector('canvas');
        const ctx = canvas.getContext('2d');
        
        const viewport = page.getViewport({ scale: currentScale * window.devicePixelRatio });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / window.devicePixelRatio}px`;
        canvas.style.height = `${viewport.height / window.devicePixelRatio}px`;
        
        await page.render({
            canvasContext: ctx,
            viewport: viewport
        }).promise;
        
        renderedPages.set(pageNum, currentScale);
    } catch (error) {
        console.error(`Error rendering page ${pageNum}:`, error);
    }
}

async function setZoom(newScale) {
    newScale = Math.max(0.5, Math.min(3, newScale));
    if (newScale === currentScale) return;
    
    currentScale = newScale;
    elements.zoomLevel.textContent = `${Math.round(currentScale * 100)}%`;
    
    // Re-render all visible pages at new scale
    renderedPages.clear();
    renderQueue = [];
    
    // Clear and re-render
    document.querySelectorAll('.pdf-page-wrapper').forEach(wrapper => {
        const canvas = wrapper.querySelector('canvas');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
    
    setupLazyRendering();
}

async function fitToWidth() {
    if (!pdfDoc) return;
    
    const page = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const containerWidth = elements.pdfPagesContainer.clientWidth - 32; // Account for padding
    const scale = containerWidth / viewport.width;
    
    await setZoom(scale);
}

function updateCurrentPage() {
    const container = elements.pdfPagesContainer;
    const scrollTop = container.scrollTop;
    const wrappers = document.querySelectorAll('.pdf-page-wrapper');
    
    for (const wrapper of wrappers) {
        const rect = wrapper.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        
        if (rect.top <= containerRect.top + containerRect.height / 2 && 
            rect.bottom >= containerRect.top) {
            elements.currentPage.textContent = wrapper.dataset.page;
            break;
        }
    }
}

function closePdf() {
    document.body.classList.remove('modal-open');
    elements.pdfModal.classList.add('hidden');
    elements.pdfLoading.classList.add('hidden');
    elements.pdfPages.innerHTML = '';
    pdfDoc = null;
    renderedPages.clear();
    renderQueue = [];
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
