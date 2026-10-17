"use client";
import { useMarkets, useLatestFills, mainVenue, stockAmount, VEN } from "./data";
import { nf, sgn, ticker, usd } from "./format";

/** Hero card: the latest fills routed on Paritas (GET /fills). */
export function LiveList() {
  const { list } = useMarkets();
  const fills = useLatestFills(4);
  const symOf = new Map(list.map((m) => [m.token.toLowerCase(), m.symbol]));
  const rows = (fills.data ?? []).filter((r) => symOf.has(r.stock.toLowerCase()) && r.fills.length);
  return (
    <aside className="live" aria-label="Recently routed trades">
      <div className="live-h"><b>Just routed</b><span>Latest fills</span></div>
      <ul className="live-list" id="liveList" aria-live="off">
        {rows.map((r) => {
          const sym = symOf.get(r.stock.toLowerCase())!;
          const v = mainVenue(r);
          return (
            <li key={r.id}>
              <span className="tok" aria-hidden="true">{ticker(sym)}</span>
              <div style={{ minWidth: 0 }}>
                <div className="live-t">{r.buy ? "Bought" : "Sold"} {nf(stockAmount(r.buy ? r.amountOut : r.amountIn), 2)} {sym}</div>
                <div className="live-s"><span className="dot" style={{ ["--c" as string]: VEN[v].c }}></span>{VEN[v].name}</div>
              </div>
              <div className="live-v num">{usd(r.notionalUsd)}<div className="muted" style={{ fontWeight: 500, fontSize: 12 }}>{sgn(r.costBps)}</div></div>
            </li>
          );
        })}
        {!rows.length && <li className="muted" style={{ display: "block", fontSize: 13.5 }}>{fills.isError ? "Fills are unavailable right now." : fills.data ? "No fills yet." : "Loading fills…"}</li>}
      </ul>
    </aside>
  );
}
