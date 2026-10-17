/**
 * Turns a SwapRouter transaction receipt into the "receipt" the app shows (prototype: Fill detail modal).
 * The indexer stores the same shape in Postgres (apps/api/prisma/schema.prisma: Route + Fill).
 */
import { decodeEventLog, type Log } from "viem";
import { swapRouterAbi } from "./abi";
import { SESSIONS, type SessionName } from "./sessions";
import type { VenueId } from "./route";

const VENUES: VenueId[] = ["vault", "pool", "rfq"];

export interface FillRow {
  routeId: bigint;
  legIndex: number;
  venue: VenueId;
  stock: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
  priceWad: bigint;
  txHash: `0x${string}`;
  logIndex: number;
  blockNumber: bigint;
}

export interface RouteRow {
  routeId: bigint;
  trader: `0x${string}`;
  recipient: `0x${string}`;
  stock: `0x${string}`;
  buy: boolean;
  amountIn: bigint;
  amountOut: bigint;
  protocolFee: bigint;
  oraclePriceWad: bigint;
  session: SessionName;
  txHash: `0x${string}`;
  blockNumber: bigint;
  fills: FillRow[];
}

export function decodeRouteLogs(logs: Log[], router: `0x${string}`): RouteRow[] {
  const routes = new Map<bigint, RouteRow>();
  const fills: FillRow[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== router.toLowerCase()) continue;
    let ev;
    try {
      ev = decodeEventLog({ abi: swapRouterAbi, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    if (ev.eventName === "Fill") {
      const a = ev.args;
      fills.push({
        routeId: a.routeId,
        legIndex: Number(a.legIndex),
        venue: VENUES[Number(a.venue)],
        stock: a.stock,
        amountIn: a.amountIn,
        amountOut: a.amountOut,
        priceWad: a.priceWad,
        txHash: log.transactionHash!,
        logIndex: log.logIndex!,
        blockNumber: log.blockNumber!,
      });
    } else if (ev.eventName === "RouteExecuted") {
      const a = ev.args;
      routes.set(a.routeId, {
        routeId: a.routeId,
        trader: a.trader,
        recipient: a.recipient,
        stock: a.stock,
        buy: a.buy,
        amountIn: a.amountIn,
        amountOut: a.amountOut,
        protocolFee: a.protocolFee,
        oraclePriceWad: a.oraclePriceWad,
        session: SESSIONS[a.session],
        txHash: log.transactionHash!,
        blockNumber: log.blockNumber!,
        fills: [],
      });
    }
  }
  for (const f of fills) routes.get(f.routeId)?.fills.push(f);
  return [...routes.values()];
}
