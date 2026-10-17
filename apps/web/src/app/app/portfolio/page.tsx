import { Suspense } from "react";
import type { Metadata } from "next";
import { PortfolioPage } from "@/components/platform/pages/Portfolio";

export const metadata: Metadata = { title: "Portfolio | Paritas App" };

export default function Page() {
  return (
    <Suspense>
      <PortfolioPage />
    </Suspense>
  );
}
