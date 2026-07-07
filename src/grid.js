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

  // Compute every non-empty cell. Returns "r,c" -> { display, error, formula }.
  function computeGrid(model) {
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
        let s = src.charAt(0) === '=' ? src.slice(1) : src;
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

    const out = {};
    for (let r = 0; r < model.rows; r++) {
      for (let c = 0; c < model.cols; c++) {
        const raw = rawAt(r, c).trim();
        if (raw === '') continue;
        // Excel-style: a formula cell shows its computed value; any other cell
        // shows exactly what was typed ("sticker", "3 €", "2").
        if (raw.charAt(0) === '=') {
          try {
            const v = resolve(r, c);
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

  return { computeGrid: computeGrid, colName: colName, parseCoord: parseCoord, colToIndex: colToIndex };
});
