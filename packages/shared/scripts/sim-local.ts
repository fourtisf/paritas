/**
 * Local market simulator for anvil (chain 31337 only). Keeps the stack alive the way mainnet would be:
 *   - moves each mock Chainlink feed a little every tick and refreshes its updatedAt, so vaults never go stale
 *     (vault oracle limit is 1h) and the indexer has candles to draw
 *   - keeps the mock Uniswap router at the same cost against the new price (config/local-demo.json)
 *   - sends random trades from anvil accounts #3-#7 through the real API /quote -> SwapRouter.swap path,
 *     so the tape, receipts, volume charts and vault inventory all move
 *
 *   npm run sim:local -w @paritas/shared            # needs anvil + DeployLocal; trades also need the API on :4000
 *   npm run sim:local -w @paritas/shared -- --no-trades
 *
 * Uses anvil's unlocked default accounts over JSON-RPC (eth_sendTransaction), so no keys live here.
 * Prices only move while the chain's New York session is open, like real stock feeds.
 */
import { createPublicClient, createWalletClient, http, erc20Abi, maxUint256, parseAbi, parseUnits, type Hex } from "viem";
import { localAnvil } from "../src/chain";
import { loadLocalDeployment } from "../src/addresses";
import { swapRouterAbi } from "../src/abi";
import { MARKETS } from "../src/protocol";
import { sessionAt } from "../src/sessions";
import demo from "../../../config/local-demo.json";

const API = process.env.API_URL ?? "http://localhost:4000";
const TRADES = !process.argv.includes("--no-trades");
const TICK_MS = 10_000;

const dep = await loadLocalDeployment();
const pub = createPublicClient({ chain: localAnvil, transport: http() });
const accounts = await createWalletClient({ chain: localAnvil, transport: http() }).getAddresses();
const keeper = createWalletClient({ chain: localAnvil, transport: http(), account: accounts[0] });
const traders = accounts.slice(3, 8);

const feedAbi = parseAbi(["function set(int256 a, uint256 t)", "function answer() view returns (int256)"]);
const routerAbi = parseAbi(["function setRate(address tokenIn, address tokenOut, uint256 outPer1e18In)"]);
const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const send = async (w: ReturnType<typeof createWalletClient>, args: any) => pub.waitForTransactionReceipt({ hash: await w.writeContract({ chain: localAnvil, account: w.account!, ...args }) });

const markets = MARKETS.filter((m) => dep.stocks[m.symbol]).map((m) => ({ ...m, ...dep.stocks[m.symbol], cost: (demo.uniswapCostBps as Record<string, number>)[m.tier] }));
const price8 = new Map<string, bigint>();
for (const m of markets) price8.set(m.symbol, (await pub.readContract({ address: m.chainlinkFeed, abi: feedAbi, functionName: "answer" })) as bigint);

async function tickPrices() {
  const block = await pub.getBlock();
  if (sessionAt(Number(block.timestamp)) === "closed") return false;
  for (const m of markets) {
    const p = price8.get(m.symbol)!;
    const next = (p * BigInt(Math.round(1e6 + (Math.random() - 0.5) * 1100))) / 1_000_000n; // about ±0.055% per tick
    price8.set(m.symbol, next);
    await send(keeper, { address: m.chainlinkFeed, abi: feedAbi, functionName: "set", args: [next, block.timestamp] });
    const keep = BigInt(10_000 - m.cost);
    await send(keeper, { address: dep.uniswapV3SwapRouter02, abi: routerAbi, functionName: "setRate", args: [dep.usdg, m.token, ((10n ** 38n / next) * keep) / 10_000n] });
    await send(keeper, { address: dep.uniswapV3SwapRouter02, abi: routerAbi, functionName: "setRate", args: [m.token, dep.usdg, (((next * 10n ** 6n) / 10n ** 8n) * keep) / 10_000n] });
  }
  return true;
}

async function fund() {
  for (const t of traders) {
    const w = createWalletClient({ chain: localAnvil, transport: http(), account: t });
    await send(keeper, { address: dep.usdg, abi: mintAbi, functionName: "mint", args: [t, parseUnits("5000000", 6)] });
    await send(w, { address: dep.usdg, abi: erc20Abi, functionName: "approve", args: [dep.paritas.swapRouter, maxUint256] });
    for (const m of markets) {
      await send(keeper, { address: m.token, abi: mintAbi, functionName: "mint", args: [t, parseUnits("5000", 18)] });
      await send(w, { address: m.token, abi: erc20Abi, functionName: "approve", args: [dep.paritas.swapRouter, maxUint256] });
    }
  }
}

/** Order sizes shaped like the prototype's tape: mostly retail, some larger, a few maker-sized. */
function size() {
  const r = Math.random();
  return r < 0.66 ? 250 + Math.random() ** 2.1 * 24_000 : r < 0.93 ? 2_000 + Math.random() ** 1.6 * 38_000 : 25_000 + Math.random() ** 2 * 140_000;
}

async function trade() {
  const m = markets[Math.floor(Math.random() * markets.length)];
  const trader = traders[Math.floor(Math.random() * traders.length)];
  const buy = Math.random() < 0.54;
  const usd = size();
  const mid = Number(price8.get(m.symbol)!) / 1e8;
  const amount = buy ? usd.toFixed(2) : (usd / mid).toFixed(6);
  const r = await fetch(`${API}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: m.symbol, side: buy ? "buy" : "sell", amount, trader, slippageBps: 50 }) });
  if (!r.ok) return console.log(`quote failed ${r.status}: ${await r.text()}`);
  const q = await r.json();
  if (!q.ok || !q.swapArgs) return console.log(`${m.symbol} ${buy ? "buy" : "sell"} ${usd.toFixed(0)} USDG: no route`);
  const a = q.swapArgs;
  const block = await pub.getBlock();
  const w = createWalletClient({ chain: localAnvil, transport: http(), account: trader });
  const rc = await send(w, {
    address: dep.paritas.swapRouter,
    abi: swapRouterAbi,
    functionName: "swap",
    args: [{ stock: a.stock, buy: a.buy, amountIn: BigInt(a.amountIn), minAmountOut: BigInt(a.minAmountOut), recipient: a.recipient, deadline: block.timestamp + 600n, legs: a.legs.map((l: any) => ({ venue: l.venue, amountIn: BigInt(l.amountIn), data: l.data })) }],
  }).catch((e) => ({ status: `reverted: ${String(e.shortMessage ?? e).slice(0, 120)}` }));
  console.log(`${m.symbol} ${buy ? "buy " : "sell"} ${usd.toFixed(0).padStart(7)} USDG via ${q.legs.map((l: any) => l.venue).join("+")}: ${rc.status}`);
}

if (TRADES) {
  console.log(`funding ${traders.length} sim traders...`);
  await fund();
}
console.log(`sim running: prices every ${TICK_MS / 1000}s${TRADES ? ", trades every 6-16s" : ""}. Ctrl-C to stop.`);
let nextTrade = Date.now();
for (;;) {
  const moved = await tickPrices().catch((e) => (console.error("price tick failed", e.shortMessage ?? e), false));
  if (TRADES && moved && Date.now() >= nextTrade) {
    await trade().catch((e) => console.error("trade failed", e.shortMessage ?? e));
    nextTrade = Date.now() + 6_000 + Math.random() * 10_000;
  }
  await new Promise((r) => setTimeout(r, TICK_MS));
}
