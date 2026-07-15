/*
 * app.js — wires the store, the sidebar and the editor together.
 */
(function () {
  'use strict';

  // A wiki-style example that showcases every feature. Used as the first-run
  // note and re-loadable at any time from the sidebar.
  const EXAMPLE_NOTE = [
    '# Bienvenue dans Text Calculator',
    '',
    'Un bloc-notes qui calcule. Terminez une ligne par « = » pour voir le résultat.',
    '(2 + 3) * 4 =',
    '',
    '## Variables',
    'Une variable peut servir avant même d’être définie.',
    'aire = largeur * hauteur =',
    'largeur = 4 m',
    'hauteur = 3 m',
    '',
    '## Fonctions',
    'carre(x) = x^2',
    'carre(9) =',
    '// récursion, avec un cas de base',
    'fact(n) = si(n <= 1, 1, n * fact(n - 1))',
    'fact(6) =',
    '',
    '## Listes, plages, indices',
    'notes = 12, 15, 9, 17',
    'moy(notes) =',
    'notes[0] =           // premier élément (base 0)',
    'Σ(i, 1, 10, i) =     // somme indexée',
    '',
    '## Logique',
    'si(15 >= 10, 1, 0) =',
    '',
    '## Unités & conversions',
    '120 km / 1.5 h =',
    '2 Go en Mo =',
    '20 °C en °F =',
    '300 € + 20% =        // TVA',
    '',
    '## Tenir des comptes',
    'loyer = 800 €        // charge fixe',
    'courses = 250 €',
    'total =',
    '',
    'budget = 1500 €',
    'depenses = loyer + courses =',
    'reste = budget - depenses =',
    '',
    'Constantes : pi, e, tau, phi. Ouvrez « ? » en haut pour l’aide-mémoire.',
  ].join('\n');

  const DEFAULT_NOTE = EXAMPLE_NOTE;

  // A ready-to-use sales log for a market/expo stand: price list, one row per
  // order (amount paid + items), and a per-product summary with column sums.
  const SALES_NOTE = [
    '# Ventes — expo',
    '',
    '## Tarifs',
    'sticker = 3 €',
    'planche = 8 €',
    'badge = 2 €',
    'porte_cle = 5 €',
    'charm = 4 €',
    'print = 10 €',
    'marque_page = 3 €',
    '',
    '## Commandes',
    'Une ligne par client. La colonne « Payé » (B) se totalise plus bas.',
    '| N° | Payé | Articles                    |',
    '| 1  | 8 €  | 2 stickers + 1 badge        |',
    '| 2  | 23 € | 1 planche + 3 charms + 1 mp |',
    '| 3  | 10 € | 1 print                     |',
    'somme(B2:B4) =        // total encaissé',
    '',
    '## Vérifier une commande (avec les tarifs)',
    '2 * sticker + 1 * badge =',
    '1 * planche + 3 * charm + 1 * marque_page =',
    '',
    '## Bilan par produit',
    'La colonne Revenu (D) se calcule toute seule : =B2*C2',
    '| Produit | Qté | PU   | Revenu |',
    '| sticker | 2   | 3 €  | =B2*C2 |',
    '| planche | 1   | 8 €  | =B3*C3 |',
    '| badge   | 1   | 2 €  | =B4*C4 |',
    '| charm   | 3   | 4 €  | =B5*C5 |',
    '| print   | 1   | 10 € | =B6*C6 |',
    '| mp      | 1   | 3 €  | =B7*C7 |',
    'revenu = somme(D2:D7) =',
    'objets = somme(B2:B7) =',
    '',
    'Astuce : élargissez un tableau en ajoutant des colonnes (| …) ou des lignes.',
  ].join('\n');

  // A ready-to-run cash-register note for a market/expo day: live daily takings,
  // number of sales, average basket, change-to-give, quick order checks and a
  // per-product revenue table (quantities are Alt-draggable).
  const CAISSE_NOTE = [
    '# Caisse',
    'aujourd\'hui =',
    '',
    '## Tarifs',
    'sticker = 3 €',
    'planche = 8 €',
    'badge = 2 €',
    'porte_cle = 5 €',
    'print = 10 €',
    '',
    '## Ventes du jour',
    '// Ajoutez le montant encaissé à chaque vente, séparé par des virgules.',
    'ventes = 8 €, 23 €, 10 €, 6 €',
    '',
    'recette = somme(ventes) =        // total encaissé',
    'nb_ventes = count(ventes) =      // nombre de ventes',
    'panier_moyen = moy(ventes) =     // panier moyen',
    '',
    '## Rendre la monnaie',
    '// rendu(montant donné, montant dû)',
    'rendu(20 €, 17 €) =',
    '',
    '## Vérifier une commande',
    '2 * sticker + 1 * badge =',
    '1 * planche + 2 * print =',
    '',
    '## Revenu par produit',
    '// Astuce : Alt + glisser sur une quantité pour l’ajuster en direct.',
    '| Produit | Qté | PU   | Revenu |',
    '| sticker | 12  | 3 €  | =B2*C2 |',
    '| planche | 3   | 8 €  | =B3*C3 |',
    '| badge   | 7   | 2 €  | =B4*C4 |',
    '| print   | 2   | 10 € | =B5*C5 |',
    'revenu_total = somme(D2:D5) =',
    'objets_vendus = somme(B2:B5) =',
  ].join('\n');

  // ---- Demo sandbox ------------------------------------------------------
  // A separate, self-contained space (its own storage key, sync disabled) with
  // ready-made notes that illustrate the features — so you can explore without
  // touching your real notes. Entered with "?demo" in the URL.
  const DEMO_KEY = 'text-calculator:demo';
  function isDemo() {
    try { return new URLSearchParams(location.search).has('demo'); } catch (e) { return false; }
  }

  const DEMO_WELCOME = [
    '# 🧪 Mode démo',
    '',
    'Bac à sable : vos vraies notes ne sont pas touchées. Explorez, cassez,',
    'testez — puis « Quitter » en haut pour revenir.',
    '',
    '## À essayer',
    'Terminez une ligne par « = » pour voir le résultat.',
    '(2 + 3) * 4 =',
    '',
    '// Glissez un nombre avec Alt (ordinateur) ou appui long (mobile) :',
    'budget = 1500 €',
    'depense = 430 €',
    'reste = budget - depense =',
    '',
    '## Dates',
    'aujourd\'hui + 15 jours =',
    '25/12/2026 - aujourd\'hui =',
    '',
    'Ouvrez les autres notes de démo dans la liste ⟵',
  ].join('\n');

  function demoGrid() {
    return {
      rows: 5, cols: 4,
      cells: {
        '0,0': 'Produit', '0,1': 'Qté', '0,2': 'PU', '0,3': 'Total',
        '1,0': 'sticker', '1,1': '12', '1,2': '3 €', '1,3': '=B2*C2',
        '2,0': 'planche', '2,1': '3', '2,2': '8 €', '2,3': '=B3*C3',
        '3,0': 'badge', '3,1': '7', '3,2': '2 €', '3,3': '=B4*C4',
      },
    };
  }

  const DEMO_MIXED_INTRO = [
    '# Note mixte : texte + tableau',
    '',
    'On mélange du texte qui calcule et un vrai tableau dans une seule note.',
    '',
    'prix_sticker = 3 €',
    'remise = 10%',
    'prix_final = prix_sticker - remise =',
  ].join('\n');

  const DEMO_MIXED_OUTRO = [
    '// Le tableau ci-dessus calcule la colonne Total (=B2*C2…).',
    '// Et on réutilise les variables du bloc du haut, même APRÈS le tableau :',
    'total_boutique = 12 * prix_final =',
  ].join('\n');

  const DEMO_NOTES = [
    { blocks: [{ type: 'text', body: DEMO_WELCOME }] },
    { blocks: [
      { type: 'text', body: DEMO_MIXED_INTRO },
      { type: 'grid', grid: demoGrid() },
      { type: 'text', body: DEMO_MIXED_OUTRO },
    ] },
    { blocks: [{ type: 'text', body: EXAMPLE_NOTE }] },
    { blocks: [{ type: 'text', body: SALES_NOTE }] },
    { blocks: [{ type: 'text', body: CAISSE_NOTE }] },
  ];

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  // Register the service worker so the app installs and works offline.
  // (No-op on file:// or unsupported browsers.)
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* ignore */ });
    });
  }

  ready(function () {
    const demo = isDemo();
    const store = demo
      ? TC.createStore(null, { key: DEMO_KEY, seedNotes: DEMO_NOTES })
      : TC.createStore(DEFAULT_NOTE);

    const listEl = document.getElementById('note-list');
    const layoutEl = document.getElementById('app');

    let activeId = store.active().id;
    let listTimer = null;
    let viewingTrash = false;
    let query = '';
    let queryTerms = [];
    let selectMode = false;
    const selectedIds = new Set();
    let filterFolder = '';
    const filterTags = new Set();

    const noteView = document.getElementById('note-view');
    const sidebarTitle = document.querySelector('.sidebar__title');
    const searchInput = document.getElementById('note-search');
    const trashToggle = document.getElementById('trash-toggle');

    function bumpList() {
      if (listTimer) clearTimeout(listTimer);
      listTimer = setTimeout(renderList, 300);
    }

    // The built-in names the editor can suggest. Function/constant names are
    // read straight from the evaluator (no drift); special forms, date helpers,
    // keywords and a handful of common units are listed by hand.
    function builtinCompletions() {
      const out = [];
      const seen = {};
      const add = function (name, kind) { if (!seen[name]) { seen[name] = 1; out.push({ name: name, kind: kind }); } };
      const ev = TC.Evaluator;
      if (ev) {
        Object.keys(ev.FUNCTIONS || {}).forEach(function (n) { add(n, 'func'); });
        Object.keys(ev.VARIADIC || {}).forEach(function (n) { add(n, 'func'); });
        Object.keys(ev.CONSTANTS || {}).forEach(function (n) { add(n, 'const'); });
      }
      ['si', 'et', 'ou', 'non', 'Σ', 'sigma', 'date', 'jour', 'mois', 'annee'].forEach(function (n) { add(n, 'func'); });
      ['aujourd\'hui', 'demain', 'hier', 'en'].forEach(function (n) { add(n, 'keyword'); });
      ['km', 'cm', 'mm', 'kg', 'mg', 'min', 'jour', 'semaine', 'mois', 'an',
        'km/h', '°C', '°F', 'Go', 'Mo', 'ko'].forEach(function (n) { add(n, 'unit'); });
      return out;
    }

    // The whole note is a stack of blocks (text-that-calculates + tables). The
    // note editor owns the block array and saves it back through onChange.
    const noteEditor = TC.createNoteEditor({
      container: noteView,
      completions: builtinCompletions(),
      onChange: function (blocks) {
        store.updateBlocks(activeId, blocks);
        schedulePush(activeId);
        scheduleVersion(activeId, blocks);
        bumpList();
      },
    });

    // ---- Version history (persisted, time-spaced snapshots per note) -------
    const noteHistory = TC.createHistory
      ? TC.createHistory({ key: demo ? 'tc-history:demo' : 'tc-history' })
      : null;
    let versionTimer = null;
    function scheduleVersion(id, blocks) {
      if (!noteHistory) return;
      if (versionTimer) clearTimeout(versionTimer);
      versionTimer = setTimeout(function () { noteHistory.record(id, blocks); }, 2500);
    }
    function openHistory() {
      if (!noteHistory) return;
      const list = noteHistory.versions(activeId);
      const overlay = document.createElement('div');
      overlay.className = 'hist';
      const box = document.createElement('div');
      box.className = 'hist__box';
      const head = document.createElement('div');
      head.className = 'hist__head';
      head.appendChild(document.createTextNode('Historique de la note'));
      const close = document.createElement('button');
      close.className = 'hist__close';
      close.type = 'button';
      close.textContent = '✕';
      close.addEventListener('click', function () { overlay.remove(); });
      head.appendChild(close);
      box.appendChild(head);
      const listEl2 = document.createElement('div');
      listEl2.className = 'hist__list';
      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'hist__empty';
        empty.textContent = 'Aucune version enregistrée pour l’instant (les versions s’ajoutent au fil de l’écriture).';
        listEl2.appendChild(empty);
      }
      list.forEach(function (v) {
        const row = document.createElement('div');
        row.className = 'hist__row';
        const label = document.createElement('span');
        label.className = 'hist__when';
        label.textContent = new Date(v.t).toLocaleString('fr-FR');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hist__restore';
        btn.textContent = 'Restaurer';
        btn.addEventListener('click', function () {
          store.updateBlocks(activeId, v.blocks);
          loadActive();
          animateSwitch();
          schedulePush(activeId);
          overlay.remove();
        });
        row.appendChild(label);
        row.appendChild(btn);
        listEl2.appendChild(row);
      });
      box.appendChild(listEl2);
      overlay.appendChild(box);
      overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    }

    function loadActive() {
      const note = store.active();
      activeId = note.id;
      noteEditor.setNote(note);
      renderMeta();
      renderFilters();
      renderList();
    }

    // ---- Folders & tags: metadata bar over the note, filters in the sidebar --
    function activeItem() {
      const all = store.list().concat(store.trashList());
      for (let i = 0; i < all.length; i++) if (all[i].id === activeId) return all[i];
      return null;
    }
    function afterMetaChange() {
      renderMeta();
      renderFilters();
      renderList();
      schedulePush(activeId);
    }
    function renderMeta() {
      const meta = document.getElementById('note-meta');
      if (!meta) return;
      const item = activeItem();
      meta.textContent = '';
      const folder = (item && item.folder) || '';
      const folderBtn = document.createElement('button');
      folderBtn.type = 'button';
      folderBtn.className = 'note-meta__folder' + (folder ? ' is-set' : '');
      folderBtn.textContent = '📁 ' + (folder || 'Classeur');
      folderBtn.title = 'Ranger cette note dans un classeur';
      folderBtn.addEventListener('click', function () {
        const val = window.prompt('Classeur (laisser vide pour retirer) :', folder);
        if (val === null) return;
        store.setFolder(activeId, val);
        afterMetaChange();
      });
      meta.appendChild(folderBtn);

      const tags = (item && item.tags) || [];
      tags.forEach(function (t) {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.appendChild(document.createTextNode('#' + t));
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'tag-chip__x';
        x.textContent = '×';
        x.title = 'Retirer l’étiquette';
        x.addEventListener('click', function () {
          store.setTags(activeId, tags.filter(function (tt) { return tt !== t; }));
          afterMetaChange();
        });
        chip.appendChild(x);
        meta.appendChild(chip);
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'note-meta__add';
      add.textContent = '＋ étiquette';
      add.addEventListener('click', function () {
        const val = window.prompt('Nouvelle étiquette :', '');
        if (!val) return;
        store.setTags(activeId, tags.concat([val]));
        afterMetaChange();
      });
      meta.appendChild(add);

      if (noteHistory) {
        const hist = document.createElement('button');
        hist.type = 'button';
        hist.className = 'note-meta__hist';
        hist.textContent = '🕘 Historique';
        hist.title = 'Voir et restaurer les versions précédentes';
        hist.addEventListener('click', openHistory);
        meta.appendChild(hist);
      }
    }
    function renderFilters() {
      const box = document.getElementById('note-filters');
      if (!box) return;
      const folders = store.allFolders();
      const tags = store.allTags();
      box.textContent = '';
      if (!folders.length && !tags.length) { box.hidden = true; filterFolder = ''; filterTags.clear(); return; }
      box.hidden = false;
      folders.forEach(function (f) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'filter-chip filter-chip--folder' + (filterFolder === f ? ' is-on' : '');
        b.textContent = '📁 ' + f;
        b.addEventListener('click', function () { filterFolder = filterFolder === f ? '' : f; renderFilters(); renderList(); });
        box.appendChild(b);
      });
      tags.forEach(function (t) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'filter-chip' + (filterTags.has(t) ? ' is-on' : '');
        b.textContent = '#' + t;
        b.addEventListener('click', function () { if (filterTags.has(t)) filterTags.delete(t); else filterTags.add(t); renderFilters(); renderList(); });
        box.appendChild(b);
      });
    }
    function matchesFilters(item) {
      if (filterFolder && item.folder !== filterFolder) return false;
      if (filterTags.size) {
        for (const t of filterTags) if ((item.tags || []).indexOf(t) < 0) return false;
      }
      return true;
    }

    function focusActive() { noteEditor.focus(); }

    // A short slide-in when the visible note changes (user-initiated switches).
    function animateSwitch() {
      noteView.classList.remove('note-anim');
      void noteView.offsetWidth; // force reflow so the animation restarts
      noteView.classList.add('note-anim');
    }

    function selectNote(id) {
      store.setActive(id);
      loadActive();
      animateSwitch();
      closeSidebar();
      focusActive();
    }

    // ---- Install as an app (Add to Home Screen) ---------------------------
    let deferredInstall = null;
    const installBtn = document.getElementById('install-app');
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredInstall = e;
      if (installBtn) installBtn.hidden = false;
    });
    function promptInstall() {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      deferredInstall.userChoice.then(function () {
        deferredInstall = null;
        if (installBtn) installBtn.hidden = true;
      });
    }
    if (installBtn) installBtn.addEventListener('click', promptInstall);
    window.addEventListener('appinstalled', function () {
      deferredInstall = null;
      if (installBtn) installBtn.hidden = true;
    });

    // ---- Custom insertion keypad (touch devices) --------------------------
    const keypad = document.getElementById('keypad');
    const coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    function showKeypad(on) {
      if (!keypad) return;
      keypad.hidden = !on;
      layoutEl.classList.toggle('keypad-open', on);
    }
    if (keypad && coarsePointer) {
      noteView.addEventListener('focusin', function (e) {
        if (e.target && e.target.tagName === 'TEXTAREA') showKeypad(true);
      });
      noteView.addEventListener('focusout', function () {
        setTimeout(function () { if (!noteView.contains(document.activeElement)) showKeypad(false); }, 60);
      });
      // Keep the textarea focused when a key is pressed.
      keypad.addEventListener('mousedown', function (e) { e.preventDefault(); });
      keypad.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });
      keypad.addEventListener('click', function (e) {
        const k = e.target.closest('.keypad__key');
        if (!k) return;
        if (k.dataset.fn) noteEditor.insertAtCaret(k.dataset.fn, 1);
        else if (k.dataset.ins != null) noteEditor.insertAtCaret(k.dataset.ins, 0);
        if (navigator.vibrate) { try { navigator.vibrate(8); } catch (x) { /* ignore */ } }
      });
    }

    // ---- Swipe between notes (mobile) -------------------------------------
    // A quick horizontal flick over the note moves to the previous / next note
    // in the current (filtered) list. Starting on a table is ignored so the
    // grid can scroll horizontally, and the flick must be fast + mostly
    // horizontal so it never fights text selection, scrolling or number-scrub.
    function visibleOrder() {
      return store.list().filter(matchesQuery).filter(matchesFilters).map(function (x) { return x.id; });
    }
    function navRelative(dir) {
      if (viewingTrash) return;
      const order = visibleOrder();
      const i = order.indexOf(activeId);
      if (i < 0) return;
      const j = i + dir;
      if (j < 0 || j >= order.length) return;
      selectNote(order[j]);
    }
    let swipe = null;
    noteView.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1 || (e.target.closest && e.target.closest('.note-block--grid'))) { swipe = null; return; }
      const t = e.touches[0];
      swipe = { x: t.clientX, y: t.clientY, time: Date.now() };
    }, { passive: true });
    noteView.addEventListener('touchend', function (e) {
      if (!swipe) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - swipe.x;
      const dy = t.clientY - swipe.y;
      const dt = Date.now() - swipe.time;
      swipe = null;
      if (dt < 400 && Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 2) {
        navRelative(dx < 0 ? 1 : -1); // flick left → next note
      }
    }, { passive: true });

    function newNote() {
      viewingTrash = false;
      const note = store.create();
      loadActive();
      animateSwitch();
      pushNow(note.id);
      closeSidebar();
      focusActive();
    }

    // Start a fresh note that opens on a table.
    function newGridNote() {
      viewingTrash = false;
      const note = store.createGrid();
      loadActive();
      animateSwitch();
      pushNow(note.id);
      closeSidebar();
      focusActive();
    }

    // Insert a table into the note being edited (the primary way to add one).
    function insertTable() {
      viewingTrash = false;
      noteEditor.insertTable();
      closeSidebar();
    }

    function loadNote(body) {
      viewingTrash = false;
      const note = store.create();
      store.updateBlocks(note.id, [{ type: 'text', body: body }]);
      loadActive();
      animateSwitch();
      pushNow(note.id);
      closeSidebar();
      focusActive();
    }
    function newFromTemplate(tpl) {
      viewingTrash = false;
      const note = store.createFrom(tpl.blocks);
      loadActive();
      animateSwitch();
      pushNow(note.id);
      closeSidebar();
      focusActive();
    }

    function loadExample() { loadNote(EXAMPLE_NOTE); }
    function loadSales() { loadNote(SALES_NOTE); }
    function loadCaisse() { loadNote(CAISSE_NOTE); }

    function togglePinNote(id) {
      store.togglePin(id);
      pushNow(id);
      renderList();
    }

    // Delete = move to the trash (recoverable). It syncs as a flag, so the note
    // is hidden on other devices too but can be restored anywhere.
    function trashNote(id) {
      store.setTrashed(id, true);
      pushNow(id);
      if (id === activeId) loadActive();
      else renderList();
    }

    function restoreNote(id) {
      store.setTrashed(id, false);
      pushNow(id);
      renderList();
    }

    // Permanent, irreversible delete from the trash — this sends a tombstone so
    // the deletion propagates to every device.
    function deleteForever(id) {
      const note = store.trashList().filter((n) => n.id === id)[0];
      const label = note ? note.title : 'cette note';
      if (!window.confirm('Supprimer définitivement « ' + label + ' » ? Cette action est irréversible.')) return;
      store.remove(id);
      if (sync) sync.remove(id);
      if (id === activeId) loadActive();
      renderList();
    }

    function actBtn(action, glyph, label) {
      const b = document.createElement('button');
      b.className = 'note-item__act';
      b.type = 'button';
      b.dataset.action = action;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.textContent = glyph;
      return b;
    }

    // Accent-insensitive search. Terms are matched with AND semantics, so
    // "café mars" finds a note mentioning both, however they're accented.
    function deburr(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }
    function matchesQuery(item) {
      if (!queryTerms.length) return true;
      const hay = deburr(item.search);
      return queryTerms.every(function (t) { return hay.indexOf(t) !== -1; });
    }

    // A deburred, lowercased copy of `s` plus a map from each deburred index
    // back to the original index — so a match found on the folded text can be
    // highlighted on the original characters.
    function deburrMap(s) {
      let out = '';
      const map = [];
      for (let i = 0; i < s.length; i++) {
        const d = s[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        for (let j = 0; j < d.length; j++) { out += d[j]; map.push(i); }
      }
      map.push(s.length);
      return { out: out, map: map };
    }
    function highlightInto(el, text, terms) {
      el.textContent = '';
      if (!terms.length) { el.textContent = text; return; }
      const dm = deburrMap(text);
      const ranges = [];
      for (const t of terms) {
        if (!t) continue;
        let idx = 0;
        while ((idx = dm.out.indexOf(t, idx)) !== -1) { ranges.push([dm.map[idx], dm.map[idx + t.length]]); idx += t.length; }
      }
      if (!ranges.length) { el.textContent = text; return; }
      ranges.sort(function (a, b) { return a[0] - b[0]; });
      const merged = [];
      for (const r of ranges) {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
        else merged.push(r.slice());
      }
      let pos = 0;
      for (const r of merged) {
        if (r[0] > pos) el.appendChild(document.createTextNode(text.slice(pos, r[0])));
        const mark = document.createElement('mark');
        mark.className = 'note-hit';
        mark.textContent = text.slice(r[0], r[1]);
        el.appendChild(mark);
        pos = r[1];
      }
      if (pos < text.length) el.appendChild(document.createTextNode(text.slice(pos)));
    }

    function renderList() {
      const items = (viewingTrash ? store.trashList() : store.list())
        .filter(matchesQuery)
        .filter(function (it) { return viewingTrash || matchesFilters(it); });
      if (sidebarTitle) sidebarTitle.textContent = viewingTrash ? 'Corbeille' : 'Notes';
      if (trashToggle) trashToggle.textContent = viewingTrash ? '← Retour aux notes' : '🗑 Corbeille';

      const frag = document.createDocumentFragment();
      if (!items.length) {
        const empty = document.createElement('li');
        empty.className = 'note-empty';
        empty.textContent = viewingTrash ? 'Corbeille vide'
          : (query ? 'Aucun résultat' : 'Aucune note');
        frag.appendChild(empty);
      }
      for (const n of items) {
        const li = document.createElement('li');
        li.className = 'note-item'
          + (!viewingTrash && n.id === activeId ? ' is-active' : '')
          + (n.pinned ? ' is-pinned' : '')
          + (selectMode && selectedIds.has(n.id) ? ' is-selected' : '');
        li.dataset.id = n.id;

        const title = document.createElement('div');
        title.className = 'note-item__title';
        highlightInto(title, n.title, queryTerms);

        const snippet = document.createElement('div');
        snippet.className = 'note-item__snippet';
        highlightInto(snippet, n.snippet || 'Note vide', queryTerms);

        const actions = document.createElement('div');
        actions.className = 'note-item__actions';
        if (viewingTrash) {
          actions.appendChild(actBtn('restore', '↩', 'Restaurer'));
          actions.appendChild(actBtn('purge', '✕', 'Supprimer définitivement'));
        } else {
          const pin = actBtn('pin', '📌', n.pinned ? 'Détacher' : 'Épingler');
          if (n.pinned) pin.classList.add('is-on');
          actions.appendChild(pin);
          actions.appendChild(actBtn('trash', '🗑', 'Mettre à la corbeille'));
        }

        li.appendChild(title);
        li.appendChild(snippet);
        li.appendChild(actions);
        frag.appendChild(li);
      }
      listEl.textContent = '';
      listEl.appendChild(frag);
    }

    // Event delegation for the note list.
    listEl.addEventListener('click', function (e) {
      const btn = e.target.closest('.note-item__act');
      const item = e.target.closest('.note-item');
      if (!item) return;
      const id = item.dataset.id;
      if (btn) {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'pin') togglePinNote(id);
        else if (action === 'trash') trashNote(id);
        else if (action === 'restore') restoreNote(id);
        else if (action === 'purge') deleteForever(id);
        return;
      }
      if (selectMode) { toggleSelected(id); return; }
      if (!viewingTrash) selectNote(id);
    });

    // Swipe a note-item left to send it to the trash (recoverable). Distinct
    // from a vertical scroll; disabled in selection / trash view.
    let itemSwipe = null;
    listEl.addEventListener('touchstart', function (e) {
      const item = e.target.closest('.note-item');
      if (!item || selectMode || viewingTrash) { itemSwipe = null; return; }
      const t = e.touches[0];
      itemSwipe = { item: item, id: item.dataset.id, x: t.clientX, y: t.clientY, dx: 0 };
    }, { passive: true });
    listEl.addEventListener('touchmove', function (e) {
      if (!itemSwipe) return;
      const t = e.touches[0];
      const dx = t.clientX - itemSwipe.x;
      const dy = t.clientY - itemSwipe.y;
      if (Math.abs(dx) > Math.abs(dy) && dx < 0) {
        itemSwipe.dx = dx;
        itemSwipe.item.style.transition = 'none';
        itemSwipe.item.style.transform = 'translateX(' + Math.max(dx, -120) + 'px)';
        itemSwipe.item.classList.toggle('swipe-armed', dx < -90);
      }
    }, { passive: true });
    listEl.addEventListener('touchend', function () {
      if (!itemSwipe) return;
      const it = itemSwipe;
      itemSwipe = null;
      it.item.style.transition = '';
      it.item.style.transform = '';
      it.item.classList.remove('swipe-armed');
      if (it.dx < -90) trashNote(it.id);
    }, { passive: true });

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        query = searchInput.value.trim().toLowerCase();
        queryTerms = deburr(query).split(/\s+/).filter(Boolean);
        renderList();
      });
    }
    if (trashToggle) {
      trashToggle.addEventListener('click', function () {
        viewingTrash = !viewingTrash;
        renderList();
      });
    }

    // ---- Backup: export every note to a JSON file, import (merge) back -----
    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    }
    function safeName(s) { return (s || 'note').replace(/[^\p{L}\p{N}_ -]/gu, '').trim().slice(0, 40) || 'note'; }
    function toast(msg) {
      let el = document.getElementById('toast');
      if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
      el.textContent = msg;
      el.classList.add('is-shown');
      clearTimeout(el._t);
      el._t = setTimeout(function () { el.classList.remove('is-shown'); }, 1800);
    }
    function downloadNotes(data, label) {
      downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
        'text-calculator-' + label + '-' + new Date().toISOString().slice(0, 10) + '.json');
    }
    function exportNotes() { downloadNotes(store.exportAll(), 'notes'); }
    function exportMarkdown() {
      const md = noteEditor.toMarkdown();
      const item = activeItem();
      downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), safeName(item && item.title) + '.md');
    }
    function copyNote() {
      const md = noteEditor.toMarkdown();
      function done() { toast('Note copiée dans le presse-papiers'); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md).then(done, function () { toast('Copie impossible'); });
      } else {
        const ta = document.createElement('textarea');
        ta.value = md;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
        ta.remove();
      }
    }
    function exportSelection() {
      const notes = Array.from(selectedIds).map(function (id) { return store.getNote(id); }).filter(Boolean);
      if (!notes.length) return;
      downloadNotes({ app: 'text-calculator', version: 1, exportedAt: Date.now(), notes: notes }, 'selection');
    }
    function importNotesFromFile(file) {
      const reader = new FileReader();
      reader.onload = function () {
        const raw = reader.result;
        let data = null;
        try { data = JSON.parse(raw); } catch (e) { /* not JSON */ }
        if (data && Array.isArray(data.notes)) {
          const r = store.importAll(data);
          renderList();
          loadActive();
          pushAll();
          window.alert('Import terminé : ' + r.added + ' ajoutée(s), ' + r.updated + ' mise(s) à jour.');
        } else {
          // Plain text (Soulver / Numi / .txt / .md) → one new note.
          viewingTrash = false;
          const note = store.createFrom([{ type: 'text', body: String(raw) }]);
          loadActive();
          animateSwitch();
          pushNow(note.id);
          toast('Texte importé dans une nouvelle note');
        }
      };
      reader.readAsText(file);
    }
    function exportCSV() {
      const csv = noteEditor.toCSV();
      if (!csv) { toast('Aucun tableau à exporter dans cette note'); return; }
      const item = activeItem();
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), safeName(item && item.title) + '.csv');
    }
    // ---- Multiple selection with grouped actions --------------------------
    function setSelectMode(on) {
      selectMode = on;
      if (!on) selectedIds.clear();
      layoutEl.classList.toggle('is-selecting', on);
      updateBulkBar();
      renderList();
    }
    function toggleSelected(id) {
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      updateBulkBar();
      const li = listEl.querySelector('.note-item[data-id="' + id + '"]');
      if (li) li.classList.toggle('is-selected', selectedIds.has(id));
    }
    function updateBulkBar() {
      const bar = document.getElementById('bulk-bar');
      const count = document.getElementById('bulk-count');
      if (!bar) return;
      bar.hidden = !selectMode;
      const n = selectedIds.size;
      if (count) count.textContent = n + ' sélectionnée' + (n > 1 ? 's' : '');
    }
    function bulkPin() {
      selectedIds.forEach(function (id) { store.setPinned(id, true); });
      renderList();
      pushAll();
    }
    function bulkTrash() {
      const ids = Array.from(selectedIds);
      ids.forEach(function (id) { store.setTrashed(id, true); });
      setSelectMode(false);
      loadActive();
      renderList();
      pushAll();
    }
    const selectToggle = document.getElementById('select-toggle');
    if (selectToggle) selectToggle.addEventListener('click', function () { setSelectMode(!selectMode); });
    const bulkPinBtn = document.getElementById('bulk-pin');
    const bulkTrashBtn = document.getElementById('bulk-trash');
    const bulkExportBtn = document.getElementById('bulk-export');
    const bulkCancelBtn = document.getElementById('bulk-cancel');
    if (bulkPinBtn) bulkPinBtn.addEventListener('click', bulkPin);
    if (bulkTrashBtn) bulkTrashBtn.addEventListener('click', bulkTrash);
    if (bulkExportBtn) bulkExportBtn.addEventListener('click', exportSelection);
    if (bulkCancelBtn) bulkCancelBtn.addEventListener('click', function () { setSelectMode(false); });

    // ---- Templates menu ---------------------------------------------------
    const tplBtn = document.getElementById('tpl-btn');
    const tplMenu = document.getElementById('tpl-menu');
    if (tplBtn && tplMenu && TC.TEMPLATES) {
      TC.TEMPLATES.forEach(function (t) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tpl-menu__opt';
        b.textContent = t.emoji + ' ' + t.label;
        b.addEventListener('click', function () { tplMenu.hidden = true; newFromTemplate(t); });
        tplMenu.appendChild(b);
      });
      tplBtn.addEventListener('click', function (e) { e.stopPropagation(); tplMenu.hidden = !tplMenu.hidden; });
      document.addEventListener('click', function (e) {
        if (!tplBtn.contains(e.target) && !tplMenu.contains(e.target)) tplMenu.hidden = true;
      });
    }

    const exportBtn = document.getElementById('export-notes');
    const importBtn = document.getElementById('import-notes');
    const importFile = document.getElementById('import-file');
    if (exportBtn) exportBtn.addEventListener('click', exportNotes);
    if (importBtn && importFile) {
      importBtn.addEventListener('click', function () { importFile.click(); });
      importFile.addEventListener('change', function () {
        if (importFile.files && importFile.files[0]) importNotesFromFile(importFile.files[0]);
        importFile.value = '';
      });
    }

    document.getElementById('new-note').addEventListener('click', newNote);
    document.getElementById('new-grid').addEventListener('click', newGridNote);
    document.getElementById('tb-grid').addEventListener('click', insertTable);
    document.getElementById('tb-simplify').addEventListener('click', function () { noteEditor.simplify(); });
    document.getElementById('load-example').addEventListener('click', loadExample);
    document.getElementById('load-sales').addEventListener('click', loadSales);
    document.getElementById('load-caisse').addEventListener('click', loadCaisse);

    // Function palette: insert "name()" with the caret between the parentheses.
    document.getElementById('fnbar').addEventListener('click', function (e) {
      const btn = e.target.closest('.fn');
      if (!btn) return;
      noteEditor.insertAtCaret(btn.dataset.insert, 1);
    });

    // Command palette (Ctrl/Cmd+K) — every entry reuses a handler above.
    const palette = TC.createCommandPalette ? TC.createCommandPalette({ getCommands: buildCommands }) : null;
    function buildCommands() {
      const cmds = [
        { label: 'Nouvelle note', hint: 'Ctrl+Entrée', run: newNote },
        { label: 'Nouveau tableau', run: newGridNote },
        { label: 'Insérer un tableau ici', run: insertTable },
        { label: 'Simplifier les calculs', run: function () { noteEditor.simplify(); } },
        { label: 'Note d’exemple', run: loadExample },
        { label: 'Note ventes (expo)', run: loadSales },
        { label: 'Note caisse (expo)', run: loadCaisse },
        { label: 'Aide-mémoire', run: function () { setHelp(true); } },
        { label: 'Synchronisation…', run: function () { setSync(true); } },
        { label: 'Historique de la note (versions)', run: openHistory },
        { label: 'Copier la note (Markdown)', run: copyNote },
        { label: 'Exporter la note en Markdown', run: exportMarkdown },
        { label: 'Exporter les tableaux en CSV', run: exportCSV },
        { label: 'Imprimer / exporter en PDF', hint: 'impression', run: function () { window.print(); } },
        { label: 'Importer un fichier (JSON ou texte)…', run: function () { const f = document.getElementById('import-file'); if (f) f.click(); } },
        { label: 'Exporter toutes les notes (sauvegarde)', run: exportNotes },
        { label: 'Importer des notes…', run: function () { const f = document.getElementById('import-file'); if (f) f.click(); } },
        { label: viewingTrash ? 'Revenir aux notes' : 'Corbeille', run: function () { viewingTrash = !viewingTrash; renderList(); } },
      ];
      (TC.TEMPLATES || []).forEach(function (t) {
        cmds.push({ label: 'Modèle : ' + t.label, hint: 'nouvelle note', run: function () { newFromTemplate(t); } });
      });
      if (deferredInstall) cmds.push({ label: 'Installer l’application', hint: 'PWA', run: promptInstall });
      store.list().slice(0, 12).forEach(function (it) {
        cmds.push({ label: 'Aller à : ' + (it.title || 'Sans titre'), hint: 'note', run: function () { viewingTrash = false; selectNote(it.id); } });
      });
      return cmds;
    }
    if (palette) {
      document.addEventListener('keydown', function (e) {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); palette.toggle(); }
      });
    }

    // Note-level undo / redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y) — active
    // only while the note editor holds focus, so other inputs keep native undo.
    document.addEventListener('keydown', function (e) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = (e.key || '').toLowerCase();
      const inNote = noteView.contains(document.activeElement) || document.activeElement === document.body || document.activeElement === noteView;
      if (k === 'z') {
        if (!inNote) return;
        e.preventDefault();
        if (e.shiftKey) { if (noteEditor.redo) noteEditor.redo(); }
        else if (noteEditor.undo) noteEditor.undo();
      } else if (k === 'y') {
        if (!inNote) return;
        e.preventDefault();
        if (noteEditor.redo) noteEditor.redo();
      }
    });

    // Sidebar toggle (mobile)
    const toggle = document.getElementById('sidebar-toggle');
    function openSidebar() { layoutEl.classList.add('sidebar-open'); }
    function closeSidebar() { layoutEl.classList.remove('sidebar-open'); }
    if (toggle) {
      toggle.addEventListener('click', function () {
        layoutEl.classList.toggle('sidebar-open');
      });
    }
    document.getElementById('scrim').addEventListener('click', closeSidebar);

    // Mobile bottom action bar (thumb zone).
    document.getElementById('mb-notes').addEventListener('click', function () { layoutEl.classList.toggle('sidebar-open'); });
    document.getElementById('mb-note').addEventListener('click', newNote);
    document.getElementById('mb-grid').addEventListener('click', insertTable);
    document.getElementById('mb-help').addEventListener('click', function () { setHelp(true); });

    // Help panel
    const helpPanel = document.getElementById('help-panel');
    const helpScrim = document.getElementById('help-scrim');
    function setHelp(open) {
      helpPanel.hidden = !open;
      helpScrim.hidden = !open;
    }
    document.getElementById('help-btn').addEventListener('click', function () { setHelp(true); });
    document.getElementById('help-close').addEventListener('click', function () { setHelp(false); });
    helpScrim.addEventListener('click', function () { setHelp(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !helpPanel.hidden) setHelp(false);
    });

    // ---- Synchronisation (optionnelle, multi-appareils) -------------------
    // Local-first : sans configuration, l'app reste purement locale. Une fois
    // configurée, chaque modification est poussée et les changements distants
    // sont fusionnés (dernière écriture gagnante par horodatage).
    let sync = null;
    const pendingPush = {};
    let pushTimer = null;

    function schedulePush(id) {
      pendingPush[id] = true;
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(flushPush, 600);
    }
    function flushPush() {
      pushTimer = null;
      const ids = Object.keys(pendingPush);
      for (const id of ids) delete pendingPush[id];
      if (!sync || !sync.isConfigured()) return;
      for (const id of ids) {
        const note = store.getNote(id);
        if (note) sync.push(id, note);
      }
    }
    function pushNow(id) {
      if (!sync || !sync.isConfigured()) return;
      const note = store.getNote(id);
      if (note) sync.push(id, note);
    }
    function pushAll() {
      if (!sync || !sync.isConfigured()) return;
      const notes = store.allNotes();
      for (const n of notes) sync.push(n.id, n);
    }

    function isEditingActive() {
      const ae = document.activeElement;
      return !!ae && noteView.contains(ae);
    }

    function onRemoteNote(id, remote) {
      const res = store.applyRemote(id, remote);
      if (res === 'ignored') return;
      // If the change lands on the note we're actively editing, don't yank the
      // text from under the cursor — the next keystroke pushes and wins by
      // timestamp. Otherwise reflect it immediately.
      if (id === activeId && isEditingActive()) { bumpList(); return; }
      if (id === activeId) loadActive();
      else renderList();
    }
    function onRemoteDelete(id) {
      if (!store.getNote(id)) return;
      const wasActive = (id === activeId);
      store.remove(id);
      if (wasActive) loadActive();
      else renderList();
    }

    const SYNC_LABELS = {
      on: 'connectée', connecting: 'connexion…',
      error: 'hors ligne (reconnexion…)', off: 'désactivée',
    };
    const syncPanel = document.getElementById('sync-panel');
    const syncScrim = document.getElementById('sync-scrim');
    const syncStateEl = document.getElementById('sync-state');
    const syncUrlEl = document.getElementById('sync-url');
    const syncWsEl = document.getElementById('sync-ws');
    const syncAuthEl = document.getElementById('sync-auth');
    const syncShareEl = document.getElementById('sync-share');
    const syncBtn = document.getElementById('sync-btn');

    function renderSyncStatus(state) {
      if (syncStateEl) syncStateEl.textContent = SYNC_LABELS[state] || state;
      if (syncBtn) {
        syncBtn.classList.toggle('is-on', state === 'on' || state === 'connecting');
        syncBtn.title = 'Synchronisation : ' + (SYNC_LABELS[state] || state);
      }
    }
    function shareLink() {
      const cfg = sync.getConfig();
      if (!cfg) return '';
      return location.origin + location.pathname + '#sync=' + TC.Sync.encodeShare(cfg);
    }
    function updateShareLink() {
      if (syncShareEl) syncShareEl.textContent = shareLink();
    }
    function fillSyncForm() {
      const cfg = sync.getConfig();
      if (cfg) {
        syncUrlEl.value = cfg.url || '';
        syncWsEl.value = cfg.ws || '';
        syncAuthEl.value = cfg.auth || '';
      }
      updateShareLink();
    }
    function setSync(open) {
      syncPanel.hidden = !open;
      syncScrim.hidden = !open;
      if (open) fillSyncForm();
    }

    sync = TC.createSync({
      onRemoteNote: onRemoteNote,
      onRemoteDelete: onRemoteDelete,
      onStatus: renderSyncStatus,
    });

    if (syncBtn) syncBtn.addEventListener('click', function () { setSync(true); });
    document.getElementById('sync-close').addEventListener('click', function () { setSync(false); });
    syncScrim.addEventListener('click', function () { setSync(false); });
    document.getElementById('sync-gen').addEventListener('click', function () {
      syncWsEl.value = TC.Sync.randomKey();
    });
    document.getElementById('sync-enable').addEventListener('click', function () {
      const url = syncUrlEl.value.trim();
      const ws = syncWsEl.value.trim();
      const auth = syncAuthEl.value.trim();
      if (!url || !ws) { window.alert('Renseignez l’URL de la base et une clé d’espace de travail.'); return; }
      const cfg = { url: url, ws: ws };
      if (auth) cfg.auth = auth;
      sync.configure(cfg);
      pushAll();
      updateShareLink();
    });
    document.getElementById('sync-disable').addEventListener('click', function () {
      sync.configure(null);
      updateShareLink();
    });
    document.getElementById('sync-copy').addEventListener('click', function () {
      const link = shareLink();
      if (!link) { window.alert('Activez d’abord la synchronisation.'); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(link).catch(function () {});
      if (syncShareEl) syncShareEl.textContent = link;
    });

    // Auto-connect: a shared link (#sync=…) takes priority, otherwise reuse the
    // saved configuration. Never in demo mode — the sandbox stays offline so it
    // can't push example notes into the real workspace.
    function initSync() {
      const m = /[#&]sync=([^&]+)/.exec(location.hash || '');
      const fromLink = m ? TC.Sync.decodeShare(m[1]) : null;
      if (fromLink && fromLink.url && fromLink.ws) {
        sync.configure(fromLink);
        pushAll();
        // Drop the secret from the address bar.
        try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
      } else if (sync.loadSaved()) {
        sync.start();
      } else {
        renderSyncStatus('off');
      }
    }
    if (demo) {
      renderSyncStatus('off');
      if (syncBtn) syncBtn.hidden = true;
    } else {
      initSync();
    }

    // Demo banner: make the sandbox obvious and easy to leave.
    (function setupDemo() {
      const enterBtn = document.getElementById('demo-enter');
      if (enterBtn) {
        if (demo) enterBtn.hidden = true;
        else enterBtn.addEventListener('click', function () { location.href = location.pathname + '?demo'; });
      }
      const banner = document.getElementById('demo-banner');
      if (!banner) return;
      banner.hidden = !demo;
      layoutEl.classList.toggle('is-demo', demo);
      if (!demo) return;
      const resetBtn = document.getElementById('demo-reset');
      const exitBtn = document.getElementById('demo-exit');
      if (resetBtn) resetBtn.addEventListener('click', function () {
        if (!window.confirm('Réinitialiser les notes de démo ?')) return;
        try { localStorage.removeItem(DEMO_KEY); } catch (e) { /* ignore */ }
        location.reload();
      });
      if (exitBtn) exitBtn.addEventListener('click', function () {
        location.href = location.pathname; // drop ?demo
      });
    })();

    // Keyboard: Cmd/Ctrl+Enter creates a new note.
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        newNote();
      }
      if (e.key === 'Escape' && !syncPanel.hidden) setSync(false);
    });

    loadActive();
    focusActive();
  });
})();
