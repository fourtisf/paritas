import { createPublicClient, http, type PublicClient } from "viem";
import { CHAINS, getDeployment, loadLocalDeployment, type Deployment, type SupportedChainId } from "@paritas/shared";
import { env } from "./env";

export const chainId = env.CHAIN_ID as SupportedChainId;
export const client: PublicClient = createPublicClient({ chain: CHAINS[chainId], transport: http(env.RPC_URL, { batch: true }) }) as PublicClient;

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

export async function symbolOf(token: string) {
  const d = await deployment();
  return Object.entries(d.stocks).find(([, s]) => s.token.toLowerCase() === token.toLowerCase())?.[0] ?? null;
}
