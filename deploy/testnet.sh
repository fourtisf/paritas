#!/usr/bin/env bash
# Paritas on Robinhood Chain testnet with test assets (docs/TESTNET.md). Safe to run again: every step that is done
# is skipped, so run it once to create the wallet, again after funding it, and again to seed the vaults.
# Run as root:  sudo -iu paritas bash /home/paritas/paritas/deploy/testnet.sh
set -euo pipefail
if [ "$(id -un)" != paritas ]; then
  echo "Run this as the paritas user: sudo -iu paritas bash /home/paritas/paritas/deploy/testnet.sh" >&2
  exit 1
fi
cd "$(dirname "$0")/.."
ROOT=$(pwd)
RPC=https://rpc.testnet.chain.robinhood.com
EXPLORER=https://explorer.testnet.chain.robinhood.com
export ROBINHOOD_TESTNET_RPC_URL="${ROBINHOOD_TESTNET_RPC_URL:-$RPC}" # rpc alias in contracts/foundry.toml
export PATH="$HOME/.foundry/bin:$PATH"
KEYS=deploy/keeper.env
DEP=deployments/46630.json
API_ENV=apps/api/.env
WEB_ENV=apps/web/.env.production.local
step() { printf '\n== %s\n' "$*"; }

step "1/7 Foundry"
if ! command -v forge >/dev/null 2>&1; then
  curl -L https://foundry.paradigm.xyz | bash
  "$HOME/.foundry/bin/foundryup"
fi
forge --version | head -1

step "2/7 Testnet RPC"
CID=$(cast chain-id --rpc-url "$ROBINHOOD_TESTNET_RPC_URL" 2>/dev/null || true)
if [ "$CID" != 46630 ]; then
  echo "$ROBINHOOD_TESTNET_RPC_URL did not answer as chain 46630 (got: ${CID:-no answer}). Check the RPC URL in the Robinhood Chain docs." >&2
  exit 1
fi
echo "chain 46630 at $ROBINHOOD_TESTNET_RPC_URL"

step "3/7 Testnet database"
[ -f "$API_ENV" ] || { echo "$API_ENV is missing. Run deploy/vps.sh once first (docs/DEPLOY_VPS.md)." >&2; exit 1; }
# Keep the mainnet settings once, to switch back later (docs/TESTNET.md).
[ -f apps/api/.env.mainnet-saved ] || cp "$API_ENV" apps/api/.env.mainnet-saved
chmod 600 apps/api/.env.mainnet-saved
DBURL=$(grep '^DATABASE_URL=' apps/api/.env.mainnet-saved | cut -d= -f2-)
TDB="${DBURL%/*}/paritas_testnet"
if ! psql "$TDB" -tAc 'select 1' >/dev/null 2>&1; then
  echo "Database paritas_testnet is missing. As root run:" >&2
  echo "  sudo -u postgres psql -c \"CREATE DATABASE paritas_testnet OWNER paritas;\"" >&2
  echo "then this script again." >&2
  exit 1
fi
echo "paritas_testnet is ready (mainnet data in the paritas database is not touched)"

step "4/7 Testnet wallet (deployer and price keeper)"
if [ ! -f "$KEYS" ]; then
  (umask 077 && printf 'KEEPER_PRIVATE_KEY=0x%s\n' "$(openssl rand -hex 32)" > "$KEYS")
  echo "Created a new testnet-only wallet in $KEYS. Its key never leaves this server."
fi
sed -i '/^RPC_URL=/d' "$KEYS" && echo "RPC_URL=$ROBINHOOD_TESTNET_RPC_URL" >> "$KEYS" # the keeper uses the same node
chmod 600 "$KEYS"
KEEPER_PRIVATE_KEY=$(grep '^KEEPER_PRIVATE_KEY=' "$KEYS" | cut -d= -f2-) # not exported: the builds never see it
ADDR=$(env -u ETH_PASSWORD cast wallet address --private-key "$KEEPER_PRIVATE_KEY")
BAL=$(cast balance "$ADDR" --rpc-url "$ROBINHOOD_TESTNET_RPC_URL")
echo "address $ADDR, balance $(cast from-wei "$BAL") ETH"
if ! node -e 'process.exit(BigInt(process.argv[1]) >= 5n * 10n ** 16n ? 0 : 1)' "$BAL"; then
  echo
  echo "Send at least 0.1 testnet ETH (Robinhood Chain testnet faucet) to:"
  echo "  $ADDR"
  echo "then run this script again. Never send real ETH or mainnet funds to this wallet."
  exit 0
fi

step "5/7 Contracts with test assets"
# Deployed means "mocks": true and code at every contract address in the file. forge writes the file before it
# broadcasts, so a run that stopped halfway leaves addresses without code: start again from the template then.
deployed() {
  node --input-type=module - "$ROOT/$DEP" "$ROBINHOOD_TESTNET_RPC_URL" <<'JS'
import { readFileSync } from "node:fs";
const [file, rpc] = process.argv.slice(2);
const d = JSON.parse(readFileSync(file, "utf8"));
if (d.mocks !== true) process.exit(1);
const addrs = [];
const walk = (v, k) => {
  if (k === "roles") return; // wallets, not contracts
  if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/.test(v)) addrs.push(v);
  else if (v && typeof v === "object") for (const [kk, vv] of Object.entries(v)) walk(vv, kk);
};
walk(d);
for (const a of addrs) {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [a, "latest"] }) });
  const { result } = await r.json();
  if (!result || result === "0x") { console.error(`no contract at ${a}`); process.exit(2); }
}
console.log(`${addrs.length} contracts found on chain`);
JS
}
if deployed; then
  echo "already deployed"
else
  git checkout -- "$DEP" # the Blockscout template; DeployTestnet keeps its rpc and explorer
  # --skip-simulation: gas comes from the node's eth_estimateGas, which includes the L1 data cost on this chain.
  (cd contracts && forge script script/DeployTestnet.s.sol --rpc-url robinhood_testnet \
    --private-key "$KEEPER_PRIVATE_KEY" --sender "$ADDR" --broadcast --slow --skip-simulation)
  deployed || { echo "The deployment did not finish. Check the wallet balance and run this script again." >&2; exit 1; }
fi
# The deployed addresses only live in this file on the server: keep a copy outside the repo.
cp "$DEP" "$HOME/46630.deployed.json"

step "6/7 API and web on testnet"
sed -i "s|^CHAIN_ID=.*|CHAIN_ID=46630|; s|^RPC_URL=.*|RPC_URL=$ROBINHOOD_TESTNET_RPC_URL|; s|^DATABASE_URL=.*|DATABASE_URL=$TDB|" "$API_ENV"
grep -q '^FINNHUB_API_KEY=.\+' "$API_ENV" || echo "Warning: FINNHUB_API_KEY is empty in $API_ENV. The keeper needs it, or the test feeds go stale after 1 hour."
touch "$WEB_ENV"
sed -i '/^NEXT_PUBLIC_CHAIN_ID=/d; /^NEXT_PUBLIC_RPC_URL=/d' "$WEB_ENV"
printf 'NEXT_PUBLIC_CHAIN_ID=46630\nNEXT_PUBLIC_RPC_URL=%s\n' "$ROBINHOOD_TESTNET_RPC_URL" >> "$WEB_ENV"
bash deploy/vps.sh

step "7/7 Seed the vaults"
SC=$(node -e 'console.log(require(process.argv[1]).paritas.sessionController)' "$ROOT/$DEP")
echo "waiting 75 s for the keeper to move the test feeds to the Finnhub prices"
sleep 75
SESSION=$(cast call "$SC" "current()(uint8)" --rpc-url "$ROBINHOOD_TESTNET_RPC_URL")
if [ "$SESSION" = 3 ]; then
  echo "The New York session is Closed now, so the vaults cannot be seeded yet. Run this script again once it opens"
  echo "(Sunday 20:00 to Friday 20:00 New York time, except holidays)."
else
  (cd contracts && forge script script/SeedTestnet.s.sol --rpc-url robinhood_testnet \
    --private-key "$KEEPER_PRIVATE_KEY" --sender "$ADDR" --broadcast --slow --skip-simulation)
fi

echo
echo "Testnet is up: https://paritas.live/app/trade"
echo "Wallet: $EXPLORER/address/$ADDR"
echo "Keeper log: pm2 logs paritas-keeper"
