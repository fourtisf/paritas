"use client";
import { useCallback, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { readContract, writeContract, waitForTransactionReceipt, getBlock } from "wagmi/actions";
import { erc20Abi, maxUint256, BaseError, ContractFunctionRevertedError } from "viem";
import { swapRouterAbi, decodeRouteLogs, explainError, type RouteRow } from "@paritas/shared";
import type { QuoteResponse } from "./useQuote";

type Step = { label: string; detail: string; state: "todo" | "active" | "done" | "error" };

/**
 * Approve (if needed) -> swap -> wait -> decode the receipt. Drives the prototype's runFlow() modal steps.
 * The deadline is set here from the user's setting (minutes), never by the API.
 */
export function useSwap(addresses: { router: `0x${string}`; usdg: `0x${string}` }) {
  const config = useConfig();
  const { address } = useAccount();
  const [steps, setSteps] = useState<Step[]>([]);
  const [receipt, setReceipt] = useState<RouteRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (q: QuoteResponse, deadlineMinutes: number) => {
      if (!address || !q.swapArgs) return;
      setError(null);
      setReceipt(null);
      const a = q.swapArgs;
      const tokenIn = a.buy ? addresses.usdg : a.stock;
      const amountIn = BigInt(a.amountIn);
      const allowance = await readContract(config, { address: tokenIn, abi: erc20Abi, functionName: "allowance", args: [address, addresses.router] });
      const plan: Step[] = [
        ...(allowance < amountIn ? [{ label: "Approve", detail: "Allow Paritas to use your token", state: "todo" as const }] : []),
        { label: "Confirm swap", detail: "Sign in your wallet", state: "todo" },
        { label: "Settling on Robinhood Chain", detail: "Usually under a second", state: "todo" },
      ];
      setSteps(plan);
      const mark = (i: number, state: Step["state"]) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, state } : x)));
      let i = 0;
      try {
        if (allowance < amountIn) {
          mark(i, "active");
          const h = await writeContract(config, { address: tokenIn, abi: erc20Abi, functionName: "approve", args: [addresses.router, maxUint256] });
          await waitForTransactionReceipt(config, { hash: h });
          mark(i++, "done");
        }
        mark(i, "active");
        const block = await getBlock(config);
        const hash = await writeContract(config, {
          address: addresses.router,
          abi: swapRouterAbi,
          functionName: "swap",
          args: [{
            stock: a.stock,
            buy: a.buy,
            amountIn,
            minAmountOut: BigInt(a.minAmountOut),
            recipient: a.recipient,
            deadline: block.timestamp + BigInt(deadlineMinutes * 60),
            legs: a.legs.map((l) => ({ venue: l.venue, amountIn: BigInt(l.amountIn), data: l.data })),
          }],
        });
        mark(i++, "done");
        mark(i, "active");
        const rc = await waitForTransactionReceipt(config, { hash });
        if (rc.status !== "success") throw new Error("reverted");
        setReceipt(decodeRouteLogs(rc.logs, addresses.router)[0] ?? null);
        mark(i, "done");
      } catch (e) {
        let name: string | undefined;
        if (e instanceof BaseError) {
          const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
          name = rev?.data?.errorName;
          if (e.shortMessage?.includes("User rejected")) name = "UserRejected";
        }
        setError(name === "UserRejected" ? "You cancelled in your wallet. Nothing was traded." : explainError(name));
        mark(i, "error");
      }
    },
    [address, addresses.router, addresses.usdg, config],
  );

  return { run, steps, receipt, error };
}
