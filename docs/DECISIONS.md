# Decisions ALFA must make before mainnet

Each one blocks a specific step. Write the answer here, with the date.

| # | Decision | Why it matters | Default in code |
|---|---|---|---|
| 1 | **Brand and domain**: is "Paritas" final? | Appears in contract names (EIP-712 domains "Paritas RFQ", "Paritas Eligibility") and in the vault share symbols (`pvNVDAx`). It must be fixed before deploy because EIP-712 names cannot change. | Paritas |
| 2 | **Legal eligibility**: who may use Paritas and which KYC or geofencing provider signs attestations? | Stock tokens are not for US persons. Mainnet deploy refuses to run without enforcement. | enforced on mainnet, 90-day attestations |
| 3 | **Licence** for our code (currently `UNLICENSED`) | Open-sourcing builds trust, keeping it closed protects the work. | UNLICENSED |
| 4 | **Seed liquidity per vault** and who provides it | Vault caps are 2.5M / 1M / 400k per tier. Without liquidity, routes fall back to Uniswap. | prototype TVLs used only on anvil |
| 5 | **Launch markets** (wave 1 / wave 2) | Wave 1 gets vaults at deploy. | NVDAx, SPYx, AAPLx, QQQx, MSFTx, TSLAx; wave 2 AMZNx, PLTRx |
| 6 | **Multisig signers** (3-of-5 Safe) and the **guardian** | The Safe owns everything through the 48h timelock. The guardian can only pause. | not set |
| 7 | **Audit firm and budget** | Required before mainnet. | — |
| 8 | **Market makers** for RFQ | Needed for orders of 25k USDG and up. | none |
| 9 | **Oracle**: Data Feeds versus Data Streams | A 10 bps tier-A spread is only safe if the price is fresher than the feed's deviation threshold. Check the real heartbeat and deviation for each feed on Robinhood Chain. If a feed's deviation is above about 0.1%, either widen tier A or add a Data Streams adapter. | Data Feeds, 1h max age |
| 10 | **Sequencer uptime feed**: if Chainlink does not publish one for Robinhood Chain | Without it, an outage cannot be detected on-chain. | required unless set to zero on purpose |
| 11 | **Sanctions**: may a blocked wallet still withdraw its own vault shares to itself? | Today yes (withdrawals always work). Some counsel prefer a freeze. | allowed |
| 12 | **Holiday calendar**: do stock tokens follow NYSE holidays exactly? | Vaults pause on holidays from `config/holidays.json`. | NYSE |
| 13 | **Fee destination**: treasury address for FeeCollector sweeps | | not set |
