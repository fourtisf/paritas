"use client";
import { MARKETS } from "@paritas/shared";
import { useMarkets } from "./data";
import { nf } from "./format";
import { TokenMark } from "@/components/brand/TokenMark";

/** Price strip under the hero: live Chainlink share prices from GET /markets. */
export function Marquee() {
  const { bySym } = useMarkets();
  const items = (
    <>
      {MARKETS.map((c) => {
        const m = bySym.get(c.symbol);
        const live = m && m.mid > 0;
        return (
          <span className="mq" key={c.symbol}>
            <span className="tok" aria-hidden="true"><TokenMark sym={c.symbol} /></span>
            <b>{c.symbol}</b>
            <span className="num">{live ? nf(m.mid) : "–"}</span>
            {live && <span className={m.chg >= 0 ? "up" : "down"}>{m.chg >= 0 ? "+" : "−"}{nf(Math.abs(m.chg))}%</span>}
          </span>
        );
      })}
      <span className="mq muted">Share prices from Chainlink</span>
    </>
  );
  return (
    <div className="marq" aria-label="Stock Token prices">
      <div className="marq-t" id="marq">
        <div className="marq-s">{items}</div>
        <div className="marq-s" aria-hidden="true">{items}</div>
      </div>
    </div>
  );
}
