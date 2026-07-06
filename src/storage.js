/*
 * storage.js — a tiny note collection backed by localStorage.
 *
 * A note is just { id, body, updatedAt }. Its title is derived from the first
 * non-empty line (Apple-Notes style), so there is no separate title field to
 * keep in sync. The store persists on every change and migrates the old
 * single-note key from earlier versions.
 */
(function (root, factory) {
  const mod = factory();
  root.TC = root.TC || {};
  root.TC.createStore = mod.createStore;
  root.TC.deriveTitle = mod.deriveTitle;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEY = 'text-calculator:v1';
  const LEGACY_KEY = 'text-calculator:note';

  function uid() {
    return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function deriveTitle(body) {
    const lines = (body || '').split('\n');
    for (const line of lines) {
      const t = line.replace(/^\s*(#+|\/\/)\s*/, '').trim();
      if (t) return t;
    }
    return 'Note sans titre';
  }

  function deriveSnippet(body) {
    const lines = (body || '').split('\n').map((l) => l.trim()).filter(Boolean);
    // Skip the line already used as the title.
    return lines.length > 1 ? lines[1].replace(/^\s*(#+|\/\/)\s*/, '') : '';
  }

  function createStore(seedBody) {
    let state = read();
    if (!state) state = migrateOrSeed(seedBody);

    function read() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.notes) || !parsed.notes.length) return null;
        return parsed;
      } catch (e) {
        return null;
      }
    }

    function migrateOrSeed(body) {
      let initialBody = body || '';
      try {
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy != null && legacy.trim()) initialBody = legacy;
      } catch (e) { /* ignore */ }
      const note = { id: uid(), body: initialBody, updatedAt: Date.now() };
      return { notes: [note], activeId: note.id };
    }

    function persist() {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* full/disabled */ }
    }

    function list() {
      return state.notes
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((n) => ({
          id: n.id,
          title: deriveTitle(n.body),
          snippet: deriveSnippet(n.body),
          updatedAt: n.updatedAt,
          active: n.id === state.activeId,
        }));
    }

    function find(id) {
      return state.notes.filter((n) => n.id === id)[0] || null;
    }

    function active() {
      return find(state.activeId) || state.notes[0] || null;
    }

    function setActive(id) {
      if (find(id)) { state.activeId = id; persist(); }
      return active();
    }

    function create() {
      const note = { id: uid(), body: '', updatedAt: Date.now() };
      state.notes.push(note);
      state.activeId = note.id;
      persist();
      return note;
    }

    function updateBody(id, body) {
      const note = find(id);
      if (!note) return;
      note.body = body;
      note.updatedAt = Date.now();
      persist();
    }

    function remove(id) {
      state.notes = state.notes.filter((n) => n.id !== id);
      if (!state.notes.length) state.notes.push({ id: uid(), body: '', updatedAt: Date.now() });
      if (!find(state.activeId)) {
        state.activeId = list()[0].id; // most recent
      }
      persist();
      return active();
    }

    return {
      list: list,
      active: active,
      setActive: setActive,
      create: create,
      updateBody: updateBody,
      remove: remove,
    };
  }

  return { createStore: createStore, deriveTitle: deriveTitle, deriveSnippet: deriveSnippet };
});
