/*
 * grid-editor.js — an interactive, clickable spreadsheet grid.
 *
 * Each cell is an <input>. When a cell is not being edited it shows the
 * *computed value* (Excel-style: "=B2*C2" displays "6 €"); clicking it reveals
 * the raw text/formula for editing. Enter moves down, Tab moves right, and
 * discreet "+" handles on the right/bottom grow the grid.
 *
 * Column and row headers are clickable: selecting one highlights the line and
 * shows a live sum / average / count in the status bar, from where the range
 * can be dropped into a cell as "=somme(…)". Headers also carry a "×" to
 * delete that column or row (references in formulas are adjusted).
 */
(function (root, factory) {
  const mod = factory();
  root.TC = root.TC || {};
  root.TC.createGridEditor = mod.createGridEditor;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createGridEditor(opts) {
    const container = opts.container;
    const onChange = opts.onChange || function () {};
    const onDeleteTable = opts.onDeleteTable || function () {};
    const Grid = TC.Grid;
    const colName = Grid.colName;

    let model = { rows: 6, cols: 4, cells: {} };
    let computed = {};
    let inputs = {};       // "r,c" -> <input>
    let cellTds = {};      // "r,c" -> <td>
    let colHeads = [];     // c -> <th>
    let rowHeads = [];     // r -> <th>
    let focusedKey = null;
    let selection = null;  // { axis: 'col'|'row', index }
    let statusEl = null;
    let saveTimer = null;

    const key = (r, c) => r + ',' + c;
    const raw = (r, c) => { const v = model.cells[key(r, c)]; return v == null ? '' : v; };

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { onChange(model); }, 200);
    }

    function recompute() {
      computed = TC.computeGrid(model);
      for (const k in inputs) if (k !== focusedKey) applyDisplay(k);
    }

    function applyDisplay(k) {
      const input = inputs[k];
      if (!input) return;
      const cell = computed[k];
      input.classList.remove('is-error', 'is-formula');
      if (cell && cell.error) {
        input.value = '⚠';
        input.title = cell.message || 'erreur';
        input.classList.add('is-error');
      } else if (cell) {
        input.value = cell.display;
        input.title = '';
        if (cell.formula) input.classList.add('is-formula');
      } else {
        input.value = '';
        input.title = '';
      }
    }

    function commit(r, c, val) {
      const k = key(r, c);
      if (val.trim() === '') delete model.cells[k];
      else model.cells[k] = val;
      scheduleSave();
    }

    function focusCell(r, c) {
      if (r >= model.rows) { model.rows++; build(); }
      else if (c >= model.cols) { model.cols++; build(); }
      r = Math.max(0, Math.min(r, model.rows - 1));
      c = Math.max(0, Math.min(c, model.cols - 1));
      const input = inputs[key(r, c)];
      if (input) input.focus();
    }

    function wireCell(input, r, c) {
      input.addEventListener('focus', function () {
        if (selection) clearSelection();
        focusedKey = key(r, c);
        input.value = raw(r, c);
        input.classList.remove('is-error');
        input.select();
      });
      input.addEventListener('blur', function () {
        commit(r, c, input.value);
        focusedKey = null;
        recompute();
        applyDisplay(key(r, c));
      });
      input.addEventListener('input', function () {
        commit(r, c, input.value);
        recompute();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); focusCell(r + 1, c); }
        else if (e.key === 'Tab') { e.preventDefault(); focusCell(r, c + (e.shiftKey ? -1 : 1)); }
      });
      input.addEventListener('paste', function (e) {
        const cd = e.clipboardData || window.clipboardData;
        const text = cd ? cd.getData('text') : '';
        // Multi-cell paste (Excel/CSV) only when it spans rows or columns.
        if (text.indexOf('\t') < 0 && text.indexOf('\n') < 0) return; // single cell → default
        e.preventDefault();
        pasteGrid(r, c, text);
      });
    }

    // Spread pasted spreadsheet/CSV text across cells from (r0, c0), growing the
    // grid as needed.
    function pasteGrid(r0, c0, text) {
      const data = Grid.parseDelimited(text);
      data.forEach(function (rowArr, dr) {
        rowArr.forEach(function (val, dc) {
          const rr = r0 + dr, cc = c0 + dc;
          if (rr + 1 > model.rows) model.rows = rr + 1;
          if (cc + 1 > model.cols) model.cols = cc + 1;
          if (val === '') delete model.cells[key(rr, cc)];
          else model.cells[key(rr, cc)] = val;
        });
      });
      scheduleSave();
      build();
      focusCell(r0, c0);
    }

    // Copy the column's first non-empty cell down to the last data row,
    // incrementing row references when it is a formula.
    function fillDown(col) {
      let src = -1;
      for (let r = 0; r < model.rows; r++) if (raw(r, col).trim() !== '') { src = r; break; }
      if (src < 0) return;
      const srcVal = raw(src, col);
      let last = src;
      for (let r = 0; r < model.rows; r++) for (let c = 0; c < model.cols; c++) if (raw(r, c).trim() !== '' && r > last) last = r;
      for (let r = src + 1; r <= last; r++) model.cells[key(r, col)] = Grid.fillFormula(srcVal, r - src);
      selection = null;
      scheduleSave();
      build();
    }

    function sortColumn(col, dir) {
      model = Grid.sortByColumn(model, col, dir);
      selection = null;
      scheduleSave();
      build();
    }

    function firstDataIsFormula(col) {
      for (let r = 0; r < model.rows; r++) {
        const v = raw(r, col).trim();
        if (v !== '') return v.charAt(0) === '=';
      }
      return false;
    }

    /* ---- Selection & aggregates ------------------------------------- */

    function clearSelection() {
      selection = null;
      applySelection();
    }

    function selectAxis(axis, index) {
      selection = (selection && selection.axis === axis && selection.index === index)
        ? null : { axis: axis, index: index };
      applySelection();
    }

    function applySelection() {
      for (const k in cellTds) cellTds[k].classList.remove('is-sel');
      colHeads.forEach((h) => h.classList.remove('is-sel'));
      rowHeads.forEach((h) => h.classList.remove('is-sel'));
      if (selection) {
        if (selection.axis === 'col') {
          if (colHeads[selection.index]) colHeads[selection.index].classList.add('is-sel');
          for (let r = 0; r < model.rows; r++) { const td = cellTds[key(r, selection.index)]; if (td) td.classList.add('is-sel'); }
        } else {
          if (rowHeads[selection.index]) rowHeads[selection.index].classList.add('is-sel');
          for (let c = 0; c < model.cols; c++) { const td = cellTds[key(selection.index, c)]; if (td) td.classList.add('is-sel'); }
        }
      }
      renderStatus();
    }

    function selectionRange() {
      if (!selection) return null;
      if (selection.axis === 'col') {
        const a = colName(selection.index);
        return a + '1:' + a + model.rows;
      }
      const rowNum = selection.index + 1;
      return 'A' + rowNum + ':' + colName(model.cols - 1) + rowNum;
    }

    function renderStatus() {
      if (!statusEl) return;
      statusEl.textContent = '';
      if (!selection) { statusEl.hidden = true; return; }
      statusEl.hidden = false;

      const label = document.createElement('span');
      label.className = 'grid-status__label';
      label.textContent = selection.axis === 'col'
        ? 'Colonne ' + colName(selection.index)
        : 'Ligne ' + (selection.index + 1);
      statusEl.appendChild(label);

      const range = selectionRange();
      const cnt = Grid.evalExpr(model, 'count(' + range + ')');
      const hasNums = !cnt.error && cnt.display !== '0' && cnt.display !== '';

      if (hasNums) {
        const sum = Grid.evalExpr(model, 'somme(' + range + ')');
        const avg = Grid.evalExpr(model, 'moy(' + range + ')');
        statusEl.appendChild(stat('Σ', sum.error ? '—' : sum.display));
        statusEl.appendChild(stat('moy', avg.error ? '—' : avg.display));
        statusEl.appendChild(stat('n', cnt.display));

        const insert = document.createElement('button');
        insert.type = 'button';
        insert.className = 'grid-status__btn';
        insert.textContent = selection.axis === 'col' ? 'Insérer Σ ↓' : 'Insérer Σ →';
        insert.title = 'Placer =somme(' + range + ') dans une cellule';
        insert.addEventListener('click', function () { insertSum(); });
        statusEl.appendChild(insert);
      } else {
        const none = document.createElement('span');
        none.className = 'grid-status__muted';
        none.textContent = 'aucune valeur numérique';
        statusEl.appendChild(none);
      }

      // Column-only tools: sort the rows and fill a formula down.
      if (selection.axis === 'col') {
        const col = selection.index;
        statusEl.appendChild(actionBtn('Trier ↑', 'Trier les lignes par cette colonne (croissant)', function () { sortColumn(col, 'asc'); }));
        statusEl.appendChild(actionBtn('Trier ↓', 'Trier les lignes par cette colonne (décroissant)', function () { sortColumn(col, 'desc'); }));
        if (firstDataIsFormula(col)) {
          statusEl.appendChild(actionBtn('Recopier ↓', 'Recopier la formule vers le bas (références de ligne ajustées)', function () { fillDown(col); }));
        }
      }

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'grid-status__btn grid-status__btn--danger';
      del.textContent = selection.axis === 'col' ? 'Supprimer la colonne' : 'Supprimer la ligne';
      del.addEventListener('click', function () { deleteAxis(selection.axis, selection.index); });
      statusEl.appendChild(del);
    }

    function actionBtn(label, title, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'grid-status__btn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', onClick);
      return b;
    }

    function stat(label, value) {
      const s = document.createElement('span');
      s.className = 'grid-status__stat';
      const l = document.createElement('span'); l.className = 'grid-status__k'; l.textContent = label;
      const v = document.createElement('span'); v.className = 'grid-status__v'; v.textContent = value;
      s.appendChild(l); s.appendChild(v);
      return s;
    }

    // Drop "=somme(range)" just past the selected line's data.
    function insertSum() {
      if (!selection) return;
      const range = selectionRange();
      if (selection.axis === 'col') {
        const c = selection.index;
        let last = -1;
        for (let r = 0; r < model.rows; r++) if (raw(r, c).trim() !== '') last = r;
        if (last < 0) return;
        const target = last + 1;
        if (target >= model.rows) model.rows = target + 1;
        model.cells[key(target, c)] = '=somme(' + colName(c) + '1:' + colName(c) + (last + 1) + ')';
      } else {
        const r = selection.index;
        let last = -1;
        for (let c = 0; c < model.cols; c++) if (raw(r, c).trim() !== '') last = c;
        if (last < 0) return;
        const target = last + 1;
        if (target >= model.cols) model.cols = target + 1;
        model.cells[key(r, target)] = '=somme(A' + (r + 1) + ':' + colName(last) + (r + 1) + ')';
      }
      selection = null;
      scheduleSave();
      build();
    }

    function axisHasContent(axis, index) {
      if (axis === 'col') {
        for (let r = 0; r < model.rows; r++) if (raw(r, index).trim() !== '') return true;
      } else {
        for (let c = 0; c < model.cols; c++) if (raw(index, c).trim() !== '') return true;
      }
      return false;
    }

    function deleteAxis(axis, index) {
      const min = axis === 'col' ? model.cols : model.rows;
      if (min <= 1) return; // keep at least one line
      if (axisHasContent(axis, index)) {
        const what = axis === 'col' ? 'la colonne ' + colName(index) : 'la ligne ' + (index + 1);
        if (!window.confirm('Supprimer ' + what + ' et son contenu ?')) return;
      }
      model = axis === 'col' ? Grid.deleteColumn(model, index) : Grid.deleteRow(model, index);
      selection = null;
      scheduleSave();
      build();
    }

    /* ---- Rendering -------------------------------------------------- */

    function headerLabel(text) {
      const s = document.createElement('span');
      s.className = 'grid__hlabel';
      s.textContent = text;
      return s;
    }
    function delBtn(title, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'grid__del';
      b.textContent = '×';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
      return b;
    }

    function build() {
      container.textContent = '';
      inputs = {};
      cellTds = {};
      colHeads = [];
      rowHeads = [];
      const table = document.createElement('table');
      table.className = 'grid';

      const head = document.createElement('tr');
      const corner = document.createElement('th');
      corner.className = 'grid__corner';
      corner.textContent = '🗑';
      corner.title = 'Supprimer ce tableau';
      corner.setAttribute('role', 'button');
      corner.setAttribute('aria-label', 'Supprimer ce tableau');
      corner.addEventListener('click', function () { onDeleteTable(); });
      head.appendChild(corner);
      for (let c = 0; c < model.cols; c++) {
        const th = document.createElement('th');
        th.className = 'grid__colh';
        th.appendChild(headerLabel(colName(c)));
        th.appendChild(delBtn('Supprimer la colonne ' + colName(c), (function (col) { return function () { deleteAxis('col', col); }; })(c)));
        th.addEventListener('click', (function (col) { return function () { selectAxis('col', col); }; })(c));
        colHeads[c] = th;
        head.appendChild(th);
      }
      const addCol = document.createElement('th');
      addCol.className = 'grid__add';
      addCol.textContent = '+';
      addCol.title = 'Ajouter une colonne';
      addCol.addEventListener('click', function () { model.cols++; scheduleSave(); build(); });
      head.appendChild(addCol);
      table.appendChild(head);

      for (let r = 0; r < model.rows; r++) {
        const tr = document.createElement('tr');
        const rh = document.createElement('th');
        rh.className = 'grid__rowh';
        rh.appendChild(headerLabel(String(r + 1)));
        rh.appendChild(delBtn('Supprimer la ligne ' + (r + 1), (function (row) { return function () { deleteAxis('row', row); }; })(r)));
        rh.addEventListener('click', (function (row) { return function () { selectAxis('row', row); }; })(r));
        rowHeads[r] = rh;
        tr.appendChild(rh);
        for (let c = 0; c < model.cols; c++) {
          const td = document.createElement('td');
          td.className = 'grid__cell';
          const input = document.createElement('input');
          input.type = 'text';
          input.spellcheck = false;
          input.autocomplete = 'off';
          wireCell(input, r, c);
          inputs[key(r, c)] = input;
          cellTds[key(r, c)] = td;
          td.appendChild(input);
          tr.appendChild(td);
        }
        tr.appendChild(document.createElement('td')); // under the +column handle
        table.appendChild(tr);
      }

      const addRowTr = document.createElement('tr');
      const addRow = document.createElement('th');
      addRow.className = 'grid__add';
      addRow.textContent = '+';
      addRow.title = 'Ajouter une ligne';
      addRow.addEventListener('click', function () { model.rows++; scheduleSave(); build(); });
      addRowTr.appendChild(addRow);
      const fill = document.createElement('td');
      fill.colSpan = model.cols + 1;
      addRowTr.appendChild(fill);
      table.appendChild(addRowTr);

      const gridHead = document.createElement('div');
      gridHead.className = 'grid-head';
      const nameInput = document.createElement('input');
      nameInput.className = 'grid-name';
      nameInput.type = 'text';
      nameInput.spellcheck = false;
      nameInput.placeholder = 'Nom du tableau';
      nameInput.value = model.name || '';
      nameInput.title = 'Nom du tableau — pour référencer une cellule : Nom!B1';
      nameInput.addEventListener('input', function () { model.name = nameInput.value; scheduleSave(); });
      gridHead.appendChild(nameInput);
      container.appendChild(gridHead);

      container.appendChild(table);

      statusEl = document.createElement('div');
      statusEl.className = 'grid-status';
      statusEl.hidden = true;
      container.appendChild(statusEl);

      recompute();
      applySelection();
    }

    return {
      setModel: function (m) {
        model = m && m.cells
          ? { rows: m.rows || 6, cols: m.cols || 4, cells: Object.assign({}, m.cells), name: m.name || '' }
          : { rows: 6, cols: 4, cells: {}, name: '' };
        selection = null;
        build();
      },
      getModel: function () { return model; },
      focus: function () { const i = inputs['0,0']; if (i) i.focus(); },
    };
  }

  return { createGridEditor: createGridEditor };
});
