/*
 * app.js — wires the editor to the page and persists the note locally.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'text-calculator:note';

  const DEFAULT_NOTE = [
    '# Bienvenue 👋',
    "Ceci est un bloc-notes qui calcule pendant que vous écrivez.",
    '',
    'Une variable peut être utilisée avant même sa définition :',
    'vitesse = distance / temps',
    '',
    '# Trajet',
    'distance = 100 km',
    'temps = 2 h',
    '',
    '# Courses',
    'lait = 1.15 €',
    'pain = 2.90 €',
    'oeufs = 3.20 €',
    'total = lait + pain + oeufs',
    'avec_pourboire = total * 1.05',
    '',
    'Essayez aussi : 2 h en min, 20% * 300 €, sqrt(144), 3 cafés * 4',
  ].join('\n');

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  ready(function () {
    const editor = TC.createEditor({
      input: document.getElementById('input'),
      mirror: document.getElementById('mirror'),
      results: document.getElementById('results'),
      onChange: scheduleSave,
    });

    let timer = null;
    function scheduleSave(text) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        try { localStorage.setItem(STORAGE_KEY, text); } catch (e) { /* storage full / disabled */ }
      }, 250);
    }

    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    editor.setValue(saved != null ? saved : DEFAULT_NOTE);
    editor.focus();
  });
})();
