"use client";
import { useEffect, useState } from "react";
import type { SessionName } from "@paritas/shared";
import { useSession } from "@/hooks/useSession";
import { announceRoute, previewVenues, useMarkets, useWalletlessQuote, VEN } from "./data";
import { clamp, pct, sgn, usd } from "./format";

const LAB_MARKETS = ["NVDAx", "SPYx", "TSLAx"];
const LAB_SESSIONS: [SessionName, string][] = [["regular", "Open"], ["extended", "Extended"], ["overnight", "Night"], ["closed", "Weekend"]];

/** Slider position (0..1000) to a round order size between $500 and $1M, log scale. */
function sizeFromR(v: number) {
  const lo = Math.log(500), hi = Math.log(1e6);
  const raw = Math.exp(lo + ((hi - lo) * v) / 1000);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return Math.round(raw / mag) * mag;
}

const Check = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
const Alert = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 8v5M12 16v.01" /><circle cx="12" cy="12" r="9" /></svg>;

/** Section 02 router lab: live vault and Uniswap prices for any size, checked against the chosen session's limit. */
export function RouterLab() {
  const { bySym } = useMarkets();
  const live = useSession();
  const [rv, setRv] = useState(380);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [sym, setSym] = useState("SPYx");
  const [sess, setSess] = useState<SessionName>("regular");

  const size = sizeFromR(rv);
  const m = bySym.get(sym);
  const mid = m && m.mid > 0 ? m.mid : null;
  const buy = side === "buy";
  const amount = buy ? size : mid ? size / mid : 0;
  const quote = useWalletlessQuote({ symbol: sym, buy, amount });
  const p = previewVenues({ market: m, symbol: sym, buy, amount, session: sess, live: sess === live.session, closedReason: "Paused for the weekend", quote });
  const best = p.best;
  const ranked = p.venues.filter((v) => v.state === "ok" && v.cost != null).sort((a, b) => a.cost! - b.cost!);
  const next = ranked.find((v) => v.id !== best?.id);
  const band = p.limitBps, span = band * 1.4;
  const X = (bps: number) => clamp(50 + ((buy ? bps : -bps) / span) * 50, 2, 98);
  const bandL = 50 - (band / span) * 50, bandW = (band / span) * 100;

  useEffect(() => { announceRoute(best?.id ?? null); }, [best?.id]);

  return (
    <div className="lab glass">
      <div className="lab-c">
        <div>
          <div className="lab-l"><span>Order size</span><b className="num" id="labSize">{usd(size)}</b></div>
          <input className="range" id="labRange" type="range" min="0" max="1000" value={rv} aria-label="Order size" style={{ ["--p" as string]: rv / 10 + "%" }} onChange={(e) => setRv(+e.target.value)} />
          <div className="ticks"><span>$500</span><span>$10k</span><span>$100k</span><span>$1M</span></div>
        </div>
        <div>
          <div className="lab-l"><span>Direction</span></div>
          <div className="seg side" role="group" aria-label="Direction">
            {(["buy", "sell"] as const).map((s) => <button type="button" key={s} data-lside={s} aria-pressed={side === s} onClick={() => setSide(s)}>{s === "buy" ? "Buy" : "Sell"}</button>)}
          </div>
        </div>
        <div>
          <div className="lab-l"><span>Market</span></div>
          <div className="seg" role="group" aria-label="Market" id="labMk">
            {LAB_MARKETS.map((s) => <button type="button" key={s} data-lmk={s} aria-pressed={sym === s} onClick={() => setSym(s)}>{s}</button>)}
          </div>
        </div>
        <div>
          <div className="lab-l"><span>Session</span></div>
          <div className="seg" role="group" aria-label="Session" id="labSess">
            {LAB_SESSIONS.map(([k, l]) => <button type="button" key={k} data-lsess={k} aria-pressed={sess === k} onClick={() => setSess(k)}>{l}</button>)}
          </div>
        </div>
      </div>
      <div className="lab-v">
        <div id="ladder">
          {p.venues.map((r) => {
            const isBest = best?.id === r.id;
            const cls = ["lane", isBest && "best", r.state === "off" && "off", r.cost == null && "gone"].filter(Boolean).join(" ");
            return (
              <div className={cls} key={r.id} style={{ ["--c" as string]: VEN[r.id].c }}>
                <div className="lane-n"><span className="dot" style={{ ["--c" as string]: VEN[r.id].c }}></span><span className="nm">{VEN[r.id].name}</span></div>
                <div className="lane-t"><span className="band" style={{ left: bandL + "%", width: bandW + "%" }}></span><span className="zero" style={{ left: "50%" }}></span><span className="mark" style={{ left: (r.cost != null ? X(r.cost) : 50) + "%" }}></span></div>
                <div className="lane-v">
                  {r.cost != null ? <span className="num">{sgn(r.cost)}</span> : "–"}
                  <small>{r.state === "ok" ? (isBest ? "Best price" : "Quoted") : r.state === "wait" ? "Quoting…" : r.sub}</small>
                </div>
              </div>
            );
          })}
          <div className="axis">
            <span></span>
            <div className="axis-t"><span style={{ left: bandL + "%" }}>{buy ? "−" : "+"}{pct(band)}</span><span style={{ left: "50%" }}>Share price</span><span style={{ left: bandL + bandW + "%" }}>{buy ? "+" : "−"}{pct(band)}</span></div>
            <span className="muted" style={{ fontSize: 12, textAlign: "right" }}>Price limit</span>
          </div>
        </div>
        <div className="verdict" id="verdict" aria-live="polite">
          {!mid ? (
            <><span className="verdict-i"><Alert /></span><div><div className="verdict-t">Live prices are unavailable</div><div className="verdict-s">Open the app for a live quote.</div></div><div className="verdict-n">–</div></>
          ) : best ? (
            <><span className="verdict-i"><Check /></span><div><div className="verdict-t">Filled by {VEN[best.id].via}, {pct(best.cost!)} from the share price</div><div className="verdict-s">{next ? `Beats ${VEN[next.id].name.toLowerCase()} by ${pct(next.cost! - best.cost!)} on this order.` : "The only venue that can fill this order inside the limit."}</div></div><div className="verdict-n num">{usd(Math.round(((p.notional ?? 0) * (next ? next.cost! - best.cost! : best.cost!)) / 1e4))}<small>{next ? "saved vs next best" : "total cost"}</small></div></>
          ) : p.venues.some((v) => v.state === "wait") ? (
            <><span className="verdict-i"><Alert /></span><div><div className="verdict-t">Quoting…</div><div className="verdict-s">The router checks all three venues.</div></div><div className="verdict-n">–</div></>
          ) : (
            <><span className="verdict-i"><Alert /></span><div><div className="verdict-t">No venue fits inside the limit</div><div className="verdict-s">The router refuses the trade rather than fill you badly. Try a smaller size.</div></div><div className="verdict-n">–</div></>
          )}
        </div>
      </div>
    </div>
  );
}
