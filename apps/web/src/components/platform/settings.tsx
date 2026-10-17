"use client";
/**
 * The Settings modal's state: slippage, deadline, routing, display and notifications. Saved per browser
 * (localStorage, best effort). "Simulate a session" is for dev and testnet builds only.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SessionName } from "@paritas/shared";
import { makeFmt, type Fmt, type Tz, type Unit } from "@/lib/format";
import { CHAIN_ID } from "@/lib/wagmi";

export interface Settings {
  slip: number; // bps
  deadline: number; // minutes
  pref: "best" | "nomaker" | "vault";
  tz: Tz;
  unit: Unit;
  notif: { fills: boolean; session: boolean };
  sim: SessionName | "live";
}

export const DEFAULTS: Settings = { slip: 30, deadline: 20, pref: "best", tz: "local", unit: "pct", notif: { fills: true, session: true }, sim: "live" };
export const CAN_SIMULATE = CHAIN_ID !== 4663;
const KEY = "paritas.settings.v1";

const Ctx = createContext<{ s: Settings; set: (p: Partial<Settings>) => void; fmt: Fmt } | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>(DEFAULTS);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (saved) setS({ ...DEFAULTS, ...saved, sim: "live" });
    } catch {
      /* private mode or bad JSON: defaults */
    }
  }, []);
  const set = (p: Partial<Settings>) =>
    setS((cur) => {
      const next = { ...cur, ...p };
      try {
        const { sim: _sim, ...keep } = next;
        localStorage.setItem(KEY, JSON.stringify(keep));
      } catch {
        /* ignore */
      }
      return next;
    });
  const fmt = useMemo(() => makeFmt(s.unit, s.tz), [s.unit, s.tz]);
  return <Ctx.Provider value={{ s, set, fmt }}>{children}</Ctx.Provider>;
}

export function useSettings() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSettings outside SettingsProvider");
  return c;
}
