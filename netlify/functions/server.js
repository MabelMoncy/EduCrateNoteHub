require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const serverless = require('serverless-http');

const app = express();

// --- MIDDLEWARE ---
app.use(compression()); // Zips data for faster loading
app.use(helmet({
    contentSecurityPolicy: false, // Allows iframes/PDF viewer to work
    crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// --- GOOGLE DRIVE CONFIG ---
const ROOT_FOLDER_ID = '1bB6-3-q62cn2mfRZ9pfMl72M75_yZMp1';

const initDriveClient = () => {
    try {
        const jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
        if (!jsonStr) throw new Error("Credentials missing in Environment Variables");
        
        const credentials = JSON.parse(jsonStr.trim());
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.readonly'],
        });
        return google.drive({ version: 'v3', auth });
    } catch (error) {
        console.error("Google Drive Init Error:", error.message);
        return null;
    }
};

// --- API ROUTES ---

// 1. Get List of Subject Folders
app.get('/api/folders', async (req, res) => {
    try {
        const drive = initDriveClient();
        const response = await drive.files.list({
            q: `'${ROOT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            orderBy: 'name',
        });
        res.json({ success: true, data: response.data.files });
    } catch (error) {
        res.status(500).json({ success: false, error: "Failed to fetch folders" });
    }
});

// 2. Get PDF Files inside a specific folder
app.get('/api/files/:folderId', async (req, res) => {
    try {
        const drive = initDriveClient();
        const response = await drive.files.list({
            q: `'${req.params.folderId}' in parents and mimeType = 'application/pdf' and trashed = false`,
            fields: 'files(id, name, size)',
            orderBy: 'name',
        });

        const files = response.data.files.map(f => ({
            id: f.id,
            name: f.name,
            size: formatFileSize(parseInt(f.size) || 0),
            viewUrl: `/api/view/${f.id}`,
            downloadUrl: `/api/download/${f.id}`
        }));

        res.json({ success: true, data: files });
    } catch (error) {
        res.status(500).json({ success: false, error: "Failed to fetch files" });
    }
});

// 3. View PDF (Proxied)
// Includes a check for Serverless 10MB limits
app.get('/api/view/:fileId', async (req, res) => {
    try {
        const drive = initDriveClient();
        const fileId = req.params.fileId;
        
        // Fetch metadata to check size
        const meta = await drive.files.get({ fileId, fields: 'name, size' });
        const fileSizeMb = parseInt(meta.data.size) / (1024 * 1024);

        // If file is larger than 9MB, serverless functions might fail or timeout.
        // We redirect to Google Drive's native viewer for large files.
        if (fileSizeMb > 9) {
            return res.redirect(`https://drive.google.com/file/d/${fileId}/view`);
        }

        const driveRes = await drive.files.get(
            { fileId, alt: 'media' },
            { responseType: 'stream' }
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.data.name)}"`);
        
        driveRes.data.pipe(res);
    } catch (error) {
        console.error("View Error:", error.message);
        res.status(500).send('Error loading PDF');
    }
});

// 4. Download PDF (Proxied)
app.get('/api/download/:fileId', async (req, res) => {
    try {
        const drive = initDriveClient();
        const fileId = req.params.fileId;
        const meta = await drive.files.get({ fileId, fields: 'name' });
        
        const driveRes = await drive.files.get(
            { fileId, alt: 'media' },
            { responseType: 'stream' }
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.data.name)}"`);
        driveRes.data.pipe(res);
    } catch (error) {
        res.status(500).send('Download failed');
    }
});

// 5. Search PDF files
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json({ success: true, data: [] });
        
        const drive = initDriveClient();
        const response = await drive.files.list({
            q: `name contains '${q.replace(/'/g, "\\'")}' and mimeType = 'application/pdf' and trashed = false`,
            fields: 'files(id, name, size)',
            pageSize: 10
        });

        const files = response.data.files.map(f => ({
            id: f.id,
            name: f.name,
            size: formatFileSize(parseInt(f.size) || 0),
            viewUrl: `/api/view/${f.id}`,
            downloadUrl: `/api/download/${f.id}`
        }));

        res.json({ success: true, data: files });
    } catch (error) {
        res.status(500).json({ success: false, error: "Search failed" });
    }
});

// Helper: Format File Size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(1)) + ' ' + ['B', 'KB', 'MB', 'GB'][i];
}

// SPA Routing: Serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
});

// --- PLATFORM EXPORTS ---

// For Vercel / Standard Node
module.exports = app;

// For Netlify
module.exports.handler = serverless(app);

// Local Development
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`\n🚀 EDUCRATE LOCAL DEV: http://localhost:${PORT}\n`);
    });
}