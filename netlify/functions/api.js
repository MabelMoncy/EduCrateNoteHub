const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const serverless = require('serverless-http');
const helmet = require('helmet');

const app = express();

app.use(cors());
// Helmet setup to allow Google Drive iframes
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

// 3. View PDF (The FIX for Blank Pages)
app.get('/api/view/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    // We redirect to Google's official embeddable previewer.
    // This is 100% reliable and doesn't hit Netlify's 6MB limit.
    const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
    res.redirect(previewUrl);
});

// 4. Download PDF (Proxy remains for downloads)
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
    } catch (e) {
        res.status(500).send('Download error');
    }
});

module.exports.handler = serverless(app);