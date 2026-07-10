/*
 * store-mysql.js — MySQL / MariaDB storage (the usual Infomaniak database).
 * Requires the `mysql2` package (see server/README.md). The driver can be
 * injected via opts.driver for testing.
 */
'use strict';

module.exports = function createMysqlStore(opts) {
  const ttlDays = opts.tombstoneTtlDays;
  let pool;

  return {
    kind: 'mysql',
    describe() { return (opts.connection && opts.connection.database) || 'mysql'; },
    async init() {
      const mysql = opts.driver || require('mysql2/promise');
      pool = mysql.createPool(Object.assign({
        waitForConnections: true,
        connectionLimit: 5,
        charset: 'utf8mb4',
      }, opts.connection));
      await pool.query(
        'CREATE TABLE IF NOT EXISTS notes (' +
        '  ws VARCHAR(191) NOT NULL,' +
        '  id VARCHAR(191) NOT NULL,' +
        '  data MEDIUMTEXT NOT NULL,' +
        '  updated_at BIGINT NOT NULL DEFAULT 0,' +
        '  deleted TINYINT NOT NULL DEFAULT 0,' +
        '  PRIMARY KEY (ws, id)' +
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
      if (ttlDays) {
        const cutoff = Date.now() - ttlDays * 86400000;
        await pool.query('DELETE FROM notes WHERE deleted=1 AND updated_at < ?', [cutoff]);
      }
    },
    async all(ws) {
      const [rows] = await pool.query('SELECT id, data FROM notes WHERE ws = ?', [ws]);
      const out = {};
      for (const r of rows) { try { out[r.id] = JSON.parse(r.data); } catch (e) { /* skip */ } }
      return out;
    },
    async put(ws, id, note) {
      await pool.query(
        'INSERT INTO notes (ws, id, data, updated_at, deleted) VALUES (?, ?, ?, ?, ?)' +
        ' ON DUPLICATE KEY UPDATE data=VALUES(data), updated_at=VALUES(updated_at), deleted=VALUES(deleted)',
        [ws, id, JSON.stringify(note), (note && note.updatedAt) || 0, note && note.deleted ? 1 : 0]);
    },
    async close() { if (pool) await pool.end(); },
  };
};
