import { defineChain } from "viem";

/**
 * Robinhood Chain (Arbitrum Nitro / Orbit). RPC and explorer from Robinhood's public docs.
 * VERIFY before mainnet: native gas token (we assume ETH) and whether viem/chains now ships an official
 * definition (prefer it if so). Never hardcode contract addresses here: they live in deployments/<id>.json.
 */
export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" } },
  testnet: true,
});

export const localAnvil = defineChain({
  id: 31337,
  name: "Local (anvil)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

export const CHAINS = { 4663: robinhoodChain, 46630: robinhoodTestnet, 31337: localAnvil } as const;
export type SupportedChainId = keyof typeof CHAINS;

export const explorerTx = (chainId: SupportedChainId, hash: string) =>
  chainId === 31337 ? null : `${CHAINS[chainId].blockExplorers!.default.url}/tx/${hash}`;
export const explorerAddress = (chainId: SupportedChainId, addr: string) =>
  chainId === 31337 ? null : `${CHAINS[chainId].blockExplorers!.default.url}/address/${addr}`;
