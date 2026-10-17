# Paritas

The best price on every Robinhood Chain stock token. Trades route across oracle-anchored Paritas vaults, Uniswap pools and market makers, with an on-chain price limit and a receipt for every fill.

**Start here:** `CLAUDE.md`, then `docs/BRIEF.md`.

```
contracts/          Foundry: 10 contracts, 61 tests (unit + fuzz + shared vectors), deploy scripts
packages/shared/    TypeScript used by API and web: ABIs, addresses, session clock, vault math, routing
apps/api/           Fastify + Prisma + Redis: /quote, /markets, /fills, /stats, indexer, RFQ relay
apps/web/           Next.js 14 + wagmi + three.js: landing and platform, ported from prototypes/
prototypes/         Approved single-file HTML prototypes (landing + platform): the visual spec
config/             protocol.json (all parameters), holidays.json, local-demo.json
deployments/        Addresses per chain. 4663/46630 are TODO templates; fill only from Blockscout
spec/               Independent Python reference + test vectors shared by Solidity and TypeScript
docs/               Brief, decisions, design system, data mapping, verification checklist, screenshots
```

Quick proof that everything works (about two minutes):

```bash
npm install
cd contracts && forge test && cd ..
anvil --timestamp 1792504800 &
(cd contracts && forge script script/DeployLocal.s.sol --rpc-url local --broadcast)
npm test && npm run smoke:local -w @paritas/shared
```

Run the whole app locally (Postgres and Redis running, `apps/api/.env` and `apps/web/.env.local` copied from the examples, `RFQ_MAKER_KEYS=local-maker` in `apps/api/.env`):

```bash
npm run db:migrate -w @paritas/api
npm run api & npm run indexer &
npm run maker:local -w @paritas/shared & npm run sim:local -w @paritas/shared &
npm run web        # http://localhost:3000, connect "Local test wallet"
```
