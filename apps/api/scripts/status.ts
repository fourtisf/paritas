/**
 * Is the indexer keeping up, and are the router's swaps in the database?
 *   npm run status -w @paritas/api            (on the server: sudo -iu paritas bash -c 'cd ~/paritas && npm run status -w @paritas/api')
 * Read only. Counts RouteExecuted on-chain since deployment and compares with the database.
 */
import { swapRouterAbi } from "@paritas/shared";
import { brief, client, deployment } from "../src/lib/chain";
import { db } from "../src/lib/db";

const row = (k: string, v: string) => console.log(`${k.padEnd(24)} ${v}`);
const d = await deployment();
const start = BigInt(d.paritas.deployedAtBlock || 0);
const head = await client.getBlockNumber();
const cursor = (await db.indexerCursor.findUnique({ where: { name: "main" } }))?.block;
row("chain head", head.toString());
row("deployed at block", start.toString());
row("indexer at block", cursor === undefined ? "not started" : `${cursor} (${head - cursor} behind)`);

const onChain: { tx: string; block: bigint }[] = [];
let failed = "";
for (let from = start; from <= head; from += 5000n) {
  const to = from + 4999n < head ? from + 4999n : head;
  try {
    const logs = await client.getContractEvents({ address: d.paritas.swapRouter, abi: swapRouterAbi, eventName: "RouteExecuted", fromBlock: from, toBlock: to });
    for (const l of logs) onChain.push({ tx: l.transactionHash, block: l.blockNumber });
  } catch (e) {
    failed = `could not read blocks ${from}-${to}: ${brief(e)}`;
    break;
  }
}
const routes = await db.route.count();
const last = await db.route.findFirst({ orderBy: { timestamp: "desc" } });
row("swaps on-chain", failed ? `${onChain.length}+ (${failed})` : String(onChain.length));
row("swaps in the database", String(routes));
row("last swap in database", last ? `${last.timestamp.toISOString()} ${last.txHash}` : "-");
const missing = onChain.filter((x) => cursor === undefined || x.block > cursor);
if (missing.length) row("not indexed yet", missing.slice(0, 3).map((x) => `${x.tx} (block ${x.block})`).join(", "));

const candles = await db.candle.groupBy({ by: ["tf"], _count: true });
row("candles", candles.map((c) => `${c.tf} ${c._count}`).join(" · ") || "none");
const filled = await db.indexerCursor.count({ where: { name: { startsWith: "backfill:" } } });
row("price history filled", `${filled} of ${Object.keys(d.stocks).length} markets`);
await db.$disconnect();
