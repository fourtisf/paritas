import { tokenLogo } from "@/lib/tokenLogos";

/** What goes inside a .tok badge: the company mark in the badge's ink, or the ticker for funds (SPY, QQQ). */
export function TokenMark({ sym }: { sym: string }) {
  const d = tokenLogo(sym);
  if (!d) return <>{sym.replace(/x$/, "")}</>;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} fill="currentColor" />
    </svg>
  );
}
