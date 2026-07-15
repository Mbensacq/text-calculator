/*
 * note-editor.js — a note as a vertical stack of blocks.
 *
 * A note is a list of blocks: text-that-calculates and interactive tables,
 * interleaved. Text blocks reuse the writing surface (editor.js) in "block"
 * mode (auto-height); table blocks reuse the clickable grid (grid-editor.js).
 *
 * Crucially, the note keeps ONE calc scope: all text blocks are evaluated
 * together (concatenated in order), so a variable defined in one text block is
 * usable in another — even across a table between them. Forward references
 * therefore keep working. Tables have their own A1 scope (self-contained), as
 * before.
 */
(function (root, factory) {
  const mod = factory();
  root.TC = root.TC || {};
  root.TC.createNoteEditor = mod.createNoteEditor;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function newGridModel() { return { rows: 6, cols: 4, cells: {} }; }

  function createNoteEditor(opts) {
    const container = opts.container;
    const onChange = opts.onChange || function () {};
    const completions = opts.completions || [];

    let blocks = [{ type: 'text', body: '' }];
    let ctx = [];            // parallel to blocks: { type, el, editor?|gridEditor? }
    let activeCtx = null;    // index of the last-focused block
    let activeTextEditor = null;

    /* ---- Shared-scope evaluation ------------------------------------ */

    function combinedText() {
      const out = [];
      for (const c of ctx) if (c && c.type === 'text') out.push(c.editor.getValue());
      return out.join('\n');
    }

    // Global line where text-block `i` starts in the combined document.
    function textOffsetBefore(i) {
      let off = 0;
      for (let j = 0; j < i; j++) {
        if (ctx[j] && ctx[j].type === 'text') off += ctx[j].editor.getValue().split('\n').length;
      }
      return off;
    }

    // The result for one text block, sliced out of the whole-note evaluation
    // and re-indexed to that block's local lines.
    function evaluateBlock(i) {
      const res = TC.evaluateDocument(combinedText());
      const offset = textOffsetBefore(i);
      const n = ctx[i].editor.getValue().split('\n').length;
      const lines = [];
      for (const l of res.lines) {
        if (l.index >= offset && l.index < offset + n) {
          const c = Object.assign({}, l);
          c.index = l.index - offset;
          lines.push(c);
        }
      }
      return { lines: lines, names: res.names };
    }

    function refreshText(exceptIndex) {
      for (let j = 0; j < ctx.length; j++) {
        if (ctx[j].type === 'text' && j !== exceptIndex) ctx[j].editor.recompute(false);
      }
    }

    /* ---- Change handlers -------------------------------------------- */

    function save() { onChange(getBlocks()); }

    function textChanged(i, text) {
      blocks[i].body = text;
      save();
      refreshText(i); // other blocks may reference what just changed
    }

    function gridChanged(i, model) {
      blocks[i].grid = model;
      save();
    }

    /* ---- Structural operations -------------------------------------- */

    function ensureNonEmpty() { if (!blocks.length) blocks.push({ type: 'text', body: '' }); }
    function ensureTrailingText() {
      if (!blocks.length || blocks[blocks.length - 1].type !== 'text') blocks.push({ type: 'text', body: '' });
    }

    function insertTableAt(pos) {
      pos = Math.max(0, Math.min(pos, blocks.length));
      blocks.splice(pos, 0, { type: 'grid', grid: newGridModel() });
      ensureTrailingText();
      save();
      render();
      if (ctx[pos] && ctx[pos].gridEditor) ctx[pos].gridEditor.focus();
    }

    // Insert a table just after the active block (used by the toolbar button).
    function insertTable() {
      insertTableAt(activeCtx == null ? blocks.length : activeCtx + 1);
    }

    function deleteBlock(i) {
      blocks.splice(i, 1);
      ensureNonEmpty();
      activeCtx = null;
      save();
      render();
    }

    /* ---- Rendering -------------------------------------------------- */

    function destroyCtx() {
      for (const c of ctx) if (c.type === 'text' && c.editor.destroy) c.editor.destroy();
      ctx = [];
    }

    function insertRow(pos) {
      const row = document.createElement('div');
      row.className = 'block-insert';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'block-insert__btn';
      btn.title = 'Insérer un tableau ici';
      btn.appendChild(document.createTextNode('＋ Tableau'));
      btn.addEventListener('click', function () { insertTableAt(pos); });
      row.appendChild(btn);
      return row;
    }

    function blockTools(i) {
      const tools = document.createElement('div');
      tools.className = 'note-block__tools';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'note-block__del';
      del.title = 'Supprimer ce bloc';
      del.setAttribute('aria-label', 'Supprimer ce bloc');
      del.textContent = '×';
      del.addEventListener('click', function () { deleteBlock(i); });
      tools.appendChild(del);
      return tools;
    }

    function makeTextBlock(block, i) {
      const wrap = document.createElement('div');
      wrap.className = 'note-block note-block--text';
      wrap.appendChild(blockTools(i));

      const ed = document.createElement('div');
      ed.className = 'editor';
      const ta = document.createElement('textarea');
      ta.className = 'editor__input';
      ta.spellcheck = false;
      ta.autocomplete = 'off';
      ta.setAttribute('autocapitalize', 'off');
      ta.setAttribute('autocorrect', 'off');
      const hl = document.createElement('div');
      hl.className = 'editor__highlight';
      hl.setAttribute('aria-hidden', 'true');
      ed.appendChild(ta);
      ed.appendChild(hl);
      wrap.appendChild(ed);

      const editor = TC.createEditor({
        input: ta,
        highlight: hl,
        block: true,
        completions: completions,
        evaluate: function () { return evaluateBlock(i); },
        onChange: function (text) { textChanged(i, text); },
      });
      // Register the context entry before setValue, since setValue triggers an
      // evaluation that reads this block back out of ctx.
      ctx[i] = { type: 'text', el: wrap, editor: editor };
      editor.setValue(block.body || '');
      wrap.addEventListener('focusin', function () { activeCtx = i; activeTextEditor = editor; });
      return wrap;
    }

    function makeGridBlock(block, i) {
      const wrap = document.createElement('div');
      wrap.className = 'note-block note-block--grid';
      wrap.appendChild(blockTools(i));

      const gwrap = document.createElement('div');
      gwrap.className = 'gridwrap';
      wrap.appendChild(gwrap);

      const gridEditor = TC.createGridEditor({
        container: gwrap,
        onChange: function (model) { gridChanged(i, model); },
        onDeleteTable: function () { deleteBlock(i); },
      });
      ctx[i] = { type: 'grid', el: wrap, gridEditor: gridEditor };
      gridEditor.setModel(block.grid || newGridModel());
      wrap.addEventListener('focusin', function () { activeCtx = i; });
      return wrap;
    }

    function render() {
      destroyCtx();
      container.textContent = '';
      ctx = new Array(blocks.length);
      blocks.forEach(function (block, i) {
        const wrap = block.type === 'grid' ? makeGridBlock(block, i) : makeTextBlock(block, i);
        container.appendChild(wrap);
        container.appendChild(insertRow(i + 1));
      });
      // Every block now exists — evaluate once more so cross-block references
      // (including forward ones) resolve against the whole note.
      refreshText();
    }

    /* ---- Public API ------------------------------------------------- */

    function getBlocks() {
      return blocks.map(function (b) {
        return b.type === 'grid' ? { type: 'grid', grid: b.grid } : { type: 'text', body: b.body };
      });
    }

    return {
      setNote: function (note) {
        const src = (note && note.blocks) || [];
        blocks = src.map(function (b) {
          return b.type === 'grid'
            ? { type: 'grid', grid: b.grid ? JSON.parse(JSON.stringify(b.grid)) : newGridModel() }
            : { type: 'text', body: b.body || '' };
        });
        if (!blocks.length) blocks = [{ type: 'text', body: '' }];
        activeCtx = null;
        activeTextEditor = null;
        render();
      },
      getBlocks: getBlocks,
      insertTable: insertTable,
      focus: function () {
        const first = ctx[0];
        if (!first) return;
        if (first.type === 'text') first.editor.focus();
        else if (first.gridEditor) first.gridEditor.focus();
      },
      insertAtCaret: function (text, offset) {
        if (activeTextEditor) activeTextEditor.insertAtCaret(text, offset);
        else if (ctx[0] && ctx[0].type === 'text') { ctx[0].editor.focus(); ctx[0].editor.insertAtCaret(text, offset); }
      },
      destroy: destroyCtx,
    };
  }

  return { createNoteEditor: createNoteEditor };
});
