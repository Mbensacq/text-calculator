/*
 * server.js — a small, dependency-free real-time sync server for
 * Text Calculator. It is a drop-in replacement for Firebase Realtime
 * Database: it speaks the same subset of the REST + SSE protocol the app's
 * sync layer already uses, so the browser code is unchanged — only the URL
 * you configure in the app points here instead of Firebase.
 *
 * Endpoints (per workspace <ws>):
 *   GET  /ws/<ws>/notes.json           (Accept: text/event-stream) → live stream
 *   GET  /ws/<ws>/notes.json                                        → JSON snapshot
 *   PUT  /ws/<ws>/notes/<id>.json      body = note JSON             → store + broadcast
 *
 * Data model: notes[ws][id] = { type, body?, grid?, updatedAt, deleted? }.
 * Deletions are tombstones ({ deleted:true, updatedAt }) so they reach devices
 * that were offline. Persistence is a single JSON file, written atomically.
 *
 * No external dependencies — only Node's standard library. Run with any Node
 * ≥ 16. Configuration is entirely through environment variables (see below).
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---- Configuration (env) --------------------------------------------------
const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'notes.json');
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const TOKEN = process.env.SYNC_TOKEN || '';           // if set, required as ?auth=
const SERVE_STATIC = process.env.SERVE_STATIC || '';  // optional: absolute path to the site
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 25000);
const TOMBSTONE_TTL_DAYS = Number(process.env.TOMBSTONE_TTL_DAYS || 90); // 0 = keep forever

// ---- Persistence ----------------------------------------------------------
let db = {};                 // { ws: { id: note } }
const streams = {};          // ws -> Set(res)
let saveTimer = null;

function loadDb() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') db = parsed;
  } catch (e) { db = {}; }
  pruneTombstones();
}

function pruneTombstones() {
  if (!TOMBSTONE_TTL_DAYS) return;
  const cutoff = Date.now() - TOMBSTONE_TTL_DAYS * 86400000;
  for (const ws in db) {
    const notes = db[ws];
    for (const id in notes) {
      const n = notes[id];
      if (n && n.deleted && (n.updatedAt || 0) < cutoff) delete notes[id];
    }
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveDb, 500);
}

function saveDb() {
  saveTimer = null;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DATA_FILE); // atomic on the same filesystem
  } catch (e) {
    console.error('save failed:', e.message);
  }
}

// ---- Helpers --------------------------------------------------------------
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function authorized(u) {
  if (!TOKEN) return true;
  return u.searchParams.get('auth') === TOKEN;
}

function broadcast(ws, path_, data) {
  const set = streams[ws];
  if (!set || !set.size) return;
  const frame = 'event: put\ndata: ' + JSON.stringify({ path: path_, data: data }) + '\n\n';
  for (const res of set) { try { res.write(frame); } catch (e) { /* dropped */ } }
}

function snapshot(ws) {
  const notes = db[ws];
  return notes && Object.keys(notes).length ? notes : null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};

function serveStatic(req, res, pathname) {
  const root = path.resolve(SERVE_STATIC);
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.normalize(path.join(root, rel));
  if (full !== root && !full.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(full, (err, buf) => {
    if (err) {
      // SPA-style fallback to the app shell.
      fs.readFile(path.join(root, 'index.html'), (e2, shell) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(shell);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  });
}

// ---- HTTP server ----------------------------------------------------------
const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const u = new URL(req.url, 'http://localhost');
  const m = /^\/ws\/([^/]+)\/notes(?:\/([^/]+))?\.json$/.exec(u.pathname);

  if (m) {
    if (!authorized(u)) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"error":"unauthorized"}'); return; }
    const ws = decodeURIComponent(m[1]);
    const id = m[2] ? decodeURIComponent(m[2]) : null;

    // --- Live stream (SSE) ---
    if (req.method === 'GET' && !id && (req.headers.accept || '').indexOf('text/event-stream') >= 0) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // ask nginx not to buffer the stream
      });
      res.write('retry: 3000\n\n');
      res.write('event: put\ndata: ' + JSON.stringify({ path: '/', data: snapshot(ws) }) + '\n\n');
      (streams[ws] = streams[ws] || new Set()).add(res);
      const beat = setInterval(() => { try { res.write(':\n\n'); } catch (e) {} }, HEARTBEAT_MS);
      req.on('close', () => { clearInterval(beat); if (streams[ws]) streams[ws].delete(res); });
      return;
    }

    // --- JSON snapshot (debugging / non-SSE clients) ---
    if (req.method === 'GET' && !id) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snapshot(ws)));
      return;
    }

    // --- Write a note ---
    if (req.method === 'PUT' && id) {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        let note; try { note = JSON.parse(body); } catch (e) { res.writeHead(400); res.end('{"error":"bad json"}'); return; }
        (db[ws] = db[ws] || {})[id] = note;
        scheduleSave();
        broadcast(ws, '/' + id, note);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
      });
      return;
    }

    res.writeHead(405); res.end('{"error":"method not allowed"}');
    return;
  }

  // --- Optional static hosting of the app itself ---
  if (SERVE_STATIC && req.method === 'GET') { serveStatic(req, res, u.pathname); return; }

  res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"not found"}');
});

// ---- Lifecycle ------------------------------------------------------------
function shutdown() {
  if (saveTimer) { clearTimeout(saveTimer); }
  saveDb();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

loadDb();
server.listen(PORT, HOST, () => {
  console.log('text-calculator sync server on http://' + HOST + ':' + PORT);
  console.log('  data file : ' + DATA_FILE);
  console.log('  auth      : ' + (TOKEN ? 'token required' : 'open (workspace key only)'));
  console.log('  static    : ' + (SERVE_STATIC || 'disabled'));
});
