/*
 * browser.test.js — end-to-end smoke tests in a real browser.
 *
 * Serves the repo over a local HTTP server and drives it with Chromium via
 * playwright-core, exercising the paths a Node test can't: the note editor,
 * cross-block references, the command palette and settings.
 *
 * Run:  node test/browser.test.js
 * Chromium is located from $CHROMIUM_PATH, a bundled Playwright install, or a
 * few well-known locations. If none is found the test skips (exit 0) so CI on a
 * runner without a browser stays green — the Node suite remains the gate.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) return process.env.CHROMIUM_PATH;
  const bases = ['/opt/pw-browsers', path.join(process.env.HOME || '', '.cache/ms-playwright')];
  for (const base of bases) {
    try {
      for (const dir of fs.readdirSync(base)) {
        if (!/^chromium-\d/.test(dir)) continue;
        for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
          const p = path.join(base, dir, rel);
          if (fs.existsSync(p)) return p;
        }
      }
    } catch (e) { /* base missing */ }
  }
  return null;
}

function startServer() {
  const server = http.createServer(function (req, res) {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { resolve(server); }); });
}

let passed = 0, failed = 0;
function check(label, cond) { if (cond) { passed++; } else { failed++; console.error('  ✗ ' + label); } }

(async function () {
  const exe = findChromium();
  if (!exe) { console.log('… Chromium introuvable — test navigateur ignoré (la suite Node reste le garde-fou).'); process.exit(0); }

  let chromium;
  try { chromium = require('playwright-core').chromium; }
  catch (e) { console.log('… playwright-core absent — test navigateur ignoré.'); process.exit(0); }

  const server = await startServer();
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port + '/index.html?demo';
  const browser = await chromium.launch({ executablePath: exe });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', function (e) { errors.push(String(e)); });
    page.on('console', function (m) { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    // 1) Engine works in the browser.
    const eng = await page.evaluate(function () {
      return {
        pct: TC.evaluateDocument('40 sur 250 =').lines[0].display,
        ttc: TC.evaluateDocument('ttc(100 €) =').lines[0].display,
      };
    });
    check('moteur : 40 sur 250 = 16 %', eng.pct === '16 %');
    check('moteur : ttc(100 €) = 120 €', eng.ttc === '120 €');

    // 2) Note editor + cross-block cell reference.
    const cross = await page.evaluate(async function () {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const ne = TC.createNoteEditor({ container: host, onChange: function () {}, completions: [] });
      ne.setNote({ id: 'x', blocks: [
        { type: 'grid', grid: { rows: 2, cols: 1, cells: { '0,0': '10', '1,0': '=A1*2' }, name: 'T1' } },
        { type: 'text', body: 'val = T1!A2 =' },
      ] });
      await new Promise(function (r) { setTimeout(r, 200); });
      const chip = host.querySelector('.calc-result__pill');
      return chip ? chip.textContent : null;
    });
    check('note : référence de cellule qualifiée (T1!A2 = 20)', cross === '20');

    // 3) Command palette opens on Ctrl/Cmd+K.
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(120);
    const paletteOpen = await page.evaluate(function () { const el = document.querySelector('.cmdk'); return !!(el && !el.hidden); });
    check('palette de commandes s’ouvre (Ctrl+K)', paletteOpen);
    await page.keyboard.press('Escape');

    // 4) Settings apply a dark theme.
    await page.evaluate(function () { document.getElementById('settings-btn').click(); });
    await page.selectOption('#set-theme', 'dark');
    await page.waitForTimeout(120);
    const theme = await page.evaluate(function () { return document.documentElement.getAttribute('data-theme'); });
    check('réglages : thème sombre appliqué', theme === 'dark');

    check('aucune erreur console', errors.length === 0);
    if (errors.length) console.error('  erreurs:', errors.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }

  console.log('');
  console.log(passed + ' réussis, ' + failed + ' échoués (navigateur)');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error('FATAL', e); process.exit(1); });
