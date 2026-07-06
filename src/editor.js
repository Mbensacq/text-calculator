/*
 * editor.js — the writing surface.
 *
 * A plain <textarea> holds the text (so typing, selection and undo all behave
 * natively). Results are drawn in a right-hand gutter, each one aligned to the
 * line it belongs to. Alignment is done with a hidden "mirror" element that
 * copies the textarea's exact metrics: every source line becomes a block whose
 * offsetTop tells us where that line sits, wrapping included.
 */
(function (root, factory) {
  const mod = factory(root.TC);
  root.TC = root.TC || {};
  root.TC.createEditor = mod.createEditor;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (TC) {
  'use strict';

  // Textarea metrics we must replicate on the mirror for identical wrapping.
  const COPIED_STYLES = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'textIndent',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing', 'tabSize',
  ];

  function createEditor(opts) {
    const input = opts.input;     // <textarea>
    const mirror = opts.mirror;   // hidden measuring div
    const results = opts.results; // gutter container (holds .editor__results-inner)
    const onChange = opts.onChange || function () {};

    const inner = document.createElement('div');
    inner.className = 'editor__results-inner';
    results.appendChild(inner);

    function copyMetrics() {
      const cs = getComputedStyle(input);
      for (const prop of COPIED_STYLES) mirror.style[prop] = cs[prop];
      mirror.style.width = input.clientWidth + 'px';
      mirror.style.whiteSpace = 'pre-wrap';
      mirror.style.overflowWrap = 'break-word';
      mirror.style.wordBreak = 'break-word';
    }

    // Rebuild the mirror and return the vertical offset of each source line.
    function measureLineTops(linesText) {
      mirror.textContent = '';
      const frag = document.createDocumentFragment();
      const nodes = [];
      for (let i = 0; i < linesText.length; i++) {
        const div = document.createElement('div');
        div.className = 'mirror-line';
        // A zero-width space keeps empty lines one row tall.
        div.textContent = linesText[i].length ? linesText[i] : '​';
        frag.appendChild(div);
        nodes.push(div);
      }
      mirror.appendChild(frag);
      return nodes.map((n) => n.offsetTop);
    }

    function syncScroll() {
      inner.style.transform = 'translateY(' + -input.scrollTop + 'px)';
    }

    function recompute() {
      const text = input.value;
      const linesText = text.split('\n');
      const tops = measureLineTops(linesText);
      const result = TC.evaluateDocument(text);

      const frag = document.createDocumentFragment();
      for (const rec of result.lines) {
        const top = tops[rec.index];
        if (top == null) continue;
        if (rec.error) {
          frag.appendChild(makeResult(top, rec.error, true));
        } else if (rec.display != null) {
          frag.appendChild(makeResult(top, rec.display, false));
        }
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
        const glyph = document.createElement('span');
        glyph.className = 'res__glyph';
        glyph.textContent = '⚠';
        el.appendChild(glyph);
        el.appendChild(document.createTextNode(' ' + text));
      } else {
        el.textContent = text;
      }
      return el;
    }

    input.addEventListener('input', recompute);
    input.addEventListener('scroll', syncScroll);
    window.addEventListener('resize', function () {
      copyMetrics();
      recompute();
    });

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
