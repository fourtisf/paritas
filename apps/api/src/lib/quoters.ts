/**
 * Venue pricing for /quote. Each function returns a VenueQuoter for packages/shared buildRoute.
 *  - vault: AnchorVault.state() once, then pure local math (quote.ts), identical to previewSwap
 *  - pool:  Uniswap QuoterV2 eth_call (mainnet/testnet) or the mock router's fixed rate (anvil)
 *  - rfq:   signed quotes collected from connected makers (rfq.ts)
 */
import { parseAbi, type Hex } from "viem";
import {
  anchorVaultAbi,
  oracleRouterAbi,
  quoteVault,
  vaultClipUsd,
  isHolidayAt,
  PROTOCOL,
  SESSIONS,
  type VenueQuoter,
} from "@paritas/shared";
import { client, deployment, chainId } from "./chain";
import { requestRfq } from "./rfq";

const quoterV2Abi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
const mockRouterAbi = parseAbi(["function rate(address,address) view returns (uint256)"]);

export interface Ctx {
  stock: Hex;
  usdg: Hex;
  buy: boolean;
  trader: Hex;
  stockUnit: bigint;
  usdToWad: bigint;
  uniswapPoolFee: number;
  vault: Hex | null;
  now: number; // chain time (chainNow)
}

/** The vault quoter also reports its spread inputs so /quote can itemize "Spread" and "Inventory adjustment". */
export type VaultQuoter = VenueQuoter & { halfSpreadBps: number; spreadMulBps: number };

export async function vaultQuoter(c: Ctx): Promise<VaultQuoter> {
  const off = { id: "vault" as const, maxIn: 0n, quote: async () => null, halfSpreadBps: 0, spreadMulBps: 0 };
  if (!c.vault) return { ...off, reason: "Opens in the second wave" };
  const [priceWad, reserveStock, reserveUsd, session, tier, sp, open] = await client.readContract({
    address: c.vault,
    abi: anchorVaultAbi,
    functionName: "state",
  });
  if (!open) {
    const closed = SESSIONS[session] === "closed";
    return { ...off, reason: closed ? (isHolidayAt(c.now) ? "Paused for the market holiday" : "Paused for the weekend") : "Paused" };
  }
  // state() does not check the vault's oracle age or the issuer's price pause; swap() does. Check them here so we
  // never offer a vault leg that would revert.
  const d = await deployment();
  const fresh = await client
    .readContract({ address: d.paritas.oracleRouter, abi: oracleRouterAbi, functionName: "vaultPrice", args: [c.stock, BigInt(PROTOCOL.oracle.vaultMaxAgeSec)] })
    .then(() => null)
    .catch((e: unknown) => (String(e).includes("OraclePausedByIssuer") ? "Issuer paused its price" : "Waiting for a fresh Chainlink price"));
  if (fresh) return { ...off, reason: fresh };
  const pool = { priceWad, reserveStock, reserveUsd, stockUnit: c.stockUnit, usdToWad: c.usdToWad };
  const pricing = {
    halfSpreadBps: BigInt(tier.halfSpreadBps),
    skewBps: BigInt(tier.skewBps),
    spreadMulBps: BigInt(sp.spreadMulBps),
    spreadShareBps: BigInt(PROTOCOL.fees.spreadShareBps), // VERIFY against ParamController.spreadShareBps() in jobs/params
  };
  // clip in input units: USD for buys, tokens at the oracle price for sells
  const clipWad = (BigInt(tier.clipUsd) * 10n ** 18n * BigInt(sp.clipMulBps)) / 10_000n;
  const maxIn = c.buy ? clipWad / c.usdToWad : (clipWad * c.stockUnit) / priceWad;
  return {
    id: "vault",
    halfSpreadBps: Number(tier.halfSpreadBps),
    spreadMulBps: Number(sp.spreadMulBps),
    maxIn, // inventory is checked per quote below
    quote: async (amountIn) => {
      const r = quoteVault(pool, pricing, c.buy, amountIn);
      if (c.buy ? r.amountOut > reserveStock : r.amountOut + r.spreadShare > reserveUsd) return null;
      return { amountOut: r.amountOut, data: { costWad: r.costWad, spreadShare: r.spreadShare } };
    },
  };
}

export async function poolQuoter(c: Ctx): Promise<VenueQuoter> {
  const d = await deployment();
  const tokenIn = c.buy ? c.usdg : c.stock;
  const tokenOut = c.buy ? c.stock : c.usdg;
  if (chainId === 31337) {
    const rate = await client.readContract({ address: d.uniswapV3SwapRouter02, abi: mockRouterAbi, functionName: "rate", args: [tokenIn, tokenOut] });
    return { id: "pool", maxIn: 2n ** 200n, quote: async (x) => ({ amountOut: (x * rate) / 10n ** 18n }) };
  }
  if (!d.uniswapQuoterV2) return { id: "pool", maxIn: 0n, quote: async () => null, reason: "Uniswap quoter not configured" };
  return {
    id: "pool",
    maxIn: 2n ** 200n,
    quote: async (amountIn) => {
      try {
        const { result } = await client.simulateContract({
          address: d.uniswapQuoterV2!,
          abi: quoterV2Abi,
          functionName: "quoteExactInputSingle",
          args: [{ tokenIn, tokenOut, amountIn, fee: c.uniswapPoolFee, sqrtPriceLimitX96: 0n }],
        });
        return { amountOut: result[0] };
      } catch {
        return null; // no pool or no liquidity at this size
      }
    },
  };
}

export function rfqQuoter(c: Ctx): VenueQuoter {
  const min = BigInt(PROTOCOL.rfq.minUsd), max = BigInt(PROTOCOL.rfq.maxUsd);
  // limits are in USD; for sells the router passes token amounts, so the relay re-checks the USD side
  return {
    id: "rfq",
    maxIn: c.buy ? (max * 10n ** 18n) / c.usdToWad : 2n ** 200n,
    minIn: c.buy ? (min * 10n ** 18n) / c.usdToWad : 0n,
    quote: async (amountIn) => {
      const best = await requestRfq({ taker: c.trader, stock: c.stock, takerBuys: c.buy, amountIn });
      return best ? { amountOut: best.quote.amountOut, data: best } : null;
    },
  };
}

export { vaultClipUsd };
