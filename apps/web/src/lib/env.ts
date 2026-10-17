import type { SupportedChainId } from "@paritas/shared";

/** One chain per build: NEXT_PUBLIC_CHAIN_ID = 4663 (mainnet) | 46630 (testnet) | 31337 (local anvil). Safe on the server. */
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337) as SupportedChainId;
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
