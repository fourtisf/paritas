"use client";
import { SESSION_COPY } from "@paritas/shared";
import { previewVenues, useMarkets, useWalletlessQuote, VEN } from "./data";
import { nf, sgn } from "./format";
import { TokenMark } from "@/components/brand/TokenMark";

const SYM = "NVDAx";
const PAID = 10_000;

/** Section 03: an example receipt for a 10,000 USDG vault buy in regular hours, at the live price and inventory. */
export function ExampleReceipt() {
  const { bySym } = useMarkets();
  const m = bySym.get(SYM);
  const quote = useWalletlessQuote({ symbol: SYM, buy: true, amount: PAID });
  const p = previewVenues({ market: m, symbol: SYM, buy: true, amount: PAID, session: "regular", live: false, closedReason: "", quote });
  const v = p.vault.cost != null && p.vault.out != null ? p.vault : null;
  const pool = p.venues.find((x) => x.id === "pool");
  const saved = v && pool?.cost != null && pool.cost > v.cost! ? (PAID * (pool.cost - v.cost!)) / 1e4 : null;
  const L = (k: string, val: React.ReactNode, c = "") => <div className={"ln " + c} key={k}><span>{k}</span><i></i>{val}</div>;
  const dash = <span className="num">–</span>;
  return (
    <div className="rcpt glass" aria-label="Example trade receipt"><div className="foil"></div><div className="rc-b">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div><div className="muted" style={{ fontSize: 12.5 }}>Example receipt · live Chainlink price</div><div className="big-t">Bought {v ? nf(v.out!, 2) : "–"} {SYM}</div></div>
        <span className="tok" style={{ width: 46, height: 46, fontSize: 11 }}><TokenMark sym={SYM} /></span>
      </div>
      <div className="perf" aria-hidden="true"></div>
      <div className="lns" style={{ marginTop: 0 }}>
        {L("Route", <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--text)", fontWeight: 650 }}><span className="dot" style={{ ["--c" as string]: VEN.vault.c }}></span>{VEN.vault.name}</span>)}
        {L("Session", <span>{SESSION_COPY.regular.label}</span>)}
        {L("Share price (Chainlink)", p.mid ? <b className="num">{nf(p.mid)}</b> : dash)}
        {(v?.lines ?? [["Spread"], ["Inventory adjustment"], ["Protocol fee"]]).map(([k, bps]) => L(String(k), bps == null ? dash : <span className="num">{sgn(bps as number)}</span>))}
        {L("Your price", v && p.mid ? <b className="num">{nf(p.mid * (1 + v.cost! / 1e4))} USDG</b> : dash, "total")}
        {L("Paid", <span className="num">{nf(PAID, 2)} USDG</span>)}
        {saved != null ? L("Saved vs Uniswap", <span className="num up">{nf(saved, 2)} USDG</span>) : L("Cost vs share price", v ? <span className="num">{nf((PAID * v.cost!) / 1e4, 2)} USDG</span> : dash)}
      </div>
    </div></div>
  );
}
