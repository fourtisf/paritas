import { Suspense } from "react";
import type { Metadata } from "next";
import { ActivityPage } from "@/components/platform/pages/Activity";

export const metadata: Metadata = { title: "Activity | Paritas App" };

export default function Page() {
  return (
    <Suspense>
      <ActivityPage />
    </Suspense>
  );
}
