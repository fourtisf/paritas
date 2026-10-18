"use client";
/**
 * Wallet verification without KYC (docs/ELIGIBILITY.md). The wallet signs the declaration from @paritas/shared, the
 * API checks the connection's country and answers with an attestation, and the wallet submits it with
 * EligibilityRegistry.attest(). Shown only when the API has an attester (GET /eligibility).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useConfig } from "wagmi";
import { getBlock, signMessage, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { declarationMessage, eligibilityRegistryAbi, PROTOCOL, type Attestation } from "@paritas/shared";
import { API_URL, CHAIN_ID } from "@/lib/wagmi";
import { ensureChain } from "@/lib/chainGuard";
import { txErrorMessage } from "@/hooks/useSwap";
import { useDeployment } from "./deployment";
import { Icon } from "./Icon";
import { Modal, ModalHead, useUI } from "./ui";

const DAYS = PROTOCOL.eligibility.attestationTtlDays;

/** The API refused (region, location, rate limit): its message is already plain English. */
class Refused extends Error {}

export function useVerifyOpen() {
  const q = useQuery({
    queryKey: ["eligibility"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/eligibility`);
      return r.ok ? ((await r.json()) as { open: boolean }) : { open: false };
    },
    staleTime: 60_000,
  });
  return q.data?.open === true;
}

export function VerifyModal({ onDone }: { onDone?: () => void }) {
  const { address } = useAccount();
  const config = useConfig();
  const { d } = useDeployment();
  const ui = useUI();
  const [agree, setAgree] = useState(false);
  const [step, setStep] = useState<"idle" | "sign" | "check" | "send">("idle");
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (!address) return;
    setErr(null);
    try {
      await ensureChain(config);
      setStep("sign");
      const issuedAt = Number((await getBlock(config, { chainId: CHAIN_ID })).timestamp); // chain time, as the API checks it
      const signature = await signMessage(config, { account: address, message: declarationMessage({ account: address, chainId: CHAIN_ID, issuedAt }) });
      setStep("check");
      const r = await fetch(`${API_URL}/eligibility/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: address, issuedAt, signature }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Refused(body.message ?? "Verification is not available right now. Try again later.");
      const a = body as Attestation;
      setStep("send");
      const hash = await writeContract(config, {
        chainId: CHAIN_ID,
        address: d.paritas.eligibilityRegistry,
        abi: eligibilityRegistryAbi,
        functionName: "attest",
        args: [a.account, BigInt(a.validUntil), BigInt(a.issuedAt), a.signature],
      });
      await waitForTransactionReceipt(config, { hash });
      ui.closeModal();
      ui.toast("Wallet verified", `You can trade and provide liquidity for ${DAYS} days.`);
      onDone?.();
    } catch (e) {
      setStep("idle");
      setErr(e instanceof Refused ? e.message : txErrorMessage(e).replace(" Nothing was traded.", ""));
    }
  };

  const label = { idle: "Sign and verify", sign: "Sign in your wallet…", check: "Checking…", send: "Confirm in your wallet…" }[step];
  return (
    <Modal label="Verify your wallet">
      <ModalHead title="Verify your wallet" />
      <div className="modal-b">
        <p className="t2" style={{ margin: "0 0 16px" }}>
          Stock tokens are not for US persons. Confirm this once with your wallet. It lasts {DAYS} days.
        </p>
        <label className="switch">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} disabled={step !== "idle"} />
          <span className="switch-track" />
          <span className="t2" style={{ fontSize: 13.5 }}>
            I am not a US person. I do not live in the United States or its territories.
          </span>
        </label>
        <div className="note note-lav" style={{ marginTop: 16 }}>
          <span>
            <Icon n="info" />
          </span>
          <span>
            You sign a message, which is free, then send one transaction with a small network fee. We check your country
            from your connection and keep your signed statement. We do not ask for documents.{" "}
            <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">
              IP geolocation by DB-IP
            </a>
            .
          </span>
        </div>
        {err && (
          <div className="note note-warn" style={{ marginTop: 12 }}>
            <span>
              <Icon n="info" />
            </span>
            <span>{err}</span>
          </div>
        )}
        <button className="btn btn-holo btn-lg btn-block" style={{ marginTop: 16 }} disabled={!agree || step !== "idle"} onClick={run}>
          {step !== "idle" && <span className="spin" />}
          {label}
        </button>
      </div>
    </Modal>
  );
}
