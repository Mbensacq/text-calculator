/*
 * store.js — picks the storage backend from the environment.
 *
 *   DATABASE_URL set → SQL (engine inferred from the URL scheme, or DB_CLIENT)
 *   otherwise        → the zero-dependency JSON file store
 *
 * SQL connection can also be given piecemeal (DB_HOST/DB_USER/…). TLS is
 * enabled with DB_SSL=1 (set DB_SSL_INSECURE=1 to skip certificate checks).
 * All storage backends share the async interface: init/all/put/close.
 */
'use strict';

const path = require('path');

function bool(v) { return /^(1|true|yes|on)$/i.test(String(v || '')); }

function connectionFromUrl(url, ssl) {
  const u = new URL(url);
  const cfg = {
    host: u.hostname,
    port: u.port ? Number(u.port) : undefined,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
  if (ssl.on) cfg.ssl = { rejectUnauthorized: !ssl.insecure };
  return cfg;
}

function inferClient(url) {
  const scheme = String(url).split(':')[0].toLowerCase();
  if (scheme === 'postgres' || scheme === 'postgresql') return 'postgres';
  return 'mysql'; // mysql, mariadb, or anything else → mysql2
}

module.exports = function createStore(env) {
  env = env || process.env;
  const ttlDays = Number(env.TOMBSTONE_TTL_DAYS != null ? env.TOMBSTONE_TTL_DAYS : 90);
  const url = env.DATABASE_URL;

  if (url || env.DB_CLIENT || env.DB_HOST) {
    const client = env.DB_CLIENT || (url ? inferClient(url) : 'mysql');
    const ssl = { on: bool(env.DB_SSL), insecure: bool(env.DB_SSL_INSECURE) };
    const connection = url ? connectionFromUrl(url, ssl) : {
      host: env.DB_HOST,
      port: env.DB_PORT ? Number(env.DB_PORT) : undefined,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      ssl: ssl.on ? { rejectUnauthorized: !ssl.insecure } : undefined,
    };
    const opts = { connection: connection, tombstoneTtlDays: ttlDays, driver: env.__driver };
    return client === 'postgres'
      ? require('./store-postgres')(opts)
      : require('./store-mysql')(opts);
  }

  return require('./store-file')({
    dataFile: env.DATA_FILE || path.join(__dirname, 'data', 'notes.json'),
    tombstoneTtlDays: ttlDays,
  });
};
