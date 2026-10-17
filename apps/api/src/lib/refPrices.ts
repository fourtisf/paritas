/**
 * Reference share prices from Pyth, for display only. The website shows them for markets that are not live on this
 * chain yet, labelled "Reference prices from Pyth". Quotes, price limits and the vaults never read them: those use the
 * Chainlink feeds on-chain.
 *
 * Feeds are found by symbol through Hermes ("Equity.US.NVDA/USD", plus any session variant such as ".PRE" or ".ON"),
 * never hard-coded. Prices come from the Hermes stream when Hermes serves updates. When it answers 401/403 (its price
 * updates need an access key; PYTH_HERMES_URL can point at a keyed endpoint), they come from Pyth Benchmarks instead:
 * 1-minute bars polled every 15 s, and the last daily close while the market is shut. The change is against the
 * previous daily close. Without either source the endpoint answers nulls and the website shows "–".
 */
import { MARKETS } from "@paritas/shared";
import { env } from "./env";

type Log = { info(m: string): void; warn(m: string): void };
type Parsed = { id: string; price: { price: string; expo: number; publish_time: number } };
type Bars = { s: string; t?: number[]; c?: number[] };

const latest = new Map<string, { price: number; publishTime: number }>(); // market symbol -> freshest price
const prevClose = new Map<string, number>(); // market symbol -> previous daily close
const feedToSym = new Map<string, string>(); // Hermes feed id (hex, no 0x) -> market symbol
const regularSymbol = new Map<string, string>(); // market symbol -> "Equity.US.NVDA/USD" (for Benchmarks)
let hermesUpdates = true; // false while Hermes refuses price updates without a key

const ticker = (sym: string) => sym.replace(/x$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

class HttpError extends Error {
  constructor(readonly status: number, path: string, readonly body: string) {
    super(`${path}: ${status}${body ? ` ${body}` : ""}`);
  }
}
const refused = (e: unknown) => e instanceof HttpError && (e.status === 401 || e.status === 403);

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new HttpError(r.status, new URL(url).pathname, (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200));
  return r.json() as Promise<T>;
}

// Each distinct problem is logged once, so a refusing endpoint does not flood the logs every 15 s.
const said = new Set<string>();
const warnOnce = (log: Log, m: string) => said.has(m) || (said.add(m), log.warn(m));

function setPrice(sym: string, price: number, publishTime: number) {
  const cur = latest.get(sym);
  if (price > 0 && (!cur || publishTime >= cur.publishTime)) latest.set(sym, { price, publishTime });
}

function apply(items: Parsed[] | undefined) {
  for (const it of items ?? []) {
    const sym = feedToSym.get(it.id.replace(/^0x/, ""));
    if (sym) setPrice(sym, Number(it.price.price) * 10 ** it.price.expo, it.price.publish_time);
  }
}

async function discover() {
  // All or nothing: a lookup that fails half way leaves no partial feed list behind.
  const ids = new Map<string, string>(), regular = new Map<string, string>();
  for (const m of MARKETS) {
    const t = ticker(m.symbol);
    const feeds = await getJson<{ id: string; attributes: { symbol?: string } }[]>(
      `${env.PYTH_HERMES_URL}/v2/price_feeds?query=${encodeURIComponent(t)}&asset_type=equity`,
    );
    const exact = `Equity.US.${t}/USD`;
    for (const f of feeds) {
      const s = f.attributes.symbol ?? "";
      if (s !== exact && !(s.startsWith(exact + ".") && /^[A-Z]+$/.test(s.slice(exact.length + 1)))) continue;
      ids.set(f.id.replace(/^0x/, ""), m.symbol);
      if (s === exact) regular.set(m.symbol, s);
    }
  }
  ids.forEach((sym, id) => feedToSym.set(id, sym));
  regular.forEach((s, sym) => regularSymbol.set(sym, s));
}

const idsQuery = () => [...feedToSym.keys()].map((id) => `ids[]=${id}`).join("&");

/** Hermes latest prices. A 401/403 switches to Benchmarks until a later snapshot gets through again. */
async function snapshot(log: Log) {
  try {
    apply((await getJson<{ parsed?: Parsed[] }>(`${env.PYTH_HERMES_URL}/v2/updates/price/latest?${idsQuery()}&parsed=true`)).parsed);
    if (!hermesUpdates) log.info("reference prices: Hermes serves price updates again; streaming");
    hermesUpdates = true;
  } catch (e) {
    if (refused(e)) {
      if (hermesUpdates) log.warn(`reference prices: Hermes refused price updates (${(e as Error).message}); using Pyth Benchmarks`);
      hermesUpdates = false;
    } else warnOnce(log, `reference prices: Hermes snapshot failed (${(e as Error).message})`);
  }
}

const history = (s: string, resolution: string, from: number, to: number) =>
  getJson<Bars>(`${env.PYTH_BENCHMARKS_URL}/v1/shims/tradingview/history?symbol=${encodeURIComponent(s)}&resolution=${resolution}&from=${from}&to=${to}`);

/** Benchmarks 1-minute bars: the close of the newest bar in the last 3 hours (none while the market is shut). */
let polling = false;
async function pollBars(log: Log) {
  if (polling) return;
  polling = true;
  try {
    const now = nowSec();
    for (const [sym, s] of regularSymbol) {
      const h = await history(s, "1", now - 3 * 3600, now).catch((e: Error) => (warnOnce(log, `reference prices: Benchmarks 1-minute bars failed (${e.message})`), null));
      const t = h?.t ?? [], c = h?.c ?? [], n = Math.min(t.length, c.length);
      if (h?.s === "ok" && n) setPrice(sym, c[n - 1], t[n - 1]);
    }
  } finally {
    polling = false;
  }
}

/** Benchmarks daily bars: the previous close for the change, and the last close as the price while the market is shut. */
async function closes(log: Log) {
  const now = nowSec();
  for (const [sym, s] of regularSymbol) {
    const h = await history(s, "1D", now - 14 * 86_400, now).catch((e: Error) => (warnOnce(log, `reference prices: Benchmarks daily bars failed (${e.message})`), null));
    const t = h?.t ?? [], c = h?.c ?? [], n = Math.min(t.length, c.length);
    if (h?.s !== "ok" || n < 2) continue;
    setPrice(sym, c[n - 1], t[n - 1]); // only if nothing newer is known
    // The last bar is the latest session when the latest price falls inside it; then the previous close is the bar before.
    const last = latest.get(sym)?.publishTime ?? t[n - 1];
    prevClose.set(sym, last >= t[n - 1] && last < t[n - 1] + 86_400 ? c[n - 2] : c[n - 1]);
  }
}

let reported = -1;
function report(log: Log) {
  const n = MARKETS.filter((m) => latest.has(m.symbol)).length;
  if (n !== reported) log.info(`reference prices: ${n} of ${MARKETS.length} markets priced (${hermesUpdates ? "Hermes" : "Benchmarks"})`);
  reported = n;
}

async function stream(log: Log) {
  const r = await fetch(`${env.PYTH_HERMES_URL}/v2/updates/price/stream?${idsQuery()}&parsed=true`, { headers: { accept: "text/event-stream" } });
  if (!r.ok || !r.body) throw new HttpError(r.status, "/v2/updates/price/stream", (await r.text().catch(() => "")).slice(0, 200));
  log.info(`reference prices: streaming ${feedToSym.size} Pyth feeds`);
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true }).replace(/\r/g, "");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const data = buf.slice(0, i).split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      buf = buf.slice(i + 2);
      if (data) apply((JSON.parse(data) as { parsed?: Parsed[] }).parsed);
    }
  }
  throw new Error("price stream ended");
}

/** Runs for the life of the API: find the feeds, then stream from Hermes or poll Benchmarks; retries on any failure. */
export async function startRefPrices(log: Log) {
  if (!env.PYTH_HERMES_URL) return;
  while (!feedToSym.size) {
    await discover().catch((e: Error) => log.warn(`reference prices: feed lookup failed (${e.message}); retrying in 60s`));
    if (!feedToSym.size) await sleep(60_000);
  }
  const refresh = async () => {
    await snapshot(log);
    if (!hermesUpdates) await pollBars(log);
    await closes(log);
    report(log);
  };
  await refresh();
  setInterval(refresh, 10 * 60_000).unref(); // keeps the closes current and checks whether Hermes serves updates again
  setInterval(() => void (hermesUpdates || pollBars(log).then(() => report(log))), 15_000).unref();
  for (let wait = 5_000; ; ) {
    if (!hermesUpdates) {
      await sleep(60_000); // Benchmarks is polling; refresh() flips back to the stream when Hermes lets us in
      continue;
    }
    const t0 = Date.now();
    await stream(log).catch((e: Error) => {
      if (refused(e)) {
        hermesUpdates = false;
        warnOnce(log, `reference prices: Hermes refused the price stream (${e.message}); using Pyth Benchmarks`);
      }
      else log.warn(`reference prices: ${e.message}; reconnecting in ${wait / 1000}s`);
    });
    if (!hermesUpdates) {
      await pollBars(log);
      report(log);
      continue;
    }
    await sleep(wait);
    wait = Date.now() - t0 > 120_000 ? 5_000 : Math.min(wait * 2, 60_000); // back off only while it keeps failing fast
  }
}

export function refPrices() {
  return MARKETS.map((m) => {
    const p = latest.get(m.symbol), c = prevClose.get(m.symbol);
    return { symbol: m.symbol, price: p?.price ?? null, publishTime: p?.publishTime ?? null, chg: p && c ? (p.price / c - 1) * 100 : null, source: "pyth" as const };
  });
}
