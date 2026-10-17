"use client";
/**
 * Vault position value and earnings, and the portfolio "Value over time" series.
 *  - Value: what the shares redeem for now (previewWithdraw), at the Chainlink price.
 *  - Fees: value minus net deposited value (docs/DEMO_TO_PRODUCTION.md). Deposits add their valueWad to the cost basis;
 *    withdrawals take out the same share of the basis as of the shares they burn.
 *  - History: today's holdings valued at past Chainlink prices (candles). There is no balance-history endpoint yet.
 */
import { useQueries } from "@tanstack/react-query";
import { API_URL } from "@/lib/env";
import { units } from "@/lib/format";
import { useDeployment } from "@/components/platform/deployment";
import { useMarketMap, usePortfolio } from "./data";
import { useWallet } from "./useWallet";
import { useChainNow } from "./useChainNow";

export interface VaultPosition {
  sym: string;
  value: number;
  usd: number; // USDG it redeems for
  stock: number; // stock tokens it redeems for
  basis: number;
  fees: number;
  since: number | null; // ms, first deposit
}

export function useVaultPositions() {
  const w = useWallet();
  const { markets } = useDeployment();
  const { map } = useMarketMap();
  const pf = usePortfolio(w.address);
  const me = w.address?.toLowerCase();
  const out: Record<string, VaultPosition> = {};
  for (const m of markets) {
    const p = w.positions[m.symbol];
    if (!m.vault || !p) continue;
    const mid = map?.get(m.symbol)?.mid ?? 0;
    const usd = units(p.usdOut, 6), stock = units(p.stockOut, 18);
    const value = usd + stock * mid;
    const flows = (pf.data?.flows ?? []).filter((f) => f.vault.toLowerCase() === m.vault!.toLowerCase()).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    let basis = 0, sh = 0, since: number | null = null;
    for (const f of flows) {
      const s = units(f.shares, 18);
      if (f.kind === "deposit" && f.receiver.toLowerCase() === me) {
        basis += units(f.valueWad ?? "0", 18);
        sh += s;
        since ??= Date.parse(f.timestamp);
      } else if (f.kind === "withdraw" && f.owner.toLowerCase() === me && sh > 0) {
        basis -= basis * Math.min(1, s / sh);
        sh -= s;
      }
    }
    out[m.symbol] = { sym: m.symbol, value, usd, stock, basis, fees: pf.data ? value - basis : 0, since };
  }
  return { positions: out, loaded: !!pf.data };
}

/** Holdings at past prices: USDG + each stock (wallet + inside vaults) x that stock's candle close at the time. */
export function usePortfolioHistory(tf: "1W" | "1M", hold: { usd: number; stock: Record<string, number> }) {
  const now = useChainNow(30_000) * 1000;
  const syms = Object.keys(hold.stock).filter((k) => hold.stock[k] > 0);
  const qs = useQueries({
    queries: syms.map((sym) => ({
      queryKey: ["candles", sym, tf],
      queryFn: async () => {
        const r = await fetch(`${API_URL}/markets/${sym}/candles?tf=${tf}`);
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as { t: number; v: number }[];
      },
      refetchInterval: 30_000,
    })),
  });
  const series = syms.map((s, i) => ({ s, pts: qs[i].data ?? [] }));
  const times = [...new Set(series.flatMap((x) => x.pts.map((p) => p.t)))].sort((a, b) => a - b);
  const priceAt = (pts: { t: number; v: number }[], t: number) => {
    let v = pts[0]?.v ?? 0;
    for (const p of pts) if (p.t <= t) v = p.v;
    return v;
  };
  return times.filter((t) => t <= now).map((t) => ({ t, v: hold.usd + series.reduce((a, x) => a + hold.stock[x.s] * priceAt(x.pts, t), 0) }));
}
