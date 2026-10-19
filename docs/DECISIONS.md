# Decisions ALFA must make before mainnet

Each one blocks a specific step. Write the answer here, with the date.

| # | Decision | Why it matters | Default in code |
|---|---|---|---|
| 1 | **Brand and domain**: is "Paritas" final? | Appears in contract names (EIP-712 domains "Paritas RFQ", "Paritas Eligibility") and in the vault share symbols (`pvNVDAx`). It must be fixed before deploy because EIP-712 names cannot change. | Paritas |
| 2 | **Legal eligibility**: who may use Paritas and which KYC or geofencing provider signs attestations? | Stock tokens are not for US persons. Mainnet deploy refuses to run without enforcement. | **2026-10-18, ALFA: no KYC.** Country check on the connection plus a signed "not a US person" declaration; Paritas runs the attester; 90-day attestations (`docs/ELIGIBILITY.md`). |
| 3 | **Licence** for our code (currently `UNLICENSED`) | Open-sourcing builds trust, keeping it closed protects the work. | UNLICENSED |
| 4 | **Seed liquidity per vault** and who provides it | Vault caps are 2.5M / 1M / 400k per tier. Without liquidity, routes fall back to Uniswap. | prototype TVLs used only on anvil |
| 5 | **Launch markets** (wave 1 / wave 2) | Wave 1 gets vaults at deploy. | NVDAx, SPYx, AAPLx, QQQx, MSFTx, TSLAx; wave 2 AMZNx, PLTRx |
| 6 | **Multisig signers** (3-of-5 Safe) and the **guardian** | The Safe owns everything through the 48h timelock. The guardian can only pause. | **2026-10-19, ALFA: one wallet.** The deployer wallet owns a 1-of-1 Safe that `deploy/mainnet.sh` creates (Safe v1.4.1 from Safe's official list); that Safe is owner, guardian and treasury. The script deletes the deployer key from the server after deployment. One key then controls Paritas behind the 48h timelock, so keep it safe; owners can be added and the threshold raised later in the Safe app, without redeploying (update `governance` in config to match). |
| 7 | **Audit firm and budget** | Required before mainnet. | **2026-10-18, ALFA: an internal review instead of an external audit before launch.** Done: `docs/SECURITY_REVIEW.md` (8 fixed, 2 open). An external audit is still recommended before the vault caps are raised. |
| 8 | **Market makers** for RFQ | Needed for orders of 25k USDG and up. | none |
| 9 | **Oracle**: Data Feeds versus Data Streams | A 10 bps tier-A spread is only safe if the price is fresher than the feed's deviation threshold. Check the real heartbeat and deviation for each feed on Robinhood Chain. If a feed's deviation is above about 0.1%, either widen tier A or add a Data Streams adapter. | Data Feeds, 1h max age |
| 10 | **Sequencer uptime feed**: if Chainlink does not publish one for Robinhood Chain | Without it, an outage cannot be detected on-chain. | required unless set to zero on purpose |
| 11 | **Sanctions**: may a blocked wallet still withdraw its own vault shares to itself? | Today yes (withdrawals always work). Some counsel prefer a freeze. | allowed, to itself only (it cannot transfer shares or withdraw to another wallet) |
| 12 | **Holiday calendar**: do stock tokens follow NYSE holidays exactly? | Vaults pause on holidays from `config/holidays.json`. | NYSE |
| 13 | **Fee destination**: treasury address for FeeCollector sweeps | | not set |
