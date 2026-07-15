/*
 * units.js — Dimensional-analysis engine for the text calculator.
 *
 * A Quantity is a number that carries a physical dimension (length, mass,
 * time, money, …) plus the "display units" it was written with, so that a
 * result can be shown back in units that feel natural to the author.
 *
 *   Quantity = {
 *     base: Number,                 // magnitude expressed in SI base units
 *     dim:  { [dimension]: exp },   // e.g. { length: 1, time: -1 }
 *     unit: { [unitName]: exp },    // preferred display units, e.g. { km: 1, h: -1 }
 *   }
 *
 * Unknown identifiers (things that are neither a variable nor a known unit)
 * are treated as free-form *labels* — "3 pommes + 2 pommes = 5 pommes" — which
 * makes the tool pleasant for everyday accounting. Labels live in their own
 * private dimension so that different labels never silently mix.
 */
(function (root, factory) {
  const mod = factory();
  root.TC = root.TC || {};
  root.TC.Units = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Dimension arithmetic. A dimension is a sparse map of exponents.
   * ------------------------------------------------------------------ */

  function combineDim(a, b, sign) {
    const out = {};
    for (const k in a) out[k] = (out[k] || 0) + a[k];
    for (const k in b) out[k] = (out[k] || 0) + sign * b[k];
    for (const k in out) if (out[k] === 0) delete out[k];
    return out;
  }
  function scaleDim(a, n) {
    const out = {};
    for (const k in a) { const v = a[k] * n; if (v !== 0) out[k] = v; }
    return out;
  }
  function sameDim(a, b) {
    const keys = {};
    for (const k in a) keys[k] = true;
    for (const k in b) keys[k] = true;
    for (const k in keys) if ((a[k] || 0) !== (b[k] || 0)) return false;
    return true;
  }
  function isDimensionless(a) { return Object.keys(a).length === 0; }

  /* ------------------------------------------------------------------ *
   * Unit table. Each unit maps to an SI factor and a dimension.
   * ------------------------------------------------------------------ */

  const UNITS = {};
  // Case-insensitive fallback lookup so "KM" resolves to "km" when unambiguous.
  const LOWER = {};

  function def(names, factor, dim, offset) {
    const canonical = names[0];
    for (const n of names) {
      UNITS[n] = { factor: factor, dim: dim, canonical: canonical, offset: offset || 0 };
      const low = n.toLowerCase();
      if (!(low in LOWER)) LOWER[low] = UNITS[n];
    }
  }

  const PI = Math.PI;

  // Length (SI base: metre)
  def(['m', 'metre', 'metres', 'mètre', 'mètres', 'meter', 'meters'], 1, { length: 1 });
  def(['km', 'kilometre', 'kilometres', 'kilomètre', 'kilomètres'], 1000, { length: 1 });
  def(['hm'], 100, { length: 1 });
  def(['dam'], 10, { length: 1 });
  def(['dm'], 0.1, { length: 1 });
  def(['cm'], 0.01, { length: 1 });
  def(['mm'], 0.001, { length: 1 });
  def(['µm', 'um'], 1e-6, { length: 1 });
  def(['nm'], 1e-9, { length: 1 });
  def(['mi', 'mile', 'miles'], 1609.344, { length: 1 });
  def(['yd', 'yard', 'yards'], 0.9144, { length: 1 });
  def(['ft', 'feet', 'foot'], 0.3048, { length: 1 });
  def(['in', 'inch', 'inches', 'pouce', 'pouces'], 0.0254, { length: 1 });

  // Area
  def(['m2', 'm²'], 1, { length: 2 });
  def(['km2', 'km²'], 1e6, { length: 2 });
  def(['cm2', 'cm²'], 1e-4, { length: 2 });
  def(['ha', 'hectare', 'hectares'], 1e4, { length: 2 });
  def(['a', 'are', 'ares'], 100, { length: 2 });

  // Volume (length^3)
  def(['m3', 'm³'], 1, { length: 3 });
  def(['cm3', 'cm³', 'cc'], 1e-6, { length: 3 });
  def(['L', 'l', 'litre', 'litres', 'liter', 'liters'], 1e-3, { length: 3 });
  def(['dL', 'dl'], 1e-4, { length: 3 });
  def(['cL', 'cl'], 1e-5, { length: 3 });
  def(['mL', 'ml'], 1e-6, { length: 3 });
  def(['hL', 'hl'], 0.1, { length: 3 });
  // Cooking measures (metric convention) and US liquid volumes.
  def(['càs', 'cas', 'cuil_soupe', 'tbsp'], 1.5e-5, { length: 3 });  // 15 mL
  def(['càc', 'cac', 'cuil_cafe', 'tsp'], 5e-6, { length: 3 });      // 5 mL
  def(['tasse', 'tasses', 'cup', 'cups'], 2.5e-4, { length: 3 });    // 250 mL
  def(['gal', 'gallon', 'gallons'], 3.785411784e-3, { length: 3 });  // US gallon
  def(['pinte', 'pintes', 'pint', 'pints'], 4.73176473e-4, { length: 3 }); // US pint

  // Mass (SI base: kilogram)
  def(['kg', 'kilo', 'kilos', 'kilogramme', 'kilogrammes'], 1, { mass: 1 });
  def(['g', 'gramme', 'grammes', 'gram', 'grams'], 1e-3, { mass: 1 });
  def(['mg', 'milligramme', 'milligrammes'], 1e-6, { mass: 1 });
  def(['µg', 'ug'], 1e-9, { mass: 1 });
  def(['t', 'tonne', 'tonnes', 'ton', 'tons'], 1000, { mass: 1 });
  def(['q', 'quintal', 'quintaux'], 100, { mass: 1 });
  def(['lb', 'lbs', 'livre-poids'], 0.45359237, { mass: 1 });
  def(['oz', 'once', 'onces'], 0.028349523125, { mass: 1 });

  // Time (SI base: second)
  def(['s', 'sec', 'secs', 'seconde', 'secondes', 'second', 'seconds'], 1, { time: 1 });
  def(['ms', 'milliseconde', 'millisecondes'], 1e-3, { time: 1 });
  def(['min', 'mins', 'minute', 'minutes'], 60, { time: 1 });
  def(['h', 'hr', 'hrs', 'heure', 'heures', 'hour', 'hours'], 3600, { time: 1 });
  def(['j', 'jour', 'jours', 'day', 'days'], 86400, { time: 1 });
  def(['semaine', 'semaines', 'week', 'weeks'], 604800, { time: 1 });
  def(['mois', 'month', 'months'], 2629800, { time: 1 });      // average Gregorian month
  def(['an', 'ans', 'année', 'années', 'annee', 'annees', 'year', 'years'], 31557600, { time: 1 }); // Julian year

  // Speed
  def(['kmh', 'km/h', 'kph'], 1000 / 3600, { length: 1, time: -1 });
  def(['mph'], 1609.344 / 3600, { length: 1, time: -1 });
  def(['kn', 'noeud', 'noeuds', 'knot', 'knots'], 1852 / 3600, { length: 1, time: -1 });

  // Temperature (SI base: kelvin). The offset converts the unit to kelvin:
  // kelvin = value * factor + offset. Best for values and conversions.
  def(['K', 'kelvin', 'kelvins'], 1, { temp: 1 }, 0);
  def(['°C', 'degC', 'celsius', 'Celsius'], 1, { temp: 1 }, 273.15);
  def(['°F', 'degF', 'fahrenheit', 'Fahrenheit'], 5 / 9, { temp: 1 }, 273.15 - 32 * 5 / 9);

  // Angle
  def(['rad', 'radian', 'radians'], 1, { angle: 1 });
  def(['deg', '°', 'degré', 'degrés', 'degree', 'degrees'], PI / 180, { angle: 1 });
  def(['grad', 'grades'], PI / 200, { angle: 1 });
  def(['tour', 'tours', 'turn'], 2 * PI, { angle: 1 });

  // Digital information (SI base: byte / octet)
  def(['o', 'octet', 'octets', 'B', 'byte', 'bytes'], 1, { data: 1 });
  def(['bit', 'bits'], 0.125, { data: 1 });
  def(['ko', 'kB', 'ko'], 1e3, { data: 1 });
  def(['Mo', 'MB'], 1e6, { data: 1 });
  def(['Go', 'GB'], 1e9, { data: 1 });
  def(['To', 'TB'], 1e12, { data: 1 });
  def(['Kio', 'KiB'], 1024, { data: 1 });
  def(['Mio', 'MiB'], 1024 ** 2, { data: 1 });
  def(['Gio', 'GiB'], 1024 ** 3, { data: 1 });

  // Percentage as a dimensionless display unit: a value with unit { '%': 1 }
  // renders as "16 %" (base 0.16 ÷ 0.01). Built by relational-percent helpers;
  // never produced by the tokenizer's bare "%" (that stays a postfix operator).
  def(['%'], 0.01, {});

  // Money — each currency is its own base dimension so they never mix silently.
  def(['€', 'EUR', 'euro', 'euros'], 1, { EUR: 1 });
  def(['$', 'USD', 'dollar', 'dollars'], 1, { USD: 1 });
  def(['£', 'GBP', 'livre', 'livres', 'pound', 'pounds'], 1, { GBP: 1 });
  def(['CHF', 'franc', 'francs'], 1, { CHF: 1 });
  def(['¥', 'JPY', 'yen', 'yens'], 1, { JPY: 1 });

  /* ------------------------------------------------------------------ *
   * Quantity construction & helpers.
   * ------------------------------------------------------------------ */

  function quantity(base, dim, unit) {
    return { base: base, dim: dim || {}, unit: unit || {} };
  }
  function scalar(value) {
    return quantity(value, {}, {});
  }

  // A list value (e.g. "1, 2, 3"). Kept distinct from a Quantity via the
  // `list` flag so functions like sum/mean can operate on it.
  function list(items) {
    return { list: true, items: items };
  }
  function isList(v) {
    return !!(v && v.list === true);
  }

  /* ------------------------------------------------------------------ *
   * Dates. A date is a calendar day (or instant) stored as an epoch in
   * milliseconds, kept distinct from Quantities via the `date` flag.
   * `hasTime` records whether a sub-day component is worth showing.
   * ------------------------------------------------------------------ */

  const DAY_MS = 86400000;

  function makeDate(t, hasTime) { return { date: true, t: t, hasTime: !!hasTime }; }
  function isDate(v) { return !!(v && v.date === true); }
  // Build a date from calendar components. Stored at UTC midnight so the same
  // day always maps to the same instant regardless of the viewer's timezone.
  function makeDateYMD(year, month, day) {
    return makeDate(Date.UTC(year, month - 1, day), false);
  }

  // date − date → a duration (seconds), displayed in days.
  function dateDiff(a, b) {
    return quantity((a.t - b.t) / 1000, { time: 1 }, { jours: 1 });
  }
  // Shift a date by a duration quantity (whose base is in seconds). The result
  // shows a time-of-day only when it no longer lands on a whole day.
  function dateShift(dateVal, timeQ, sign) {
    const t = dateVal.t + sign * timeQ.base * 1000;
    const onDay = ((t % DAY_MS) + DAY_MS) % DAY_MS === 0;
    return makeDate(t, dateVal.hasTime || !onDay);
  }

  // Resolve a unit token to its definition, or synthesise a label unit.
  function lookupUnit(name) {
    if (Object.prototype.hasOwnProperty.call(UNITS, name)) return UNITS[name];
    const low = name.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(LOWER, low)) return LOWER[low];
    return null;
  }

  function isKnownUnit(name) {
    return lookupUnit(name) !== null;
  }

  // A unit whose conversion to SI needs an additive offset (°C, °F).
  function isOffsetUnit(name) {
    const u = lookupUnit(name);
    return !!(u && u.offset);
  }

  // Build a temperature quantity: "20 °C" → 20 * factor + offset kelvins.
  function offsetQuantity(number, name) {
    const u = lookupUnit(name);
    if (!u) return quantity(number, {}, {});
    return quantity(number * u.factor + (u.offset || 0), u.dim, { [u.canonical]: 1 });
  }

  // Display magnitude for a unit map, honouring a single offset unit.
  function magnitude(base, unitMap) {
    const names = Object.keys(unitMap);
    if (names.length === 1 && unitMap[names[0]] === 1) {
      const u = lookupUnit(names[0]);
      if (u && u.offset) return (base - u.offset) / u.factor;
    }
    return base / unitFactor(unitMap);
  }

  // Build a quantity for a bare unit token (used for "10 km" — number × unit).
  function unitQuantity(name) {
    const u = lookupUnit(name);
    if (u) return quantity(u.factor, u.dim, { [u.canonical]: 1 });
    // Unknown → free-form label living in its own private dimension.
    return quantity(1, { ['label:' + name]: 1 }, { [name]: 1 });
  }

  // Factor that converts a display-unit map into SI base units.
  function unitFactor(unitMap) {
    let f = 1;
    for (const name in unitMap) {
      const u = lookupUnit(name);
      const base = u ? u.factor : 1; // labels have factor 1
      f *= Math.pow(base, unitMap[name]);
    }
    return f;
  }

  /* ------------------------------------------------------------------ *
   * Arithmetic on quantities.
   * ------------------------------------------------------------------ */

  function preferUnit(a, b) {
    // Keep whichever operand actually carries display units.
    return Object.keys(a).length ? a : b;
  }

  function add(a, b) {
    if (!sameDim(a.dim, b.dim)) {
      throw new CalcError('unités incompatibles');
    }
    return quantity(a.base + b.base, a.dim, preferUnit(a.unit, b.unit));
  }
  function sub(a, b) {
    if (!sameDim(a.dim, b.dim)) {
      throw new CalcError('unités incompatibles');
    }
    return quantity(a.base - b.base, a.dim, preferUnit(a.unit, b.unit));
  }
  function mul(a, b) {
    return quantity(a.base * b.base, combineDim(a.dim, b.dim, +1), combineDim(a.unit, b.unit, +1));
  }
  function div(a, b) {
    if (b.base === 0) throw new CalcError('division par zéro');
    return quantity(a.base / b.base, combineDim(a.dim, b.dim, -1), combineDim(a.unit, b.unit, -1));
  }
  function mod(a, b) {
    if (!sameDim(a.dim, b.dim)) throw new CalcError('unités incompatibles');
    if (b.base === 0) throw new CalcError('modulo par zéro');
    return quantity(a.base % b.base, a.dim, preferUnit(a.unit, b.unit));
  }
  function pow(a, b) {
    if (!isDimensionless(b.dim)) throw new CalcError("exposant invalide");
    const n = b.base;
    if (!isDimensionless(a.dim) && !Number.isInteger(n) && !Number.isInteger(n * 2)) {
      throw new CalcError('exposant non entier');
    }
    return quantity(Math.pow(a.base, n), scaleDim(a.dim, n), scaleDim(a.unit, n));
  }
  function neg(a) { return quantity(-a.base, a.dim, a.unit); }

  /* ------------------------------------------------------------------ *
   * Conversion ("distance en km").
   * ------------------------------------------------------------------ */

  // Convert a quantity so that it is displayed in `targetUnitMap`.
  function convertTo(q, targetUnitMap, targetDim) {
    if (!sameDim(q.dim, targetDim)) {
      throw new CalcError('conversion impossible');
    }
    return quantity(q.base, q.dim, targetUnitMap);
  }

  const CalcError = makeError();
  function makeError() {
    function CalcError(message) {
      this.name = 'CalcError';
      this.message = message;
      if (Error.captureStackTrace) Error.captureStackTrace(this, CalcError);
    }
    CalcError.prototype = Object.create(Error.prototype);
    CalcError.prototype.constructor = CalcError;
    return CalcError;
  }

  return {
    UNITS,
    CalcError,
    quantity,
    scalar,
    list,
    isList,
    makeDate,
    isDate,
    makeDateYMD,
    dateDiff,
    dateShift,
    unitQuantity,
    unitFactor,
    lookupUnit,
    isKnownUnit,
    isOffsetUnit,
    offsetQuantity,
    magnitude,
    combineDim,
    scaleDim,
    sameDim,
    isDimensionless,
    add, sub, mul, div, mod, pow, neg,
    convertTo,
  };
});
