import { Suspense } from "react";
import type { Metadata } from "next";
import { MarketsPage } from "@/components/platform/pages/Markets";

export const metadata: Metadata = { title: "Markets | Paritas App" };

export default function Page() {
  return (
    <Suspense>
      <MarketsPage />
    </Suspense>
  );
}
