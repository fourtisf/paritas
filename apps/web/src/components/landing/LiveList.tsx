"use client";
import { useMarkets, useLatestFills, useWalletlessQuote, previewVenues, mainVenue, stockAmount, VEN, type ApiMarket } from "./data";
import { nf, sgn, usd } from "./format";
import { TokenMark } from "@/components/brand/TokenMark";

const QUOTE_USD = 100; // the order each live quote prices while there are no fills yet

/** One market's best route right now for a QUOTE_USD buy (POST /quote without a wallet, refreshed every 15 s). */
function LiveQuote({ m }: { m: ApiMarket }) {
  const quote = useWalletlessQuote({ symbol: m.symbol, buy: true, amount: QUOTE_USD });
  const p = previewVenues({ market: m, symbol: m.symbol, buy: true, amount: QUOTE_USD, session: quote?.session ?? "regular", live: true, closedReason: "Vault paused", quote });
  const b = quote ? p.best : null;
  return (
    <li>
      <span className="tok" aria-hidden="true"><TokenMark sym={m.symbol} /></span>
      <div style={{ minWidth: 0 }}>
        <div className="live-t">{b ? `Buy ${nf(b.out!, 2)} ${m.symbol}` : m.symbol}</div>
        <div className="live-s">
          {b ? <><span className="dot" style={{ ["--c" as string]: VEN[b.id].c }}></span>{VEN[b.id].name}</> : quote ? "No route right now" : "Pricing…"}
        </div>
      </div>
      <div className="live-v num">{usd(QUOTE_USD)}<div className="muted" style={{ fontWeight: 500, fontSize: 12 }}>{b ? sgn(b.cost!) : "–"}</div></div>
    </li>
  );
}

/** Hero card: the latest fills routed on Paritas (GET /fills). Until there are any, the best route right now for a
 *  small buy in the first markets, from live quotes: real prices, never made-up fills. */
export function LiveList() {
  const { list } = useMarkets();
  const fills = useLatestFills(4);
  const symOf = new Map(list.map((m) => [m.token.toLowerCase(), m.symbol]));
  const rows = (fills.data ?? []).filter((r) => symOf.has(r.stock.toLowerCase()) && r.fills.length);
  const quoting = !!fills.data && !rows.length && list.length > 0;
  return (
    <aside className="live" aria-label={quoting ? "Best route right now" : "Recently routed trades"}>
      <div className="live-h">{quoting ? <><b>Best route now</b><span>Live quotes</span></> : <><b>Just routed</b><span>Latest fills</span></>}</div>
      <ul className="live-list" id="liveList" aria-live="off">
        {rows.map((r) => {
          const sym = symOf.get(r.stock.toLowerCase())!;
          const v = mainVenue(r);
          return (
            <li key={r.id}>
              <span className="tok" aria-hidden="true"><TokenMark sym={sym} /></span>
              <div style={{ minWidth: 0 }}>
                <div className="live-t">{r.buy ? "Bought" : "Sold"} {nf(stockAmount(r.buy ? r.amountOut : r.amountIn), 2)} {sym}</div>
                <div className="live-s"><span className="dot" style={{ ["--c" as string]: VEN[v].c }}></span>{VEN[v].name}</div>
              </div>
              <div className="live-v num">{usd(r.notionalUsd)}<div className="muted" style={{ fontWeight: 500, fontSize: 12 }}>{sgn(r.costBps)}</div></div>
            </li>
          );
        })}
        {quoting && list.slice(0, 4).map((m) => <LiveQuote key={m.symbol} m={m} />)}
        {!rows.length && !quoting && <li className="muted" style={{ display: "block", fontSize: 13.5 }}>{fills.isError ? "Fills are unavailable right now." : fills.data ? "No fills yet." : "Loading fills…"}</li>}
      </ul>
    </aside>
  );
}
