/*
 * simplify.js — shorten calculations by folding constant sub-expressions,
 * without changing any result. "(3 + 12) * 2" becomes "30"; "x * (3 + 12)"
 * becomes "x * 15". It is essentially constant folding (a bit like factoring):
 * a sub-expression that depends on no variable is replaced by its value — but
 * ONLY when that short form re-evaluates to exactly the same quantity, so the
 * note stays correct (e.g. "1 / 3" is left alone, since "0.333333" would drift).
 *
 * The tree is rebuilt with a precedence-aware serializer, so parentheses are
 * added back exactly where needed.
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
  root.TC.simplifyDocument = mod.simplifyDocument;
  root.TC.simplifyExpression = mod.simplifyExpression;
  root.TC.Simplify = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Tok, Par, Ev, Units, Fmt) {
  'use strict';

  const tokenize = Tok.tokenize;
  const parse = Par.parse;
  const evaluate = Ev.evaluate;

  const EMPTY_ENV = {
    lookupVar: function () { return null; },
    lookupFunc: function () { return null; },
    callFunction: function () { throw new Units.CalcError('non constant'); },
    lookupCell: function () { return null; },
    resolveRange: function () { throw new Units.CalcError('non constant'); },
    now: 0,
  };

  const DATE_WORDS = { aujourdhui: 1, today: 1, demain: 1, tomorrow: 1, hier: 1, yesterday: 1 };
  const SUM_FORMS = { 'Σ': 1, sigma: 1, sommation: 1, somme: 1, sum: 1 };

  function isSumForm(node) {
    return node.type === 'call' && SUM_FORMS[node.name] &&
      node.args.length === 4 && node.args[0].type === 'ident';
  }

  /* ---- Constant detection ----------------------------------------- */

  function makeIsConst(isVar, isFunc) {
    function constIdent(name) {
      if (isVar(name)) return false;
      if (name === 'ans' || name === 'total') return false;
      if (/^[A-Za-z]+\d+$/.test(name)) return false;                 // maybe a cell ref
      if (DATE_WORDS[name.toLowerCase()]) return false;              // time-dependent
      return true;                                                   // unit / constant / label
    }
    function isConst(n) {
      switch (n.type) {
        case 'num': case 'raw': case 'date': return true;
        case 'ident': return constIdent(n.name);
        case 'unary': case 'percent': case 'factorial': return isConst(n.operand);
        case 'index': return isConst(n.target) && isConst(n.index);
        case 'binary': return isConst(n.left) && isConst(n.right);
        case 'compare': return isConst(n.left) && isConst(n.right);
        case 'convert': return isConst(n.expr) && isConst(n.target);
        case 'list':
          return n.items.every(function (it) { return it.type === 'ellipsis' || isConst(it); });
        case 'call':
          if (isFunc(n.name)) return false;
          return n.args.every(function (a) { return a.type === 'ellipsis' || isConst(a); });
        default: return false;
      }
    }
    return isConst;
  }

  /* ---- Fold a constant subtree to a literal (exact only) ---------- */

  function literalFromValue(v) {
    if (v == null || Units.isList(v) || Units.isDate(v)) return null;
    if (typeof v.base !== 'number' || !isFinite(v.base)) return null;
    // Strip the thousands-grouping spaces so the literal re-parses cleanly.
    return Fmt.formatQuantity(v).replace(/[   ]/g, '');
  }

  function closeEnough(a, b) {
    if (!Units.sameDim(a.dim, b.dim)) return false;
    return Math.abs(a.base - b.base) <= 1e-9 * Math.max(1, Math.abs(a.base), Math.abs(b.base));
  }

  function tryFold(node) {
    let v;
    try { v = evaluate(node, EMPTY_ENV); } catch (e) { return null; }
    const lit = literalFromValue(v);
    if (lit == null) return null;
    let rv;
    try { rv = evaluate(parse(tokenize(lit)), EMPTY_ENV); } catch (e) { return null; }
    if (rv == null || Units.isList(rv) || Units.isDate(rv)) return null;
    return closeEnough(v, rv) ? lit : null;   // keep only when exact
  }

  function foldNode(n, isConst) {
    // Leaves never shrink further.
    if (n.type === 'num' || n.type === 'raw' || n.type === 'ident' || n.type === 'date') {
      return { node: n, changed: false };
    }
    // A whole constant subtree collapses to its value (when exact). A lone
    // percentage is left as-is ("20%" reads better than "0.2").
    if (isConst(n) && n.type !== 'percent') {
      const lit = tryFold(n);
      if (lit != null) return { node: { type: 'raw', text: lit }, changed: true };
    }
    // Otherwise descend and fold the constant parts.
    let changed = false;
    function f(child) { const r = foldNode(child, isConst); if (r.changed) changed = true; return r.node; }

    let out;
    switch (n.type) {
      case 'unary': out = { type: 'unary', op: n.op, operand: f(n.operand) }; break;
      case 'percent': out = { type: 'percent', operand: f(n.operand) }; break;
      case 'factorial': out = { type: 'factorial', operand: f(n.operand) }; break;
      case 'index': out = { type: 'index', target: f(n.target), index: f(n.index) }; break;
      case 'binary': out = { type: 'binary', op: n.op, implicit: n.implicit, left: f(n.left), right: f(n.right) }; break;
      case 'compare': out = { type: 'compare', op: n.op, left: f(n.left), right: f(n.right) }; break;
      case 'convert': out = { type: 'convert', expr: f(n.expr), target: f(n.target) }; break;
      case 'list':
        out = { type: 'list', items: n.items.map(function (it) { return it.type === 'ellipsis' ? it : f(it); }) };
        break;
      case 'call':
        // Don't fold inside an indexed sum — its bound variable would be
        // mistaken for a constant.
        if (isSumForm(n)) return { node: n, changed: false };
        out = { type: 'call', name: n.name, args: n.args.map(function (a) { return a.type === 'ellipsis' ? a : f(a); }) };
        break;
      default: return { node: n, changed: false };
    }
    return { node: out, changed: changed };
  }

  /* ---- Serialize an AST back to a minimal, correct string --------- */

  const P = { CMP: 1, CONV: 2, ADD: 3, MUL: 4, IMPL: 5, UNARY: 6, POW: 7, POSTFIX: 8, ATOM: 9 };

  function fmtNum(v) {
    if (!isFinite(v)) return v > 0 ? '∞' : '-∞';
    return String(v);
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDate(t) {
    const d = new Date(t);
    return pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  }

  function wrap(inner, prec, need) { return prec < need ? '(' + inner + ')' : inner; }

  function serialize(n, need) {
    let s, prec;
    switch (n.type) {
      case 'num': prec = n.value < 0 ? P.UNARY : P.ATOM; s = fmtNum(n.value); break;
      case 'raw': prec = /^-/.test(n.text) ? P.UNARY : P.ATOM; s = n.text; break;
      case 'ident': prec = P.ATOM; s = n.name; break;
      case 'date': prec = P.ATOM; s = fmtDate(n.t); break;
      case 'unary': prec = P.UNARY; s = '-' + serialize(n.operand, P.UNARY); break;
      case 'percent': prec = P.POSTFIX; s = serialize(n.operand, P.POSTFIX) + '%'; break;
      case 'factorial': prec = P.POSTFIX; s = serialize(n.operand, P.POSTFIX) + '!'; break;
      case 'index': prec = P.POSTFIX; s = serialize(n.target, P.POSTFIX) + '[' + serialize(n.index, P.CMP) + ']'; break;
      case 'range': prec = P.POSTFIX; s = n.from + ':' + n.to; break;
      case 'compare':
        prec = P.CMP; s = serialize(n.left, P.CMP + 1) + ' ' + n.op + ' ' + serialize(n.right, P.CMP + 1); break;
      case 'convert':
        prec = P.CONV; s = serialize(n.expr, P.CONV + 1) + ' en ' + serialize(n.target, P.CONV + 1); break;
      case 'binary': {
        if (n.op === '^') { prec = P.POW; s = serialize(n.left, P.POW + 1) + '^' + serialize(n.right, P.POW); break; }
        if (n.implicit) { prec = P.IMPL; s = serialize(n.left, P.IMPL) + ' ' + serialize(n.right, P.IMPL + 1); break; }
        if (n.op === '*' || n.op === '/') {
          prec = P.MUL;
          s = serialize(n.left, P.MUL) + ' ' + n.op + ' ' + serialize(n.right, n.op === '/' ? P.MUL + 1 : P.MUL);
          break;
        }
        prec = P.ADD;
        s = serialize(n.left, P.ADD) + ' ' + n.op + ' ' + serialize(n.right, n.op === '-' ? P.ADD + 1 : P.ADD);
        break;
      }
      case 'list':
        prec = P.CMP;
        s = n.items.map(function (it) { return it.type === 'ellipsis' ? '…' : serialize(it, P.CMP + 1); }).join(', ');
        break;
      case 'call':
        prec = P.ATOM;
        s = n.name + '(' + n.args.map(function (a) { return a.type === 'ellipsis' ? '…' : serialize(a, P.CMP); }).join(', ') + ')';
        break;
      default: prec = P.ATOM; s = '';
    }
    return wrap(s, prec, need);
  }

  /* ---- Line / document level -------------------------------------- */

  function topEqualsEnd(code) {
    const toks = tokenize(code);
    let depth = 0;
    for (const t of toks) {
      if (t.type === 'lparen' || t.type === 'lbracket') depth++;
      else if (t.type === 'rparen' || t.type === 'rbracket') depth--;
      else if (t.type === 'equals' && depth === 0) return t.end;
    }
    return -1;
  }

  // Simplify one expression string. Returns { text, changed } or null (parse
  // error). `text` is the shortened expression (unchanged trimmed input if
  // nothing folded).
  function simplifyExpression(expr, isVar, isFunc) {
    let ast;
    try { ast = parse(tokenize(expr)); } catch (e) { return null; }
    const isConst = makeIsConst(isVar || function () { return false; }, isFunc || function () { return false; });
    const r = foldNode(ast, isConst);
    if (!r.changed) return { text: expr.trim(), changed: false };
    return { text: serialize(r.node, 0), changed: true };
  }

  function simplifyLine(line, isVar, isFunc) {
    if (!line.trim()) return line;
    if (/^\s*(#|\/\/)/.test(line)) return line;   // heading / comment
    if (line.indexOf('|') !== -1) return line;     // table row

    // Peel a trailing inline comment.
    const cm = /(^|\s)\/\//.exec(line);
    const codeEnd = cm ? cm.index + cm[1].length : line.length;
    const code = line.slice(0, codeEnd);
    const tail = line.slice(codeEnd);

    // Peel a trailing "=" result trigger.
    const toks = tokenize(code);
    let core = code;
    let trigger = false;
    if (toks.length >= 2 && toks[toks.length - 2].type === 'equals') {
      const eqStart = toks[toks.length - 2].start;
      if (code.slice(0, eqStart).trim() !== '') { core = code.slice(0, eqStart); trigger = true; }
    }

    // Peel a "name =" / "f(x) =" definition; skip function bodies (params).
    let lhs = '';
    let expr = core;
    const eqEnd = topEqualsEnd(core);
    if (eqEnd >= 0) {
      const before = core.slice(0, eqEnd - 1);
      if (/[([]/.test(before)) return line; // function definition → leave as-is
      lhs = core.slice(0, eqEnd);
      expr = core.slice(eqEnd);
    }

    const s = simplifyExpression(expr, isVar, isFunc);
    if (!s || !s.changed) return line;
    const lead = (expr.match(/^\s*/) || [''])[0];
    return lhs + lead + s.text + (trigger ? ' =' : '') + tail;
  }

  function simplifyDocument(text, isVar, isFunc) {
    return text.split('\n').map(function (l) { return simplifyLine(l, isVar, isFunc); }).join('\n');
  }

  return {
    simplifyDocument: simplifyDocument,
    simplifyExpression: simplifyExpression,
    serialize: serialize,
  };
});
