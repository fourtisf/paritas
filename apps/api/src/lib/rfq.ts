/**
 * RFQ relay. Makers keep a websocket open to /makers?key=...; for each /quote that qualifies we broadcast
 * a request and take the best valid signed reply within RFQ_WAIT_MS.
 *
 * Request  -> maker: { type: "rfq", id, chainId, settlement, taker, stock, takerBuys, amountIn, expiresBefore }
 * Response <- maker: { type: "quote", id, quote: RfqQuote (amounts as decimal strings), signature }
 *
 * Every reply is verified here (EIP-712 signature, allowlist, taker, amounts, expiry) so the app never shows
 * a quote that RfqSettlement would reject. The contract re-checks all of it anyway.
 */
import { randomUUID } from "node:crypto";
import { verifyTypedData, type Hex } from "viem";
import { rfqSettlementAbi, PROTOCOL } from "@paritas/shared";
import { chainNow, client, deployment, chainId } from "./chain";
import { env } from "./env";

export interface RfqQuote {
  maker: Hex;
  taker: Hex;
  stock: Hex;
  takerBuys: boolean;
  amountIn: bigint;
  amountOut: bigint;
  nonce: bigint;
  expiry: bigint;
}

type Socket = { send(data: string): void; readyState: number };
const makers = new Map<Socket, { key: string }>();
const pending = new Map<string, (msg: any) => void>();

export const RFQ_TYPES = {
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

export function registerMaker(ws: Socket & { on(ev: string, fn: (d: any) => void): void }, key: string) {
  if (!env.RFQ_MAKER_KEYS.split(",").filter(Boolean).includes(key)) {
    ws.send(JSON.stringify({ type: "error", error: "unknown maker key" }));
    return false;
  }
  makers.set(ws, { key });
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === "quote" && pending.has(msg.id)) pending.get(msg.id)!(msg);
    } catch {
      /* ignore malformed */
    }
  });
  ws.on("close", () => makers.delete(ws));
  return true;
}

const makerCache = new Map<string, { ok: boolean; at: number }>();
async function isAllowlisted(maker: Hex): Promise<boolean> {
  const c = makerCache.get(maker);
  if (c && Date.now() - c.at < 60_000) return c.ok;
  const d = await deployment();
  const ok = await client.readContract({ address: d.paritas.rfqSettlement, abi: rfqSettlementAbi, functionName: "isMaker", args: [maker] });
  makerCache.set(maker, { ok, at: Date.now() });
  return ok;
}

export async function requestRfq(req: { taker: Hex; stock: Hex; takerBuys: boolean; amountIn: bigint }) {
  if (makers.size === 0) return null;
  const d = await deployment();
  const id = randomUUID();
  const now = BigInt(Math.floor(await chainNow())); // RfqSettlement checks expiry against block.timestamp
  const expiresBefore = now + BigInt(PROTOCOL.rfq.quoteTtlSec) + 5n;
  const replies: Array<{ quote: RfqQuote; signature: Hex }> = [];
  pending.set(id, (msg) => {
    try {
      const q = msg.quote;
      replies.push({
        quote: { ...q, amountIn: BigInt(q.amountIn), amountOut: BigInt(q.amountOut), nonce: BigInt(q.nonce), expiry: BigInt(q.expiry) },
        signature: msg.signature,
      });
    } catch {
      /* ignore */
    }
  });
  const payload = JSON.stringify({
    type: "rfq",
    id,
    chainId,
    settlement: d.paritas.rfqSettlement,
    taker: req.taker,
    stock: req.stock,
    takerBuys: req.takerBuys,
    amountIn: req.amountIn.toString(),
    expiresBefore: expiresBefore.toString(),
  });
  for (const ws of makers.keys()) if (ws.readyState === 1) ws.send(payload);
  await new Promise((r) => setTimeout(r, env.RFQ_WAIT_MS));
  pending.delete(id);

  let best: { quote: RfqQuote; signature: Hex } | null = null;
  for (const r of replies) {
    const q = r.quote;
    if (q.taker.toLowerCase() !== req.taker.toLowerCase() || q.stock.toLowerCase() !== req.stock.toLowerCase()) continue;
    if (q.takerBuys !== req.takerBuys || q.amountIn !== req.amountIn) continue;
    if (q.expiry <= now + 5n || q.expiry > expiresBefore) continue;
    const valid = await verifyTypedData({
      address: q.maker,
      domain: { name: "Paritas RFQ", version: "1", chainId, verifyingContract: d.paritas.rfqSettlement },
      types: RFQ_TYPES,
      primaryType: "RfqQuote",
      message: q,
      signature: r.signature,
    }).catch(() => false);
    if (!valid || !(await isAllowlisted(q.maker))) continue;
    if (!best || q.amountOut > best.quote.amountOut) best = r;
  }
  return best;
}
