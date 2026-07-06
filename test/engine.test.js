/*
 * engine.test.js — a tiny zero-dependency test runner for the calc engine.
 *
 * Run with:  node test/engine.test.js
 * Exits non-zero if any assertion fails, so it doubles as a CI check.
 *
 * Reminder of the model: a line produces a visible result only when it ends
 * with "=". The helper expr() appends " =" so single expressions can be tested
 * concisely.
 */
'use strict';

const { evaluateDocument } = require('../src/engine.js');

let passed = 0;
let failed = 0;

function norm(s) {
  return s == null ? s : s.replace(/\s/g, ' ');
}

// Evaluate a document → array of "displayed result" per line (or "!error").
function run(text) {
  const { lines } = evaluateDocument(text);
  return lines.map((l) => norm(l.error ? '!' + l.error : (l.display != null ? l.display : null)));
}

// Evaluate a single expression (a trailing " =" is added to request a result).
function expr(source, expected) {
  check(source, run(source + ' =')[0], expected);
}

function check(label, actual, expected) {
  if (typeof actual === 'string') actual = norm(actual);
  if (typeof expected === 'string') expected = norm(expected);
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error('✗ ' + label);
    console.error('    attendu : ' + JSON.stringify(expected));
    console.error('    obtenu  : ' + JSON.stringify(actual));
  }
}

/* ---- the "=" trigger ---------------------------------------------- */
check('no equals → no result', run('2 + 3')[0], null);
check('conversion without = is silent', run('90 km/h en m/s')[0], null);
check('assignment alone is silent', run('x = 5')[0], null);
check('display a variable with name =', run('x = 5\nx =')[1], '5');

/* ---- arithmetic --------------------------------------------------- */
expr('1 + 2 * 3', '7');
expr('(1 + 2) * 3', '9');
expr('2 ^ 10', '1 024');
expr('10 / 4', '2.5');
expr('-5 + 8', '3');
expr('sqrt(144)', '12');
expr('round(3.14159)', '3');
expr('max(3, 9, 4)', '9');
expr('50%', '0.5');
expr('2 * 50%', '1');
expr('300 € + 20%', '360 €');
expr('300 € - 10%', '270 €');
expr('20% + 30%', '0.5');

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
expr('90 km/h en m/s', '25 m/s');

/* ---- labels ------------------------------------------------------- */
expr('3 pommes + 2 pommes', '5 pommes');
expr('4 cafés * 3', '12 cafés');

/* ---- lists -------------------------------------------------------- */
check('list literal', run('list = 1, 2, 3\nlist =')[1], '1, 2, 3');
expr('sum(1, 2, 3)', '6');
expr('moyenne(1, 2, 3, 4)', '2.5');
expr('min(4, 2, 8)', '2');
check('sum of a list variable', run('l = 1, 2, 3, 4\nsum(l) =')[1], '10');
check('list arithmetic', run('l = 1, 2, 3\nl * 2 =')[1], '2, 4, 6');
check('list with units', run('d = 1 km, 2 km, 3 km\nsum(d) =')[1], '6 km');

/* ---- parenthesised lists ------------------------------------------ */
expr('(1, 2, 3)', '1, 2, 3');
expr('sum((1, 2, 3))', '6');
check('parenthesised list variable', run('liste = (1, 2, ..., 10)\nliste =')[1], '1, 2, 3, 4, 5, 6, 7, 8, 9, 10');
check('grouping still works', run('(2 + 3) * 4 =')[0], '20');

/* ---- ranges ("…") ------------------------------------------------- */
expr('sum(1, 2, ..., 8)', '36');
check('range literal', run('1, ..., 5 =')[0], '1, 2, 3, 4, 5');
expr('sum(1, ..., 100)', '5 050');
expr('sum(2, 4, ..., 10)', '30');

/* ---- indexing (0-based, computer-science style) ------------------- */
check('index a list', run('l = 1, 2, 3, 4\nl[3] =')[1], '4');
check('index zero', run('l = (10, 20, 30)\nl[0] =')[1], '10');
check('negative index', run('l = 1, 2, 3\nl[-1] =')[1], '3');
check('index out of range', /hors de la liste/.test(run('l = 1, 2\nl[5] =')[1]), true);
expr('(5, 6, 7)[1]', '6');

/* ---- maths for students ------------------------------------------- */
expr('5!', '120');
expr('fact(6)', '720');
expr('pgcd(12, 18)', '6');
expr('ppcm(4, 6)', '12');
expr('combin(5, 2)', '10');
expr('nPr(5, 2)', '20');
expr('log(1000)', '3');
expr('log(8, 2)', '3');
expr('median(1, 2, 3, 4, 5)', '3');
expr('median(1, 2, 3, 4)', '2.5');
expr('produit(1, 2, 3, 4)', '24');
expr('root(27, 3)', '3');
expr('ecarttype(2, 4, 4, 4, 5, 5, 7, 9)', '2');
expr('sin(pi / 2)', '1');
expr('round(phi * 1000)', '1 618');

/* ---- forward references ------------------------------------------- */
check('forward ref', run(
  'vitesse =\n' +
  'distance = 100 km\n' +
  'temps = 2 h\n' +
  'vitesse = distance / temps'
)[0], '50 km/h');

check('use above define below', run(
  'total =\n' +
  'a = 10\n' +
  'b = 32\n' +
  'total = a + b'
)[0], '42');

check('assignment can also show its value', run('total = 2 € + 3 € =')[0], '5 €');

/* ---- circular reference detection --------------------------------- */
const cyc = run('x =\ny =\nx = y + 1\ny = x + 1');
check('cycle detected', /circulaire/.test(cyc[0]) && /circulaire/.test(cyc[1]), true);

/* ---- prose stays silent ------------------------------------------- */
check('prose silent', run('Acheter du lait et du pain')[0], null);
check('heading silent', run('# Mes comptes')[0], null);

/* ---- incompatible units error ------------------------------------- */
check('incompatible units', /incompatibles/.test(run('1 km + 1 kg =')[0]), true);

/* ---- report ------------------------------------------------------- */
console.log('');
console.log(passed + ' réussis, ' + failed + ' échoués');
process.exit(failed ? 1 : 0);
