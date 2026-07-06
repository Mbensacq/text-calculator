/*
 * evaluator.js — walks an expression AST and produces a Quantity.
 *
 * The evaluator is intentionally ignorant of how variables are stored or in
 * what order they were written. It simply asks the supplied environment to
 * resolve a name; the document engine is what makes "use above, define below"
 * work by resolving lazily with cycle detection.
 *
 *   env.lookupVar(name) -> Quantity | null
 *
 * An identifier that is not a variable is resolved as a unit, and failing that
 * as a free-form label (see units.js).
 */
(function (root, factory) {
  const mod = factory(
    typeof require === 'function' ? require('./units.js') : (root.TC && root.TC.Units)
  );
  root.TC = root.TC || {};
  root.TC.evaluate = mod.evaluate;
  root.TC.Evaluator = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Units) {
  'use strict';

  const CalcError = Units.CalcError;

  function needDimensionless(q, what) {
    if (!Units.isDimensionless(q.dim)) {
      // Angles are acceptable wherever a pure number is expected (radians).
      const keys = Object.keys(q.dim);
      if (!(keys.length === 1 && keys[0] === 'angle' && q.dim.angle === 1)) {
        throw new CalcError(what + ' attend un nombre sans unité');
      }
    }
    return q.base;
  }

  const FUNCTIONS = {
    sqrt: (a) => Units.pow(a, Units.scalar(0.5)),
    cbrt: (a) => Units.pow(a, Units.scalar(1 / 3)),
    abs: (a) => Units.quantity(Math.abs(a.base), a.dim, a.unit),
    round: (a) => Units.quantity(Math.round(a.base), a.dim, a.unit),
    floor: (a) => Units.quantity(Math.floor(a.base), a.dim, a.unit),
    ceil: (a) => Units.quantity(Math.ceil(a.base), a.dim, a.unit),
    trunc: (a) => Units.quantity(Math.trunc(a.base), a.dim, a.unit),
    sign: (a) => Units.scalar(Math.sign(a.base)),
    ln: (a) => Units.scalar(Math.log(needDimensionless(a, 'ln'))),
    log: (a) => Units.scalar(Math.log10(needDimensionless(a, 'log'))),
    log2: (a) => Units.scalar(Math.log2(needDimensionless(a, 'log2'))),
    exp: (a) => Units.scalar(Math.exp(needDimensionless(a, 'exp'))),
    sin: (a) => Units.scalar(Math.sin(needDimensionless(a, 'sin'))),
    cos: (a) => Units.scalar(Math.cos(needDimensionless(a, 'cos'))),
    tan: (a) => Units.scalar(Math.tan(needDimensionless(a, 'tan'))),
    asin: (a) => Units.scalar(Math.asin(needDimensionless(a, 'asin'))),
    acos: (a) => Units.scalar(Math.acos(needDimensionless(a, 'acos'))),
    atan: (a) => Units.scalar(Math.atan(needDimensionless(a, 'atan'))),
  };

  // Variadic helpers operate on same-dimension quantities and keep the unit.
  function reduceSame(args, name, fn) {
    if (!args.length) throw new CalcError(name + ' attend au moins un argument');
    let acc = args[0];
    for (let k = 1; k < args.length; k++) {
      if (!Units.sameDim(acc.dim, args[k].dim)) {
        throw new CalcError(name + ' attend des grandeurs de même unité');
      }
      acc = fn(acc, args[k]);
    }
    return acc;
  }

  const VARIADIC = {
    min: (args) => reduceSame(args, 'min', (a, b) => (b.base < a.base ? b : a)),
    max: (args) => reduceSame(args, 'max', (a, b) => (b.base > a.base ? b : a)),
    sum: (args) => reduceSame(args, 'sum', (a, b) => Units.add(a, b)),
    total: (args) => reduceSame(args, 'total', (a, b) => Units.add(a, b)),
    mean: (args) => Units.div(reduceSame(args, 'mean', (a, b) => Units.add(a, b)), Units.scalar(args.length)),
    avg: (args) => Units.div(reduceSame(args, 'avg', (a, b) => Units.add(a, b)), Units.scalar(args.length)),
    moyenne: (args) => Units.div(reduceSame(args, 'moyenne', (a, b) => Units.add(a, b)), Units.scalar(args.length)),
    hypot: (args) => Units.pow(reduceSame(args.map((a) => Units.pow(a, Units.scalar(2))), 'hypot', (a, b) => Units.add(a, b)), Units.scalar(0.5)),
    pow: (args) => { if (args.length !== 2) throw new CalcError('pow attend 2 arguments'); return Units.pow(args[0], args[1]); },
    mod: (args) => { if (args.length !== 2) throw new CalcError('mod attend 2 arguments'); return Units.mod(args[0], args[1]); },
  };

  const CONSTANTS = {
    pi: () => Units.scalar(Math.PI),
    π: () => Units.scalar(Math.PI),
    e: () => Units.scalar(Math.E),
    tau: () => Units.scalar(2 * Math.PI),
  };

  function evaluate(ast, env) {
    switch (ast.type) {
      case 'num':
        return Units.scalar(ast.value);

      case 'ident': {
        const name = ast.name;
        // 1) a variable defined anywhere in the document
        const v = env && env.lookupVar ? env.lookupVar(name) : null;
        if (v) return v;
        // 2) a mathematical constant
        if (CONSTANTS[name]) return CONSTANTS[name]();
        // 3) a unit, or failing that a free-form label
        return Units.unitQuantity(name);
      }

      case 'unary':
        return Units.neg(evaluate(ast.operand, env));

      case 'percent':
        return Units.div(evaluate(ast.operand, env), Units.scalar(100));

      case 'binary': {
        const a = evaluate(ast.left, env);
        const b = evaluate(ast.right, env);
        switch (ast.op) {
          case '+': return Units.add(a, b);
          case '-': return Units.sub(a, b);
          case '*': return Units.mul(a, b);
          case '/': return Units.div(a, b);
          case '^': return Units.pow(a, b);
          default: throw new CalcError('opérateur inconnu: ' + ast.op);
        }
      }

      case 'convert': {
        const q = evaluate(ast.expr, env);
        const target = evaluate(ast.target, env);
        return Units.convertTo(q, target.unit, target.dim);
      }

      case 'call': {
        const name = ast.name;
        const args = ast.args.map((a) => evaluate(a, env));
        if (FUNCTIONS[name]) {
          if (args.length !== 1) throw new CalcError(name + ' attend 1 argument');
          return FUNCTIONS[name](args[0]);
        }
        if (VARIADIC[name]) return VARIADIC[name](args);
        throw new CalcError('fonction inconnue: ' + name);
      }

      default:
        throw new CalcError('nœud inconnu: ' + ast.type);
    }
  }

  return { evaluate, FUNCTIONS, VARIADIC, CONSTANTS };
});
