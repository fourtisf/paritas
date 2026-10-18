/**
 * Typed view of config/protocol.json. The contracts are the authority at runtime: the API reads live
 * values from ParamController and must alert if they differ from this file (see apps/api/src/jobs/params.ts).
 */
import raw from "../../../config/protocol.json";
import type { SessionName } from "./sessions";

export type TierKey = "A" | "B" | "C";

export interface TierParams {
  index: number;
  halfSpreadBps: number;
  skewBps: number;
  bandBps: number;
  clipUsd: number;
  capUsd: number;
}

export interface SessionParams {
  index: number;
  spreadMulBps: number;
  clipMulBps: number;
  bandMulBps: number;
  vaultOpen: boolean;
}

export interface MarketConfig {
  symbol: string; // display only. Logic is always keyed by token address.
  name: string;
  tier: TierKey;
  uniswapPoolFee: number; // Uniswap v3 fee tier in hundredths of a bip (500 = 0.05%)
  wave: 1 | 2; // wave 1 gets a vault at launch
}

export const PROTOCOL = raw as unknown as {
  version: number;
  fees: { protocolFeeBps: number; rfqFeeBps: number; spreadShareBps: number };
  rfq: { minUsd: number; maxUsd: number; quoteTtlSec: number };
  oracle: { vaultMaxAgeSec: number; bandMaxAgeSec: number; sequencerGraceSec: number };
  tiers: Record<TierKey, TierParams>;
  sessions: Record<SessionName, SessionParams>;
  governance: { timelockDelaySec: number; multisigThreshold: number; multisigSigners: number };
  eligibility: { enforcedOnMainnet: boolean; attestationTtlDays: number; blockedCountries: string[] };
  markets: MarketConfig[];
};

export const TIERS = PROTOCOL.tiers;
export const SESSION_PARAMS = PROTOCOL.sessions;
export const MARKETS = PROTOCOL.markets;
export const marketBySymbol = (s: string) => MARKETS.find((m) => m.symbol === s);

/** All-in cost limit for one leg right now, in bps: band x band multiplier - protocol fee. Mirrors SwapRouter.allowedLegCostBps. */
export function allowedLegCostBps(tier: TierParams, session: SessionParams, protocolFeeBps = PROTOCOL.fees.protocolFeeBps) {
  const band = Math.floor((tier.bandBps * session.bandMulBps) / 10_000);
  return band > protocolFeeBps ? band - protocolFeeBps : 0;
}

/** Largest vault order right now in whole USD (0 when vaults are closed). */
export const vaultClipUsd = (tier: TierParams, session: SessionParams) =>
  session.vaultOpen ? (tier.clipUsd * session.clipMulBps) / 10_000 : 0;
