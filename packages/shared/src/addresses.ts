/**
 * Contract addresses come ONLY from deployments/<chainId>.json (written by the deploy scripts, external
 * addresses filled in by a human after checking Blockscout). getDeployment throws on any TODO so the app
 * can never silently talk to a wrong or placeholder address.
 */
import mainnet from "../../../deployments/4663.json";
import testnet from "../../../deployments/46630.json";
import type { SupportedChainId } from "./chain";

type Hex = `0x${string}`;

export interface Deployment {
  chainId: number;
  usdg: Hex;
  uniswapV3SwapRouter02: Hex;
  uniswapQuoterV2?: Hex;
  stocks: Record<string, { token: Hex; chainlinkFeed: Hex }>;
  paritas: {
    swapRouter: Hex;
    vaultFactory: Hex;
    paramController: Hex;
    sessionController: Hex;
    oracleRouter: Hex;
    eligibilityRegistry: Hex;
    rfqSettlement: Hex;
    feeCollector: Hex;
    timelock: Hex;
    uniswapV3Adapter: Hex;
    deployedAtBlock: number;
    vaults: Record<string, Hex>;
  };
}

const isAddr = (x: unknown): x is Hex => typeof x === "string" && /^0x[0-9a-fA-F]{40}$/.test(x);

function must(v: unknown, what: string, chainId: number): Hex {
  if (!isAddr(v)) throw new Error(`deployments/${chainId}.json: ${what} is not set (${String(v)}). Fill it from Blockscout or run the deploy script.`);
  return v;
}

// deployments/31337.json exists only after `forge script script/DeployLocal.s.sol`; it is loaded at runtime by
// loadLocalDeployment() so builds do not depend on it.
const FILES: Record<number, any> = { 4663: mainnet, 46630: testnet };

export function parseDeployment(j: any): Deployment {
  const id = j.chainId as number;
  const ext = j.external ?? {};
  const p = j.paritas ?? {};
  const stocks: Deployment["stocks"] = {};
  for (const [sym, s] of Object.entries<any>(ext.stocks ?? {})) {
    stocks[sym] = { token: must(s.token, `external.stocks.${sym}.token`, id), chainlinkFeed: must(s.chainlinkFeed, `external.stocks.${sym}.chainlinkFeed`, id) };
  }
  const vaults: Record<string, Hex> = {};
  for (const [sym, v] of Object.entries<any>(p.vaults ?? {})) if (isAddr(v) && !/^0x0{40}$/.test(v)) vaults[sym] = v;
  const k = (name: string) => must(p[name], `paritas.${name}`, id);
  return {
    chainId: id,
    usdg: must(ext.usdg?.address, "external.usdg.address", id),
    uniswapV3SwapRouter02: must(ext.uniswapV3SwapRouter02?.address, "external.uniswapV3SwapRouter02.address", id),
    uniswapQuoterV2: isAddr(ext.uniswapQuoterV2?.address) ? ext.uniswapQuoterV2.address : undefined,
    stocks,
    paritas: {
      swapRouter: k("swapRouter"),
      vaultFactory: k("vaultFactory"),
      paramController: k("paramController"),
      sessionController: k("sessionController"),
      oracleRouter: k("oracleRouter"),
      eligibilityRegistry: k("eligibilityRegistry"),
      rfqSettlement: k("rfqSettlement"),
      feeCollector: k("feeCollector"),
      timelock: k("timelock"),
      uniswapV3Adapter: k("uniswapV3Adapter"),
      deployedAtBlock: Number(p.deployedAtBlock ?? 0),
      vaults,
    },
  };
}

export function getDeployment(chainId: SupportedChainId): Deployment {
  const j = FILES[chainId];
  if (!j) throw new Error(`No bundled deployment for chain ${chainId}. For 31337 use loadLocalDeployment().`);
  return parseDeployment(j);
}

/** Node only (API, scripts). Reads deployments/31337.json written by DeployLocal.s.sol. */
export async function loadLocalDeployment(): Promise<Deployment> {
  const { readFile } = await import("node:fs/promises");
  const url = new URL("../../../deployments/31337.json", import.meta.url);
  return parseDeployment(JSON.parse(await readFile(url, "utf8")));
}
