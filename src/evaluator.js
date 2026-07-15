/*
 * evaluator.js — walks an expression AST and produces a Quantity.
 *
 * The evaluator is intentionally ignorant of how variables are stored or in
 * what order they were written. It simply asks the supplied environment to
 * resolve a name; the document engine is what makes "use above, define below"
 * work by resolving lazily with cycle detection.
 *
 *   env.lookupVar(name) -> Quantity | null
 *
 * An identifier that is not a variable is resolved as a unit, and failing that
 * as a free-form label (see units.js).
 */
(function (root, factory) {
  const mod = factory(
    typeof require === 'function' ? require('./units.js') : (root.TC && root.TC.Units)
  );
  root.TC = root.TC || {};
  root.TC.evaluate = mod.evaluate;
  root.TC.Evaluator = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Units) {
  'use strict';

  const CalcError = Units.CalcError;

  function needDimensionless(q, what) {
    if (!Units.isDimensionless(q.dim)) {
      // Angles are acceptable wherever a pure number is expected (radians).
      const keys = Object.keys(q.dim);
      if (!(keys.length === 1 && keys[0] === 'angle' && q.dim.angle === 1)) {
        throw new CalcError(what + ' attend un nombre sans unité');
      }
    }
    return q.base;
  }

  function needInt(q, what) {
    const v = needDimensionless(q, what);
    if (!Number.isInteger(v)) throw new CalcError(what + ' attend un entier');
    return v;
  }

  function factorialOf(n) {
    if (n < 0) throw new CalcError('factorielle d’un nombre négatif');
    if (n > 170) return Infinity; // beyond double precision
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function gcd2(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { const t = a % b; a = b; b = t; }
    return a;
  }

  function combinations(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return Math.round(r);
  }

  const FUNCTIONS = {
    sqrt: (a) => Units.pow(a, Units.scalar(0.5)),
    cbrt: (a) => Units.pow(a, Units.scalar(1 / 3)),
    abs: (a) => Units.quantity(Math.abs(a.base), a.dim, a.unit),
    round: (a) => Units.quantity(Math.round(a.base), a.dim, a.unit),
    floor: (a) => Units.quantity(Math.floor(a.base), a.dim, a.unit),
    ceil: (a) => Units.quantity(Math.ceil(a.base), a.dim, a.unit),
    trunc: (a) => Units.quantity(Math.trunc(a.base), a.dim, a.unit),
    frac: (a) => Units.quantity(a.base - Math.trunc(a.base), a.dim, a.unit),
    sign: (a) => Units.scalar(Math.sign(a.base)),
    non: (a) => Units.scalar(a.base !== 0 ? 0 : 1),
    not: (a) => Units.scalar(a.base !== 0 ? 0 : 1),
    fact: (a) => Units.scalar(factorialOf(needInt(a, 'fact'))),
    factorielle: (a) => Units.scalar(factorialOf(needInt(a, 'factorielle'))),
    ln: (a) => Units.scalar(Math.log(needDimensionless(a, 'ln'))),
    log2: (a) => Units.scalar(Math.log2(needDimensionless(a, 'log2'))),
    log10: (a) => Units.scalar(Math.log10(needDimensionless(a, 'log10'))),
    exp: (a) => Units.scalar(Math.exp(needDimensionless(a, 'exp'))),
    sin: (a) => Units.scalar(Math.sin(needDimensionless(a, 'sin'))),
    cos: (a) => Units.scalar(Math.cos(needDimensionless(a, 'cos'))),
    tan: (a) => Units.scalar(Math.tan(needDimensionless(a, 'tan'))),
    asin: (a) => Units.scalar(Math.asin(needDimensionless(a, 'asin'))),
    acos: (a) => Units.scalar(Math.acos(needDimensionless(a, 'acos'))),
    atan: (a) => Units.scalar(Math.atan(needDimensionless(a, 'atan'))),
    sinh: (a) => Units.scalar(Math.sinh(needDimensionless(a, 'sinh'))),
    cosh: (a) => Units.scalar(Math.cosh(needDimensionless(a, 'cosh'))),
    tanh: (a) => Units.scalar(Math.tanh(needDimensionless(a, 'tanh'))),
    asinh: (a) => Units.scalar(Math.asinh(needDimensionless(a, 'asinh'))),
    acosh: (a) => Units.scalar(Math.acosh(needDimensionless(a, 'acosh'))),
    atanh: (a) => Units.scalar(Math.atanh(needDimensionless(a, 'atanh'))),
    // Fuel economy: L/100 km and miles-per-gallon are reciprocals, so this is a
    // dedicated conversion rather than a unit factor (235.214583 = US constant).
    mpg_en_l100: (a) => Units.scalar(235.214583 / needDimensionless(a, 'mpg_en_l100')),
    l100_en_mpg: (a) => Units.scalar(235.214583 / needDimensionless(a, 'l100_en_mpg')),
  };

  // Variadic helpers operate on same-dimension quantities and keep the unit.
  function reduceSame(args, name, fn) {
    if (!args.length) throw new CalcError(name + ' attend au moins un argument');
    let acc = args[0];
    for (let k = 1; k < args.length; k++) {
      if (!Units.sameDim(acc.dim, args[k].dim)) {
        throw new CalcError(name + ' attend des grandeurs de même unité');
      }
      acc = fn(acc, args[k]);
    }
    return acc;
  }
  const addAll = (args, name) => reduceSame(args, name, Units.add);
  const meanOf = (args, name) => Units.div(addAll(args, name), Units.scalar(args.length));

  function medianOf(args) {
    reduceSame(args, 'médiane', (a) => a); // validate same dimension
    const s = args.slice().sort((a, b) => a.base - b.base);
    const n = s.length;
    const m = n >> 1;
    return n % 2 ? s[m] : Units.div(Units.add(s[m - 1], s[m]), Units.scalar(2));
  }

  function varianceOf(args) {
    const mean = meanOf(args, 'variance');
    let acc = null;
    for (const x of args) {
      const d = Units.sub(x, mean);
      const sq = Units.mul(d, d);
      acc = acc ? Units.add(acc, sq) : sq;
    }
    return Units.div(acc, Units.scalar(args.length));
  }

  function stddevOf(args) { return Units.pow(varianceOf(args), Units.scalar(0.5)); }

  // Relational percentages, rendered with the "%" display unit (base 0.16 → "16 %").
  function ratioPct(a, b) {
    if (Units.isList(a) || Units.isList(b) || Units.isDate(a) || Units.isDate(b)) {
      throw new CalcError('un pourcentage attend deux nombres');
    }
    if (!Units.sameDim(a.dim, b.dim)) throw new CalcError('un pourcentage attend deux grandeurs de même unité');
    if (b.base === 0) throw new CalcError('division par zéro');
    return Units.quantity(a.base / b.base, {}, { '%': 1 });
  }
  function evolPct(a, b) {
    if (Units.isList(a) || Units.isList(b) || Units.isDate(a) || Units.isDate(b)) {
      throw new CalcError('une évolution attend deux nombres');
    }
    if (!Units.sameDim(a.dim, b.dim)) throw new CalcError('une évolution attend deux grandeurs de même unité');
    if (a.base === 0) throw new CalcError('division par zéro (valeur de départ nulle)');
    return Units.quantity((b.base - a.base) / a.base, {}, { '%': 1 });
  }

  // percentile(data…, rang) — linear interpolation, spreadsheet-style. Args are
  // already flattened, so the trailing value is the rank and the rest the data.
  function percentileFlat(args) {
    if (args.length < 2) throw new CalcError('percentile attend des données puis un rang, ex. percentile(B1:B10, 90)');
    const p = needDimensionless(args[args.length - 1], 'percentile');
    if (p < 0 || p > 100) throw new CalcError('le rang d’un percentile va de 0 à 100');
    const data = args.slice(0, -1);
    reduceSame(data, 'percentile', (a) => a); // same-dimension check
    const s = data.slice().sort((a, b) => a.base - b.base);
    const rank = (p / 100) * (s.length - 1);
    const lo = Math.floor(rank), hi = Math.ceil(rank);
    if (lo === hi) return s[lo];
    return Units.add(s[lo], Units.mul(Units.sub(s[hi], s[lo]), Units.scalar(rank - lo)));
  }
  // somme_cumulee(data…) → the list of running totals.
  function cumulFlat(args) {
    if (!args.length) throw new CalcError('somme cumulée sans données');
    reduceSame(args, 'somme cumulée', (a) => a);
    const out = [];
    let acc = null;
    for (const x of args) { acc = acc === null ? x : Units.add(acc, x); out.push(acc); }
    return Units.list(out);
  }

  // A duration argument accepted as a plain number of years or as a time
  // quantity ("20" or "20 ans"), so financial helpers read naturally.
  function asYears(q, name) {
    if (Units.isDimensionless(q.dim)) return q.base;
    if (Units.sameDim(q.dim, { time: 1 })) return q.base / 31557600;
    throw new CalcError(name + ' : durée en années attendue');
  }
  // A rate given as a fraction (0.2) or a percentage literal (20%). Both reduce
  // to a dimensionless base, so "3%" → 0.03.
  function rateOf(args, i, name, dflt) {
    return args.length > i ? needDimensionless(args[i], name) : dflt;
  }

  // VAT / price helpers (French accounting). Keep the money unit of the amount.
  function financeTTC(args) {
    if (!args.length || args.length > 2) throw new CalcError('ttc attend un montant HT (et un taux)');
    return Units.mul(args[0], Units.scalar(1 + rateOf(args, 1, 'ttc', 0.2)));
  }
  function financeHT(args) {
    if (!args.length || args.length > 2) throw new CalcError('ht attend un montant TTC (et un taux)');
    return Units.div(args[0], Units.scalar(1 + rateOf(args, 1, 'ht', 0.2)));
  }
  function financeTVA(args) {
    if (!args.length || args.length > 2) throw new CalcError('tva attend un montant HT (et un taux)');
    return Units.mul(args[0], Units.scalar(rateOf(args, 1, 'tva', 0.2)));
  }
  // Fixed-rate loan monthly payment: capital · r / (1 − (1+r)^−n).
  function mensualiteOf(args) {
    if (args.length !== 3) throw new CalcError('mensualite attend capital, taux annuel, années');
    const r = needDimensionless(args[1], 'mensualite') / 12;
    const n = asYears(args[2], 'mensualite') * 12;
    if (n <= 0) throw new CalcError('mensualite : durée invalide');
    const factor = r === 0 ? 1 / n : r / (1 - Math.pow(1 + r, -n));
    return Units.mul(args[0], Units.scalar(factor));
  }
  // Compound growth: final value = capital · (1 + taux)^années.
  function interetCompose(args) {
    if (args.length !== 3) throw new CalcError('interet_compose attend capital, taux annuel, années');
    const taux = needDimensionless(args[1], 'interet_compose');
    const annees = asYears(args[2], 'interet_compose');
    return Units.mul(args[0], Units.scalar(Math.pow(1 + taux, annees)));
  }
  function remiseOf(args) {
    if (args.length !== 2) throw new CalcError('remise attend un prix et un taux');
    return Units.mul(args[0], Units.scalar(1 - needDimensionless(args[1], 'remise')));
  }

  function need2(args, name) {
    if (args.length !== 2) throw new CalcError(name + ' attend 2 arguments');
  }

  const VARIADIC = {
    min: (args) => reduceSame(args, 'min', (a, b) => (b.base < a.base ? b : a)),
    max: (args) => reduceSame(args, 'max', (a, b) => (b.base > a.base ? b : a)),
    sum: (args) => addAll(args, 'sum'),
    total: (args) => addAll(args, 'total'),
    somme: (args) => addAll(args, 'somme'),
    product: (args) => reduceSame(args, 'product', Units.mul),
    produit: (args) => reduceSame(args, 'produit', Units.mul),
    mean: (args) => meanOf(args, 'mean'),
    avg: (args) => meanOf(args, 'avg'),
    moy: (args) => meanOf(args, 'moy'),
    moyenne: (args) => meanOf(args, 'moyenne'),
    median: (args) => medianOf(args),
    mediane: (args) => medianOf(args),
    médiane: (args) => medianOf(args),
    variance: (args) => varianceOf(args),
    stddev: (args) => stddevOf(args),
    ecarttype: (args) => stddevOf(args),
    ecart_type: (args) => stddevOf(args),
    'écart_type': (args) => stddevOf(args),
    percentile: (args) => percentileFlat(args),
    centile: (args) => percentileFlat(args),
    somme_cumulee: (args) => cumulFlat(args),
    'somme_cumulée': (args) => cumulFlat(args),
    cumul: (args) => cumulFlat(args),
    // Relational percentages (each returns a value shown as "N %").
    sur: (args) => { need2(args, 'sur'); return ratioPct(args[0], args[1]); },
    pourcentage: (args) => { need2(args, 'pourcentage'); return ratioPct(args[0], args[1]); },
    evolution: (args) => { need2(args, 'evolution'); return evolPct(args[0], args[1]); },
    'évolution': (args) => { need2(args, 'évolution'); return evolPct(args[0], args[1]); },
    variation: (args) => { need2(args, 'variation'); return evolPct(args[0], args[1]); },
    // Finance: VAT, discount, loan payment, compound growth.
    ttc: (args) => financeTTC(args),
    ht: (args) => financeHT(args),
    tva: (args) => financeTVA(args),
    remise: (args) => remiseOf(args),
    rabais: (args) => remiseOf(args),
    mensualite: (args) => mensualiteOf(args),
    'mensualité': (args) => mensualiteOf(args),
    interet_compose: (args) => interetCompose(args),
    interets_composes: (args) => interetCompose(args),
    'intérêt_composé': (args) => interetCompose(args),
    count: (args) => Units.scalar(args.length),
    hypot: (args) => Units.pow(addAll(args.map((a) => Units.pow(a, Units.scalar(2))), 'hypot'), Units.scalar(0.5)),
    pow: (args) => { need2(args, 'pow'); return Units.pow(args[0], args[1]); },
    mod: (args) => { need2(args, 'mod'); return Units.mod(args[0], args[1]); },
    // Cash register: change to give = amount paid − amount due.
    rendu: (args) => { need2(args, 'rendu'); return Units.sub(args[0], args[1]); },
    monnaie: (args) => { need2(args, 'monnaie'); return Units.sub(args[0], args[1]); },
    root: (args) => { need2(args, 'root'); return Units.pow(args[0], Units.div(Units.scalar(1), args[1])); },
    racine: (args) => { need2(args, 'racine'); return Units.pow(args[0], Units.div(Units.scalar(1), args[1])); },
    atan2: (args) => { need2(args, 'atan2'); return Units.scalar(Math.atan2(needDimensionless(args[0], 'atan2'), needDimensionless(args[1], 'atan2'))); },
    log: (args) => {
      if (args.length === 1) return Units.scalar(Math.log10(needDimensionless(args[0], 'log')));
      need2(args, 'log');
      return Units.scalar(Math.log(needDimensionless(args[0], 'log')) / Math.log(needDimensionless(args[1], 'log')));
    },
    gcd: (args) => Units.scalar(args.map((a) => needInt(a, 'gcd')).reduce((g, x) => gcd2(g, x))),
    pgcd: (args) => Units.scalar(args.map((a) => needInt(a, 'pgcd')).reduce((g, x) => gcd2(g, x))),
    lcm: (args) => Units.scalar(args.map((a) => needInt(a, 'lcm')).reduce((l, x) => (x === 0 ? 0 : Math.abs(l * x) / gcd2(l, x)))),
    ppcm: (args) => Units.scalar(args.map((a) => needInt(a, 'ppcm')).reduce((l, x) => (x === 0 ? 0 : Math.abs(l * x) / gcd2(l, x)))),
    combin: (args) => { need2(args, 'combin'); return Units.scalar(combinations(needInt(args[0], 'combin'), needInt(args[1], 'combin'))); },
    nCr: (args) => { need2(args, 'nCr'); return Units.scalar(combinations(needInt(args[0], 'nCr'), needInt(args[1], 'nCr'))); },
    perm: (args) => { need2(args, 'perm'); const n = needInt(args[0], 'perm'); const k = needInt(args[1], 'perm'); return Units.scalar(factorialOf(n) / factorialOf(n - k)); },
    nPr: (args) => { need2(args, 'nPr'); const n = needInt(args[0], 'nPr'); const k = needInt(args[1], 'nPr'); return Units.scalar(factorialOf(n) / factorialOf(n - k)); },
  };

  const CONSTANTS = {
    pi: () => Units.scalar(Math.PI),
    π: () => Units.scalar(Math.PI),
    e: () => Units.scalar(Math.E),
    tau: () => Units.scalar(2 * Math.PI),
    phi: () => Units.scalar((1 + Math.sqrt(5)) / 2),
    φ: () => Units.scalar((1 + Math.sqrt(5)) / 2),
  };

  const isList = Units.isList;
  const isDate = Units.isDate;
  const TIME_DIM = { time: 1 };

  // Relative-day keywords. Resolved against the document's reference "now".
  const DATE_WORDS = { aujourdhui: 0, today: 0, demain: 1, tomorrow: 1, hier: -1, yesterday: -1 };

  // Weekday names resolve to the *next* occurrence (bare "vendredi" = the coming
  // Friday). JS getUTCDay: 0 = Sunday … 6 = Saturday.
  const WEEKDAYS = { lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 0 };

  function todayMidnight(env) {
    const d = new Date((env && env.now) || Date.now());
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function nextWeekday(name, env) {
    const base = todayMidnight(env);
    const todayDow = new Date(base).getUTCDay();
    let delta = (WEEKDAYS[name] - todayDow + 7) % 7;
    if (delta === 0) delta = 7; // strictly after today
    return Units.makeDate(base + delta * 86400000, false);
  }

  function isTimeQuantity(q) {
    return !isDate(q) && !isList(q) && Units.sameDim(q.dim, TIME_DIM);
  }

  function dateFromWord(name, env) {
    const now = (env && env.now) || Date.now();
    const d = new Date(now);
    // "Today" is the viewer's calendar day, stored at UTC midnight.
    const midnight = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Units.makeDate(midnight + DATE_WORDS[name] * 86400000, false);
  }

  // Functions that produce or read dates. Operate on already-evaluated args, so
  // they sit after user-defined functions in precedence.
  function needDate(v, name) {
    if (!isDate(v)) throw new CalcError(name + ' attend une date');
    return new Date(v.t);
  }
  const DATE_CALLS = {
    date: (v) => {
      if (v.length !== 3) throw new CalcError('date attend jour, mois, année');
      return Units.makeDateYMD(needInt(v[2], 'date'), needInt(v[1], 'date'), needInt(v[0], 'date'));
    },
    annee: (v) => { if (v.length !== 1) throw new CalcError('annee attend une date'); return Units.scalar(needDate(v[0], 'annee').getUTCFullYear()); },
    année: (v) => { if (v.length !== 1) throw new CalcError('année attend une date'); return Units.scalar(needDate(v[0], 'année').getUTCFullYear()); },
    mois: (v) => { if (v.length !== 1) throw new CalcError('mois attend une date'); return Units.scalar(needDate(v[0], 'mois').getUTCMonth() + 1); },
    jour: (v) => { if (v.length !== 1) throw new CalcError('jour attend une date'); return Units.scalar(needDate(v[0], 'jour').getUTCDate()); },
    // 1 = lundi … 7 = dimanche.
    jour_semaine: (v) => {
      if (v.length !== 1) throw new CalcError('jour_semaine attend une date');
      const dow = needDate(v[0], 'jour_semaine').getUTCDay();
      return Units.scalar(dow === 0 ? 7 : dow);
    },
    // Business days (Mon–Fri) in the half-open span between two dates.
    jours_ouvres: (v) => {
      if (v.length !== 2) throw new CalcError('jours_ouvres attend deux dates');
      const a = needDate(v[0], 'jours_ouvres').getTime();
      const b = needDate(v[1], 'jours_ouvres').getTime();
      const lo = Math.min(a, b), hi = Math.max(a, b);
      let count = 0;
      for (let t = lo; t < hi; t += 86400000) {
        const dow = new Date(t).getUTCDay();
        if (dow !== 0 && dow !== 6) count++;
      }
      return Units.scalar(count);
    },
    // Full years between a birth date and a reference date (default: today).
    age: (v, env) => {
      if (!v.length || v.length > 2) throw new CalcError('age attend une date de naissance (et une référence)');
      const birth = needDate(v[0], 'age');
      const ref = v.length === 2 ? needDate(v[1], 'age') : new Date(todayMidnight(env));
      let years = ref.getUTCFullYear() - birth.getUTCFullYear();
      const m = ref.getUTCMonth() - birth.getUTCMonth();
      if (m < 0 || (m === 0 && ref.getUTCDate() < birth.getUTCDate())) years--;
      return Units.scalar(years);
    },
  };

  // Date-aware binary operation (date ± duration, date − date).
  function dateBinary(op, a, b) {
    if (isDate(a) && isDate(b)) {
      if (op === '-') return Units.dateDiff(a, b);
      throw new CalcError('entre deux dates, seule la soustraction a un sens');
    }
    if (isDate(a) && isTimeQuantity(b)) {
      if (op === '+' || op === '-') return Units.dateShift(a, b, op === '+' ? 1 : -1);
      throw new CalcError('avec une date, utilisez + ou −');
    }
    if (isDate(b) && isTimeQuantity(a) && op === '+') return Units.dateShift(b, a, 1);
    throw new CalcError('opération invalide avec une date');
  }

  // A condition is true when it is a non-zero number. Comparisons and the
  // logical helpers all return 1 (true) or 0 (false).
  function truthy(v) {
    if (isList(v)) throw new CalcError('une condition doit être un nombre, pas une liste');
    return v.base !== 0;
  }

  function compareOp(op, a, b) {
    if (isList(a) || isList(b)) throw new CalcError('comparaison de listes non supportée');
    if (isDate(a) || isDate(b)) {
      if (!isDate(a) || !isDate(b)) throw new CalcError('comparaison entre une date et autre chose');
      const d = a.t - b.t;
      switch (op) {
        case '==': return Math.abs(d) < 1000;
        case '!=': return Math.abs(d) >= 1000;
        case '<': return d < 0;
        case '>': return d > 0;
        case '<=': return d <= 0;
        case '>=': return d >= 0;
        default: throw new CalcError('comparaison inconnue: ' + op);
      }
    }
    const sameDim = Units.sameDim(a.dim, b.dim);
    if (op === '==' || op === '!=') {
      const equal = sameDim &&
        Math.abs(a.base - b.base) <= 1e-9 * Math.max(1, Math.abs(a.base), Math.abs(b.base));
      return op === '==' ? equal : !equal;
    }
    if (!sameDim) throw new CalcError('comparaison entre unités incompatibles');
    switch (op) {
      case '<': return a.base < b.base;
      case '>': return a.base > b.base;
      case '<=': return a.base <= b.base;
      case '>=': return a.base >= b.base;
      default: throw new CalcError('comparaison inconnue: ' + op);
    }
  }

  // A child environment that overrides a single variable (used by Σ and, more
  // generally, by any bound-variable construct).
  function withLocal(env, name, value) {
    return {
      lookupVar: function (n) { return n === name ? value : (env && env.lookupVar ? env.lookupVar(n) : null); },
      lookupFunc: env && env.lookupFunc,
      callFunction: env && env.callFunction,
    };
  }

  // Apply a plain binary operator to two scalar quantities.
  function scalarBinary(op, a, b) {
    if (isDate(a) || isDate(b)) return dateBinary(op, a, b);
    switch (op) {
      case '+': return Units.add(a, b);
      case '-': return Units.sub(a, b);
      case '*': return Units.mul(a, b);
      case '/': return Units.div(a, b);
      case '^': return Units.pow(a, b);
      default: throw new CalcError('opérateur inconnu: ' + op);
    }
  }

  // Binary operator where either side may be a list (element-wise / broadcast).
  function listBinary(op, a, b) {
    if (isList(a) && isList(b)) {
      if (a.items.length !== b.items.length) {
        throw new CalcError('listes de tailles différentes');
      }
      return Units.list(a.items.map((x, k) => scalarBinary(op, x, b.items[k])));
    }
    if (isList(a)) return Units.list(a.items.map((x) => scalarBinary(op, x, b)));
    return Units.list(b.items.map((y) => scalarBinary(op, a, y)));
  }

  // Flatten list values into a single stream of scalar quantities.
  function flatten(values) {
    const out = [];
    for (const v of values) {
      if (isList(v)) out.push.apply(out, flatten(v.items));
      else out.push(v);
    }
    return out;
  }

  // Evaluate a comma sequence, expanding "…" ranges between scalars.
  function evalSequence(items, env) {
    const out = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type === 'ellipsis') {
        expandRange(out, items, i, env);
        i++; // the element after "…" is the range end; already consumed
      } else {
        out.push(evaluate(items[i], env));
      }
    }
    return out;
  }

  // Fill "… , end" into out, inferring the step from the values already there.
  function expandRange(out, items, i, env) {
    const start = out[out.length - 1];
    const prev = out[out.length - 2];
    if (!start || isList(start)) throw new CalcError('« … » sans point de départ');
    if (i + 1 >= items.length || items[i + 1].type === 'ellipsis') {
      throw new CalcError('« … » sans borne de fin');
    }
    const end = evaluate(items[i + 1], env);
    if (isList(end)) throw new CalcError('borne de « … » invalide');
    if (!Units.sameDim(start.dim, end.dim) || (prev && !isList(prev) && !Units.sameDim(prev.dim, start.dim))) {
      throw new CalcError('unités incompatibles dans la plage');
    }
    const step = (prev && !isList(prev))
      ? start.base - prev.base
      : (Object.keys(start.unit).length ? Units.unitFactor(start.unit) : 1);
    if (step === 0) throw new CalcError('plage à pas nul');
    const raw = (end.base - start.base) / step;
    const count = Math.round(raw);
    if (count <= 0 || Math.abs(raw - count) > 1e-9) throw new CalcError('plage invalide');
    if (count > 100000) throw new CalcError('plage trop grande');
    for (let k = 1; k <= count; k++) {
      out.push(Units.quantity(start.base + k * step, start.dim, start.unit));
    }
  }

  function evaluate(ast, env) {
    switch (ast.type) {
      case 'num':
        return Units.scalar(ast.value);

      case 'date':
        return Units.makeDate(ast.t, false);

      case 'list':
        return Units.list(flatten(evalSequence(ast.items, env)));

      case 'ident': {
        const name = ast.name;
        // 1) a variable defined anywhere in the document
        const v = env && env.lookupVar ? env.lookupVar(name) : null;
        if (v) return v;
        // 1b) a relative-day keyword (aujourd'hui / demain / hier / weekday)
        const low = name.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(DATE_WORDS, low)) return dateFromWord(low, env);
        if (Object.prototype.hasOwnProperty.call(WEEKDAYS, low)) return nextWeekday(low, env);
        // 2) a mathematical constant
        if (CONSTANTS[name]) return CONSTANTS[name]();
        // 3) a spreadsheet cell (B2) when a table is present
        if (env && env.lookupCell && /^[A-Za-z]+\d+$/.test(name)) {
          const cell = env.lookupCell(name);
          if (cell != null) return cell;
        }
        // 4) a unit, or failing that a free-form label
        return Units.unitQuantity(name);
      }

      case 'range': {
        if (!env || !env.resolveRange) throw new CalcError('plage hors d’un tableau');
        return env.resolveRange(ast.from, ast.to);
      }

      case 'qcell': {
        const v = env && env.lookupQCell ? env.lookupQCell(ast.table, ast.cell) : null;
        if (v != null) return v;
        throw new CalcError('cellule « ' + ast.table + '!' + ast.cell + ' » introuvable');
      }

      case 'ratio': {
        // "part sur tout" → percentage (40 sur 250 = 16 %).
        return ratioPct(evaluate(ast.left, env), evaluate(ast.right, env));
      }

      case 'unary': {
        const v = evaluate(ast.operand, env);
        return isList(v) ? Units.list(v.items.map(Units.neg)) : Units.neg(v);
      }

      case 'percent': {
        const v = evaluate(ast.operand, env);
        if (isList(v)) return Units.list(v.items.map((x) => Units.div(x, Units.scalar(100))));
        return Units.div(v, Units.scalar(100));
      }

      case 'factorial': {
        const v = evaluate(ast.operand, env);
        if (isList(v)) return Units.list(v.items.map((x) => Units.scalar(factorialOf(needInt(x, 'factorielle')))));
        return Units.scalar(factorialOf(needInt(v, 'factorielle')));
      }

      case 'index': {
        // 0-based, computer-science style. Negative indexes count from the end.
        const target = evaluate(ast.target, env);
        const idxVal = evaluate(ast.index, env);
        if (isList(idxVal)) throw new CalcError('index invalide');
        const raw = needInt(idxVal, 'index');
        const items = isList(target) ? target.items : [target];
        const k = raw < 0 ? items.length + raw : raw;
        if (k < 0 || k >= items.length) throw new CalcError('index ' + raw + ' hors de la liste');
        return items[k];
      }

      case 'binary': {
        // Temperature literal: "20 °C" applies the unit's additive offset.
        if (ast.op === '*' && ast.implicit && ast.right.type === 'ident' &&
            Units.isOffsetUnit(ast.right.name)) {
          const left = evaluate(ast.left, env);
          if (!isList(left) && !isDate(left) && Units.isDimensionless(left.dim)) {
            return Units.offsetQuantity(left.base, ast.right.name);
          }
        }

        // Accounting-friendly percentages: "300 € + 20%" means +20% *of* 300 €
        // (i.e. 360 €), not "add the number 0.2". Only kicks in when the left
        // side carries a real unit, so "20% + 30%" still adds to 50%.
        if ((ast.op === '+' || ast.op === '-') && ast.right.type === 'percent') {
          const base = evaluate(ast.left, env);
          if (!isList(base) && !isDate(base) && !Units.isDimensionless(base.dim)) {
            const frac = Units.div(evaluate(ast.right.operand, env), Units.scalar(100));
            const factor = ast.op === '+'
              ? Units.add(Units.scalar(1), frac)
              : Units.sub(Units.scalar(1), frac);
            return Units.mul(base, factor);
          }
        }

        const a = evaluate(ast.left, env);
        const b = evaluate(ast.right, env);
        if (isList(a) || isList(b)) return listBinary(ast.op, a, b);
        return scalarBinary(ast.op, a, b);
      }

      case 'convert': {
        const q = evaluate(ast.expr, env);
        const target = evaluate(ast.target, env);
        if (isList(q)) return Units.list(q.items.map((x) => Units.convertTo(x, target.unit, target.dim)));
        return Units.convertTo(q, target.unit, target.dim);
      }

      case 'compare': {
        const a = evaluate(ast.left, env);
        const b = evaluate(ast.right, env);
        return Units.scalar(compareOp(ast.op, a, b) ? 1 : 0);
      }

      case 'call': {
        const name = ast.name;

        // Lazy special forms: only the taken branch is evaluated, so a
        // recursive function with a base case terminates.
        if (name === 'si' || name === 'if') {
          if (ast.args.length !== 3) {
            throw new CalcError(name + ' attend 3 arguments : condition, alors, sinon');
          }
          return truthy(evaluate(ast.args[0], env))
            ? evaluate(ast.args[1], env)
            : evaluate(ast.args[2], env);
        }
        if (name === 'et' || name === 'and') {
          for (const a of ast.args) if (!truthy(evaluate(a, env))) return Units.scalar(0);
          return Units.scalar(1);
        }
        if (name === 'ou' || name === 'or') {
          for (const a of ast.args) if (truthy(evaluate(a, env))) return Units.scalar(1);
          return Units.scalar(0);
        }

        // Indexed sum:  Σ(i, 1, n, i^2)  — also spelled sigma / sommation, and
        // accepted as somme/sum when written with the 4-argument index form.
        if ((name === 'Σ' || name === 'sigma' || name === 'sommation' ||
             name === 'somme' || name === 'sum') &&
            ast.args.length === 4 && ast.args[0].type === 'ident') {
          const varName = ast.args[0].name;
          const from = needInt(evaluate(ast.args[1], env), 'Σ');
          const to = needInt(evaluate(ast.args[2], env), 'Σ');
          if (to - from > 1000000) throw new CalcError('somme trop longue');
          let acc = null;
          for (let i = from; i <= to; i++) {
            const term = evaluate(ast.args[3], withLocal(env, varName, Units.scalar(i)));
            acc = acc === null ? term : Units.add(acc, term);
          }
          return acc === null ? Units.scalar(0) : acc;
        }

        const values = evalSequence(ast.args, env);
        // User-defined functions take precedence, so "f(x) = …" can be called.
        if (env && env.lookupFunc && env.lookupFunc(name)) {
          return env.callFunction(name, values);
        }
        if (DATE_CALLS[name]) return DATE_CALLS[name](values, env);
        if (FUNCTIONS[name]) {
          if (values.length !== 1) throw new CalcError(name + ' attend 1 argument');
          const v = values[0];
          return isList(v) ? Units.list(v.items.map(FUNCTIONS[name])) : FUNCTIONS[name](v);
        }
        if (VARIADIC[name]) return VARIADIC[name](flatten(values));
        throw new CalcError('fonction inconnue: ' + name);
      }

      default:
        throw new CalcError('nœud inconnu: ' + ast.type);
    }
  }

  return { evaluate, FUNCTIONS, VARIADIC, CONSTANTS };
});
