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
    let dragFrom = -1;       // block index being dragged (-1 = none)

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

    // Cell references (B1, ranges) in text resolve against the note's tables,
    // so "total = B1" reads the grid's B1. With several tables, the first one
    // that has the cell wins.
    function noteCells() {
      const models = [];
      for (const c of ctx) if (c && c.type === 'grid') models.push(c.gridEditor.getModel());
      if (!models.length) return null;
      return {
        lookupCell: function (name) {
          for (const m of models) { const v = TC.Grid.cellValue(m, name); if (v != null) return v; }
          return null;
        },
        resolveRange: function (from, to) {
          for (const m of models) { const v = TC.Grid.rangeValue(m, from, to); if (v != null) return v; }
          return null;
        },
        // Qualified "Nom!B1" / "Nom!A1:A6": resolve within the named table only.
        lookupQCell: function (table, cell) {
          for (const m of models) if (m.name === table) return TC.Grid.cellValue(m, cell);
          return null;
        },
        resolveQRange: function (table, from, to) {
          for (const m of models) if (m.name === table) return TC.Grid.rangeValue(m, from, to);
          return null;
        },
      };
    }

    // Autocomplete sources handed to each text editor: the names of the note's
    // tables, and the filled cells of a given table (in A1 notation).
    function tableNameCompletions() {
      const out = [];
      for (const c of ctx) {
        if (c && c.type === 'grid') {
          const m = c.gridEditor.getModel();
          if (m && m.name) out.push({ name: m.name, kind: 'table' });
        }
      }
      return out;
    }
    function cellsForTable(name) {
      for (const c of ctx) {
        if (c && c.type === 'grid') {
          const m = c.gridEditor.getModel();
          if (m && m.name === name) {
            const out = [];
            for (const k in m.cells) {
              if (String(m.cells[k]).trim() === '') continue;
              const parts = k.split(',');
              out.push(TC.Grid.colName(+parts[1]) + (+parts[0] + 1));
            }
            return out.sort();
          }
        }
      }
      return [];
    }

    // Give every table a short, stable name (T1, T2…) so cells can be qualified
    // when the note has more than one. Existing names are kept.
    function assignTableNames() {
      const used = {};
      blocks.forEach(function (b) { if (b.type === 'grid' && b.grid && b.grid.name) used[b.grid.name] = 1; });
      let counter = 1;
      blocks.forEach(function (b) {
        if (b.type !== 'grid') return;
        if (!b.grid) b.grid = newGridModel();
        if (!b.grid.name) {
          while (used['T' + counter]) counter++;
          b.grid.name = 'T' + counter;
          used[b.grid.name] = 1;
        }
      });
    }

    // The result for one text block, sliced out of the whole-note evaluation
    // and re-indexed to that block's local lines.
    function evaluateBlock(i) {
      const res = TC.evaluateDocument(combinedText(), { externalCells: noteCells() });
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

    function save() { onChange(getBlocks()); recordHistory(); }

    /* ---- Undo / redo (note-level, debounced snapshots) -------------- */

    const history = TC.createUndo ? TC.createUndo({ limit: 120 }) : null;
    let restoring = false;
    let histTimer = null;

    function snapshot() { return JSON.stringify(getBlocks()); }
    function recordHistory() {
      if (!history || restoring) return;
      if (histTimer) clearTimeout(histTimer);
      histTimer = setTimeout(function () { histTimer = null; history.push(snapshot()); }, 500);
    }
    function flushHistory() {
      if (!history) return;
      if (histTimer) { clearTimeout(histTimer); histTimer = null; }
      history.push(snapshot());
    }
    // Build the internal block list from a stored/serialised shape (shared by
    // setNote and undo restore).
    function loadBlocks(src) {
      const arr = (src || []).map(function (b) {
        if (b.type === 'grid') return { type: 'grid', grid: b.grid ? JSON.parse(JSON.stringify(b.grid)) : newGridModel() };
        if (b.type === 'image') return { type: 'image', src: b.src || '', caption: b.caption || '' };
        return { type: 'text', body: b.body || '' };
      });
      return arr.length ? arr : [{ type: 'text', body: '' }];
    }
    function applySnapshot(json) {
      if (json == null) return;
      restoring = true;
      const scrollTop = container.scrollTop;
      blocks = loadBlocks(JSON.parse(json));
      assignTableNames();
      activeCtx = null;
      activeTextEditor = null;
      render();
      container.scrollTop = scrollTop;
      save(); // persist restored state (the restoring guard skips re-recording)
      restoring = false;
      const first = ctx[0];
      if (first) { if (first.type === 'text') first.editor.focus(); else if (first.gridEditor) first.gridEditor.focus(); }
    }
    function undo() { if (history) { flushHistory(); applySnapshot(history.undo()); } }
    function redo() { if (history) applySnapshot(history.redo()); }

    function textChanged(i, text) {
      blocks[i].body = text;
      save();
      refreshText(i); // other blocks may reference what just changed
    }

    function gridChanged(i, model) {
      blocks[i].grid = model;
      save();
      refreshText(); // text blocks may reference this table's cells
    }

    /* ---- Structural operations -------------------------------------- */

    function ensureNonEmpty() { if (!blocks.length) blocks.push({ type: 'text', body: '' }); }
    function ensureTrailingText() {
      if (!blocks.length || blocks[blocks.length - 1].type !== 'text') blocks.push({ type: 'text', body: '' });
    }

    function insertTableAt(pos) {
      pos = Math.max(0, Math.min(pos, blocks.length));
      blocks.splice(pos, 0, { type: 'grid', grid: newGridModel() });
      assignTableNames();
      ensureTrailingText();
      save();
      render();
      if (ctx[pos] && ctx[pos].gridEditor) ctx[pos].gridEditor.focus();
    }

    function insertTextAt(pos) {
      pos = Math.max(0, Math.min(pos, blocks.length));
      blocks.splice(pos, 0, { type: 'text', body: '' });
      save();
      render();
      if (ctx[pos] && ctx[pos].editor) ctx[pos].editor.focus();
    }

    function insertImageAt(pos, src) {
      pos = Math.max(0, Math.min(pos, blocks.length));
      blocks.splice(pos, 0, { type: 'image', src: src, caption: '' });
      ensureTrailingText();
      save();
      render();
    }

    // Insert a table just after the active block (used by the toolbar button).
    function insertTable() {
      insertTableAt(activeCtx == null ? blocks.length : activeCtx + 1);
    }

    // Read an image file, downscale it (so it fits comfortably in localStorage
    // and syncs reasonably), then insert it as a block.
    function pickImage(pos) {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.addEventListener('change', function () {
        const file = inp.files && inp.files[0];
        if (!file) return;
        downscale(file, function (dataURL) {
          if (!dataURL) return;
          if (dataURL.length > 2600000) {
            window.alert('Image trop lourde même après réduction — essayez une image plus petite.');
            return;
          }
          insertImageAt(pos, dataURL);
        });
      });
      inp.click();
    }

    function downscale(file, cb) {
      const reader = new FileReader();
      reader.onload = function () {
        const img = new Image();
        img.onload = function () {
          const MAX = 1400;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          try {
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            cb(canvas.toDataURL('image/jpeg', 0.85));
          } catch (e) { cb(reader.result); }
        };
        img.onerror = function () { cb(null); };
        img.src = reader.result;
      };
      reader.onerror = function () { cb(null); };
      reader.readAsDataURL(file);
    }

    function deleteBlock(i) {
      blocks.splice(i, 1);
      ensureNonEmpty();
      activeCtx = null;
      save();
      render();
    }

    // Reorder blocks by drag-and-drop. Cross-block references use the whole-note
    // scope, so reordering is semantically safe: save + render is enough. The
    // note-view scroll position is restored so the page doesn't jump.
    function moveBlock(from, to) {
      if (from < 0 || from >= blocks.length) return;
      const moved = blocks.splice(from, 1)[0];
      let dest = from < to ? to - 1 : to;
      dest = Math.max(0, Math.min(dest, blocks.length));
      if (dest === from) { blocks.splice(from, 0, moved); return; }
      blocks.splice(dest, 0, moved);
      activeCtx = null;
      const scrollTop = container.scrollTop;
      save();
      render();
      container.scrollTop = scrollTop;
    }

    function clearDropMarks() {
      const marked = container.querySelectorAll('.drop-before, .drop-after');
      Array.prototype.forEach.call(marked, function (el) { el.classList.remove('drop-before', 'drop-after'); });
    }
    // Wire a block wrapper as a drop target during a drag.
    function wireDropTarget(wrap, i) {
      wrap.addEventListener('dragover', function (e) {
        if (dragFrom < 0) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const rect = wrap.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        clearDropMarks();
        wrap.classList.add(before ? 'drop-before' : 'drop-after');
      });
      wrap.addEventListener('dragleave', function () { wrap.classList.remove('drop-before', 'drop-after'); });
      wrap.addEventListener('drop', function (e) {
        if (dragFrom < 0) return;
        e.preventDefault();
        const rect = wrap.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        const target = before ? i : i + 1;
        const from = dragFrom;
        dragFrom = -1;
        container.classList.remove('is-dragging');
        clearDropMarks();
        moveBlock(from, target);
      });
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
      btn.title = 'Insérer un bloc ici';
      btn.textContent = '＋';
      const menu = document.createElement('div');
      menu.className = 'block-insert__menu';
      menu.hidden = true;
      [['📝 Texte', function () { insertTextAt(pos); }],
        ['▦ Tableau', function () { insertTableAt(pos); }],
        ['🖼 Image', function () { pickImage(pos); }]].forEach(function (opt) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'block-insert__opt';
        b.textContent = opt[0];
        b.addEventListener('click', function () { menu.hidden = true; opt[1](); });
        menu.appendChild(b);
      });
      btn.addEventListener('click', function () { menu.hidden = !menu.hidden; });
      // Close the menu when focus/click leaves the row.
      row.addEventListener('focusout', function () { setTimeout(function () { if (!row.contains(document.activeElement)) menu.hidden = true; }, 0); });
      row.appendChild(btn);
      row.appendChild(menu);
      return row;
    }

    function makeImageBlock(block, i) {
      const wrap = document.createElement('div');
      wrap.className = 'note-block note-block--image';
      wrap.appendChild(blockTools(i));
      const fig = document.createElement('figure');
      fig.className = 'img-block';
      const img = document.createElement('img');
      img.src = block.src || '';
      img.alt = block.caption || '';
      img.loading = 'lazy';
      fig.appendChild(img);
      const cap = document.createElement('input');
      cap.className = 'img-block__cap';
      cap.type = 'text';
      cap.placeholder = 'Légende (facultatif)';
      cap.value = block.caption || '';
      cap.addEventListener('input', function () { blocks[i].caption = cap.value; img.alt = cap.value; save(); });
      fig.appendChild(cap);
      wrap.appendChild(fig);
      ctx[i] = { type: 'image', el: wrap };
      return wrap;
    }

    function blockTools(i) {
      const tools = document.createElement('div');
      tools.className = 'note-block__tools';
      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'note-block__grip';
      grip.title = 'Déplacer ce bloc (glisser-déposer)';
      grip.setAttribute('aria-label', 'Déplacer ce bloc');
      grip.textContent = '⠿';
      grip.draggable = true;
      grip.addEventListener('dragstart', function (e) {
        dragFrom = i;
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          try { e.dataTransfer.setData('text/plain', String(i)); } catch (x) { /* IE guard */ }
        }
        container.classList.add('is-dragging');
      });
      grip.addEventListener('dragend', function () {
        dragFrom = -1;
        container.classList.remove('is-dragging');
        clearDropMarks();
      });
      tools.appendChild(grip);
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
        dynamicCompletions: tableNameCompletions,
        cellsForTable: cellsForTable,
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
        let wrap;
        if (block.type === 'grid') wrap = makeGridBlock(block, i);
        else if (block.type === 'image') wrap = makeImageBlock(block, i);
        else wrap = makeTextBlock(block, i);
        wireDropTarget(wrap, i);
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
        if (b.type === 'grid') return { type: 'grid', grid: b.grid };
        if (b.type === 'image') return { type: 'image', src: b.src, caption: b.caption };
        return { type: 'text', body: b.body };
      });
    }

    return {
      setNote: function (note) {
        blocks = loadBlocks((note && note.blocks) || []);
        assignTableNames();
        activeCtx = null;
        activeTextEditor = null;
        render();
        if (history) history.reset(snapshot());
      },
      getBlocks: getBlocks,
      undo: undo,
      redo: redo,
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
      // Shorten constant calculations across every text block, using the whole
      // note's variable/function names so a variable is never mistaken for a
      // constant. Returns true if anything changed.
      simplify: function () {
        const names = TC.evaluateDocument(combinedText()).names;
        const isVar = function (n) { return names.vars.indexOf(n) >= 0; };
        const isFunc = function (n) { return names.funcs.indexOf(n) >= 0; };
        let any = false;
        for (let i = 0; i < ctx.length; i++) {
          if (ctx[i].type !== 'text') continue;
          const cur = ctx[i].editor.getValue();
          const next = TC.simplifyDocument(cur, isVar, isFunc);
          if (next !== cur) { blocks[i].body = next; ctx[i].editor.setValue(next); any = true; }
        }
        if (any) { save(); refreshText(); }
        return any;
      },
      destroy: destroyCtx,
    };
  }

  return { createNoteEditor: createNoteEditor };
});
