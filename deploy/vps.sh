#!/usr/bin/env bash
# Build and (re)start Paritas on the VPS (docs/DEPLOY_VPS.md). Safe to run again; it is also the update command.
# Run as root:  sudo -iu paritas bash /home/paritas/paritas/deploy/vps.sh
set -euo pipefail
if [ "$(id -un)" != paritas ]; then
  echo "Run this as the paritas user: sudo -iu paritas bash /home/paritas/paritas/deploy/vps.sh" >&2
  exit 1
fi
cd "$(dirname "$0")/.."

git pull --ff-only
npm ci

ENV=apps/api/.env
[ -f "$ENV" ] || cp apps/api/.env.mainnet.example "$ENV"
# Step 2 leaves the database URL in ~/.dburl; move it into the env file once.
if [ -f ~/.dburl ]; then
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$(cat ~/.dburl)|" "$ENV"
  rm ~/.dburl
fi
sed -i "s|^CORS_ORIGINS=https://CHANGE_ME$|CORS_ORIGINS=https://paritas.live,https://www.paritas.live|" "$ENV"
chmod 600 "$ENV"
if grep -q CHANGE_ME "$ENV"; then
  echo "$ENV still has CHANGE_ME. Run step 2 of docs/DEPLOY_VPS.md (database), then this script again." >&2
  exit 1
fi

npm run db:generate -w @paritas/api
npm run db:migrate -w @paritas/api
npm run build -w @paritas/web

pm2 delete paritas-api paritas-indexer paritas-web >/dev/null 2>&1 || true
pm2 start apps/api/ecosystem.config.cjs
pm2 start "npm run start -w @paritas/web" --name paritas-web
pm2 save
pm2 status
