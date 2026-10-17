import type { SupportedChainId } from "@paritas/shared";

/** One chain per build: NEXT_PUBLIC_CHAIN_ID = 4663 (mainnet) | 46630 (testnet) | 31337 (local anvil). Safe on the server. */
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337) as SupportedChainId;
/** The API base. Absolute in dev (http://localhost:4000); "/api" in production, where Nginx proxies it to Fastify. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** WebSocket URL for an API path, for an absolute or a same-origin ("/api") API_URL. Browser only. */
export function apiWsUrl(path: string) {
  const u = new URL(API_URL.replace(/\/$/, "") + path, window.location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}
