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

  // Split "name = expression" into its parts when the left side is a single
  // identifier AND there is something on the right. A line like "name =" is a
  // *display request* (show the value), not an assignment, so it is excluded.
  function splitAssignment(line) {
    const eq = line.indexOf('=');
    if (eq === -1) return null;
    const left = line.slice(0, eq);
    const right = line.slice(eq + 1);
    if (right.trim() === '') return null;
    const lt = tokenize(left);
    if (lt.length === 2 && lt[0].type === 'ident') {
      return { name: lt[0].value, rhs: right };
    }
    return null;
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
      const asg = splitAssignment(core);
      if (asg) rec = { kind: 'def', name: asg.name, source: asg.rhs };
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

    // ---- Pass 1: collect definitions (last one wins) -------------------
    const defs = {}; // name -> { ast | null, parseError }
    for (const rec of records) {
      if (rec.kind !== 'def') continue;
      let ast = null;
      let parseError = null;
      try {
        ast = parse(tokenize(rec.source));
      } catch (e) {
        parseError = e.message;
      }
      defs[rec.name] = { ast: ast, parseError: parseError };
    }

    // ---- Pass 2: lazy, memoised resolution with cycle detection --------
    const cache = {};    // name -> { value } | { error }
    const visiting = {}; // name -> true while being resolved

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
        const value = evaluate(def.ast, env);
        cache[name] = { value: value };
        return value;
      } catch (e) {
        cache[name] = { error: e.message };
        throw e;
      } finally {
        delete visiting[name];
      }
    }

    const env = {
      lookupVar: function (name) {
        return defs[name] ? resolveVar(name) : null;
      },
    };

    // ---- Produce per-line results (only for lines ending in "=") -------
    for (const rec of records) {
      if (!rec.resultRequested) continue;
      if (rec.kind === 'def') {
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
