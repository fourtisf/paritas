/**
 * A local RFQ market maker for anvil (chain 31337 only), so the "Market maker" venue quotes in the app.
 * It connects to the API's maker relay, prices every request around the Chainlink price and signs it as anvil
 * account #2, which DeployLocal.s.sol allowlists in RfqSettlement and funds with USDG and stock tokens.
 *
 *   # apps/api/.env: RFQ_MAKER_KEYS=local-maker
 *   npm run maker:local -w @paritas/shared
 *
 * Signs with eth_signTypedData_v4 on anvil's unlocked account, so no key lives here. Never point this at a real chain.
 */
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { localAnvil } from "../src/chain";
import { loadLocalDeployment } from "../src/addresses";
import { oracleRouterAbi } from "../src/abi";
import { PROTOCOL } from "../src/protocol";
import { sessionAt, type SessionName } from "../src/sessions";

const WS = (process.env.API_URL ?? "http://localhost:4000").replace(/^http/, "ws") + "/makers?key=" + (process.env.MAKER_KEY ?? "local-maker");
// This maker's own spread by session, in bps (a stand-in for a real desk; wider when the stock market is shut).
const SPREAD: Record<SessionName, number> = { regular: 6, extended: 9, overnight: 14, closed: 22 };

const dep = await loadLocalDeployment();
const pub = createPublicClient({ chain: localAnvil, transport: http() });
const maker = (await createWalletClient({ chain: localAnvil, transport: http() }).getAddresses())[2];
const wallet = createWalletClient({ chain: localAnvil, transport: http(), account: maker });
const TYPES = {
  RfqQuote: [
    { name: "maker", type: "address" },
    { name: "taker", type: "address" },
    { name: "stock", type: "address" },
    { name: "takerBuys", type: "bool" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOut", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

async function answer(req: any) {
  const [priceWad] = await pub.readContract({ address: dep.paritas.oracleRouter, abi: oracleRouterAbi, functionName: "price", args: [req.stock] });
  const block = await pub.getBlock();
  const amountIn = BigInt(req.amountIn);
  const usdSide = req.takerBuys ? Number(amountIn) / 1e6 : (Number(amountIn) / 1e18) * (Number(priceWad) / 1e18);
  const bps = BigInt(SPREAD[sessionAt(Number(block.timestamp))] + (usdSide > 500_000 ? 4 : 0));
  const amountOut = req.takerBuys
    ? (amountIn * 10n ** 12n * 10n ** 18n * 10_000n) / (priceWad * (10_000n + bps))
    : (amountIn * priceWad * (10_000n - bps)) / 10_000n / 10n ** 18n / 10n ** 12n;
  const expiry = BigInt(Math.min(Number(block.timestamp) + PROTOCOL.rfq.quoteTtlSec, Number(req.expiresBefore) - 1));
  const quote = { maker, taker: req.taker as Hex, stock: req.stock as Hex, takerBuys: !!req.takerBuys, amountIn, amountOut, nonce: BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)), expiry };
  const signature = await wallet.signTypedData({
    account: maker,
    domain: { name: "Paritas RFQ", version: "1", chainId: 31337, verifyingContract: req.settlement },
    types: TYPES,
    primaryType: "RfqQuote",
    message: quote,
  });
  const json = Object.fromEntries(Object.entries(quote).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
  return { type: "quote", id: req.id, quote: json, signature };
}

function connect() {
  const ws = new WebSocket(WS);
  ws.onopen = () => console.log(`maker ${maker} connected to ${WS.replace(/key=.*/, "key=…")}`);
  ws.onmessage = async (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.type === "error") return console.error("relay:", msg.error);
    if (msg.type !== "rfq" || msg.chainId !== 31337) return;
    try {
      ws.send(JSON.stringify(await answer(msg)));
    } catch (e) {
      console.error("could not quote", e);
    }
  };
  ws.onclose = () => setTimeout(connect, 2000);
  ws.onerror = () => {};
}
connect();
