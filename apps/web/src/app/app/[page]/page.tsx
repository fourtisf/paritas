import { notFound } from "next/navigation";

/**
 * Platform routes. The prototype's hash routes map to real routes:
 *   #/trade -> /app/trade   #/markets -> /app/markets   #/pool -> /app/pool
 *   #/portfolio -> /app/portfolio   #/activity -> /app/activity   #/governance -> /app/governance
 * PORT ME: split each pageXxx() function in prototypes/paritas-platform.html into its own route folder
 * (app/app/trade/page.tsx, ...) and delete this catch-all. Data comes from the API and wagmi, never from the
 * prototype's MARKETS / fills demo arrays (docs/DEMO_TO_PRODUCTION.md).
 */
const PAGES = ["trade", "markets", "pool", "portfolio", "activity", "governance"] as const;

export default function PlatformPage({ params }: { params: { page: string } }) {
  if (!PAGES.includes(params.page as (typeof PAGES)[number])) notFound();
  return <main style={{ padding: 32 }}>Port the “{params.page}” page from prototypes/paritas-platform.html.</main>;
}
