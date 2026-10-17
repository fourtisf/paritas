"use client";
/**
 * Live data for the landing page, all from the API:
 *  - GET /markets: Chainlink share price (priceWad), vault reserves and status
 *  - POST /quote without a wallet: what Uniswap (QuoterV2) and market makers would do for the order
 *  - GET /fills: the latest routed trades
 *  - GET /prices: Finnhub reference prices for the price strip while a market is not live (display only)
 * The vault is priced here with the contracts' BigInt math (packages/shared quote.ts) from the live price and
 * reserves, so it can also be shown for another session (the "Preview market open" switch and the router lab).
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatUnits, parseUnits } from "viem";
import {
  PROTOCOL,
  SESSION_PARAMS,
  TIERS,
  allowedLegCostBps,
  costBps,
  marketBySymbol,
  protocolFee,
  quoteVault,
  vaultClipUsd,
  type SessionName,
} from "@paritas/shared";
import { API_URL } from "@/lib/env";
import { pct, usd } from "./format";

// Same assumptions as apps/api (routes/quote.ts): VERIFY decimals on Blockscout before mainnet.
const USDG_DECIMALS = 6;
const STOCK_DECIMALS = 18;
const STOCK_UNIT = 10n ** BigInt(STOCK_DECIMALS);
const USD_TO_WAD = 10n ** BigInt(18 - USDG_DECIMALS);
const FEE_BPS = PROTOCOL.fees.protocolFeeBps;

export type VenueId = "vault" | "pool" | "rfq";

export interface ApiMarket {
  symbol: string;
  name: string;
  tier: "A" | "B" | "C";
  token: `0x${string}`;
  mid: number; // display only; math uses priceWad
  priceWad?: string;
  chg: number; // 24h change in percent
  open: boolean; // a vault exists
  vault: { address: `0x${string}`; tvlUsd: number; tokenShareBps: number; reserveStock?: string; reserveUsd?: string; open?: boolean } | null;
}

export interface ApiRoute {
  id: string;
  stock: string; // lowercase token address
  buy: boolean;
  amountIn: string;
  amountOut: string;
  notionalUsd: number;
  costBps: number;
  fills: { venue: VenueId; amountIn: string }[];
}

interface ApiVenueQuote {
  id: VenueId;
  available: boolean;
  reason: string | null;
  amountOut: string | null; // before the protocol fee on sells
  costBps: number | null;
  lines: { label: string; bps: number }[] | null;
}

interface ApiQuote {
  session: SessionName;
  priceLimitBps: number;
  venueQuotes?: ApiVenueQuote[];
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, init);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

/** Markets keyed by symbol. Shared cache: every landing component reads the same query. */
export function useMarkets() {
  const q = useQuery({ queryKey: ["landing", "markets"], queryFn: () => getJson<ApiMarket[]>("/markets"), refetchInterval: 15_000, retry: false });
  const bySym = new Map((q.data ?? []).map((m) => [m.symbol, m]));
  return { bySym, ready: !!q.data, list: q.data ?? [] };
}

export interface RefPrice {
  symbol: string;
  price: number | null;
  chg: number | null; // percent against the previous daily close
  publishTime: number | null;
  source: "finnhub";
}

/** GET /prices: Finnhub reference prices, for markets that are not live on this chain yet. Display only. */
export function useRefPrices(enabled: boolean) {
  const q = useQuery({ queryKey: ["landing", "prices"], queryFn: () => getJson<RefPrice[]>("/prices"), refetchInterval: 2_000, retry: false, enabled });
  return new Map((q.data ?? []).map((p) => [p.symbol, p]));
}

export function useLatestFills(limit: number) {
  return useQuery({ queryKey: ["landing", "fills", limit], queryFn: () => getJson<ApiRoute[]>(`/fills?limit=${limit}`), refetchInterval: 6_000, retry: false });
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** POST /quote without a wallet (no maker quotes, no transaction). Returns null until it matches the order. */
export function useWalletlessQuote(a: { symbol: string; buy: boolean; amount: number }) {
  const amount = a.amount > 0 ? a.amount.toFixed(a.buy ? USDG_DECIMALS : 8) : null;
  const key = useDebounced(`${a.symbol}|${a.buy}|${amount}`, 250);
  const [symbol, side, amt] = key.split("|");
  const listed = useMarkets().bySym.has(symbol); // nothing to quote before the market is deployed on this chain
  const q = useQuery({
    queryKey: ["landing", "quote", key],
    enabled: amt !== "null" && listed,
    queryFn: () =>
      getJson<ApiQuote>("/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, side: side === "true" ? "buy" : "sell", amount: amt }),
      }),
    placeholderData: (prev) => prev,
    refetchInterval: 15_000,
    retry: false,
  });
  // keep showing the last quote while the size is being dragged, but never one for another market or side
  return symbol === a.symbol && side === String(a.buy) ? q.data ?? null : null;
}

export const stockAmount = (raw: string) => Number(formatUnits(BigInt(raw), STOCK_DECIMALS));

/** The leg that carried most of the route: the venue chip shown for a fill. */
export function mainVenue(r: ApiRoute): VenueId {
  let best = r.fills[0];
  for (const f of r.fills) if (BigInt(f.amountIn) > BigInt(best.amountIn)) best = f;
  return best?.venue ?? "vault";
}

export const VEN: Record<VenueId, { name: string; via: string; c: string }> = {
  vault: { name: "Paritas vault", via: "the Paritas vault", c: "var(--v-vault)" },
  pool: { name: "Uniswap pool", via: "Uniswap", c: "var(--v-pool)" },
  rfq: { name: "Market maker", via: "a market maker", c: "var(--v-rfq)" },
};

export interface VenueView {
  id: VenueId;
  /** ok: priced and inside the limit; off: cannot fill; wait: no quote yet */
  state: "ok" | "off" | "wait";
  cost: number | null; // all-in bps versus the share price, protocol fee included
  out: number | null; // output in whole tokens after the protocol fee (stock on buys, USDG on sells)
  sub: string;
  lines?: [string, number][];
}

export interface Preview {
  mid: number | null;
  notional: number | null; // USD size of the order
  limitBps: number; // price limit for one leg in this session, protocol fee included
  vault: VenueView;
  venues: VenueView[];
  best: VenueView | null;
  priced: number; // venues with a price inside the limit
}

/**
 * Every venue for one order in one session. `session` may differ from the live one (preview / lab): the vault is
 * then priced with that session's multipliers and each Uniswap and maker quote is checked against that session's
 * price limit. `liveSession` is the session the API quoted in.
 */
export function previewVenues(a: {
  market: ApiMarket | undefined;
  symbol: string;
  buy: boolean;
  amount: number; // human units of the input token: USDG on buys, stock on sells
  session: SessionName;
  live: boolean; // session is the live one: respect the vault's on-chain open flag
  closedReason: string;
  quote: ApiQuote | null;
}): Preview {
  const cfg = marketBySymbol(a.symbol)!;
  const tier = TIERS[cfg.tier];
  const sp = SESSION_PARAMS[a.session];
  const limitBps = allowedLegCostBps(tier, sp) + FEE_BPS;
  const mid = a.market && a.market.mid > 0 ? a.market.mid : null;
  const N = a.buy ? a.amount : mid == null ? null : a.amount * mid;

  let vault: VenueView = { id: "vault", state: "off", cost: null, out: null, sub: "Price unavailable" };
  const v = a.market?.vault;
  if (a.market && mid != null && N != null) {
    const clip = vaultClipUsd(tier, sp);
    if (!v) vault.sub = cfg.wave === 2 ? "Opens in the second wave" : "Not open yet";
    else if (!sp.vaultOpen) vault.sub = a.closedReason;
    else if (a.live && v.open === false) vault.sub = "Paused";
    else if (N > clip) vault.sub = "Above the " + usd(clip) + " vault limit";
    else if (a.amount > 0) vault = priceVault(a.market, tier, sp, a.buy, a.amount, limitBps);
    else vault = { ...vault, state: "ok", sub: "Chainlink price plus spread" };
  }

  const fromApi = (id: VenueId, sub: (q: ApiVenueQuote) => string): VenueView => {
    const q = a.quote?.venueQuotes?.find((x) => x.id === id);
    if (!q) return { id, state: "wait", cost: null, out: null, sub: id === "pool" ? "Pool fee " + pct(cfg.uniswapPoolFee / 100) + " plus price impact" : "Signed quote, checked on-chain" };
    const out = q.amountOut == null ? null : a.buy ? BigInt(q.amountOut) : BigInt(q.amountOut) - protocolFee(BigInt(q.amountOut), BigInt(FEE_BPS));
    const view: VenueView = {
      id,
      state: q.available ? "ok" : "off",
      cost: q.costBps,
      out: out == null ? null : Number(formatUnits(out, a.buy ? STOCK_DECIMALS : USDG_DECIMALS)),
      sub: q.available ? sub(q) : q.reason ?? "Not available",
      lines: q.lines?.map((l) => [l.label, l.bps]),
    };
    // the API checked the live session's limit; re-check when showing another session
    const bandOnly = q.available || (q.reason ?? "").startsWith("Over the");
    if (a.quote!.session !== a.session && q.costBps != null && bandOnly) {
      const inside = q.costBps <= limitBps;
      return { ...view, state: inside ? "ok" : "off", sub: inside ? sub(q) : "Over the " + pct(limitBps) + " price limit" };
    }
    return view;
  };
  const pool = fromApi("pool", (q) => "Price impact " + pct(q.lines?.find((l) => l.label === "Price impact")?.bps ?? 0));
  const rfq = fromApi("rfq", () => "Signed quote, checked on-chain");
  const { minUsd, maxUsd } = PROTOCOL.rfq;
  if (N != null && (N < minUsd || N > maxUsd)) Object.assign(rfq, { state: "off", sub: N < minUsd ? "Orders from " + usd(minUsd) : "Up to " + usd(maxUsd) + " per quote" });

  const venues = [vault, pool, rfq];
  const ok = venues.filter((x) => x.state === "ok" && x.out != null && x.cost != null);
  const best = ok.length ? ok.reduce((x, y) => (y.out! > x.out! ? y : x)) : null;
  return { mid, notional: N, limitBps, vault, venues, best, priced: ok.length };
}

function priceVault(m: ApiMarket, tier: (typeof TIERS)["A"], sp: (typeof SESSION_PARAMS)["regular"], buy: boolean, amount: number, limitBps: number): VenueView {
  const v = m.vault!;
  const priceWad = m.priceWad ? BigInt(m.priceWad) : BigInt(Math.round(m.mid * 1e8)) * 10n ** 10n;
  // older API builds have no raw reserves: rebuild them from TVL and inventory share (only their ratio moves the quote)
  const stockUsd = v.tvlUsd * (v.tokenShareBps / 10_000);
  const pool = {
    priceWad,
    reserveStock: v.reserveStock ? BigInt(v.reserveStock) : parseUnits((stockUsd / m.mid).toFixed(8), STOCK_DECIMALS),
    reserveUsd: v.reserveUsd ? BigInt(v.reserveUsd) : parseUnits((v.tvlUsd - stockUsd).toFixed(USDG_DECIMALS), USDG_DECIMALS),
    stockUnit: STOCK_UNIT,
    usdToWad: USD_TO_WAD,
  };
  const pricing = {
    halfSpreadBps: BigInt(tier.halfSpreadBps),
    skewBps: BigInt(tier.skewBps),
    spreadMulBps: BigInt(sp.spreadMulBps),
    spreadShareBps: BigInt(PROTOCOL.fees.spreadShareBps),
  };
  const fee = BigInt(FEE_BPS);
  let out: bigint, cost: number, costWad: bigint, short: boolean;
  if (buy) {
    const amountIn = parseUnits(amount.toFixed(USDG_DECIMALS), USDG_DECIMALS);
    const net = amountIn - protocolFee(amountIn, fee);
    const q = quoteVault(pool, pricing, true, net);
    out = q.amountOut;
    costWad = q.costWad;
    short = out > pool.reserveStock;
    cost = costBps({ buy, usdAmount: net, stockAmount: out, priceWad, stockUnit: STOCK_UNIT, usdToWad: USD_TO_WAD, feeBps: FEE_BPS });
  } else {
    const amountIn = parseUnits(amount.toFixed(8), STOCK_DECIMALS);
    const q = quoteVault(pool, pricing, false, amountIn);
    out = q.amountOut - protocolFee(q.amountOut, fee);
    costWad = q.costWad;
    short = q.amountOut + q.spreadShare > pool.reserveUsd;
    cost = costBps({ buy, usdAmount: q.amountOut, stockAmount: amountIn, priceWad, stockUnit: STOCK_UNIT, usdToWad: USD_TO_WAD, feeBps: FEE_BPS });
  }
  const spread = (tier.halfSpreadBps * sp.spreadMulBps) / 10_000;
  const lines: [string, number][] = [["Spread", spread], ["Inventory adjustment", Number(costWad) / 1e14 - spread], ["Protocol fee", FEE_BPS]];
  const view: VenueView = { id: "vault", state: "ok", cost, out: Number(formatUnits(out, buy ? STOCK_DECIMALS : USDG_DECIMALS)), sub: "Chainlink price plus spread", lines };
  if (short) return { ...view, state: "off", sub: "Not enough inventory" };
  if (cost > limitBps) return { ...view, state: "off", sub: "Over the " + pct(limitBps) + " price limit" };
  return view;
}

/** Tell the 3D scene which venue is filling the order on screen (rings and particles favour it). */
export const announceRoute = (venue: VenueId | null) => window.dispatchEvent(new CustomEvent("paritas:route", { detail: venue }));
