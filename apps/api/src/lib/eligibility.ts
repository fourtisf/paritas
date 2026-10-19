import { createWalletClient, formatEther, getAddress, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ATTESTATION_TTL_SEC,
  ATTESTATION_TYPES,
  BLOCKED_COUNTRIES,
  CHAINS,
  DECLARATION_MAX_SKEW_SEC,
  declarationMessage,
  eligibilityDomain,
  eligibilityRegistryAbi,
  type Attestation,
} from "@paritas/shared";
import { chainId, chainNow, client, deployment } from "./chain";
import { db } from "./db";
import { env } from "./env";
import { countryOf } from "./geo";

/**
 * Wallet verification without KYC (docs/ELIGIBILITY.md). A wallet gets an attestation when:
 *  1. the request comes from a country outside eligibility.blockedCountries (on mainnet an unknown country is refused)
 *  2. the wallet signed the declaration (declarationMessage) within DECLARATION_MAX_SKEW_SEC of chain time
 *  3. the wallet is not blocked on-chain
 * The attestation is EligibilityRegistry's EIP-712 Attestation, signed by ATTESTER_PRIVATE_KEY, valid for
 * eligibility.attestationTtlDays. The API submits it with attest() from the attester key and pays the network fee,
 * so the wallet only signs the declaration (one confirmation). If that transaction fails (no ETH left for gas, RPC
 * error), txHash is null and the app submits the same attestation from the wallet; the contract accepts it from anyone.
 */
export type AttestOutcome =
  | { ok: true; attestation: Attestation; country: string; txHash: Hex | null; alreadyVerified: boolean }
  | { ok: false; status: number; error: string; message: string };

const refuse = (status: number, error: string, message: string): AttestOutcome => ({ ok: false, status, error, message });

const attester = env.ATTESTER_PRIVATE_KEY ? privateKeyToAccount(env.ATTESTER_PRIVATE_KEY as Hex) : null;
export const attesterAddress = attester?.address ?? null;
const wallet = attester ? createWalletClient({ account: attester, chain: CHAINS[chainId], transport: http(env.RPC_URL) }) : null;
const RELAY_MIN_BALANCE = parseEther("0.00002"); // a few attest() calls at Robinhood Chain prices
const RENEW_WITHIN_SEC = 7 * 86_400; // a wallet verified for longer than this gets no new transaction

/** Whether the attester key can pay for attest() (cached for a minute). The app says "free" only then. */
let funded = { at: 0, ok: false };
export async function relayFunded() {
  if (!attester) return false;
  if (Date.now() - funded.at > 60_000) {
    const bal = await client.getBalance({ address: attester.address }).catch(() => 0n);
    funded = { at: Date.now(), ok: bal >= RELAY_MIN_BALANCE };
    if (!funded.ok) console.warn(`attester ${attester.address} has ${formatEther(bal)} ETH: wallets will pay for attest() themselves`);
  }
  return funded.ok;
}

// One transaction at a time from the attester key, so concurrent verifications never reuse a nonce.
let queue: Promise<unknown> = Promise.resolve();
function submit(registry: Hex, a: Attestation): Promise<Hex | null> {
  const send = async () => {
    try {
      const hash = await wallet!.writeContract({
        address: registry,
        abi: eligibilityRegistryAbi,
        functionName: "attest",
        args: [a.account as Hex, BigInt(a.validUntil), BigInt(a.issuedAt), a.signature as Hex],
      });
      const rc = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
      return rc.status === "success" ? hash : null;
    } catch (e) {
      console.warn("attest() from the attester failed; the wallet will submit it", (e as Error).message.split("\n")[0]);
      funded.at = 0; // re-check the balance next time
      return null;
    }
  };
  const p = queue.then(send, send);
  queue = p;
  return p;
}

export async function attestWallet(p: { ip: string; account: string; issuedAt: number; signature: Hex }): Promise<AttestOutcome> {
  if (!attester) return refuse(503, "not configured", "Wallet verification is not open yet.");
  const d = await deployment();
  const registry = d.paritas.eligibilityRegistry;

  const found = countryOf(p.ip);
  if (!found && chainId === 4663) {
    return refuse(403, "location unknown", "We could not check your location. Turn off any VPN or proxy and try again.");
  }
  const country = found ?? "XX"; // local and testnet runs without a country database
  if (BLOCKED_COUNTRIES.includes(country)) return refuse(403, "restricted", "Paritas is not available in your region.");

  const account = getAddress(p.account);
  const now = Math.floor(await chainNow());
  if (Math.abs(now - p.issuedAt) > DECLARATION_MAX_SKEW_SEC) {
    return refuse(400, "stale", "This signature is too old. Sign again.");
  }
  const message = declarationMessage({ account, chainId, issuedAt: p.issuedAt });
  // verifyMessage also handles smart-contract wallets (ERC-1271, ERC-6492)
  const signed = await client.verifyMessage({ address: account, message, signature: p.signature }).catch(() => false);
  if (!signed) return refuse(400, "bad signature", "The signature does not match this wallet.");

  const [isAttester, blocked, eligible, until] = await Promise.all([
    client.readContract({ address: registry, abi: eligibilityRegistryAbi, functionName: "isAttester", args: [attester.address] }),
    client.readContract({ address: registry, abi: eligibilityRegistryAbi, functionName: "blocked", args: [account] }),
    client.readContract({ address: registry, abi: eligibilityRegistryAbi, functionName: "isEligible", args: [account] }),
    client.readContract({ address: registry, abi: eligibilityRegistryAbi, functionName: "validUntil", args: [account] }),
  ]);
  if (!isAttester) return refuse(503, "not configured", "Wallet verification is not open yet.");
  if (blocked) return refuse(403, "blocked", "This wallet is blocked from Paritas.");

  // issuedAt is chain time, so attest() never sees it in the future; validUntil counts from it
  const attestation: Attestation = { account, issuedAt: now, validUntil: now + ATTESTATION_TTL_SEC, signature: "0x" };
  attestation.signature = await attester.signTypedData({
    domain: eligibilityDomain(chainId, registry),
    types: ATTESTATION_TYPES,
    primaryType: "Attestation",
    message: { account, validUntil: BigInt(attestation.validUntil), issuedAt: BigInt(attestation.issuedAt) },
  });

  await db.eligibilityGrant.create({
    data: {
      chainId,
      account: account.toLowerCase(),
      country,
      declaredAt: new Date(p.issuedAt * 1000),
      validUntil: new Date(attestation.validUntil * 1000),
      declarationSig: p.signature,
    },
  });
  // already verified for a while: nothing to send (and nothing for repeated requests to spend)
  const alreadyVerified = eligible && Number(until) > now + RENEW_WITHIN_SEC;
  const txHash = alreadyVerified || !(await relayFunded()) ? null : await submit(registry, attestation);
  return { ok: true, attestation, country, txHash, alreadyVerified };
}
