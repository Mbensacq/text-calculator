/*
 * storage.js — a tiny note collection backed by localStorage.
 *
 * A note is a *stack of blocks*:
 *   { id, blocks: [ {type:'text', body} | {type:'grid', grid} ], updatedAt,
 *     pinned?, trashed? }
 *
 * A note's title is derived from its first meaningful block (Apple-Notes
 * style), so there is no separate title field. The store persists on every
 * change, migrates the old single-note key, and upgrades legacy notes (which
 * had a `type` + `body`/`grid`) to the block model on read.
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
    return '';
  }

  function deriveSnippet(body) {
    const lines = (body || '').split('\n').map((l) => l.trim()).filter(Boolean);
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

  function emptyGrid() { return { rows: 6, cols: 4, cells: {} }; }
  function textBlock(body) { return { type: 'text', body: body || '' }; }
  function gridBlock(grid) { return { type: 'grid', grid: grid || emptyGrid() }; }

  // Normalise any note-ish object into a blocks array (upgrades legacy notes
  // and remote payloads that predate the block model).
  function imageBlock(src, caption) { return { type: 'image', src: src || '', caption: caption || '' }; }

  function toBlocks(src) {
    if (src && Array.isArray(src.blocks) && src.blocks.length) {
      return src.blocks.map(function (b) {
        if (b && b.type === 'grid') return gridBlock(b.grid);
        if (b && b.type === 'image') return imageBlock(b.src, b.caption);
        return textBlock(b ? b.body : '');
      });
    }
    if (src && src.type === 'grid') return [gridBlock(src.grid)];
    return [textBlock(src ? src.body : '')];
  }

  function normalise(note) {
    return {
      id: note.id || uid(),
      blocks: toBlocks(note),
      updatedAt: note.updatedAt || Date.now(),
      pinned: !!note.pinned,
      trashed: !!note.trashed,
    };
  }

  function firstText(note) {
    for (const b of note.blocks) if (b.type === 'text') return b.body || '';
    return '';
  }

  function noteTitle(note) {
    for (const b of note.blocks) {
      if (b.type === 'grid') return gridTitle(b.grid);
      const t = deriveTitle(b.body);
      if (t) return t;
    }
    return 'Note sans titre';
  }

  function noteSnippet(note) {
    const tables = note.blocks.filter((b) => b.type === 'grid').length;
    const snip = deriveSnippet(firstText(note));
    if (snip) return snip + (tables ? ' · ' + tables + ' tableau' + (tables > 1 ? 'x' : '') : '');
    if (tables) return tables + ' tableau' + (tables > 1 ? 'x' : '');
    return '';
  }

  function noteSearch(note) {
    const parts = [];
    for (const b of note.blocks) {
      if (b.type === 'text') parts.push(b.body || '');
      else if (b.type === 'grid') parts.push(gridTitle(b.grid), Object.values((b.grid && b.grid.cells) || {}).join(' '));
      else if (b.type === 'image') parts.push(b.caption || '');
    }
    return parts.join(' ').toLowerCase();
  }

  function hasTable(note) { return note.blocks.some((b) => b.type === 'grid'); }

    // options: { key, seedNotes }. A separate key gives an isolated space (e.g.
    // the demo sandbox); seedNotes pre-populates it the first time.
  function createStore(seedBody, options) {
    options = options || {};
    const storeKey = options.key || KEY;
    let state = read();
    if (!state) state = migrateOrSeed(seedBody);

    function read() {
      try {
        const raw = localStorage.getItem(storeKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.notes) || !parsed.notes.length) return null;
        parsed.notes = parsed.notes.map(normalise); // upgrade legacy shapes
        return parsed;
      } catch (e) {
        return null;
      }
    }

    function migrateOrSeed(body) {
      if (options.seedNotes && options.seedNotes.length) {
        const base = Date.now();
        const notes = options.seedNotes.map(function (n, i) {
          return normalise({ blocks: toBlocks(n), updatedAt: base + (options.seedNotes.length - i) });
        });
        return { notes: notes, activeId: notes[0].id };
      }
      let initialBody = body || '';
      try {
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy != null && legacy.trim()) initialBody = legacy;
      } catch (e) { /* ignore */ }
      const note = normalise({ id: uid(), blocks: [textBlock(initialBody)] });
      return { notes: [note], activeId: note.id };
    }

    function persist() {
      try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch (e) { /* full/disabled */ }
    }

    function sortNotes(a, b) {
      const pa = a.pinned ? 1 : 0;
      const pb = b.pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return b.updatedAt - a.updatedAt;
    }

    function toItem(n) {
      return {
        id: n.id,
        title: noteTitle(n),
        snippet: noteSnippet(n),
        updatedAt: n.updatedAt,
        pinned: !!n.pinned,
        hasTable: hasTable(n),
        active: n.id === state.activeId,
        search: noteSearch(n),
      };
    }

    function visibleNotes() { return state.notes.filter((n) => !n.trashed); }
    function list() { return visibleNotes().slice().sort(sortNotes).map(toItem); }
    function trashList() {
      return state.notes.filter((n) => n.trashed)
        .slice().sort((a, b) => b.updatedAt - a.updatedAt).map(toItem);
    }

    function find(id) { return state.notes.filter((n) => n.id === id)[0] || null; }

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
      const note = normalise({ id: uid(), blocks: [textBlock('')] });
      state.notes.push(note);
      state.activeId = note.id;
      persist();
      return note;
    }

    function createGrid() {
      const note = normalise({ id: uid(), blocks: [gridBlock(emptyGrid())] });
      state.notes.push(note);
      state.activeId = note.id;
      persist();
      return note;
    }

    // Replace a note's blocks wholesale (the note editor owns the block array).
    function updateBlocks(id, blocks) {
      const note = find(id);
      if (!note) return;
      note.blocks = toBlocks({ blocks: blocks });
      note.updatedAt = Date.now();
      persist();
    }

    function getNote(id) {
      const n = find(id);
      if (!n) return null;
      const out = { id: n.id, updatedAt: n.updatedAt || 0, blocks: toBlocks(n) };
      if (n.pinned) out.pinned = true;
      if (n.trashed) out.trashed = true;
      return out;
    }

    function allNotes() { return state.notes.map((n) => getNote(n.id)); }

    // Full backup of this space (including trashed notes). Import merges with
    // last-write-wins, so restoring on another device never loses newer edits.
    function exportAll() {
      return { app: 'text-calculator', version: 1, exportedAt: Date.now(), notes: allNotes() };
    }
    function importAll(data) {
      if (!data || !Array.isArray(data.notes)) return { added: 0, updated: 0, ignored: 0 };
      let added = 0, updated = 0, ignored = 0;
      for (const n of data.notes) {
        if (!n || !n.id) { ignored++; continue; }
        const r = applyRemote(n.id, n);
        if (r === 'added') added++;
        else if (r === 'updated') updated++;
        else ignored++;
      }
      return { added: added, updated: updated, ignored: ignored };
    }

    // Merge a note from another device. Last-write-wins by updatedAt. Accepts
    // both the block shape and the legacy {type, body/grid} shape.
    function applyRemote(id, remote) {
      const ts = remote.updatedAt || 0;
      const existing = find(id);
      if (existing) {
        if (ts <= (existing.updatedAt || 0)) return 'ignored';
        existing.blocks = toBlocks(remote);
        existing.pinned = !!remote.pinned;
        existing.trashed = !!remote.trashed;
        existing.updatedAt = ts;
        persist();
        return 'updated';
      }
      const note = normalise({ id: id, blocks: toBlocks(remote), updatedAt: ts,
        pinned: remote.pinned, trashed: remote.trashed });
      state.notes.push(note);
      persist();
      return 'added';
    }

    function togglePin(id) {
      const n = find(id);
      if (!n) return false;
      n.pinned = !n.pinned;
      n.updatedAt = Date.now();
      persist();
      return n.pinned;
    }

    function setPinned(id, val) {
      const n = find(id);
      if (!n) return;
      n.pinned = !!val;
      n.updatedAt = Date.now();
      persist();
    }

    function setTrashed(id, val) {
      const n = find(id);
      if (!n) return;
      n.trashed = !!val;
      n.updatedAt = Date.now();
      if (val && state.activeId === id) {
        const next = visibleNotes().slice().sort(sortNotes)[0];
        if (next) state.activeId = next.id;
        else {
          const fresh = normalise({ id: uid(), blocks: [textBlock('')] });
          state.notes.push(fresh);
          state.activeId = fresh.id;
        }
      }
      persist();
    }

    function remove(id) {
      state.notes = state.notes.filter((n) => n.id !== id);
      if (!visibleNotes().length) {
        const fresh = normalise({ id: uid(), blocks: [textBlock('')] });
        state.notes.push(fresh);
        state.activeId = fresh.id;
      } else {
        const cur = find(state.activeId);
        if (!cur || cur.trashed) state.activeId = list()[0].id;
      }
      persist();
      return active();
    }

    return {
      list: list,
      trashList: trashList,
      togglePin: togglePin,
      setPinned: setPinned,
      setTrashed: setTrashed,
      active: active,
      setActive: setActive,
      create: create,
      createGrid: createGrid,
      updateBlocks: updateBlocks,
      remove: remove,
      getNote: getNote,
      allNotes: allNotes,
      applyRemote: applyRemote,
      exportAll: exportAll,
      importAll: importAll,
    };
  }

  return {
    createStore: createStore,
    deriveTitle: deriveTitle,
    deriveSnippet: deriveSnippet,
    emptyGrid: emptyGrid,
    textBlock: textBlock,
    gridBlock: gridBlock,
  };
});
