import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/styles/platform.css";
import { CHAIN_ID } from "@/lib/env";
import { loadDeployment } from "@/lib/deployment.server";
import { DeploymentProvider } from "@/components/platform/deployment";
import { Shell } from "@/components/platform/Shell";
import { Rosette, SvgDefs } from "@/components/platform/Guilloche";
import { SealMark } from "@/components/brand/Seal";
import { NotLiveWallet } from "@/components/platform/NotLiveWallet";
import { CHAINS } from "@paritas/shared";

export const metadata: Metadata = { title: "Paritas App" };
// The local deployment file changes on every DeployLocal run, so read it per request.
export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const { deployment, error } = await loadDeployment(CHAIN_ID);
  if (!deployment) {
    // Expected on mainnet until deployments/4663.json is filled from Blockscout and Deploy.s.sol has run.
    console.error(`[paritas] no deployment for chain ${CHAIN_ID}: ${error}`);
    return <NotLive detail={CHAIN_ID === 4663 ? null : error} />;
  }
  return (
    <DeploymentProvider deployment={deployment}>
      <Shell>{children}</Shell>
    </DeploymentProvider>
  );
}

/** What visitors see before the contracts exist on this chain. The technical reason is shown off mainnet only. */
function NotLive({ detail }: { detail: string | null }) {
  return (
    <>
      <SvgDefs />
      <header className="bar">
        <a className="logo" href="/" aria-label="Paritas website">
          <SealMark />
          <b>Paritas</b>
        </a>
        <div style={{ marginLeft: "auto" }}>
          <NotLiveWallet />
        </div>
      </header>
      <main className="page">
        <section className="panel">
          <div className="empty">
            <Rosette />
            <h3>Paritas is not live on {CHAINS[CHAIN_ID].name} yet</h3>
            <p>The app opens here once the contracts are deployed and verified on Blockscout.</p>
            {detail && (
              <p className="muted" style={{ fontSize: 12.5 }}>
                {detail}
              </p>
            )}
            <a className="btn btn-line" href="/" style={{ marginTop: 8 }}>
              Back to the website
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
