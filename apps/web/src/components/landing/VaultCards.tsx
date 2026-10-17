"use client";
import { MARKETS, TIERS } from "@paritas/shared";
import { useSession } from "@/hooks/useSession";
import { useMarkets } from "./data";
import { pct, ticker, usd } from "./format";

const WAVE1 = MARKETS.filter((m) => m.wave === 1);
const WAVE2 = MARKETS.filter((m) => m.wave === 2).map((m) => m.symbol);

/** Section 06: the launch vaults with live TVL from GET /markets. */
export function VaultCards() {
  const { bySym, ready } = useMarkets();
  const live = useSession();
  return (
    <div className="vcards" id="vcards">
      {WAVE1.map((c) => {
        const t = TIERS[c.tier];
        const m = bySym.get(c.symbol);
        const tvl = m?.vault?.tvlUsd ?? null;
        const pill = !ready ? null : !m?.vault ? ["Second wave", "var(--text-2)"] : live.params.vaultOpen && m.vault.open !== false ? ["Quoting", "var(--up)"] : ["Paused", "var(--warn)"];
        return (
          <div className="vc glass" key={c.symbol}>
            <span className="glare"></span>
            <div className="vc-h">
              <span className="vc-m"><span className="tok md" aria-hidden="true">{ticker(c.symbol)}</span><span>{c.symbol}<small>{c.name} · Tier {c.tier}</small></span></span>
              {pill && <span className="pill" style={{ ["--c" as string]: pill[1] }}>{pill[0]}</span>}
            </div>
            <div className="vc-r"><span>TVL of {usd(t.capUsd)} cap</span><b className="num">{tvl != null ? usd(Math.round(tvl)) : "–"}</b></div>
            <div className="capb"><i style={{ width: tvl != null ? ((tvl / t.capUsd) * 100).toFixed(1) + "%" : "0%" }}></i></div>
            <div className="vc-r"><span>Spread APR, 30 days</span><b>–</b></div>
            <div className="vc-r"><span>Base spread · price limit</span><b>{pct(t.halfSpreadBps)} · {pct(t.bandBps)}</b></div>
          </div>
        );
      })}
      <p className="small" style={{ gridColumn: "1 / -1", marginTop: 4 }}>
        Spread APR shows once a vault has 7 days of fills. {WAVE2.join(" and ")} vaults open in the second wave.
      </p>
    </div>
  );
}
