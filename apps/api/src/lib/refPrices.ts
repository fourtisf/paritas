/**
 * Reference share prices from Finnhub, for display only. The website shows them for markets that are not live on this
 * chain yet, labelled "Reference prices from Finnhub". Quotes, price limits and the vaults never read them: those use
 * the Chainlink feeds on-chain.
 *
 * GET /quote every 20 s for each stock gives the price and the previous close (8 stocks = 24 of the free plan's 60
 * calls a minute). The trades websocket adds tick-by-tick prices while the market trades. Off without FINNHUB_API_KEY;
 * then the endpoint answers nulls and the website shows "–".
 */
import { MARKETS } from "@paritas/shared";
import { env } from "./env";

type Log = { info(m: string): void; warn(m: string): void };
type Quote = { c?: number; pc?: number; t?: number }; // current price, previous close, unix seconds
type WsMsg = { type: string; data?: { s: string; p: number; t: number }[]; msg?: string }; // trade time in ms

const QUOTE_EVERY_MS = 20_000;

const latest = new Map<string, { price: number; time: number }>(); // market symbol -> freshest price (unix seconds)
const prevClose = new Map<string, number>(); // market symbol -> previous close
const symOf = new Map(MARKETS.map((m) => [m.symbol.replace(/x$/, ""), m.symbol])); // "NVDA" -> "NVDAx"

// Each distinct problem is logged once, so a failing call does not flood the logs every 20 s.
const said = new Set<string>();
const warnOnce = (log: Log, m: string) => said.has(m) || (said.add(m), log.warn(m));

function setPrice(sym: string, price: number, time: number) {
  const cur = latest.get(sym);
  if (price > 0 && (!cur || time >= cur.time)) latest.set(sym, { price, time });
}

let reported = -1;
function report(log: Log) {
  const n = MARKETS.filter((m) => latest.has(m.symbol)).length;
  if (n !== reported) log.info(`reference prices: ${n} of ${MARKETS.length} markets priced (Finnhub)`);
  reported = n;
}

let pausedUntil = 0;
async function pollQuotes(log: Log) {
  if (Date.now() < pausedUntil) return;
  for (const [tk, sym] of symOf) {
    const r = await fetch(`${env.FINNHUB_URL}/quote?symbol=${encodeURIComponent(tk)}`, {
      headers: { "X-Finnhub-Token": env.FINNHUB_API_KEY },
      signal: AbortSignal.timeout(10_000),
    }).catch((e: Error) => (warnOnce(log, `reference prices: Finnhub quote request failed (${e.message})`), null));
    if (!r) continue;
    if (r.status === 401 || r.status === 403) {
      warnOnce(log, `reference prices: Finnhub refused the key (${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}); check FINNHUB_API_KEY`);
      return;
    }
    if (r.status === 429) {
      warnOnce(log, "reference prices: Finnhub rate limit reached; pausing quotes for a minute");
      pausedUntil = Date.now() + 60_000;
      return;
    }
    if (!r.ok) {
      warnOnce(log, `reference prices: Finnhub quote ${tk} answered ${r.status}`);
      continue;
    }
    const q = (await r.json().catch(() => ({}))) as Quote;
    if (q.c && q.c > 0) setPrice(sym, q.c, q.t ?? Math.floor(Date.now() / 1000));
    if (q.pc && q.pc > 0) prevClose.set(sym, q.pc);
  }
  report(log);
}

let wsWait = 5_000, wsLogged = false;
function connect(log: Log) {
  let openedAt = 0;
  const ws = new WebSocket(`${env.FINNHUB_WS_URL}?token=${encodeURIComponent(env.FINNHUB_API_KEY)}`);
  ws.addEventListener("open", () => {
    openedAt = Date.now();
    for (const tk of symOf.keys()) ws.send(JSON.stringify({ type: "subscribe", symbol: tk }));
    if (!wsLogged) log.info(`reference prices: Finnhub trades websocket open (${symOf.size} stocks)`);
    wsLogged = true;
  });
  ws.addEventListener("message", (ev) => {
    let m: WsMsg;
    try {
      m = JSON.parse(String(ev.data)) as WsMsg;
    } catch {
      return;
    }
    if (m.type === "trade") for (const d of m.data ?? []) symOf.has(d.s) && setPrice(symOf.get(d.s)!, d.p, d.t / 1000);
    else if (m.type === "error") warnOnce(log, `reference prices: Finnhub websocket: ${m.msg ?? "error"}`);
  });
  ws.addEventListener("error", () => {}); // "close" follows and reconnects
  ws.addEventListener("close", () => {
    const lived = openedAt ? Date.now() - openedAt : 0;
    if (lived < 60_000) warnOnce(log, "reference prices: Finnhub websocket keeps closing; quotes keep the prices current");
    // A connection that dies fast (a refused key, the plan's limit) backs off up to a minute; a long one retries soon.
    wsWait = lived >= 60_000 ? 5_000 : Math.min(wsWait * 2, 60_000);
    setTimeout(() => connect(log), wsWait);
  });
}

/** Runs for the life of the API. Quotes keep working when the websocket does not. */
export async function startRefPrices(log: Log) {
  if (!env.FINNHUB_API_KEY) return log.info("reference prices: off (set FINNHUB_API_KEY in apps/api/.env)");
  await pollQuotes(log);
  setInterval(() => void pollQuotes(log), QUOTE_EVERY_MS).unref();
  connect(log);
}

export function refPrices() {
  return MARKETS.map((m) => {
    const p = latest.get(m.symbol), c = prevClose.get(m.symbol);
    return { symbol: m.symbol, price: p?.price ?? null, publishTime: p?.time ?? null, chg: p && c ? (p.price / c - 1) * 100 : null, source: "finnhub" as const };
  });
}
