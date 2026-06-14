#!/usr/bin/env node
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const http  = require('http');
const https = require('https');

const SERVER_URL = (process.env.SERVER_URL || 'http://localhost:3001').replace(/\/$/, '');
const API_KEY    = process.env.HUB_API_KEY;
const WATCH_DIR  = process.env.WATCH_DIR || path.join(__dirname, 'watch');
const POLL_MS    = parseInt(process.env.POLL_MS || '2000', 10);

const IMAGE_RE = /\.(jpe?g|png)$/i;

if (!API_KEY) {
  console.error('[Hub Agent] HUB_API_KEY is not set in environment. Exiting.');
  process.exit(1);
}

for (const sub of ['processed', 'failed']) {
  fs.mkdirSync(path.join(WATCH_DIR, sub), { recursive: true });
}

// Upload the scanned sheet image as multipart/form-data (no external deps).
function postImage(url, filePath, filename) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const boundary = '----HubAgent' + Date.now().toString(16);
    const fileData = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';

    const head = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="sheetImage"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payload = Buffer.concat([head, fileData, tail]);

    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers: {
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length,
        'Authorization':  `Bearer ${API_KEY}`,
      },
    };
    const req = (parsed.protocol === 'https:' ? https : http).request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function processFile(filePath) {
  const filename = path.basename(filePath);
  const claimedPath = filePath + '.processing';

  // Claim the file via rename so a concurrent poll can't process it twice
  try {
    fs.renameSync(filePath, claimedPath);
  } catch {
    return;
  }

  let ok = false;
  try {
    const { status, body } = await postImage(`${SERVER_URL}/api/hub/verify-image`, claimedPath, filename);
    if (status === 200 && body.success) {
      const tag = body.data.result;
      console.log(`[Hub Agent] ${filename} → student ${body.data.studentId} → ${tag}`);
      if (tag === 'FLAGGED' || tag === 'REVIEW') console.warn(`            ${body.data.detail}`);
      ok = true;
    } else {
      const msg = (body && body.error) || `HTTP ${status}`;
      console.error(`[Hub Agent] ${filename} rejected: ${msg}`);
    }
  } catch (err) {
    console.error(`[Hub Agent] ${filename} network error: ${err.message}`);
  }

  const dest = ok ? 'processed' : 'failed';
  fs.renameSync(claimedPath, path.join(WATCH_DIR, dest, filename));
  console.log(`[Hub Agent] ${filename} moved → ${dest}/`);
}

async function poll() {
  let files;
  try {
    files = fs.readdirSync(WATCH_DIR).filter(f => IMAGE_RE.test(f));
  } catch (err) {
    console.error(`[Hub Agent] Cannot read watch dir: ${err.message}`);
    return;
  }
  for (const file of files) {
    await processFile(path.join(WATCH_DIR, file));
  }
}

console.log(`[Hub Agent] Started`);
console.log(`[Hub Agent] Server  : ${SERVER_URL}`);
console.log(`[Hub Agent] Watching: ${WATCH_DIR}  (every ${POLL_MS}ms)`);
console.log(`[Hub Agent] Drop scanned sheet images (.jpg / .png) into the watch/ folder`);

poll();
setInterval(poll, POLL_MS);
