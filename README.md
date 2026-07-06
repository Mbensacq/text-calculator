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
- **Unités et analyse dimensionnelle** : longueurs, masses, durées, volumes,
  monnaies, données… `2 km + 500 m`, `10 km / 2 h → 5 km/h`.
- **Conversions** avec `en` : `2 h en min`, `1000 m en km`.
- **Étiquettes libres** pour compter : `3 pommes + 2 pommes → 5 pommes`.
- **Pourcentages**, fonctions (`sqrt`, `round`, `min`, `sum`, `sin`…),
  constantes (`pi`, `e`).
- **La prose reste de la prose** : les lignes de texte ordinaire n'affichent
  aucun résultat parasite.

## Le mini-langage

| Vous écrivez            | Résultat        |
| ----------------------- | --------------- |
| `1 + 2 * 3`             | `7`             |
| `2 ^ 10`                | `1 024`         |
| `20% * 300 €`           | `60 €`          |
| `2 km + 500 m`          | `2.5 km`        |
| `100 km/h * 2 h`        | `200 km`        |
| `2 h en min`            | `120 min`       |
| `3 cafés * 4`           | `12 cafés`      |

- Un nom de variable est un identifiant simple (`prix`, `taux_tva`, `x`).
- Un identifiant inconnu (ni variable, ni unité) devient une **étiquette**.
- Les lignes commençant par `#` ou `//` sont des titres/commentaires.

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
src/
  units.js       analyse dimensionnelle et table des unités
  tokenizer.js   découpage d'une ligne en jetons
  parser.js      jetons → arbre syntaxique
  evaluator.js   évaluation d'une expression
  formatter.js   affichage des nombres et unités
  engine.js      portée du document et références en avant
test/
  engine.test.js tests du moteur
```

## Licence

[MIT](LICENSE)
