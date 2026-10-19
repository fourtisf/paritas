/**
 * Indexer: Robinhood Chain logs -> Postgres, then a Redis publish for the live tape.
 * Run as its own PM2 process (ecosystem.config.cjs). Restart-safe: cursors live in IndexerCursor and
 * every write is an upsert keyed by txHash:logIndex, so replaying a range is harmless.
 *
 * Streams: SwapRouter (Fill, RouteExecuted) | every AnchorVault (Sync, Deposit, Withdraw) |
 *          TimelockController (CallScheduled, CallExecuted, Cancelled) | Chainlink feeds -> candles
 * On start it also fills 30 days of candles from the feeds' past rounds (lib/backfill.ts).
 */
import { parseAbi, type Hex, type Log } from "viem";
import { Redis } from "ioredis";
import { anchorVaultAbi, costBps, decodeRouteLogs, PROTOCOL } from "@paritas/shared";
import { backfillCandles, feedAbi, TIMEFRAMES } from "./lib/backfill";
import { brief, chainNow, client, deployment } from "./lib/chain";
import { db, big } from "./lib/db";
import { env } from "./lib/env";

const pub = new Redis(env.REDIS_URL);
const timelockAbi = parseAbi([
  "event CallScheduled(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data, bytes32 predecessor, uint256 delay)",
  "event CallExecuted(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data)",
  "event Cancelled(bytes32 indexed id)",
]);

const blockTime = new Map<bigint, Date>();
async function timeOf(n: bigint) {
  if (!blockTime.has(n)) blockTime.set(n, new Date(Number((await client.getBlock({ blockNumber: n })).timestamp) * 1000));
  return blockTime.get(n)!;
}

async function cursor(name: string, start: bigint) {
  const c = await db.indexerCursor.findUnique({ where: { name } });
  return c ? c.block : start - 1n;
}
const save = (name: string, block: bigint) => db.indexerCursor.upsert({ where: { name }, create: { name, block }, update: { block } });

async function indexRouter(logs: Log[], router: Hex) {
  for (const r of decodeRouteLogs(logs, router)) {
    const ts = await timeOf(r.blockNumber);
    const key = `${env.CHAIN_ID}:${r.routeId}`;
    const usd = r.buy ? r.amountIn : r.amountOut + r.protocolFee;
    const stockAmt = r.buy ? r.amountOut : r.amountIn;
    const unit = 10n ** 18n, u2w = 10n ** 12n;
    const routeCost = costBps({ buy: r.buy, usdAmount: r.buy ? usd - r.protocolFee : usd, stockAmount: stockAmt, priceWad: r.oraclePriceWad, stockUnit: unit, usdToWad: u2w, feeBps: PROTOCOL.fees.protocolFeeBps });
    const row = {
      id: key,
      chainId: env.CHAIN_ID,
      routeId: r.routeId.toString(),
      txHash: r.txHash,
      blockNumber: r.blockNumber,
      timestamp: ts,
      trader: r.trader.toLowerCase(),
      recipient: r.recipient.toLowerCase(),
      stock: r.stock.toLowerCase(),
      buy: r.buy,
      amountIn: r.amountIn.toString(),
      amountOut: r.amountOut.toString(),
      protocolFee: r.protocolFee.toString(),
      oraclePriceWad: r.oraclePriceWad.toString(),
      session: r.session,
      notionalUsd: Number(usd) / 1e6,
      costBps: routeCost,
    };
    await db.route.upsert({ where: { id: key }, create: row, update: row });
    for (const f of r.fills) {
      const fc = costBps({ buy: r.buy, usdAmount: r.buy ? f.amountIn : f.amountOut, stockAmount: r.buy ? f.amountOut : f.amountIn, priceWad: r.oraclePriceWad, stockUnit: unit, usdToWad: u2w, feeBps: PROTOCOL.fees.protocolFeeBps });
      const fr = { id: `${f.txHash}:${f.logIndex}`, routeKey: key, legIndex: f.legIndex, venue: f.venue, amountIn: f.amountIn.toString(), amountOut: f.amountOut.toString(), priceWad: f.priceWad.toString(), costBps: fc };
      await db.fill.upsert({ where: { id: fr.id }, create: fr, update: fr });
    }
    await pub.publish("paritas:fills", JSON.stringify({ ...row, blockNumber: row.blockNumber.toString(), venues: r.fills.map((f) => f.venue) }));
  }
}

async function indexVaults(from: bigint, to: bigint, vaults: Record<string, Hex>) {
  const byAddr = new Map(Object.entries(vaults).map(([sym, a]) => [a.toLowerCase(), sym]));
  if (byAddr.size === 0) return;
  const logs = await client.getContractEvents({ address: Object.values(vaults), abi: anchorVaultAbi, fromBlock: from, toBlock: to });
  for (const l of logs) {
    const ts = await timeOf(l.blockNumber);
    const vault = l.address.toLowerCase();
    const id = `${l.transactionHash}:${l.logIndex}`;
    if (l.eventName === "Sync") {
      await db.vaultSnapshot.create({ data: { vault, stock: byAddr.get(vault)!, blockNumber: l.blockNumber, timestamp: ts, reserveStock: l.args.reserveStock!.toString(), reserveUsd: l.args.reserveUsd!.toString() } });
    } else if (l.eventName === "Deposit" || l.eventName === "Withdraw") {
      const a: any = l.args;
      const data = {
        id,
        vault,
        kind: l.eventName === "Deposit" ? "deposit" : "withdraw",
        owner: (a.sender ?? a.owner).toLowerCase(),
        receiver: a.receiver.toLowerCase(),
        shares: a.shares.toString(),
        usdAmount: (a.usdIn ?? a.usdOut).toString(),
        stockAmount: (a.stockIn ?? a.stockOut).toString(),
        valueWad: a.valueWad?.toString() ?? null,
        blockNumber: l.blockNumber,
        timestamp: ts,
      };
      await db.vaultFlow.upsert({ where: { id }, create: data, update: data });
    }
  }
}

async function indexTimelock(from: bigint, to: bigint, timelock: Hex) {
  const logs = await client.getContractEvents({ address: timelock, abi: timelockAbi, fromBlock: from, toBlock: to });
  for (const l of logs) {
    const ts = await timeOf(l.blockNumber);
    const a: any = l.args;
    if (l.eventName === "CallScheduled") {
      const data = { id: a.id, target: a.target, data: a.data, status: "scheduled", scheduledAt: ts, readyAt: new Date(ts.getTime() + Number(a.delay) * 1000), txHash: l.transactionHash };
      await db.governanceOp.upsert({ where: { id: a.id }, create: data, update: { status: "scheduled" } });
    } else if (l.eventName === "CallExecuted") {
      await db.governanceOp.updateMany({ where: { id: a.id }, data: { status: "executed", executedAt: ts } });
    } else {
      await db.governanceOp.updateMany({ where: { id: a.id }, data: { status: "cancelled" } });
    }
  }
}

// feed decimals, re-read every 10 minutes (display only; the contracts read them live)
const decimals = new Map<string, { d: number; at: number }>();
async function decimalsOf(feed: Hex) {
  const c = decimals.get(feed);
  if (c && Date.now() - c.at < 600_000) return c.d;
  const d = await client.readContract({ address: feed, abi: feedAbi, functionName: "decimals" });
  decimals.set(feed, { d, at: Date.now() });
  return d;
}

/** 15m / 1h / 6h candles from the oracle price, sampled each loop. Buckets use chain time, like fills do. */
async function sampleCandles(stocks: Record<string, { token: Hex; chainlinkFeed: Hex }>) {
  const now = (await chainNow()) * 1000;
  for (const s of Object.values(stocks)) {
    const [, answer] = await client.readContract({ address: s.chainlinkFeed, abi: feedAbi, functionName: "latestRoundData" }).catch(() => [0n, 0n] as const);
    if (answer <= 0n) continue;
    const dec = await decimalsOf(s.chainlinkFeed);
    const p = answer * 10n ** BigInt(18 - dec);
    for (const [tf, ms] of TIMEFRAMES) {
      const t = new Date(Math.floor(now / ms) * ms);
      const key = { stock_tf_t: { stock: s.token.toLowerCase(), tf, t } };
      const ex = await db.candle.findUnique({ where: key });
      if (!ex) await db.candle.create({ data: { stock: s.token.toLowerCase(), tf, t, o: p.toString(), h: p.toString(), l: p.toString(), c: p.toString() } });
      else {
        const h = big(ex.h) > p ? big(ex.h) : p, lo = big(ex.l) < p ? big(ex.l) : p;
        await db.candle.update({ where: key, data: { h: h.toString(), l: lo.toString(), c: p.toString() } });
      }
    }
  }
}

/** Its own loop, so a slow or failing log scan (catching up, RPC errors) never stops the price chart. */
async function sampleForever(stocks: Record<string, { token: Hex; chainlinkFeed: Hex }>) {
  for (;;) {
    await sampleCandles(stocks).catch((e) => console.error(`candle error: ${brief(e)}`));
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function loop() {
  let d;
  for (;;) {
    d = await deployment().catch((e: Error) => {
      console.error(`indexer waiting: ${e.message}`);
      return null;
    });
    if (d) break;
    await new Promise((r) => setTimeout(r, 60_000)); // e.g. mainnet before deployments/4663.json is filled
  }
  const start = BigInt(d.paritas.deployedAtBlock || 0);
  backfillCandles(d.stocks).catch((e) => console.error(`backfill error (retried at the next start): ${brief(e)}`));
  sampleForever(d.stocks);
  let logged = 0;
  let range = "";
  for (;;) {
    try {
      const head = (await client.getBlockNumber()) - BigInt(env.INDEXER_CONFIRMATIONS);
      const from = (await cursor("main", start)) + 1n;
      if (from <= head) {
        const to = from + BigInt(env.INDEXER_BATCH_BLOCKS) - 1n < head ? from + BigInt(env.INDEXER_BATCH_BLOCKS) - 1n : head;
        range = ` at blocks ${from}-${to}`;
        const routerLogs = await client.getLogs({ address: d.paritas.swapRouter, fromBlock: from, toBlock: to });
        await indexRouter(routerLogs, d.paritas.swapRouter);
        await indexVaults(from, to, d.paritas.vaults);
        await indexTimelock(from, to, d.paritas.timelock);
        await save("main", to);
        if (to < head) {
          if (Date.now() - logged > 30_000) {
            console.log(`indexer catching up: block ${to} of ${head}`);
            logged = Date.now();
          }
          continue; // no sleep
        }
      }
    } catch (e) {
      console.error(`indexer error${range}: ${brief(e)}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

loop();
