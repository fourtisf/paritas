import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/styles/platform.css";
import { CHAIN_ID } from "@/lib/env";
import { loadDeployment } from "@/lib/deployment.server";
import { DeploymentProvider } from "@/components/platform/deployment";
import { Shell } from "@/components/platform/Shell";

export const metadata: Metadata = { title: "Paritas App" };
// The local deployment file changes on every DeployLocal run, so read it per request.
export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const { deployment, error } = await loadDeployment(CHAIN_ID);
  if (!deployment) {
    return (
      <main className="page">
        <section className="panel">
          <div className="empty">
            <h3>Paritas is not deployed on this network yet</h3>
            <p>{error}</p>
          </div>
        </section>
      </main>
    );
  }
  return (
    <DeploymentProvider deployment={deployment}>
      <Shell>{children}</Shell>
    </DeploymentProvider>
  );
}
