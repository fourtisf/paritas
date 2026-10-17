import { http, createConfig } from "wagmi";
import { coinbaseWallet, injected, mock, walletConnect } from "wagmi/connectors";
import { CHAINS } from "@paritas/shared";
import { CHAIN_ID, API_URL } from "./env";

export { CHAIN_ID, API_URL };
const chain = CHAINS[CHAIN_ID];
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

/**
 * Local anvil only: anvil account #1 (the deploy script's demo trader, funded with test USDG and stock tokens).
 * Anvil signs for its unlocked accounts, so this sends real transactions to the local chain without a wallet app.
 */
export const LOCAL_TEST_WALLET = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

/** The mock connector forgets it was connected on reload; reconnect it if it was the last wallet used here. */
function localWalletWasConnected() {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem("wagmi.recentConnectorId") === '"mock"';
  } catch {
    return false;
  }
}

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [
    injected(),
    ...(wcProjectId ? [walletConnect({ projectId: wcProjectId, showQrModal: true })] : []),
    coinbaseWallet({ appName: "Paritas", preference: { options: "all", telemetry: false } }),
    ...(CHAIN_ID === 31337 ? [mock({ accounts: [LOCAL_TEST_WALLET], features: { reconnect: true, defaultConnected: localWalletWasConnected() } })] : []),
  ],
  transports: { [chain.id]: http(process.env.NEXT_PUBLIC_RPC_URL ?? chain.rpcUrls.default.http[0]) } as any,
  ssr: true,
});
