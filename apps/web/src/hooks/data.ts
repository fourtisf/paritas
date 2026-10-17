"use client";
/**
 * Read hooks over the API (docs/DEMO_TO_PRODUCTION.md). Live balances come from wagmi (useWallet), everything
 * historical or aggregated from here. Shapes are the API's; `toFill` turns a route row into the tape/receipt row.
 */
import { useQuery } from "@tanstack/react-query";
import { costBps as allInCost, SESSION_PARAMS, TIERS, PROTOCOL, type RouteRow as DecodedRoute, type SessionName, type VenueId } from "@paritas/shared";
import { API_URL } from "@/lib/wagmi";
import { units } from "@/lib/format";
import type { Market } from "@/components/platform/deployment";

type Hex = `0x${string}`;

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API_URL}${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export interface MarketRow {
  symbol: string;
  name: string;
  tier: "A" | "B" | "C";
  wave: 1 | 2;
  token: Hex;
  mid: number; // Chainlink price, USD (display)
  priceWad: string;
  updatedAt: number;
  feedFresh: boolean;
  chg: number; // 24h %
  vault: { address: Hex; tvlUsd: number; tokenShareBps: number; totalSupply: string; reserveStock: string; reserveUsd: string; open: boolean } | null;
  open: boolean; // has a vault (wave 1)
}

export function useMarkets() {
  return useQuery({ queryKey: ["markets"], queryFn: () => get<MarketRow[]>("/markets"), refetchInterval: 5_000 });
}

/** Market rows by symbol; undefined while loading or when the API is down. */
export function useMarketMap() {
  const q = useMarkets();
  const map = q.data ? new Map(q.data.map((m) => [m.symbol, m])) : undefined;
  return { ...q, map };
}

export function useCandles(symbol: string, tf: "1D" | "1W" | "1M") {
  return useQuery({
    queryKey: ["candles", symbol, tf],
    queryFn: () => get<{ t: number; v: number }[]>(`/markets/${symbol}/candles?tf=${tf}`),
    refetchInterval: 30_000,
  });
}

export interface RouteRow {
  id: string;
  txHash: Hex;
  blockNumber: string;
  timestamp: string;
  trader: Hex;
  recipient: Hex;
  stock: Hex;
  buy: boolean;
  amountIn: string;
  amountOut: string;
  protocolFee: string;
  oraclePriceWad: string;
  session: SessionName;
  notionalUsd: number;
  costBps: number;
  fills: { id: string; legIndex: number; venue: VenueId; amountIn: string; amountOut: string; priceWad: string; costBps: number }[];
}

export interface FillsQuery {
  symbol?: string;
  venue?: VenueId;
  side?: "buy" | "sell";
  trader?: string;
  limit?: number;
}

export function useFills(q: FillsQuery, enabled = true) {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]));
  return useQuery({ queryKey: ["fills", q], queryFn: () => get<RouteRow[]>(`/fills?${qs}`), enabled, placeholderData: (p) => p, refetchInterval: 20_000 });
}

/** One route by id ("<chainId>:<routeId>"), for a receipt opened from a link. */
export function useFill(id: string | null) {
  // receipts never change; a swap made in this tab is seeded by seedFill() so it shows before the indexer has it
  return useQuery({ queryKey: ["fill", id], queryFn: () => get<RouteRow>(`/fills/${encodeURIComponent(id!)}`), enabled: !!id, staleTime: Infinity, retry: 8, retryDelay: 1500 });
}

/** The API's route row for a swap decoded from its own receipt, with the indexer's cost math (apps/api/src/indexer.ts). */
export function routeRowFromReceipt(r: DecodedRoute, chainId: number, timestampSec: number): RouteRow {
  const u = { priceWad: r.oraclePriceWad, stockUnit: 10n ** 18n, usdToWad: 10n ** 12n, feeBps: PROTOCOL.fees.protocolFeeBps };
  const usd = r.buy ? r.amountIn : r.amountOut + r.protocolFee;
  return {
    id: `${chainId}:${r.routeId}`,
    txHash: r.txHash,
    blockNumber: r.blockNumber.toString(),
    timestamp: new Date(timestampSec * 1000).toISOString(),
    trader: r.trader,
    recipient: r.recipient,
    stock: r.stock,
    buy: r.buy,
    amountIn: r.amountIn.toString(),
    amountOut: r.amountOut.toString(),
    protocolFee: r.protocolFee.toString(),
    oraclePriceWad: r.oraclePriceWad.toString(),
    session: r.session,
    notionalUsd: Number(usd) / 1e6,
    costBps: allInCost({ buy: r.buy, usdAmount: r.buy ? usd - r.protocolFee : usd, stockAmount: r.buy ? r.amountOut : r.amountIn, ...u }),
    fills: r.fills.map((f) => ({
      id: `${f.txHash}:${f.logIndex}`,
      legIndex: f.legIndex,
      venue: f.venue,
      amountIn: f.amountIn.toString(),
      amountOut: f.amountOut.toString(),
      priceWad: f.priceWad.toString(),
      costBps: allInCost({ buy: r.buy, usdAmount: r.buy ? f.amountIn : f.amountOut, stockAmount: r.buy ? f.amountOut : f.amountIn, ...u }),
    })),
  };
}

export interface Stats {
  now: number;
  fills: number;
  volumeUsd: number;
  avgCostBps: number;
  byVenue: Record<VenueId, number>;
  hourly: { t: number; v: [number, number, number] }[];
}
export const useStats = () => useQuery({ queryKey: ["stats"], queryFn: () => get<Stats>("/stats"), refetchInterval: 15_000 });

export interface GovOp {
  id: string;
  target: Hex;
  data: Hex;
  status: "scheduled" | "ready" | "executed" | "cancelled";
  title: string | null;
  scheduledAt: string;
  readyAt: string;
  executedAt: string | null;
  txHash: Hex;
}
export interface Governance {
  now: number;
  paused: boolean | null;
  guardian: Hex | null;
  timelock: Hex;
  deployedAtBlock: number;
  delaySec: number;
  multisig: string;
  ops: GovOp[];
}
export const useGovernance = () => useQuery({ queryKey: ["governance"], queryFn: () => get<Governance>("/governance"), refetchInterval: 30_000 });

export interface VaultFlow {
  id: string;
  vault: Hex;
  kind: "deposit" | "withdraw";
  owner: Hex;
  receiver: Hex;
  shares: string;
  usdAmount: string;
  stockAmount: string;
  valueWad: string | null;
  timestamp: string;
}
export function usePortfolio(address?: string) {
  return useQuery({
    queryKey: ["portfolio", address],
    queryFn: () => get<{ routes: RouteRow[]; flows: VaultFlow[] }>(`/portfolio/${address}`),
    enabled: !!address,
    refetchInterval: 20_000,
  });
}

export interface CostLine {
  label: string;
  bps: number;
}

/**
 * Cost lines for a fill of `costBps` (all-in, incl. the protocol fee) on one venue, like the ticket shows them.
 * Vault: the spread is known from the tier and session, the rest is the inventory adjustment.
 */
export function costLines(venue: VenueId, costBps: number, m: { tier: "A" | "B" | "C"; uniswapPoolFee: number }, session: SessionName): CostLine[] {
  const fee = PROTOCOL.fees.protocolFeeBps;
  if (venue === "vault") {
    const spread = (TIERS[m.tier].halfSpreadBps * SESSION_PARAMS[session].spreadMulBps) / 10_000;
    return [{ label: "Spread", bps: spread }, { label: "Inventory adjustment", bps: costBps - spread - fee }, { label: "Protocol fee", bps: fee }];
  }
  if (venue === "pool") {
    const pf = m.uniswapPoolFee / 100;
    return [{ label: "Pool fee", bps: pf }, { label: "Price impact", bps: costBps - pf - fee }, { label: "Protocol fee", bps: fee }];
  }
  return [{ label: "Maker spread", bps: costBps - fee }, { label: "Protocol fee", bps: fee }];
}

/** A route as the prototype's fill row: one main venue chip, all legs kept for the receipt. */
export interface UIFill {
  id: string;
  t: number;
  sym: string;
  market: Market;
  side: "buy" | "sell";
  venue: VenueId;
  N: number; // USDG notional
  cost: number; // bps vs share price, incl. protocol fee
  mid: number;
  price: number;
  qty: number;
  wallet: Hex;
  tx: Hex;
  block: number;
  sess: SessionName;
  mine: boolean;
  legs: { venue: VenueId; usd: number; cost: number; lines: CostLine[] }[];
  lines: CostLine[];
}

export function toFill(r: RouteRow, byToken: (t: string) => Market | undefined, me?: string): UIFill | null {
  const m = byToken(r.stock);
  if (!m) return null;
  const mid = units(r.oraclePriceWad, 18);
  const legs = r.fills.map((f) => ({ venue: f.venue, usd: units(r.buy ? f.amountIn : f.amountOut, 6), cost: f.costBps, lines: costLines(f.venue, f.costBps, m, r.session) }));
  const main = legs.reduce((a, l) => (l.usd > a.usd ? l : a), legs[0] ?? { venue: "vault" as VenueId, usd: 0, cost: r.costBps, lines: [] });
  return {
    id: r.id,
    t: Date.parse(r.timestamp),
    sym: m.symbol,
    market: m,
    side: r.buy ? "buy" : "sell",
    venue: main.venue,
    N: r.notionalUsd,
    cost: r.costBps,
    mid,
    price: r.buy ? mid * (1 + r.costBps / 1e4) : mid * (1 - r.costBps / 1e4),
    qty: units(r.buy ? r.amountOut : r.amountIn, 18),
    wallet: r.trader,
    tx: r.txHash,
    block: Number(r.blockNumber),
    sess: r.session,
    mine: !!me && r.trader.toLowerCase() === me.toLowerCase(),
    legs,
    lines: legs.length === 1 ? main.lines : costLines(main.venue, r.costBps, m, r.session),
  };
}
