import type { Hex } from "viem";
import { PROTOCOL } from "./protocol";

/**
 * Wallet verification without KYC (docs/ELIGIBILITY.md): the wallet signs the declaration below, the API checks the
 * request's country against config/protocol.json eligibility.blockedCountries and, if both pass, its attester key signs
 * an EligibilityRegistry attestation that the wallet submits on-chain with attest().
 */

/** EIP-712 domain of EligibilityRegistry: EIP712("Paritas Eligibility", "1"). */
export const eligibilityDomain = (chainId: number, registry: Hex) =>
  ({ name: "Paritas Eligibility", version: "1", chainId, verifyingContract: registry }) as const;

/** Mirrors EligibilityRegistry.ATTESTATION_TYPEHASH: Attestation(address account,uint64 validUntil,uint64 issuedAt). */
export const ATTESTATION_TYPES = {
  Attestation: [
    { name: "account", type: "address" },
    { name: "validUntil", type: "uint64" },
    { name: "issuedAt", type: "uint64" },
  ],
} as const;

/** How long a declaration may take to reach the API, either way of its timestamp (seconds of chain time). */
export const DECLARATION_MAX_SKEW_SEC = 600;

export const BLOCKED_COUNTRIES: readonly string[] = PROTOCOL.eligibility.blockedCountries;
export const ATTESTATION_TTL_SEC = PROTOCOL.eligibility.attestationTtlDays * 86_400;

/** The exact text the wallet signs (EIP-191). The API rebuilds it from the same fields, so a word changed here changes both. */
export function declarationMessage(p: { account: Hex; chainId: number; issuedAt: number }) {
  return [
    "Paritas wallet verification",
    "",
    "I am not a US person. I do not live in the United States or its territories.",
    "I will not use Paritas for a US person.",
    "",
    `Wallet: ${p.account}`,
    `Chain: ${p.chainId}`,
    `Time: ${p.issuedAt}`,
  ].join("\n");
}

/** What POST /eligibility/attest answers: the arguments of EligibilityRegistry.attest(). */
export type Attestation = { account: Hex; validUntil: number; issuedAt: number; signature: Hex };
