/** Formatting and guilloché helpers for the landing page, same output as the prototype's inline script. */
export const nf = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const usd = (n: number) => "$" + (n >= 1e6 ? nf(n / 1e6, n % 1e6 ? 2 : 0) + "M" : n >= 1000 ? nf(n / 1000, n % 1000 ? 1 : 0) + "k" : nf(n, 0));
export const pct = (bps: number) => nf(Math.abs(bps) / 100, 2) + "%";
export const sgn = (bps: number) => (bps < 0 ? "−" : "+") + nf(Math.abs(bps) / 100, 2) + "%";
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const dur = (ms: number) => {
  const m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
};
/** Ticker label on a coin: "NVDAx" -> "NVDA". */
export const ticker = (sym: string) => sym.replace(/x$/, "");

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** Hypotrochoid path (the guilloché rosette in the logo and the no-WebGL poster). */
export function hypo(R: number, r: number, d: number, radius: number, steps: number) {
  const k = (R - r) / r, T = Math.PI * 2 * (r / gcd(R, r)), sc = radius / (R - r + d);
  let s = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * T;
    s += (i ? "L" : "M") + (((R - r) * Math.cos(t) + d * Math.cos(k * t)) * sc).toFixed(2) + " " + (((R - r) * Math.sin(t) - d * Math.sin(k * t)) * sc).toFixed(2);
  }
  return s;
}
