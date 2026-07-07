/*
 * sync.js — optional real-time sync across devices via Firebase Realtime
 * Database, using only the REST API (fetch PUT) and its SSE stream
 * (EventSource) — no SDK, so the app stays a static site on GitHub Pages.
 *
 * Data layout:  <dbUrl>/ws/<workspace>/notes/<noteId> = { type, body?, grid?,
 * updatedAt, deleted? }. Deletions are tombstones so they propagate to devices
 * that were offline. Reconciliation is last-write-wins by `updatedAt`.
 *
 * The whole thing is optional: with no config, the app is purely local.
 */
(function (root, factory) {
  const mod = factory();
  root.TC = root.TC || {};
  root.TC.createSync = mod.createSync;
  root.TC.Sync = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONFIG_KEY = 'text-calculator:sync';

  function readConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeConfig(cfg) {
    try {
      if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
      else localStorage.removeItem(CONFIG_KEY);
    } catch (e) { /* ignore */ }
  }

  function randomKey() {
    let s = '';
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 20; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  // Base64url encode/decode of the config for a shareable link (#sync=...).
  function encodeShare(cfg) {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(cfg)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
    catch (e) { return ''; }
  }
  function decodeShare(s) {
    try {
      const b = s.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(b))));
    } catch (e) { return null; }
  }

  function createSync(handlers) {
    handlers = handlers || {};
    const onRemoteNote = handlers.onRemoteNote || function () {};
    const onRemoteDelete = handlers.onRemoteDelete || function () {};
    const onStatus = handlers.onStatus || function () {};

    let cfg = null;
    let es = null;

    function trimSlash(u) { return u.replace(/\/+$/, ''); }
    function authQ() { return cfg.auth ? '?auth=' + encodeURIComponent(cfg.auth) : ''; }
    function notesUrl() { return trimSlash(cfg.url) + '/ws/' + encodeURIComponent(cfg.ws) + '/notes.json' + authQ(); }
    function noteUrl(id) { return trimSlash(cfg.url) + '/ws/' + encodeURIComponent(cfg.ws) + '/notes/' + encodeURIComponent(id) + '.json' + authQ(); }

    function handleEvent(e) {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (!msg) return;
      const path = msg.path;
      const data = msg.data;
      if (path === '/') {
        if (data && typeof data === 'object') {
          for (const id in data) apply(id, data[id]);
        }
        return;
      }
      const m = /^\/([^/]+)$/.exec(path || '');
      if (!m) return; // a deeper field patch — we always write whole notes, so ignore
      apply(m[1], data);
    }
    function apply(id, note) {
      if (note == null || note.deleted) onRemoteDelete(id);
      else onRemoteNote(id, note);
    }

    function start() {
      stop();
      if (!cfg || typeof EventSource === 'undefined') { onStatus('off'); return; }
      onStatus('connecting');
      try {
        es = new EventSource(notesUrl());
        es.addEventListener('put', handleEvent);
        es.addEventListener('patch', handleEvent);
        es.onopen = function () { onStatus('on'); };
        es.onerror = function () { onStatus('error'); }; // EventSource retries on its own
      } catch (err) {
        onStatus('error');
      }
    }
    function stop() {
      if (es) { try { es.close(); } catch (e) {} es = null; }
    }

    function push(id, note) {
      if (!cfg) return;
      const body = JSON.stringify(note);
      try {
        fetch(noteUrl(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body }).catch(function () {});
      } catch (e) { /* ignore */ }
    }
    function removeNote(id, updatedAt) {
      if (!cfg) return;
      push(id, { deleted: true, updatedAt: updatedAt || Date.now() });
    }

    return {
      configure: function (config) {
        cfg = (config && config.url && config.ws) ? config : null;
        writeConfig(cfg);
        start();
        return cfg;
      },
      loadSaved: function () { cfg = readConfig(); return cfg; },
      getConfig: function () { return cfg; },
      isConfigured: function () { return !!cfg; },
      start: start,
      stop: stop,
      push: push,
      remove: removeNote,
    };
  }

  return {
    createSync: createSync,
    randomKey: randomKey,
    encodeShare: encodeShare,
    decodeShare: decodeShare,
  };
});
