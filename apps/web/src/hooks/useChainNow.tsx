"use client";
/**
 * Chain time for the UI: the contracts judge sessions, deadlines and quote expiry by block.timestamp, so the app
 * does too. On mainnet this is the wall clock; on anvil it is whatever --timestamp set. We keep the best offset
 * seen (block timestamps only ever lag the chain's "now") and reset it if the chain jumps (an anvil restart).
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlock } from "wagmi";

const Ctx = createContext<{ offset: number; seeded: boolean }>({ offset: 0, seeded: false }); // offset: seconds to add to Date.now()/1000

export function ChainClockProvider({ children }: { children: ReactNode }) {
  const { data: block } = useBlock({ watch: true });
  const [offset, setOffset] = useState(0);
  const [isSeeded, setSeeded] = useState(false);
  const seeded = useRef(false);
  useEffect(() => {
    if (!block) return;
    const o = Number(block.timestamp) - Date.now() / 1000;
    setOffset((cur) => {
      if (!seeded.current || Math.abs(o - cur) > 120) {
        seeded.current = true;
        return o;
      }
      return Math.max(cur, o);
    });
    setSeeded(true);
  }, [block]);
  return <Ctx.Provider value={{ offset, seeded: isSeeded }}>{children}</Ctx.Provider>;
}

/** Chain "now" in seconds, re-rendering every `everyMs`. */
export function useChainNow(everyMs = 30_000) {
  const { offset } = useContext(Ctx);
  // start on the minute so the server render and the first client render agree (hydration)
  const [wall, setWall] = useState(() => Math.floor(Date.now() / 60_000) * 60);
  useEffect(() => {
    setWall(Date.now() / 1000);
    const id = setInterval(() => setWall(Date.now() / 1000), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return wall + offset;
}

/** False until the first block arrived (before that, "now" is the wall clock). */
export const useClockSeeded = () => useContext(Ctx).seeded;
