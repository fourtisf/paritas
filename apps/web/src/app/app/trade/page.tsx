import { Suspense } from "react";
import type { Metadata } from "next";
import { TradePage } from "@/components/platform/pages/Trade";

export const metadata: Metadata = { title: "Trade | Paritas App" };

export default function Page() {
  return (
    <Suspense>
      <TradePage />
    </Suspense>
  );
}
