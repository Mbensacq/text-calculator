# Serveur de synchronisation (self-hosted)

Un petit serveur temps réel **sans aucune dépendance** (uniquement la
bibliothèque standard de Node) qui remplace Firebase : il parle le même
protocole REST + SSE que l'application, donc **le code du navigateur ne change
pas** — il suffit d'indiquer l'URL de ce serveur dans l'app.

Idéal pour tout garder chez soi : sur un VPS Infomaniak (ou autre), les notes
restent sur votre machine, et la synchronisation tourne en permanence.

## Démarrage rapide (test local)

```sh
cd server
node server.js
# → text-calculator sync server on http://0.0.0.0:8090
```

Puis, dans l'application (bouton ⇅), renseignez l'URL du serveur
(`http://localhost:8090` en local), une clé d'espace de travail, et « Activer ».

## Configuration (variables d'environnement)

| Variable             | Défaut               | Rôle                                                        |
| -------------------- | -------------------- | ----------------------------------------------------------- |
| `PORT`               | `8090`               | Port d'écoute.                                              |
| `HOST`               | `0.0.0.0`            | Interface. Mettez `127.0.0.1` derrière un proxy.           |
| `DATA_FILE`          | `./data/notes.json`  | Fichier de persistance (écrit de façon atomique).          |
| `CORS_ORIGIN`        | `*`                  | Origine autorisée. Mettez `https://votre-domaine`.         |
| `SYNC_TOKEN`         | *(vide)*             | Si défini, exige `?auth=<token>` (jeton d'accès).          |
| `SERVE_STATIC`       | *(vide)*             | Chemin du site à servir aussi (une seule origine).         |
| `HEARTBEAT_MS`       | `25000`              | Battement pour garder les flux SSE ouverts.                |
| `TOMBSTONE_TTL_DAYS` | `90`                 | Purge des suppressions plus vieilles (0 = jamais).         |

## Déploiement sur un VPS Infomaniak

Le principe : Node tourne en service permanent sur `127.0.0.1:8090`, et un
reverse proxy (nginx) l'expose en HTTPS. Le point crucial pour le temps réel :
**désactiver la mise en mémoire tampon** du proxy pour les flux SSE.

### 1. Installer Node et déposer le code

```sh
# sur le VPS (Debian/Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo mkdir -p /var/www/text-calculator
# copiez-y le dépôt (git clone ou rsync)
```

### 2. Lancer en service (systemd)

Un exemple prêt à l'emploi est fourni dans
[`deploy/text-calculator-sync.service`](deploy/text-calculator-sync.service) :

```sh
sudo cp server/deploy/text-calculator-sync.service /etc/systemd/system/
sudo nano /etc/systemd/system/text-calculator-sync.service   # ajustez chemins/domaine
sudo systemctl daemon-reload
sudo systemctl enable --now text-calculator-sync
sudo systemctl status text-calculator-sync
```

### 3. Reverse proxy HTTPS (nginx)

Voir [`deploy/nginx.conf.example`](deploy/nginx.conf.example). L'essentiel :

```nginx
location / {
    proxy_pass http://127.0.0.1:8090;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;        # ← indispensable pour le temps réel (SSE)
    proxy_read_timeout 3600s;
    proxy_set_header Host $host;
}
```

Certificat gratuit : `sudo certbot --nginx`.

### 4. Nom de domaine (DNS)

Pointez votre domaine **directement** sur le VPS (le site s'ouvre nativement,
sans redirection visible) :

- Un sous-domaine dédié à l'API : enregistrement `A`
  `api.mon-domaine.com → <IP du VPS>` (recommandé).
- Le site lui-même : soit servi par le même VPS (`SERVE_STATIC`), soit hébergé
  ailleurs (GitHub Pages, hébergement web Infomaniak) et pointé par un autre
  enregistrement `A`/`CNAME`.

> Préférez pointer le domaine (enregistrement DNS) plutôt qu'une *redirection*
> HTTP : la redirection changerait l'URL affichée dans le navigateur.

### 5. Connecter l'application

Dans l'app (⇅) : URL = `https://api.mon-domaine.com`, une clé d'espace de
travail, et le jeton si vous avez défini `SYNC_TOKEN`. Le bouton « Copier le
lien de partage » génère un lien qui configure automatiquement les autres
appareils.

## Sécurité

- La **clé d'espace de travail** fait office de capacité secrète (comme pour
  Firebase). Ne partagez le lien qu'aux personnes autorisées.
- Pour une couche supplémentaire sur un endpoint public, définissez
  `SYNC_TOKEN` : toute requête devra fournir `?auth=<token>`.
- Servez toujours en **HTTPS** (le partage et les notes transitent en clair
  sinon).

## Protocole (pour information)

- `PUT /ws/<ws>/notes/<id>.json` — écrit une note (corps = JSON) et la diffuse.
- `GET /ws/<ws>/notes.json` avec `Accept: text/event-stream` — flux SSE :
  un instantané initial (`{path:'/', data:{…}}`) puis un événement `put`
  par écriture (`{path:'/<id>', data:{…}}`).
- `GET /ws/<ws>/notes.json` sans SSE — renvoie l'instantané en JSON (debug).

Réconciliation en **dernière écriture gagnante** par `updatedAt` ;
suppressions par **pierre tombale** (`{deleted:true, updatedAt}`).
