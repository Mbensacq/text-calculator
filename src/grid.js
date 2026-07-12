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

  // Compute every non-empty cell. Returns "r,c" -> { display, error, formula }.
  function computeGrid(model) {
    const ctx = createContext(model);
    const out = {};
    for (let r = 0; r < model.rows; r++) {
      for (let c = 0; c < model.cols; c++) {
        const raw = ctx.rawAt(r, c).trim();
        if (raw === '') continue;
        // Excel-style: a formula cell shows its computed value; any other cell
        // shows exactly what was typed ("sticker", "3 €", "2").
        if (raw.charAt(0) === '=') {
          try {
            const v = ctx.resolve(r, c);
            out[r + ',' + c] = { display: v == null ? '' : Fmt.formatValue(v), formula: true, error: false };
          } catch (e) {
            out[r + ',' + c] = { display: '', error: true, message: e.message, formula: true };
          }
        } else {
          out[r + ',' + c] = { display: raw, formula: false, error: false };
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

  return {
    computeGrid: computeGrid,
    evalExpr: evalExpr,
    deleteColumn: deleteColumn,
    deleteRow: deleteRow,
    colName: colName,
    parseCoord: parseCoord,
    colToIndex: colToIndex,
  };
});
