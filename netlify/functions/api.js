const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const serverless = require('serverless-http');
const helmet = require('helmet');

const app = express();

app.use(cors());
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

const ROOT_FOLDER_ID = '1bB6-3-q62cn2mfRZ9pfMl72M75_yZMp1';

const initDriveClient = () => {
    try {
        const jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
        const credentials = JSON.parse(jsonStr.trim());
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.readonly'],
        });
        return google.drive({ version: 'v3', auth });
    } catch (e) { return null; }
};

// 1. Get Folders
app.get('/api/folders', async (req, res) => {
    try {
        const drive = initDriveClient();
        const response = await drive.files.list({
            q: `'${ROOT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            orderBy: 'name',
        });
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.json({ success: true, data: response.data.files });
    } catch (error) { res.status(500).json({ success: false }); }
});

// 2. Get Files
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
            size: (parseInt(f.size) / 1024 / 1024).toFixed(1) + ' MB',
            viewUrl: `/api/view/${f.id}`,
            downloadUrl: `/api/download/${f.id}`
        }));
        res.json({ success: true, data: files });
    } catch (error) { res.status(500).json({ success: false }); }
});

// 3. Search Route (The Missing Part)
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json({ success: true, data: [] });

        const drive = initDriveClient();
        // We search the entire drive for files containing the name
        const response = await drive.files.list({
            q: `name contains '${q.replace(/'/g, "\\'")}' and mimeType = 'application/pdf' and trashed = false`,
            fields: 'files(id, name, size)',
            pageSize: 10
        });

        const files = response.data.files.map(f => ({
            id: f.id,
            name: f.name,
            size: (parseInt(f.size) / 1024 / 1024).toFixed(1) + ' MB',
            viewUrl: `/api/view/${f.id}`,
            downloadUrl: `/api/download/${f.id}`
        }));

        res.json({ success: true, data: files });
    } catch (error) {
        console.error("Search API Error:", error);
        res.status(500).json({ success: false });
    }
});

// 4. View PDF
app.get('/api/view/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    // Redirects user to Google's official previewer
    res.redirect(`https://drive.google.com/file/d/${fileId}/preview`);
});
// 5. Download PDF
app.get('/api/download/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    // Redirects browser to Google's direct download link
    res.redirect(`https://drive.google.com/uc?export=download&id=${fileId}`);
});
module.exports.handler = serverless(app);