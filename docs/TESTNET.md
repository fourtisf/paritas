# Testnet with test assets (paritas.live on chain 46630)

This puts the full app on Robinhood Chain testnet so people can use it before mainnet. The app shows the "Testnet" pill.

- **Test assets, not the real ones.** `DeployTestnet.s.sol` deploys its own USDG, stock tokens, Chainlink-style feeds
  and a fixed-rate stand-in for the Uniswap router. Anyone can mint the test tokens, and the app offers
  "Get 10,000 test USDG". None of it has value.
- **Real Paritas contracts.** The router, vaults, RFQ settlement, timelock and parameters are the same code and
  config as mainnet. Eligibility is not enforced, and the deployer wallet holds every role.
- **Live prices.** A keeper (`packages/shared/scripts/keeper-testnet.ts`) moves each test feed to the Finnhub
  reference price, the way a Chainlink feed updates: after a 0.15% move, or every 30 minutes. Without a Finnhub key
  the feeds go stale after 1 hour and the vaults pause, which is the same safety rule as mainnet.
- **This is not the mainnet rehearsal** in BRIEF section 9. That one runs `Deploy.s.sol` against the real testnet
  assets, after `deployments/46630.json` is filled from Blockscout (`docs/VERIFY_ON_CHAIN.md`).
- **Mainnet refuses all of this.** `parseDeployment` rejects `"mocks": true` for 4663, the faucet is never offered on
  4663, and `DeployTestnet.s.sol` and `SeedTestnet.s.sol` refuse every chain except 46630.

## Before you start

- The server is set up as in `docs/DEPLOY_VPS.md` and `https://paritas.live/api/prices` shows prices (Finnhub key set).
- Testnet ETH for gas. Use the Robinhood Chain testnet faucet linked from the official Robinhood Chain docs (not
  from a search result or a chat). About 0.1 ETH covers the deploy, the seed and weeks of keeper updates.

## Steps (from a root shell)

1. Update the code and create the testnet database. The mainnet database `paritas` is not touched.

   ```bash
   sudo -iu paritas git -C /home/paritas/paritas pull --ff-only
   cd /tmp && sudo -u postgres psql -c "CREATE DATABASE paritas_testnet OWNER paritas;"
   ```

2. Run the script. On the first run it creates a new wallet for the testnet only and prints its address.

   ```bash
   sudo -iu paritas bash /home/paritas/paritas/deploy/testnet.sh
   ```

3. Send testnet ETH to the printed address. Then run the same command again. It:
   - deploys the contracts with test assets (about 100 transactions, a few minutes)
   - switches the API, the indexer and the web build to chain 46630
   - starts the keeper (`paritas-keeper` in pm2)
   - seeds the six wave-1 vaults, when the New York session is open

4. If it says the session is Closed, run it again once the session opens. That is Sunday 20:00 New York time, which
   is Monday 07:00 in Jakarta until 1 November and 08:00 after. Every finished step is skipped.

## Check

```bash
sudo -iu paritas pm2 status                          # paritas-api, -indexer, -web, -keeper: online
sudo -iu paritas pm2 logs paritas-keeper --lines 20  # "NVDAx 182.40 -> 181.80 (moved 32 bps)"
curl -s https://paritas.live/api/markets | head -c 300   # 8 markets, "feedFresh": true
```

On https://paritas.live/app/trade:
1. Connect a wallet. It may ask to add Robinhood Chain testnet.
2. Press "Get 10,000 test USDG".
3. Press "Review swap", then "Confirm swap". You see "Swap settled" and the trade appears in Activity.

## What the script changes on the server

| File | Change |
|---|---|
| `deploy/keeper.env` | The testnet wallet's key and the RPC the keeper uses. Mode 600, never committed (`.gitignore`). |
| `deployments/46630.json` | The deployed addresses. Changed only on the server; a copy is kept in `/home/paritas/46630.deployed.json`. |
| `apps/api/.env` | `CHAIN_ID=46630`, the testnet `RPC_URL` and `DATABASE_URL` to `paritas_testnet`. The mainnet version is saved once as `apps/api/.env.mainnet-saved`. |
| `apps/web/.env.production.local` | `NEXT_PUBLIC_CHAIN_ID=46630` and the testnet RPC. The WalletConnect project id stays. |

Updates keep working as before: `sudo -iu paritas bash /home/paritas/paritas/deploy/vps.sh` keeps the testnet
settings and restarts the keeper.

## Safety

- The wallet in `deploy/keeper.env` is for the testnet only. Never send real ETH or mainnet funds to it, and never
  use it on mainnet.
- While the script runs `forge`, the key is on its command line, so root on this server can see it. That is fine for
  a testnet wallet and is one more reason never to reuse it.
- Do not run `git checkout` on `deployments/46630.json` on the server: it would drop the addresses. If
  `git pull` ever stops because of that file, restore it from `/home/paritas/46630.deployed.json` after the pull.

## Back to mainnet later

```bash
sudo -iu paritas bash -c 'cd ~/paritas && cp apps/api/.env.mainnet-saved apps/api/.env \
  && sed -i "/^NEXT_PUBLIC_CHAIN_ID=/d; /^NEXT_PUBLIC_RPC_URL=/d" apps/web/.env.production.local \
  && mv deploy/keeper.env ~/keeper.env.testnet && pm2 delete paritas-keeper'
sudo -iu paritas bash /home/paritas/paritas/deploy/vps.sh
```

## If something fails

- **"did not answer as chain 46630"**: the testnet RPC is down or has moved. Check the RPC URL in the Robinhood Chain
  docs, then run
  `sudo -iu paritas env ROBINHOOD_TESTNET_RPC_URL=<url> bash /home/paritas/paritas/deploy/testnet.sh`.
- **"The deployment did not finish"**: usually the wallet ran out of gas. Send more testnet ETH and run the script
  again. It starts over from the template; contracts from the stopped run are left unused.
- **"Vault paused" in the app**: the test feeds are older than 1 hour. Check `pm2 logs paritas-keeper` and
  `curl -s https://paritas.live/api/prices`.
