# Demo data → production data

The prototypes run on invented data (`MARKETS`, `SERIES`, `fills`, `state.bal`, `START_POS`, `GOV_LOG` in `prototypes/paritas-platform.html`). Every one of those is replaced as below. Remove the "Demo data" pill only when nothing on the page reads demo data.

| Prototype | Production source | Notes |
|---|---|---|
| `MARKETS[].sym/name/tier` | `config/protocol.json` markets (via `@paritas/shared` `MARKETS`) | Symbols are for display only. Use the token address from `deployments/<id>.json`. |
| `MARKETS[].mid` | `GET /markets` `.mid` (OracleRouter price) | Labelled "Share price (Chainlink)". |
| `MARKETS[].chg` | `GET /markets` `.chg` (from candles) | |
| `MARKETS[].tvl`, `.inv` | `GET /markets` `.vault.tvlUsd`, `.vault.tokenShareBps` | `inv` was a token share in bps, e.g. 5180 = 51.8% stock. |
| `MARKETS[].skew` | not stored | Inventory adjustment = `-skewBps × imbalance`. Show the `costWad` from the quote minus the spread. |
| `MARKETS[].depth`, `poolFee` | Uniswap QuoterV2 through `/quote` | The pool fee comes from `uniswapPoolFee` in config. |
| `MARKETS[].open` | `deployments.paritas.vaults[sym]` exists (wave 1) | "Second wave" when there is no vault. |
| `MARKETS[].apr` | API (to build): 30-day spread kept ÷ average TVL | Show "–" until there are 7 days of data. |
| `SERIES` | `GET /markets/:sym/candles?tf=` | |
| `TIERS`, `FEE`, `RFQ_MIN/MAX` | `TIERS`, `PROTOCOL.fees`, `PROTOCOL.rfq` from `@paritas/shared` | Same numbers. |
| `SESS` / `regimeAt()` | `useSession()` (`sessions.ts`) | The prototype used `Intl`. Production uses the contract's clock. The `weekend` key becomes `closed`, with the label "Weekend" or "Market holiday". |
| `quote()` | `useQuote()` → `POST /quote` | Lines per venue: vault = Spread, Inventory adjustment, Protocol fee. Pool = Pool fee + price impact (from QuoterV2 versus oracle) + Protocol fee. Maker = maker spread + Protocol fee. |
| `fills` / `makeFill()` | `GET /fills` + `WS /stream` | A route can have several legs: show the main venue chip and list the legs in the receipt modal. |
| fill receipt modal | `GET /fills/:id` or `decodeRouteLogs()` right after a swap | `cost` = `costBps` (already includes the protocol fee). |
| `state.connected/addr` | wagmi `useAccount` | |
| `state.bal` | wagmi `useBalance` / `erc20.balanceOf` | |
| `state.approvals` | `erc20.allowance` | |
| `state.pos` (vault positions) | `vault.balanceOf(user)` × `previewWithdraw` + `GET /portfolio` flows | Fees earned = current value − net deposited value. |
| `runFlow()` steps | `useSwap().steps` | Approve, then Confirm swap, then Settling on Robinhood Chain. |
| deposit flow | `AnchorVault.deposit(usd, stock, minShares, receiver)` | Show "Shares are minted at the Chainlink price, less the vault spread". Deposits are priced like a trade. |
| withdraw flow | `AnchorVault.withdraw(shares, minUsd, minStock, receiver)` | In kind. "Works even during a halt" is true. |
| `GOV_LOG` | `GET /governance` `.ops` | Add human titles in the API. |
| block numbers / tx hashes | real receipts | Link with `explorerTx()`. |
| Settings "Simulate a session" | dev and testnet only | Hide it on mainnet. |
