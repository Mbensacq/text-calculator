/*
 * tokenizer.js — turns a single line of text into a flat list of tokens.
 *
 * Token types:
 *   number   — 12, 3.14, .5, 1e3, 1 000 (thin/regular spaces inside digits)
 *   ident    — a variable name, a unit, a function or a free-form label
 *   op       — + - * / % ^
 *   lparen / rparen / comma
 *   equals   — = (top-level assignment)
 *   percent  — %  (postfix "of a hundred")
 *   keyword  — a conversion keyword (en / to / →)
 *
 * The tokenizer is deliberately permissive: it never throws. Anything it does
 * not understand becomes a `text` token that higher layers can ignore, which
 * is what lets prose and calculations live in the same document.
 */
(function (root, factory) {
  const mod = factory();
  root.TC = root.TC || {};
  root.TC.tokenize = mod.tokenize;
  root.TC.Tokenizer = mod;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONVERSION_KEYWORDS = { en: true, to: true, vers: true };

  // Identifier: a Unicode letter (or _, currency sign) followed by letters,
  // digits, underscores. Accents and non-latin scripts are welcome.
  const IDENT_START = /[\p{L}_]/u;
  const IDENT_PART = /[\p{L}\p{N}_]/u;

  // Single-character units / symbols that are their own token.
  const SYMBOL_UNITS = { '€': true, '$': true, '£': true, '¥': true, '°': true, '²': true, '³': true };

  function isDigit(ch) { return ch >= '0' && ch <= '9'; }

  function tokenize(input) {
    const tokens = [];
    let i = 0;
    const n = input.length;

    function push(type, value, start) {
      tokens.push({ type, value, start, end: i });
    }

    while (i < n) {
      const ch = input[i];

      // Whitespace (regular space, thin space, non-breaking space, tab)
      if (ch === ' ' || ch === '\t' || ch === ' ' || ch === ' ' || ch === ' ') {
        i++;
        continue;
      }

      // Ellipsis "…" / "..." — used inside ranges: sum(1, 2, ..., 8)
      if (ch === '…') { const s = i; i++; push('ellipsis', '…', s); continue; }
      if (ch === '.' && input[i + 1] === '.' && input[i + 2] === '.') {
        const s = i; i += 3; push('ellipsis', '...', s); continue;
      }

      // Numbers, including grouping spaces between digits (1 000 000) and a
      // decimal separator that may be '.' or ','.
      if (isDigit(ch) || ((ch === '.' || ch === ',') && isDigit(input[i + 1]))) {
        const start = i;
        let raw = '';
        // integer part with optional grouping spaces
        while (i < n) {
          const c = input[i];
          if (isDigit(c)) { raw += c; i++; continue; }
          // allow a single grouping space only when flanked by digits
          if ((c === ' ' || c === ' ' || c === ' ' || c === ' ') && isDigit(input[i + 1]) && raw.length) {
            i++; continue;
          }
          break;
        }
        // decimal part
        if ((input[i] === '.' || input[i] === ',') && isDigit(input[i + 1])) {
          raw += '.';
          i++;
          while (i < n && isDigit(input[i])) { raw += input[i]; i++; }
        }
        // scientific exponent (contiguous, e.g. 1e3 / 2.5E-4)
        if ((input[i] === 'e' || input[i] === 'E') &&
            (isDigit(input[i + 1]) || ((input[i + 1] === '+' || input[i + 1] === '-') && isDigit(input[i + 2])))) {
          raw += 'e';
          i++;
          if (input[i] === '+' || input[i] === '-') { raw += input[i]; i++; }
          while (i < n && isDigit(input[i])) { raw += input[i]; i++; }
        }
        push('number', parseFloat(raw), start);
        continue;
      }

      // Identifiers (variables / units / functions / labels)
      if (IDENT_START.test(ch)) {
        const start = i;
        let name = '';
        while (i < n && IDENT_PART.test(input[i])) { name += input[i]; i++; }
        if (CONVERSION_KEYWORDS[name.toLowerCase()]) push('keyword', name.toLowerCase(), start);
        else push('ident', name, start);
        continue;
      }

      // Single-character symbol units (currency, degree, superscripts)
      if (SYMBOL_UNITS[ch]) {
        const start = i;
        i++;
        if (ch === '²') push('pow2', ch, start);
        else if (ch === '³') push('pow3', ch, start);
        else push('ident', ch, start);
        continue;
      }

      const start = i;
      switch (ch) {
        case '+': i++; push('op', '+', start); continue;
        case '-':
        case '−': // minus sign
          i++; push('op', '-', start); continue;
        case '*':
        case '×': // ×
        case '·': // ·
          i++; push('op', '*', start); continue;
        case '/':
        case '÷': // ÷
          i++; push('op', '/', start); continue;
        case '^': i++; push('op', '^', start); continue;
        case '%': i++; push('percent', '%', start); continue;
        case '(': i++; push('lparen', '(', start); continue;
        case ')': i++; push('rparen', ')', start); continue;
        case '[': i++; push('lbracket', '[', start); continue;
        case ']': i++; push('rbracket', ']', start); continue;
        case '!': i++; push('bang', '!', start); continue;
        case ',': i++; push('comma', ',', start); continue;
        case '=': i++; push('equals', '=', start); continue;
        case '→': // →
          i++; push('keyword', 'to', start); continue;
        default:
          // Unknown character — keep as opaque text so prose survives.
          i++;
          push('text', ch, start);
          continue;
      }
    }

    push('eof', null, i);
    return tokens;
  }

  return { tokenize, CONVERSION_KEYWORDS };
});
