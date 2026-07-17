/*
 * history.js — per-note version history (local snapshots).
 *
 * Distinct from undo.js: undo is the live in-memory stack for the note being
 * edited; this keeps a persisted, time-spaced timeline of a note's past states
 * so an older version can be restored days later. Snapshots are coalesced
 * within `minIntervalMs` so a long editing session leaves a handful of marks,
 * not thousands.
 */
(function (root, factory) {
  const mod = factory();
  root.TC = root.TC || {};
  root.TC.createHistory = mod.createHistory;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createHistory(opts) {
    opts = opts || {};
    const key = opts.key || 'tc-history';
    const limit = opts.limitPerNote || 20;
    const minInterval = opts.minIntervalMs || 120000; // coalesce within 2 min

    function load() { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; } }
    function save(map) { try { localStorage.setItem(key, JSON.stringify(map)); } catch (e) { /* full/disabled */ } }

    function record(noteId, blocks, nowArg) {
      if (!noteId) return;
      const now = nowArg || Date.now();
      const map = load();
      const arr = map[noteId] || (map[noteId] = []);
      const json = JSON.stringify(blocks);
      const last = arr[arr.length - 1];
      if (last && last.json === json) return;                 // nothing changed
      // Coalesce within the window, but keep the window ANCHORED to the first
      // edit of the cluster (don't advance last.t) — otherwise a continuous
      // session slides the window forever and collapses to a single version.
      if (last && (now - last.t) < minInterval) { last.json = json; }
      else arr.push({ t: now, json: json });
      while (arr.length > limit) arr.shift();
      save(map);
    }

    // Newest first.
    function versions(noteId) {
      const arr = (load()[noteId] || []).slice().reverse();
      return arr.map(function (v) { return { t: v.t, blocks: JSON.parse(v.json) }; });
    }

    function clear(noteId) { const map = load(); delete map[noteId]; save(map); }

    return { record: record, versions: versions, clear: clear };
  }

  return { createHistory: createHistory };
});
