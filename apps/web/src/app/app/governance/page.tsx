import { Suspense } from "react";
import type { Metadata } from "next";
import { GovernancePage } from "@/components/platform/pages/Governance";

export const metadata: Metadata = { title: "Governance | Paritas App" };

export default function Page() {
  return (
    <Suspense>
      <GovernancePage />
    </Suspense>
  );
}
