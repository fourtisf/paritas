/**
 * Number, cost and time formatting, ported from the prototype (nf, compact, fmtCost, fmtTime, ago, ...).
 * Display only: amounts arrive as bigint and are converted here, never used for logic.
 */
export const nf = (n: number, d = 2) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export const compact = (n: number) => {
  const a = Math.abs(n);
  return a >= 1e9 ? nf(n / 1e9, 2) + "B" : a >= 1e6 ? nf(n / 1e6, 2) + "M" : a >= 1e4 ? nf(n / 1e3, n % 1000 ? 1 : 0) + "K" : nf(n, a >= 100 ? 0 : 2);
};

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const sum = <T,>(arr: T[], f: (x: T) => number) => arr.reduce((a, x) => a + f(x), 0);
export const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
export const fmtPct = (bps: number) => nf(Math.abs(bps) / 100, 2) + "%";
export const signedPct = (pct: number) => (pct >= 0 ? "+" : "−") + nf(Math.abs(pct)) + "%";

/** Minutes to "2d 4h" / "3h 12m" / "8m". */
export const dur = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
};

/** Relative time against `now` (ms). `now` is chain time so it agrees with block timestamps. */
export const ago = (t: number, now: number) => {
  const s = (now - t) / 1000;
  if (s < 60) return Math.max(1, Math.round(s)) + "s ago";
  if (s < 3600) return Math.round(s / 60) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
};

/** Raw token units to a JS number for display (never for math). */
export const units = (raw: bigint | string | number | null | undefined, decimals: number) => {
  if (raw == null) return 0;
  const b = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  return Number(b / base) + Number(b % base) / Number(base);
};

export type Unit = "pct" | "bps";
export type Tz = "local" | "utc" | "ny";

/** Formatters bound to the user's display settings (Settings > Display). */
export function makeFmt(unit: Unit, tz: Tz) {
  const timeZone = tz === "utc" ? "UTC" : tz === "ny" ? "America/New_York" : undefined;
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { ...o, timeZone });
  const time = f({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const dt = f({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const day = f({ weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const shortDate = f({ day: "numeric", month: "short" });
  return {
    cost(bps: number, signed = false) {
      const s = signed ? (bps < 0 ? "−" : "+") : bps < 0 ? "−" : "";
      return unit === "bps" ? s + nf(Math.abs(bps), Math.abs(bps) < 10 ? 1 : 0) + " bps" : s + nf(Math.abs(bps) / 100, 2) + "%";
    },
    time: (t: number | Date) => time.format(t),
    dt: (t: number | Date) => dt.format(t),
    day: (t: number | Date) => day.format(t),
    date: (t: number | Date) => date.format(t),
    shortDate: (t: number | Date) => shortDate.format(t),
  };
}
export type Fmt = ReturnType<typeof makeFmt>;
