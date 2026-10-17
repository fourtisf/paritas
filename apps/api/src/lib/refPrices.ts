/**
 * Reference share prices from Pyth (Hermes), for display only. The website shows them for markets that are not live
 * on this chain yet, labelled "Reference prices from Pyth". Quotes, price limits and the vaults never read them: those
 * use the Chainlink feeds on-chain.
 *
 * Feeds are found by symbol through Hermes ("Equity.US.NVDA/USD", plus any session variant such as ".PRE" or ".ON"),
 * never hard-coded. A market shows its freshest update across those feeds. The change is against the previous daily
 * close from Pyth Benchmarks. Without Hermes the endpoint answers nulls and the website shows "–".
 */
import { MARKETS } from "@paritas/shared";
import { env } from "./env";

type Log = { info(m: string): void; warn(m: string): void };
type Parsed = { id: string; price: { price: string; expo: number; publish_time: number } };

const latest = new Map<string, { price: number; publishTime: number }>(); // market symbol -> freshest update
const prevClose = new Map<string, number>(); // market symbol -> previous daily close
const feedToSym = new Map<string, string>(); // Hermes feed id (hex, no 0x) -> market symbol
const regularSymbol = new Map<string, string>(); // market symbol -> "Equity.US.NVDA/USD" (for Benchmarks)

const ticker = (sym: string) => sym.replace(/x$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${new URL(url).pathname}: ${r.status}`);
  return r.json() as Promise<T>;
}

function apply(items: Parsed[] | undefined) {
  for (const it of items ?? []) {
    const sym = feedToSym.get(it.id.replace(/^0x/, ""));
    if (!sym) continue;
    const price = Number(it.price.price) * 10 ** it.price.expo;
    const publishTime = it.price.publish_time;
    const cur = latest.get(sym);
    if (price > 0 && (!cur || publishTime >= cur.publishTime)) latest.set(sym, { price, publishTime });
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

async function snapshot() {
  const r = await getJson<{ parsed?: Parsed[] }>(`${env.PYTH_HERMES_URL}/v2/updates/price/latest?${idsQuery()}&parsed=true`);
  apply(r.parsed);
}

async function closes() {
  const now = Math.floor(Date.now() / 1000);
  for (const [sym, s] of regularSymbol) {
    const h = await getJson<{ s: string; t?: number[]; c?: number[] }>(
      `${env.PYTH_BENCHMARKS_URL}/v1/shims/tradingview/history?symbol=${encodeURIComponent(s)}&resolution=1D&from=${now - 14 * 86_400}&to=${now}`,
    ).catch(() => null);
    const t = h?.t ?? [], c = h?.c ?? [], n = Math.min(t.length, c.length);
    if (h?.s !== "ok" || n < 2) continue;
    // The last bar is the latest session when the latest price falls inside it; then the previous close is the bar before.
    const last = latest.get(sym)?.publishTime ?? now;
    prevClose.set(sym, last >= t[n - 1] && last < t[n - 1] + 86_400 ? c[n - 2] : c[n - 1]);
  }
}

async function stream(log: Log) {
  const r = await fetch(`${env.PYTH_HERMES_URL}/v2/updates/price/stream?${idsQuery()}&parsed=true`, { headers: { accept: "text/event-stream" } });
  if (!r.ok || !r.body) throw new Error(`price stream: ${r.status}`);
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

/** Runs for the life of the API: find the feeds, take a snapshot, then stream; retries on any failure. */
export async function startRefPrices(log: Log) {
  if (!env.PYTH_HERMES_URL) return;
  while (!feedToSym.size) {
    await discover().catch((e: Error) => log.warn(`reference prices: feed lookup failed (${e.message}); retrying in 60s`));
    if (!feedToSym.size) await sleep(60_000);
  }
  const refresh = async () => {
    await snapshot().catch((e: Error) => log.warn(`reference prices: snapshot failed (${e.message})`));
    await closes();
  };
  await refresh();
  setInterval(refresh, 10 * 60_000).unref(); // outside market hours the stream is quiet; keep closes current
  for (let wait = 5_000; ; ) {
    const t0 = Date.now();
    await stream(log).catch((e: Error) => log.warn(`reference prices: ${e.message}; reconnecting in ${wait / 1000}s`));
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
