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
2. **External audit** done, with findings fixed or accepted in writing (ALFA).
3. **Fill `deployments/4663.json`** (two people, `docs/VERIFY_ON_CHAIN.md`):
   - `external` (26 TODOs)
   - `roles`: multisig = the Safe, guardian, attester, treasury.

   Never from an AI answer.
4. **Testnet rehearsal first** (Michael), BRIEF section 9:
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

## Gaps in the app to close before launch

- **Wallet verification flow.** Eligibility is enforced on mainnet. An unverified wallet sees "Wallet not verified for stock tokens", but there is no in-app flow to get verified. It needs the provider from decision #2 and an attester service that calls `EligibilityRegistry.attest`.
- **Spread APR.** Shows "–" until the API computes it from vault Swap events (30-day spread kept over average TVL).
- **API.** Still to build:
  - live `ParamController` check against `config/protocol.json`
  - rate limits on `/quote`
- **Portfolio "Value over time".** Today's holdings valued at past Chainlink prices; a real balance history needs an endpoint.
- **Landing.**
  - The app-preview image still shows prototype numbers.
  - Footer links (GitHub, X, Blockscout, contact) are placeholders.
