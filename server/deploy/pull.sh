#!/usr/bin/env bash
#
# pull.sh — déploie sur le serveur la dernière version poussée sur « main ».
#
# Appelé automatiquement par le workflow GitHub Actions (deploy-server.yml) via
# SSH après chaque push sur main ; peut aussi être lancé à la main :
#   cd /var/www/text-calculator && bash server/deploy/pull.sh
#
# Il met à jour le dépôt (site + serveur), installe les dépendances serveur
# seulement si une base SQL est configurée, puis redémarre le service.
#
# Prérequis (voir README §« Déploiement automatique ») :
#   - l'utilisateur de déploiement possède le dépôt (git reset lui appartient) ;
#   - il a le droit sudo SANS mot de passe pour la seule commande de redémarrage
#     (ligne sudoers fournie dans le README).
set -euo pipefail

# Racine du dépôt = deux niveaux au-dessus de ce script (server/deploy/..).
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"

BRANCH="${DEPLOY_BRANCH:-main}"
SERVICE="${SYNC_SERVICE:-text-calculator-sync}"

echo "→ Récupération de origin/${BRANCH}…"
git fetch --quiet origin "$BRANCH"
git reset --hard --quiet "origin/${BRANCH}"

# Dépendances serveur : uniquement si un backend SQL est configuré dans le .env
# (le backend fichier, par défaut, ne requiert aucune dépendance).
if [ -f server/.env ] && grep -qE '^[[:space:]]*(DATABASE_URL|DB_HOST|DB_CLIENT)=' server/.env; then
  echo "→ Base SQL détectée — installation des dépendances serveur…"
  ( cd server && npm install --omit=dev --no-audit --no-fund )
fi

echo "→ Redémarrage du service ${SERVICE}…"
sudo systemctl restart "$SERVICE"

echo "✓ Déployé : $(git rev-parse --short HEAD) sur $(hostname)"
