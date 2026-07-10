/*
 * store-postgres.js — PostgreSQL storage. Requires the `pg` package (see
 * server/README.md). The driver can be injected via opts.driver for testing.
 */
'use strict';

module.exports = function createPostgresStore(opts) {
  const ttlDays = opts.tombstoneTtlDays;
  let pool;

  return {
    kind: 'postgres',
    describe() { return (opts.connection && opts.connection.database) || 'postgres'; },
    async init() {
      const pg = opts.driver || require('pg');
      pool = new pg.Pool(opts.connection);
      await pool.query(
        'CREATE TABLE IF NOT EXISTS notes (' +
        '  ws text NOT NULL,' +
        '  id text NOT NULL,' +
        '  data text NOT NULL,' +
        '  updated_at bigint NOT NULL DEFAULT 0,' +
        '  deleted smallint NOT NULL DEFAULT 0,' +
        '  PRIMARY KEY (ws, id)' +
        ')');
      if (ttlDays) {
        const cutoff = Date.now() - ttlDays * 86400000;
        await pool.query('DELETE FROM notes WHERE deleted=1 AND updated_at < $1', [cutoff]);
      }
    },
    async all(ws) {
      const r = await pool.query('SELECT id, data FROM notes WHERE ws = $1', [ws]);
      const out = {};
      for (const row of r.rows) { try { out[row.id] = JSON.parse(row.data); } catch (e) { /* skip */ } }
      return out;
    },
    async put(ws, id, note) {
      await pool.query(
        'INSERT INTO notes (ws, id, data, updated_at, deleted) VALUES ($1, $2, $3, $4, $5)' +
        ' ON CONFLICT (ws, id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at, deleted=EXCLUDED.deleted',
        [ws, id, JSON.stringify(note), (note && note.updatedAt) || 0, note && note.deleted ? 1 : 0]);
    },
    async close() { if (pool) await pool.end(); },
  };
};
