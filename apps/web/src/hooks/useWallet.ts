"use client";
/**
 * The connected wallet's live state from the chain (wagmi): token balances, vault shares and what they redeem
 * for, and eligibility. Replaces the prototype's state.bal / state.pos / "Eligible" chip.
 */
import { erc20Abi } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { anchorVaultAbi, eligibilityRegistryAbi } from "@paritas/shared";
import { useDeployment } from "@/components/platform/deployment";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

export function useWallet() {
  const { address, isConnected } = useAccount();
  const { d, markets } = useDeployment();
  const who = address ?? ZERO;
  const vaults = markets.filter((m) => m.vault);

  const bal = useReadContracts({
    contracts: [
      { address: d.usdg, abi: erc20Abi, functionName: "balanceOf", args: [who] },
      ...markets.map((m) => ({ address: m.token, abi: erc20Abi, functionName: "balanceOf" as const, args: [who] as const })),
      ...vaults.map((m) => ({ address: m.vault!, abi: anchorVaultAbi, functionName: "balanceOf" as const, args: [who] as const })),
      { address: d.paritas.eligibilityRegistry, abi: eligibilityRegistryAbi, functionName: "isEligible", args: [who] },
      { address: d.paritas.eligibilityRegistry, abi: eligibilityRegistryAbi, functionName: "enforced" },
    ],
    query: { enabled: isConnected, refetchInterval: 8_000 },
  });
  const r = bal.data;
  const at = (i: number) => (r?.[i]?.status === "success" ? (r[i].result as bigint | boolean) : undefined);

  const balances: Record<string, bigint> = {};
  if (r) {
    balances.USDG = (at(0) as bigint) ?? 0n;
    markets.forEach((m, i) => (balances[m.symbol] = (at(1 + i) as bigint) ?? 0n));
  }
  const shares: Record<string, bigint> = {};
  vaults.forEach((m, i) => (shares[m.symbol] = (at(1 + markets.length + i) as bigint) ?? 0n));
  const base = 1 + markets.length + vaults.length;
  const eligible = at(base) as boolean | undefined;
  const enforced = at(base + 1) as boolean | undefined;

  const held = vaults.filter((m) => (shares[m.symbol] ?? 0n) > 0n);
  const redeem = useReadContracts({
    contracts: held.map((m) => ({ address: m.vault!, abi: anchorVaultAbi, functionName: "previewWithdraw" as const, args: [shares[m.symbol]] as const })),
    query: { enabled: isConnected && held.length > 0, refetchInterval: 8_000 },
  });
  const positions: Record<string, { shares: bigint; usdOut: bigint; stockOut: bigint }> = {};
  held.forEach((m, i) => {
    const x = redeem.data?.[i];
    if (x?.status === "success") {
      const [usdOut, stockOut] = x.result as readonly [bigint, bigint];
      positions[m.symbol] = { shares: shares[m.symbol], usdOut, stockOut };
    }
  });

  return {
    address,
    isConnected,
    loaded: !!r,
    balances,
    positions,
    eligible: eligible === undefined ? undefined : eligible || enforced === false,
    refetch: () => {
      bal.refetch();
      redeem.refetch();
    },
  };
}
