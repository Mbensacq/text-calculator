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

  function colourise(div, line) {
    if (!line.trim()) { div.textContent = '​'; return; }
    if (HEADING_RE.test(line)) { div.appendChild(span('hl-heading', line)); return; }
    if (COMMENT_RE.test(line)) { div.appendChild(span('hl-comment', line)); return; }
    const m = line.match(ASSIGN_RE);
    if (m) {
      div.appendChild(textNode(m[1]));
      div.appendChild(span('hl-var', m[2]));
      div.appendChild(textNode(m[3] + m[4]));
      return;
    }
    div.textContent = line;
  }

  function animate(el, keyframes, duration) {
    if (typeof el.animate !== 'function') return;
    el.animate(keyframes, { duration: duration, easing: 'cubic-bezier(.2,.7,.3,1)' });
  }

  function createEditor(opts) {
    const input = opts.input;         // <textarea>
    const highlight = opts.highlight; // colour + measuring layer
    const onChange = opts.onChange || function () {};

    const results = document.createElement('div');
    results.className = 'editor__results-layer';
    highlight.parentNode.appendChild(results);

    const pool = {}; // line index -> { el, text }

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
    input.addEventListener('scroll', syncScroll);
    window.addEventListener('resize', function () { copyMetrics(); recompute(); });

    copyMetrics();

    return {
      recompute: recompute,
      focus: function () { input.focus(); },
      getValue: function () { return input.value; },
      setValue: function (v) {
        // Clear result elements so the new note animates in fresh.
        for (const key in pool) { pool[key].el.remove(); delete pool[key]; }
        input.value = v == null ? '' : v;
        input.scrollTop = 0;
        recompute();
      },
      // Insert text at the caret (used by the function palette). The caret is
      // left `caretOffsetFromEnd` characters before the end of the inserted
      // text — e.g. 1 to land it between a freshly inserted "()".
      insertAtCaret: function (text, caretOffsetFromEnd) {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.value = input.value.slice(0, start) + text + input.value.slice(end);
        const pos = start + text.length - (caretOffsetFromEnd || 0);
        input.setSelectionRange(pos, pos);
        input.focus();
        recompute();
      },
    };
  }

  return { createEditor: createEditor };
});
