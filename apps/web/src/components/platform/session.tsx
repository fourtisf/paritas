"use client";
/** Session dial, its popover and the watchlist session card (prototype renderDial / sessInfo / .ses-card). */
import { useMemo } from "react";
import { sessionAt, SESSION_COPY, SESSION_PARAMS, type SessionName } from "@paritas/shared";
import { useSession } from "@/hooks/useSession";
import { dur, nf } from "@/lib/format";
import { Ring } from "./charts";
import { useSettings } from "./settings";

export const SESS_COLOR: Record<SessionName, string> = { regular: "var(--s-reg)", extended: "var(--s-ext)", overnight: "var(--s-ovn)", closed: "var(--s-wkd)" };

/** Spread and size multipliers as the prototype shows them (null when vaults are paused). */
export function sessionMul(s: SessionName) {
  const p = SESSION_PARAMS[s];
  return p.vaultOpen ? { mul: p.spreadMulBps / 10_000, clip: p.clipMulBps / 10_000 } : null;
}

/** The live (or simulated) session with its display bits. */
export function useSess() {
  const { s } = useSettings();
  const x = useSession(s.sim);
  const nextCopy = x.next ? SESSION_COPY[x.next.to] : null;
  const color = x.session === "closed" ? "var(--muted)" : SESS_COLOR[x.session];
  return { ...x, nextCopy, color, m: sessionMul(x.session) };
}

function nextRegularOpen(now: number) {
  let t = Math.ceil(now / 60) * 60;
  for (let i = 0; i < 60 * 24 * 8; i++, t += 60) if (sessionAt(t) === "regular") return t;
  return null;
}

export function DialFace() {
  const x = useSess();
  return (
    <>
      <Ring frac={x.progress} size={30} stroke={3.5} color={x.color} />
      <span>
        <span className="dial-t" style={{ display: "block" }}>
          {x.copy.short}
        </span>
        <span className="dial-s" style={{ display: "block" }} suppressHydrationWarning>
          {x.next && x.nextCopy ? `${x.nextCopy.short} in ${dur((x.next.at - x.now) * 1000)}` : "Simulated session"}
        </span>
      </span>
    </>
  );
}

export function DialPop() {
  const x = useSess();
  const { fmt } = useSettings();
  const open = useMemo(() => (x.session !== "regular" && !x.simulated ? nextRegularOpen(x.now) : null), [x.session, x.simulated, Math.floor(x.now / 60)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ padding: 10, maxWidth: 310 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 650 }}>
        <span className="dot" style={{ "--c": SESS_COLOR[x.session] } as React.CSSProperties} />
        {x.copy.label}
        {x.simulated && (
          <>
            {" "}
            <span className="chip" style={{ "--c": "var(--warn)" } as React.CSSProperties}>
              Simulated
            </span>
          </>
        )}
      </div>
      <p className="t2" style={{ fontSize: 13, margin: "8px 0 6px" }}>
        {x.copy.desc}
      </p>
      <dl className="kv">
        <div>
          <dt>Vault spread</dt>
          <dd>{x.m ? "×" + nf(x.m.mul, 1) : "Paused"}</dd>
        </div>
        <div>
          <dt>Largest vault order</dt>
          <dd>{x.m ? "×" + nf(x.m.clip, 2) : "None"}</dd>
        </div>
        {x.next && x.nextCopy && (
          <div>
            <dt>{x.nextCopy.label}</dt>
            <dd>{fmt.day(x.next.at * 1000)}</dd>
          </div>
        )}
        {open && (
          <div>
            <dt>Regular hours open</dt>
            <dd>{fmt.day(open * 1000)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function SessionCard() {
  const x = useSess();
  return (
    <div className="ses-card">
      <div className="ses-top">
        <Ring frac={x.progress} size={58} stroke={5} color={x.color} center={<b style={{ fontSize: 12 }}>{x.m ? "×" + nf(x.m.mul, 1) : "Off"}</b>} />
        <div>
          <div className="ses-t">{x.copy.label}</div>
          <div className="ses-s" suppressHydrationWarning>{x.next && x.nextCopy ? `${x.nextCopy.short} in ${dur((x.next.at - x.now) * 1000)}` : "Simulated in settings"}</div>
        </div>
      </div>
      <dl className="kv">
        <div>
          <dt>Vault spread</dt>
          <dd>{x.m ? "×" + nf(x.m.mul, 1) : "Paused"}</dd>
        </div>
        <div>
          <dt>Largest vault order</dt>
          <dd>{x.m ? "×" + nf(x.m.clip, 2) : "None"}</dd>
        </div>
      </dl>
    </div>
  );
}
