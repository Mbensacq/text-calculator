/*
 * store-file.js — default storage: a single JSON file, written atomically.
 * Zero dependencies. Used when no DATABASE_URL / DB_CLIENT is configured.
 */
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = function createFileStore(opts) {
  const DATA_FILE = opts.dataFile;
  const ttlDays = opts.tombstoneTtlDays;
  let db = {};              // { ws: { id: note } }
  let saveTimer = null;

  function prune() {
    if (!ttlDays) return;
    const cutoff = Date.now() - ttlDays * 86400000;
    for (const ws in db) {
      for (const id in db[ws]) {
        const n = db[ws][id];
        if (n && n.deleted && (n.updatedAt || 0) < cutoff) delete db[ws][id];
      }
    }
  }
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(save, 500);
  }
  function save() {
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

  return {
    kind: 'file',
    describe() { return DATA_FILE; },
    async init() {
      try {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object') db = parsed;
      } catch (e) { db = {}; }
      prune();
    },
    async all(ws) { return db[ws] || {}; },
    async put(ws, id, note) { (db[ws] = db[ws] || {})[id] = note; scheduleSave(); },
    async close() { if (saveTimer) clearTimeout(saveTimer); save(); },
  };
};
