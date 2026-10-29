const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'public', 'styles.css');
const htmlPath = path.join(__dirname, '..', 'public', 'index.html');

if (!fs.existsSync(cssPath)) {
  console.error('[sync-css] styles.css not found at', cssPath);
  process.exit(1);
}

const css = fs.readFileSync(cssPath, 'utf8');
let html = fs.readFileSync(htmlPath, 'utf8');

const startTag = '<style id="main-styles">';
const endTag = '</style>';

const startIndex = html.indexOf(startTag);
const endIndex = html.indexOf(endTag, startIndex);

if (startIndex === -1 || endIndex === -1) {
  console.error('[sync-css] <style id="main-styles"> tag not found in index.html');
  process.exit(1);
}

html = html.slice(0, startIndex + startTag.length) + css + html.slice(endIndex);
fs.writeFileSync(htmlPath, html, 'utf8');
console.log('[sync-css] Successfully synced minified CSS into public/index.html');
