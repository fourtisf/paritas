import { createPublicClient, http, type PublicClient } from "viem";
import { CHAINS, getDeployment, loadLocalDeployment, type Deployment, type SupportedChainId } from "@paritas/shared";
import { env } from "./env";

export const chainId = env.CHAIN_ID as SupportedChainId;
// Small JSON-RPC batches with retries: public RPCs refuse or rate-limit large bursts (the backfill reads many rounds).
export const client: PublicClient = createPublicClient({
  chain: CHAINS[chainId],
  transport: http(env.RPC_URL, { batch: { batchSize: 10 }, retryCount: 4, retryDelay: 500 }),
}) as PublicClient;

/** One line for logs: viem's short message and details, not the whole error object. */
export const brief = (e: unknown) => {
  const x = e as { shortMessage?: string; details?: string; message?: string };
  return [x.shortMessage ?? String(x.message ?? e).split("\n")[0], x.details].filter(Boolean).join(" · ");
};

let cached: Deployment | null = null;
/** Throws with a clear message if deployments/<chainId>.json still has TODOs. */
export async function deployment(): Promise<Deployment> {
  if (!cached) cached = chainId === 31337 ? await loadLocalDeployment() : getDeployment(chainId);
  return cached;
}

/** symbol <-> token address. Logic always uses addresses; symbols are for URLs and display. */
export async function stockBySymbol(sym: string) {
  const d = await deployment();
  const s = d.stocks[sym];
  if (!s) return null;
  return { symbol: sym, token: s.token, feed: s.chainlinkFeed, vault: d.paritas.vaults[sym] ?? null };
}

/**
 * The contracts' clock: the latest block timestamp in seconds. Sessions, candles and "last 24 hours" use it so the
 * API agrees with SessionLib on-chain. On mainnet it tracks the wall clock; on anvil it is whatever --timestamp set.
 */
let clock = { seenAt: 0, ts: 0 };
export async function chainNow(): Promise<number> {
  const age = (Date.now() - clock.seenAt) / 1000;
  if (age < 1) return clock.ts + age;
  const b = await client.getBlock();
  clock = { seenAt: Date.now(), ts: Number(b.timestamp) };
  return clock.ts;
}

export async function symbolOf(token: string) {
  const d = await deployment();
  return Object.entries(d.stocks).find(([, s]) => s.token.toLowerCase() === token.toLowerCase())?.[0] ?? null;
}
