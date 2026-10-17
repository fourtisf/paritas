"use client";
/** Small shared pieces: venue names and chips, side text, live price flash, explorer links (prototype helpers). */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { explorerTx, type VenueId } from "@paritas/shared";
import { CHAIN_ID } from "@/lib/wagmi";
import { nf, short } from "@/lib/format";
import { Icon } from "./Icon";
import { useUI } from "./ui";

export const VENUES: Record<VenueId, { name: string; via: string; short: string; c: string; hex: string }> = {
  vault: { name: "Paritas vault", via: "the Paritas vault", short: "Vault", c: "var(--v-vault)", hex: "#F5F5F7" },
  pool: { name: "Uniswap pool", via: "Uniswap", short: "Uniswap", c: "var(--v-pool)", hex: "#A3A3AC" },
  rfq: { name: "Market maker", via: "a market maker", short: "Market", c: "var(--v-rfq)", hex: "#8CA8CC" },
};

export const cssVar = (k: string, v: string) => ({ [k]: v }) as CSSProperties;

export const VenueChip = ({ v }: { v: VenueId }) => (
  <span className="chip" style={cssVar("--c", VENUES[v].c)}>
    <span className="dot" style={cssVar("--c", VENUES[v].c)} />
    {VENUES[v].name}
  </span>
);

export const SideTxt = ({ s }: { s: "buy" | "sell" }) => (
  <span className={s === "buy" ? "up" : "down"} style={{ fontWeight: 650 }}>
    {s === "buy" ? "Buy" : "Sell"}
  </span>
);

export const Chg = ({ v, style }: { v: number; style?: CSSProperties }) => (
  <span className={v >= 0 ? "up" : "down"} style={{ fontWeight: 650, ...style }}>
    {v >= 0 ? "+" : "−"}
    {nf(Math.abs(v))}%
  </span>
);

/** A price that flashes up or down when it changes (prototype [data-live]). */
export function LivePx({ v, className = "num" }: { v: number | undefined; className?: string }) {
  const prev = useRef(v);
  const [color, setColor] = useState<string | undefined>();
  useEffect(() => {
    if (v == null || prev.current == null || nf(v) === nf(prev.current)) {
      prev.current = v;
      return;
    }
    setColor(v >= prev.current ? "var(--up)" : "var(--down)");
    prev.current = v;
    const t = setTimeout(() => setColor(undefined), 700);
    return () => clearTimeout(t);
  }, [v]);
  return (
    <b className={className} style={{ transition: "color .6s", color }}>
      {v == null ? "–" : nf(v)}
    </b>
  );
}

/** "View 0x12…ab on Blockscout": opens the explorer, or says why there is none (local chain). */
export function ExplorerButton({ tx, className = "btn btn-line btn-block", style }: { tx: string; className?: string; style?: CSSProperties }) {
  const ui = useUI();
  const href = explorerTx(CHAIN_ID, tx);
  if (href) {
    return (
      <a className={className} href={href} target="_blank" rel="noreferrer" style={style}>
        <Icon n="ext" />
        View {short(tx)} on Blockscout
      </a>
    );
  }
  return (
    <button className={className} style={style} onClick={() => ui.toast("No block explorer", "This is a local chain. On testnet and mainnet this opens the transaction on Blockscout.", "info")}>
      <Icon n="ext" />
      View {short(tx)} on Blockscout
    </button>
  );
}

export function useNarrow(px = 900) {
  const [n, setN] = useState(false);
  useEffect(() => {
    const q = matchMedia(`(max-width:${px - 0.02}px)`);
    const f = () => setN(q.matches);
    f();
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, [px]);
  return n;
}

/** The prototype's ln() row: label, dotted leader, value. */
export const Ln = ({ k, children, cls = "" }: { k: React.ReactNode; children: React.ReactNode; cls?: string }) => (
  <div className={`ln ${cls}`.trim()}>
    <span>{k}</span>
    <i />
    {children}
  </div>
);
