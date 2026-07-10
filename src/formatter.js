/*
 * formatter.js — render a Quantity as a human-friendly string.
 *
 * Numbers are cleaned of floating-point noise, grouped in thousands the French
 * way (thin spaces), and shown with a compact unit label. When a result keeps
 * the units it was written with (e.g. km/h) we display those; otherwise we
 * compose a label from the underlying SI dimensions.
 */
(function (root, factory) {
  const mod = factory(
    typeof require === 'function' ? require('./units.js') : (root.TC && root.TC.Units)
  );
  root.TC = root.TC || {};
  root.TC.Formatter = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Units) {
  'use strict';

  const NARROW = ' '; // narrow no-break space, used for thousands grouping

  // Symbol used to display each SI base dimension when no explicit unit remains.
  const DIM_SYMBOL = {
    length: 'm',
    mass: 'kg',
    time: 's',
    temp: 'K',
    angle: 'rad',
    data: 'o',
    EUR: '€',
    USD: '$',
    GBP: '£',
    CHF: 'CHF',
    JPY: '¥',
  };

  function superscript(exp) {
    if (exp === 1) return '';
    if (exp === 2) return '²';
    if (exp === 3) return '³';
    return '^' + exp;
  }

  function labelName(dimKey) {
    return dimKey.indexOf('label:') === 0 ? dimKey.slice(6) : (DIM_SYMBOL[dimKey] || dimKey);
  }

  // Turn a map of name->exponent into "km/h", "m/s²", "€", …
  function formatUnitMap(map) {
    const pos = [];
    const neg = [];
    for (const name in map) {
      const exp = map[name];
      if (exp > 0) pos.push(name + superscript(exp));
      else if (exp < 0) neg.push(name + superscript(-exp));
    }
    if (!pos.length && !neg.length) return '';
    if (!neg.length) return pos.join('·');
    const num = pos.length ? pos.join('·') : '1';
    return num + '/' + neg.join('·');
  }

  // Compose a unit label directly from SI dimensions (fallback path).
  function formatDimAsUnits(dim) {
    const map = {};
    for (const key in dim) map[labelName(key)] = dim[key];
    return formatUnitMap(map);
  }

  function groupThousands(intPart) {
    const neg = intPart[0] === '-';
    let digits = neg ? intPart.slice(1) : intPart;
    let out = '';
    while (digits.length > 3) {
      out = NARROW + digits.slice(-3) + out;
      digits = digits.slice(0, -3);
    }
    out = digits + out;
    return (neg ? '-' : '') + out;
  }

  function formatNumber(x) {
    if (Number.isNaN(x)) return 'indéfini';
    if (!isFinite(x)) return x > 0 ? '∞' : '-∞';
    if (x === 0) return '0';

    const abs = Math.abs(x);
    if (abs >= 1e15 || abs < 1e-9) {
      return x.toExponential(4).replace(/\.?0+e/, 'e');
    }

    // Strip floating-point noise, then present with up to 6 decimals.
    const rounded = parseFloat(x.toPrecision(12));
    let s;
    if (Number.isInteger(rounded)) {
      s = rounded.toString();
    } else {
      s = rounded.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    }
    const dot = s.indexOf('.');
    if (dot === -1) return groupThousands(s);
    return groupThousands(s.slice(0, dot)) + '.' + s.slice(dot + 1);
  }

  function formatQuantity(q) {
    // Decide which unit label to show and the corresponding display value.
    let unitLabel;
    let value;
    if (Object.keys(q.unit).length) {
      unitLabel = formatUnitMap(q.unit);
      value = Units.magnitude(q.base, q.unit);
    } else if (Object.keys(q.dim).length) {
      unitLabel = formatDimAsUnits(q.dim);
      value = q.base;
    } else {
      unitLabel = '';
      value = q.base;
    }

    const num = formatNumber(value);
    // Currency symbols read better glued to the number: "12 €" vs "12 km".
    if (!unitLabel) return num;
    return num + ' ' + unitLabel;
  }

  // How many free-form label dimensions does this quantity carry? Used by the
  // engine to tell "3 pommes" (worth showing) from prose that merely happens to
  // contain words (which should stay silent).
  function labelDimensionCount(q) {
    let n = 0;
    for (const key in q.dim) if (key.indexOf('label:') === 0) n++;
    return n;
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // A date shows as JJ/MM/AAAA (French, day-first), with HH:MM appended only
  // when a sub-day component is present.
  function formatDate(v) {
    const d = new Date(v.t);
    const s = pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
    if (v.hasTime) return s + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
    return s;
  }

  // Format any value — a date, a Quantity or a list of values.
  function formatValue(v) {
    if (Units.isDate(v)) return formatDate(v);
    if (Units.isList(v)) return v.items.map(formatValue).join(', ');
    return formatQuantity(v);
  }

  return { formatQuantity, formatValue, formatNumber, formatUnitMap, labelDimensionCount };
});
