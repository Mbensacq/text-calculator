/*
 * engine.js — ties everything together at the document level.
 *
 * This is where the signature feature lives: a variable may be *used* on one
 * line and *defined* on any other line, above or below. We achieve that by
 * treating the whole note as a single scope:
 *
 *   1. scan every line and collect variable definitions into one table;
 *   2. resolve each reference lazily, on demand, memoising results and
 *      detecting circular references.
 *
 * Because resolution is lazy and order-independent, "trajet = temps" works even
 * when `temps` is written three lines further down.
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
  root.TC.Engine = mod;
  root.TC.evaluateDocument = mod.evaluateDocument;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Tok, Par, Ev, Units, Fmt) {
  'use strict';

  const tokenize = Tok.tokenize;
  const parse = Par.parse;
  const evaluate = Ev.evaluate;
  const CalcError = Units.CalcError;

  const COMMENT_RE = /^\s*(#|\/\/)/;

  /* ---- Spreadsheet cells (A1 notation over pipe-delimited tables) ---- */

  // "B" → 1, "AA" → 26 (0-based column index).
  function colToIndex(letters) {
    let n = 0;
    const s = letters.toUpperCase();
    for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
    return n - 1;
  }
  function parseCoord(name) {
    const m = /^([A-Za-z]+)(\d+)$/.exec(name);
    if (!m) return null;
    return { col: colToIndex(m[1]), row: parseInt(m[2], 10) };
  }
  // Split a table row into cells, dropping the optional border pipes.
  function splitRow(line) {
    return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
  }
  function isSeparatorRow(cells) {
    let sawDash = false;
    for (const c of cells) {
      const t = c.trim();
      if (t === '') continue;
      if (/^:?-{2,}:?$/.test(t)) { sawDash = true; continue; }
      return false;
    }
    return sawDash;
  }

  // Parse the left-hand side of a definition. Returns:
  //   { kind: 'var',  name, rhs }                — "prix = 10"
  //   { kind: 'func', name, params: [...], rhs } — "f(x) = x^2 + 1"
  // or null when the line is not a definition. A line like "name =" (empty
  // right-hand side) is a *display request*, not a definition, so it is
  // excluded.
  function splitDefinition(core) {
    const toks = tokenize(core);
    // Find the first top-level "=" (a single equals, never "==" / "<=" …).
    let depth = 0;
    let eqIdx = -1;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.type === 'lparen' || t.type === 'lbracket') depth++;
      else if (t.type === 'rparen' || t.type === 'rbracket') depth--;
      else if (t.type === 'equals' && depth === 0) { eqIdx = i; break; }
    }
    if (eqIdx === -1) return null;
    const right = core.slice(toks[eqIdx].end);
    if (right.trim() === '') return null;
    const left = toks.slice(0, eqIdx);

    // Variable: "name"
    if (left.length === 1 && left[0].type === 'ident') {
      return { kind: 'var', name: left[0].value, rhs: right };
    }

    // Function: "name ( p1 , p2 , … )"
    if (left.length >= 4 && left[0].type === 'ident' && left[1].type === 'lparen' &&
        left[left.length - 1].type === 'rparen') {
      const params = [];
      let i = 2;
      for (;;) {
        if (left[i].type !== 'ident') return null;
        params.push(left[i].value);
        i++;
        if (i < left.length && left[i].type === 'comma') { i++; continue; }
        break;
      }
      if (i === left.length - 1 && params.length >= 1) {
        return { kind: 'func', name: left[0].value, params: params, rhs: right };
      }
    }
    return null;
  }

  // Kept for backwards compatibility / external callers.
  function splitAssignment(line) {
    const d = splitDefinition(line);
    return d && d.kind === 'var' ? { name: d.name, rhs: d.rhs } : null;
  }

  // A line shows a result only when it ends with a lone "=" (Apple-Notes
  // style): the result is placed right after that sign. Comparison operators
  // like "==" are not result triggers.
  function splitResultRequest(raw) {
    const toks = tokenize(raw); // last token is 'eof'
    const n = toks.length;
    if (n >= 2 && toks[n - 2].type === 'equals') {
      const core = raw.slice(0, toks[n - 2].start);
      if (core.trim() === '') return { core: raw, requested: false };
      return { core: core, requested: true };
    }
    return { core: raw, requested: false };
  }

  // Drop a trailing "// comment". The "//" must start the line or follow
  // whitespace, so URLs (https://…) and prose are left untouched.
  function stripComment(raw) {
    const m = raw.match(/(^|\s)\/\//);
    return m ? raw.slice(0, m.index + m[1].length) : raw;
  }

  function classify(rawLine) {
    const code = stripComment(rawLine);
    const split = splitResultRequest(code);
    const core = split.core;
    let rec;
    if (core.trim() === '') rec = { kind: 'blank' };
    else if (COMMENT_RE.test(core)) rec = { kind: 'comment' };
    else {
      const def = splitDefinition(core);
      if (def) rec = { kind: 'def', defKind: def.kind, name: def.name, params: def.params, source: def.rhs };
      else rec = { kind: 'expr', source: core };
    }
    rec.resultRequested = split.requested;
    return rec;
  }

  function evaluateDocument(text, options) {
    options = options || {};
    // A resolver for A1 cell / range references that aren't satisfied by an
    // inline pipe-table — used to reach the note's interactive table blocks.
    const externalCells = options.externalCells || null;
    // A single reference instant for the whole document, so "aujourd'hui",
    // "demain" and friends all agree within one evaluation.
    const NOW = Date.now();
    const rawLines = text.split('\n');
    const records = rawLines.map((line, index) => {
      const c = classify(line);
      c.index = index;
      c.raw = line;
      return c;
    });

    // ---- Table blocks. Each contiguous run of "|" lines is its own A1 grid;
    //      a reference resolves against the nearest table at or above the line.
    const blocks = []; // { cellMap, cache, visiting, rows }
    (function () {
      let current = null;
      for (const rec of records) {
        if (rec.raw.indexOf('|') === -1) { current = null; continue; }
        if (!current) { current = { cellMap: {}, cache: {}, visiting: {}, rows: 0 }; blocks.push(current); }
        rec.blockIndex = blocks.length - 1;
        const cells = splitRow(rec.raw);
        if (isSeparatorRow(cells)) { rec.tableSeparator = true; continue; }
        current.rows++;
        rec.tableRow = current.rows;
        rec.tableCells = cells;
        cells.forEach(function (raw, col) {
          const t = raw.trim();
          if (t !== '') current.cellMap[col + ',' + current.rows] = t;
        });
      }
    })();
    (function () {
      let last = -1;
      for (const rec of records) {
        if (rec.blockIndex != null) last = rec.blockIndex;
        rec.activeBlock = last;
      }
    })();

    // ---- Pass 1: collect variable and function definitions -------------
    // A variable remembers the table active on its line, so "total = somme(B2:B4)"
    // resolves against that table.
    const defs = {};  // name -> { ast | null, parseError, blockIndex }
    const funcs = {}; // name -> { params, ast | null, parseError }
    for (const rec of records) {
      if (rec.kind !== 'def') continue;
      let ast = null;
      let parseError = null;
      try {
        ast = parse(tokenize(rec.source));
      } catch (e) {
        parseError = e.message;
      }
      if (rec.defKind === 'func') funcs[rec.name] = { params: rec.params, ast: ast, parseError: parseError };
      else defs[rec.name] = { ast: ast, parseError: parseError, blockIndex: rec.activeBlock };
    }

    function resolveCellIn(bi, col, row) {
      const b = blocks[bi];
      if (!b) return null;
      const key = col + ',' + row;
      if (!(key in b.cellMap)) return null; // empty cell
      if (key in b.cache) {
        const r = b.cache[key];
        if (r.error) throw new CalcError(r.error);
        return r.value;
      }
      if (b.visiting[key]) throw new CalcError('référence circulaire entre cellules');
      b.visiting[key] = true;
      try {
        let src = b.cellMap[key];
        if (src.charAt(0) === '=') src = src.slice(1);
        const value = evaluate(parse(tokenize(src)), makeEnv(null, null, bi));
        b.cache[key] = { value: value };
        return value;
      } catch (e) {
        b.cache[key] = { error: e.message };
        throw e;
      } finally {
        delete b.visiting[key];
      }
    }

    function lookupCellIn(bi, name) {
      const c = parseCoord(name);
      return c ? resolveCellIn(bi, c.col, c.row) : null;
    }

    // A range B1:B10 → a list of the numeric cells inside the rectangle
    // (text headers and empty cells are skipped).
    function resolveRangeIn(bi, fromName, toName) {
      const b = blocks[bi];
      if (!b) throw new CalcError('plage hors d’un tableau');
      const a = parseCoord(fromName);
      const z = parseCoord(toName);
      if (!a || !z) throw new CalcError('plage invalide : ' + fromName + ':' + toName);
      const c0 = Math.min(a.col, z.col), c1 = Math.max(a.col, z.col);
      const r0 = Math.min(a.row, z.row), r1 = Math.max(a.row, z.row);
      const items = [];
      for (let r = r0; r <= r1; r++) {
        for (let col = c0; col <= c1; col++) {
          const key = col + ',' + r;
          if (!(key in b.cellMap)) continue;
          if (!/^[=+\-.\d]/.test(b.cellMap[key])) continue; // skip text headers
          items.push(resolveCellIn(bi, col, r));
        }
      }
      return Units.list(items);
    }

    // ---- Pass 2: lazy, memoised resolution with cycle detection --------
    const cache = {};    // name -> { value } | { error }
    const visiting = {}; // name -> true while being resolved
    let callDepth = 0;   // guards runaway *depth* (infinite recursion)
    let callBudget = 0;  // guards runaway *total work* (e.g. naive fib(40))

    function resolveVar(name) {
      if (Object.prototype.hasOwnProperty.call(cache, name)) {
        const c = cache[name];
        if (c.error) throw new CalcError(c.error);
        return c.value;
      }
      if (visiting[name]) {
        throw new CalcError('référence circulaire via « ' + name + ' »');
      }
      const def = defs[name];
      visiting[name] = true;
      try {
        if (!def || !def.ast) {
          throw new CalcError('définition invalide de « ' + name + ' »');
        }
        const value = evaluate(def.ast, makeEnv(null, null, def.blockIndex));
        cache[name] = { value: value };
        return value;
      } catch (e) {
        cache[name] = { error: e.message };
        throw e;
      } finally {
        delete visiting[name];
      }
    }

    // Call a user-defined function: bind arguments to parameters in a child
    // scope, then evaluate the body. Forward references and recursion work;
    // a depth guard stops an accidental infinite recursion.
    function callFunction(name, argValues) {
      const f = funcs[name];
      if (!f || !f.ast) throw new CalcError('fonction « ' + name + ' » invalide');
      if (f.params.length !== argValues.length) {
        throw new CalcError(name + ' attend ' + f.params.length + ' argument(s), reçu ' + argValues.length);
      }
      if (++callDepth > 500) { callDepth--; throw new CalcError('récursion trop profonde'); }
      // Cap total work so a heavy recursion can't freeze the page while it is
      // re-evaluated on every keystroke.
      if (++callBudget > 200000) { callDepth--; throw new CalcError('calcul trop long (interrompu)'); }
      try {
        const locals = {};
        for (let i = 0; i < f.params.length; i++) locals[f.params[i]] = argValues[i];
        return evaluate(f.ast, makeEnv(locals));
      } finally {
        callDepth--;
      }
    }

    // An environment resolves names against `special` (ans / total), then the
    // optional locals (function params), then the document's global variables.
    function makeEnv(locals, special, blockIndex) {
      const bi = blockIndex == null ? -1 : blockIndex;
      return {
        lookupVar: function (name) {
          if (special && Object.prototype.hasOwnProperty.call(special, name)) {
            const s = special[name];
            if (s.error) throw new CalcError(s.error);
            return s.value;
          }
          if (locals && Object.prototype.hasOwnProperty.call(locals, name)) return locals[name];
          return defs[name] ? resolveVar(name) : null;
        },
        lookupFunc: function (name) {
          return funcs[name] || null;
        },
        callFunction: callFunction,
        lookupCell: function (name) {
          if (bi >= 0) { const v = lookupCellIn(bi, name); if (v != null) return v; }
          return externalCells ? externalCells.lookupCell(name) : null;
        },
        resolveRange: function (from, to) {
          if (bi >= 0) { try { return resolveRangeIn(bi, from, to); } catch (e) { /* fall through */ } }
          if (externalCells) { const r = externalCells.resolveRange(from, to); if (r != null) return r; }
          throw new CalcError('plage hors d’un tableau');
        },
        lookupQCell: function (table, cell) {
          return externalCells && externalCells.lookupQCell ? externalCells.lookupQCell(table, cell) : null;
        },
        now: NOW,
      };
    }

    const globalEnv = makeEnv(null);
    const env = globalEnv;

    // Sum a block of quantities for "total", keeping units compatible with the
    // first value and skipping the odd incompatible one (e.g. a helper ratio).
    function blockTotal(block) {
      let acc = null;
      for (const v of block) {
        if (Units.isDate(v)) continue; // dates aren't summable
        if (acc === null) acc = v;
        else if (Units.sameDim(acc.dim, v.dim)) acc = Units.add(acc, v);
      }
      return acc || Units.scalar(0);
    }

    // ---- Produce per-line results (only for lines ending in "=") -------
    // Walk top to bottom so the positional helpers "ans" (previous value) and
    // "total" (running sum of the current block) can be offered. A blank line,
    // a heading or a comment starts a new block.
    let ansVal = null;
    let block = [];
    for (const rec of records) {
      // Table rows: show the value of the last formula cell at the row's end.
      if (rec.tableRow) {
        for (let col = 0; col < rec.tableCells.length; col++) {
          if (rec.tableCells[col].trim().charAt(0) !== '=') continue;
          try { rec.value = resolveCellIn(rec.blockIndex, col, rec.tableRow); rec.display = Fmt.formatValue(rec.value); rec.error = undefined; }
          catch (e) { rec.error = e.message; rec.display = undefined; }
        }
        continue;
      }
      if (rec.tableSeparator) continue;
      if (rec.kind === 'blank' || rec.kind === 'comment') { ansVal = null; block = []; continue; }

      // ans / total are offered only when the user hasn't defined those names.
      const special = {};
      if (ansVal && !defs.ans && !funcs.ans) special.ans = { value: ansVal };
      if (!defs.total && !funcs.total) special.total = { value: blockTotal(block) };

      let value = null;
      let evalErr = null;
      let accumulate = false;

      if (rec.kind === 'def') {
        if (rec.defKind !== 'func') {
          try { value = resolveVar(rec.name); accumulate = true; } catch (e) { evalErr = e; }
        }
      } else if (rec.kind === 'expr') {
        if (!rec.resultRequested) continue; // prose — no result, doesn't touch the block
        const src = rec.source.trim();
        const isRef = src === 'ans' || src === 'total';
        try {
          value = evaluate(parse(tokenize(rec.source)), makeEnv(null, special, rec.activeBlock));
          accumulate = !isRef;
        } catch (e) { evalErr = e; }
      }

      if (rec.resultRequested && !(rec.kind === 'def' && rec.defKind === 'func')) {
        if (value != null) { rec.value = value; rec.display = Fmt.formatValue(value); }
        else if (evalErr) rec.error = evalErr.message;
      }

      if (accumulate && value != null) {
        ansVal = value;
        if (!Units.isList(value) && !Units.isDate(value)) block.push(value);
      }
    }

    return { lines: records, names: { vars: Object.keys(defs), funcs: Object.keys(funcs) } };
  }

  return { evaluateDocument, splitAssignment, splitResultRequest, classify };
});
