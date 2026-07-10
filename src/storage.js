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

  function gridTitle(grid) {
    if (grid && grid.cells) {
      for (let r = 0; r < (grid.rows || 0); r++) {
        for (let c = 0; c < (grid.cols || 0); c++) {
          const v = grid.cells[r + ',' + c];
          if (v && v.trim() && v.charAt(0) !== '=') return v.trim();
        }
      }
    }
    return 'Tableau';
  }

  function emptyGrid() {
    return { rows: 6, cols: 4, cells: {} };
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

    // Pinned notes float to the top; within a group, most-recent first.
    function sortNotes(a, b) {
      const pa = a.pinned ? 1 : 0;
      const pb = b.pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return b.updatedAt - a.updatedAt;
    }

    function toItem(n) {
      const title = n.type === 'grid' ? gridTitle(n.grid) : deriveTitle(n.body);
      const snippet = n.type === 'grid' ? 'Tableau' : deriveSnippet(n.body);
      const bodyText = n.type === 'grid' ? '' : (n.body || '');
      return {
        id: n.id,
        type: n.type || 'text',
        title: title,
        snippet: snippet,
        updatedAt: n.updatedAt,
        pinned: !!n.pinned,
        active: n.id === state.activeId,
        search: (title + ' ' + snippet + ' ' + bodyText).toLowerCase(),
      };
    }

    function visibleNotes() { return state.notes.filter((n) => !n.trashed); }

    function list() {
      return visibleNotes().slice().sort(sortNotes).map(toItem);
    }

    // Notes currently in the trash (most-recent first).
    function trashList() {
      return state.notes.filter((n) => n.trashed)
        .slice().sort((a, b) => b.updatedAt - a.updatedAt).map(toItem);
    }

    function find(id) {
      return state.notes.filter((n) => n.id === id)[0] || null;
    }

    // The active note, unless it has been trashed — then fall back to the most
    // relevant visible note (creating an empty one only if the trash is all).
    function active() {
      const a = find(state.activeId);
      if (a && !a.trashed) return a;
      const visible = visibleNotes().slice().sort(sortNotes);
      return visible[0] || state.notes[0] || null;
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

    function createGrid() {
      const note = { id: uid(), type: 'grid', grid: emptyGrid(), updatedAt: Date.now() };
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

    function updateGrid(id, grid) {
      const note = find(id);
      if (!note) return;
      note.grid = grid;
      note.updatedAt = Date.now();
      persist();
    }

    function getNote(id) {
      const n = find(id);
      if (!n) return null;
      const out = { id: n.id, type: n.type || 'text', updatedAt: n.updatedAt || 0 };
      if (out.type === 'grid') out.grid = n.grid || { rows: 6, cols: 4, cells: {} };
      else out.body = n.body || '';
      // Only carry the flags when set, to keep the synced payload lean. Absent
      // means false, so older payloads stay compatible.
      if (n.pinned) out.pinned = true;
      if (n.trashed) out.trashed = true;
      return out;
    }

    function allNotes() {
      return state.notes.map((n) => getNote(n.id));
    }

    // Merge a note coming from another device. Last-write-wins by updatedAt.
    // Returns 'added' | 'updated' | 'ignored'. Never changes the active note.
    function applyRemote(id, remote) {
      const ts = remote.updatedAt || 0;
      const existing = find(id);
      if (existing) {
        if (ts <= (existing.updatedAt || 0)) return 'ignored';
        existing.type = remote.type || 'text';
        if (existing.type === 'grid') { existing.grid = remote.grid || { rows: 6, cols: 4, cells: {} }; delete existing.body; }
        else { existing.body = remote.body || ''; delete existing.grid; }
        existing.pinned = !!remote.pinned;
        existing.trashed = !!remote.trashed;
        existing.updatedAt = ts;
        persist();
        return 'updated';
      }
      const note = { id: id, type: remote.type || 'text', updatedAt: ts };
      if (note.type === 'grid') note.grid = remote.grid || { rows: 6, cols: 4, cells: {} };
      else note.body = remote.body || '';
      if (remote.pinned) note.pinned = true;
      if (remote.trashed) note.trashed = true;
      state.notes.push(note);
      persist();
      return 'added';
    }

    // Pin / unpin. Bumps updatedAt so the change also propagates over sync.
    function togglePin(id) {
      const n = find(id);
      if (!n) return false;
      n.pinned = !n.pinned;
      n.updatedAt = Date.now();
      persist();
      return n.pinned;
    }

    // Soft delete: move to (or out of) the trash. Recoverable, and it syncs.
    // Trashing the active note hands the focus to the next visible note.
    function setTrashed(id, val) {
      const n = find(id);
      if (!n) return;
      n.trashed = !!val;
      n.updatedAt = Date.now();
      if (val && state.activeId === id) {
        const next = visibleNotes().slice().sort(sortNotes)[0];
        if (next) state.activeId = next.id;
        else {
          const fresh = { id: uid(), body: '', updatedAt: Date.now() };
          state.notes.push(fresh);
          state.activeId = fresh.id;
        }
      }
      persist();
    }

    // Permanent delete (from the trash). The caller is expected to also send a
    // sync tombstone so the deletion reaches other devices.
    function remove(id) {
      state.notes = state.notes.filter((n) => n.id !== id);
      if (!visibleNotes().length) {
        const fresh = { id: uid(), body: '', updatedAt: Date.now() };
        state.notes.push(fresh);
        state.activeId = fresh.id;
      } else {
        const cur = find(state.activeId);
        if (!cur || cur.trashed) state.activeId = list()[0].id; // most relevant visible
      }
      persist();
      return active();
    }

    return {
      list: list,
      trashList: trashList,
      togglePin: togglePin,
      setTrashed: setTrashed,
      active: active,
      setActive: setActive,
      create: create,
      createGrid: createGrid,
      updateBody: updateBody,
      updateGrid: updateGrid,
      remove: remove,
      getNote: getNote,
      allNotes: allNotes,
      applyRemote: applyRemote,
    };
  }

  return { createStore: createStore, deriveTitle: deriveTitle, deriveSnippet: deriveSnippet };
});
