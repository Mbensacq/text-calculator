/*
 * editor.js — the writing surface.
 *
 * A plain <textarea> holds the text so typing, selection and undo all behave
 * natively. A highlight layer sits behind it, sharing its exact metrics, and
 * renders each line with light syntax colouring (headings, comments, variable
 * names). The textarea's own text is drawn transparent, so what the eye reads
 * is this coloured layer.
 *
 * Results are shown Apple-Notes style: only lines ending in "=" produce one,
 * and it is placed inline right after that sign. We find the exact spot with a
 * zero-width marker appended to the line, then position the result there
 * absolutely so it never affects wrapping or line heights.
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

  function createEditor(opts) {
    const input = opts.input;         // <textarea>
    const highlight = opts.highlight; // visible colour + measuring layer
    const onChange = opts.onChange || function () {};

    function copyMetrics() {
      const cs = getComputedStyle(input);
      for (const prop of COPIED_STYLES) highlight.style[prop] = cs[prop];
      highlight.style.width = input.clientWidth + 'px';
    }

    function syncScroll() {
      highlight.style.transform = 'translateY(' + (-input.scrollTop) + 'px)';
    }

    function recompute() {
      const text = input.value;
      const lines = text.split('\n');
      const result = TC.evaluateDocument(text);

      const info = {};
      for (const rec of result.lines) {
        if (rec.error) info[rec.index] = { text: rec.error, error: true };
        else if (rec.display != null) info[rec.index] = { text: rec.display, error: false };
      }

      highlight.textContent = '';
      const frag = document.createDocumentFragment();
      const pending = [];
      for (let i = 0; i < lines.length; i++) {
        const div = document.createElement('div');
        div.className = 'hl-line';
        colourise(div, lines[i]);
        if (info[i]) {
          const marker = span('hl-end', '​'); // zero-width, marks end of line
          div.appendChild(marker);
          pending.push({ marker: marker, inf: info[i] });
        }
        frag.appendChild(div);
      }
      highlight.appendChild(frag);

      // Place each result right after its "=", using the marker's position.
      for (const p of pending) {
        const el = document.createElement('span');
        el.className = 'calc-result' + (p.inf.error ? ' calc-result--error' : '');
        el.textContent = (p.inf.error ? ' ⚠ ' : ' ') + p.inf.text;
        el.style.left = p.marker.offsetLeft + 'px';
        el.style.top = p.marker.offsetTop + 'px';
        highlight.appendChild(el);
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
