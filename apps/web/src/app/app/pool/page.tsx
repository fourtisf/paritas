import { Suspense } from "react";
import type { Metadata } from "next";
import { PoolPage } from "@/components/platform/pages/Pool";

export const metadata: Metadata = { title: "Pool | Paritas App" };

export default function Page() {
  return (
    <Suspense>
      <PoolPage />
    </Suspense>
  );
}
