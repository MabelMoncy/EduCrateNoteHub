const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const serverless = require('serverless-http');
const helmet = require('helmet');
const { pipeline } = require('stream');

function normalizePrivateKey(value) {
    if (!value || typeof value !== 'string') return '';
    const trimmed = value.trim();
    const unwrapped =
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
            ? trimmed.slice(1, -1)
            : trimmed;
    return unwrapped.replace(/\\n/g, '\n');
}

function parseUrlSafe(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        return new URL(value.trim());
    } catch (_) {
        return null;
    }
}

function normalizeOrigin(value) {
    const parsed = parseUrlSafe(value);
    return parsed ? parsed.origin : '';
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

function createRateLimiter({ windowMs, maxRequests, keyBuilder, message }) {
    const store = new Map();

    setInterval(() => {
        const now = Date.now();
        for (const [key, value] of store.entries()) {
            if (now > value.resetAt) {
                store.delete(key);
            }
        }
    }, 300000);

    return (req, res, next) => {
        const key = keyBuilder(req);
        const now = Date.now();
        const entry = store.get(key);

        if (!entry || now > entry.resetAt) {
            store.set(key, { count: 1, resetAt: now + windowMs });
            next();
            return;
        }

        if (entry.count >= maxRequests) {
            res.status(429).json({ success: false, error: message });
            return;
        }

        entry.count += 1;
        next();
    };
}

function parseServiceAccountJson(rawValue) {
    const raw = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!raw) return null;

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (firstError) {
        // Handle common dashboard paste patterns: quoted JSON string or escaped JSON.
        try {
            const unwrapped =
                (raw.startsWith('"') && raw.endsWith('"')) ||
                (raw.startsWith("'") && raw.endsWith("'"))
                    ? raw.slice(1, -1)
                    : raw;
            parsed = JSON.parse(unwrapped.replace(/\\"/g, '"'));
        } catch (_) {
            throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON must be valid JSON (${firstError.message})`);
        }
    }

    const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email.trim() : '';
    const privateKey = normalizePrivateKey(typeof parsed.private_key === 'string' ? parsed.private_key : '');
    const projectId = typeof parsed.project_id === 'string' ? parsed.project_id.trim() : '';

    if (!projectId || !clientEmail || !privateKey) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing required service-account fields');
    }

    return {
        project_id: projectId,
        client_email: clientEmail,
        private_key: privateKey
    };
}

function getDriveCredentials() {
    const fromJson = parseServiceAccountJson(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '');
    if (!fromJson) {
        throw new Error('Missing required environment variable: GOOGLE_SERVICE_ACCOUNT_JSON');
    }
    return fromJson;
}

const DRIVE_ID_PATTERN = /^[a-zA-Z0-9_-]{8,200}$/;

function isValidDriveId(value) {
    return typeof value === 'string' && DRIVE_ID_PATTERN.test(value);
}

function extractDriveId(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (isValidDriveId(trimmed)) return trimmed;

    const folderPathMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{8,200})/);
    if (folderPathMatch && isValidDriveId(folderPathMatch[1])) return folderPathMatch[1];

    const filePathMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]{8,200})/);
    if (filePathMatch && isValidDriveId(filePathMatch[1])) return filePathMatch[1];

    const parsed = parseUrlSafe(trimmed);
    const idFromQuery = parsed ? parsed.searchParams.get('id') : '';
    if (isValidDriveId(idFromQuery)) return idFromQuery;

    return '';
}

const app = express();

const DEFAULT_ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:8888',
    'http://127.0.0.1:8888'
];

const configuredOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;

const runtimeOriginCandidates = [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL, process.env.VERCEL_URL]
    .filter(Boolean)
    .map((value) => (value.startsWith('http') ? value : `https://${value}`));

const runtimeOrigins = runtimeOriginCandidates.map(normalizeOrigin).filter(Boolean);
const allowedOrigins = new Set([...configuredOrigins, ...runtimeOrigins].map(normalizeOrigin).filter(Boolean));

const corsBaseOptions = {
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    maxAge: 86400
};

app.use(cors((req, callback) => {
    const origin = req.header('origin');
    if (!origin) {
        callback(null, { ...corsBaseOptions, origin: true });
        return;
    }

    const normalizedOrigin = normalizeOrigin(origin);
    if (allowedOrigins.has(normalizedOrigin)) {
        callback(null, { ...corsBaseOptions, origin: true });
        return;
    }

    const parsedOrigin = parseUrlSafe(origin);
    const forwardedHost = typeof req.headers['x-forwarded-host'] === 'string' ? req.headers['x-forwarded-host'] : '';
    const hostHeader = forwardedHost || req.headers.host || '';
    const requestHost = hostHeader.split(',')[0].trim().toLowerCase();
    const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string' ? req.headers['x-forwarded-proto'] : '';
    const reqProtocol = (forwardedProto.split(',')[0].trim() || req.protocol || '').toLowerCase();

    const isSameHost = parsedOrigin && requestHost && parsedOrigin.host.toLowerCase() === requestHost;
    const isSameProtocol = !reqProtocol || (parsedOrigin && parsedOrigin.protocol === `${reqProtocol}:`);

    if (isSameHost && isSameProtocol) {
        callback(null, { ...corsBaseOptions, origin: true });
        return;
    }

    callback(new Error('Origin not allowed by CORS'));
}));

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", 'https://www.gstatic.com'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", 'https://*.googleapis.com', 'https://securetoken.googleapis.com'],
            frameSrc: ['https://drive.google.com', 'https://accounts.google.com'],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: []
        }
    },
    crossOriginEmbedderPolicy: false
}));

app.use(createRateLimiter({
    windowMs: 60000,
    maxRequests: 120,
    keyBuilder: (req) => `general:${getClientIp(req)}`,
    message: 'Too many requests. Please try again later.'
}));

const DEFAULT_ROOT_FOLDER_ID = '1bB6-3-q62cn2mfRZ9pfMl72M75_yZMp1';
const configuredRootFolderRaw = (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '').trim();
const configuredRootFolderId = extractDriveId(configuredRootFolderRaw);
const ROOT_FOLDER_ID = configuredRootFolderId || DEFAULT_ROOT_FOLDER_ID;

const PDF_OR_SHORTCUT_QUERY =
    "(mimeType = 'application/pdf' or (mimeType = 'application/vnd.google-apps.shortcut' and shortcutDetails.targetMimeType = 'application/pdf'))";
const FOLDER_OR_SHORTCUT_TO_FOLDER_QUERY =
    "(mimeType = 'application/vnd.google-apps.folder' or (mimeType = 'application/vnd.google-apps.shortcut' and shortcutDetails.targetMimeType = 'application/vnd.google-apps.folder'))";

const DRIVE_LIST_PAGE_SIZE = 1000;
const DRIVE_PARENT_QUERY_BATCH_SIZE = 20;
const MAX_RECURSIVE_FOLDER_SCAN = 500;
const FUNCTION_MAX_RESPONSE_BYTES = Number.parseInt(process.env.FUNCTION_MAX_RESPONSE_BYTES || '4500000', 10);

let cachedDriveClient = null;
let cachedAuth = null;

function initDriveClient() {
    if (cachedDriveClient) return cachedDriveClient;

    try {
        const credentials = getDriveCredentials();
        cachedAuth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.readonly']
        });
        cachedDriveClient = google.drive({ version: 'v3', auth: cachedAuth });
        return cachedDriveClient;
    } catch (error) {
        console.error('Drive initialization failed:', error.message);
        return null;
    }
}

async function getAccessToken() {
    if (!cachedAuth) initDriveClient();
    if (!cachedAuth) return null;
    const client = await cachedAuth.getClient();
    const tokenResponse = await client.getAccessToken();
    return tokenResponse?.token || null;
}

function naturalSort(a, b) {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function formatFileSize(sizeValue) {
    const parsedSize = Number.parseInt(sizeValue, 10);
    if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
        return 'Unknown size';
    }
    return (parsedSize / 1024 / 1024).toFixed(1) + ' MB';
}

function resolvePdfFileId(file) {
    if (file?.mimeType === 'application/vnd.google-apps.shortcut') {
        return file?.shortcutDetails?.targetId || '';
    }
    return file?.id || '';
}

function mapDriveFileToApiFile(file) {
    const resolvedId = resolvePdfFileId(file);
    if (!isValidDriveId(resolvedId)) {
        return null;
    }

    return {
        id: resolvedId,
        name: file.name,
        size: formatFileSize(file.size),
        modifiedTime: file.modifiedTime || null,
        viewUrl: `/api/pdf/${resolvedId}`,
        downloadUrl: `/api/download/${resolvedId}`,
        thumbnailUrl: `/api/thumbnail/${resolvedId}`
    };
}

function chunkArray(items, chunkSize) {
    const chunks = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize));
    }
    return chunks;
}

async function listDriveFilesPaginated(driveClient, options) {
    const files = [];
    let pageToken = undefined;

    do {
        const response = await driveClient.files.list({
            ...options,
            pageSize: DRIVE_LIST_PAGE_SIZE,
            corpora: 'allDrives',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            pageToken
        });

        files.push(...(response.data.files || []));
        pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return files;
}

async function listPdfFilesAcrossParents(driveClient, parentIds) {
    const validParentIds = parentIds.filter(isValidDriveId);
    if (!validParentIds.length) return [];

    const allFiles = [];
    const parentChunks = chunkArray(validParentIds, DRIVE_PARENT_QUERY_BATCH_SIZE);

    for (const parentChunk of parentChunks) {
        const parentQuery = parentChunk.map((id) => `'${id}' in parents`).join(' or ');
        const files = await listDriveFilesPaginated(driveClient, {
            q: `(${parentQuery}) and ${PDF_OR_SHORTCUT_QUERY} and trashed = false`,
            fields: 'nextPageToken, files(id, name, size, modifiedTime, mimeType, shortcutDetails(targetId,targetMimeType))',
            orderBy: 'name'
        });
        allFiles.push(...files);
    }

    return allFiles;
}

async function listSubfoldersAcrossParents(driveClient, parentIds) {
    const validParentIds = parentIds.filter(isValidDriveId);
    if (!validParentIds.length) return [];

    const allFolderCandidates = [];
    const parentChunks = chunkArray(validParentIds, DRIVE_PARENT_QUERY_BATCH_SIZE);

    for (const parentChunk of parentChunks) {
        const parentQuery = parentChunk.map((id) => `'${id}' in parents`).join(' or ');
        const folderCandidates = await listDriveFilesPaginated(driveClient, {
            q: `(${parentQuery}) and ${FOLDER_OR_SHORTCUT_TO_FOLDER_QUERY} and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType, parents, shortcutDetails(targetId,targetMimeType))',
            orderBy: 'name'
        });
        allFolderCandidates.push(...folderCandidates);
    }

    const folders = [];
    for (const candidate of allFolderCandidates) {
        if (candidate?.mimeType === 'application/vnd.google-apps.folder' && isValidDriveId(candidate.id)) {
            folders.push({ id: candidate.id, name: candidate.name, parents: candidate.parents || [] });
            continue;
        }

        if (
            candidate?.mimeType === 'application/vnd.google-apps.shortcut' &&
            candidate?.shortcutDetails?.targetMimeType === 'application/vnd.google-apps.folder' &&
            isValidDriveId(candidate?.shortcutDetails?.targetId)
        ) {
            folders.push({ id: candidate.shortcutDetails.targetId, name: candidate.name, parents: candidate.parents || [] });
        }
    }

    return folders;
}

async function listPdfFilesRecursively(driveClient, folderId) {
    const queue = [folderId];
    const visited = new Set();
    const filesById = new Map();

    while (queue.length > 0 && visited.size < MAX_RECURSIVE_FOLDER_SCAN) {
        const currentBatch = [];
        while (queue.length > 0 && currentBatch.length < DRIVE_PARENT_QUERY_BATCH_SIZE) {
            const nextFolderId = queue.shift();
            if (!isValidDriveId(nextFolderId) || visited.has(nextFolderId)) continue;
            visited.add(nextFolderId);
            currentBatch.push(nextFolderId);
        }

        if (!currentBatch.length) continue;

        const [pdfFiles, subfolders] = await Promise.all([
            listPdfFilesAcrossParents(driveClient, currentBatch),
            listSubfoldersAcrossParents(driveClient, currentBatch)
        ]);

        for (const file of pdfFiles) {
            const resolvedId = resolvePdfFileId(file);
            if (isValidDriveId(resolvedId) && !filesById.has(resolvedId)) {
                filesById.set(resolvedId, file);
            }
        }

        for (const nextFolder of subfolders) {
            if (isValidDriveId(nextFolder.id) && !visited.has(nextFolder.id)) {
                queue.push(nextFolder.id);
            }
        }
    }

    return Array.from(filesById.values());
}

app.get('/api/folders', async (req, res) => {
    try {
        const driveClient = initDriveClient();
        if (!driveClient) {
            res.status(500).json({ success: false, error: 'Drive client initialization failed' });
            return;
        }

        const response = await driveClient.files.list({
            q: `'${ROOT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            orderBy: 'name',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        const sortedFolders = (response.data.files || []).sort(naturalSort);
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json({ success: true, data: sortedFolders });
    } catch (error) {
        console.error('Get folders error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to retrieve folders' });
    }
});

app.get('/api/files/:folderId', async (req, res) => {
    try {
        const { folderId } = req.params;
        if (!isValidDriveId(folderId)) {
            res.status(400).json({ success: false, error: 'Invalid folder ID' });
            return;
        }

        const driveClient = initDriveClient();
        if (!driveClient) {
            res.status(500).json({ success: false, error: 'Drive client initialization failed' });
            return;
        }

        const driveFiles = await listPdfFilesRecursively(driveClient, folderId);
        const files = driveFiles
            .map(mapDriveFileToApiFile)
            .filter(Boolean)
            .sort(naturalSort);

        res.setHeader('Cache-Control', 'public, max-age=30');
        res.json({ success: true, data: files });
    } catch (error) {
        console.error('Get files error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to retrieve files' });
    }
});

let cachedTree = null;
let lastTreeFetchTime = 0;
const TREE_CACHE_TTL = 120000; // 2 minutes

async function buildFolderTree(driveClient) {
    const rootNode = { id: ROOT_FOLDER_ID, name: 'Notes', children: [] };
    const nodeMap = new Map();
    nodeMap.set(ROOT_FOLDER_ID, rootNode);
    
    const queue = [ROOT_FOLDER_ID];
    const visited = new Set([ROOT_FOLDER_ID]);
    
    while (queue.length > 0 && visited.size < MAX_RECURSIVE_FOLDER_SCAN) {
        const currentBatch = [];
        while (queue.length > 0 && currentBatch.length < DRIVE_PARENT_QUERY_BATCH_SIZE) {
            currentBatch.push(queue.shift());
        }
        
        const subfolders = await listSubfoldersAcrossParents(driveClient, currentBatch);
        
        for (const folder of subfolders) {
            if (isValidDriveId(folder.id) && !visited.has(folder.id)) {
                visited.add(folder.id);
                queue.push(folder.id);
                
                const newNode = { id: folder.id, name: folder.name, children: [] };
                nodeMap.set(folder.id, newNode);
                
                // attach to parent
                for (const parentId of folder.parents) {
                    const parentNode = nodeMap.get(parentId);
                    if (parentNode) {
                        parentNode.children.push(newNode);
                        break; // Attach to the first valid parent in our tree
                    }
                }
            }
        }
    }
    
    // Sort children recursively
    function sortTree(node) {
        if (node.children && node.children.length > 0) {
            node.children.sort(naturalSort);
            for (const child of node.children) {
                sortTree(child);
            }
        }
    }
    sortTree(rootNode);
    
    return rootNode;
}

app.get('/api/tree', async (req, res) => {
    try {
        const driveClient = initDriveClient();
        if (!driveClient) {
            res.status(500).json({ success: false, error: 'Drive client initialization failed' });
            return;
        }
        
        const now = Date.now();
        if (!cachedTree || (now - lastTreeFetchTime > TREE_CACHE_TTL)) {
            cachedTree = await buildFolderTree(driveClient);
            lastTreeFetchTime = now;
        }
        
        res.setHeader('Cache-Control', 'public, max-age=120');
        res.json({ success: true, data: cachedTree });
    } catch (error) {
        console.error('Get tree error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to retrieve tree' });
    }
});

app.get('/api/folder-contents/:folderId', async (req, res) => {
    try {
        const { folderId } = req.params;
        if (!isValidDriveId(folderId)) {
            res.status(400).json({ success: false, error: 'Invalid folder ID' });
            return;
        }

        const driveClient = initDriveClient();
        if (!driveClient) {
            res.status(500).json({ success: false, error: 'Drive client initialization failed' });
            return;
        }

        // Get subfolders
        const subfoldersRaw = await listSubfoldersAcrossParents(driveClient, [folderId]);
        const folders = subfoldersRaw.map(f => ({ id: f.id, name: f.name })).sort(naturalSort);

        // Get files
        const pdfFiles = await listPdfFilesAcrossParents(driveClient, [folderId]);
        const files = pdfFiles
            .map(mapDriveFileToApiFile)
            .filter(Boolean)
            .sort(naturalSort);
            
        // Get breadcrumbs by walking up parents
        const breadcrumbs = [];
        let currentId = folderId;
        const maxDepth = 20;
        let depth = 0;
        let folderName = 'Folder';
        
        while (currentId && depth < maxDepth) {
            if (currentId === ROOT_FOLDER_ID) {
                breadcrumbs.unshift({ id: currentId, name: 'Notes' });
                if (currentId === folderId) {
                    folderName = 'Notes';
                }
                break;
            }
            try {
                const meta = await driveClient.files.get({
                    fileId: currentId,
                    fields: 'id, name, parents',
                    supportsAllDrives: true
                });
                
                if (currentId === folderId) {
                    folderName = meta.data.name;
                }
                
                breadcrumbs.unshift({ id: meta.data.id, name: meta.data.name });
                currentId = (meta.data.parents && meta.data.parents.length > 0) ? meta.data.parents[0] : null;
            } catch (e) {
                break;
            }
            depth++;
        }
        
        res.setHeader('Cache-Control', 'public, max-age=30');
        res.json({ 
            success: true, 
            data: {
                folderId,
                folderName,
                breadcrumbs,
                folders,
                files
            }
        });
    } catch (error) {
        console.error('Get folder contents error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to retrieve folder contents' });
    }
});

app.get('/api/search', async (req, res) => {
    try {
        const queryInput = req.query.q;
        if (!queryInput || typeof queryInput !== 'string') {
            res.json({ success: true, data: [] });
            return;
        }

        const query = queryInput.trim();
        if (query.length < 2) {
            res.json({ success: true, data: [] });
            return;
        }

        if (query.length > 100) {
            res.status(400).json({ success: false, error: 'Query too long' });
            return;
        }

        const sanitizedQuery = query.replace(/[^a-zA-Z0-9\s\-_.]/g, '');
        if (!sanitizedQuery) {
            res.json({ success: true, data: [] });
            return;
        }

        const driveClient = initDriveClient();
        if (!driveClient) {
            res.status(500).json({ success: false, error: 'Drive client initialization failed' });
            return;
        }

        const response = await driveClient.files.list({
            q: `name contains '${sanitizedQuery}' and ${PDF_OR_SHORTCUT_QUERY} and trashed = false`,
            fields: 'files(id, name, size, modifiedTime, mimeType, shortcutDetails(targetId,targetMimeType))',
            pageSize: 20,
            corpora: 'allDrives',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        const files = (response.data.files || [])
            .map(mapDriveFileToApiFile)
            .filter(Boolean)
            .sort(naturalSort);

        res.setHeader('Cache-Control', 'public, max-age=900');
        res.json({ success: true, data: files });
    } catch (error) {
        console.error('Search API error:', error.message);
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});

app.get('/api/view/:fileId', (req, res) => {
    const { fileId } = req.params;
    if (!isValidDriveId(fileId)) {
        res.status(400).json({ success: false, error: 'Invalid file ID' });
        return;
    }

    res.redirect(`https://drive.google.com/file/d/${fileId}/preview`);
});

app.get('/api/pdf/:fileId', async (req, res) => {
    const { fileId } = req.params;
    if (!isValidDriveId(fileId)) {
        res.status(400).json({ success: false, error: 'Invalid file ID' });
        return;
    }

    try {
        const driveClient = initDriveClient();
        if (!driveClient) {
            res.redirect(302, `/api/view/${fileId}`);
            return;
        }

        const meta = await driveClient.files.get({
            fileId,
            fields: 'mimeType,name,size',
            supportsAllDrives: true
        });

        if (meta.data.mimeType !== 'application/pdf') {
            res.status(400).json({ success: false, error: 'File is not a PDF' });
            return;
        }

        const fileSizeBytes = Number.parseInt(meta.data.size, 10);
        if (Number.isFinite(fileSizeBytes) && fileSizeBytes > FUNCTION_MAX_RESPONSE_BYTES) {
            res.redirect(302, `https://drive.google.com/file/d/${fileId}/preview`);
            return;
        }

        const response = await driveClient.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream' }
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(meta.data.name)}"`);
        res.setHeader('Cache-Control', 'public, max-age=86400');

        if (meta.data.size) {
            res.setHeader('Content-Length', meta.data.size);
        }

        pipeline(response.data, res, (streamError) => {
            if (streamError) {
                console.error('PDF stream pipeline error:', streamError.message);
                if (!res.headersSent) {
                    res.redirect(302, `/api/view/${fileId}`);
                }
            }
        });
    } catch (error) {
        console.error('PDF stream error:', error.message);
        res.redirect(302, `/api/view/${fileId}`);
    }
});

app.get('/api/thumbnail/:fileId', async (req, res) => {
    const { fileId } = req.params;
    if (!isValidDriveId(fileId)) {
        res.status(400).json({ success: false, error: 'Invalid file ID' });
        return;
    }

    try {
        const driveClient = initDriveClient();
        if (!driveClient) {
            res.status(500).json({ success: false, error: 'Drive client initialization failed' });
            return;
        }

        const meta = await driveClient.files.get({
            fileId,
            fields: 'thumbnailLink,hasThumbnail',
            supportsAllDrives: true
        });

        if (!meta.data.hasThumbnail || !meta.data.thumbnailLink) {
            res.status(404).json({ success: false, error: 'No thumbnail available' });
            return;
        }

        let thumbUrl = meta.data.thumbnailLink;
        thumbUrl = thumbUrl.replace(/=s\d+$/, '=s400');

        const accessToken = await getAccessToken();
        if (!accessToken) {
            res.status(500).json({ success: false, error: 'Access token unavailable' });
            return;
        }

        const thumbResponse = await fetch(thumbUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10000)
        });

        if (!thumbResponse.ok) {
            res.status(502).json({ success: false, error: 'Failed to fetch thumbnail from Drive' });
            return;
        }

        const arrayBuffer = await thumbResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.setHeader('Content-Type', thumbResponse.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(buffer);
    } catch (error) {
        console.error('Thumbnail error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch thumbnail' });
    }
});

app.get('/api/download/:fileId', async (req, res) => {
    const { fileId } = req.params;
    if (!isValidDriveId(fileId)) {
        res.status(400).json({ success: false, error: 'Invalid file ID' });
        return;
    }

    try {
        const driveClient = initDriveClient();
        if (!driveClient) {
            res.status(500).json({ success: false, error: 'Drive client initialization failed' });
            return;
        }

        const meta = await driveClient.files.get({
            fileId,
            fields: 'mimeType,name,size',
            supportsAllDrives: true
        });

        if (meta.data.mimeType !== 'application/pdf') {
            res.status(400).json({ success: false, error: 'File is not a PDF' });
            return;
        }

        const response = await driveClient.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'stream' }
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.data.name)}"`);
        res.setHeader('Cache-Control', 'public, max-age=86400');

        if (meta.data.size) {
            res.setHeader('Content-Length', meta.data.size);
        }

        pipeline(response.data, res, (streamError) => {
            if (streamError) {
                console.error('Download stream pipeline error:', streamError.message);
                if (!res.headersSent) {
                    res.status(500).json({ success: false, error: 'Failed to download PDF' });
                }
            }
        });
    } catch (error) {
        console.error('Download stream error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to download PDF' });
    }
});

app.use((error, req, res, next) => {
    if (error && error.message === 'Origin not allowed by CORS') {
        res.status(403).json({ success: false, error: 'CORS origin denied' });
        return;
    }

    console.error('Unhandled API error:', error?.message || 'Unknown error');
    res.status(500).json({ success: false, error: 'Internal server error' });
});

module.exports = app;
module.exports.handler = serverless(app, {
    binary: [
        'application/pdf',
        'application/octet-stream',
        'image/*',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif'
    ]
});
