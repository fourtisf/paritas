"use client";
import { useCallback, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { readContract, writeContract, waitForTransactionReceipt, getBlock } from "wagmi/actions";
import { erc20Abi, maxUint256, BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import { swapRouterAbi, decodeRouteLogs, explainError, PROTOCOL, type RouteRow } from "@paritas/shared";
import type { QuoteResponse } from "./useQuote";
import { CHAIN_ID } from "@/lib/env";
import { ensureChain } from "@/lib/chainGuard";

type Step = { label: string; detail: string; state: "todo" | "active" | "done" | "error" };

/** Wallet errors and contract reverts in the prototype's plain words (packages/shared/src/errors.ts). */
export function txErrorMessage(e: unknown) {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError) || /user rejected|denied/i.test(e.shortMessage ?? "")) return "You cancelled in your wallet. Nothing was traded.";
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    return explainError(rev?.data?.errorName);
  }
  return explainError();
}

/**
 * Approve (if needed) -> swap -> wait -> decode the receipt. Drives the prototype's runFlow() modal steps.
 * The deadline is set here (config swap.deadlineSec on chain time), never by the API. The app does not show it.
 */
export function useSwap(addresses: { router: `0x${string}`; usdg: `0x${string}` }) {
  const config = useConfig();
  const { address } = useAccount();
  const [steps, setSteps] = useState<Step[]>([]);
  const [receipt, setReceipt] = useState<RouteRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (q: QuoteResponse, payToken: string) => {
      if (!address || !q.swapArgs) return null;
      setError(null);
      setReceipt(null);
      const a = q.swapArgs;
      const tokenIn = a.buy ? addresses.usdg : a.stock;
      const amountIn = BigInt(a.amountIn);
      const allowance = await readContract(config, { address: tokenIn, abi: erc20Abi, functionName: "allowance", args: [address, addresses.router] });
      const needsApproval = allowance < amountIn;
      const plan: Step[] = [
        ...(needsApproval ? [{ label: `Approve ${payToken}`, detail: "One-time permission for the router", state: "todo" as const }] : []),
        { label: "Confirm in your wallet", detail: "Sign with your slippage", state: "todo" },
        { label: "Settling on Robinhood Chain", detail: "Usually under a second", state: "todo" },
      ];
      setSteps(plan);
      const mark = (i: number, state: Step["state"]) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, state } : x)));
      let i = 0;
      try {
        await ensureChain(config);
        if (needsApproval) {
          mark(i, "active");
          const h = await writeContract(config, { chainId: CHAIN_ID, address: tokenIn, abi: erc20Abi, functionName: "approve", args: [addresses.router, maxUint256] });
          await waitForTransactionReceipt(config, { hash: h });
          mark(i++, "done");
        }
        mark(i, "active");
        const block = await getBlock(config);
        const hash = await writeContract(config, {
          chainId: CHAIN_ID,
          address: addresses.router,
          abi: swapRouterAbi,
          functionName: "swap",
          args: [
            {
              stock: a.stock,
              buy: a.buy,
              amountIn,
              minAmountOut: BigInt(a.minAmountOut),
              recipient: a.recipient,
              deadline: block.timestamp + BigInt(PROTOCOL.swap.deadlineSec),
              legs: a.legs.map((l) => ({ venue: l.venue, amountIn: BigInt(l.amountIn), data: l.data })),
            },
          ],
        });
        mark(i++, "done");
        mark(i, "active");
        const rc = await waitForTransactionReceipt(config, { hash });
        if (rc.status !== "success") throw new Error("reverted");
        const route = decodeRouteLogs(rc.logs, addresses.router)[0] ?? null;
        setReceipt(route);
        mark(i, "done");
        return route;
      } catch (e) {
        setError(txErrorMessage(e));
        mark(i, "error");
        return null;
      }
    },
    [address, addresses.router, addresses.usdg, config],
  );

  return { run, steps, receipt, error };
}
