"use client";
import { sessionAt, nextSessionChange, sessionStartedAt, isHolidayAt, SESSION_COPY, HOLIDAY_COPY, SESSION_PARAMS } from "@paritas/shared";
import { useChainNow } from "./useChainNow";

/** The session dial. Same clock as the contract (chain time, never Intl). `sim` = Settings > "Simulate a session". */
export function useSession(sim: keyof typeof SESSION_PARAMS | "live" = "live") {
  const now = useChainNow(30_000);
  const session = sim === "live" ? sessionAt(now) : sim;
  const holiday = sim === "live" && session === "closed" && isHolidayAt(now);
  const next = sim === "live" ? nextSessionChange(now) : null;
  const start = sim === "live" ? sessionStartedAt(now) : null;
  return {
    session,
    copy: holiday ? HOLIDAY_COPY : SESSION_COPY[session],
    params: SESSION_PARAMS[session],
    next,
    progress: next && start ? (now - start) / (next.at - start) : 0.5,
    simulated: sim !== "live",
    holiday,
    now,
  };
}
