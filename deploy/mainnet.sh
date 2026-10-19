#!/usr/bin/env bash
# Paritas on Robinhood Chain mainnet (docs/MAINNET.md). Run it again after each thing it asks for: finished steps are
# skipped. It deploys only after a dry run that prints what it read from every contract, and after you type DEPLOY.
# Run as root:  sudo -iu paritas bash /home/paritas/paritas/deploy/mainnet.sh
set -euo pipefail
if [ "$(id -un)" != paritas ]; then
  echo "Run this as the paritas user: sudo -iu paritas bash /home/paritas/paritas/deploy/mainnet.sh" >&2
  exit 1
fi
cd "$(dirname "$0")/.."
ROOT=$(pwd)
export ROBINHOOD_RPC_URL="${ROBINHOOD_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}" # rpc alias in contracts/foundry.toml
EXPLORER=https://robinhoodchain.blockscout.com
export PATH="$HOME/.foundry/bin:$PATH"
DEP=deployments/4663.json
API_ENV=apps/api/.env
WEB_ENV=apps/web/.env.production.local
KEYSTORES="$HOME/.foundry/keystores"
ADDRESS_FILE="$HOME/.foundry/paritas-deployer.address"
DEPLOYER_ENV=deploy/deployer.env # the deployer's private key when you import one (gitignored, mode 600)
step() { printf '\n== %s\n' "$*"; }
setenv() { # setenv FILE KEY VALUE: replace the line or add it
  if grep -q "^$2=" "$1"; then sed -i "s|^$2=.*|$2=$3|" "$1"; else echo "$2=$3" >> "$1"; fi
}

step "1/8 Foundry"
if ! command -v forge >/dev/null 2>&1; then
  curl -L https://foundry.paradigm.xyz | bash
  "$HOME/.foundry/bin/foundryup"
fi
forge --version | head -1

step "2/8 Mainnet RPC"
CID=$(cast chain-id --rpc-url "$ROBINHOOD_RPC_URL" 2>/dev/null || true)
if [ "$CID" != 4663 ]; then
  echo "$ROBINHOOD_RPC_URL did not answer as chain 4663 (got: ${CID:-no answer}). Check the RPC URL in the Robinhood Chain docs." >&2
  exit 1
fi
echo "chain 4663 at $ROBINHOOD_RPC_URL"

step "3/8 This server is on mainnet"
[ -f "$API_ENV" ] || { echo "$API_ENV is missing. Run deploy/vps.sh once first (docs/DEPLOY_VPS.md)." >&2; exit 1; }
if ! grep -q '^CHAIN_ID=4663' "$API_ENV" || [ -f deploy/keeper.env ] || grep -qs '^NEXT_PUBLIC_CHAIN_ID=46630' "$WEB_ENV"; then
  echo "This server is set up for testnet. Switch it back first: docs/TESTNET.md, \"Back to mainnet\"." >&2
  exit 1
fi
echo "API, indexer and web are on chain 4663"

step "4/8 Wallet verification: attester key and country database"
# The country check below needs this commit's packages; deploy/vps.sh installs them again in step 8.
[ -d node_modules/mmdb-lib ] || npm ci
KEY=$(grep '^ATTESTER_PRIVATE_KEY=' "$API_ENV" | cut -d= -f2- || true)
if [ -z "$KEY" ]; then
  KEY=0x$(openssl rand -hex 32)
  setenv "$API_ENV" ATTESTER_PRIVATE_KEY "$KEY"
  echo "Created the attester key in $API_ENV. It never leaves this server."
fi
chmod 600 "$API_ENV"
ATTESTER=$(env -u ETH_PASSWORD cast wallet address --private-key "$KEY")
echo "attester $ATTESTER"
[ -f "$HOME/geo/country.mmdb" ] || bash deploy/geoip.sh
setenv "$API_ENV" GEOIP_DB "$HOME/geo/country.mmdb"
CRON="17 4 3 * * bash $ROOT/deploy/geoip.sh >> $HOME/geo/update.log 2>&1"
if command -v crontab >/dev/null 2>&1; then
  (crontab -l 2>/dev/null | grep -v 'deploy/geoip.sh' || true; echo "$CRON") | crontab -
  echo "country database $HOME/geo/country.mmdb, refreshed monthly"
else
  echo "country database $HOME/geo/country.mmdb. No crontab here: refresh it monthly with this line in a scheduler: $CRON"
fi

step "5/8 Deployer wallet"
# Either a private key you import (kept in deploy/deployer.env) or a password-protected Foundry keystore.
if [ ! -f "$DEPLOYER_ENV" ] && [ ! -f "$KEYSTORES/paritas-deployer" ]; then
  echo "Paste the private key of the wallet that pays for the deployment, then Enter. It is not shown on screen."
  echo "Use a wallet that holds only the gas (a few thousandths of an ETH). Press Enter without a key to create a new wallet instead."
  read -rs PK || PK=""
  echo
  if [ -n "$PK" ]; then
    [[ "$PK" == 0x* ]] || PK="0x$PK"
    if [[ ! "$PK" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
      echo "That is not a private key (64 hex characters). Nothing was saved; run this script again." >&2
      exit 1
    fi
    (umask 077 && echo "DEPLOYER_PRIVATE_KEY=$PK" > "$DEPLOYER_ENV")
    echo "Saved in $DEPLOYER_ENV (only the paritas user can read it)."
  else
    mkdir -p "$KEYSTORES"
    echo "Creating the deployer wallet. Choose a strong password and keep it: you need it to deploy."
    cast wallet new "$KEYSTORES" paritas-deployer
  fi
fi
if [ -f "$DEPLOYER_ENV" ]; then
  chmod 600 "$DEPLOYER_ENV"
  DEPLOYER_KEY=$(grep '^DEPLOYER_PRIVATE_KEY=' "$DEPLOYER_ENV" | cut -d= -f2-)
  DEPLOYER=$(env -u ETH_PASSWORD cast wallet address --private-key "$DEPLOYER_KEY")
  SIGNER=(--private-key "$DEPLOYER_KEY")
else
  if ! grep -qE '^0x[0-9a-fA-F]{40}$' "$ADDRESS_FILE" 2>/dev/null; then
    echo "Enter the deployer wallet password to read its address:"
    A=$(cast wallet address --account paritas-deployer)
    echo "$A" > "$ADDRESS_FILE"
  fi
  DEPLOYER=$(cat "$ADDRESS_FILE")
  SIGNER=(--account paritas-deployer)
fi
BAL=$(cast balance "$DEPLOYER" --rpc-url "$ROBINHOOD_RPC_URL")
GAS_PRICE=$(cast gas-price --rpc-url "$ROBINHOOD_RPC_URL")
# Deploy.s.sol is 57 transactions and about 30M gas. Ask for twice that at today's gas price, for the L1 data fee this
# chain adds and a retry, and never less than 0.001 ETH. What is not spent stays in the wallet.
NEED=$(node -e 'const n = BigInt(process.argv[1]) * 60_000_000n, min = 10n ** 15n; console.log(String(n > min ? n : min))' "$GAS_PRICE")
echo "deployer $DEPLOYER, balance $(cast from-wei "$BAL") ETH"
echo "gas price $(cast from-wei "$GAS_PRICE" gwei) gwei: the deployment costs about $(cast from-wei "$((NEED / 2))") ETH; it needs $(cast from-wei "$NEED") ETH to be safe"
if ! node -e 'process.exit(BigInt(process.argv[1]) >= BigInt(process.argv[2]) ? 0 : 1)' "$BAL" "$NEED"; then
  echo
  echo "Send at least $(cast from-wei "$NEED") ETH on Robinhood Chain mainnet to $DEPLOYER (gas only; the rest stays in the wallet),"
  echo "then run this script again."
  exit 0
fi

# Deployed means code at every address in the "paritas" section of the deployment file.
deployed() {
  node --input-type=module - "$ROOT/$DEP" "$ROBINHOOD_RPC_URL" <<'JS'
import { readFileSync } from "node:fs";
const [file, rpc] = process.argv.slice(2);
const p = JSON.parse(readFileSync(file, "utf8")).paritas ?? {};
const addrs = [];
const walk = (v) => {
  if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) && !/^0x0{40}$/.test(v)) addrs.push(v); // zero: wave-2 vault
  else if (v && typeof v === "object") Object.values(v).forEach(walk);
};
walk(p);
if (!p.swapRouter) process.exit(1);
for (const a of addrs) {
  const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [a, "latest"] }) });
  const { result } = await r.json();
  if (!result || result === "0x") { console.error(`no contract at ${a}`); process.exit(2); }
}
console.log(`${addrs.length} Paritas contracts found on chain`);
JS
}

step "6/8 Addresses in $DEP"
if deployed; then
  echo "already deployed"
else
  MISSING=$(node -e '
    const d = require(process.argv[1]), out = [];
    const walk = (v, p) => {
      if (p === "paritas") return;
      if (typeof v === "string" && v.startsWith("TODO")) out.push(p);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k);
    };
    walk(d, "");
    console.log(out.join("\n"));
  ' "$ROOT/$DEP")
  if [ -n "$MISSING" ]; then
    echo "Looking the addresses up on the official pages, and checking each one on-chain:"
    if ! node deploy/find-addresses.mjs "$ROOT/$DEP" "$ROBINHOOD_RPC_URL" "$DEPLOYER" "$ATTESTER"; then
      echo
      echo "Still to fill (docs/MAINNET_ADDRESSES.md):"
      echo "$MISSING" | sed 's/^/  /'
      echo "roles.attester is this server's attester: $ATTESTER"
      exit 0
    fi
  fi
  SET_ATTESTER=$(node -e 'console.log(require(process.argv[1]).roles.attester)' "$ROOT/$DEP")
  if [ "${SET_ATTESTER,,}" != "${ATTESTER,,}" ]; then
    echo "roles.attester in $DEP is $SET_ATTESTER, but this server's attester is $ATTESTER. Set it to $ATTESTER." >&2
    exit 1
  fi
  echo "every address is filled; roles.attester matches this server"

  step "7/8 Dry run, then deploy"
  cp "$DEP" "$DEP.before" # the dry run writes simulated addresses into the file; put it back unless we deploy
  (cd contracts && forge script script/Deploy.s.sol --rpc-url robinhood "${SIGNER[@]}" --sender "$DEPLOYER")
  echo
  echo "Compare every line printed above with Blockscout and with docs/MAINNET_ADDRESSES.md."
  read -r -p "Type DEPLOY to deploy Paritas to Robinhood Chain mainnet: " ANSWER || ANSWER=""
  if [ "$ANSWER" != DEPLOY ]; then
    mv "$DEP.before" "$DEP"
    echo "Nothing was deployed."
    exit 0
  fi
  # --skip-simulation: gas comes from the node's eth_estimateGas, which includes the L1 data cost on this chain.
  OK=1
  (cd contracts && forge script script/Deploy.s.sol --rpc-url robinhood "${SIGNER[@]}" --sender "$DEPLOYER" \
    --broadcast --slow --skip-simulation) || OK=0
  if [ "$OK" = 0 ] || ! deployed; then
    # keep what forge wrote: after a broadcast it holds the addresses of everything it sent
    cp "$DEP" "$HOME/4663.unfinished-$(date -u +%Y%m%dT%H%M%SZ).json"
    mv "$DEP.before" "$DEP"
    echo "The deployment did not finish. What forge wrote is in $HOME/4663.unfinished-*.json and" \
      "contracts/broadcast/. Check the deployer balance and the output above before running this script again." >&2
    exit 1
  fi
  rm -f "$DEP.before"
  cp "$DEP" "$HOME/4663.deployed.json"
  (cd contracts && forge script script/Deploy.s.sol --rpc-url robinhood "${SIGNER[@]}" --sender "$DEPLOYER" \
    --resume --verify --verifier blockscout --verifier-url "$EXPLORER/api/") ||
    echo "Source verification on Blockscout did not finish. The contracts are deployed and work; verifying the source" \
      "can be redone later (docs/MAINNET.md)."
fi

step "8/8 API, indexer and web"
bash deploy/vps.sh

echo
echo "Paritas is live on Robinhood Chain mainnet: https://paritas.live/app/trade"
echo "Deployed addresses: $ROOT/$DEP (a copy is in $HOME/4663.deployed.json). Send this file to be committed."
echo "Next: check on Blockscout that every owner is the timelock, then seed the vaults (docs/MAINNET.md)."
if [ -f "$DEPLOYER_ENV" ]; then
  echo "The deployer has no role after deployment. Delete its key from this server: rm $ROOT/$DEPLOYER_ENV"
fi
