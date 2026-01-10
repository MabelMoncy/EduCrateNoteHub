const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const serverless = require('serverless-http');
const helmet = require('helmet');

const app = express();

app.use(cors());
// Helmet config allows the PDF to be displayed in your iframe
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

// --- API ROUTES ---

app.get('/api/folders', async (req, res) => {
    try {
        const drive = initDriveClient();
        const response = await drive.files.list({
            q: `'${ROOT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            orderBy: 'name',
        });
        res.json({ success: true, data: response.data.files });
    } catch (error) { res.status(500).json({ success: false }); }
});

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

app.get('/api/view/:fileId', async (req, res) => {
    try {
        const drive = initDriveClient();
        const fileId = req.params.fileId;
        const meta = await drive.files.get({ fileId, fields: 'name, size' });
        
        // NETLIFY FIX: If file is > 5MB, proxying will likely fail/timeout.
        // We redirect to the high-speed Google Drive preview instead.
        if (parseInt(meta.data.size) > 5242880) { 
            return res.redirect(`https://drive.google.com/file/d/${fileId}/view`);
        }

        const driveRes = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.data.name)}"`);
        driveRes.data.pipe(res);
    } catch (e) { res.status(500).send('Error'); }
});

app.get('/api/download/:fileId', async (req, res) => {
    try {
        const drive = initDriveClient();
        const driveRes = await drive.files.get({ fileId: req.params.fileId, alt: 'media' }, { responseType: 'stream' });
        res.setHeader('Content-Type', 'application/pdf');
        driveRes.data.pipe(res);
    } catch (e) { res.status(500).send('Error'); }
});

module.exports.handler = serverless(app);