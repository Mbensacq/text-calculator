/*
 * editor.js — the writing surface.
 *
 * A plain <textarea> holds the text so typing, selection and undo all behave
 * natively. Two extra layers sit behind it, sharing its exact metrics:
 *
 *   • a highlight layer that re-renders each line with light syntax colouring
 *     (headings, comments, variable names). The textarea's own text is drawn
 *     transparent, so what the eye reads is this coloured layer underneath.
 *   • the same layer doubles as a measuring "mirror": each source line is a
 *     block whose offsetTop tells us where to place its result in the gutter,
 *     wrapping included.
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

  // Fill a line element with lightly-coloured pieces.
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
    const results = opts.results;     // gutter container
    const onChange = opts.onChange || function () {};

    const inner = document.createElement('div');
    inner.className = 'editor__results-inner';
    results.appendChild(inner);

    function copyMetrics() {
      const cs = getComputedStyle(input);
      for (const prop of COPIED_STYLES) highlight.style[prop] = cs[prop];
      highlight.style.width = input.clientWidth + 'px';
    }

    // Rebuild the highlight layer and return the vertical offset of each line.
    function renderLines(linesText) {
      highlight.textContent = '';
      const frag = document.createDocumentFragment();
      const nodes = [];
      for (let i = 0; i < linesText.length; i++) {
        const div = document.createElement('div');
        div.className = 'hl-line';
        colourise(div, linesText[i]);
        frag.appendChild(div);
        nodes.push(div);
      }
      highlight.appendChild(frag);
      return nodes.map((n) => n.offsetTop);
    }

    function syncScroll() {
      const y = -input.scrollTop;
      highlight.style.transform = 'translateY(' + y + 'px)';
      inner.style.transform = 'translateY(' + y + 'px)';
    }

    function recompute() {
      const text = input.value;
      const tops = renderLines(text.split('\n'));
      const result = TC.evaluateDocument(text);

      const frag = document.createDocumentFragment();
      for (const rec of result.lines) {
        const top = tops[rec.index];
        if (top == null) continue;
        if (rec.error) frag.appendChild(makeResult(top, rec.error, true));
        else if (rec.display != null) frag.appendChild(makeResult(top, rec.display, false));
      }
      inner.textContent = '';
      inner.appendChild(frag);
      syncScroll();
      onChange(text, result);
    }

    function makeResult(top, text, isError) {
      const el = document.createElement('div');
      el.className = 'res' + (isError ? ' res--error' : '');
      el.style.top = top + 'px';
      el.title = text;
      if (isError) {
        el.appendChild(span('res__glyph', '⚠'));
        el.appendChild(textNode(' ' + text));
      } else {
        el.textContent = text;
      }
      return el;
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
    };
  }

  return { createEditor: createEditor };
});
