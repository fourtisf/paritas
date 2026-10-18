/**
 * Testnet price keeper for DeployTestnet.s.sol deployments (chain 46630, "mocks": true). Every minute it reads the
 * API's reference prices (GET /prices, Finnhub) and moves each mock Chainlink feed, and the Uniswap stand-in's two
 * rates, to the live share price, the way a Chainlink feed updates: when the price has moved 0.15% or more, or
 * every 30 minutes as a heartbeat (vaults refuse prices older than one hour). Refuses any deployment without mocks.
 *
 *   KEEPER_PRIVATE_KEY=0x... npm run keeper:testnet -w @paritas/shared
 *
 * Use a wallet made only for testnet. Optional: RPC_URL (default: the testnet RPC), API_URL (default the local API).
 * Without a reference price for a market (no Finnhub key, Finnhub down) that feed is left alone and goes stale.
 */
import { createPublicClient, createWalletClient, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodTestnet } from "../src/chain";
import { getDeployment } from "../src/addresses";
import { MARKETS } from "../src/protocol";
import demo from "../../../config/local-demo.json";

const KEY = process.env.KEEPER_PRIVATE_KEY as Hex | undefined;
if (!KEY || !/^0x[0-9a-fA-F]{64}$/.test(KEY)) throw new Error("Set KEEPER_PRIVATE_KEY to the testnet keeper wallet's key (0x and 64 hex characters).");
const API = process.env.API_URL ?? "http://127.0.0.1:4000";
const RPC = process.env.RPC_URL ?? robinhoodTestnet.rpcUrls.default.http[0];
const TICK_MS = 60_000;
const DEVIATION_BPS = 15n;
const HEARTBEAT_S = 30n * 60n;

const dep = getDeployment(46630);
if (!dep.mocks) throw new Error('deployments/46630.json is not a DeployTestnet deployment (no "mocks": true). The keeper only moves mock feeds.');

const account = privateKeyToAccount(KEY);
const pub = createPublicClient({ chain: robinhoodTestnet, transport: http(RPC) });
const wallet = createWalletClient({ chain: robinhoodTestnet, transport: http(RPC), account });
const feedAbi = parseAbi(["function set(int256 a, uint256 t)", "function answer() view returns (int256)", "function updatedAt() view returns (uint256)"]);
const routerAbi = parseAbi(["function setRate(address tokenIn, address tokenOut, uint256 outPer1e18In)"]);
const markets = MARKETS.filter((m) => dep.stocks[m.symbol]).map((m) => ({
  ...m,
  ...dep.stocks[m.symbol],
  keep: 10_000n - BigInt((demo.uniswapCostBps as Record<string, number>)[m.tier]), // pool cost per tier, as on anvil
}));

async function send(args: { address: Hex; abi: any; functionName: string; args: readonly unknown[] }) {
  const hash = await wallet.writeContract({ chain: robinhoodTestnet, account, ...args } as any);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`transaction reverted: ${hash}`);
}

async function tick() {
  const r = await fetch(`${API}/prices`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`GET /prices answered ${r.status}`);
  const ref = new Map(((await r.json()) as { symbol: string; price: number | null }[]).map((p) => [p.symbol, p.price]));
  const now = (await pub.getBlock()).timestamp;
  for (const m of markets) {
    const p = ref.get(m.symbol);
    if (!p || p <= 0) continue;
    const next = BigInt(Math.round(p * 1e8)); // 8-decimal feed answer
    const [cur, at] = await Promise.all([
      pub.readContract({ address: m.chainlinkFeed, abi: feedAbi, functionName: "answer" }) as Promise<bigint>,
      pub.readContract({ address: m.chainlinkFeed, abi: feedAbi, functionName: "updatedAt" }) as Promise<bigint>,
    ]);
    const devBps = cur > 0n ? ((next > cur ? next - cur : cur - next) * 10_000n) / cur : 10_000n;
    if (devBps < DEVIATION_BPS && now - at < HEARTBEAT_S) continue;
    await send({ address: m.chainlinkFeed, abi: feedAbi, functionName: "set", args: [next, now] });
    await send({ address: dep.uniswapV3SwapRouter02, abi: routerAbi, functionName: "setRate", args: [dep.usdg, m.token, ((10n ** 38n / next) * m.keep) / 10_000n] });
    await send({ address: dep.uniswapV3SwapRouter02, abi: routerAbi, functionName: "setRate", args: [m.token, dep.usdg, (((next * 10n ** 6n) / 10n ** 8n) * m.keep) / 10_000n] });
    console.log(`${new Date().toISOString()} ${m.symbol} ${(Number(cur) / 1e8).toFixed(2)} -> ${p.toFixed(2)} (${devBps >= DEVIATION_BPS ? `moved ${devBps} bps` : "heartbeat"})`);
  }
}

console.log(`testnet keeper: ${markets.length} feeds, keeper ${account.address}, rpc ${RPC}, prices from ${API}/prices`);
for (;;) {
  await tick().catch((e) => console.error("keeper tick failed:", e?.shortMessage ?? e?.message ?? e));
  await new Promise((res) => setTimeout(res, TICK_MS));
}
