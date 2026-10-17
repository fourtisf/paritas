/**
 * Vault pricing and route checks. BigInt port of contracts/src/libraries/VaultMath.sol and the
 * band / fee logic in SwapRouter.sol. Every function rounds exactly like Solidity, so the API can
 * quote a vault without an RPC call and the result equals AnchorVault.previewSwap to the wei
 * (checked by test/vectors.test.ts and scripts/smoke-local.ts).
 *
 * Units: priceWad = USD per whole stock token with 18 decimals. Raw = token base units.
 */

export const WAD = 10n ** 18n;
export const BPS = 10_000n;
const BPS_TO_WAD = 10n ** 14n;

export interface Pool {
  priceWad: bigint;
  reserveStock: bigint;
  reserveUsd: bigint;
  stockUnit: bigint; // 10n ** stockDecimals
  usdToWad: bigint; // 10n ** (18n - usdDecimals)
}

export interface Pricing {
  halfSpreadBps: bigint;
  skewBps: bigint;
  spreadMulBps: bigint;
  spreadShareBps: bigint;
}

export interface VaultQuote {
  amountOut: bigint;
  notionalWad: bigint;
  costWad: bigint;
  imbalanceWad: bigint;
  spreadShare: bigint;
}

export function mulDiv(a: bigint, b: bigint, c: bigint, roundUp = false): bigint {
  const p = a * b;
  const q = p / c;
  return roundUp && q * c !== p ? q + 1n : q;
}

/** Solidity signed division truncates toward zero; BigInt division does too. */
const sdiv = (a: bigint, b: bigint) => a / b;

export const stockValueWad = (p: Pool) => mulDiv(p.reserveStock, p.priceWad, p.stockUnit);
export const navWad = (p: Pool) => stockValueWad(p) + p.reserveUsd * p.usdToWad;

export function imbalanceWad(p: Pool): bigint {
  const s = stockValueWad(p);
  const u = p.reserveUsd * p.usdToWad;
  if (s + u === 0n) return 0n;
  return sdiv((s - u) * WAD, s + u);
}

export const spreadWad = (q: Pricing) => q.halfSpreadBps * q.spreadMulBps * 10n ** 10n;

export function cost(p: Pool, q: Pricing, buy: boolean): { costWad: bigint; imbalanceWad: bigint } {
  const imb = imbalanceWad(p);
  const skew = sdiv(q.skewBps * BPS_TO_WAD * imb, WAD);
  const raw = spreadWad(q) + (buy ? -skew : skew);
  return { costWad: raw > 0n ? raw : 0n, imbalanceWad: imb };
}

export function quoteVault(p: Pool, q: Pricing, buy: boolean, amountIn: bigint): VaultQuote {
  const { costWad, imbalanceWad: imb } = cost(p, q, buy);
  if (buy) {
    const usdInWad = amountIn * p.usdToWad;
    const ask = mulDiv(p.priceWad, WAD + costWad, WAD, true);
    const amountOut = mulDiv(usdInWad, p.stockUnit, ask);
    const fair = mulDiv(amountOut, p.priceWad, p.stockUnit);
    const revenue = usdInWad > fair ? usdInWad - fair : 0n;
    return { amountOut, notionalWad: usdInWad, costWad, imbalanceWad: imb, spreadShare: (revenue * q.spreadShareBps) / BPS / p.usdToWad };
  }
  const notionalWad = mulDiv(amountIn, p.priceWad, p.stockUnit);
  const bid = mulDiv(p.priceWad, WAD - costWad, WAD);
  const amountOut = mulDiv(amountIn, bid, p.stockUnit) / p.usdToWad;
  const paid = amountOut * p.usdToWad;
  const revenue = notionalWad > paid ? notionalWad - paid : 0n;
  return { amountOut, notionalWad, costWad, imbalanceWad: imb, spreadShare: (revenue * q.spreadShareBps) / BPS / p.usdToWad };
}

/** Deposits: depositor's stock at the bid, vault's stock at the ask (VaultMath.depositShares). */
export function depositShares(p: Pool, q: Pricing, usdIn: bigint, stockIn: bigint, supply: bigint, minLiquidity = 1000n) {
  const s = spreadWad(q);
  const bid = mulDiv(p.priceWad, WAD - s, WAD);
  const ask = mulDiv(p.priceWad, WAD + s, WAD, true);
  const valueWad = usdIn * p.usdToWad + mulDiv(stockIn, bid, p.stockUnit);
  if (supply === 0n) return { shares: valueWad > minLiquidity ? valueWad - minLiquidity : 0n, valueWad };
  const navAtAsk = p.reserveUsd * p.usdToWad + mulDiv(p.reserveStock, ask, p.stockUnit, true);
  return { shares: navAtAsk === 0n ? 0n : mulDiv(valueWad, supply, navAtAsk), valueWad };
}

export function withdrawAmounts(p: Pool, shares: bigint, supply: bigint) {
  if (supply === 0n) return { usdOut: 0n, stockOut: 0n };
  return { usdOut: (p.reserveUsd * shares) / supply, stockOut: (p.reserveStock * shares) / supply };
}

// ------------------------------------------------------------------ router-level helpers

/** Protocol fee on the USDG side. Buys: from the input. Sells: from the gross output. */
export function protocolFee(amount: bigint, feeBps: bigint): bigint {
  return (amount * feeBps) / BPS;
}

/** Mirrors SwapRouter._checkBand exactly. */
export function legWithinBand(args: {
  buy: boolean;
  amountIn: bigint;
  amountOut: bigint;
  priceWad: bigint;
  stockUnit: bigint;
  usdToWad: bigint;
  allowedBps: bigint;
}): boolean {
  const { buy, amountIn, amountOut, priceWad, stockUnit, usdToWad, allowedBps } = args;
  if (buy) {
    const fair = mulDiv(amountOut, priceWad, stockUnit);
    return amountIn * usdToWad * BPS <= fair * (BPS + allowedBps);
  }
  if (allowedBps >= BPS) return true;
  const fair = mulDiv(amountIn, priceWad, stockUnit);
  return amountOut * usdToWad * BPS >= fair * (BPS - allowedBps);
}

/**
 * All-in cost of a fill versus the oracle in bps (positive = worse than the share price), as a JS number
 * for display. Includes the protocol fee when `feeBps` is passed. This is the "cost" on every receipt.
 */
export function costBps(args: {
  buy: boolean;
  usdAmount: bigint; // raw USDG paid (buy) or received before fee (sell)
  stockAmount: bigint; // raw stock received (buy) or paid (sell)
  priceWad: bigint;
  stockUnit: bigint;
  usdToWad: bigint;
  feeBps?: number;
}): number {
  const fair = mulDiv(args.stockAmount, args.priceWad, args.stockUnit);
  if (fair === 0n) return 0;
  const usdWad = args.usdAmount * args.usdToWad;
  const diff = args.buy ? usdWad - fair : fair - usdWad;
  return Number((diff * 10_000_000n) / fair) / 1000 + (args.feeBps ?? 0);
}

/** Minimum received after slippage tolerance (bps). */
export const minOut = (expected: bigint, slippageBps: number) => (expected * (BPS - BigInt(slippageBps))) / BPS;

export const toWadPrice = (answer: bigint, decimals: number) =>
  decimals <= 18 ? answer * 10n ** BigInt(18 - decimals) : answer / 10n ** BigInt(decimals - 18);
