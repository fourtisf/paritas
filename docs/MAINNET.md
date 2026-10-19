# Mainnet (Robinhood Chain, 4663): what is set, what is left

## Already set in the repo

| Piece | Mainnet setting |
|---|---|
| Web production build | `apps/web/.env.production`: chain 4663, public RPC, API at same-origin `/api`. `next dev` still uses `.env.local` (anvil). |
| API + indexer | `apps/api/.env.mainnet.example` (copy to `.env` on the VPS). |
| Contracts | `Deploy.s.sol` (mainnet path: Safe must be a contract, eligibility enforced, 48h timelock from `config/protocol.json`). |
| Before launch | The app shows "Paritas is not live on Robinhood Chain yet". The API answers `/markets` with `[]` and other address-based endpoints with 503 `not deployed`. The indexer waits and retries every minute. Nothing crashes. |
| Mainnet-only UI | No "Local test wallet", no "Simulate a session", no network pill. Explorer links open Blockscout. The connect modal carries the US-persons note. |

## Left to do, in order (owner in brackets)

1. **Decisions** (ALFA), in `docs/DECISIONS.md`:
   - #1 brand and domain: EIP-712 names are fixed at deploy.
   - #2 eligibility provider.
   - #6 Safe signers and guardian.
   - #7 audit.
   - #13 treasury.
   - Also #4 seed liquidity, #5 launch markets, #8 makers, #9 oracle, #10 sequencer feed.
2. **Audit**: ALFA chose an internal review for launch (`docs/SECURITY_REVIEW.md`). An external audit is still recommended (send firms `docs/AUDIT_SCOPE.md`).
3. **Fill `deployments/4663.json`** (two people, `docs/VERIFY_ON_CHAIN.md`, signed on `docs/MAINNET_ADDRESSES.md`):
   - `external` (21 TODOs)
   - `roles` (4 TODOs): multisig = the Safe, guardian, attester, treasury.

   Never from an AI answer.
4. **Testnet rehearsal first** (Michael), BRIEF section 9. This uses the real testnet assets and `Deploy.s.sol`; the
   public testnet with test assets on paritas.live (`docs/TESTNET.md`) does not count:
   - deploy on 46630 and seed the vaults
   - 100+ trades across all venues and sessions
   - indexer and app in sync
5. **Dry run, then deploy** (Michael, deployer key in a Foundry keystore):
   ```bash
   cd contracts
   forge script script/Deploy.s.sol --rpc-url robinhood --sender <deployer>        # compare every printed line with Blockscout
   forge script script/Deploy.s.sol --rpc-url robinhood --account paritas-deployer --sender <deployer> --broadcast --verify
   ```
   The script writes the `paritas` section of `deployments/4663.json`. Commit it, then check ownership on Blockscout: every owner is the timelock, the proposer is the Safe, the guardian is set.
6. **Holidays** for the coming year set on-chain, matching `config/holidays.json`.
Steps 7-9 as exact commands for paritas.live (Ubuntu 24.04, Nginx, TLS, pm2 under a `paritas` user) are in `docs/DEPLOY_VPS.md`.

7. **API on the VPS:**
   ```bash
   cp apps/api/.env.mainnet.example apps/api/.env       # fill CHANGE_ME
   npm run db:migrate -w @paritas/api
   pm2 start apps/api/ecosystem.config.cjs
   ```
   Use an archive RPC for the indexer backfill.
8. **Web on the VPS:**
   - Set the WalletConnect project id in `apps/web/.env.production.local`.
   - Do not create `apps/web/.env.local` on the server; it would override `.env.production`.
   ```bash
   npm run build -w @paritas/web
   pm2 start "npm run start -w @paritas/web" --name paritas-web
   ```
9. **Nginx:** TLS, `/` to :3000, and `/api/` to :4000 with the prefix stripped and websocket upgrade (for `/api/stream` and `/api/makers`):
   ```nginx
   location /api/ {
     proxy_pass http://127.0.0.1:4000/;
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection "upgrade";
     proxy_set_header Host $host;
   }
   location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; }
   ```
10. **Runbook** for pause, unpause (timelock), maker removal and oracle incidents (BRIEF section 9).

## One command on the VPS

`deploy/mainnet.sh` does steps 5 to 9 on paritas.live. It was tested end to end against a local chain posing as 4663.
Run it as root; it stops and says what it needs, and once that is done you run it again:

```bash
sudo -iu paritas git -C /home/paritas/paritas pull --ff-only
sudo -iu paritas bash /home/paritas/paritas/deploy/mainnet.sh
```

1. Creates the attester key for wallet verification (`docs/ELIGIBILITY.md`) and prints its address, which goes in
   `roles.attester`.
2. Asks for the deployer wallet's private key (hidden, kept in `deploy/deployer.env`, mode 600) or, with an empty answer,
   creates a password-protected keystore. It then asks for twice the deployment's gas at today's price (57 transactions,
   about 30M gas: roughly 0.0003 to 0.003 ETH at 0.01 to 0.1 gwei). What is not spent stays in the wallet.
3. Looks up every address still `TODO` in `deployments/4663.json` (`deploy/find-addresses.mjs`), from the official pages
   only: Paxos (USDG), Uniswap's Robinhood Chain deployments, docs.robinhood.com/chain (stock tokens) and Chainlink's feed
   directory. It proposes an address only when the chain confirms it (symbol and decimals, Robinhood's stock-token
   functions, the feed's own description, Uniswap's factory links). It asks for your Safe (checked against `governance` in config), guardian
   and treasury, and writes nothing until you type `YES`.
4. Dry run: prints what it read from every contract. It deploys only after you type `DEPLOY`.
5. Checks that every Paritas contract has code, then restarts the API, the indexer and the web app.
6. Send the resulting `deployments/4663.json` to be committed.

The vaults start empty. Until they are seeded, routes go through Uniswap.

## Gaps in the app to close before launch

- **Wallet verification flow.** Done: a country check and a signed declaration, no KYC (`docs/ELIGIBILITY.md`).
- **Security review.** Done internally (`docs/SECURITY_REVIEW.md`). Keep the vault caps low until F-4 is decided.
- **Spread APR.** Shows "–" until the API computes it from vault Swap events (30-day spread kept over average TVL).
- **API.** Still to build:
  - live `ParamController` check against `config/protocol.json`
  - rate limits on `/quote`
- **Portfolio "Value over time".** Today's holdings valued at past Chainlink prices; a real balance history needs an endpoint.
- **Landing.**
  - The app-preview image still shows prototype numbers.
  - Footer links (GitHub, X, Blockscout, contact) are placeholders.
