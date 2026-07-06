/*
 * parser.js — a small recursive-descent parser turning a token stream into an
 * expression AST.
 *
 * Grammar (lowest to highest precedence):
 *   expr        := convert
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
      const t = peek().type;
      return t === 'number' || t === 'ident' || t === 'lparen';
    }

    function parseExpr() { return parseConvert(); }

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
        if (at('percent')) { next(); node = { type: 'percent', operand: node }; }
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
      const t = peek();
      if (t.type === 'number') { next(); return { type: 'num', value: t.value }; }

      if (t.type === 'ident') {
        next();
        if (at('lparen')) {
          // Function call
          next();
          const args = [];
          if (!at('rparen')) {
            args.push(parseExpr());
            while (at('comma')) { next(); args.push(parseExpr()); }
          }
          expect('rparen');
          return { type: 'call', name: t.value, args: args };
        }
        return { type: 'ident', name: t.value };
      }

      if (t.type === 'lparen') {
        next();
        const inner = parseExpr();
        expect('rparen');
        return inner;
      }

      throw new ParseError('expression inattendue: ' + (t.value == null ? t.type : t.value));
    }

    const result = parseExpr();
    if (!at('eof')) {
      throw new ParseError('jeton en trop: ' + (peek().value == null ? peek().type : peek().value));
    }
    return result;
  }

  return { parse, ParseError };
});
