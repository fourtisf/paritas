import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDst, sessionIndexAt, toNewYork, SESSIONS } from "../src/sessions";
import { quoteVault, type Pool, type Pricing } from "../src/quote";

const vec = (f: string) => JSON.parse(readFileSync(new URL(`../../../spec/vectors/${f}`, import.meta.url), "utf8"));

test("sessions match spec/vectors/sessions.json (Python + IANA tz reference)", () => {
  const { vectors } = vec("sessions.json");
  assert.ok(vectors.length > 500);
  for (const v of vectors) {
    const ny = toNewYork(v.ts);
    assert.equal(ny.day, v.nyDay, `day ${v.note}`);
    assert.equal(ny.minute, v.nyMinute, `minute ${v.note}`);
    assert.equal(isDst(v.ts), v.dst, `dst ${v.note}`);
    assert.equal(sessionIndexAt(v.ts), v.session, `${v.note}: expected ${v.name}, got ${SESSIONS[sessionIndexAt(v.ts)]}`);
  }
});

test("New York clock agrees with Intl for 20,000 random instants 2026-2036", () => {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  let seed = 4663;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const lo = Date.UTC(2026, 0, 1) / 1000, hi = Date.UTC(2036, 0, 1) / 1000;
  for (let i = 0; i < 20_000; i++) {
    const ts = Math.floor(lo + rnd() * (hi - lo));
    const p = Object.fromEntries(fmt.formatToParts(new Date(ts * 1000)).map((x) => [x.type, x.value]));
    const day = Date.UTC(+p.year, +p.month - 1, +p.day) / 86_400_000;
    const ny = toNewYork(ts);
    assert.equal(ny.day, day, `day at ${ts}`);
    assert.equal(ny.minute, +p.hour * 60 + +p.minute, `minute at ${ts}`);
  }
});

test("vault quotes match spec/vectors/vault-quotes.json to the wei", () => {
  const { vectors } = vec("vault-quotes.json");
  for (const [i, v] of vectors.entries()) {
    const pool: Pool = {
      priceWad: BigInt(v.priceWad),
      reserveStock: BigInt(v.reserveStock),
      reserveUsd: BigInt(v.reserveUsd),
      stockUnit: 10n ** BigInt(v.stockDecimals),
      usdToWad: 10n ** BigInt(18 - Number(v.usdDecimals)),
    };
    const pricing: Pricing = {
      halfSpreadBps: BigInt(v.halfSpreadBps),
      skewBps: BigInt(v.skewBps),
      spreadMulBps: BigInt(v.spreadMulBps),
      spreadShareBps: BigInt(v.spreadShareBps),
    };
    const r = quoteVault(pool, pricing, v.buy, BigInt(v.amountIn));
    assert.equal(r.amountOut, BigInt(v.amountOut), `amountOut #${i}`);
    assert.equal(r.costWad, BigInt(v.costWad), `costWad #${i}`);
    assert.equal(r.notionalWad, BigInt(v.notionalWad), `notional #${i}`);
    assert.equal(r.spreadShare, BigInt(v.spreadShare), `spreadShare #${i}`);
    assert.equal(r.imbalanceWad, BigInt(v.imbalanceWad), `imbalance #${i}`);
  }
});
