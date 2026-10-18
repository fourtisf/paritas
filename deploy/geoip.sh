#!/usr/bin/env bash
# Country database for wallet verification (apps/api/src/lib/geo.ts, docs/ELIGIBILITY.md): DB-IP "IP to Country
# Lite", free under CC BY 4.0 (the app credits "IP geolocation by DB-IP"). deploy/mainnet.sh runs it once and adds a
# monthly cron entry. The API re-reads the file when it changes.
# Run as root:  sudo -iu paritas bash /home/paritas/paritas/deploy/geoip.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules/mmdb-lib ] || { echo "Run npm ci in $(pwd) first (the check below needs mmdb-lib)." >&2; exit 1; }
DIR="$HOME/geo"
mkdir -p "$DIR"
# A new month's file appears during the first days of the month, so fall back to last month's.
for m in "$(date -u +%Y-%m)" "$(date -u -d "$(date -u +%Y-%m-15) -1 month" +%Y-%m)"; do
  if curl -fsSL --max-time 300 -o "$DIR/new.mmdb.gz" "https://download.db-ip.com/free/dbip-country-lite-$m.mmdb.gz"; then
    gunzip -f "$DIR/new.mmdb.gz"
    # Refuse a file that does not open or does not place a well-known US address (Google DNS) in the US.
    node -e '
      const { Reader } = require(process.argv[2]);
      const r = new Reader(require("fs").readFileSync(process.argv[1]));
      if (r.get("8.8.8.8")?.country?.iso_code !== "US") { console.error("country database failed its check"); process.exit(1); }
    ' "$DIR/new.mmdb" "$(pwd)/node_modules/mmdb-lib"
    mv "$DIR/new.mmdb" "$DIR/country.mmdb"
    echo "country database $m installed in $DIR/country.mmdb"
    exit 0
  fi
done
rm -f "$DIR/new.mmdb.gz"
echo "Could not download the country database from download.db-ip.com. The current file, if any, stays in place." >&2
exit 1
