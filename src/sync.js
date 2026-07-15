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

  /* ---- End-to-end encryption (optional) ----------------------------- *
   * When a passphrase is set, note payloads are encrypted (AES-GCM) before
   * leaving the device; the server only ever stores ciphertext. The key is
   * derived (PBKDF2) from the passphrase and a salt fixed by the workspace, so
   * every device with the same passphrase reaches the same key. The passphrase
   * itself is never synced nor put in a share link.
   * ------------------------------------------------------------------- */
  function bufToB64(buf) {
    const b = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function b64ToBuf(b64) {
    const s = atob(b64);
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  function deriveKey(pass, ws) {
    const enc = new TextEncoder();
    return crypto.subtle.digest('SHA-256', enc.encode('tc-salt:' + ws)).then(function (saltBuf) {
      const salt = new Uint8Array(saltBuf).slice(0, 16);
      return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (base) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
    });
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
    let keyPromise = null;

    // The derived crypto key (a promise), or null when no passphrase is set or
    // WebCrypto is unavailable.
    function getKey() {
      if (!cfg || !cfg.secret || typeof crypto === 'undefined' || !crypto.subtle) return null;
      if (!keyPromise) keyPromise = deriveKey(cfg.secret, cfg.ws);
      return keyPromise;
    }
    function encryptNote(note) {
      const kp = getKey();
      if (!kp || note == null || note.deleted) return Promise.resolve(note);
      const data = new TextEncoder().encode(JSON.stringify(note));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      return kp.then(function (key) {
        return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data).then(function (ct) {
          return { updatedAt: note.updatedAt || Date.now(), enc: bufToB64(iv) + ':' + bufToB64(ct) };
        });
      }).catch(function () { return note; });
    }
    function decryptNote(env) {
      const kp = getKey();
      if (!kp) return Promise.resolve(null); // locked: ciphertext but no passphrase
      const parts = String(env.enc).split(':');
      if (parts.length !== 2) return Promise.resolve(null);
      return kp.then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(parts[0]) }, key, b64ToBuf(parts[1]))
          .then(function (buf) { try { return JSON.parse(new TextDecoder().decode(buf)); } catch (e) { return null; } });
      }).catch(function () { return null; });
    }

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
      if (note == null || note.deleted) { onRemoteDelete(id); return; }
      if (note.enc) {
        decryptNote(note).then(function (dec) {
          if (dec) { if (dec.updatedAt == null) dec.updatedAt = note.updatedAt; onRemoteNote(id, dec); }
          else onStatus('locked');
        });
        return;
      }
      onRemoteNote(id, note);
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
      encryptNote(note).then(function (payload) {
        try {
          fetch(noteUrl(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(function () {});
        } catch (e) { /* ignore */ }
      });
    }
    function removeNote(id, updatedAt) {
      if (!cfg) return;
      push(id, { deleted: true, updatedAt: updatedAt || Date.now() });
    }

    return {
      configure: function (config) {
        cfg = (config && config.url && config.ws) ? config : null;
        keyPromise = null; // re-derive if the passphrase / workspace changed
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
