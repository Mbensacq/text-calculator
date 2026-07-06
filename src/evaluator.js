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

  const isList = Units.isList;

  // Apply a plain binary operator to two scalar quantities.
  function scalarBinary(op, a, b) {
    switch (op) {
      case '+': return Units.add(a, b);
      case '-': return Units.sub(a, b);
      case '*': return Units.mul(a, b);
      case '/': return Units.div(a, b);
      case '^': return Units.pow(a, b);
      default: throw new CalcError('opérateur inconnu: ' + op);
    }
  }

  // Binary operator where either side may be a list (element-wise / broadcast).
  function listBinary(op, a, b) {
    if (isList(a) && isList(b)) {
      if (a.items.length !== b.items.length) {
        throw new CalcError('listes de tailles différentes');
      }
      return Units.list(a.items.map((x, k) => scalarBinary(op, x, b.items[k])));
    }
    if (isList(a)) return Units.list(a.items.map((x) => scalarBinary(op, x, b)));
    return Units.list(b.items.map((y) => scalarBinary(op, a, y)));
  }

  // Flatten list values into a single stream of scalar quantities.
  function flatten(values) {
    const out = [];
    for (const v of values) {
      if (isList(v)) out.push.apply(out, flatten(v.items));
      else out.push(v);
    }
    return out;
  }

  // Evaluate a comma sequence, expanding "…" ranges between scalars.
  function evalSequence(items, env) {
    const out = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type === 'ellipsis') {
        expandRange(out, items, i, env);
        i++; // the element after "…" is the range end; already consumed
      } else {
        out.push(evaluate(items[i], env));
      }
    }
    return out;
  }

  // Fill "… , end" into out, inferring the step from the values already there.
  function expandRange(out, items, i, env) {
    const start = out[out.length - 1];
    const prev = out[out.length - 2];
    if (!start || isList(start)) throw new CalcError('« … » sans point de départ');
    if (i + 1 >= items.length || items[i + 1].type === 'ellipsis') {
      throw new CalcError('« … » sans borne de fin');
    }
    const end = evaluate(items[i + 1], env);
    if (isList(end)) throw new CalcError('borne de « … » invalide');
    if (!Units.sameDim(start.dim, end.dim) || (prev && !isList(prev) && !Units.sameDim(prev.dim, start.dim))) {
      throw new CalcError('unités incompatibles dans la plage');
    }
    const step = (prev && !isList(prev))
      ? start.base - prev.base
      : (Object.keys(start.unit).length ? Units.unitFactor(start.unit) : 1);
    if (step === 0) throw new CalcError('plage à pas nul');
    const raw = (end.base - start.base) / step;
    const count = Math.round(raw);
    if (count <= 0 || Math.abs(raw - count) > 1e-9) throw new CalcError('plage invalide');
    if (count > 100000) throw new CalcError('plage trop grande');
    for (let k = 1; k <= count; k++) {
      out.push(Units.quantity(start.base + k * step, start.dim, start.unit));
    }
  }

  function evaluate(ast, env) {
    switch (ast.type) {
      case 'num':
        return Units.scalar(ast.value);

      case 'list':
        return Units.list(flatten(evalSequence(ast.items, env)));

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

      case 'unary': {
        const v = evaluate(ast.operand, env);
        return isList(v) ? Units.list(v.items.map(Units.neg)) : Units.neg(v);
      }

      case 'percent': {
        const v = evaluate(ast.operand, env);
        if (isList(v)) return Units.list(v.items.map((x) => Units.div(x, Units.scalar(100))));
        return Units.div(v, Units.scalar(100));
      }

      case 'binary': {
        // Accounting-friendly percentages: "300 € + 20%" means +20% *of* 300 €
        // (i.e. 360 €), not "add the number 0.2". Only kicks in when the left
        // side carries a real unit, so "20% + 30%" still adds to 50%.
        if ((ast.op === '+' || ast.op === '-') && ast.right.type === 'percent') {
          const base = evaluate(ast.left, env);
          if (!isList(base) && !Units.isDimensionless(base.dim)) {
            const frac = Units.div(evaluate(ast.right.operand, env), Units.scalar(100));
            const factor = ast.op === '+'
              ? Units.add(Units.scalar(1), frac)
              : Units.sub(Units.scalar(1), frac);
            return Units.mul(base, factor);
          }
        }

        const a = evaluate(ast.left, env);
        const b = evaluate(ast.right, env);
        if (isList(a) || isList(b)) return listBinary(ast.op, a, b);
        return scalarBinary(ast.op, a, b);
      }

      case 'convert': {
        const q = evaluate(ast.expr, env);
        const target = evaluate(ast.target, env);
        if (isList(q)) return Units.list(q.items.map((x) => Units.convertTo(x, target.unit, target.dim)));
        return Units.convertTo(q, target.unit, target.dim);
      }

      case 'call': {
        const name = ast.name;
        const values = evalSequence(ast.args, env);
        if (FUNCTIONS[name]) {
          if (values.length !== 1) throw new CalcError(name + ' attend 1 argument');
          const v = values[0];
          return isList(v) ? Units.list(v.items.map(FUNCTIONS[name])) : FUNCTIONS[name](v);
        }
        if (VARIADIC[name]) return VARIADIC[name](flatten(values));
        throw new CalcError('fonction inconnue: ' + name);
      }

      default:
        throw new CalcError('nœud inconnu: ' + ast.type);
    }
  }

  return { evaluate, FUNCTIONS, VARIADIC, CONSTANTS };
});
