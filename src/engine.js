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
    req ? require('./tokenizer.js') : root.TC,
    req ? require('./parser.js') : root.TC,
    req ? require('./evaluator.js') : root.TC,
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
  // identifier. Returns null when the line is not an assignment.
  function splitAssignment(line) {
    const eq = line.indexOf('=');
    if (eq === -1) return null;
    const left = line.slice(0, eq);
    const right = line.slice(eq + 1);
    const lt = tokenize(left);
    // Expect exactly: ident, eof
    if (lt.length === 2 && lt[0].type === 'ident') {
      return { name: lt[0].value, rhs: right };
    }
    return null;
  }

  // Does this line contain an actual computation worth showing a result for?
  // A bare number or a lone unknown word ("3 pommes") stays silent; a reference
  // to a known variable, an operator, a function or a conversion does not.
  function hasComputation(tokens, defs) {
    for (const t of tokens) {
      if (t.type === 'op' || t.type === 'percent' || t.type === 'keyword' ||
          t.type === 'lparen' || t.type === 'pow2' || t.type === 'pow3') {
        return true;
      }
      if (t.type === 'ident') {
        if (defs[t.value]) return true;
        if (Ev.CONSTANTS[t.value]) return true;
        if (Units.isKnownUnit(t.value)) return true;
      }
    }
    return false;
  }

  function classify(rawLine) {
    const line = rawLine;
    if (line.trim() === '') return { kind: 'blank' };
    if (COMMENT_RE.test(line)) return { kind: 'comment' };
    const asg = splitAssignment(line);
    if (asg) return { kind: 'def', name: asg.name, source: asg.rhs };
    return { kind: 'expr', source: line };
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
    const defs = {}; // name -> { ast | null, parseError, record }
    for (const rec of records) {
      if (rec.kind !== 'def') continue;
      let ast = null;
      let parseError = null;
      try {
        ast = parse(tokenize(rec.source));
      } catch (e) {
        parseError = e.message;
      }
      defs[rec.name] = { ast, parseError, record: rec };
      rec.ast = ast;
      rec.parseError = parseError;
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
        cache[name] = { value };
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

    // ---- Produce per-line results -------------------------------------
    const variables = {};
    for (const rec of records) {
      if (rec.kind === 'def') {
        if (rec.parseError) {
          rec.error = rec.parseError;
          continue;
        }
        try {
          const value = resolveVar(rec.name);
          rec.value = value;
          rec.display = Fmt.formatQuantity(value);
          variables[rec.name] = value;
        } catch (e) {
          rec.error = e.message;
        }
      } else if (rec.kind === 'expr') {
        const tokens = tokenize(rec.source);
        if (!hasComputation(tokens, defs)) continue; // prose — stay silent
        let ast;
        try {
          ast = parse(tokens);
        } catch (e) {
          continue; // does not parse as an expression → treat as prose
        }
        try {
          const value = evaluate(ast, env);
          // Suppress noisy "labels only" lines that are really prose.
          if (Fmt.labelDimensionCount(value) > 1 && !astHasOperator(ast)) continue;
          rec.value = value;
          rec.display = Fmt.formatQuantity(value);
        } catch (e) {
          rec.error = e.message;
        }
      }
    }

    return { lines: records, variables: variables };
  }

  function astHasOperator(ast) {
    if (!ast || typeof ast !== 'object') return false;
    if (ast.type === 'binary' && !ast.implicit) return true;
    if (ast.type === 'percent' || ast.type === 'convert' || ast.type === 'call') return true;
    for (const k in ast) {
      const v = ast[k];
      if (v && typeof v === 'object' && astHasOperator(v)) return true;
    }
    return false;
  }

  return { evaluateDocument, splitAssignment, classify };
});
