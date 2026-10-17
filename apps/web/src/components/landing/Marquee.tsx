"use client";
import { useEffect, useRef, useState } from "react";
import { MARKETS } from "@paritas/shared";
import { TokenMark } from "@/components/brand/TokenMark";
import { useMarkets, useRefPrices } from "./data";
import { nf } from "./format";

/** A price that flashes up or down for a moment when it changes. */
function Tick({ v }: { v: number }) {
  const prev = useRef(v);
  const [dir, setDir] = useState<"" | "up" | "down">("");
  useEffect(() => {
    if (v === prev.current) return;
    setDir(v > prev.current ? "up" : "down");
    prev.current = v;
    const id = setTimeout(() => setDir(""), 700);
    return () => clearTimeout(id);
  }, [v]);
  return <span className={`num ${dir ? "tick-" + dir : ""}`.trim()}>{nf(v)}</span>;
}

/**
 * Price strip under the hero. A live market shows its Chainlink share price from GET /markets. A market that is not
 * live on this chain yet shows the Pyth reference price from GET /prices, and the strip says so.
 */
export function Marquee() {
  const { bySym } = useMarkets();
  const pending = MARKETS.some((c) => !bySym.has(c.symbol));
  const ref = useRefPrices(pending);
  const rows = MARKETS.map((c) => {
    const m = bySym.get(c.symbol);
    if (m) return { c, price: m.mid > 0 ? m.mid : null, chg: m.mid > 0 ? m.chg : null, pyth: false };
    const r = ref.get(c.symbol);
    return { c, price: r?.price ?? null, chg: r?.chg ?? null, pyth: r?.price != null };
  });
  const items = (
    <>
      {rows.map(({ c, price, chg }) => (
        <span className="mq" key={c.symbol}>
          <span className="tok" aria-hidden="true"><TokenMark sym={c.symbol} /></span>
          <b>{c.symbol}</b>
          {price != null ? <Tick v={price} /> : <span className="num">–</span>}
          {chg != null && <span className={chg >= 0 ? "up" : "down"}>{chg >= 0 ? "+" : "−"}{nf(Math.abs(chg))}%</span>}
        </span>
      ))}
      <span className="mq muted">{rows.some((r) => r.pyth) ? "Reference prices from Pyth" : "Share prices from Chainlink"}</span>
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
