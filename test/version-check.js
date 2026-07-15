/*
 * version-check.js — guard the cache-busting discipline.
 *
 * Every "?v=N" in index.html, every "?v=N" in the service worker's asset list,
 * and the service-worker cache name (text-calculator-vN) must all carry the
 * SAME N. A mismatch means a stale asset could be served after a deploy, so CI
 * fails loudly instead.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function versions(text) {
  const set = new Set();
  const re = /\?v=(\d+)/g;
  let m;
  while ((m = re.exec(text))) set.add(m[1]);
  return set;
}

const htmlV = versions(html);
const swV = versions(sw);
const cacheMatch = /text-calculator-v(\d+)/.exec(sw);
const cacheV = cacheMatch ? cacheMatch[1] : null;

const all = new Set([...htmlV, ...swV, cacheV].filter(Boolean));

if (all.size !== 1 || !cacheV) {
  console.error('✗ Version mismatch across cache-busting markers:');
  console.error('  index.html ?v=  :', [...htmlV].join(', ') || '(none)');
  console.error('  sw.js ?v=       :', [...swV].join(', ') || '(none)');
  console.error('  sw.js cache name:', cacheV || '(none)');
  console.error('All of these must share a single version number.');
  process.exit(1);
}

console.log('✓ Toutes les versions d’assets sont alignées : v' + cacheV);
