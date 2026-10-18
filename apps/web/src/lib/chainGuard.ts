import type { Config } from "wagmi";
import { getAccount, switchChain } from "wagmi/actions";
import { CHAIN_ID } from "./env";

/**
 * Run before every transaction: the wallet must be on this build's chain. Asks it to switch, and to add the network
 * (from the chain definition in @paritas/shared) when it does not know it. Writes also pass chainId: CHAIN_ID, so a
 * wallet that stays on another chain makes the transaction fail instead of sending it to the wrong network.
 */
export async function ensureChain(config: Config) {
  if (getAccount(config).chainId !== CHAIN_ID) await switchChain(config, { chainId: CHAIN_ID });
}
