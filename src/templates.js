/*
 * templates.js — ready-to-use note templates.
 *
 * Each template is a note (a list of blocks in the storage shape: text / grid).
 * They double as a showcase — the devis and note-de-frais reference a named
 * table's cells from the text ("somme(Lignes!D2:D6)"), the budget uses shared
 * variables, and the recipe uses light Markdown.
 */
(function (root, factory) {
  const mod = factory();
  root.TC = root.TC || {};
  root.TC.TEMPLATES = mod.TEMPLATES;
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function grid(name, rows, cols, cells) { return { type: 'grid', grid: { rows: rows, cols: cols, cells: cells, name: name } }; }
  function text(body) { return { type: 'text', body: body }; }

  const TEMPLATES = [
    {
      id: 'devis',
      label: 'Devis',
      emoji: '🧾',
      blocks: [
        text('# Devis\n\nClient : \ndate = aujourd\'hui =\nvalidité = 30 jours'),
        grid('Lignes', 6, 4, {
          '0,0': 'Désignation', '0,1': 'Qté', '0,2': 'PU', '0,3': 'Total',
          '1,1': '1', '1,2': '0 €', '1,3': '=B2*C2',
          '2,1': '1', '2,2': '0 €', '2,3': '=B3*C3',
          '3,1': '1', '3,2': '0 €', '3,3': '=B4*C4',
        }),
        text('totalHT = somme(Lignes!D2:D6) =\ntva = tva(totalHT) =\ntotalTTC = ttc(totalHT) ='),
      ],
    },
    {
      id: 'frais',
      label: 'Note de frais',
      emoji: '💼',
      blocks: [
        text('# Note de frais\n\nNom : \nMois : '),
        grid('Frais', 8, 3, {
          '0,0': 'Date', '0,1': 'Objet', '0,2': 'Montant',
          '1,0': '01/01', '1,1': 'Exemple', '1,2': '0 €',
        }),
        text('total = somme(Frais!C2:C8) ='),
      ],
    },
    {
      id: 'budget',
      label: 'Budget mensuel',
      emoji: '📊',
      blocks: [
        text('# Budget du mois\n\nrevenu = 2000 €\n\n## Dépenses\nloyer = 800 €\ncourses = 400 €\ntransport = 120 €\nloisirs = 150 €\n\ndépenses = loyer + courses + transport + loisirs =\nreste = revenu - dépenses =\npart_loyer = loyer sur revenu ='),
      ],
    },
    {
      id: 'recette',
      label: 'Recette',
      emoji: '🍳',
      blocks: [
        text('# Recette\n\nPortions : 4\n\n## Ingrédients\n- 200 g de farine\n- 3 œufs\n- 50 cl de lait\n- 1 càs de sucre\n\n## Préparation\n1. Mélanger la farine et les œufs.\n2. Ajouter le lait petit à petit.\n3. Laisser reposer 1 h.\n\n## À l\'échelle\nfarine_pour_6 = 200 g * 6 / 4 ='),
      ],
    },
  ];

  return { TEMPLATES: TEMPLATES };
});
