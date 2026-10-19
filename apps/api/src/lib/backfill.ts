import { ContractFunctionRevertedError, ContractFunctionZeroDataError, parseAbi, type BaseError, type Hex } from "viem";
import { chainNow, client } from "./chain";
import { db } from "./db";

export const feedAbi = parseAbi([
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function getRoundData(uint80) view returns (uint80, int256, uint256, uint256, uint80)",
  "function decimals() view returns (uint8)",
]);
/** Candle sizes the API serves: 15m for 1D, 1h for 1W, 6h for 1M. */
export const TIMEFRAMES = [["15m", 9e5], ["1h", 36e5], ["6h", 216e5]] as const;
const DAYS = 30; // the longest chart (1M)
const BATCH = 10; // rounds read at once; the client sends them as one small JSON-RPC batch

/**
 * Price history from before the indexer ran: every Chainlink round of the last 30 days, read with getRoundData from
 * the latest round back to the start of the feed's current phase, turned into the candles sampleCandles writes.
 * A bucket with no round carries the last price, as the feed does.
 *
 * It writes only buckets older than the first candle already stored for that stock and timeframe, so it never touches
 * live candles. Each stock is done once (cursor "backfill:<token>"); an error leaves it to the next start.
 */
export async function backfillCandles(stocks: Record<string, { token: Hex; chainlinkFeed: Hex }>) {
  for (const [sym, s] of Object.entries(stocks)) {
    const stock = s.token.toLowerCase();
    const cursor = `backfill:${stock}`;
    if (await db.indexerCursor.findUnique({ where: { name: cursor } })) continue;
    const now = await chainNow();
    const since = now - DAYS * 86_400;
    const feed = { address: s.chainlinkFeed, abi: feedAbi } as const;
    const dec = await client.readContract({ ...feed, functionName: "decimals" });
    const [latest] = await client.readContract({ ...feed, functionName: "latestRoundData" });
    const phase = latest >> 64n; // proxy round id = phase << 64 | aggregator round
    const pts: { t: number; p: bigint }[] = []; // newest first
    let before: bigint | undefined; // the last price before `since`, where the first bucket opens
    for (let r = latest & 0xffff_ffff_ffff_ffffn; r > 0n && before === undefined; ) {
      const ids = Array.from({ length: r < BigInt(BATCH) ? Number(r) : BATCH }, (_, i) => (phase << 64n) | (r - BigInt(i)));
      r -= BigInt(ids.length);
      const rounds = await Promise.all(ids.map((id) => client.readContract({ ...feed, functionName: "getRoundData", args: [id] }))).catch((e: BaseError) => {
        // a feed without getRoundData (a local mock) has no history; anything else (RPC down) is retried at the next start
        if (e.walk?.((x) => x instanceof ContractFunctionRevertedError || x instanceof ContractFunctionZeroDataError)) return null;
        throw e;
      });
      if (!rounds) break;
      await new Promise((res) => setTimeout(res, 150)); // gentle on public RPCs
      for (const [, answer, , updatedAt] of rounds) {
        if (answer <= 0n || updatedAt === 0n) continue;
        const p = answer * 10n ** BigInt(18 - dec);
        if (Number(updatedAt) < since) {
          before = p;
          break;
        }
        pts.push({ t: Number(updatedAt), p });
      }
    }
    pts.reverse();
    const start = before !== undefined ? since : pts[0]?.t;
    let written = 0;
    if (start !== undefined) {
      for (const [tf, ms] of TIMEFRAMES) {
        const first = await db.candle.findFirst({ where: { stock, tf }, orderBy: { t: "asc" } });
        const end = Math.min(first ? first.t.getTime() : Infinity, Math.floor((now * 1000) / ms) * ms); // live candles from here
        const rows = [];
        let last = before;
        let i = 0;
        for (let t = Math.floor((start * 1000) / ms) * ms; t < end; t += ms) {
          let o = last, h = last, l = last;
          for (; i < pts.length && pts[i].t * 1000 < t + ms; i++) {
            const p = pts[i].p;
            if (o === undefined) o = h = l = p;
            if (p > h!) h = p;
            if (p < l!) l = p;
            last = p;
          }
          if (o === undefined) continue; // before the first round
          rows.push({ stock, tf, t: new Date(t), o: o.toString(), h: h!.toString(), l: l!.toString(), c: last!.toString() });
        }
        written += (await db.candle.createMany({ data: rows, skipDuplicates: true })).count;
      }
    }
    await db.indexerCursor.upsert({ where: { name: cursor }, create: { name: cursor, block: 1n }, update: {} });
    console.log(`backfill ${sym}: ${pts.length} Chainlink rounds in the last ${DAYS} days, ${written} candles`);
  }
}
