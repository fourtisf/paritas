"use client";
/**
 * Vault deposit and withdrawal flows (prototype vdForm runFlow steps). Deposits are priced like a trade
 * (AnchorVault.previewDeposit, minShares after the user's slippage); withdrawals are in kind and never depend on
 * the session or the oracle (previewWithdraw, minimums after slippage).
 */
import { useCallback, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { readContract, writeContract, waitForTransactionReceipt } from "wagmi/actions";
import { decodeEventLog, erc20Abi, maxUint256, type Log } from "viem";
import { anchorVaultAbi } from "@paritas/shared";
import type { Step } from "@/components/platform/modals";
import { txErrorMessage } from "./useSwap";

type Hex = `0x${string}`;
const BPS = 10_000n;

function vaultEvent(logs: Log[], vault: Hex, name: "Deposit" | "Withdraw") {
  for (const l of logs) {
    if (l.address.toLowerCase() !== vault.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: anchorVaultAbi, data: l.data, topics: l.topics });
      if (ev.eventName === name) return ev.args as unknown as Record<string, bigint>;
    } catch {
      /* other event */
    }
  }
  return null;
}

export function useVaultTx() {
  const config = useConfig();
  const { address } = useAccount();
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mark = (i: number, state: Step["state"]) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, state } : x)));

  const deposit = useCallback(
    async (a: { vault: Hex; usdg: Hex; stock: Hex; sym: string; usdIn: bigint; stockIn: bigint; slipBps: number }) => {
      if (!address) return null;
      setError(null);
      const [ua, ta] = await Promise.all([
        a.usdIn > 0n ? readContract(config, { address: a.usdg, abi: erc20Abi, functionName: "allowance", args: [address, a.vault] }) : Promise.resolve(maxUint256),
        a.stockIn > 0n ? readContract(config, { address: a.stock, abi: erc20Abi, functionName: "allowance", args: [address, a.vault] }) : Promise.resolve(maxUint256),
      ]);
      const approvals: { token: Hex; label: string; detail: string }[] = [];
      if (ua < a.usdIn) approvals.push({ token: a.usdg, label: "Approve USDG", detail: "Allow the vault to pull your USDG" });
      if (ta < a.stockIn) approvals.push({ token: a.stock, label: "Approve " + a.sym, detail: "Allow the vault to pull your " + a.sym });
      setSteps([
        ...approvals.map((x) => ({ label: x.label, detail: x.detail, state: "todo" as const })),
        { label: "Confirm deposit", detail: "Shares are minted at the Chainlink price, less the vault spread", state: "todo" },
      ]);
      let i = 0;
      try {
        for (const x of approvals) {
          mark(i, "active");
          const h = await writeContract(config, { address: x.token, abi: erc20Abi, functionName: "approve", args: [a.vault, maxUint256] });
          await waitForTransactionReceipt(config, { hash: h });
          mark(i++, "done");
        }
        mark(i, "active");
        const [shares] = await readContract(config, { address: a.vault, abi: anchorVaultAbi, functionName: "previewDeposit", args: [a.usdIn, a.stockIn] });
        const minShares = (shares * (BPS - BigInt(a.slipBps))) / BPS;
        const hash = await writeContract(config, { address: a.vault, abi: anchorVaultAbi, functionName: "deposit", args: [a.usdIn, a.stockIn, minShares, address] });
        const rc = await waitForTransactionReceipt(config, { hash });
        if (rc.status !== "success") throw new Error("reverted");
        mark(i, "done");
        const ev = vaultEvent(rc.logs, a.vault, "Deposit");
        return { hash, shares: ev?.shares ?? shares, valueWad: ev?.valueWad ?? 0n };
      } catch (e) {
        setError(txErrorMessage(e));
        mark(i, "error");
        return null;
      }
    },
    [address, config],
  );

  const withdraw = useCallback(
    async (a: { vault: Hex; shares: bigint; slipBps: number }) => {
      if (!address) return null;
      setError(null);
      setSteps([
        { label: "Confirm withdrawal", detail: "Burns your vault shares", state: "active" },
        { label: "Settling on Robinhood Chain", detail: "Tokens arrive in your wallet", state: "todo" },
      ]);
      let i = 0;
      try {
        const [usdOut, stockOut] = await readContract(config, { address: a.vault, abi: anchorVaultAbi, functionName: "previewWithdraw", args: [a.shares] });
        const slip = BPS - BigInt(a.slipBps);
        const hash = await writeContract(config, { address: a.vault, abi: anchorVaultAbi, functionName: "withdraw", args: [a.shares, (usdOut * slip) / BPS, (stockOut * slip) / BPS, address] });
        mark(i++, "done");
        mark(i, "active");
        const rc = await waitForTransactionReceipt(config, { hash });
        if (rc.status !== "success") throw new Error("reverted");
        mark(i, "done");
        const ev = vaultEvent(rc.logs, a.vault, "Withdraw");
        return { hash, usdOut: ev?.usdOut ?? usdOut, stockOut: ev?.stockOut ?? stockOut };
      } catch (e) {
        setError(txErrorMessage(e));
        mark(i, "error");
        return null;
      }
    },
    [address, config],
  );

  return { deposit, withdraw, steps, error };
}
