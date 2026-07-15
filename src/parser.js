/*
 * parser.js — a small recursive-descent parser turning a token stream into an
 * expression AST.
 *
 * Grammar (lowest to highest precedence):
 *   expr        := comparison
 *   comparison  := ratio ( ('<' | '>' | …) ratio )*
 *   ratio       := convert ( 'sur' convert )*
 *   convert     := additive ( ('en' | 'to') additive )?
 *   additive    := multiplicative ( ('+' | '-') multiplicative )*
 *   multiplicative := unary ( ('*' | '/') unary | IMPLICIT unary )*
 *   unary       := ('+' | '-')? postfix
 *   postfix     := power ('%' | '²' | '³')*
 *   power       := atom ('^' unary)?
 *   atom        := number | ident | ident '(' args ')' | '(' expr ')'
 *
 * IMPLICIT multiplication kicks in when two factors sit next to each other with
 * no operator between them — this is what makes "10 km" and "9.81 m/s^2" work.
 *
 * AST node shapes:
 *   { type: 'num', value }
 *   { type: 'ident', name }                     // variable | unit | label
 *   { type: 'unary', op, operand }
 *   { type: 'binary', op, left, right }
 *   { type: 'percent', operand }
 *   { type: 'call', name, args: [...] }
 *   { type: 'convert', expr, target }
 */
(function (root, factory) {
  const mod = factory();
  root.TC = root.TC || {};
  root.TC.parse = mod.parse;
  root.TC.Parser = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function ParseError(message) {
    this.name = 'ParseError';
    this.message = message;
  }
  ParseError.prototype = Object.create(Error.prototype);

  // Words that act as infix operators. They must NOT be swallowed as factors by
  // implicit multiplication ("40 sur 250" is a ratio, not "40 × sur × 250").
  const INFIX_WORDS = { sur: true };

  function parse(tokens) {
    let pos = 0;

    function peek() { return tokens[pos]; }
    function next() { return tokens[pos++]; }
    function at(type) { return tokens[pos].type === type; }
    function expect(type) {
      if (!at(type)) throw new ParseError('attendu ' + type + ', trouvé ' + tokens[pos].type);
      return next();
    }

    // Does the current token start a new factor (for implicit multiplication)?
    function startsFactor() {
      const t = peek();
      if (t.type === 'ident' && INFIX_WORDS[t.value]) return false; // "sur" is an operator
      return t.type === 'number' || t.type === 'ident' || t.type === 'lparen';
    }

    function parseExpr() { return parseComparison(); }

    // Comparisons are the loosest operators: "a + b > c" reads as "(a+b) > c".
    function parseComparison() {
      let left = parseRatio();
      while (at('cmp')) {
        const op = next().value;
        const right = parseRatio();
        left = { type: 'compare', op: op, left: left, right: right };
      }
      return left;
    }

    // "part sur tout" → the part as a percentage of the whole (40 sur 250 = 16 %).
    function parseRatio() {
      let left = parseConvert();
      while (at('ident') && peek().value === 'sur') {
        next();
        const right = parseConvert();
        left = { type: 'ratio', left: left, right: right };
      }
      return left;
    }

    // A comma-separated sequence of elements. Each element is an expression or
    // an ellipsis marker ("…") used to denote a range. Shared by top-level list
    // literals ("1, 2, 3") and by function arguments ("sum(1, 2, …, 8)").
    function parseSequence() {
      const items = [parseElement()];
      while (at('comma')) { next(); items.push(parseElement()); }
      return items;
    }
    function parseElement() {
      if (at('ellipsis')) { next(); return { type: 'ellipsis' }; }
      return parseExpr();
    }

    function parseConvert() {
      let expr = parseAdditive();
      if (at('keyword')) {
        next(); // consume 'en' / 'to'
        const target = parseAdditive();
        expr = { type: 'convert', expr: expr, target: target };
      }
      return expr;
    }

    function parseAdditive() {
      let left = parseMultiplicative();
      while (at('op') && (peek().value === '+' || peek().value === '-')) {
        const op = next().value;
        const right = parseMultiplicative();
        left = { type: 'binary', op: op, left: left, right: right };
      }
      return left;
    }

    function parseMultiplicative() {
      let left = parseImplicit();
      while (at('op') && (peek().value === '*' || peek().value === '/')) {
        const op = next().value;
        const right = parseImplicit();
        left = { type: 'binary', op: op, left: left, right: right };
      }
      return left;
    }

    // Juxtaposition binds tighter than * and / so that "10 km / 2 h" reads as
    // (10 km) / (2 h) — the way a human writes km/h — rather than (10 km / 2) h.
    function parseImplicit() {
      let left = parseUnary();
      while (startsFactor()) {
        const right = parseUnary();
        left = { type: 'binary', op: '*', left: left, right: right, implicit: true };
      }
      return left;
    }

    function parseUnary() {
      if (at('op') && (peek().value === '+' || peek().value === '-')) {
        const op = next().value;
        const operand = parseUnary();
        return op === '-' ? { type: 'unary', op: '-', operand: operand } : operand;
      }
      return parsePostfix();
    }

    function parsePostfix() {
      let node = parsePower();
      for (;;) {
        if (at('colon')) {
          // Cell range B1:B10 — both sides must be plain cell references.
          next();
          const right = parsePower();
          if (node.type !== 'ident' || right.type !== 'ident') {
            throw new ParseError('une plage attend deux références de cellule, ex. B1:B10');
          }
          node = { type: 'range', from: node.name, to: right.name };
        }
        else if (at('percent')) { next(); node = { type: 'percent', operand: node }; }
        else if (at('bang')) { next(); node = { type: 'factorial', operand: node }; }
        else if (at('pow2')) { next(); node = { type: 'binary', op: '^', left: node, right: { type: 'num', value: 2 } }; }
        else if (at('pow3')) { next(); node = { type: 'binary', op: '^', left: node, right: { type: 'num', value: 3 } }; }
        else break;
      }
      return node;
    }

    function parsePower() {
      const base = parseAtom();
      if (at('op') && peek().value === '^') {
        next();
        const exp = parseUnary(); // right-associative
        return { type: 'binary', op: '^', left: base, right: exp };
      }
      return base;
    }

    function parseAtom() {
      let node = parsePrimary();
      // Indexing, computer-science style: liste[0], m[1][2].
      while (at('lbracket')) {
        next();
        const idx = parseExpr();
        expect('rbracket');
        node = { type: 'index', target: node, index: idx };
      }
      return node;
    }

    function parsePrimary() {
      const t = peek();
      if (t.type === 'number') { next(); return { type: 'num', value: t.value }; }
      if (t.type === 'date') { next(); return { type: 'date', t: t.value }; }
      if (t.type === 'qcell') { next(); return { type: 'qcell', table: t.value.table, cell: t.value.cell }; }

      if (t.type === 'ident') {
        next();
        if (at('lparen')) {
          // Function call
          next();
          const args = at('rparen') ? [] : parseSequence();
          expect('rparen');
          return { type: 'call', name: t.value, args: args };
        }
        return { type: 'ident', name: t.value };
      }

      if (t.type === 'lparen') {
        next();
        const items = parseSequence();
        expect('rparen');
        // "(a)" is just grouping; "(a, b, …)" is a list / range.
        if (items.length === 1 && items[0].type !== 'ellipsis') return items[0];
        return { type: 'list', items: items };
      }

      throw new ParseError('expression inattendue: ' + (t.value == null ? t.type : t.value));
    }

    const items = parseSequence();
    if (!at('eof')) {
      throw new ParseError('jeton en trop: ' + (peek().value == null ? peek().type : peek().value));
    }
    if (items.length === 1 && items[0].type !== 'ellipsis') return items[0];
    return { type: 'list', items: items };
  }

  return { parse, ParseError };
});
