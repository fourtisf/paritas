"use client";
import { useQuery } from "@tanstack/react-query";
import { useBlockNumber } from "wagmi";
import type { VenueId } from "@paritas/shared";
import { API_URL } from "@/lib/wagmi";

export interface CostLine {
  label: string;
  bps: number;
}

export interface VenueQuote {
  id: VenueId;
  available: boolean;
  reason: string | null;
  amountIn: string;
  amountOut: string | null;
  costBps: number | null; // all-in vs the oracle, incl. the protocol fee
  lines: CostLine[] | null;
}

export interface QuoteResponse {
  ok: boolean;
  /** Why nothing can be quoted at all (e.g. the Chainlink price is out of date). */
  reason?: string;
  session: string;
  oraclePriceWad: string;
  priceLimitBps: number;
  notionalUsd: number;
  venueQuotes: VenueQuote[];
  mainVenue?: VenueId;
  costBps?: number;
  expectedOut?: string;
  minAmountOut?: string;
  protocolFee?: string;
  legs?: { venue: VenueId; amountIn: string; amountOut: string; costBps: number; lines: CostLine[] }[];
  /** Present only when a trader address was sent. */
  swapArgs?: { stock: `0x${string}`; buy: boolean; amountIn: string; minAmountOut: string; recipient: `0x${string}`; legs: { venue: number; amountIn: string; data: `0x${string}` }[] };
  venues: { id: VenueId; available: boolean; reason: string | null }[];
  /** What this quote was asked for (added client-side), to tell a fresh quote from one kept while refetching. */
  args: { symbol: string; side: "buy" | "sell"; amount: string };
}

/**
 * Trade ticket quote. Refreshes every block, like the prototype says ("Quotes refresh every block").
 * Works without a wallet (no maker quotes and no swapArgs until one is connected).
 */
export function useQuote(args: { symbol: string; side: "buy" | "sell"; amount: string; trader?: `0x${string}`; slippageBps: number; venues: "best" | "vault" | "nomaker" }) {
  const { data: block } = useBlockNumber({ watch: true });
  return useQuery({
    queryKey: ["quote", args, block?.toString()],
    enabled: Number(args.amount) > 0,
    placeholderData: (prev, prevQuery) => (prevQuery && (prevQuery.queryKey[1] as typeof args).symbol === args.symbol && (prevQuery.queryKey[1] as typeof args).side === args.side ? prev : undefined),
    retry: 1,
    queryFn: async (): Promise<QuoteResponse> => {
      const r = await fetch(`${API_URL}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });
      if (!r.ok) throw new Error(await r.text());
      return { ...(await r.json()), args: { symbol: args.symbol, side: args.side, amount: args.amount } };
    },
  });
}
