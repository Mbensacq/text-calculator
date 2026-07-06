/*
 * engine.test.js — a tiny zero-dependency test runner for the calc engine.
 *
 * Run with:  node test/engine.test.js
 * Exits non-zero if any assertion fails, so it doubles as a CI check.
 */
'use strict';

const { evaluateDocument } = require('../src/engine.js');

let passed = 0;
let failed = 0;

// Normalise the thin/no-break grouping spaces to a plain space so test
// expectations can be written with ordinary spaces.
function norm(s) {
  return s == null ? s : s.replace(/[   ]/g, ' ');
}

// Evaluate a document and return a map of "line index -> displayed result",
// including error markers as "!<message>".
function run(text) {
  const { lines } = evaluateDocument(text);
  return lines.map((l) => norm(l.error ? '!' + l.error : (l.display != null ? l.display : null)));
}

// Assert the displayed result of a single-line document.
function expr(source, expected) {
  const out = run(source)[0];
  check(source, out, expected);
}

function check(label, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error('✗ ' + label);
    console.error('    attendu : ' + JSON.stringify(expected));
    console.error('    obtenu  : ' + JSON.stringify(actual));
  }
}

/* ---- arithmetic --------------------------------------------------- */
expr('1 + 2 * 3', '7');
expr('(1 + 2) * 3', '9');
expr('2 ^ 10', '1 024');
expr('10 / 4', '2.5');
expr('7 % 3', '0.21');          // 7% = 0.07, then implicit ×3
expr('2 + 3', '5');
expr('-5 + 8', '3');
expr('sqrt(144)', '12');
expr('round(3.14159)', '3');
expr('max(3, 9, 4)', '9');
expr('50%', '0.5');
expr('2 * 50%', '1');

/* ---- units -------------------------------------------------------- */
expr('10 km', '10 km');
expr('2 km + 500 m', '2.5 km');
expr('1 h + 30 min', '1.5 h');
expr('10 km / 2 h', '5 km/h');
expr('100 km/h * 2 h', '200 km');
expr('3 € + 4 €', '7 €');
expr('20% * 300 €', '60 €');
expr('10 km en m', '10 000 m');
expr('2 h en min', '120 min');
expr('1000 m en km', '1 km');

/* ---- labels (free-form counting) ---------------------------------- */
expr('3 pommes + 2 pommes', '5 pommes');
expr('4 cafés * 3', '12 cafés');

/* ---- forward references ------------------------------------------- */
check('forward ref', run(
  'vitesse = distance / temps\n' +
  'distance = 100 km\n' +
  'temps = 2 h'
)[0], '50 km/h');

check('use above define below', run(
  'total = a + b\n' +
  'a = 10\n' +
  'b = 32'
)[0], '42');

check('chained deferred', run(
  'c = a + b\n' +
  'b = a * 2\n' +
  'a = 5'
).slice(0, 3).join(' | '), '15 | 10 | 5');

/* ---- circular reference detection --------------------------------- */
const cyc = run('x = y + 1\ny = x + 1');
check('cycle detected', /référence circulaire/.test(cyc[0]) && /référence circulaire/.test(cyc[1]), true);

/* ---- prose stays silent ------------------------------------------- */
check('prose silent', run('Acheter du lait et du pain')[0], null);
check('heading silent', run('# Mes comptes')[0], null);
check('blank silent', run('')[0], null);

/* ---- variable reference on its own line --------------------------- */
check('lone var shows value', run('prix = 12 €\nprix').slice(0, 2).join(' | '), '12 € | 12 €');

/* ---- incompatible units error ------------------------------------- */
check('incompatible units', /incompatibles/.test(run('1 km + 1 kg')[0]), true);

/* ---- report ------------------------------------------------------- */
console.log('');
console.log(passed + ' réussis, ' + failed + ' échoués');
process.exit(failed ? 1 : 0);
