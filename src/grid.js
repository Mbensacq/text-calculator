/*
 * grid.js — evaluate a spreadsheet grid model, reusing the calc engine.
 *
 * A grid model is { rows, cols, cells } where cells maps "r,c" (0-based row,
 * col) to a raw string. A cell starting with "=" is a formula; otherwise its
 * text is evaluated as a value (number, quantity, label…). Cells reference one
 * another in A1 notation (B2) and ranges (B2:B10). Resolution is lazy and
 * memoised, with circular-reference detection.
 */
(function (root, factory) {
  const req = typeof require === 'function';
  const mod = factory(
    req ? require('./tokenizer.js') : root.TC.Tokenizer,
    req ? require('./parser.js') : root.TC.Parser,
    req ? require('./evaluator.js') : root.TC.Evaluator,
    req ? require('./units.js') : root.TC.Units,
    req ? require('./formatter.js') : root.TC.Formatter
  );
  root.TC = root.TC || {};
  root.TC.computeGrid = mod.computeGrid;
  root.TC.Grid = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Tok, Par, Ev, Units, Fmt) {
  'use strict';

  const tokenize = Tok.tokenize;
  const parse = Par.parse;
  const evaluate = Ev.evaluate;
  const CalcError = Units.CalcError;

  function colToIndex(letters) {
    let n = 0;
    const s = letters.toUpperCase();
    for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }
  function colName(index) {
    let s = '';
    let i = index + 1;
    while (i > 0) {
      const m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }
  function parseCoord(name) {
    const m = /^([A-Za-z]+)(\d+)$/.exec(name);
    if (!m) return null;
    return { col: colToIndex(m[1]), row: parseInt(m[2], 10) - 1 }; // 0-based row
  }

  // Build a shared evaluation context over a model: A1 cell/range resolution
  // with lazy memoisation and cycle detection. Reused by whole-grid computation
  // and by one-off expression evaluation (the selection aggregates).
  function createContext(model) {
    const cache = {};
    const visiting = {};

    function rawAt(r, c) {
      const v = model.cells[r + ',' + c];
      return v == null ? '' : v;
    }

    function resolve(r, c) {
      const src = rawAt(r, c).trim();
      if (src === '') return null;
      const key = r + ',' + c;
      if (key in cache) {
        const x = cache[key];
        if (x.error) throw new CalcError(x.error);
        return x.value;
      }
      if (visiting[key]) throw new CalcError('référence circulaire');
      visiting[key] = true;
      try {
        const s = src.charAt(0) === '=' ? src.slice(1) : src;
        const value = evaluate(parse(tokenize(s)), env);
        cache[key] = { value: value };
        return value;
      } catch (e) {
        cache[key] = { error: e.message };
        throw e;
      } finally {
        delete visiting[key];
      }
    }

    const env = {
      lookupVar: function () { return null; },
      lookupFunc: function () { return null; },
      callFunction: function () { throw new CalcError('fonctions personnalisées indisponibles dans une grille'); },
      lookupCell: function (name) {
        const p = parseCoord(name);
        if (!p) return null;
        if (p.row < 0 || p.col < 0 || p.row >= model.rows || p.col >= model.cols) return null;
        if (rawAt(p.row, p.col).trim() === '') return Units.scalar(0); // empty cell = 0
        return resolve(p.row, p.col);
      },
      resolveRange: function (from, to) {
        const a = parseCoord(from);
        const b = parseCoord(to);
        if (!a || !b) throw new CalcError('plage invalide : ' + from + ':' + to);
        const c0 = Math.min(a.col, b.col), c1 = Math.max(a.col, b.col);
        const r0 = Math.min(a.row, b.row), r1 = Math.max(a.row, b.row);
        const items = [];
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const raw = rawAt(r, c).trim();
            if (raw === '' || !/^[=+\-.\d]/.test(raw)) continue; // skip text headers/empties
            items.push(resolve(r, c));
          }
        }
        return Units.list(items);
      },
    };

    return { env: env, resolve: resolve, rawAt: rawAt };
  }

  // Fixed-decimals helper reusing the formatter's thousands grouping.
  function fixedDecimals(x, d) {
    const s = (Math.abs(x)).toFixed(d);
    const dot = s.indexOf('.');
    const intPart = dot === -1 ? s : s.slice(0, dot);
    const grouped = Fmt.formatNumber(parseInt(intPart, 10) || 0);
    const frac = dot === -1 ? '' : s.slice(dot);
    return (x < 0 ? '-' : '') + grouped + frac;
  }

  // Apply a column format to a numeric value. valueQ is a Quantity (formula
  // result) or null; rawText is the literal otherwise. Returns a display string,
  // or null when the value isn't a plain number (then the default display wins).
  function formatWith(spec, valueQ, rawText) {
    let x, unitLabel = '';
    if (valueQ != null) {
      if (valueQ.list || valueQ.date) return null;
      x = Object.keys(valueQ.unit).length ? Units.magnitude(valueQ.base, valueQ.unit) : valueQ.base;
      unitLabel = Fmt.formatUnitMap(valueQ.unit);
    } else {
      const t = String(rawText).trim();
      const m = /^-?\d[\d\s]*(?:[.,]\d+)?/.exec(t);
      if (!m) return null;
      x = parseFloat(m[0].replace(/\s/g, '').replace(',', '.'));
      if (isNaN(x)) return null;
      unitLabel = t.slice(m[0].length).trim(); // keep a trailing unit ("10 €" → "€")
    }
    const suffix = unitLabel ? ' ' + unitLabel : '';
    switch (spec) {
      case 'int': return Fmt.formatNumber(Math.round(x)) + suffix;
      case 'f2': return fixedDecimals(x, 2) + suffix;
      case 'pct': return Fmt.formatNumber(x * 100) + ' %';
      case 'eur': return fixedDecimals(x, 2) + ' €';
      case 'usd': return fixedDecimals(x, 2) + ' $';
      default: return null;
    }
  }

  // Compute every non-empty cell. Returns "r,c" -> { display, error, formula }.
  // A per-column format (model.formats[col]) reshapes numeric display only.
  function computeGrid(model) {
    const ctx = createContext(model);
    const formats = model.formats || null;
    const out = {};
    for (let r = 0; r < model.rows; r++) {
      for (let c = 0; c < model.cols; c++) {
        const raw = ctx.rawAt(r, c).trim();
        if (raw === '') continue;
        const spec = formats && formats[c];
        // Excel-style: a formula cell shows its computed value; any other cell
        // shows exactly what was typed ("sticker", "3 €", "2").
        if (raw.charAt(0) === '=') {
          try {
            const v = ctx.resolve(r, c);
            let disp = v == null ? '' : Fmt.formatValue(v);
            if (spec && v != null) { const f = formatWith(spec, v, null); if (f != null) disp = f; }
            out[r + ',' + c] = { display: disp, formula: true, error: false };
          } catch (e) {
            out[r + ',' + c] = { display: '', error: true, message: e.message, formula: true };
          }
        } else {
          let disp = raw;
          if (spec) { const f = formatWith(spec, null, raw); if (f != null) disp = f; }
          out[r + ',' + c] = { display: disp, formula: false, error: false };
        }
      }
    }
    return out;
  }

  // Evaluate one expression (e.g. "somme(B1:B6)") against the model. Returns
  // { display } or { error }. Used for live selection aggregates.
  function evalExpr(model, expr) {
    try {
      const ctx = createContext(model);
      const v = evaluate(parse(tokenize(expr)), ctx.env);
      return { display: v == null ? '' : Fmt.formatValue(v) };
    } catch (e) {
      return { error: e.message };
    }
  }

  // Rewrite the A1 references inside a formula after a row/column is removed.
  // Only references that actually fall inside the (pre-deletion) grid are
  // touched, so words and units are left alone. A reference to the deleted line
  // becomes "#REF" (an error, as in a spreadsheet).
  function rewriteRefs(src, axis, index, cols, rows) {
    if (src.charAt(0) !== '=') return src; // only formulas carry references
    return src.replace(/([A-Za-z]{1,2})(\d{1,3})/g, function (whole, letters, digits) {
      const col = colToIndex(letters);
      const row = parseInt(digits, 10) - 1;
      if (col < 0 || col >= cols || row < 0 || row >= rows) return whole; // not a grid ref
      if (axis === 'col') {
        if (col === index) return '#REF';
        return col > index ? colName(col - 1) + digits : whole;
      }
      if (row === index) return '#REF';
      return row > index ? letters + row : whole; // (row-1)+1 === row
    });
  }

  function shiftedModel(model, axis, index) {
    const cells = {};
    for (const k in model.cells) {
      const parts = k.split(',');
      const r = +parts[0], c = +parts[1];
      if (axis === 'col') {
        if (c === index) continue;
        cells[r + ',' + (c > index ? c - 1 : c)] = model.cells[k];
      } else {
        if (r === index) continue;
        cells[(r > index ? r - 1 : r) + ',' + c] = model.cells[k];
      }
    }
    for (const k in cells) cells[k] = rewriteRefs(cells[k], axis, index, model.cols, model.rows);
    return axis === 'col'
      ? { rows: model.rows, cols: Math.max(1, model.cols - 1), cells: cells }
      : { rows: Math.max(1, model.rows - 1), cols: model.cols, cells: cells };
  }

  function deleteColumn(model, c) { return shiftedModel(model, 'col', c); }
  function deleteRow(model, r) { return shiftedModel(model, 'row', r); }

  // Parse pasted spreadsheet / CSV text into a 2-D array of trimmed strings.
  // Delimiter is tab if present (Excel), else ";", else ",". Quoted fields with
  // embedded delimiters, quotes ("") or newlines are supported.
  function parseDelimited(text) {
    text = String(text).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    const delim = text.indexOf('\t') >= 0 ? '\t' : (text.indexOf(';') >= 0 ? ';' : ',');
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
    row.push(field); rows.push(row);
    return rows.map((r) => r.map((c) => c.trim()));
  }

  // Shift the row numbers of every A1 reference in a formula (used by fill-down
  // and by row-preserving sorts). Only the row part moves; columns are kept.
  function fillFormula(src, delta) {
    if (typeof src !== 'string' || src.charAt(0) !== '=' || delta === 0) return src;
    return src.replace(/([A-Za-z]{1,2})(\d{1,3})/g, function (whole, letters, digits) {
      const row = parseInt(digits, 10) + delta;
      return row >= 1 ? letters + row : whole;
    });
  }

  // Reorder rows by the value in one column. A non-numeric first row is treated
  // as a header and kept on top. Formula cells that move have their row
  // references shifted so same-row computations stay correct.
  function sortByColumn(model, col, dir) {
    const ctx = createContext(model);
    function keyAt(r) {
      const rawv = ctx.rawAt(r, col).trim();
      if (rawv === '') return { n: null, s: '' };
      // Formula: sort by its computed magnitude.
      if (rawv.charAt(0) === '=') {
        try {
          const v = ctx.resolve(r, col);
          if (v && !v.list && !v.date && typeof v.base === 'number') return { n: v.base, s: Fmt.formatValue(v) };
        } catch (e) { /* error cell → treated as text */ }
        return { n: null, s: rawv };
      }
      // Plain value: numeric only when it starts with a number ("30", "30 €",
      // "1 000,5"). A text header ("age") stays non-numeric so it isn't sorted.
      const m = /^-?\d[\d\s]*(?:[.,]\d+)?/.exec(rawv);
      if (m) {
        const num = parseFloat(m[0].replace(/\s/g, '').replace(',', '.'));
        if (!isNaN(num)) return { n: num, s: rawv };
      }
      return { n: null, s: rawv };
    }
    let start = 0;
    const k0 = keyAt(0);
    if (k0.n === null && k0.s !== '') start = 1; // keep a text header row in place
    const order = [];
    for (let r = start; r < model.rows; r++) order.push(r);
    const sign = dir === 'desc' ? -1 : 1;
    order.sort(function (a, b) {
      const ka = keyAt(a), kb = keyAt(b);
      if (ka.n !== null && kb.n !== null) return sign * (ka.n - kb.n);
      if (ka.n !== null) return -1;
      if (kb.n !== null) return 1;
      return sign * ka.s.localeCompare(kb.s);
    });
    const cells = {};
    for (let c = 0; c < model.cols; c++) {
      for (let r = 0; r < start; r++) { const v = model.cells[r + ',' + c]; if (v != null) cells[r + ',' + c] = v; }
    }
    order.forEach(function (srcRow, i) {
      const destRow = start + i;
      for (let c = 0; c < model.cols; c++) {
        const v = model.cells[srcRow + ',' + c];
        if (v != null) cells[destRow + ',' + c] = fillFormula(v, destRow - srcRow);
      }
    });
    const out = { rows: model.rows, cols: model.cols, cells: cells };
    if (model.name != null) out.name = model.name;
    if (model.formats) out.formats = model.formats;
    return out;
  }

  // Resolve a single cell / a range to its *value* (a Quantity / list), so other
  // parts of a note (text blocks) can reference a table's cells in A1 notation.
  function cellValue(model, name) {
    try { return createContext(model).env.lookupCell(name); } catch (e) { return null; }
  }
  function rangeValue(model, from, to) {
    try { return createContext(model).env.resolveRange(from, to); } catch (e) { return null; }
  }

  return {
    computeGrid: computeGrid,
    evalExpr: evalExpr,
    cellValue: cellValue,
    rangeValue: rangeValue,
    deleteColumn: deleteColumn,
    deleteRow: deleteRow,
    parseDelimited: parseDelimited,
    fillFormula: fillFormula,
    sortByColumn: sortByColumn,
    colName: colName,
    parseCoord: parseCoord,
    colToIndex: colToIndex,
  };
});
