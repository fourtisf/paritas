/**
 * Read endpoints the web app uses. Shapes mirror the prototype's demo data so pages port 1:1
 * (see docs/DEMO_TO_PRODUCTION.md for the field-by-field mapping).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  anchorVaultAbi,
  oracleRouterAbi,
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
import { client, deployment, stockBySymbol } from "../lib/chain";
import { db, json } from "../lib/db";

export default async function readRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.get("/session", async () => {
    const now = Date.now() / 1000;
    const s = sessionAt(now);
    const copy = s === "closed" && isHolidayAt(now) ? HOLIDAY_COPY : SESSION_COPY[s];
    return { session: s, ...copy, params: SESSION_PARAMS[s], startedAt: sessionStartedAt(now), next: nextSessionChange(now) };
  });

  app.get("/markets", async () => {
    const d = await deployment();
    const out = [];
    for (const m of MARKETS) {
      const s = d.stocks[m.symbol];
      if (!s) continue;
      const vault = d.paritas.vaults[m.symbol] ?? null;
      const [price] = await client.readContract({ address: d.paritas.oracleRouter, abi: oracleRouterAbi, functionName: "price", args: [s.token] }).catch(() => [0n, 0n] as const);
      let v = null;
      if (vault) {
        const [rs, ru, supply] = await Promise.all([
          client.readContract({ address: vault, abi: anchorVaultAbi, functionName: "reserveStock" }),
          client.readContract({ address: vault, abi: anchorVaultAbi, functionName: "reserveUsd" }),
          client.readContract({ address: vault, abi: anchorVaultAbi, functionName: "totalSupply" }),
        ]);
        const stockUsd = Number((rs * price) / 10n ** 18n) / 1e18;
        const usd = Number(ru) / 1e6;
        v = { address: vault, tvlUsd: stockUsd + usd, tokenShareBps: stockUsd + usd > 0 ? Math.round((stockUsd / (stockUsd + usd)) * 1e4) : 5000, totalSupply: supply.toString() };
      }
      const since = new Date(Date.now() - 864e5);
      const first = await db.candle.findFirst({ where: { stock: s.token.toLowerCase(), tf: "15m", t: { gte: since } }, orderBy: { t: "asc" } });
      const p = Number(price) / 1e18;
      const o = first ? Number(BigInt(first.o.toFixed())) / 1e18 : p;
      out.push({ ...m, token: s.token, mid: p, chg: o ? (p / o - 1) * 100 : 0, tierParams: TIERS[m.tier], vault: v, open: !!vault });
    }
    return out;
  });

  app.get("/markets/:sym/candles", async (req, reply) => {
    const { sym } = req.params as { sym: string };
    const { tf } = z.object({ tf: z.enum(["1D", "1W", "1M"]).default("1D") }).parse(req.query);
    const s = await stockBySymbol(sym);
    if (!s) return reply.code(404).send({ error: "unknown market" });
    const cfg = { "1D": ["15m", 1], "1W": ["1h", 7], "1M": ["6h", 30] } as const;
    const [res, days] = cfg[tf];
    const rows = await db.candle.findMany({ where: { stock: s.token.toLowerCase(), tf: res, t: { gte: new Date(Date.now() - days * 864e5) } }, orderBy: { t: "asc" } });
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
    const ops = await db.governanceOp.findMany({ orderBy: { scheduledAt: "desc" }, take: 50 });
    return json({ delaySec: PROTOCOL.governance.timelockDelaySec, multisig: `${PROTOCOL.governance.multisigThreshold}-of-${PROTOCOL.governance.multisigSigners}`, tiers: TIERS, sessions: SESSION_PARAMS, fees: PROTOCOL.fees, ops });
  });
}
