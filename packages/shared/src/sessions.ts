/**
 * New York market sessions. Line-by-line port of contracts/src/libraries/SessionLib.sol and
 * SessionController.sessionAt. Checked against spec/vectors/sessions.json (generated from Python's
 * IANA tz database) in test/vectors.test.ts. If you change the rules, change Solidity, this file and
 * spec/generate_vectors.py together, then regenerate the vectors.
 *
 * Never use the browser's Intl time zone for trading logic: the contract does not, and the two can
 * disagree if the IANA database or US DST law changes. Intl is fine for *displaying* local time.
 */
import holidays from "../../../config/holidays.json";

/** Same order as the Solidity enum `Session`. */
export const SESSIONS = ["regular", "extended", "overnight", "closed"] as const;
export type SessionName = (typeof SESSIONS)[number];
export type SessionIndex = 0 | 1 | 2 | 3;

export const DAY = 86_400;
const PRE_OPEN = 240; // 04:00
const OPEN = 570; // 09:30
const CLOSE = 960; // 16:00
const EARLY_CLOSE = 780; // 13:00
const POST_CLOSE = 1200; // 20:00

/** Copy shown in the app. Matches the prototype's SESS table; `closed` replaces the prototype's `weekend`. */
export const SESSION_COPY: Record<SessionName, { label: string; short: string; desc: string }> = {
  regular: {
    label: "Regular hours",
    short: "Market open",
    desc: "US markets are open. Vaults quote at their tightest spread and full order size.",
  },
  extended: {
    label: "Extended hours",
    short: "Extended",
    desc: "Pre-market or after-hours. Vault spread is 1.5 times wider and the largest order drops to 75%.",
  },
  overnight: {
    label: "Overnight",
    short: "Overnight",
    desc: "Overnight session. Vault spread doubles and the largest order halves.",
  },
  closed: {
    label: "Weekend",
    short: "Weekend",
    desc: "US markets are closed. Vaults are paused; Uniswap pools and market makers keep filling.",
  },
};
/** Use instead of the `closed` copy when the closed day is a market holiday. */
export const HOLIDAY_COPY = {
  label: "Market holiday",
  short: "Holiday",
  desc: "US markets are closed for a holiday. Vaults are paused; Uniswap pools and market makers keep filling.",
};

export interface Calendar {
  holidays: ReadonlySet<number>;
  earlyCloses: ReadonlySet<number>;
}

/** The calendar in config/holidays.json. On-chain values must match (the indexer checks HolidaySet events). */
export const DEFAULT_CALENDAR: Calendar = {
  holidays: new Set(holidays.holidayDays),
  earlyCloses: new Set(holidays.earlyCloseDays),
};

// Integer helpers: every value here is a non-negative integer < 2^53, so plain numbers are exact
// as long as we floor every division (Solidity uint division).
const idiv = (a: number, b: number) => Math.floor(a / b);

export function daysFromCivil(y: number, m: number, d: number): number {
  if (m <= 2) y -= 1;
  const era = idiv(y, 400);
  const yoe = y - era * 400;
  const mp = m > 2 ? m - 3 : m + 9;
  const doy = idiv(153 * mp + 2, 5) + d - 1;
  const doe = yoe * 365 + idiv(yoe, 4) - idiv(yoe, 100) + doy;
  return era * 146_097 + doe - 719_468;
}

export function yearOfDay(z: number): number {
  z += 719_468;
  const era = idiv(z, 146_097);
  const doe = z - era * 146_097;
  const yoe = idiv(doe - idiv(doe, 1460) + idiv(doe, 36_524) - idiv(doe, 146_096), 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + idiv(yoe, 4) - idiv(yoe, 100));
  const mp = idiv(5 * doy + 2, 153);
  const m = mp < 10 ? mp + 3 : mp - 9;
  return m <= 2 ? y + 1 : y;
}

/** 0 = Sunday ... 6 = Saturday. */
export const weekday = (day: number) => (day + 4) % 7;

function nthSunday(y: number, m: number, n: number): number {
  const first = daysFromCivil(y, m, 1);
  return first + ((7 - weekday(first)) % 7) + (n - 1) * 7;
}

export function isDst(ts: number): boolean {
  const y = yearOfDay(idiv(ts, DAY));
  const start = nthSunday(y, 3, 2) * DAY + 7 * 3600;
  const end = nthSunday(y, 11, 1) * DAY + 6 * 3600;
  return ts >= start && ts < end;
}

/** Unix seconds -> New York local day index and minute of day. */
export function toNewYork(ts: number): { day: number; minute: number } {
  const local = ts - (isDst(ts) ? 4 * 3600 : 5 * 3600);
  return { day: idiv(local, DAY), minute: idiv(local % DAY, 60) };
}

export function isTradingDay(day: number, cal: Calendar = DEFAULT_CALENDAR): boolean {
  const wd = weekday(day);
  return wd >= 1 && wd <= 5 && !cal.holidays.has(day);
}

export function sessionIndexAt(ts: number, cal: Calendar = DEFAULT_CALENDAR): SessionIndex {
  const { day, minute } = toNewYork(Math.floor(ts));
  const nextTrades = isTradingDay(day + 1, cal);
  if (!isTradingDay(day, cal)) return minute >= POST_CLOSE && nextTrades ? 2 : 3;
  if (minute < PRE_OPEN) return 2;
  if (minute < OPEN) return 1;
  const close = cal.earlyCloses.has(day) ? EARLY_CLOSE : CLOSE;
  if (minute < close) return 0;
  if (minute < POST_CLOSE) return 1;
  return nextTrades ? 2 : 3;
}

export const sessionAt = (ts: number, cal: Calendar = DEFAULT_CALENDAR): SessionName => SESSIONS[sessionIndexAt(ts, cal)];

export function isHolidayAt(ts: number, cal: Calendar = DEFAULT_CALENDAR): boolean {
  return cal.holidays.has(toNewYork(ts).day);
}

/** Next instant (unix seconds, minute precision) when the session changes, for the session dial. */
export function nextSessionChange(ts: number, cal: Calendar = DEFAULT_CALENDAR): { at: number; to: SessionName } | null {
  const cur = sessionIndexAt(ts, cal);
  let t = Math.ceil(ts / 60) * 60;
  for (let i = 0; i < 60 * 24 * 8; i++, t += 60) {
    const s = sessionIndexAt(t, cal);
    if (s !== cur) return { at: t, to: SESSIONS[s] };
  }
  return null;
}

/** When the current session began (minute precision), for the dial's progress ring. */
export function sessionStartedAt(ts: number, cal: Calendar = DEFAULT_CALENDAR): number {
  const cur = sessionIndexAt(ts, cal);
  let t = Math.floor(ts / 60) * 60;
  for (let i = 0; i < 60 * 24 * 8; i++, t -= 60) {
    if (sessionIndexAt(t - 60, cal) !== cur) return t;
  }
  return ts - DAY;
}
