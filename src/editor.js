/*
 * editor.js — the writing surface.
 *
 * A plain <textarea> holds the text so typing, selection and undo all behave
 * natively. Behind it, sharing its exact metrics, sit two layers:
 *
 *   • a highlight layer that re-renders each line with light syntax colouring
 *     (headings, comments, variable names). The textarea's own text is drawn
 *     transparent, so what the eye reads is this coloured layer.
 *   • a results layer that carries the computed values. Results appear only on
 *     lines ending in "=", placed right after that sign.
 *
 * The results layer is *persistent*: instead of rebuilding every result on each
 * keystroke, we reuse the element for each line and only animate it when it
 * actually appears or changes value. That keeps the page calm while typing and
 * lively exactly when something is computed.
 */
(function (root, factory) {
  const mod = factory();
  root.TC = root.TC || {};
  root.TC.createEditor = mod.createEditor;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COPIED_STYLES = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'textIndent',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing', 'tabSize',
  ];

  const HEADING_RE = /^\s*#/;
  const COMMENT_RE = /^\s*\/\//;
  const ASSIGN_RE = /^(\s*)([\p{L}_][\p{L}\p{N}_]*)(\s*=)([\s\S]*)$/u;
  const FUNCDEF_RE = /^(\s*)([\p{L}_][\p{L}\p{N}_]*)(\([^)]*\)\s*=)([\s\S]*)$/u;

  const ENTER_KEYFRAMES = [
    { opacity: 0, transform: 'translateY(4px) scale(0.96)' },
    { opacity: 1, transform: 'translateY(0) scale(1)' },
  ];
  const UPDATE_KEYFRAMES = [
    { opacity: 0.45, transform: 'scale(0.97)' },
    { opacity: 1, transform: 'scale(1)' },
  ];

  function textNode(t) { return document.createTextNode(t); }
  function span(cls, t) {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = t;
    return s;
  }

  const INLINE_COMMENT_RE = /(^|\s)\/\//;

  function colouriseCode(div, code) {
    const fm = code.match(FUNCDEF_RE);
    if (fm) {
      div.appendChild(textNode(fm[1]));
      div.appendChild(span('hl-var', fm[2]));
      div.appendChild(textNode(fm[3] + fm[4]));
      return;
    }
    const m = code.match(ASSIGN_RE);
    if (m) {
      div.appendChild(textNode(m[1]));
      div.appendChild(span('hl-var', m[2]));
      div.appendChild(textNode(m[3] + m[4]));
      return;
    }
    div.appendChild(textNode(code));
  }

  function colourise(div, line) {
    if (!line.trim()) { div.textContent = '​'; return; }
    if (HEADING_RE.test(line)) { div.appendChild(span('hl-heading', line)); return; }
    if (COMMENT_RE.test(line)) { div.appendChild(span('hl-comment', line)); return; }

    // Table row: draw the "|" separators discreetly.
    if (line.indexOf('|') !== -1) {
      const parts = line.split('|');
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) div.appendChild(span('hl-pipe', '|'));
        div.appendChild(textNode(parts[i]));
      }
      return;
    }

    // Split off a trailing "// comment" and colour the code part.
    let code = line;
    let comment = '';
    const cm = line.match(INLINE_COMMENT_RE);
    if (cm) {
      const cut = cm.index + cm[1].length;
      code = line.slice(0, cut);
      comment = line.slice(cut);
    }
    colouriseCode(div, code);
    if (comment) div.appendChild(span('hl-comment', comment));
  }

  function animate(el, keyframes, duration) {
    if (typeof el.animate !== 'function') return;
    el.animate(keyframes, { duration: duration, easing: 'cubic-bezier(.2,.7,.3,1)' });
  }

  const KIND_TAG = { func: 'ƒ', var: 'var', unit: 'unité', const: 'const', keyword: 'mot' };
  const WORD_CHAR = /[\p{L}\p{N}_]/u;
  const WORD_START = /[\p{L}_]/u;

  function createEditor(opts) {
    const input = opts.input;         // <textarea>
    const highlight = opts.highlight; // colour + measuring layer
    const onChange = opts.onChange || function () {};
    const staticNames = opts.completions || []; // [{ name, kind }]

    const results = document.createElement('div');
    results.className = 'editor__results-layer';
    highlight.parentNode.appendChild(results);

    const pool = {}; // line index -> { el, text }

    /* ---- Autocomplete ------------------------------------------------ *
     * A menu of variable / function / unit names, filtered by the word the
     * caret is on. Anchored to <body> with fixed positioning so the editor's
     * own overflow:hidden can't clip it. Accept with Tab/Enter, move with the
     * arrows, dismiss with Escape.
     * ------------------------------------------------------------------ */
    let docNames = [];   // names defined in the current document
    let acItems = [];
    let acIndex = 0;
    let acWord = null;   // { start, end } of the word being completed
    let acOpen = false;

    const acEl = document.createElement('div');
    acEl.className = 'ac-menu';
    acEl.hidden = true;
    document.body.appendChild(acEl);

    // A hidden mirror of the textarea used to locate the caret in pixels.
    const mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    document.body.appendChild(mirror);

    function caretCoords() {
      const cs = getComputedStyle(input);
      for (const prop of COPIED_STYLES) mirror.style[prop] = cs[prop];
      mirror.style.position = 'fixed';
      mirror.style.left = '-9999px';
      mirror.style.top = '0';
      mirror.style.visibility = 'hidden';
      mirror.style.whiteSpace = 'pre-wrap';
      mirror.style.overflowWrap = 'break-word';
      mirror.style.wordBreak = 'break-word';
      mirror.style.boxSizing = 'border-box';
      mirror.style.width = input.clientWidth + 'px';
      mirror.textContent = input.value.slice(0, input.selectionStart);
      const marker = document.createElement('span');
      marker.textContent = '​';
      mirror.appendChild(marker);
      const mRect = mirror.getBoundingClientRect();
      const kRect = marker.getBoundingClientRect();
      const rect = input.getBoundingClientRect();
      return {
        left: rect.left + (kRect.left - mRect.left) - input.scrollLeft,
        top: rect.top + (kRect.top - mRect.top) - input.scrollTop,
        lineHeight: kRect.height || parseFloat(cs.lineHeight) || 20,
      };
    }

    function currentWord() {
      const pos = input.selectionStart;
      if (pos !== input.selectionEnd) return null; // a selection, not a caret
      const text = input.value;
      let s = pos;
      while (s > 0 && WORD_CHAR.test(text[s - 1])) s--;
      const word = text.slice(s, pos);
      if (word.length < 2 || !WORD_START.test(word[0])) return null;
      return { start: s, end: pos, text: word };
    }

    function allNames() {
      const seen = {};
      const out = [];
      for (const it of docNames) if (!seen[it.name]) { seen[it.name] = 1; out.push(it); }
      for (const it of staticNames) if (!seen[it.name]) { seen[it.name] = 1; out.push(it); }
      return out;
    }

    function filterMatches(prefix) {
      const p = prefix.toLowerCase();
      const res = [];
      for (const it of allNames()) {
        const nl = it.name.toLowerCase();
        if (nl === p) continue;            // already fully typed
        if (nl.indexOf(p) === 0) res.push(it);
        if (res.length >= 8) break;
      }
      return res;
    }

    function closeAc() {
      if (!acOpen) return;
      acOpen = false;
      acItems = [];
      acWord = null;
      acEl.hidden = true;
    }

    function renderAc() {
      acEl.textContent = '';
      acItems.forEach(function (it, i) {
        const row = document.createElement('div');
        row.className = 'ac-item' + (i === acIndex ? ' is-sel' : '');
        row.dataset.i = i;
        const nm = span('ac-name', it.name);
        const kd = span('ac-kind', KIND_TAG[it.kind] || '');
        row.appendChild(nm);
        row.appendChild(kd);
        acEl.appendChild(row);
      });
      const c = caretCoords();
      acEl.style.left = Math.round(c.left) + 'px';
      acEl.style.top = Math.round(c.top + c.lineHeight + 2) + 'px';
      acEl.hidden = false;
    }

    function refreshAc() {
      const w = currentWord();
      if (!w) { closeAc(); return; }
      const matches = filterMatches(w.text);
      if (!matches.length) { closeAc(); return; }
      acItems = matches;
      acIndex = 0;
      acWord = w;
      acOpen = true;
      renderAc();
    }

    function acceptAc(i) {
      const it = acItems[i];
      if (!it || !acWord) return;
      const isFunc = it.kind === 'func';
      const insert = isFunc ? it.name + '()' : it.name;
      input.focus();
      input.setSelectionRange(acWord.start, acWord.end);
      let ok = false;
      try { ok = document.execCommand && document.execCommand('insertText', false, insert); }
      catch (e) { ok = false; }
      if (!ok) {
        const caret = acWord.start + insert.length;
        input.value = input.value.slice(0, acWord.start) + insert + input.value.slice(acWord.end);
        input.setSelectionRange(caret, caret);
      }
      if (isFunc) { const p = input.selectionStart - 1; input.setSelectionRange(p, p); }
      closeAc();
      recompute();
    }

    function copyMetrics() {
      const cs = getComputedStyle(input);
      for (const prop of COPIED_STYLES) highlight.style[prop] = cs[prop];
      highlight.style.width = input.clientWidth + 'px';
    }

    function syncScroll() {
      const y = 'translateY(' + (-input.scrollTop) + 'px)';
      highlight.style.transform = y;
      results.style.transform = y;
    }

    function recompute() {
      const text = input.value;
      const lines = text.split('\n');
      const result = TC.evaluateDocument(text);

      if (result.names) {
        docNames = (result.names.vars || []).map(function (n) { return { name: n, kind: 'var' }; })
          .concat((result.names.funcs || []).map(function (n) { return { name: n, kind: 'func' }; }));
      }

      const info = {};
      for (const rec of result.lines) {
        if (rec.error) info[rec.index] = { text: '⚠ ' + rec.error, error: true };
        else if (rec.display != null) info[rec.index] = { text: rec.display, error: false };
      }

      // Rebuild the coloured text and drop an end-of-line marker on result lines.
      highlight.textContent = '';
      const frag = document.createDocumentFragment();
      const markers = {};
      for (let i = 0; i < lines.length; i++) {
        const div = document.createElement('div');
        div.className = 'hl-line';
        colourise(div, lines[i]);
        if (info[i]) {
          const marker = span('hl-end', '​');
          div.appendChild(marker);
          markers[i] = marker;
        }
        frag.appendChild(div);
      }
      highlight.appendChild(frag);

      // Reconcile the persistent result elements against the fresh markers.
      const seen = {};
      for (const key in info) {
        const i = +key;
        const inf = info[i];
        const marker = markers[i];
        seen[i] = true;

        let entry = pool[i];
        let isNew = false;
        if (!entry) {
          const el = document.createElement('span');
          el.className = 'calc-result';
          const pill = span('calc-result__pill', '');
          el.appendChild(pill);
          results.appendChild(el);
          entry = pool[i] = { el: el, pill: pill, text: null };
          isNew = true;
        }
        // Horizontal: end of the text (the marker). Vertical: the top of the
        // block line — an inline marker's offsetTop sits half a leading too low.
        entry.el.style.left = marker.offsetLeft + 'px';
        entry.el.style.top = marker.parentNode.offsetTop + 'px';
        entry.el.classList.toggle('calc-result--error', !!inf.error);

        if (isNew) {
          entry.pill.textContent = inf.text;
          entry.text = inf.text;
          animate(entry.el, ENTER_KEYFRAMES, 200);
        } else if (entry.text !== inf.text) {
          entry.pill.textContent = inf.text;
          entry.text = inf.text;
          animate(entry.el, UPDATE_KEYFRAMES, 170);
        }
      }

      // Remove results for lines that no longer ask for one.
      for (const key in pool) {
        if (!seen[key]) {
          pool[key].el.remove();
          delete pool[key];
        }
      }

      syncScroll();
      onChange(text, result);
    }

    input.addEventListener('input', recompute);
    input.addEventListener('input', refreshAc);
    input.addEventListener('scroll', function () { syncScroll(); closeAc(); });
    window.addEventListener('resize', function () { copyMetrics(); recompute(); closeAc(); });

    // Autocomplete keyboard: navigation and acceptance take over only while the
    // menu is open, so ordinary typing (and Ctrl/Cmd+Enter) is untouched.
    input.addEventListener('keydown', function (e) {
      if (!acOpen) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); acIndex = (acIndex + 1) % acItems.length; renderAc(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); acIndex = (acIndex - 1 + acItems.length) % acItems.length; renderAc(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); acceptAc(acIndex); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAc(); }
    });
    // Click a suggestion. mousedown + preventDefault keeps the textarea focused.
    acEl.addEventListener('mousedown', function (e) {
      const row = e.target.closest('.ac-item');
      if (!row) return;
      e.preventDefault();
      acceptAc(+row.dataset.i);
    });
    input.addEventListener('blur', function () { setTimeout(closeAc, 120); });

    copyMetrics();

    return {
      recompute: recompute,
      focus: function () { input.focus(); },
      getValue: function () { return input.value; },
      setValue: function (v) {
        // Clear result elements so the new note animates in fresh.
        for (const key in pool) { pool[key].el.remove(); delete pool[key]; }
        closeAc();
        input.value = v == null ? '' : v;
        input.scrollTop = 0;
        recompute();
      },
      // Insert text at the caret (used by the function palette). The caret is
      // left `caretOffsetFromEnd` characters before the end of the inserted
      // text — e.g. 1 to land it between a freshly inserted "()". Uses
      // execCommand so the browser's native undo (Ctrl+Z) still works.
      insertAtCaret: function (text, caretOffsetFromEnd) {
        input.focus();
        let inserted = false;
        try { inserted = document.execCommand && document.execCommand('insertText', false, text); }
        catch (e) { inserted = false; }
        if (!inserted) {
          const start = input.selectionStart;
          const end = input.selectionEnd;
          input.value = input.value.slice(0, start) + text + input.value.slice(end);
          input.setSelectionRange(start + text.length, start + text.length);
        }
        if (caretOffsetFromEnd) {
          const pos = input.selectionStart - caretOffsetFromEnd;
          input.setSelectionRange(pos, pos);
        }
        recompute();
      },
    };
  }

  return { createEditor: createEditor };
});
