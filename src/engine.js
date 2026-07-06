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
  function splitDefinition(line) {
    const eq = line.indexOf('=');
    if (eq === -1) return null;
    const left = line.slice(0, eq);
    const right = line.slice(eq + 1);
    if (right.trim() === '') return null;
    const lt = tokenize(left); // ends with an 'eof' token

    // Variable: "name"
    if (lt.length === 2 && lt[0].type === 'ident') {
      return { kind: 'var', name: lt[0].value, rhs: right };
    }

    // Function: "name ( p1 , p2 , … )"
    if (lt.length >= 5 && lt[0].type === 'ident' && lt[1].type === 'lparen' &&
        lt[lt.length - 2].type === 'rparen') {
      const params = [];
      let i = 2;
      for (;;) {
        if (lt[i].type !== 'ident') return null;
        params.push(lt[i].value);
        i++;
        if (lt[i].type === 'comma') { i++; continue; }
        break;
      }
      if (lt[i].type === 'rparen' && i === lt.length - 2 && params.length >= 1) {
        return { kind: 'func', name: lt[0].value, params: params, rhs: right };
      }
    }
    return null;
  }

  // Kept for backwards compatibility / external callers.
  function splitAssignment(line) {
    const d = splitDefinition(line);
    return d && d.kind === 'var' ? { name: d.name, rhs: d.rhs } : null;
  }

  // A line shows a result only when it ends with "=" (Apple-Notes style):
  // the result is placed right after that sign. Returns the expression part
  // (without the trailing "=") and whether a result was requested.
  function splitResultRequest(raw) {
    const trimmedEnd = raw.replace(/\s+$/, '');
    if (trimmedEnd.charAt(trimmedEnd.length - 1) !== '=') return { core: raw, requested: false };
    const core = trimmedEnd.slice(0, -1);
    if (core.trim() === '') return { core: raw, requested: false };
    return { core: core, requested: true };
  }

  function classify(rawLine) {
    const split = splitResultRequest(rawLine);
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
    let callDepth = 0;   // guards runaway recursion in user functions

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
      try {
        const locals = {};
        for (let i = 0; i < f.params.length; i++) locals[f.params[i]] = argValues[i];
        return evaluate(f.ast, makeEnv(locals));
      } finally {
        callDepth--;
      }
    }

    // An environment resolves names against optional locals (function params),
    // then the document's global variables. Functions are always global.
    function makeEnv(locals) {
      return {
        lookupVar: function (name) {
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

    // ---- Produce per-line results (only for lines ending in "=") -------
    for (const rec of records) {
      if (!rec.resultRequested) continue;
      if (rec.kind === 'def') {
        if (rec.defKind === 'func') continue; // a function has no single value
        try {
          rec.value = resolveVar(rec.name);
          rec.display = Fmt.formatValue(rec.value);
        } catch (e) {
          rec.error = e.message;
        }
      } else if (rec.kind === 'expr') {
        let ast;
        try {
          ast = parse(tokenize(rec.source));
        } catch (e) {
          continue; // "=" on something that isn't an expression → ignore
        }
        try {
          rec.value = evaluate(ast, env);
          rec.display = Fmt.formatValue(rec.value);
        } catch (e) {
          rec.error = e.message;
        }
      }
    }

    return { lines: records };
  }

  return { evaluateDocument, splitAssignment, splitResultRequest, classify };
});
