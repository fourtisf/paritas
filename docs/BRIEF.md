# Paritas build brief

## 1. Product

**"The best price on every stock token."** Paritas is a swap router for Robinhood Chain stock tokens against USDG.

- A trade can fill on three venues:
  - a **Paritas vault**: oracle-anchored liquidity per stock, quoting around the Chainlink price
  - a **Uniswap pool**
  - a **market maker**: a signed RFQ quote
- The router picks the best mix.
- On-chain checks:
  - every leg's all-in cost against the oracle is checked against a **price limit** (band)
  - the trade emits one **receipt**: a `RouteExecuted` event plus one `Fill` per leg
- Liquidity providers deposit into vaults and earn the spread.

Approved look and flow: `prototypes/` and `docs/screenshots/`.

## 2. Ground truth (verify, never hardcode)

| Item | Value | Where it is used |
|---|---|---|
| Robinhood Chain mainnet | chain id **4663**, RPC `https://rpc.mainnet.chain.robinhood.com`, explorer `https://robinhoodchain.blockscout.com` | `packages/shared/src/chain.ts` |
| Testnet | chain id **46630**, RPC `https://rpc.testnet.chain.robinhood.com`, explorer `https://explorer.testnet.chain.robinhood.com` | same |
| Stack | Arbitrum Nitro (Orbit). Mainnet live since 1 July 2026 | |
| Stock tokens | ERC-20 tokenized debt securities issued by Robinhood Assets (Jersey) Ltd. **Not offered to US persons.** Expose `oraclePaused()` and `uiMultiplier()` (verify semantics) | `IStockToken` in `contracts/src/interfaces/External.sol` |
| Quote asset | USDG (Paxos), assumed 6 decimals (verify) | `deployments/*.json` |
| Prices | Chainlink Data Feeds (Data Streams later through an adapter); L2 sequencer uptime feed if published | `OracleRouter` |
| Uniswap | v2, v3, v4 and UniswapX are deployed on Robinhood Chain. We use v3 SwapRouter02 (verify which router exists) | `UniswapV3Adapter` |

Every external address goes into `deployments/<chainId>.json` after someone opens it on Blockscout and checks:
- the contract name
- verified source
- symbol and decimals
- for feeds: description and decimals

`docs/VERIFY_ON_CHAIN.md` has the checklist.

## 3. Reference: Iridius

iridius.xyz is a similar product. We studied its public contracts (github.com/iridiusxyz/contracts: Foundry, Solidity 0.8.26, MIT). 123/123 tests pass, but at the time of review nothing was deployed and swapping was not possible.

Paritas is our own code. It closes Iridius' gaps:
- a real Uniswap leg
- real addresses
- a frontend wired to the contracts
- a weekend vault pause
- holiday calendar
- deposit pricing that cannot be farmed with a stale oracle

Do not copy Iridius code without keeping its MIT notice.

## 4. Contracts (`contracts/`, done)

| Contract | Role |
|---|---|
| `SwapRouter` | Only entry point for trades. Checks deadline, eligibility, pause and leg sums. Executes legs, checks the band per leg and `minAmountOut`, takes the protocol fee on the USDG side, and emits `Fill` and `RouteExecuted`. |
| `AnchorVault` | One per stock. ERC-20 LP shares. Quotes `price × (1 ± cost)`, where cost = half spread × session multiplier ∓ inventory skew, floored at 0. Router-only swaps. Deposits priced like a trade. Withdrawals in kind, always available. |
| `VaultFactory` | CREATE2 vault per listed stock. Router is set once. |
| `RfqSettlement` | EIP-712 maker quotes: allowlisted makers, taker-bound, single-use nonce, expiry, size 25k–2M USDG. The maker pays the 2 bps RFQ fee. |
| `UniswapV3Adapter` | Single-pool `exactInputSingle` via SwapRouter02. Its min out is 0 because the router checks band and minimum. |
| `OracleRouter` | Chainlink to USD WAD per token. Checks staleness, sequencer uptime and grace period, issuer `oraclePaused`, and optional `uiMultiplier`. |
| `SessionController` + `SessionLib` | New York clock with DST and holidays/early closes. Sessions: Regular, Extended, Overnight, Closed. |
| `ParamController` | All tunables with hard code bounds. Owner is the timelock. The guardian can only pause. |
| `EligibilityRegistry` | Attester-signed (KYC provider) eligibility with expiry, blocklist, exemptions. Enforced on mainnet. |
| `FeeCollector` | Receives all fees. Only the timelock sweeps. |
| `TimelockController` (OpenZeppelin) | 48h delay. The proposer and executor is the 3-of-5 Safe. |

### Parameters (`config/protocol.json`)

| Tier | Half spread | Max skew | Price limit | Largest vault order | Vault cap |
|---|---|---|---|---|---|
| A | 10 bps | 15 bps | 75 bps | 50,000 | 2.5M |
| B | 20 bps | 25 bps | 150 bps | 20,000 | 1M |
| C | 40 bps | 50 bps | 300 bps | 5,000 | 400k |

| Session (New York) | Hours | Spread | Clip | Band | Vault |
|---|---|---|---|---|---|
| Regular | Mon–Fri 09:30–16:00 (13:00 early close) | ×1.0 | ×1.0 | ×1.0 | open |
| Extended | 04:00–09:30, 16:00–20:00 | ×1.5 | ×0.75 | ×1.0 | open |
| Overnight | 20:00–04:00 before a trading day | ×2.0 | ×0.5 | ×1.0 | open |
| Closed | weekend (Fri 20:00 → Sun 20:00) and holidays | – | – | ×2.0 | **paused** |

Fees:
- protocol fee: 2 bps of the USDG side, on every venue
- RFQ fee: 2 bps, paid by the maker
- spread share: 10% of vault spread revenue

Oracle age limits:
- vault: 1h (verify feed heartbeats)
- band checks: 4 days, so Uniswap and RFQ work over long weekends

### Guarantees (each has a test)

1. **Never through the oracle.** The vault never sells below or buys above the oracle price. Covered by `testFuzz_VaultNeverTradesThroughOracle`.
2. **Band per leg.** Every leg's all-in cost (incl. protocol fee) is ≤ band × band multiplier. Covered by `test_BandEdge` and `test_RevertWhen_UniswapLegOutsideBand`.
3. **User minimum.** Output after fees is ≥ `minAmountOut`, else the whole transaction reverts.
4. **Router holds nothing** after a trade. Covered by `testFuzz_RouterKeepsNothing`.
5. **LPs never lose to trades at a constant price.** NAV per share is non-decreasing. Covered by `testFuzz_SwapsNeverLowerNavPerShare`.
6. **Withdrawals always work:** in kind, with no oracle, pause or session check. Covered by `test_WithdrawInKindWorksDuringPauseWeekendAndOracleOutage`.
7. **Vaults close safely.** They close on weekends and holidays, and on stale oracle, sequencer down, issuer price pause or guardian pause. Uniswap and RFQ keep routing when only the vault is closed.
8. **Governance is slow and bounded.**
   - Every change waits 48h in the timelock.
   - Hard bounds hold even for the timelock.
   - The guardian can pause but cannot unpause or move funds.
9. **RFQ quotes are safe to sign:** single-use, taker-bound, expiring, allowlisted makers, exact amounts.
10. **One source of math.** Solidity, TypeScript and the Python reference agree on 602 session vectors and 200 vault-quote vectors.

## 5. Backend (`apps/api/`, working skeleton)

Fastify 5 + Prisma 6 (PostgreSQL) + Redis. PM2 on the Hostinger VPS (`apps/api/ecosystem.config.cjs`), behind Nginx.

| Endpoint | Purpose | Status |
|---|---|---|
| `GET /session` | Session dial: name, copy, params, next change | done |
| `GET /markets` | Markets with oracle price, 24h change, vault TVL and inventory | done (24h change needs candles) |
| `GET /markets/:sym/candles?tf=1D\|1W\|1M` | Chart data | done (indexer samples candles) |
| `POST /quote` | Route plan and encoded `swapArgs` for `SwapRouter.swap` | **done** |
| `GET /fills`, `GET /fills/:id` | Tape and receipts (filters: symbol, venue, side, trader) | done |
| `GET /vaults` | Pool page list | basic |
| `GET /portfolio/:address` | Trade and vault history (live balances come from wagmi) | basic |
| `GET /governance` | Params, multisig, timelock operations | done |
| `WS /stream` | Live fills and session changes (Redis pub/sub from the indexer) | done |
| `WS /makers?key=` | RFQ relay for market makers. Replies are EIP-712-verified before use | done |

The indexer (`src/indexer.ts`) runs these streams:
- SwapRouter fills and routes
- vault Sync, Deposit and Withdraw
- Timelock operations
- Chainlink candle sampling

It is restart-safe: cursors are stored, and writes are upserts.

Still to build:
- read live `ParamController` values at startup and alert if they differ from `config/protocol.json`
- APR per vault, computed from Swap events (spread kept) over TVL
- rate limits on `/quote`

## 6. Frontend (`apps/web/`, scaffold)

Stack: Next.js 14 App Router, wagmi 2, viem, TanStack Query, three.js 0.160.

| Prototype (hash route) | Production route |
|---|---|
| landing page | `/` |
| `#/trade` | `/app/trade?m=NVDAx` |
| `#/markets` | `/app/markets` |
| `#/pool` | `/app/pool` |
| `#/portfolio` | `/app/portfolio` |
| `#/activity` | `/app/activity` |
| `#/governance` | `/app/governance` |
| Settings modal | the same modal. Its "Simulate a session" option is shown only in dev or testnet builds |

Ready pieces:
- `styles/tokens.css`
- `lib/wagmi.ts`
- `hooks/useSession.ts`, `hooks/useQuote.ts`, `hooks/useSwap.ts`
- `three/landing-scene.js` and `three/p3d.js`, extracted verbatim from the prototypes; wrap them with dispose functions
- `components/three/LandingCanvas.tsx`

3D requirements:
- Keep the landing scene: chrome guilloché core, coins facing the camera, scroll-driven poses with exposure dimming, and the bloom settings as in the prototype.
- Keep the Markets coin carousel (drag with inertia, click to open a market), the spinning coin in the trade header and the success burst.
- Fall back to the `.no-gl` poster when WebGL is missing.
- Respect `prefers-reduced-motion`.

## 7. Hosting

Hostinger VPS:
- Nginx terminates TLS and proxies `/` to Next (:3000) and `/api` and the websockets to Fastify (:4000).
- PM2 runs three processes: `paritas-web`, `paritas-api` and `paritas-indexer`.
- PostgreSQL 16 and Redis 7 run on the same box to start.
- Use an RPC provider with archive logs for the indexer backfill. The public RPC is fine for the app.

## 8. Environment

See `.env.example` (root, API, web). Secrets never go in the repo, and the deployer key goes in a Foundry keystore (`--account`), not in `.env`.

## 9. Acceptance criteria for mainnet

- All tests are green, including CI-profile fuzzing.
- External audit done, and findings fixed or accepted in writing by ALFA.
- A testnet rehearsal is complete: deploy, seed vaults, 100+ test trades across all venues and sessions, indexer and app in sync.
- `deployments/4663.json` is filled and double-checked by two people.
- Ownership is verified on Blockscout: every contract's owner is the timelock, the proposer is the Safe, the guardian is set.
- Eligibility provider live; attester key in an HSM or KMS.
- Holidays for the coming year are set on-chain.
- Runbook written for pause, unpause (through the timelock), maker removal and oracle incidents.
