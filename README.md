# Text Calculator

Un bloc-notes qui **calcule pendant que vous écrivez**. On prend des notes
librement, on définit des variables au fil du texte — `distance = 10 km`,
`temps = 2 h` — et les résultats s'affichent en direct dans la marge, à la
manière de [Soulver](https://soulver.app) ou des notes d'Apple.

La particularité : **une variable peut être utilisée avant d'être définie**.
Écrivez `vitesse = distance / temps` en haut de la page et définissez
`distance` et `temps` trois lignes plus bas — le calcul se met à jour quand
même. Toute la note forme une seule portée.

```
vitesse = distance / temps      → 50 km/h

# Données du trajet
distance = 100 km               → 100 km
temps    = 2 h                  → 2 h
```

## Fonctionnalités

- **Variables littérales** définies n'importe où (`nom = expression`).
- **Références en avant** : utilisez une variable au-dessus de sa définition.
- **Unités et analyse dimensionnelle** : longueurs, masses, durées, aires,
  volumes, monnaies, données… `2 km + 500 m`, `10 km / 2 h → 5 km/h`.
- **Conversions** avec `en` : `2 h en min`, `90 km/h en m/s`.
- **Étiquettes libres** pour compter : `3 pommes + 2 pommes → 5 pommes`.
- **Pourcentages comptables** : `300 € + 20% → 360 €` (TVA, remise, pourboire).
- **Fonctions** (`sqrt`, `round`, `min`, `max`, `sum`, `moyenne`, `sin`…) et
  **constantes** (`pi`, `e`, `tau`).
- **Plusieurs notes** dans une barre latérale, enregistrées automatiquement
  dans le navigateur (localStorage).
- **Coloration légère** des titres, commentaires et variables.
- **La prose reste de la prose** : les lignes de texte ordinaire n'affichent
  aucun résultat parasite.

## Le mini-langage

| Vous écrivez            | Résultat        |
| ----------------------- | --------------- |
| `1 + 2 * 3`             | `7`             |
| `2 ^ 10`                | `1 024`         |
| `20% * 300 €`           | `60 €`          |
| `300 € + 20%`           | `360 €`         |
| `2 km + 500 m`          | `2.5 km`        |
| `100 km/h * 2 h`        | `200 km`        |
| `2 h en min`            | `120 min`       |
| `3 cafés * 4`           | `12 cafés`      |

- Un nom de variable est un identifiant simple (`prix`, `taux_tva`, `x`).
  Il peut contenir des accents. La dernière définition d'un même nom l'emporte.
- Un identifiant inconnu (ni variable, ni unité) devient une **étiquette**
  (`pommes`, `cafés`, `tickets`…) : on peut ainsi additionner des choses.
- Les lignes commençant par `#` ou `//` sont des titres/commentaires.
- Opérateurs : `+ - * / ^ %`, parenthèses, multiplication implicite (`10 km`).

### Raccourcis

- `Ctrl` / `Cmd` + `Entrée` : nouvelle note.

### Unités reconnues (extrait)

`m, km, cm, mm, mi, ft, in` · `m², ha` · `L, mL, m³` · `g, kg, t, lb, oz` ·
`s, min, h, jour, semaine, mois, an` · `km/h, mph, noeud` · `°, rad` ·
`o, ko, Mo, Go, Kio…` · `€, $, £, CHF, ¥`

## Lancer le projet

Aucune dépendance, aucune étape de build. Ouvrez simplement `index.html` dans
un navigateur, ou servez le dossier :

```sh
python3 -m http.server 8000   # puis http://localhost:8000
```

Pour lancer les tests du moteur de calcul :

```sh
npm test
```

## Structure

```
index.html         page et ordre de chargement des scripts
styles/main.css    design (thèmes clair/sombre)
src/
  units.js         analyse dimensionnelle et table des unités
  tokenizer.js     découpage d'une ligne en jetons
  parser.js        jetons → arbre syntaxique
  evaluator.js     évaluation d'une expression
  formatter.js     affichage des nombres et unités
  engine.js        portée du document et références en avant
  editor.js        surface d'écriture, surbrillance, résultats en marge
  storage.js       collection de notes (localStorage)
  app.js           câblage de l'interface
test/
  engine.test.js   tests du moteur
```

Le moteur (`src/units.js` → `engine.js`) est écrit pour fonctionner aussi bien
dans le navigateur qu'avec Node, ce qui permet de le tester sans navigateur.

## Licence

[MIT](LICENSE)
