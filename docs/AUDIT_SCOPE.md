# Paritas smart contracts: audit scope

For audit firms quoting or running the security review that must happen before mainnet (BRIEF section 9,
DECISIONS #7). Product owner: ALFA, Fourtis.io.

## What Paritas is

Paritas is a swap router for Robinhood Chain stock tokens (NVDAx, TSLAx, ...) paired with USDG. One transaction can
split a trade across three venues:

- Paritas vaults, which quote around the Chainlink price
- Uniswap v3 pools
- EIP-712 quotes signed by allowlisted market makers (RFQ)

The router enforces a per-market price limit (the "band") on every leg and the user's minimum output on the total,
then emits an itemized receipt (`Fill` per leg, `RouteExecuted` per trade).

The chain is Robinhood Chain mainnet (chain id 4663), an Arbitrum Nitro / Orbit chain.

## Code

- Repository: `github.com/fourtisf/paritas`, folder `contracts/`. Access is granted on request.
- Quote on the latest commit of branch `claude/new-session-pc95l7`. The audited commit is tagged when the scope freezes.
- Foundry with solc 0.8.26, via-IR, optimizer 200 runs, EVM `cancun`. Dependencies are vendored in
  `contracts/dependencies`: OpenZeppelin Contracts 5.2.0 and forge-std 1.9.7.

### In scope

Lines are non-blank, non-comment lines.

| File | Lines | Purpose |
|---|---:|---|
| `src/AnchorVault.sol` | 235 | One vault per stock. ERC-20 LP shares. Quotes `price × (1 ± cost)` with session multipliers and inventory skew. Router-only swaps, deposits priced like a trade, withdrawals in kind. |
| `src/SwapRouter.sol` | 197 | The only entry point for trades. Deadline, eligibility, pause, leg sums, band per leg, `minAmountOut`, protocol fee on the USDG side, receipt events. |
| `src/ParamController.sol` | 145 | Every tunable with hard bounds in code. Owner is the timelock; the guardian can only pause. |
| `src/RfqSettlement.sol` | 125 | EIP-712 maker quotes: allowlisted makers, bound to the taker, single-use nonce, expiry, size limits, maker-paid fee. |
| `src/libraries/VaultMath.sol` | 84 | Vault quote, NAV and share math (WAD). |
| `src/EligibilityRegistry.sol` | 81 | Attester-signed eligibility with expiry, blocklist and exemptions. Enforced on mainnet. |
| `src/OracleRouter.sol` | 71 | Chainlink to USD WAD per token: staleness, sequencer uptime and grace period, issuer `oraclePaused`, optional `uiMultiplier`. |
| `src/VaultFactory.sol` | 60 | CREATE2 vault per listed stock; the router is set once. |
| `src/libraries/Types.sol` | 59 | Shared structs and enums. |
| `src/libraries/SessionLib.sol` | 50 | New York clock: DST, holidays, early closes, the four sessions. |
| `src/SessionController.sol` | 43 | On-chain holiday calendar and the current session. |
| `src/libraries/Errors.sol` | 36 | Custom errors. |
| `src/adapters/UniswapV3Adapter.sol` | 34 | Single-pool `exactInputSingle` through SwapRouter02. |
| `src/interfaces/External.sol` | 29 | Chainlink, stock token and Uniswap interfaces. |
| `src/FeeCollector.sol` | 15 | Receives fees; only the timelock sweeps. |
| `script/DeployCore.sol` | 156 | Deploys and wires everything, hands ownership to the timelock. |
| `script/Deploy.s.sol` | 117 | Mainnet entry: refuses TODO addresses, requires the Safe to be a contract and eligibility to be enforced. |
| **Total** | **1,537** | 1,264 in `src/`, 273 in the deploy scripts. |

OpenZeppelin `TimelockController` (48h delay) is deployed unmodified. The way Paritas uses it is in scope.

### Out of scope

- `src/mocks/Mocks.sol` and `test/` (test-only code)
- `script/DeployLocal.s.sol`, `script/DeployTestnet.s.sol` and `script/SeedTestnet.s.sol`, which deploy test assets
  and refuse mainnet
- the off-chain code (`apps/api`, `apps/web`, `packages/shared`)
- OpenZeppelin, Chainlink, Uniswap, USDG and the stock token contracts themselves. Our assumptions about them are
  in scope (see below).

## Roles and trust

| Role | Who | Can |
|---|---|---|
| Timelock (48h) | OpenZeppelin `TimelockController`. The proposer and executor is a 3-of-5 Safe. | Own every contract: change parameters inside the hard bounds, list markets, add or remove makers, set holidays, unpause, sweep fees. |
| Guardian | A separate key or Safe | Pause only. Cannot unpause or move funds. |
| Attester | KYC provider key (HSM or KMS) | Sign eligibility attestations with an expiry. |
| Makers | Allowlisted addresses | Sign RFQ quotes. |
| Deployer | One-time key | Nothing after deployment; every privilege moves to the timelock. |

## Guarantees we ask you to break

Each guarantee has a test today. Fuzz tests run 512 times by default and 5000 times with `--profile ci`.

1. **Never through the oracle.** A vault never sells below or buys above the oracle price (`testFuzz_VaultNeverTradesThroughOracle`).
2. **Band per leg.** Each leg's all-in cost, protocol fee included, stays within band × session band multiplier (`test_BandEdge`, `test_RevertWhen_UniswapLegOutsideBand`).
3. **User minimum.** The output after fees is at least `minAmountOut`, or the whole transaction reverts.
4. **The router holds nothing** after a trade (`testFuzz_RouterKeepsNothing`).
5. **LPs never lose to trades at a constant price.** NAV per share never goes down (`testFuzz_SwapsNeverLowerNavPerShare`), and vault reserves match its balances (`testFuzz_ReservesMatchBalances`).
6. **Withdrawals always work**: in kind, with no oracle, pause or session check (`test_WithdrawInKindWorksDuringPauseWeekendAndOracleOutage`).
7. **Vaults close safely**:
   - They close on weekends and holidays, and on a stale oracle, a sequencer outage, an issuer price pause or a guardian pause.
   - Uniswap and RFQ keep routing when only the vault is closed.
8. **Governance is slow and bounded.** Every change waits 48h. Hard bounds hold even against the timelock. The guardian can pause but cannot unpause.
9. **RFQ quotes are safe to sign**: single use, bound to the taker, expiring, allowlisted makers only, exact amounts.
10. **One source of math.** Solidity, TypeScript and an independent Python reference (`spec/generate_vectors.py`) agree on 602 session vectors and 200 vault-quote vectors (`test/Vectors.t.sol`).

## Where we want the most attention

- **Vault math**:
  - the rounding direction in every quote, deposit and withdrawal
  - the sign of the inventory skew and its floor at 0
  - first-deposit and share inflation (`MIN_LIQUIDITY` dead shares)
  - deposits near the vault cap
- **Router**:
  - leg-sum checks and the band applied per leg
  - fee accounting on the USDG side, for buys and sells
  - reentrancy across venues, and allowances left behind with the adapter or vaults
- **RFQ**:
  - the EIP-712 domain, replay across chains and contracts
  - nonce cancellation and maker removal
  - size limits and the maker-paid fee
- **Oracle**:
  - decimals normalization, negative or zero answers, round completeness
  - the sequencer grace period
  - `oraclePaused`, and `uiMultiplier` after stock splits
  - the two age limits: 1h for vaults, 4 days for band checks on Uniswap and RFQ legs
- **Sessions**: DST changes, holidays and early closes. Also the effect of `block.timestamp` on an Arbitrum-based chain.
- **Token assumptions**:
  - USDG has 6 decimals and stock tokens have 18
  - no fee-on-transfer or rebasing tokens
  - what happens when a stock token blocks or pauses transfers, for swaps and for withdrawals
- **Deployment**: that `DeployCore` leaves the deployer with no privilege, and that every owner is the timelock.

## Known design choices (not findings)

- Withdrawals ignore pause, session and oracle on purpose (guarantee 6). A blocked wallet can still withdraw its own
  shares to itself (DECISIONS #11, open).
- The Uniswap adapter passes a minimum out of 0 because the router checks the band and the user minimum after the leg.
- Band checks accept prices up to 4 days old, so Uniswap and RFQ keep working over long weekends. Vaults need prices
  younger than 1 hour.
- Open decisions that may change code before the freeze:
  - DECISIONS #1: EIP-712 names
  - DECISIONS #9: Data Feeds or Data Streams
  - DECISIONS #10: no sequencer feed

## Build and test

```bash
cd contracts
forge build
forge test                 # 61 tests: unit, fuzz, invariants, shared vectors
forge test --profile ci    # 5000 fuzz runs
cd .. && npm run vectors   # regenerates spec/vectors/*.json from the Python reference
```

Supporting documents in the repo:
- `docs/BRIEF.md`: product, parameters, guarantees, mainnet acceptance criteria
- `config/protocol.json`: every parameter
- `docs/DECISIONS.md`: open owner decisions
- `docs/VERIFY_ON_CHAIN.md`: how external addresses are checked

## What we ask for

- A report with severities, a proof of concept or a failing test for each finding where possible, and the commit reviewed.
- One fix-review round on our patches.
- Your estimate of effort, calendar time and price for the scope above, and your earliest start date.
