import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoute, type VenueQuoter } from "../src/route";
import { allowedLegCostBps, TIERS, SESSION_PARAMS } from "../src/protocol";

// USDG 6 decimals, stock 18 decimals, price 182.40
const priceWad = 18240n * 10n ** 16n;
const band = { priceWad, stockUnit: 10n ** 18n, usdToWad: 10n ** 12n, allowedBps: BigInt(allowedLegCostBps(TIERS.A, SESSION_PARAMS.regular)) };

/** a venue that costs `bps` vs the oracle on a USDG -> stock buy */
const venue = (id: VenueQuoter["id"], bps: bigint, maxIn: bigint, minIn = 0n): VenueQuoter => ({
  id,
  maxIn,
  minIn,
  quote: async (x) => ({ amountOut: (x * 10n ** 12n * 10n ** 18n * (10_000n - bps)) / 10_000n / priceWad }),
});

test("allowed leg cost is band minus fee", () => {
  assert.equal(allowedLegCostBps(TIERS.A, SESSION_PARAMS.regular), 73);
  assert.equal(allowedLegCostBps(TIERS.A, SESSION_PARAMS.closed), 148);
});

test("small order: cheapest single venue wins", async () => {
  const r = await buildRoute({ buy: true, amountIn: 10_000n * 10n ** 6n, feeBps: 2n, slippageBps: 30, band, venues: [venue("vault", 10n, 50_000n * 10n ** 6n), venue("pool", 15n, 10n ** 15n)] });
  assert.ok(r);
  assert.equal(r.legs.length, 1);
  assert.equal(r.legs[0].venue, "vault");
  assert.equal(r.legs[0].amountIn, 10_000n * 10n ** 6n - 2n * 10n ** 6n); // net of the 2 bps fee
});

test("order above the vault clip splits vault + pool", async () => {
  const r = await buildRoute({ buy: true, amountIn: 80_000n * 10n ** 6n, feeBps: 2n, slippageBps: 30, band, venues: [venue("vault", 10n, 50_000n * 10n ** 6n), venue("pool", 20n, 10n ** 15n)] });
  assert.ok(r);
  assert.deepEqual(r.legs.map((l) => l.venue), ["vault", "pool"]);
  assert.equal(r.legs[0].amountIn, 50_000n * 10n ** 6n);
  assert.equal(r.legs.reduce((s, l) => s + l.amountIn, 0n), r.amountIn - r.protocolFee);
});

test("venues outside the band are never used", async () => {
  const r = await buildRoute({ buy: true, amountIn: 10_000n * 10n ** 6n, feeBps: 2n, slippageBps: 30, band, venues: [venue("pool", 90n, 10n ** 15n)] });
  assert.equal(r, null);
});

test("RFQ minimum is respected", async () => {
  const rfq = venue("rfq", 5n, 2_000_000n * 10n ** 6n, 25_000n * 10n ** 6n);
  const small = await buildRoute({ buy: true, amountIn: 10_000n * 10n ** 6n, feeBps: 2n, slippageBps: 30, band, venues: [rfq, venue("pool", 20n, 10n ** 15n)] });
  assert.equal(small?.legs[0].venue, "pool");
  const big = await buildRoute({ buy: true, amountIn: 100_000n * 10n ** 6n, feeBps: 2n, slippageBps: 30, band, venues: [rfq, venue("pool", 20n, 10n ** 15n)] });
  assert.equal(big?.legs[0].venue, "rfq");
});
