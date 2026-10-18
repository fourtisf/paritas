import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ATTESTATION_TTL_SEC,
  ATTESTATION_TYPES,
  BLOCKED_COUNTRIES,
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
 * eligibility.attestationTtlDays. The wallet submits it with attest(); the contract checks the signer is an attester.
 */
export type AttestOutcome =
  | { ok: true; attestation: Attestation; country: string }
  | { ok: false; status: number; error: string; message: string };

const refuse = (status: number, error: string, message: string): AttestOutcome => ({ ok: false, status, error, message });

const attester = env.ATTESTER_PRIVATE_KEY ? privateKeyToAccount(env.ATTESTER_PRIVATE_KEY as Hex) : null;
export const attesterAddress = attester?.address ?? null;

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

  const [isAttester, blocked] = await Promise.all([
    client.readContract({ address: registry, abi: eligibilityRegistryAbi, functionName: "isAttester", args: [attester.address] }),
    client.readContract({ address: registry, abi: eligibilityRegistryAbi, functionName: "blocked", args: [account] }),
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
  return { ok: true, attestation, country };
}
