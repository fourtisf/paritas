#!/usr/bin/env bash
# Build and (re)start Paritas on the VPS (docs/DEPLOY_VPS.md). Safe to run again; it is also the update command.
# Run as root:  sudo -iu paritas bash /home/paritas/paritas/deploy/vps.sh
set -euo pipefail
if [ "$(id -un)" != paritas ]; then
  echo "Run this as the paritas user: sudo -iu paritas bash /home/paritas/paritas/deploy/vps.sh" >&2
  exit 1
fi
cd "$(dirname "$0")/.."

# A deployment file that a deploy script wrote on this server (it has the Paritas addresses) survives the update.
KEEP=()
for f in deployments/4663.json deployments/46630.json; do
  if ! git diff --quiet -- "$f" && node -e 'process.exit(require(process.argv[1]).paritas?.swapRouter ? 0 : 1)' "$(pwd)/$f"; then
    cp "$f" "$HOME/$(basename "$f").local"
    git checkout -- "$f"
    KEEP+=("$f")
  fi
done
git pull --ff-only
for f in "${KEEP[@]}"; do cp "$HOME/$(basename "$f").local" "$f"; done
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
if grep -q "^[^#]*CHANGE_ME" "$ENV"; then
  echo "$ENV still has CHANGE_ME. Run step 2 of docs/DEPLOY_VPS.md (database), then this script again." >&2
  exit 1
fi

npm run db:generate -w @paritas/api
npm run db:migrate -w @paritas/api
npm run build -w @paritas/web

pm2 delete paritas-api paritas-indexer paritas-web paritas-keeper >/dev/null 2>&1 || true
pm2 start apps/api/ecosystem.config.cjs
pm2 start "npm run start -w @paritas/web" --name paritas-web
# Testnet with test assets only (docs/TESTNET.md): the price keeper, when its key file is present.
if [ -f deploy/keeper.env ]; then
  chmod 600 deploy/keeper.env
  pm2 start "node --env-file=deploy/keeper.env --import tsx packages/shared/scripts/keeper-testnet.ts" --name paritas-keeper
fi
pm2 save
pm2 status
