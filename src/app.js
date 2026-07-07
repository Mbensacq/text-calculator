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
    const store = TC.createStore(DEFAULT_NOTE);

    const listEl = document.getElementById('note-list');
    const layoutEl = document.getElementById('app');

    let activeId = store.active().id;
    let listTimer = null;

    const textView = document.getElementById('text-view');
    const gridView = document.getElementById('grid-view');

    function bumpList() {
      if (listTimer) clearTimeout(listTimer);
      listTimer = setTimeout(renderList, 300);
    }

    const editor = TC.createEditor({
      input: document.getElementById('input'),
      highlight: document.getElementById('highlight'),
      onChange: function (text) {
        store.updateBody(activeId, text);
        schedulePush(activeId);
        bumpList();
      },
    });

    const gridEditor = TC.createGridEditor({
      container: document.getElementById('grid'),
      onChange: function (model) {
        store.updateGrid(activeId, model);
        schedulePush(activeId);
        bumpList();
      },
    });

    let isGrid = false;

    function loadActive() {
      const note = store.active();
      activeId = note.id;
      isGrid = note.type === 'grid';
      textView.hidden = isGrid;
      gridView.hidden = !isGrid;
      if (isGrid) gridEditor.setModel(note.grid);
      else editor.setValue(note.body);
      renderList();
    }

    function focusActive() { if (isGrid) gridEditor.focus(); else editor.focus(); }

    function selectNote(id) {
      store.setActive(id);
      loadActive();
      closeSidebar();
      focusActive();
    }

    function newNote() {
      const note = store.create();
      loadActive();
      pushNow(note.id);
      closeSidebar();
      editor.focus();
    }

    function newGrid() {
      const note = store.createGrid();
      loadActive();
      pushNow(note.id);
      closeSidebar();
      gridEditor.focus();
    }

    function loadNote(body) {
      const note = store.create();
      store.updateBody(note.id, body);
      loadActive();
      pushNow(note.id);
      closeSidebar();
      editor.focus();
    }
    function loadExample() { loadNote(EXAMPLE_NOTE); }
    function loadSales() { loadNote(SALES_NOTE); }

    function deleteNote(id) {
      const note = store.list().filter((n) => n.id === id)[0];
      const label = note ? note.title : 'cette note';
      if (!window.confirm('Supprimer « ' + label + ' » ?')) return;
      store.remove(id);
      if (sync) sync.remove(id);
      loadActive();
    }

    function renderList() {
      const notes = store.list();
      const frag = document.createDocumentFragment();
      for (const n of notes) {
        const li = document.createElement('li');
        li.className = 'note-item' + (n.id === activeId ? ' is-active' : '');
        li.dataset.id = n.id;

        const title = document.createElement('div');
        title.className = 'note-item__title';
        title.textContent = n.title;

        const snippet = document.createElement('div');
        snippet.className = 'note-item__snippet';
        snippet.textContent = n.snippet || 'Note vide';

        const del = document.createElement('button');
        del.className = 'note-item__del';
        del.type = 'button';
        del.title = 'Supprimer';
        del.setAttribute('aria-label', 'Supprimer la note');
        del.textContent = '🗑';

        li.appendChild(title);
        li.appendChild(snippet);
        li.appendChild(del);
        frag.appendChild(li);
      }
      listEl.textContent = '';
      listEl.appendChild(frag);
    }

    // Event delegation for the note list.
    listEl.addEventListener('click', function (e) {
      const del = e.target.closest('.note-item__del');
      const item = e.target.closest('.note-item');
      if (!item) return;
      const id = item.dataset.id;
      if (del) { e.stopPropagation(); deleteNote(id); }
      else selectNote(id);
    });

    document.getElementById('new-note').addEventListener('click', newNote);
    document.getElementById('new-grid').addEventListener('click', newGrid);
    document.getElementById('load-example').addEventListener('click', loadExample);
    document.getElementById('load-sales').addEventListener('click', loadSales);

    // Function palette: insert "name()" with the caret between the parentheses.
    document.getElementById('fnbar').addEventListener('click', function (e) {
      const btn = e.target.closest('.fn');
      if (!btn) return;
      editor.insertAtCaret(btn.dataset.insert, 1);
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
      return !!ae && (textView.contains(ae) || gridView.contains(ae));
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
      if (cfg) { syncUrlEl.value = cfg.url || ''; syncWsEl.value = cfg.ws || ''; }
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
      if (!url || !ws) { window.alert('Renseignez l’URL de la base et une clé d’espace de travail.'); return; }
      sync.configure({ url: url, ws: ws });
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
    // saved configuration.
    (function initSync() {
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
