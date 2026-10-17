import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { encodeAbiParameters, parseUnits, type Hex } from "viem";
import {
  buildRoute,
  allowedLegCostBps,
  costBps,
  oracleRouterAbi,
  marketBySymbol,
  sessionAt,
  PROTOCOL,
  TIERS,
  SESSION_PARAMS,
  VENUE_INDEX,
} from "@paritas/shared";
import { client, deployment, stockBySymbol } from "../lib/chain";
import { vaultQuoter, poolQuoter, rfqQuoter } from "../lib/quoters";

const Body = z.object({
  symbol: z.string(),
  side: z.enum(["buy", "sell"]),
  amount: z.string().regex(/^\d+(\.\d+)?$/), // human units of the input token: USDG on buys, stock on sells
  trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  slippageBps: z.number().int().min(1).max(500).default(30),
  venues: z.enum(["best", "vault", "nomaker"]).default("best"), // prototype setting "Route preference"
});

const RFQ_TUPLE = {
  type: "tuple",
  components: [
    { name: "maker", type: "address" },
    { name: "taker", type: "address" },
    { name: "stock", type: "address" },
    { name: "takerBuys", type: "bool" },
    { name: "amountIn", type: "uint256" },
    { name: "amountOut", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

/**
 * POST /quote -> a route the web app passes straight to SwapRouter.swap (args already encoded),
 * plus the cost lines the trade ticket shows. Quotes are valid for one block; refresh on every block.
 */
export default async function quoteRoutes(app: FastifyInstance) {
  app.post("/quote", async (req, reply) => {
    const b = Body.parse(req.body);
    const m = marketBySymbol(b.symbol);
    const s = await stockBySymbol(b.symbol);
    if (!m || !s) return reply.code(404).send({ error: "unknown market" });
    const d = await deployment();
    const buy = b.side === "buy";
    const stockUnit = 10n ** 18n; // VERIFY: read decimals() per token at startup if any stock token is not 18
    const usdToWad = 10n ** 12n; // USDG has 6 decimals (VERIFY on Blockscout)
    const amountIn = parseUnits(b.amount, buy ? 6 : 18);
    const priceWad = await client.readContract({
      address: d.paritas.oracleRouter,
      abi: oracleRouterAbi,
      functionName: "priceNoOlderThan",
      args: [s.token, BigInt(PROTOCOL.oracle.bandMaxAgeSec)],
    });
    const session = sessionAt(Date.now() / 1000);
    const allowed = allowedLegCostBps(TIERS[m.tier], SESSION_PARAMS[session]);
    const ctx = { stock: s.token, usdg: d.usdg, buy, trader: b.trader as Hex, stockUnit, usdToWad, uniswapPoolFee: m.uniswapPoolFee, vault: s.vault };

    const venues = [await vaultQuoter(ctx)];
    if (b.venues !== "vault") venues.push(await poolQuoter(ctx));
    if (b.venues === "best") venues.push(rfqQuoter(ctx));

    const plan = await buildRoute({
      buy,
      amountIn,
      feeBps: BigInt(PROTOCOL.fees.protocolFeeBps),
      slippageBps: b.slippageBps,
      venues,
      band: { priceWad, stockUnit, usdToWad, allowedBps: BigInt(allowed) },
    });
    if (!plan) {
      return { ok: false, session, venues: venues.map((v) => ({ id: v.id, available: v.maxIn > 0n, reason: v.reason ?? null })) };
    }

    const legs = plan.legs.map((l) => {
      let data: Hex = "0x";
      if (l.venue === "pool") data = encodeAbiParameters([{ type: "uint24" }], [m.uniswapPoolFee]);
      if (l.venue === "rfq") {
        const r = l.data as { quote: any; signature: Hex };
        data = encodeAbiParameters([RFQ_TUPLE, { type: "bytes" }], [r.quote, r.signature]);
      }
      return { venue: VENUE_INDEX[l.venue], amountIn: l.amountIn.toString(), data };
    });
    const usdTotal = buy ? plan.amountIn : plan.expectedOut + plan.protocolFee;
    const stockTotal = buy ? plan.expectedOut : plan.amountIn;
    return {
      ok: true,
      session,
      oraclePriceWad: priceWad.toString(),
      priceLimitBps: allowed + PROTOCOL.fees.protocolFeeBps,
      costBps: costBps({ buy, usdAmount: buy ? usdTotal - plan.protocolFee : usdTotal, stockAmount: stockTotal, priceWad, stockUnit, usdToWad, feeBps: PROTOCOL.fees.protocolFeeBps }),
      expectedOut: plan.expectedOut.toString(),
      minAmountOut: plan.minAmountOut.toString(),
      protocolFee: plan.protocolFee.toString(),
      legs: plan.legs.map((l) => ({ venue: l.venue, amountIn: l.amountIn.toString(), amountOut: l.amountOut.toString() })),
      // pass as SwapRouter.swap({ ...swapArgs, deadline: now + settings.deadline }); amounts are decimal strings -> BigInt
      swapArgs: { stock: s.token, buy, amountIn: plan.amountIn.toString(), minAmountOut: plan.minAmountOut.toString(), recipient: b.trader, legs },
      venues: venues.map((v) => ({ id: v.id, available: v.maxIn > 0n, reason: v.reason ?? null })),
    };
  });
}
