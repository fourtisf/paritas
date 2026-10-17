# Deploy to the VPS (paritas.live)

The web app, API and indexer on one Ubuntu 24.04 VPS behind Nginx with Let's Encrypt.

- DNS: `A @ → 31.97.66.123` and `CNAME www → paritas.live`.
- This deploys the site only. It never deploys contracts. Until `deployments/4663.json` is filled and the contracts are live (`docs/MAINNET.md`):
  - the app shows "Paritas is not live on Robinhood Chain yet"
  - `/api/markets` answers `[]`
  - the indexer waits

Run the blocks in order. Blocks 1, 2 and 4 run as `root`. Block 3 runs as the `paritas` user.

## 1. System (root)

Ubuntu 24.04 ships PostgreSQL 16 and Redis 7.

If SSH listens on a port other than 22, allow that port before `ufw enable`.

```bash
apt update && apt -y upgrade
apt -y install git curl build-essential nginx postgresql redis-server ufw certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs
npm install -g pm2
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
adduser --disabled-password --gecos "" paritas
```

## 2. Database (root)

The password is generated here and handed to the `paritas` user in a file that block 3 deletes.

```bash
cd /tmp
DBPASS=$(openssl rand -hex 24)
sudo -u postgres psql -c "CREATE ROLE paritas LOGIN PASSWORD '$DBPASS';"
sudo -u postgres psql -c "CREATE DATABASE paritas OWNER paritas;"
echo "postgresql://paritas:$DBPASS@127.0.0.1:5432/paritas" > /home/paritas/.dburl
chown paritas:paritas /home/paritas/.dburl && chmod 600 /home/paritas/.dburl
```

## 3. App (as `paritas`: `sudo -iu paritas`)

```bash
git clone -b claude/new-session-pc95l7 https://github.com/fourtisf/paritas.git ~/paritas
cd ~/paritas
npm ci
cp apps/api/.env.mainnet.example apps/api/.env
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$(cat ~/.dburl)|; s|^CORS_ORIGINS=.*|CORS_ORIGINS=https://paritas.live,https://www.paritas.live|" apps/api/.env
rm ~/.dburl && chmod 600 apps/api/.env
npm run db:generate -w @paritas/api
npm run db:migrate -w @paritas/api
npm run build -w @paritas/web
pm2 start apps/api/ecosystem.config.cjs
pm2 start "npm run start -w @paritas/web" --name paritas-web
pm2 save
exit
```

Notes:
- Do not create `apps/web/.env.local` here: it overrides `.env.production` (mainnet).
- The WalletConnect project id goes in `apps/web/.env.production.local`, followed by a rebuild.

## 4. Boot, Nginx and TLS (root)

`/api/` goes to Fastify with the prefix stripped, plus the websocket upgrade for `/api/stream` and `/api/makers`.

```bash
pm2 startup systemd -u paritas --hp /home/paritas
cat > /etc/nginx/sites-available/paritas <<'EOF'
server {
  listen 80;
  listen [::]:80;
  server_name paritas.live www.paritas.live;

  location /api/ {
    proxy_pass http://127.0.0.1:4000/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 1h;
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
EOF
ln -sf /etc/nginx/sites-available/paritas /etc/nginx/sites-enabled/paritas
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
getent hosts paritas.live www.paritas.live      # both must show 31.97.66.123 before certbot
certbot --nginx -d paritas.live -d www.paritas.live --redirect --agree-tos -m YOUR_EMAIL -n
```

## Check

```bash
sudo -iu paritas pm2 status                     # paritas-api, paritas-indexer, paritas-web: online
curl -sI https://paritas.live | head -1         # HTTP/2 200
curl -s https://paritas.live/api/health         # {"ok":true}
curl -s https://paritas.live/api/markets        # [] until the contracts are deployed
```

## Update to the latest commit

```bash
sudo -iu paritas bash -c 'cd ~/paritas && git pull && npm ci && npm run db:generate -w @paritas/api && npm run db:migrate -w @paritas/api && npm run build -w @paritas/web && pm2 restart all'
```

## Logs

```bash
sudo -iu paritas pm2 logs --lines 100
```
