/*
 * grid-editor.js — an interactive, clickable spreadsheet grid.
 *
 * Each cell is an <input>. When a cell is not being edited it shows the
 * *computed value* (Excel-style: "=B2*C2" displays "6 €"); clicking it reveals
 * the raw text/formula for editing. Enter moves down, Tab moves right, and
 * discreet "+" handles on the right/bottom grow the grid.
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
    const colName = TC.Grid.colName;

    let model = { rows: 6, cols: 4, cells: {} };
    let computed = {};
    let inputs = {};       // "r,c" -> <input>
    let focusedKey = null;
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
    }

    function build() {
      container.textContent = '';
      inputs = {};
      const table = document.createElement('table');
      table.className = 'grid';

      const head = document.createElement('tr');
      const corner = document.createElement('th');
      corner.className = 'grid__corner';
      head.appendChild(corner);
      for (let c = 0; c < model.cols; c++) {
        const th = document.createElement('th');
        th.className = 'grid__colh';
        th.textContent = colName(c);
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
        rh.textContent = r + 1;
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

      container.appendChild(table);
      recompute();
    }

    return {
      setModel: function (m) {
        model = m && m.cells
          ? { rows: m.rows || 6, cols: m.cols || 4, cells: Object.assign({}, m.cells) }
          : { rows: 6, cols: 4, cells: {} };
        build();
      },
      getModel: function () { return model; },
      focus: function () { const i = inputs['0,0']; if (i) i.focus(); },
    };
  }

  return { createGridEditor: createGridEditor };
});
