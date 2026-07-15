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

/* ---- user-defined functions --------------------------------------- */
check('user function', run('f(x) = x^2 + 1\nf(3) =')[1], '10');
check('multi-arg function', run('aire(l, h) = l * h\naire(3, 4) =')[1], '12');
check('function uses a global var', run('g(x) = x * k\nk = 10\ng(5) =')[2], '50');
check('function with units', run('vitesse(d, t) = d / t\nvitesse(100 km, 2 h) =')[1], '50 km/h');
check('function defined below its call', run('h(2) =\nh(x) = x + 1')[0], '3');
check('function wrong arity', /attend 1 argument/.test(run('f(x) = x\nf(1, 2) =')[1]), true);
check('function of a list', run('doubler(l) = l * 2\ndoubler((1, 2, 3)) =')[1], '2, 4, 6');

/* ---- comparisons & conditionals ----------------------------------- */
expr('3 > 2', '1');
expr('2 > 3', '0');
expr('5 == 5', '1');
expr('5 != 5', '0');
expr('2 + 2 <= 4', '1');
expr('1 km == 1000 m', '1');
expr('si(3 > 2, 10, 20)', '10');
expr('si(3 < 2, 10, 20)', '20');
expr('et(1, 1)', '1');
expr('et(1, 0)', '0');
expr('ou(0, 1)', '1');
expr('non(0)', '1');
check('moy alias', run('moy(2, 4, 6) =')[0], '4');

/* ---- recursion via a base case ------------------------------------ */
check('recursive factorial', run('f(n) = si(n <= 1, 1, n * f(n - 1))\nf(5) =')[1], '120');
check('piecewise (absolute value)', run('a(x) = si(x < 0, -x, x)\na(-7) =')[1], '7');
check('fibonacci', run('fib(n) = si(n < 2, n, fib(n-1) + fib(n-2))\nfib(10) =')[1], '55');

/* ---- temperatures -------------------------------------------------- */
expr('20 °C', '20 °C');
expr('20 °C en °F', '68 °F');
expr('100 °C en K', '373.15 K');
expr('37 °C en °F', '98.6 °F');

/* ---- indexed sum (Σ) ---------------------------------------------- */
expr('Σ(i, 1, 10, i)', '55');
expr('Σ(i, 1, 5, i^2)', '55');
expr('sigma(k, 1, 4, 2 * k)', '20');
expr('somme(i, 1, 100, i)', '5 050');
expr('sum(1, 2, 3)', '6'); // list form still works

/* ---- inline comments ---------------------------------------------- */
check('comment on a definition', run('x = 5 // le prix\nx =')[1], '5');
check('comment on an expression', run('2 + 3 = // somme')[0], '5');
check('url is not a comment', run('voir https://ex.com\n2 + 2 =')[1], '4');

/* ---- ans / total --------------------------------------------------- */
check('ans is the previous value', run('10 =\nans + 5 =')[1], '15');
check('total sums the block', run('# X\nlait = 1.15 €\npain = 2.90 €\ntotal =')[3], '4.05 €');
check('total resets on a blank line', run('a = 3 €\ntotal =\n\nb = 5 €\ntotal =').filter(Boolean).join(' | '), '3 € | 5 €');
check('a user-defined total wins', run('total = 99 €\ntotal =')[1], '99 €');

/* ---- spreadsheet cells & ranges ----------------------------------- */
const TABLE = [
  '| Article | Qté | PU   | Total  |',
  '| sticker | 2   | 3 €  | =B2*C2 |',
  '| badge   | 3   | 2 €  | =B3*C3 |',
  '| print   | 1   | 10 € | =B4*C4 |',
].join('\n');
check('cell reference', run(TABLE + '\nB3 =')[4], '3');
check('cell with units', run(TABLE + '\nC4 =')[4], '10 €');
check('in-cell formula shows on the row', run(TABLE)[1], '6 €');
check('range sum', run(TABLE + '\nsomme(D2:D4) =')[4], '22 €');
check('range average', run(TABLE + '\nmoy(C2:C4) =')[4], '5 €');
check('range across columns', run(TABLE + '\nsomme(B2:B4) =')[4], '6');
check('markdown separator is skipped', run(
  '| a | b |\n|---|---|\n| 1 | 2 |\nsomme(A2:B2) =')[3], '3');

/* ---- robustness ---------------------------------------------------- */
check('division by zero', /division par z/.test(run('1 / 0 =')[0]), true);
check('deep recursion guarded', /récursion trop profonde/.test(run('r(n) = r(n) + 1\nr(1) =')[1]), true);
check('heavy recursion budget', /trop long/.test(run('fib(n) = si(n < 2, n, fib(n-1) + fib(n-2))\nfib(40) =')[1]), true);
check('unknown function', /inconnue/.test(run('bidule(3) =')[0]), true);

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

/* ---- dates & durations -------------------------------------------- */
expr('15/03/2026 - 10/01/2026', '64 jours');
expr('2026-03-15 - 2026-03-10', '5 jours');       // ISO form
expr('10/01/2026 + 30 jours', '09/02/2026');
expr('10/01/2026 - 1 semaine', '03/01/2026');
expr('1 semaine + 10/01/2026', '17/01/2026');     // duration + date commutes
expr('10/01/2026 + 12 h', '10/01/2026 12:00');    // sub-day component shows time
expr('date(25, 12, 2026)', '25/12/2026');
expr('mois(15/03/2026)', '3');
expr('jour(15/03/2026)', '15');
// Relative-day keywords are deterministic *relative to each other*.
expr('demain - aujourd\'hui', '1 jours');
expr('aujourd\'hui - hier', '1 jours');
expr('demain > aujourdhui', '1');
expr('hier >= demain', '0');
// Date literals must not clobber ordinary arithmetic.
expr('1/2/4', '0.125');
expr('2026 - 3', '2 023');
check('invalid date op', /date/.test(run('15/03/2026 + 10/01/2026 =')[0]), true);

/* ---- cash register ------------------------------------------------ */
expr('rendu(20 €, 17 €)', '3 €');
expr('monnaie(50 €, 42.50 €)', '7.5 €');
check('caisse daily total', run('v = 8 €, 23 €, 10 €, 6 €\nsomme(v) =')[1], '47 €');
check('caisse count', run('v = 8 €, 23 €, 10 €, 6 €\ncount(v) =')[1], '4');

/* ---- relational percentages (displayed with the "%" unit) --------- */
expr('40 sur 250', '16 %');
expr('30 € sur 250 €', '12 %');
expr('sur(1, 8)', '12.5 %');
expr('pourcentage(1, 4)', '25 %');
expr('evolution(80, 95)', '18.75 %');
expr('variation(100, 90)', '-10 %');
// "sur" must not break implicit multiplication or factorial elsewhere.
expr('10 km / 2 h', '5 km/h');
expr('5!', '120');
check('sur needs same dimension', /unité/.test(run('10 € sur 2 kg =')[0]), true);

/* ---- statistics: percentile, cumulative sum, std deviation -------- */
expr('percentile(1, 2, 3, 4, 5, 6, 7, 8, 9, 50)', '5');
expr('percentile(2, 4, 6, 8, 10, 90)', '9.2');
expr('somme_cumulee(1, 2, 3, 4)', '1, 3, 6, 10');
expr('cumul(10 €, 20 €, 5 €)', '10 €, 30 €, 35 €');
expr('ecart_type(2, 4, 4, 4, 5, 5, 7, 9)', '2');

/* ---- currency conversion with manual rates ------------------------ */
const RATES = { EUR: 1, USD: 0.92, GBP: 1.17 };
function conv(text) { return norm(evaluateDocument(text, { rates: RATES }).lines[0].display); }
check('euro to dollar via rate', conv('100 € en $ ='), '108.695652 $');
check('dollar to euro via rate', conv('100 $ en € ='), '92 €');
check('cross-currency round-trip', conv('(100 € en $) en € ='), '100 €');
check('missing rate is a clear error', /taux de change/.test(run('100 € en $ =')[0]), true);
check('same-dimension convert still works', conv('100 cm en m ='), '1 m');

/* ---- advanced dates: weekdays, business days, age ----------------- */
expr('jour_semaine(01/01/2026)', '4');            // Thursday
expr('jour_semaine(15/03/2026)', '7');            // Sunday
expr('jours_ouvres(05/01/2026, 12/01/2026)', '5');
expr('jours_ouvres(12/01/2026, 05/01/2026)', '5'); // order-independent
expr('age(15/03/1990, 15/03/2026)', '36');
expr('age(16/03/1990, 15/03/2026)', '35');         // birthday not yet reached
// A bare weekday resolves to its next occurrence — deterministic weekday number.
expr('jour_semaine(vendredi)', '5');
expr('jour_semaine(lundi)', '1');

/* ---- cooking & fuel-economy units --------------------------------- */
expr('3 càs en mL', '45 mL');
expr('2 tasses en L', '0.5 L');
expr('1 gal en L', '3.785412 L');
expr('mpg_en_l100(30)', '7.840486');
expr('l100_en_mpg(7.840486)', '30');

/* ---- finance: VAT, discount, loan payment, compound growth -------- */
expr('ttc(100 €)', '120 €');
expr('ttc(100 €, 5.5%)', '105.5 €');
expr('ht(120 €)', '100 €');
expr('tva(100 €)', '20 €');
expr('remise(80 €, 25%)', '60 €');
expr('mensualite(1200 €, 0%, 1)', '100 €');
expr('interet_compose(1000 €, 5%, 10)', '1 628.894627 €');
check('loan payment ~1109 €', /^1 109/.test(run('mensualite(200000 €, 3%, 20) =')[0]), true);
check('years may carry a time unit', run('mensualite(200000 €, 3%, 20 ans) =')[0], run('mensualite(200000 €, 3%, 20) =')[0]);

/* ---- interactive grid: delete column/row & aggregates ------------- */
const Grid = require('../src/grid.js');
const gm = {
  rows: 4, cols: 3, cells: {
    '0,0': 'qte', '1,0': '2', '2,0': '3',
    '0,1': 'pu', '1,1': '3 €', '2,1': '4 €',
    '0,2': 'tot', '1,2': '=A2*B2', '2,2': '=A3*B3',
  },
};
check('grid aggregate sum of a column', norm(Grid.evalExpr(gm, 'somme(A1:A4)').display), '5');
check('grid aggregate count skips text header', Grid.evalExpr(gm, 'count(A1:A4)').display, '2');
check('grid aggregate average', norm(Grid.evalExpr(gm, 'moy(B1:B4)').display), '3.5 €');

const delA = Grid.deleteColumn(gm, 0);
check('delete column shrinks width', delA.cols, 2);
check('delete column shifts B header to A', delA.cells['0,0'], 'pu');
check('delete column rewrites refs (B→A, A→#REF)', delA.cells['1,1'], '=#REF*A2');

const delRow0 = Grid.deleteRow(gm, 0);
check('delete row shrinks height', delRow0.rows, 3);
check('delete row rewrites refs upward', delRow0.cells['0,2'], '=A1*B1');

/* ---- cross-block cell refs: plain (single table) & qualified ------ */
const t1 = { rows: 6, cols: 2, cells: { '0,0': '10', '0,1': '=A1*2' }, name: 'T1' };
const t2 = { rows: 6, cols: 2, cells: { '0,0': '100', '0,1': '=A1*2' }, name: 'T2' };
function makeCells(tables) {
  return {
    lookupCell: function (name) {
      for (const g of tables) { const v = Grid.cellValue(g, name); if (v != null) return v; }
      return null;
    },
    lookupQCell: function (table, cell) {
      for (const g of tables) { if (g.name === table) return Grid.cellValue(g, cell); }
      return null;
    },
    resolveRange: function (from, to) {
      for (const g of tables) { const v = Grid.rangeValue(g, from, to); if (v != null) return v; }
      return null;
    },
    resolveQRange: function (table, from, to) {
      for (const g of tables) { if (g.name === table) return Grid.rangeValue(g, from, to); }
      return null;
    },
  };
}
function runCells(text, tables) {
  return evaluateDocument(text, { externalCells: makeCells(tables) }).lines
    .filter((l) => l.resultRequested).map((l) => norm(l.display));
}
check('plain B1 resolves against the single table', runCells('B1 =', [t1])[0], '20');
check('plain B1 falls back to first table when several', runCells('B1 =', [t1, t2])[0], '20');
check('qualified T1!B1 targets its table', runCells('T1!B1 =', [t1, t2])[0], '20');
check('qualified T2!B1 targets the other table', runCells('T2!B1 =', [t1, t2])[0], '200');
check('qualified ref inside an expression', runCells('T2!B1 * 2 =', [t1, t2])[0], '400');
// Qualified ranges: somme(T2!A1:A1) targets the named table.
const rt1 = { rows: 4, cols: 1, cells: { '0,0': '10', '1,0': '20' }, name: 'T1' };
const rt2 = { rows: 4, cols: 1, cells: { '0,0': '1', '1,0': '2', '2,0': '3' }, name: 'T2' };
check('qualified range sums the named table', runCells('somme(T2!A1:A3) =', [rt1, rt2])[0], '6');
check('qualified range on the other table', runCells('somme(T1!A1:A2) =', [rt1, rt2])[0], '30');
check('unknown table name errors out',
  evaluateDocument('T3!B1 =', { externalCells: makeCells([t1, t2]) }).lines[0].error != null, true);
check('lone bang is still factorial, not a qualified ref', run('5! =')[0], '120');

/* ---- simplify (constant folding, result-preserving) --------------- */
const { simplifyDocument } = require('../src/simplify.js');
function simp(text) {
  const n = evaluateDocument(text).names;
  return simplifyDocument(text, (x) => n.vars.indexOf(x) >= 0, (x) => n.funcs.indexOf(x) >= 0);
}
check('fold a fully-constant expression', simp('(3 + 12) * 2 =').trim(), '30 =');
check('fold inside a definition', simp('x = 2 * (3 + 12)'), 'x = 30');
check('partial fold keeps the variable', simp('prix = 10\nprix * (2 + 1) =').split('\n')[1], 'prix * 3 =');
check('accounting percentage folds', simp('300 € + 20% =').trim(), '360 € =');
check('lone percentage is left as-is', simp('tva = 20%'), 'tva = 20%');
check('inexact division is left as-is', simp('1 / 3 =').trim(), '1 / 3 =');
check('function body is not folded', simp('f(x) = x^2 + (3 + 1)'), 'f(x) = x^2 + (3 + 1)');
check('heading untouched', simp('# Mes comptes'), '# Mes comptes');
// The core guarantee: results never change.
const simpDoc = 'a = (2 + 3) * 4 =\nb = sqrt(9) + 1 =\nc = 20 °C en °F =\nd = 3 pommes + 2 pommes =';
check('simplify preserves every result', JSON.stringify(run(simp(simpDoc))), JSON.stringify(run(simpDoc)));

/* ---- report ------------------------------------------------------- */
console.log('');
console.log(passed + ' réussis, ' + failed + ' échoués');
process.exit(failed ? 1 : 0);
