const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const serverless = require('serverless-http');
const helmet = require('helmet');

const app = express();

// Configure CORS with more restrictive settings
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    methods: ['GET'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
    maxAge: 86400 // 24 hours
}));

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            frameSrc: ["https://drive.google.com"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: []
        }
    },
    crossOriginEmbedderPolicy: false
}));

// Simple rate limiting using in-memory store (for serverless, consider external solution)
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per minute

app.use((req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    
    if (!rateLimitStore.has(ip)) {
        rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return next();
    }
    
    const record = rateLimitStore.get(ip);
    
    if (now > record.resetTime) {
        rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return next();
    }
    
    if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
        return res.status(429).json({ 
            success: false, 
            error: 'Too many requests. Please try again later.' 
        });
    }
    
    record.count++;
    next();
});

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
        if (!drive) {
            return res.status(500).json({ success: false, error: 'Drive client initialization failed' });
        }
        const response = await drive.files.list({
            q: `'${ROOT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            orderBy: 'name',
        });
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.json({ success: true, data: response.data.files });
    } catch (error) { 
        console.error("Get Folders Error:", error.message);
        res.status(500).json({ success: false, error: 'Failed to retrieve folders' }); 
    }
});

// 2. Get Files with validation
app.get('/api/files/:folderId', async (req, res) => {
    try {
        const { folderId } = req.params;
        
        // Validate folderId format (Google Drive IDs are alphanumeric with hyphens and underscores)
        if (!folderId || !/^[a-zA-Z0-9_-]+$/.test(folderId)) {
            return res.status(400).json({ success: false, error: 'Invalid folder ID' });
        }
        
        const drive = initDriveClient();
        const response = await drive.files.list({
            q: `'${folderId}' in parents and mimeType = 'application/pdf' and trashed = false`,
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
    } catch (error) { 
        console.error("Get Files Error:", error.message);
        res.status(500).json({ success: false, error: 'Failed to retrieve files' }); 
    }
});

// 3. Search Route with Input Validation and Sanitization
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        
        // Input validation
        if (!q || typeof q !== 'string') {
            return res.json({ success: true, data: [] });
        }
        
        // Trim and check length
        const query = q.trim();
        if (query.length < 2) {
            return res.json({ success: true, data: [] });
        }
        
        // Limit query length to prevent abuse
        if (query.length > 100) {
            return res.status(400).json({ success: false, error: 'Query too long' });
        }
        
        // Sanitize input: allow only alphanumeric, spaces, and common punctuation
        const sanitizedQuery = query.replace(/[^a-zA-Z0-9\s\-_.]/g, '');
        
        if (!sanitizedQuery) {
            return res.json({ success: true, data: [] });
        }

        const drive = initDriveClient();
        // Use sanitized query - no need to escape single quotes as we've removed them
        const response = await drive.files.list({
            q: `name contains '${sanitizedQuery}' and mimeType = 'application/pdf' and trashed = false`,
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
        console.error("Search API Error:", error.message);
        // Don't expose internal error details to client
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});

// 4. View PDF with validation
app.get('/api/view/:fileId', (req, res) => {
    const { fileId } = req.params;
    
    // Validate fileId format
    if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
        return res.status(400).json({ success: false, error: 'Invalid file ID' });
    }
    
    // Redirects user to Google's official previewer
    res.redirect(`https://drive.google.com/file/d/${fileId}/preview`);
});
// 5. Download PDF with validation
app.get('/api/download/:fileId', (req, res) => {
    const { fileId } = req.params;
    
    // Validate fileId format
    if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
        return res.status(400).json({ success: false, error: 'Invalid file ID' });
    }
    
    // Redirects browser to Google's direct download link
    res.redirect(`https://drive.google.com/uc?export=download&id=${fileId}`);
});
module.exports.handler = serverless(app);