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

  function evaluateDocument(text) {
    const rawLines = text.split('\n');
    const records = rawLines.map((line, index) => {
      const c = classify(line);
      c.index = index;
      c.raw = line;
      return c;
    });

    // ---- Pass 1: collect variable and function definitions -------------
    const defs = {};  // name -> { ast | null, parseError }
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
      else defs[rec.name] = { ast: ast, parseError: parseError };
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
        const value = evaluate(def.ast, globalEnv);
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
    function makeEnv(locals, special) {
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
      };
    }

    const globalEnv = makeEnv(null);
    const env = globalEnv;

    // Sum a block of quantities for "total", keeping units compatible with the
    // first value and skipping the odd incompatible one (e.g. a helper ratio).
    function blockTotal(block) {
      let acc = null;
      for (const v of block) {
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
          value = evaluate(parse(tokenize(rec.source)), makeEnv(null, special));
          accumulate = !isRef;
        } catch (e) { evalErr = e; }
      }

      if (rec.resultRequested && !(rec.kind === 'def' && rec.defKind === 'func')) {
        if (value != null) { rec.value = value; rec.display = Fmt.formatValue(value); }
        else if (evalErr) rec.error = evalErr.message;
      }

      if (accumulate && value != null) {
        ansVal = value;
        if (!Units.isList(value)) block.push(value);
      }
    }

    return { lines: records };
  }

  return { evaluateDocument, splitAssignment, splitResultRequest, classify };
});
