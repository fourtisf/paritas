"use client";
import { useEffect, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { announceRoute, previewVenues, useMarkets, useWalletlessQuote, VEN, type VenueView } from "./data";
import { nf, pct, sgn, usd } from "./format";
import { TokenMark } from "@/components/brand/TokenMark";

const CHIPS = ["NVDAx", "AAPLx", "SPYx", "TSLAx"];
const PRESETS = [1000, 10000, 50000, 250000];
const SESS_COLOR = { regular: "var(--s-reg)", extended: "var(--s-ext)", overnight: "var(--s-ovn)", closed: "var(--line-2)" } as const;

/** Section 01 quote card: the vault from the live price and reserves, Uniswap from POST /quote; makers need a wallet. */
export function QuoteCard() {
  const { bySym } = useMarkets();
  const live = useSession();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [sym, setSym] = useState("NVDAx");
  const [notional, setNotional] = useState(10000);
  const [preview, setPreview] = useState(false);
  const [text, setText] = useState<string | null>(null); // what the user is typing; null = show the formatted size

  const m = bySym.get(sym);
  const mid = m && m.mid > 0 ? m.mid : null;
  const buy = side === "buy";
  const session = preview ? "regular" : live.session;
  const amount = buy ? notional : mid ? notional / mid : 0;
  const closedReason = live.holiday ? "Paused for the market holiday" : "Paused for the weekend";
  const quote = useWalletlessQuote({ symbol: sym, buy, amount });
  const p = previewVenues({ market: m, symbol: sym, buy, amount, session, live: !preview || live.session === "regular", closedReason, quote });
  const best = p.best;

  useEffect(() => { announceRoute(best?.id ?? null); }, [best?.id]);

  const shown = text ?? (buy ? nf(amount, 0) : mid ? nf(amount, amount < 100 ? 4 : 2) : "");
  const onAmount = (s: string) => {
    setText(s);
    const a = parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
    setNotional(buy ? a : a * (mid ?? 0));
  };
  const L = (k: string, v: React.ReactNode, c = "") => <div className={"ln " + c} key={k}><span>{k}</span><i></i>{v}</div>;

  return (
    <form className="rcpt glass" id="qcard" aria-label="Quote preview" onSubmit={(e) => e.preventDefault()}>
      <div className="foil"></div>
      <div className="rc-b">
        <div className="rc-top">
          <span className="rc-ttl">Quote</span>
          <div className="seg side" role="group" aria-label="Direction">
            {(["buy", "sell"] as const).map((s) => (
              <button type="button" key={s} data-side={s} aria-pressed={side === s} onClick={() => { setSide(s); setText(null); }}>{s === "buy" ? "Buy" : "Sell"}</button>
            ))}
          </div>
        </div>
        <div className="chips" id="chips" role="group" aria-label="Market">
          {CHIPS.map((s) => (
            <button type="button" className="chip" key={s} data-sym={s} aria-pressed={s === sym} onClick={() => { setSym(s); setText(null); }}>
              <span className="tok" aria-hidden="true"><TokenMark sym={s} /></span>{s}
            </button>
          ))}
        </div>
        <div className="fld">
          <label className="fld-l" htmlFor="amount"><span>You pay</span><span id="payHint">{buy ? "Share price " + (mid ? nf(mid) : "–") : p.notional != null ? "≈ " + usd(Math.round(p.notional)) : ""}</span></label>
          <div className="fld-r">
            <input className="amt num" id="amount" inputMode="decimal" autoComplete="off" value={shown} onChange={(e) => onAmount(e.target.value)} onBlur={() => setText(null)} />
            <span className="unit" id="payUnit">{buy ? "USDG" : sym}</span>
          </div>
          <div className="presets" role="group" aria-label="Order size">
            {PRESETS.map((n) => <button type="button" className="preset" key={n} data-n={n} onClick={() => { setNotional(n); setText(null); }}>{usd(n)}</button>)}
          </div>
        </div>
        <div className="recv">
          <span className="muted" style={{ fontSize: 13 }}>You receive</span>
          <span className="recv-v num" id="out" aria-live="polite">{best ? <>{nf(best.out!, buy ? 4 : 2)}<small>{buy ? sym : "USDG"}</small></> : "–"}</span>
        </div>
        <div className="perf" aria-hidden="true"></div>
        <ul className="venues" id="venues" aria-label="Venues compared">
          {p.venues.map((r) => <VenueRow key={r.id} r={r} best={best?.id === r.id} tag={p.priced > 1} buy={buy} />)}
        </ul>
        <div className="lns" id="lines">
          {best && mid ? (
            <>
              {L("Share price (Chainlink)", <b className="num">{nf(mid)}</b>)}
              {best.lines?.map(([k, bps]) => L(k, <span className="num">{sgn(bps)}</span>))}
              {L("Your price via " + VEN[best.id].via, <b className="num">{nf(buy ? mid * (1 + best.cost! / 1e4) : mid * (1 - best.cost! / 1e4))}</b>, "total")}
            </>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>{!mid ? "Live prices are unavailable right now." : p.venues.some((v) => v.state === "wait") ? "Quoting…" : `Every venue is outside the ${pct(p.limitBps)} price limit or cannot fill this size. Try a smaller order.`}</p>
          )}
        </div>
        <div className="rc-ses">
          <span><span className="dot" id="sessDot" style={{ marginRight: 8, ["--c" as string]: SESS_COLOR[session] }}></span><span id="sessText">{preview ? "Showing regular-hours quotes" : "Now: " + live.copy.label.toLowerCase()}</span></span>
          <label className="switch"><input type="checkbox" id="previewOpen" checked={preview} onChange={(e) => setPreview(e.target.checked)} /><span className="switch-track" aria-hidden="true"></span>Preview market open</label>
        </div>
        <a className="btn btn-w rc-go" href="/app/trade">Continue in the app</a>
        <p className="rc-foot">Live prices from Chainlink and Uniswap. Maker quotes need a connected wallet.</p>
      </div>
    </form>
  );
}

function VenueRow({ r, best, tag, buy }: { r: VenueView; best: boolean; tag: boolean; buy: boolean }) {
  const cls = "vn " + (best ? "best" : r.state === "off" ? "off" : "");
  return (
    <li className={cls} data-v={r.id}>
      <span className="vn-d"></span>
      <span><span className="vn-n">{VEN[r.id].name}</span>{tag && <span className="tag">Best</span>}<br /><span className="vn-s">{r.sub}</span></span>
      <span className="vn-v num">
        {r.state === "ok" && r.cost != null && r.out != null ? <>{nf(r.out, buy ? 4 : 2)}<small>{sgn(r.cost)} vs share</small></>
          : r.cost != null ? <>Not routed<small>{sgn(r.cost)} vs share</small></>
          : "–"}
      </span>
    </li>
  );
}
