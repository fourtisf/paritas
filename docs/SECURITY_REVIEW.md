# Internal security review (2026-10-18)

No Critical or High issue was found. Eight findings were fixed in the contracts with regression tests. Two remain open:
F-4 (deposit plus withdraw as an unclipped trade) and F-10 (a frozen token blocks withdrawals of the other one).

**This is not an external audit.** Three independent reviewers and the author read the contracts in
`docs/AUDIT_SCOPE.md`. Each finding was traced to a concrete path and proven with a Foundry test before it was counted.
ALFA asked for this review in place of an external audit before launch (`docs/DECISIONS.md` #7). An external audit is
still recommended, most of all before the vault caps are raised.

- Tests: 73 contract tests pass (61 before, plus 12 in `test/Review.t.sol`), with 5,000 runs per fuzz test
  (`FOUNDRY_PROFILE=ci forge test`).
- The math is unchanged: `npm test` passes, and the smoke test (TypeScript quote equals the chain, real swap) passes.
- The sessions were ported to Python and compared with `zoneinfo` every 15 minutes from 2007 to 2100, plus every second
  around each DST switch: 3,262,230 points, 0 differences.

## Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| F-1 | Medium | Tokens sent straight to a vault counted as the next trade's input. A transfer above the clip blocked that direction of the vault; a smaller one went to whoever traded next with a 1-wei leg. | Fixed |
| F-2 | Medium | A stock split (a `uiMultiplier` change) was not detected on-chain. The vault could sell at half price, or buy at double, until governance acted 48h later. | Fixed |
| F-3 | Medium | A Uniswap pool that ran out of liquidity took part of a leg. The rest stayed in the adapter for good, and the receipt reported the full amount. | Fixed |
| F-4 | Medium | A deposit and a withdrawal in the same block act as a trade at the spread, with no clip, fee or skew. The vault's exposure to a lagging Chainlink price has no per-block limit. | Open: decision |
| F-5 | Low | The clip applied per leg, so one route could take six vault legs. | Fixed |
| F-6 | Low | Revoking an attester did not revoke what it signed, and an attestation could last forever. | Fixed |
| F-7 | Low | Feed decimals were cached when the feed was set. | Fixed |
| F-8 | Low | The mainnet deploy only checked that the multisig had code. | Fixed |
| F-9 | Low | A blocked wallet could move its vault shares, or withdraw to another wallet. | Fixed |
| F-10 | Low | If USDG or a stock token freezes the vault, neither token can be withdrawn. | Open: accepted for launch |
| F-11 | Info | Smaller items, listed below. | Documented |

### F-1 Tokens sent straight to a vault (fixed)

`AnchorVault.swap` priced `balance - reserve`, so anything sent to the vault outside `deposit` became part of the next
trade. Now the router passes the leg amount: `swap(buy, amountIn, to)`. The vault prices exactly that amount. Other
tokens stay outside the reserves and never reach a trade.

Tests: `test_TokensSentToTheVaultNeverReachATrade`, `test_UsdgSentToTheVaultDoesNotBlockBuys`.

### F-2 Stock splits (fixed)

`OracleRouter.setFeed` now records the token's `uiMultiplier()`. When the live value differs, `vaultPrice` reverts with
`MultiplierChanged`, so the vault stops quoting and taking deposits. Uniswap and RFQ legs keep routing inside the band.

Governance re-arms the vault with a timelock `setFeed` once the split is understood. For a planned split, queue that
call 48h ahead.

Tests: `test_SplitClosesTheVaultUntilGovernanceConfirms`, `test_RevertWhen_DepositAfterMultiplierChange`.

### F-3 Uniswap partial fills (fixed)

`UniswapV3Adapter` checks that the pool spent exactly `amountIn` and reverts with `PartialFill` otherwise. No input or
allowance stays in the adapter.

Tests: `test_RevertWhen_UniswapPoolTakesOnlyPartOfTheLeg`, `test_UniswapLegLeavesNoAllowance`.

### F-4 Deposit plus withdraw as a trade (open)

Deposits are priced like a trade: the depositor's stock at the bid, the vault's stock at the ask. Withdrawals pay out
in kind with no price at all. A deposit followed by a withdrawal in the same transaction is therefore a one-sided trade
at the spread, limited only by the room under the vault cap.

This matters when the Chainlink price lags the market by more than the spread. Example: overnight, a 1% feed update is
worth about $2,476 on a $1.2M round trip against the NVDA vault. Router trades carry the same exposure, but in clip-sized
pieces.

Whether this is acceptable depends on the real heartbeat and deviation of each feed (DECISIONS #9). Options:
- a per-block limit on vault notional that counts deposits too
- a short lock on newly minted shares
- Chainlink Data Streams

For launch: keep the vault caps low until this is decided. They are `tiers.*.capUsd` in `config/protocol.json` and are
read at deploy.

### F-5 One vault leg per route (fixed)

`SwapRouter.swap` reverts with `BadLegs` when a route has more than one vault leg. The route builder only ever makes one.

Test: `test_RevertWhen_RouteHasTwoVaultLegs`.

### F-6 Attestations (fixed)

- `EligibilityRegistry` stores who signed each wallet's attestation (`attesterOf`). `isEligible` requires that attester
  to still be approved, so the guardian's `revokeAttester` revokes everything it signed at once.
- An attestation can last at most `MAX_VALIDITY` (365 days). The API signs for 90 days.
- A new attestation from an approved attester replaces one from a revoked attester.

This matters because the wallet-verification key lives on the server (`docs/ELIGIBILITY.md`).

Tests: `test_RevokingAnAttesterRevokesItsAttestations`, `test_RevertWhen_AttestationLongerThanMaxValidity`,
`test_NewAttesterReplacesARevokedOne`.

### F-7 Feed decimals (fixed)

`OracleRouter.price` reads `decimals()` on every call, so a feed proxy moved to an aggregator with other decimals cannot
misprice by a power of ten.

Test: `test_FeedDecimalsAreReadLive`.

### F-8 Mainnet deploy checks (fixed)

On chain 4663, `Deploy.s.sol` now requires:
- the Safe's threshold and owner count to match `config/protocol.json` (3 of 5)
- a timelock delay of at least 48h
- the multisig, the guardian and the attester to differ from the deployer

`deploy/mainnet.sh` was tested end to end against a local chain posing as 4663. After it ran, every owner was the
timelock and the deployer held no role.

### F-9 Blocked wallets (fixed)

A blocked wallet can still withdraw its vault shares, but only to itself (DECISIONS #11). It can no longer transfer its
shares, or withdraw to another wallet.

Test: `test_BlockedWalletWithdrawsOnlyToItself`.

### F-10 A frozen token blocks withdrawals (open, accepted for launch)

`withdraw` pays both tokens in one call. If Paxos pauses USDG or freezes a vault, the stock in that vault cannot be
withdrawn either, and the same applies the other way round. The same freeze on the FeeCollector would stop every vault
swap that pays a spread share.

A pull-based withdrawal per token would fix it. This is left for a later version.

### F-11 Information

**Router and fees**
- On buys, the all-in cost can exceed the band by about 0.015 bps, because the fee is charged on the gross amount and
  the band on the net leg.
- Fees round down by at most 1 raw unit.
- The router and the FeeCollector are immutable in the vaults and the RFQ contract. If USDG blocklists either of them,
  trading stops until a redeploy, and LP funds would have to move to new vaults.
- `setVenue` does not check its target.

**Oracle and governance**
- `setFeed` and `setSequencerFeed` have no hard bounds. A malicious timelock proposal could set any price feed. LPs can
  exit during the 48h delay.
- The sequencer check sits in `price()`, so an outage stops Uniswap and RFQ legs too, for the outage plus 1h. This is
  covered by `test_SequencerDownBlocksTrading`.

**Eligibility and makers**
- `EligibilityRegistry` has its own guardian. When the guardian changes, rotate it there too.
- RFQ makers are not eligibility-checked. Use `removeMaker` (guardian) to stop one.
- `renounceOwnership` is inherited on every owned contract. The timelock must never call it.

**Calendar**
- `config/holidays.json` lists holidays through 2027. Set the 2028 dates on-chain before the end of 2027.

**Vault deposits**
- `previewDeposit` overstates the first deposit by 1,000 shares.
- A deposit in the vault's own ratio still pays half the spread.
- `deposit` and `withdraw` have no deadline.

## Checked and found sound

**Router**
- Leg sums match the input exactly.
- Output is measured by balance change.
- The fee is always taken on the USDG side, and `minAmountOut` is checked after fees.
- Eligibility is checked for both the trader and the recipient.
- Every contract has a reentrancy guard.
- A caller-chosen Uniswap fee tier can only pick a canonical pool.

**Vault**
- Rounding always favours the vault.
- The vault never trades through the oracle price.
- NAV per share never drops from swaps, deposits or withdrawals.
- First-deposit inflation is not possible: reserves are internal and the dead shares are permanent.
- The cap is checked on every deposit.

**RFQ**
- The EIP-712 types match the API.
- Quotes cannot be replayed across chains or contracts, and signatures are not malleable.
- Quotes are single use and bound to the taker.
- Expiry and size are checked, and the maker pays the fee.

**Oracle**
- Zero, negative or future answers revert.
- The sequencer feed is read correctly, including the grace period.
- The vault and band age limits are applied where intended.

**Governance and deploy**
- Every contract is owned by the timelock, and the timelock has no admin.
- The guardian can pause but never unpause.
- The parameter bounds hold in both directions.
- The router is set once.
