function openPdf(file) {
    // 1. Lock scroll
    document.body.style.overflow = 'hidden';
    
    // 2. Show modal
    elements.pdfModal.classList.remove('hidden');
    elements.pdfTitle.textContent = file.name;
    
    // 3. Set Download Link
    elements.pdfDownload.href = file.downloadUrl;
    
    // 4. Show Loading Spinner
    elements.pdfLoading.classList.remove('hidden');
    elements.pdfViewer.classList.add('hidden');
    
    // 5. Load the View URL
    // Important: We reset the src to force a fresh load
    elements.pdfViewer.src = 'about:blank'; 
    setTimeout(() => {
        elements.pdfViewer.src = file.viewUrl;
    }, 10);

    elements.pdfViewer.onload = () => {
        elements.pdfLoading.classList.add('hidden');
        elements.pdfViewer.classList.remove('hidden');
    };
}