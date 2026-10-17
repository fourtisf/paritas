"use client";
import { useEffect, useState } from "react";
import { sessionAt, nextSessionChange, sessionStartedAt, isHolidayAt, SESSION_COPY, HOLIDAY_COPY, SESSION_PARAMS } from "@paritas/shared";

/** The session dial. Same clock as the contract (never Intl). `sim` = Settings > "Simulate a session". */
export function useSession(sim: keyof typeof SESSION_PARAMS | "live" = "live") {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => clearInterval(id);
  }, []);
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
  };
}
