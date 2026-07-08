# Text Calculator

Un bloc-notes qui **calcule pendant que vous écrivez**. On prend des notes
librement, on définit des variables au fil du texte, et le résultat s'affiche
**juste après le « = »**, dans le fil du texte — à la manière des notes
d'Apple. Une ligne ne calcule que si elle se termine par `=` ; on peut donc
écrire de longs calculs sur une ligne et placer le `=` là où l'on veut voir
le résultat.

La particularité : **une variable peut être utilisée avant d'être définie**.
Écrivez `vitesse =` en haut de la page et définissez `vitesse`, `distance` et
`temps` plus bas — le résultat s'affiche quand même. Toute la note forme une
seule portée.

```
# Trajet
vitesse =                → 50 km/h
vitesse = distance / temps
distance = 100 km
temps = 2 h
```

## Fonctionnalités

- **Résultat après le « = »** : rien ne s'affiche tant que la ligne ne se
  termine pas par `=`, et le résultat apparaît juste après, dans une couleur
  distincte de celle des variables.
- **Variables littérales** définies n'importe où (`nom = expression`).
- **Références en avant** : utilisez une variable au-dessus de sa définition.
- **Unités et analyse dimensionnelle** : longueurs, masses, durées, aires,
  volumes, monnaies, données… `2 km + 500 m`, `10 km / 2 h → 5 km/h`.
- **Conversions** avec `en` : `2 h en min`, `90 km/h en m/s`.
- **Listes, plages et indexation** : `notes = 12, 15, 9` puis `moyenne(notes) =`,
  des plages façon mathématique `sum(1, 2, …, 10) =` → `55`, et un accès par
  indice façon informatique (base 0) : `notes[0] =`, `notes[-1] =`.
- **Fonctions définies par vous** : `f(x) = x^2 + 1` puis `f(3) =` → `10`,
  `aire(l, h) = l * h` puis `aire(3 m, 4 m) =` → `12 m²`.
- **Logique & pseudocode** : comparaisons (`<`, `>`, `<=`, `>=`, `==`, `!=`),
  condition `si(condition, alors, sinon)`, connecteurs `et` / `ou` / `non` —
  de quoi écrire des fonctions par morceaux et de la récursion :
  `fact(n) = si(n <= 1, 1, n * fact(n - 1))`.
- **Somme indexée** : `Σ(i, 1, n, i^2) =` (aussi `sigma`).
- **Comptes** : `total` (somme du bloc courant) et `ans` (résultat précédent).
- **Températures** `°C` / `°F` / `K` : `20 °C en °F =` → `68 °F`.
- **Tableaux façon tableur** : écrivez un tableau avec des `|`, adressez les
  cellules en `A1` (colonnes A, B, C… et lignes 1, 2, 3…), mettez des formules
  dans les cellules (`=B2*C2`) et totalisez des plages : `somme(B2:B10) =`.
- **Grille cliquable** (type de note « Tableau ») : une vraie grille où une
  cellule `=B1*C1` affiche son **résultat** (la formule n'apparaît qu'à
  l'édition), avec des poignées « + » pour ajouter lignes et colonnes.
- **Commentaires en fin de ligne** avec `//` : `loyer = 800 € // charge fixe`.
- **Aide-mémoire** intégré (bouton « ? »).
- **Fonctions type Excel / maths** insérables en un clic (barre ƒ) : `sum`,
  `moyenne`, `médiane`, `variance`, `ecarttype`, `min`, `max`, `produit`,
  `sqrt`, `round`, `abs`, `floor`, `ceil`, `log(x, b)`, `pgcd`, `ppcm`,
  `combin`, `nPr`, factorielle (`5!` ou `fact`)… et **constantes** (`pi`, `e`,
  `tau`, `phi`).
- **Étiquettes libres** pour compter : `3 pommes + 2 pommes → 5 pommes`.
- **Pourcentages comptables** : `300 € + 20% → 360 €` (TVA, remise, pourboire).
- **Plusieurs notes** dans une barre latérale, enregistrées automatiquement
  dans le navigateur (localStorage).
- **Synchronisation multi-appareils** (optionnelle) : partagez vos notes en
  temps réel entre téléphone, tablette et ordinateur, et travaillez à
  plusieurs sur le même espace. Voir la section dédiée plus bas.
- **Coloration légère** des titres, commentaires, variables et résultats.

## Le mini-langage

Ajoutez un `=` en fin de ligne pour afficher le résultat (montré ici après `→`) :

| Vous écrivez              | Résultat          |
| ------------------------- | ----------------- |
| `1 + 2 * 3 =`             | `7`               |
| `2 ^ 10 =`                | `1 024`           |
| `20% * 300 € =`           | `60 €`            |
| `300 € + 20% =`           | `360 €`           |
| `2 km + 500 m =`          | `2.5 km`          |
| `100 km/h * 2 h =`        | `200 km`          |
| `2 h en min =`            | `120 min`         |
| `3 cafés * 4 =`           | `12 cafés`        |
| `sum(1, 2, …, 8) =`       | `36`              |
| `moyenne(12, 15, 9) =`    | `12`              |
| `5! =`                    | `120`             |
| `pgcd(24, 36) =`          | `12`              |
| `(1, 2, 3, 4)[2] =`       | `3` (indice 0)    |
| `prix =`                  | valeur de `prix`  |

Définir et utiliser ses propres fonctions, y compris récursives :

```
f(x) = x^2 + 1
f(3) =                → 10
aire(l, h) = l * h
aire(3 m, 4 m) =      → 12 m²

fact(n) = si(n <= 1, 1, n * fact(n - 1))
fact(6) =             → 720
```

- **Afficher un résultat** : la ligne doit finir par `=`. `nom =` montre la
  valeur d'une variable ; `nom = expr =` la définit *et* l'affiche.
- Un nom de variable est un identifiant simple (`prix`, `taux_tva`, `x`).
  Il peut contenir des accents. La dernière définition d'un même nom l'emporte.
- Une **liste** s'écrit avec des virgules (`notes = 12, 15, 9`) et se combine
  avec les fonctions (`sum`, `moyenne`, `min`, `max`) ou élément par élément
  (`notes * 2`). Une **plage** s'écrit avec `…` : `1, 2, …, 10`.
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

## Installer sur mobile (PWA)

Le site est une application web installable et utilisable hors-ligne. Depuis
un téléphone :

- **Chrome (Android)** : menu ⋮ → *Ajouter à l'écran d'accueil* / *Installer*.
- **Firefox (Android)** : menu ⋮ → *Installer* / *Ajouter à l'écran d'accueil*.
- **Safari (iOS)** : bouton Partager → *Sur l'écran d'accueil*.

L'application s'ouvre alors en plein écran, comme une appli native, et
fonctionne sans connexion (un *service worker* met en cache la coquille).

## Synchronisation multi-appareils (optionnelle)

Par défaut, l'application est **entièrement locale** : chaque note reste dans
le navigateur. On peut, si on le souhaite, activer une synchronisation en temps
réel pour retrouver ses notes sur tous ses appareils et **travailler à
plusieurs** sur le même espace. Le client parle un protocole REST (écriture
`PUT`) + `EventSource` (SSE) minimal — aucun SDK, aucune étape de build — et
fonctionne avec **deux back-ends au choix** :

- **Firebase Realtime Database** (option A) : gratuit, hébergé par Google,
  rien à maintenir. Idéal pour rester sur un hébergement statique (GitHub
  Pages).
- **Votre propre serveur** (option B) : un petit serveur Node **sans
  dépendance** (dossier [`server/`](server/)) à héberger sur un VPS. Tout reste
  chez vous ; voir [`server/README.md`](server/README.md).

**Option A — Firebase (une fois) :**

1. Sur [console.firebase.google.com](https://console.firebase.google.com),
   créez un projet, puis *Build → Realtime Database → Créer une base*.
2. Copiez l'URL de la base (elle finit par `firebaseio.com`).
3. Dans l'application, bouton **⇅** (en haut) → collez l'URL, cliquez
   **Générer** pour une clé d'espace de travail, puis **Activer**.
4. Sur un autre appareil, ouvrez le **lien de partage** (bouton *Copier le lien
   de partage*) : il s'y connecte automatiquement au même espace.

**Option B — serveur self-hosted :** `cd server && node server.js`, exposez-le
en HTTPS derrière un reverse proxy (guide complet dans
[`server/README.md`](server/README.md) : systemd, nginx avec buffering désactivé
pour le SSE, Let's Encrypt, DNS), puis indiquez son URL dans l'app.

**Fonctionnement :** chaque note est écrite sous
`…/ws/<espace>/notes/<id>`. Les modifications sont réconciliées en
*dernière écriture gagnante* (par horodatage) ; les suppressions laissent une
*pierre tombale* pour se propager même aux appareils qui étaient hors ligne. La
note en cours d'édition n'est jamais écrasée sous le curseur.

**Sécurité :** la clé d'espace de travail joue le rôle de mot de passe (elle
n'est pas devinable) — ne partagez le lien qu'avec les personnes autorisées.
Avec Firebase, protégez la base par des *règles de sécurité* et/ou une
authentification pour un cadre strictement privé. Avec le serveur self-hosted,
définissez un jeton (`SYNC_TOKEN`) pour exiger `?auth=<token>`. Servez toujours
en **HTTPS**. Le *service worker* laisse volontairement passer les requêtes de
synchronisation (autre domaine, ou flux SSE) sans les mettre en cache.

*Nom de domaine :* pointez-le **directement** (enregistrement DNS `A`/`CNAME`)
vers votre hébergement plutôt que par une *redirection* HTTP, afin que le site
s'ouvre nativement sur votre domaine. Le front reste un ensemble de fichiers
statiques : rien à changer selon l'hébergeur.

## Lancer le projet

Aucune dépendance, aucune étape de build. Ouvrez `index.html` dans un
navigateur, ou servez le dossier (recommandé pour tester le mode hors-ligne,
les *service workers* ne fonctionnant pas en `file://`) :

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
  storage.js       collection de notes (localStorage) + fusion multi-appareils
  grid.js          calcul d'une grille de cellules (façon tableur)
  grid-editor.js   grille cliquable (note « Tableau »)
  sync.js          synchronisation temps réel (REST + SSE, Firebase ou serveur)
  app.js           câblage de l'interface
server/            serveur de synchronisation self-hosted (sans dépendance)
  server.js        serveur SSE + REST
  deploy/          exemples systemd et nginx
test/
  engine.test.js   tests du moteur
```

Le moteur (`src/units.js` → `engine.js`) est écrit pour fonctionner aussi bien
dans le navigateur qu'avec Node, ce qui permet de le tester sans navigateur.

## Licence

[MIT](LICENSE)
