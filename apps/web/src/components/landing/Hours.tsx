"use client";
import { useEffect, useState } from "react";
import { SESSION_COPY, SESSION_PARAMS, sessionAt, type SessionName } from "@paritas/shared";
import { useSession } from "@/hooks/useSession";
import { clamp, dur, nf } from "./format";

const COLOR: Record<SessionName, string> = { regular: "var(--s-reg)", extended: "var(--s-ext)", overnight: "var(--s-ovn)", closed: "var(--line-2)" };
const times = (bps: number) => (bps === 20_000 ? "double" : nf(bps / 10_000, 1) + " times its regular");
const DESC: Record<SessionName, string> = {
  regular: "The vault is quoting at its tightest spread.",
  extended: `The vault is quoting at ${times(SESSION_PARAMS.extended.spreadMulBps)} spread.`,
  overnight: `The vault is quoting at ${times(SESSION_PARAMS.overnight.spreadMulBps)} spread with smaller orders.`,
  closed: "The vault is paused. Uniswap pools and market makers are still quoting.",
};
// Display only: times are shown in the visitor's zone. Which session a moment belongs to always comes from sessions.ts.
const lf = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/** Next time regular hours begin, in unix seconds (5-minute steps, like the prototype). */
function nextRegular(fromSec: number) {
  let t = Math.ceil(fromSec / 300) * 300;
  for (let i = 0; i < 2400; i++, t += 300) if (sessionAt(t) === "regular") return t;
  return null;
}

/** The visitor's time zone name, filled in after mount. */
export function TzName() {
  const [s, setS] = useState("your local time");
  useEffect(() => {
    const p = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date());
    const short = p.find((x) => x.type === "timeZoneName")?.value ?? "";
    const long = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    setS((long ? long.replace(/_/g, " ") : "local time") + (short ? " (" + short + ")" : ""));
  }, []);
  return <span id="tzName">{s}</span>;
}

/** "Right now" row: the session dial from useSession (the contract's clock). */
export function HoursNow() {
  const mounted = useMounted();
  const live = useSession();
  const now = live.now * 1000;
  const r = 26, c = 2 * Math.PI * r;
  const nxt = live.next;
  const open = live.session === "regular" ? null : nxt?.to === "regular" ? nxt.at : nextRegular(nxt?.at ?? now / 1000);
  return (
    <div className="hs glass" aria-live="polite">
      <div className="hs-ring" id="hsRing">
        {mounted && (
          <svg width="60" height="60" viewBox="0 0 60 60" aria-hidden="true">
            <circle cx="30" cy="30" r={r} fill="none" stroke="var(--line-2)" strokeWidth="5" />
            <circle cx="30" cy="30" r={r} fill="none" stroke={live.session === "closed" ? "url(#silver)" : COLOR[live.session]} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(c * clamp(live.progress, 0.02, 1)).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 30 30)" />
          </svg>
        )}
      </div>
      <div>
        <div className="hs-now" id="hsNow">{mounted && "Right now: " + live.copy.label.toLowerCase()}</div>
        <div className="hs-d" id="hsD">{mounted && DESC[live.session]}</div>
      </div>
      <div className="hs-n" id="hsN">
        {mounted && nxt && <>{SESSION_COPY[nxt.to].label} starts <b>{lf.format(nxt.at * 1000)}</b>, in {dur(nxt.at * 1000 - now)}</>}
        {mounted && open && open !== nxt?.at && <><br />Regular hours open <b>{lf.format(open * 1000)}</b></>}
      </div>
    </div>
  );
}

/** This week in the visitor's time zone, one cell per half hour, with "now" on the contract's clock. */
export function Week() {
  const mounted = useMounted();
  const nowMs = useSession().now * 1000;
  if (!mounted) return <div className="week glass" id="week" role="img" aria-label="Weekly chart of US market sessions in your local time"></div>;
  const now = new Date(nowMs);
  const di = (now.getDay() + 6) % 7;
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - di);
  return (
    <div className="week glass" id="week" role="img" aria-label="Weekly chart of US market sessions in your local time">
      <div className="wk-h"><span></span><div><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>
      {DAYS.map((name, row) => {
        const today = row === di;
        return (
          <div className={"wk-r" + (today ? " today" : "")} key={name}>
            <span className="wk-d">{name}</span>
            <div className="wk-c">
              {Array.from({ length: 48 }, (_, k) => {
                const s = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + row, 0, k * 30).getTime();
                return <span key={k} className={"cell" + (s + 18e5 <= nowMs ? " past" : "")} data-r={sessionAt((s + 9e5) / 1000)}></span>;
              })}
              {today && <span className="now" style={{ left: (((now.getHours() * 60 + now.getMinutes()) / 1440) * 100).toFixed(3) + "%" }}></span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
