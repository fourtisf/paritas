"use client";
import { useQuery } from "@tanstack/react-query";
import { useBlockNumber } from "wagmi";
import { API_URL } from "@/lib/wagmi";

export interface QuoteResponse {
  ok: boolean;
  session: string;
  oraclePriceWad?: string;
  priceLimitBps?: number;
  costBps?: number;
  expectedOut?: string;
  minAmountOut?: string;
  protocolFee?: string;
  legs?: { venue: "vault" | "pool" | "rfq"; amountIn: string; amountOut: string }[];
  swapArgs?: { stock: `0x${string}`; buy: boolean; amountIn: string; minAmountOut: string; recipient: `0x${string}`; legs: { venue: number; amountIn: string; data: `0x${string}` }[] };
  venues: { id: "vault" | "pool" | "rfq"; available: boolean; reason: string | null }[];
}

/** Trade ticket quote. Refreshes every block, like the prototype says ("Quotes refresh every block"). */
export function useQuote(args: { symbol: string; side: "buy" | "sell"; amount: string; trader?: `0x${string}`; slippageBps: number; venues: "best" | "vault" | "nomaker" }) {
  const { data: block } = useBlockNumber({ watch: true });
  return useQuery({
    queryKey: ["quote", args, block?.toString()],
    enabled: !!args.trader && Number(args.amount) > 0,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<QuoteResponse> => {
      const r = await fetch(`${API_URL}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });
}
