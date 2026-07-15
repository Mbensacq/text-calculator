/*
 * settings.js — user preferences (theme, fonts, number format, rates).
 *
 * A tiny persisted key/value store. It knows nothing about the DOM or the
 * engine; app.js reads it and applies each setting (CSS attributes, formatter
 * options, exchange rates).
 */
(function (root, factory) {
  const mod = factory();
  root.TC = root.TC || {};
  root.TC.createSettings = mod.createSettings;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = {
    theme: 'auto',          // auto | light | dark
    accent: 'teal',         // teal | blue | violet | rose | orange
    font: 'sans',           // sans | mono
    results: 'right',       // right | dim | hidden
    decimalSep: '.',        // '.' | ','
    maxDecimals: 6,
    defaultCurrency: 'EUR',
    rates: {},              // { EUR: 1, USD: 0.92, … } (value in a common reference)
  };

  function createSettings(opts) {
    const key = (opts && opts.key) || 'tc-settings';

    function load() {
      try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(key)) || {}); }
      catch (e) { return Object.assign({}, DEFAULTS); }
    }
    let data = load();
    function save() { try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { /* full/disabled */ } }

    function get() { return Object.assign({}, data); }
    function set(patch) { Object.assign(data, patch || {}); save(); return get(); }
    function reset() { data = Object.assign({}, DEFAULTS); save(); return get(); }

    return { get: get, set: set, reset: reset };
  }

  return { createSettings: createSettings, DEFAULTS: DEFAULTS };
});
