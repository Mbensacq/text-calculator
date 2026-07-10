/*
 * server.js — a small real-time sync server for Text Calculator. It is a
 * drop-in replacement for Firebase Realtime Database: it speaks the same subset
 * of the REST + SSE protocol the app's sync layer already uses, so the browser
 * code is unchanged — only the URL you configure in the app points here.
 *
 * Endpoints (per workspace <ws>):
 *   GET  /ws/<ws>/notes.json           (Accept: text/event-stream) → live stream
 *   GET  /ws/<ws>/notes.json                                        → JSON snapshot
 *   PUT  /ws/<ws>/notes/<id>.json      body = note JSON             → store + broadcast
 *
 * Data model: notes[ws][id] = { type, body?, grid?, updatedAt, deleted? }.
 * Deletions are tombstones ({ deleted:true, updatedAt }) so they reach devices
 * that were offline. Reconciliation is last-write-wins by `updatedAt`, applied
 * on the client.
 *
 * Storage is pluggable (see store.js): a zero-dependency JSON file by default,
 * or MySQL/MariaDB / PostgreSQL when a database is configured. The core server
 * has no external dependencies; a database backend needs its driver.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const createStore = require('./store');

// ---- Configuration (env) --------------------------------------------------
const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const TOKEN = process.env.SYNC_TOKEN || '';           // if set, required as ?auth=
const SERVE_STATIC = process.env.SERVE_STATIC || '';  // optional: absolute path to the site
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 25000);

const store = createStore(process.env);
const streams = {};          // ws -> Set(res)

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

function nonEmpty(map) { return map && Object.keys(map).length ? map : null; }

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
      (streams[ws] = streams[ws] || new Set()).add(res);
      const beat = setInterval(() => { try { res.write(':\n\n'); } catch (e) {} }, HEARTBEAT_MS);
      req.on('close', () => { clearInterval(beat); if (streams[ws]) streams[ws].delete(res); });
      // Send the initial snapshot (after registering, so no write is missed).
      store.all(ws).then((snap) => {
        try { res.write('event: put\ndata: ' + JSON.stringify({ path: '/', data: nonEmpty(snap) }) + '\n\n'); } catch (e) {}
      }).catch((e) => console.error('snapshot failed:', e.message));
      return;
    }

    // --- JSON snapshot (debugging / non-SSE clients) ---
    if (req.method === 'GET' && !id) {
      store.all(ws).then((snap) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(nonEmpty(snap)));
      }).catch((e) => { res.writeHead(500); res.end('{"error":"read failed"}'); console.error(e.message); });
      return;
    }

    // --- Write a note ---
    if (req.method === 'PUT' && id) {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        let note; try { note = JSON.parse(body); } catch (e) { res.writeHead(400); res.end('{"error":"bad json"}'); return; }
        store.put(ws, id, note).then(() => {
          broadcast(ws, '/' + id, note);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(body);
        }).catch((e) => { res.writeHead(500); res.end('{"error":"write failed"}'); console.error(e.message); });
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
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  store.close().catch(() => {}).then(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000); // hard stop if a driver hangs
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

store.init().then(() => {
  server.listen(PORT, HOST, () => {
    console.log('text-calculator sync server on http://' + HOST + ':' + PORT);
    console.log('  storage : ' + store.kind + ' (' + store.describe() + ')');
    console.log('  auth    : ' + (TOKEN ? 'token required' : 'open (workspace key only)'));
    console.log('  static  : ' + (SERVE_STATIC || 'disabled'));
  });
}).catch((e) => {
  console.error('storage init failed:', e.message);
  process.exit(1);
});
