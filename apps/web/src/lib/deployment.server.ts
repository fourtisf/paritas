import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDeployment, parseDeployment, type Deployment, type SupportedChainId } from "@paritas/shared";

/**
 * Contract addresses for this build, read on the server and handed to the client (never from the API).
 * Mainnet and testnet use the bundled deployments/<id>.json and refuse TODOs (getDeployment throws).
 * The local anvil file is read at request time because DeployLocal.s.sol rewrites it on every deploy.
 */
export async function loadDeployment(chainId: SupportedChainId): Promise<{ deployment: Deployment | null; error: string | null }> {
  try {
    if (chainId === 31337) {
      const file = path.resolve(process.cwd(), "../../deployments/31337.json");
      return { deployment: parseDeployment(JSON.parse(await readFile(file, "utf8"))), error: null };
    }
    return { deployment: getDeployment(chainId), error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { deployment: null, error: chainId === 31337 && msg.includes("ENOENT") ? "deployments/31337.json not found. Run DeployLocal.s.sol against anvil first." : msg };
  }
}
