/*
 * command-palette.js — a keyboard-first command launcher (Ctrl/Cmd+K).
 *
 * A small, self-contained overlay: type to fuzzy-filter a list of named
 * actions, arrow keys to move, Enter to run, Escape to close. It doesn't know
 * about the app — the caller supplies the commands via getCommands(), so every
 * action is wired to a handler that already exists.
 */
(function (root, factory) {
  const mod = factory();
  root.TC = root.TC || {};
  root.TC.createCommandPalette = mod.createCommandPalette;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Subsequence fuzzy match: every character of `needle` must appear in order.
  // Returns a score (higher = better, contiguous runs favoured), or -1 if no
  // match at all.
  function fuzzy(hay, needle) {
    hay = hay.toLowerCase();
    needle = needle.toLowerCase();
    if (!needle) return 0;
    let hi = 0, score = 0, streak = 0;
    for (let ni = 0; ni < needle.length; ni++) {
      let found = -1;
      for (let k = hi; k < hay.length; k++) { if (hay[k] === needle[ni]) { found = k; break; } }
      if (found === -1) return -1;
      streak = found === hi ? streak + 1 : 0;
      score += 1 + streak;
      hi = found + 1;
    }
    return score;
  }

  function createCommandPalette(opts) {
    const getCommands = (opts && opts.getCommands) || function () { return []; };
    let rootEl = null, input = null, list = null, items = [], active = 0, open = false;

    function build() {
      rootEl = document.createElement('div');
      rootEl.className = 'cmdk';
      rootEl.hidden = true;
      const box = document.createElement('div');
      box.className = 'cmdk__box';
      input = document.createElement('input');
      input.className = 'cmdk__input';
      input.type = 'text';
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.placeholder = 'Tapez une commande…';
      input.setAttribute('aria-label', 'Palette de commandes');
      list = document.createElement('ul');
      list.className = 'cmdk__list';
      box.appendChild(input);
      box.appendChild(list);
      rootEl.appendChild(box);
      document.body.appendChild(rootEl);
      rootEl.addEventListener('mousedown', function (e) { if (e.target === rootEl) close(); });
      input.addEventListener('input', render);
      input.addEventListener('keydown', onKey);
    }

    function render() {
      const q = input.value.trim();
      let scored = getCommands().map(function (c) { return { c: c, s: fuzzy((c.label || '') + ' ' + (c.hint || ''), q) }; });
      if (q) scored = scored.filter(function (x) { return x.s >= 0; }).sort(function (a, b) { return b.s - a.s; });
      items = scored.map(function (x) { return x.c; }).slice(0, 30);
      active = 0;
      list.textContent = '';
      if (!items.length) {
        const empty = document.createElement('li');
        empty.className = 'cmdk__empty';
        empty.textContent = 'Aucune commande';
        list.appendChild(empty);
        return;
      }
      items.forEach(function (c, i) {
        const li = document.createElement('li');
        li.className = 'cmdk__item' + (i === active ? ' is-active' : '');
        const lab = document.createElement('span');
        lab.className = 'cmdk__label';
        lab.textContent = c.label;
        li.appendChild(lab);
        if (c.hint) {
          const h = document.createElement('span');
          h.className = 'cmdk__hint';
          h.textContent = c.hint;
          li.appendChild(h);
        }
        li.addEventListener('mouseenter', function () { active = i; paint(); });
        li.addEventListener('click', function () { runItem(i); });
        list.appendChild(li);
      });
    }

    function paint() {
      Array.prototype.forEach.call(list.children, function (li, i) { li.classList.toggle('is-active', i === active); });
      const el = list.children[active];
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }

    function onKey(e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); runItem(active); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    }

    function runItem(i) {
      const c = items[i];
      close();
      if (c && typeof c.run === 'function') c.run();
    }

    function show() {
      if (!rootEl) build();
      open = true;
      rootEl.hidden = false;
      input.value = '';
      render();
      setTimeout(function () { input.focus(); }, 0);
    }
    function close() {
      open = false;
      if (rootEl) rootEl.hidden = true;
    }
    function toggle() { if (open) close(); else show(); }

    return { show: show, close: close, toggle: toggle, isOpen: function () { return open; } };
  }

  return { createCommandPalette: createCommandPalette, fuzzy: fuzzy };
});
