# Mainnet address sheet (deployments/4663.json)

Print this, or copy it into a shared sheet. It has one row for each of the 25 `TODO_VERIFY_ON_BLOCKSCOUT` entries in
`deployments/4663.json`: 21 in `external` and 4 in `roles`.

Rules (`docs/VERIFY_ON_CHAIN.md`):
- Take every address from the issuer's official page, then open it on https://robinhoodchain.blockscout.com.
  Never take one from a blog, Discord, a search snippet or an AI answer.
- Two people check each row on their own and sign it. Only then does the address go into the JSON, in a commit that
  names both checkers.
- If two checkers disagree, stop and find out why. Do not pick one.

## What to check

| Type | On Blockscout |
|---|---|
| Any contract | Verified source. The contract name matches what is expected. |
| Token | `symbol()` and `decimals()`. USDG is expected to have 6 decimals and stock tokens 18; write down what is true. |
| Stock token | Also `oraclePaused()` and `uiMultiplier()`. Above 1e18 is normal after dividends; the feed already includes it, so `useUiMultiplier` stays `false` (`docs/VERIFY_ON_CHAIN.md`). |
| Chainlink feed | `description()` names the right stock. Note `decimals()`, the heartbeat and the deviation threshold (DECISIONS #9). `latestRoundData()` is recent during market hours. |
| Uniswap | From Uniswap's official deployments page for this chain. A USDG/stock pool exists at the fee tier in `config/protocol.json`. |
| Safe and keys | The Safe is a contract with the signers in `config/protocol.json` (1-of-1 at launch, DECISIONS #6). Keys come from their owners, never from a chat. |

## Shared contracts

| # | Key | Must be | Official source | Address | Checker 1 (name, date) | Checker 2 (name, date) |
|---|---|---|---|---|---|---|
| 1 | `external.usdg.address` | Paxos USDG, 6 decimals | Paxos | | | |
| 2 | `external.uniswapV3SwapRouter02.address` | Uniswap SwapRouter02 | Uniswap deployments page | | | |
| 3 | `external.uniswapV3Factory.address` | Uniswap v3 factory | Uniswap deployments page | | | |
| 4 | `external.uniswapQuoterV2.address` | Uniswap QuoterV2 | Uniswap deployments page | | | |
| 5 | `external.sequencerUptimeFeed.address` | Chainlink L2 sequencer uptime feed. Zero only by DECISIONS #10. | Chainlink data feeds page | | | |

## Stock tokens and their feeds

Fill in `feedHeartbeatSec` from the feed's page. `useUiMultiplier` stays `false` and `checkOraclePaused` stays `true`.

| # | Key | Must be | Address | Heartbeat (s) | `uiMultiplier()` | Checker 1 | Checker 2 |
|---|---|---|---|---|---|---|---|
| 6 | `external.stocks.NVDAx.token` | NVIDIA stock token, wave 1, tier A | | — | | | |
| 7 | `external.stocks.NVDAx.chainlinkFeed` | NVDA / USD feed | | | — | | |
| 8 | `external.stocks.SPYx.token` | SPDR S&P 500 ETF stock token, wave 1, tier A | | — | | | |
| 9 | `external.stocks.SPYx.chainlinkFeed` | SPY / USD feed | | | — | | |
| 10 | `external.stocks.AAPLx.token` | Apple stock token, wave 1, tier A | | — | | | |
| 11 | `external.stocks.AAPLx.chainlinkFeed` | AAPL / USD feed | | | — | | |
| 12 | `external.stocks.QQQx.token` | Invesco QQQ stock token, wave 1, tier A | | — | | | |
| 13 | `external.stocks.QQQx.chainlinkFeed` | QQQ / USD feed | | | — | | |
| 14 | `external.stocks.MSFTx.token` | Microsoft stock token, wave 1, tier A | | — | | | |
| 15 | `external.stocks.MSFTx.chainlinkFeed` | MSFT / USD feed | | | — | | |
| 16 | `external.stocks.TSLAx.token` | Tesla stock token, wave 1, tier B | | — | | | |
| 17 | `external.stocks.TSLAx.chainlinkFeed` | TSLA / USD feed | | | — | | |
| 18 | `external.stocks.AMZNx.token` | Amazon stock token, wave 2, tier B | | — | | | |
| 19 | `external.stocks.AMZNx.chainlinkFeed` | AMZN / USD feed | | | — | | |
| 20 | `external.stocks.PLTRx.token` | Palantir stock token, wave 2, tier C | | — | | | |
| 21 | `external.stocks.PLTRx.chainlinkFeed` | PLTR / USD feed | | | — | | |

Source for every stock token: Robinhood's stock token docs. Source for every feed: Chainlink's data feeds page for
Robinhood Chain.

## Roles

| # | Key | Must be | Decided in | Address | Checker 1 | Checker 2 |
|---|---|---|---|---|---|---|
| 22 | `roles.multisig` | The Safe, with the threshold and owners in `config/protocol.json` (1-of-1 at launch). It becomes the timelock proposer and executor. `Deploy.s.sol` checks it. | DECISIONS #6 | | | |
| 23 | `roles.guardian` | Pause-only key or Safe, separate from the multisig | DECISIONS #6 | | | |
| 24 | `roles.attester` | The KYC provider's signing key, held in an HSM or KMS | DECISIONS #2 | | | |
| 25 | `roles.treasury` | Where the timelock sweeps fees | DECISIONS #13 | | | |

## Sign-off before `--broadcast`

- [ ] All 25 rows signed by two people.
- [ ] `forge script script/Deploy.s.sol --rpc-url robinhood --sender <deployer>` (dry run, no broadcast) prints what
      it read from each contract, and every line matches this sheet.
- [ ] The audit is done and its findings are fixed or accepted in writing (`docs/AUDIT_SCOPE.md`, DECISIONS #7).

Checked by: ______________________ Date: __________

Checked by: ______________________ Date: __________
