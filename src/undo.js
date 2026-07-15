/*
 * undo.js — a tiny, generic undo/redo stack.
 *
 * It stores opaque snapshots (here: a JSON string of a note's blocks) and a
 * cursor into them. push() records a new state (dropping any redo branch),
 * undo()/redo() walk the cursor. Nothing here knows about notes — the caller
 * decides what a snapshot is and how to apply it.
 */
(function (root, factory) {
  const mod = factory();
  root.TC = root.TC || {};
  root.TC.createUndo = mod.createUndo;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createUndo(opts) {
    const limit = (opts && opts.limit) || 100;
    let stack = [];
    let index = -1;

    function reset(state) { stack = [state]; index = 0; }

    function push(state) {
      if (index >= 0 && stack[index] === state) return; // unchanged
      stack = stack.slice(0, index + 1);
      stack.push(state);
      if (stack.length > limit) stack.shift();
      index = stack.length - 1;
    }

    function canUndo() { return index > 0; }
    function canRedo() { return index >= 0 && index < stack.length - 1; }

    function undo() {
      if (!canUndo()) return null;
      index--;
      return stack[index];
    }
    function redo() {
      if (!canRedo()) return null;
      index++;
      return stack[index];
    }

    return { reset: reset, push: push, undo: undo, redo: redo, canUndo: canUndo, canRedo: canRedo };
  }

  return { createUndo: createUndo };
});
