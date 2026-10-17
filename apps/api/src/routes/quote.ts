import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { encodeAbiParameters, parseUnits, type Hex } from "viem";
import {
  buildRoute,
  allowedLegCostBps,
  costBps,
  legWithinBand,
  oracleRouterAbi,
  marketBySymbol,
  protocolFee,
  sessionAt,
  vaultClipUsd,
  PROTOCOL,
  TIERS,
  SESSION_PARAMS,
  VENUE_INDEX,
  type VenueId,
  type VenueQuoter,
} from "@paritas/shared";
import { chainNow, client, deployment, stockBySymbol } from "../lib/chain";
import { vaultQuoter, poolQuoter, rfqQuoter } from "../lib/quoters";

const Body = z.object({
  symbol: z.string(),
  side: z.enum(["buy", "sell"]),
  amount: z.string().regex(/^\d+(\.\d+)?$/), // human units of the input token: USDG on buys, stock on sells
  trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(), // without a wallet: no maker quotes, no swapArgs
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

// Same formatting as the prototype's compact() and fmtPct(), so venue reasons read identically.
const nf = (n: number, d: number) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const compact = (n: number) => (n >= 1e9 ? nf(n / 1e9, 2) + "B" : n >= 1e6 ? nf(n / 1e6, 2) + "M" : n >= 1e4 ? nf(n / 1e3, n % 1000 ? 1 : 0) + "K" : nf(n, n >= 100 ? 0 : 2));
const pct = (bps: number) => nf(bps / 100, 2) + "%";

/** One quote per venue and amount within a request: buildRoute and the ladder ask for the same sizes. */
function memo(v: VenueQuoter): VenueQuoter {
  const seen = new Map<bigint, ReturnType<VenueQuoter["quote"]>>();
  return {
    ...v,
    quote: (x) => {
      if (!seen.has(x)) seen.set(x, v.quote(x).catch(() => null));
      return seen.get(x)!;
    },
  };
}

/**
 * POST /quote -> a route the web app passes straight to SwapRouter.swap (args already encoded), the cost lines the
 * trade ticket shows, and what each venue alone would do for the full order (the ticket's venue ladder).
 * Quotes are valid for one block; refresh on every block.
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
    const feeBps = PROTOCOL.fees.protocolFeeBps;
    const amountIn = parseUnits(b.amount, buy ? 6 : 18);
    const now = await chainNow();
    const session = sessionAt(now);
    const tier = TIERS[m.tier];
    const allowed = allowedLegCostBps(tier, SESSION_PARAMS[session]);
    const priceLimitBps = allowed + feeBps;
    // Every leg's price limit is measured against this price; without it SwapRouter rejects every route.
    const priceWad = await client
      .readContract({ address: d.paritas.oracleRouter, abi: oracleRouterAbi, functionName: "priceNoOlderThan", args: [s.token, BigInt(PROTOCOL.oracle.bandMaxAgeSec)] })
      .catch((e: unknown) => {
        req.log.warn({ symbol: b.symbol, err: String(e).split("\n")[0] }, "no usable oracle price");
        return null;
      });
    if (priceWad === null) {
      const reason = "The Chainlink price is out of date, so no venue can be checked against the price limit.";
      const venueQuotes = (["vault", "pool", "rfq"] as const).map((id) => ({ id, available: false, reason: "Waiting for a fresh Chainlink price", amountIn: "0", amountOut: null, costBps: null, lines: null }));
      return { ok: false, reason, session, oraclePriceWad: "0", priceLimitBps, notionalUsd: 0, venueQuotes, venues: [] };
    }
    const trader = (b.trader ?? null) as Hex | null;
    const ctx = { stock: s.token, usdg: d.usdg, buy, trader: trader ?? ("0x" + "0".repeat(40)) as Hex, stockUnit, usdToWad, uniswapPoolFee: m.uniswapPoolFee, vault: s.vault, now };

    const vault = await vaultQuoter(ctx);
    const venues: VenueQuoter[] = [memo(vault)];
    if (b.venues !== "vault") venues.push(memo(await poolQuoter(ctx)));
    if (b.venues === "best" && trader) venues.push(memo(rfqQuoter(ctx)));

    const band = { priceWad, stockUnit, usdToWad, allowedBps: BigInt(allowed) };
    const net = buy ? amountIn - protocolFee(amountIn, BigInt(feeBps)) : amountIn;
    const notionalUsd = buy ? Number(amountIn) / 1e6 : (Number((amountIn * priceWad) / stockUnit) / 1e18);
    const legCost = (venueIn: bigint, venueOut: bigint) =>
      costBps({ buy, usdAmount: buy ? venueIn : venueOut, stockAmount: buy ? venueOut : venueIn, priceWad, stockUnit, usdToWad, feeBps });

    const linesFor = (id: VenueId, cost: number) => {
      if (id === "vault") {
        const spread = (vault.halfSpreadBps * vault.spreadMulBps) / 10_000;
        return [{ label: "Spread", bps: spread }, { label: "Inventory adjustment", bps: cost - spread - feeBps }, { label: "Protocol fee", bps: feeBps }];
      }
      if (id === "pool") {
        const poolFee = m.uniswapPoolFee / 100;
        return [{ label: "Pool fee", bps: poolFee }, { label: "Price impact", bps: cost - poolFee - feeBps }, { label: "Protocol fee", bps: feeBps }];
      }
      return [{ label: "Maker spread", bps: cost - feeBps }, { label: "Protocol fee", bps: feeBps }];
    };

    // What each venue alone would do for the whole order. Shown even when it cannot take it, like the prototype.
    const ALL: VenueId[] = ["vault", "pool", "rfq"];
    const venueQuotes = [];
    for (const id of ALL) {
      const v = venues.find((x) => x.id === id);
      let reason: string | null = null;
      if (!v) reason = id === "rfq" && b.venues === "best" ? "Connect a wallet for maker quotes" : "Excluded in settings";
      else if (v.maxIn === 0n) reason = v.reason ?? "Not available";
      if (id === "rfq" && (notionalUsd < PROTOCOL.rfq.minUsd || notionalUsd > PROTOCOL.rfq.maxUsd)) {
        reason = notionalUsd < PROTOCOL.rfq.minUsd ? `Orders from ${compact(PROTOCOL.rfq.minUsd)}` : `Up to ${compact(PROTOCOL.rfq.maxUsd)} per quote`;
      }
      const quotable = v && v.maxIn > 0n && !(id === "rfq" && reason);
      const q = quotable ? await v.quote(net) : null;
      if (!q || q.amountOut === 0n) {
        const fallback = id === "vault" ? "Not enough inventory" : id === "pool" ? "No pool liquidity at this size" : "No maker is quoting";
        venueQuotes.push({ id, available: false, reason: reason ?? fallback, amountIn: net.toString(), amountOut: null, costBps: null, lines: null });
        continue;
      }
      const cost = legCost(net, q.amountOut);
      if (!reason && id === "vault" && net > v!.maxIn) reason = `Above the ${compact(vaultClipUsd(tier, SESSION_PARAMS[session]))} vault limit`;
      if (!reason && !legWithinBand({ buy, amountIn: net, amountOut: q.amountOut, ...band })) reason = `Over the ${pct(priceLimitBps)} price limit`;
      venueQuotes.push({ id, available: !reason, reason, amountIn: net.toString(), amountOut: q.amountOut.toString(), costBps: cost, lines: linesFor(id, cost) });
    }

    const plan = await buildRoute({ buy, amountIn, feeBps: BigInt(feeBps), slippageBps: b.slippageBps, venues, band });
    const common = { session, oraclePriceWad: priceWad.toString(), priceLimitBps, notionalUsd, venueQuotes, venues: venues.map((v) => ({ id: v.id, available: v.maxIn > 0n, reason: v.reason ?? null })) };
    if (!plan) return { ok: false, ...common };

    const legs = plan.legs.map((l) => {
      let data: Hex = "0x";
      if (l.venue === "pool") data = encodeAbiParameters([{ type: "uint24" }], [m.uniswapPoolFee]);
      if (l.venue === "rfq") {
        const r = l.data as { quote: any; signature: Hex };
        data = encodeAbiParameters([RFQ_TUPLE, { type: "bytes" }], [r.quote, r.signature]);
      }
      return { venue: VENUE_INDEX[l.venue], amountIn: l.amountIn.toString(), data };
    });
    const main = plan.legs.reduce((a, l) => (l.amountIn > a.amountIn ? l : a));
    const usdTotal = buy ? plan.amountIn : plan.expectedOut + plan.protocolFee;
    const stockTotal = buy ? plan.expectedOut : plan.amountIn;
    return {
      ok: true,
      ...common,
      mainVenue: main.venue,
      costBps: costBps({ buy, usdAmount: buy ? usdTotal - plan.protocolFee : usdTotal, stockAmount: stockTotal, priceWad, stockUnit, usdToWad, feeBps }),
      expectedOut: plan.expectedOut.toString(),
      minAmountOut: plan.minAmountOut.toString(),
      protocolFee: plan.protocolFee.toString(),
      legs: plan.legs.map((l) => {
        const cost = legCost(l.amountIn, l.amountOut);
        return { venue: l.venue, amountIn: l.amountIn.toString(), amountOut: l.amountOut.toString(), costBps: cost, lines: linesFor(l.venue, cost) };
      }),
      // pass as SwapRouter.swap({ ...swapArgs, deadline: now + settings.deadline }); amounts are decimal strings -> BigInt
      swapArgs: trader ? { stock: s.token, buy, amountIn: plan.amountIn.toString(), minAmountOut: plan.minAmountOut.toString(), recipient: trader, legs } : undefined,
    };
  });
}
