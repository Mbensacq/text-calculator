/*
 * app.js — wires the store, the sidebar and the editor together.
 */
(function () {
  'use strict';

  const DEFAULT_NOTE = [
    '# Bienvenue',
    'Écrivez librement. Pour afficher un résultat, terminez la ligne par « = ».',
    '',
    '(2 + 3) * 4 =',
    '90 km/h en m/s =',
    '',
    '# Trajet',
    'Une variable peut servir avant même sa définition :',
    'vitesse =',
    'vitesse = distance / temps',
    'distance = 100 km',
    'temps = 2 h',
    '',
    '# Courses',
    'lait = 1.15 €',
    'pain = 2.90 €',
    'oeufs = 3.20 €',
    'total = lait + pain + oeufs =',
    'total + 20% =',
    '',
    '# Listes',
    'notes = 12, 15, 9, 17',
    'moyenne(notes) =',
    'sum(1, 2, ..., 10) =',
  ].join('\n');

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    const store = TC.createStore(DEFAULT_NOTE);

    const listEl = document.getElementById('note-list');
    const layoutEl = document.getElementById('app');

    let activeId = store.active().id;
    let listTimer = null;

    const editor = TC.createEditor({
      input: document.getElementById('input'),
      highlight: document.getElementById('highlight'),
      onChange: function (text) {
        store.updateBody(activeId, text);
        // Refresh the sidebar title/snippet, but not on every keystroke.
        if (listTimer) clearTimeout(listTimer);
        listTimer = setTimeout(renderList, 300);
      },
    });

    function loadActive() {
      const note = store.active();
      activeId = note.id;
      editor.setValue(note.body);
      renderList();
    }

    function selectNote(id) {
      store.setActive(id);
      loadActive();
      closeSidebar();
      editor.focus();
    }

    function newNote() {
      store.create();
      loadActive();
      closeSidebar();
      editor.focus();
    }

    function deleteNote(id) {
      const note = store.list().filter((n) => n.id === id)[0];
      const label = note ? note.title : 'cette note';
      if (!window.confirm('Supprimer « ' + label + ' » ?')) return;
      store.remove(id);
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

    // Keyboard: Cmd/Ctrl+Enter creates a new note.
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        newNote();
      }
    });

    loadActive();
    editor.focus();
  });
})();
