/**
 * Read endpoints the web app uses. Shapes mirror the prototype's demo data so pages port 1:1
 * (see docs/DEMO_TO_PRODUCTION.md for the field-by-field mapping).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  anchorVaultAbi,
  oracleRouterAbi,
  paramControllerAbi,
  MARKETS,
  TIERS,
  SESSION_PARAMS,
  SESSION_COPY,
  HOLIDAY_COPY,
  sessionAt,
  isHolidayAt,
  nextSessionChange,
  sessionStartedAt,
  PROTOCOL,
} from "@paritas/shared";
import { chainNow, client, deployment, stockBySymbol } from "../lib/chain";
import { big, db, json } from "../lib/db";
import { refPrices } from "../lib/refPrices";

export default async function readRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  // Pyth reference prices for the website's price strip while a market is not live here. Display only.
  app.get("/prices", async () => refPrices());

  app.get("/session", async () => {
    const now = await chainNow();
    const s = sessionAt(now);
    const copy = s === "closed" && isHolidayAt(now) ? HOLIDAY_COPY : SESSION_COPY[s];
    return { now, session: s, ...copy, params: SESSION_PARAMS[s], startedAt: sessionStartedAt(now), next: nextSessionChange(now) };
  });

  app.get("/markets", async () => {
    const d = await deployment().catch(() => null);
    if (!d) return []; // not deployed on this chain yet: no markets to show (the website shows "–")
    const now = await chainNow();
    const since = new Date((now - 86_400) * 1000);
    const out = await Promise.all(
      MARKETS.filter((m) => d.stocks[m.symbol]).map(async (m) => {
        const s = d.stocks[m.symbol];
        const vault = d.paritas.vaults[m.symbol] ?? null;
        const [price, updatedAt] = await client
          .readContract({ address: d.paritas.oracleRouter, abi: oracleRouterAbi, functionName: "price", args: [s.token] })
          .catch(() => [0n, 0n] as const);
        let v = null;
        if (vault) {
          const [[, rs, ru, , , , open], supply] = await Promise.all([
            client.readContract({ address: vault, abi: anchorVaultAbi, functionName: "state" }),
            client.readContract({ address: vault, abi: anchorVaultAbi, functionName: "totalSupply" }),
          ]);
          const stockUsd = Number((rs * price) / 10n ** 18n) / 1e18;
          const usd = Number(ru) / 1e6;
          v = { address: vault, tvlUsd: stockUsd + usd, tokenShareBps: stockUsd + usd > 0 ? Math.round((stockUsd / (stockUsd + usd)) * 1e4) : 5000, totalSupply: supply.toString(), reserveStock: rs.toString(), reserveUsd: ru.toString(), open };
        }
        const first = await db.candle.findFirst({ where: { stock: s.token.toLowerCase(), tf: "15m", t: { gte: since } }, orderBy: { t: "asc" } });
        const p = Number(price) / 1e18;
        const o = first ? Number(BigInt(first.o.toFixed())) / 1e18 : p;
        // updatedAt = Chainlink round time; the app shows the feed as live while it is younger than the vault's limit
        const feedFresh = updatedAt > 0n && now - Number(updatedAt) <= PROTOCOL.oracle.vaultMaxAgeSec;
        return { ...m, token: s.token, mid: p, priceWad: price.toString(), updatedAt: Number(updatedAt), feedFresh, chg: o ? (p / o - 1) * 100 : 0, tierParams: TIERS[m.tier], vault: v, open: !!vault };
      }),
    );
    return out;
  });

  app.get("/markets/:sym/candles", async (req, reply) => {
    const { sym } = req.params as { sym: string };
    const { tf } = z.object({ tf: z.enum(["1D", "1W", "1M"]).default("1D") }).parse(req.query);
    const s = await stockBySymbol(sym);
    if (!s) return reply.code(404).send({ error: "unknown market" });
    const cfg = { "1D": ["15m", 1], "1W": ["1h", 7], "1M": ["6h", 30] } as const;
    const [res, days] = cfg[tf];
    const now = await chainNow();
    const rows = await db.candle.findMany({ where: { stock: s.token.toLowerCase(), tf: res, t: { gte: new Date((now - days * 86_400) * 1000) } }, orderBy: { t: "asc" } });
    return rows.map((r: { t: Date; c: { toFixed(): string } }) => ({ t: r.t.getTime(), v: Number(BigInt(r.c.toFixed())) / 1e18 }));
  });

  const FillsQ = z.object({
    symbol: z.string().optional(),
    venue: z.enum(["vault", "pool", "rfq"]).optional(),
    side: z.enum(["buy", "sell"]).optional(),
    trader: z.string().optional(),
    limit: z.coerce.number().min(1).max(200).default(30),
    before: z.coerce.number().optional(), // unix ms cursor
  });
  app.get("/fills", async (req) => {
    const q = FillsQ.parse(req.query);
    const s = q.symbol ? await stockBySymbol(q.symbol) : null;
    const rows = await db.route.findMany({
      where: {
        ...(s && { stock: s.token.toLowerCase() }),
        ...(q.side && { buy: q.side === "buy" }),
        ...(q.trader && { trader: q.trader.toLowerCase() }),
        ...(q.venue && { fills: { some: { venue: q.venue } } }),
        ...(q.before && { timestamp: { lt: new Date(q.before) } }),
      },
      include: { fills: { orderBy: { legIndex: "asc" } } },
      orderBy: { timestamp: "desc" },
      take: q.limit,
    });
    return json(rows);
  });

  /** Last 24 hours (chain time) for the Markets page: totals, venue split by leg size, and volume by hour. */
  app.get("/stats", async () => {
    const now = await chainNow();
    const rows = await db.route.findMany({
      where: { timestamp: { gte: new Date((now - 86_400) * 1000) } },
      select: { timestamp: true, buy: true, notionalUsd: true, costBps: true, fills: { select: { venue: true, amountIn: true, amountOut: true } } },
    });
    const VENUES = ["vault", "pool", "rfq"] as const;
    const hour0 = (Math.floor(now / 3600) - 23) * 3600;
    const hourly = Array.from({ length: 24 }, (_, i) => ({ t: (hour0 + i * 3600) * 1000, v: [0, 0, 0] }));
    const byVenue = { vault: 0, pool: 0, rfq: 0 };
    let volumeUsd = 0, weighted = 0;
    for (const r of rows) {
      volumeUsd += r.notionalUsd;
      weighted += r.notionalUsd * r.costBps;
      const h = hourly[Math.floor((r.timestamp.getTime() / 1000 - hour0) / 3600)];
      for (const f of r.fills) {
        const usd = Number(r.buy ? big(f.amountIn) : big(f.amountOut)) / 1e6; // the USDG side of the leg
        const k = VENUES.indexOf(f.venue as (typeof VENUES)[number]);
        if (k < 0) continue;
        byVenue[VENUES[k]] += usd;
        if (h) h.v[k] += usd;
      }
    }
    return { now, fills: rows.length, volumeUsd, avgCostBps: volumeUsd ? weighted / volumeUsd : 0, byVenue, hourly };
  });

  app.get("/fills/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await db.route.findUnique({ where: { id }, include: { fills: { orderBy: { legIndex: "asc" } } } });
    return r ? json(r) : reply.code(404).send({ error: "not found" });
  });

  app.get("/vaults", async () => {
    const d = await deployment();
    return MARKETS.map((m) => ({ symbol: m.symbol, tier: m.tier, vault: d.paritas.vaults[m.symbol] ?? null, cap: TIERS[m.tier].capUsd, halfSpreadBps: TIERS[m.tier].halfSpreadBps }));
  });

  app.get("/portfolio/:address", async (req) => {
    const { address } = req.params as { address: string };
    const a = address.toLowerCase();
    const [routes, flows] = await Promise.all([
      db.route.findMany({ where: { trader: a }, include: { fills: true }, orderBy: { timestamp: "desc" }, take: 100 }),
      db.vaultFlow.findMany({ where: { OR: [{ owner: a }, { receiver: a }] }, orderBy: { timestamp: "desc" } }),
    ]);
    // balances and live vault shares are read client-side with wagmi (always fresh); this is history only
    return json({ routes, flows });
  });

  app.get("/governance", async () => {
    const d = await deployment();
    const [ops, paused, guardian] = await Promise.all([
      db.governanceOp.findMany({ orderBy: { scheduledAt: "desc" }, take: 50 }),
      client.readContract({ address: d.paritas.paramController, abi: paramControllerAbi, functionName: "globalPaused" }).catch(() => null),
      client.readContract({ address: d.paritas.paramController, abi: paramControllerAbi, functionName: "guardian" }).catch(() => null),
    ]);
    return json({
      now: await chainNow(),
      paused,
      guardian,
      timelock: d.paritas.timelock,
      deployedAtBlock: d.paritas.deployedAtBlock,
      delaySec: PROTOCOL.governance.timelockDelaySec,
      multisig: `${PROTOCOL.governance.multisigThreshold}-of-${PROTOCOL.governance.multisigSigners}`,
      tiers: TIERS,
      sessions: SESSION_PARAMS,
      fees: PROTOCOL.fees,
      ops,
    });
  });
}
