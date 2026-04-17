// Minimal Express server for local development
require('dotenv').config();
const compression = require('compression');
const express = require('express');
const helmet = require('helmet');
const serverless = require('serverless-http');
const api = require('./netlify/functions/api');
const path = require('path');
const app = express();

const ONE_DAY_SECONDS = 60 * 60 * 24;
const ASSET_MAX_AGE_SECONDS = ONE_DAY_SECONDS * 7;

app.use(helmet());
app.use(compression());

// Serve static files from public with sensible caching
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', `public, max-age=${ASSET_MAX_AGE_SECONDS}`);
    }
  }
}));

// Mount the API at root since api.js routes already have /api prefix
app.use('/', api.app || api);

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`EduCrate running at http://localhost:${PORT}`);
});
