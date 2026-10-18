# CLAUDE.md: Paritas

Read this file completely before you change anything. Then read `docs/BRIEF.md`.

## What this is

Paritas is a swap router for Robinhood Chain stock tokens (NVDAx, TSLAx, ...) paired with USDG.

- Every trade is routed across three venues:
  - Paritas vaults, which quote around the Chainlink price.
  - Uniswap pools.
  - Signed quotes from market makers (RFQ).
- The contract enforces a per-market price limit on every leg.
- Every trade emits an itemized receipt.

The product owner is ALFA (Fourtis.io), and Michael implements production. Code and code comments are in English. ALFA writes in Indonesian, so if you report to him, keep it short and in Indonesian.

## Repo map (what is real, what is a scaffold)

| Path | Status | Notes |
|---|---|---|
| `contracts/` | **Done and tested** | Foundry with 61 tests (unit, fuzz, shared vectors). Do not redesign. Extend with tests. |
| `config/protocol.json` | **Source of truth** | Every parameter. It is read by the deploy script, the API and the web app. |
| `config/holidays.json` | Source of truth | NYSE holidays and early closes as New York day indexes. |
| `deployments/<chainId>.json` | Templates | 4663 is mainnet and 46630 is testnet; both are full of `TODO_VERIFY_ON_BLOCKSCOUT`. 31337 is written by the local deploy. |
| `spec/` | Done | `generate_vectors.py` is an independent Python reference. `vectors/*.json` are checked by Solidity **and** TypeScript tests. |
| `packages/shared/` | **Done and tested** | ABIs, addresses, session clock, vault math (BigInt), route builder, receipt decoder, error copy. |
| `apps/api/` | Working | Fastify, Prisma, indexer and RFQ relay. `/quote` returns the route plus each venue's cost lines (the ladder). `/stats` feeds Markets. Sessions, candles and RFQ expiry use chain time (`chainNow()`). Still to build: APR, live `ParamController` check, `/quote` rate limits. |
| `apps/web/` | Ported | Platform (`/app/trade`, `markets`, `pool`, `portfolio`, `activity`, `governance`) and landing (`/`) ported 1:1 from `prototypes/`, on API + wagmi data. Platform CSS is `styles/platform.css` (verbatim), landing CSS is `styles/landing.css`. Addresses are read on the server (`lib/deployment.server.ts`). |
| `prototypes/` | **Visual spec** | Two single-file HTML prototypes. They are what ALFA approved. Match them. |
| `docs/screenshots/` | Visual spec | Every page at desktop (1440) and mobile (390). |

## Non-negotiable rules

1. **Never invent or guess an address.** Addresses only come from `deployments/<chainId>.json`, filled by a human from Blockscout. `getDeployment()` and `Deploy.s.sol` refuse TODOs on purpose. Do not "fix" that.
2. **One clock, one formula.** Trading logic uses `packages/shared/src/sessions.ts` and `quote.ts`, which mirror `SessionLib.sol` and `VaultMath.sol` line by line.
   - Never use `Intl`/`Date` time zones for logic; they are for display only.
   - Never use JS `number` for token amounts; always use `bigint`.
   - If you change a rule, change Solidity, TypeScript and `spec/generate_vectors.py` together, run `npm run vectors`, and make both test suites pass.
3. **Parameters live in `config/protocol.json`.** No magic numbers in components. On-chain values are changed only through the 48h timelock.
4. **Logic is keyed by token address, never by symbol.** Symbols are for URLs and display.
5. **Design:** premium black. Use the tokens in `apps/web/src/styles/tokens.css` and the components in the prototypes.
   - ALFA rejected colourful/holographic looks, black-and-gold, and white/light themes.
   - Do not add new colours, gradients or fonts.
   - Keep the 3D: the landing scene and the coin carousel.
6. **Copy:** plain English, short sentences, the same words as the prototypes ("Share price (Chainlink)", "Price limit", "Vault paused", "Market maker").
   - Contract errors map to `packages/shared/src/errors.ts`.
7. **Never remove a safety check to make something work**, including band, minimum out, eligibility, oracle staleness, sequencer or timelock. If a test fails, the code is wrong, not the test, unless you can show the test contradicts `docs/BRIEF.md`.
8. Stock tokens are **not for US persons**. Eligibility is enforced on mainnet. Do not add bypasses.

## Commands

```bash
# contracts (Foundry; solc 0.8.26, via-IR)
cd contracts && forge build && forge test            # 61 tests must pass
forge test --profile ci                              # 5000 fuzz runs

# local chain with the prototype's markets and prices
anvil --timestamp 1792504800                         # Tue 2026-10-20 10:00 New York: vaults open
cd contracts && forge script script/DeployLocal.s.sol --rpc-url local --broadcast   # writes deployments/31337.json

# shared TypeScript (from repo root)
npm install
npm test                                             # vectors + route tests
npm run smoke:local -w @paritas/shared               # TS math == chain, real swap through the router
npm run abi                                          # after any contract change: regenerate ABIs
npm run vectors                                      # after any rule change: regenerate spec vectors

# API + indexer (needs Postgres 16 + Redis 7; copy apps/api/.env.example to .env, which the dev scripts load)
npm run db:generate -w @paritas/api && npm run db:migrate -w @paritas/api
npm run api        # :4000
npm run indexer

# local market: keeps mock Chainlink feeds fresh (vaults go stale after 1h without it), moves prices and sends
# random trades through /quote -> SwapRouter from anvil #3-#7; plus an RFQ maker signing as anvil #2
npm run sim:local -w @paritas/shared                 # add -- --no-trades for prices only
npm run maker:local -w @paritas/shared               # needs RFQ_MAKER_KEYS=local-maker in apps/api/.env

# web (production builds read apps/web/.env.production: mainnet 4663, API at /api; see docs/MAINNET.md)
npm run web        # :3000, set apps/web/.env.local from .env.example. On 31337 "Local test wallet" (anvil #1) connects without a wallet app
```

## Definition of done for any change

- `forge test` passes, and `npm test` passes.
- `npm run typecheck` passes in every workspace.
- For UI work, compare with the matching screenshot in `docs/screenshots/` at 1440 and 390 widths:
  - no horizontal scroll at 390
  - no console errors
  - WebGL failure falls back to the poster (`.no-gl`)
- If you touched contracts, run `npm run abi` and commit the regenerated `packages/shared/src/abi.ts`.

## Order of work (what to do next)

1. Run everything above locally. The smoke test proves the stack.
2. ~~Port the **platform**~~ (done) (`prototypes/paritas-platform.html` to `apps/web/src/app/app/*`). Use real data:
   - API (`/markets`, `/quote`, `/fills`, `/session`, `/governance`)
   - wagmi (balances, allowances, vault shares)
   - `useSwap` for the trade flow
   - Field mapping: `docs/DEMO_TO_PRODUCTION.md`.
3. ~~Port the **landing**~~ (done) (`prototypes/paritas-landing.html` to `apps/web/src/app/page.tsx`) with `three/landing-scene.js`.
4. Testnet rehearsal: fill `deployments/46630.json`, run `Deploy.s.sol`, run the indexer and the app against it.
   Separately, paritas.live can run on testnet with test assets (`DeployTestnet.s.sol`, `deploy/testnet.sh`,
   `docs/TESTNET.md`); that is a public demo, not the rehearsal.
5. Mainnet only after the decisions in `docs/DECISIONS.md` are made by ALFA and an external audit is done. The config is ready and the launch steps are in `docs/MAINNET.md`.
