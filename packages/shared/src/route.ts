/**
 * Off-chain route builder used by the API's /quote endpoint. It only proposes legs; SwapRouter enforces
 * the band, the minimum and the fees on-chain, so a bug here can cost a user a worse price but cannot
 * break the protocol's guarantees.
 *
 * Strategy (deterministic, easy to audit): evaluate a small set of candidate splits and pick the one with
 * the most output after the protocol fee:
 *   vault only | uniswap only | rfq only | vault up to its clip + uniswap for the rest | vault + rfq
 * Each venue is a pricing function so the caller decides how to price it (local math, QuoterV2, maker RFQ).
 */
import { BPS, legWithinBand, minOut, protocolFee } from "./quote";

export type VenueId = "vault" | "pool" | "rfq"; // names used by the prototype UI
export const VENUE_INDEX: Record<VenueId, 0 | 1 | 2> = { vault: 0, pool: 1, rfq: 2 }; // Solidity enum Venue

export interface VenueQuoter {
  id: VenueId;
  /** Largest input this venue accepts right now (raw units of the input token); 0n = unavailable. */
  maxIn: bigint;
  /** Smallest input it accepts (RFQ minimum); default 0n. */
  minIn?: bigint;
  /** Output for an exact input, or null when the venue cannot fill it. May call the network. */
  quote(amountIn: bigint): Promise<{ amountOut: bigint; data?: unknown } | null>;
  /** Why it is unavailable, for the UI's venue ladder ("Paused for the weekend", ...). */
  reason?: string;
}

export interface PlannedLeg {
  venue: VenueId;
  amountIn: bigint;
  amountOut: bigint;
  data?: unknown;
}

export interface RoutePlan {
  legs: PlannedLeg[];
  amountIn: bigint; // what the user sends, incl. the protocol fee on buys
  expectedOut: bigint; // after the protocol fee
  minAmountOut: bigint;
  protocolFee: bigint;
}

export interface BuildRouteArgs {
  buy: boolean;
  amountIn: bigint; // what the user typed, raw input units
  feeBps: bigint;
  slippageBps: number;
  venues: VenueQuoter[];
  band: { priceWad: bigint; stockUnit: bigint; usdToWad: bigint; allowedBps: bigint };
}

export async function buildRoute(a: BuildRouteArgs): Promise<RoutePlan | null> {
  const fee = a.buy ? protocolFee(a.amountIn, a.feeBps) : 0n;
  const net = a.amountIn - fee;
  const by = (id: VenueId) => a.venues.find((v) => v.id === id && v.maxIn > 0n);
  const fits = (v: VenueQuoter | undefined, x: bigint) => !!v && x > 0n && x <= v.maxIn && x >= (v.minIn ?? 0n);

  const candidates: Array<Array<[VenueId, bigint]>> = [];
  for (const v of a.venues) if (fits(v, net)) candidates.push([[v.id, net]]);
  const vault = by("vault");
  if (vault && net > vault.maxIn) {
    const rest = net - vault.maxIn;
    if (fits(by("pool"), rest)) candidates.push([["vault", vault.maxIn], ["pool", rest]]);
    if (fits(by("rfq"), rest)) candidates.push([["vault", vault.maxIn], ["rfq", rest]]);
  }

  let best: RoutePlan | null = null;
  for (const c of candidates) {
    const legs: PlannedLeg[] = [];
    let ok = true;
    for (const [id, amt] of c) {
      const q = await by(id)!.quote(amt);
      if (!q || q.amountOut === 0n || !legWithinBand({ buy: a.buy, amountIn: amt, amountOut: q.amountOut, ...a.band })) {
        ok = false;
        break;
      }
      legs.push({ venue: id, amountIn: amt, amountOut: q.amountOut, data: q.data });
    }
    if (!ok) continue;
    const gross = legs.reduce((s, l) => s + l.amountOut, 0n);
    const sellFee = a.buy ? 0n : protocolFee(gross, a.feeBps);
    const out = gross - sellFee;
    if (!best || out > best.expectedOut) {
      best = { legs, amountIn: a.amountIn, expectedOut: out, minAmountOut: minOut(out, a.slippageBps), protocolFee: a.buy ? fee : sellFee };
    }
  }
  return best;
}

export { BPS };
