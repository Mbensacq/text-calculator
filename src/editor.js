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
  const NUM_RE = /\d+(?:[.,]\d+)?/g;
  const LETTER_RE = /[\p{L}_]/u;
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

  // Light classification of identifiers between numbers. Purely cosmetic and
  // strictly character-preserving: a function call ("somme("), a conversion
  // keyword ("en"/"sur"), a known unit ("km") or a constant ("pi") gets a class;
  // everything else stays plain text. Never touches numbers, so the .hl-num
  // spans that the scrub relies on are unaffected.
  const IDENT_G = /[\p{L}_][\p{L}\p{N}_]*/gu;
  const CONVERSION_WORDS = { en: 1, to: 1, vers: 1, sur: 1 };
  const CONSTS = { pi: 1, tau: 1, phi: 1, 'π': 1, 'φ': 1 };
  function classifyIdent(name, after) {
    if (/^\s*\(/.test(after)) return 'hl-func';
    const low = name.toLowerCase();
    if (CONVERSION_WORDS[low]) return 'hl-keyword';
    const U = (typeof TC !== 'undefined') ? TC.Units : null;
    if (U && U.isKnownUnit && U.isKnownUnit(name)) return 'hl-unit';
    if (CONSTS[low]) return 'hl-const';
    return null;
  }
  function appendCode(div, text, absStart) {
    IDENT_G.lastIndex = 0;
    let last = 0, m;
    while ((m = IDENT_G.exec(text))) {
      if (m.index > last) div.appendChild(textNode(text.slice(last, m.index)));
      const name = m[0];
      const cls = classifyIdent(name, text.slice(m.index + name.length));
      div.appendChild(cls ? span(cls, name) : textNode(name));
      last = m.index + name.length;
    }
    if (last < text.length) div.appendChild(textNode(text.slice(last)));
  }

  // Append text, wrapping bare numbers in <span class="hl-num"> tagged with
  // their absolute character offset in the document (so a drag can splice the
  // right slice of the textarea). A number glued to a letter — "m2", "taux2" —
  // is part of an identifier/unit and is left alone. Non-number text is routed
  // through appendCode for light identifier colouring.
  function appendNums(div, text, abs) {
    NUM_RE.lastIndex = 0;
    let last = 0;
    let m;
    while ((m = NUM_RE.exec(text))) {
      if (m.index > 0 && LETTER_RE.test(text[m.index - 1])) continue;
      if (m.index > last) appendCode(div, text.slice(last, m.index), abs + last);
      const s = span('hl-num', m[0]);
      s.dataset.abs = abs + m.index;
      div.appendChild(s);
      last = m.index + m[0].length;
    }
    if (last < text.length) appendCode(div, text.slice(last), abs + last);
  }

  function colouriseCode(div, code, abs) {
    const fm = code.match(FUNCDEF_RE);
    if (fm) {
      div.appendChild(textNode(fm[1]));
      div.appendChild(span('hl-var', fm[2]));
      appendNums(div, fm[3] + fm[4], abs + fm[1].length + fm[2].length);
      return;
    }
    const m = code.match(ASSIGN_RE);
    if (m) {
      div.appendChild(textNode(m[1]));
      div.appendChild(span('hl-var', m[2]));
      appendNums(div, m[3] + m[4], abs + m[1].length + m[2].length);
      return;
    }
    appendNums(div, code, abs);
  }

  function colourise(div, line, abs) {
    if (!line.trim()) { div.textContent = '​'; return; }
    if (HEADING_RE.test(line)) { div.appendChild(span('hl-heading', line)); return; }
    if (COMMENT_RE.test(line)) { div.appendChild(span('hl-comment', line)); return; }

    // Table row: draw the "|" separators discreetly, numbers stay scrubbable.
    if (line.indexOf('|') !== -1) {
      const parts = line.split('|');
      let col = 0;
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) { div.appendChild(span('hl-pipe', '|')); col += 1; }
        appendNums(div, parts[i], abs + col);
        col += parts[i].length;
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
    colouriseCode(div, code, abs);
    if (comment) div.appendChild(span('hl-comment', comment));
  }

  function animate(el, keyframes, duration) {
    if (typeof el.animate !== 'function') return;
    el.animate(keyframes, { duration: duration, easing: 'cubic-bezier(.2,.7,.3,1)' });
  }

  const KIND_TAG = { func: 'ƒ', var: 'var', unit: 'unité', const: 'const', keyword: 'mot', table: 'tableau', cell: 'cellule' };
  const WORD_CHAR = /[\p{L}\p{N}_]/u;
  const WORD_START = /[\p{L}_]/u;

  function createEditor(opts) {
    const input = opts.input;         // <textarea>
    const highlight = opts.highlight; // colour + measuring layer
    const onChange = opts.onChange || function () {};
    const staticNames = opts.completions || []; // [{ name, kind }]
    // Live completion sources supplied by a note controller: table names, and
    // the filled cells of a named table (for "Nom!B1" suggestions).
    const dynamicCompletions = opts.dynamicCompletions || function () { return []; };
    const cellsForTable = opts.cellsForTable || function () { return []; };
    // Injected evaluator (default: evaluate this textarea alone). A block in a
    // multi-block note passes one that evaluates the whole note's shared scope
    // and returns just this block's lines.
    const evaluate = opts.evaluate || function (t) { return TC.evaluateDocument(t); };
    const blockMode = !!opts.block;

    const editorBox = highlight.parentNode;
    if (blockMode) editorBox.classList.add('is-block');

    const results = document.createElement('div');
    results.className = 'editor__results-layer';
    editorBox.appendChild(results);

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
      const dyn = dynamicCompletions() || [];
      for (const it of dyn) if (!seen[it.name]) { seen[it.name] = 1; out.push(it); }
      for (const it of staticNames) if (!seen[it.name]) { seen[it.name] = 1; out.push(it); }
      return out;
    }

    // "Nom!Bxx" being typed → suggest that table's cells. Returns the token span
    // and the parsed table / cell prefix, or null.
    function qualifiedContext() {
      const pos = input.selectionStart;
      if (pos !== input.selectionEnd) return null;
      const text = input.value;
      let s = pos;
      while (s > 0 && /[A-Za-z0-9!]/.test(text[s - 1])) s--;
      const m = /^([A-Za-z][A-Za-z0-9]*)!([A-Za-z]*\d*)$/.exec(text.slice(s, pos));
      if (!m) return null;
      return { start: s, end: pos, table: m[1], cellPrefix: m[2] };
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
      // Qualified cell "Nom!B1" takes priority — its trigger is the "!".
      const qc = qualifiedContext();
      if (qc) {
        const pfx = qc.cellPrefix.toLowerCase();
        const cells = (cellsForTable(qc.table) || [])
          .filter(function (c) { return c.toLowerCase().indexOf(pfx) === 0; })
          .slice(0, 8);
        if (!cells.length) { closeAc(); return; }
        acItems = cells.map(function (c) { return { name: qc.table + '!' + c, kind: 'cell', insert: qc.table + '!' + c }; });
        acIndex = 0;
        acWord = { start: qc.start, end: qc.end };
        acOpen = true;
        renderAc();
        return;
      }
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
      const insert = it.insert != null ? it.insert : (isFunc ? it.name + '()' : it.name);
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
      recompute(true);
    }

    function copyMetrics() {
      const cs = getComputedStyle(input);
      for (const prop of COPIED_STYLES) highlight.style[prop] = cs[prop];
      // In block mode the highlight is in normal flow and defines the block's
      // height, so let it size to the container rather than pinning a width.
      highlight.style.width = blockMode ? 'auto' : input.clientWidth + 'px';
    }

    function syncScroll() {
      const y = 'translateY(' + (-input.scrollTop) + 'px)';
      highlight.style.transform = y;
      results.style.transform = y;
    }

    function recompute(fireChange) {
      const text = input.value;
      const lines = text.split('\n');
      const result = evaluate(text);

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
      let abs = 0;
      for (let i = 0; i < lines.length; i++) {
        const div = document.createElement('div');
        div.className = 'hl-line';
        colourise(div, lines[i], abs);
        abs += lines[i].length + 1; // + newline
        if (info[i]) {
          const marker = span('hl-end', '​');
          div.appendChild(marker);
          markers[i] = marker;
        }
        frag.appendChild(div);
      }
      highlight.appendChild(frag);

      // Measure every marker in one read pass. getBoundingClientRect is
      // wrap-aware — it reports the marker's *actual* visual row — so a result
      // on a line that wraps lands after the trailing "=", not stranded on the
      // first row (the previous parent.offsetTop approach broke on wrap). We
      // anchor by the marker's vertical centre to sidestep inline half-leading,
      // then centre the (line-tall) chip on it. Reads are batched before writes
      // to avoid layout thrash.
      const hlRect = highlight.getBoundingClientRect();
      const lineH = parseFloat(getComputedStyle(input).lineHeight) || 27;
      const posById = {};
      for (const key in info) {
        const m = markers[key];
        if (!m) continue;
        const r = m.getBoundingClientRect();
        posById[key] = {
          left: r.left - hlRect.left,
          top: r.top + r.height / 2 - hlRect.top - lineH / 2,
        };
      }

      // Reconcile the persistent result elements against the fresh markers.
      const seen = {};
      for (const key in info) {
        const i = +key;
        const inf = info[i];
        const p = posById[key];
        if (!p) continue;
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
        entry.el.style.left = p.left + 'px';
        entry.el.style.top = p.top + 'px';
        entry.el.style.height = lineH + 'px';
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
      if (fireChange !== false) onChange(text, result);
    }

    input.addEventListener('input', function () { recompute(true); });
    input.addEventListener('input', refreshAc);
    input.addEventListener('scroll', function () { syncScroll(); closeAc(); });
    window.addEventListener('resize', function () { copyMetrics(); recompute(false); closeAc(); });

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

    /* ---- Drag a number to adjust it --------------------------------- *
     * Numbers are wrapped in .hl-num spans carrying their absolute offset, so
     * we hit-test the pointer against those spans and splice a new value into
     * the textarea as it moves. Two ways in, both leaving ordinary editing
     * untouched:
     *   • desktop — Alt/Option + drag (immediate);
     *   • touch   — long-press a number, then drag (so a plain swipe still
     *     scrolls the note and a tap still places the caret).
     * ------------------------------------------------------------------ */
    const LONG_PRESS_MS = 400;
    const MOVE_CANCEL = 10;
    let scrub = null;
    let touchArm = null;

    function parseNumText(t) {
      const sep = t.indexOf(',') >= 0 ? ',' : '.';
      const frac = t.split(/[.,]/)[1] || '';
      return { value: parseFloat(t.replace(',', '.')), decimals: frac.length, sep: sep };
    }

    function numberSpanAt(x, y) {
      const spans = highlight.getElementsByClassName('hl-num');
      for (let i = 0; i < spans.length; i++) {
        const r = spans[i].getBoundingClientRect();
        if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) return spans[i];
      }
      return null;
    }

    function beginScrub(sp, info, startX, isTouch, pointerId) {
      closeAc();
      scrub = { abs: +sp.dataset.abs, len: sp.textContent.length, startX: startX,
        orig: info.value, decimals: info.decimals, sep: info.sep, touch: isTouch };
      try { input.setPointerCapture(pointerId); } catch (err) { /* ignore */ }
      editorBox.classList.add('scrubbing');
      if (isTouch) editorBox.classList.add('scrubbing-touch');
    }

    function applyScrub(clientX, bigStep) {
      const step = Math.pow(10, -scrub.decimals) * (bigStep ? 10 : 1);
      const px = scrub.touch ? 8 : 5; // a touch drag travels a little farther
      const val = scrub.orig + Math.round((clientX - scrub.startX) / px) * step;
      let str = val.toFixed(scrub.decimals);
      if (scrub.sep === ',') str = str.replace('.', ',');
      input.value = input.value.slice(0, scrub.abs) + str + input.value.slice(scrub.abs + scrub.len);
      scrub.len = str.length;
      const caret = scrub.abs + str.length;
      try { input.setSelectionRange(caret, caret); } catch (err) { /* ignore */ }
      recompute(true);
    }

    function cancelArm() { if (touchArm) { clearTimeout(touchArm.timer); touchArm = null; } }

    input.addEventListener('pointerdown', function (e) {
      if (scrub) return;
      const sp = numberSpanAt(e.clientX, e.clientY);
      if (!sp) return;
      const info = parseNumText(sp.textContent);
      if (!isFinite(info.value)) return;

      if (e.pointerType === 'mouse') {
        if (!e.altKey) return;
        e.preventDefault();
        beginScrub(sp, info, e.clientX, false, e.pointerId);
      } else {
        // Touch / pen: arm a long-press. Moving before it fires means the user
        // is scrolling, so the timer is cancelled and the swipe scrolls as usual.
        const pid = e.pointerId, sx = e.clientX, sy = e.clientY;
        cancelArm();
        touchArm = { pid: pid, sx: sx, sy: sy, timer: setTimeout(function () {
          touchArm = null;
          beginScrub(sp, info, sx, true, pid);
          if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) { /* ignore */ } }
        }, LONG_PRESS_MS) };
      }
    });

    input.addEventListener('pointermove', function (e) {
      if (touchArm && e.pointerId === touchArm.pid) {
        if (Math.abs(e.clientX - touchArm.sx) > MOVE_CANCEL ||
            Math.abs(e.clientY - touchArm.sy) > MOVE_CANCEL) cancelArm();
        return;
      }
      if (!scrub) return;
      e.preventDefault();
      applyScrub(e.clientX, e.shiftKey);
    });

    // While a touch scrub is active, stop the page/textarea from scrolling.
    input.addEventListener('touchmove', function (e) {
      if (scrub && scrub.touch) e.preventDefault();
    }, { passive: false });

    function endScrub(e) {
      cancelArm();
      if (!scrub) return;
      try { input.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      scrub = null;
      editorBox.classList.remove('scrubbing');
      editorBox.classList.remove('scrubbing-touch');
    }
    input.addEventListener('pointerup', endScrub);
    input.addEventListener('pointercancel', endScrub);

    // Underline numbers and switch the cursor while Alt is held, to hint that
    // they can be dragged (desktop).
    function altHint(on) { editorBox.classList.toggle('scrub-ready', on); }
    function onAltDown(e) { if (e.key === 'Alt') altHint(true); }
    function onAltUp(e) { if (e.key === 'Alt') altHint(false); }
    function onWinBlur() { altHint(false); }
    document.addEventListener('keydown', onAltDown);
    document.addEventListener('keyup', onAltUp);
    window.addEventListener('blur', onWinBlur);

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
        recompute(false);
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
        recompute(true);
      },
      // Detach body-level nodes/listeners when a block is removed.
      destroy: function () {
        try { acEl.remove(); } catch (e) { /* ignore */ }
        try { mirror.remove(); } catch (e) { /* ignore */ }
        document.removeEventListener('keydown', onAltDown);
        document.removeEventListener('keyup', onAltUp);
        window.removeEventListener('blur', onWinBlur);
      },
    };
  }

  return { createEditor: createEditor };
});
