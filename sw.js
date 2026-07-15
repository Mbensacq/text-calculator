/*
 * sw.js — service worker for offline use and instant loads.
 *
 * Strategy: cache-first for the app shell (all files are static and versioned
 * with ?v=N). Bump CACHE and the ?v= query together when assets change; the
 * old cache is then dropped on activate.
 */
const CACHE = 'text-calculator-v23';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/main.css?v=23',
  './src/units.js?v=23',
  './src/tokenizer.js?v=23',
  './src/parser.js?v=23',
  './src/evaluator.js?v=23',
  './src/formatter.js?v=23',
  './src/engine.js?v=23',
  './src/editor.js?v=23',
  './src/storage.js?v=23',
  './src/grid.js?v=23',
  './src/grid-editor.js?v=23',
  './src/simplify.js?v=23',
  './src/note-editor.js?v=23',
  './src/sync.js?v=23',
  './src/app.js?v=23',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Never touch cross-origin requests: the sync layer talks to its backend
  // (Firebase or a self-hosted server) over its own domain and must bypass the
  // cache entirely.
  if (new URL(req.url).origin !== self.location.origin) return;

  // Real-time streams (SSE) must bypass the cache too — even when the sync
  // server shares this origin (app and API on the same domain).
  if ((req.headers.get('accept') || '').indexOf('text/event-stream') >= 0) return;

  // Navigations fall back to the cached app shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        // Runtime-cache same-origin successful GETs.
        if (resp.ok && new URL(req.url).origin === self.location.origin) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      });
    })
  );
});
