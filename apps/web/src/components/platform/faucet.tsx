"use client";
/**
 * Test USDG for mock deployments only (DeployTestnet.s.sol on testnet, DeployLocal.s.sol on anvil): the mock token's
 * mint is open to anyone, so the app mints straight to the connected wallet. Never offered on mainnet.
 */
import { useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { writeContract, waitForTransactionReceipt } from "wagmi/actions";
import { parseAbi } from "viem";
import { CHAIN_ID } from "@/lib/env";
import { ensureChain } from "@/lib/chainGuard";
import { txErrorMessage } from "@/hooks/useSwap";
import { useDeployment } from "./deployment";
import { useUI } from "./ui";

const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const FAUCET_USDG = 10_000n * 10n ** 6n; // the mock USDG has 6 decimals, like the real one

export function useTestFaucet(onDone?: () => void) {
  const { d } = useDeployment();
  const { address } = useAccount();
  const config = useConfig();
  const ui = useUI();
  const [busy, setBusy] = useState(false);
  const available = d.mocks && CHAIN_ID !== 4663 && !!address;
  const mint = async () => {
    if (!available || busy) return;
    setBusy(true);
    try {
      await ensureChain(config);
      const hash = await writeContract(config, { chainId: CHAIN_ID, address: d.usdg, abi: mintAbi, functionName: "mint", args: [address!, FAUCET_USDG] });
      await waitForTransactionReceipt(config, { hash });
      ui.toast("Test USDG added", "10,000 test USDG is in your wallet. It has no real value.");
      onDone?.();
    } catch (e) {
      ui.toast("Test USDG not added", txErrorMessage(e).replace(" Nothing was traded.", ""), "info");
    } finally {
      setBusy(false);
    }
  };
  return { available, busy, mint };
}
