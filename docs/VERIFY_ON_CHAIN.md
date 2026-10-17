# How to fill deployments/<chainId>.json safely

Do this for every address. Two people check mainnet independently.

1. Get the address from the **issuer's official page**: Robinhood docs for stock tokens, Paxos for USDG, Chainlink's data feeds page for Robinhood Chain, Uniswap's deployments page.
   - Never take it from a blog, Discord, a search snippet or an AI answer.
2. Open it on the explorer:
   - https://robinhoodchain.blockscout.com/address/0x... for mainnet
   - https://explorer.testnet.chain.robinhood.com for testnet
3. Check:
   - The contract is **verified**.
   - The name matches.
   - For tokens: `symbol()` and `decimals()` match. USDG is expected to have 6 decimals; stock tokens 18 (record whatever is true).
   - For feeds: `description()` names the right stock, `decimals()` is noted, and `latestRoundData()` is recent during market hours. Note the heartbeat and deviation in the JSON (`feedHeartbeatSec`).
   - For stock tokens: call `oraclePaused()` and `uiMultiplier()` and write down what they return. If `uiMultiplier` is not 1e18 for any token, read Robinhood's docs and decide `useUiMultiplier` with Michael.
   - For Uniswap: the SwapRouter02 and QuoterV2 addresses come from the same official list, and a USDG/stock pool exists at the fee tier in `config/protocol.json`.
4. Paste the address and commit with a message naming who checked it.
5. Run the dry run: `forge script script/Deploy.s.sol --rpc-url robinhood --sender <deployer>`. It prints what it read from each contract. Compare every line with step 3 before adding `--broadcast`.
