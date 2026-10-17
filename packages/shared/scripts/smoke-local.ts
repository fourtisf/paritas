/**
 * End-to-end check against the local anvil deployment:
 *   1. the TypeScript vault math equals AnchorVault.previewSwap on-chain, to the wei
 *   2. a real SwapRouter.swap from the demo trader lands, and its receipt decodes
 *
 *   anvil --timestamp 1792504800 &
 *   (cd contracts && forge script script/DeployLocal.s.sol --rpc-url local --broadcast)
 *   npm run smoke:local -w @paritas/shared
 */
import { createPublicClient, createWalletClient, http, erc20Abi, maxUint256, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { localAnvil } from "../src/chain";
import { loadLocalDeployment } from "../src/addresses";
import { anchorVaultAbi, swapRouterAbi } from "../src/abi";
import { quoteVault, costBps, protocolFee, minOut } from "../src/quote";
import { decodeRouteLogs } from "../src/receipt";
import { SESSIONS } from "../src/sessions";

const TRADER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"); // anvil #1

const dep = await loadLocalDeployment();
const pub = createPublicClient({ chain: localAnvil, transport: http() });
const wallet = createWalletClient({ chain: localAnvil, transport: http(), account: TRADER });
const vault = dep.paritas.vaults.NVDAx;
const stock = dep.stocks.NVDAx.token;
const USD_TO_WAD = 10n ** 12n;
const STOCK_UNIT = 10n ** 18n;

// 1. local math == on-chain preview
const [priceWad, rStock, rUsd, session, tier, sp, open] = await pub.readContract({ address: vault, abi: anchorVaultAbi, functionName: "state" });
if (!open) throw new Error(`vault closed (session ${SESSIONS[session]}). Start anvil with --timestamp 1792504800`);
const amountIn = 10_000n * 10n ** 6n;
const net = amountIn - protocolFee(amountIn, 2n);
const local = quoteVault(
  { priceWad, reserveStock: rStock, reserveUsd: rUsd, stockUnit: STOCK_UNIT, usdToWad: USD_TO_WAD },
  { halfSpreadBps: BigInt(tier.halfSpreadBps), skewBps: BigInt(tier.skewBps), spreadMulBps: BigInt(sp.spreadMulBps), spreadShareBps: 1000n },
  true,
  net,
);
const chain = await pub.readContract({ address: vault, abi: anchorVaultAbi, functionName: "previewSwap", args: [true, net] });
if (chain.amountOut !== local.amountOut || chain.costWad !== local.costWad || chain.spreadShare !== local.spreadShare) {
  throw new Error(`MISMATCH local ${local.amountOut} vs chain ${chain.amountOut}`);
}
console.log(`1. vault math matches chain: ${formatUnits(local.amountOut, 18)} NVDAx for ${formatUnits(net, 6)} USDG (cost ${Number(local.costWad) / 1e14} bps)`);

// 2. real swap through the router
await pub.waitForTransactionReceipt({
  hash: await wallet.writeContract({ address: dep.usdg, abi: erc20Abi, functionName: "approve", args: [dep.paritas.swapRouter, maxUint256] }),
});
const block = await pub.getBlock();
const params = {
  stock,
  buy: true,
  amountIn,
  minAmountOut: minOut(local.amountOut, 30),
  recipient: TRADER.address,
  deadline: block.timestamp + 1200n,
  legs: [{ venue: 0, amountIn: net, data: "0x" as const }],
};
const hash = await wallet.writeContract({ address: dep.paritas.swapRouter, abi: swapRouterAbi, functionName: "swap", args: [params] });
const rc = await pub.waitForTransactionReceipt({ hash });
const [route] = decodeRouteLogs(rc.logs, dep.paritas.swapRouter);
if (!route || route.amountOut !== local.amountOut) throw new Error("receipt does not match the quote");
const f = route.fills[0];
const c = costBps({ buy: true, usdAmount: f.amountIn, stockAmount: f.amountOut, priceWad: route.oraclePriceWad, stockUnit: STOCK_UNIT, usdToWad: USD_TO_WAD, feeBps: 2 });
console.log(`2. swap landed in block ${rc.blockNumber}: route #${route.routeId}, ${route.fills.length} fill via ${f.venue}, session ${route.session}`);
console.log(`   paid ${formatUnits(route.amountIn, 6)} USDG, got ${formatUnits(route.amountOut, 18)} NVDAx, all-in cost ${c.toFixed(3)} bps, fee ${formatUnits(route.protocolFee, 6)} USDG`);
console.log("smoke test passed");
