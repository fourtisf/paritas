import { http, createConfig } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { CHAINS, type SupportedChainId } from "@paritas/shared";

/** One chain per build: NEXT_PUBLIC_CHAIN_ID = 4663 (mainnet) | 46630 (testnet) | 31337 (local anvil). */
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337) as SupportedChainId;
const chain = CHAINS[CHAIN_ID];
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected(), ...(wcProjectId ? [walletConnect({ projectId: wcProjectId })] : [])],
  transports: { [chain.id]: http(process.env.NEXT_PUBLIC_RPC_URL ?? chain.rpcUrls.default.http[0]) } as any,
  ssr: true,
});

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
