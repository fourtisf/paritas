import { hypo } from "@/components/landing/format";

// Same rosette as the guilloché mark, inside the seal's double ring.
const ROSETTE = hypo(30, 11, 15, 30.4, 600);

/**
 * The Paritas logo mark: the small form of the guilloché seal (ALFA's logo choice, concept F) for 16-48 px.
 * The full seal with the ring text is in public/brand/. `paint` names the page's silver gradient
 * (#holoG on the platform, #silver on the landing; both are the same stops).
 */
export function SealMark({ paint = "url(#holoG)", size, className }: { paint?: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
      <circle r="46" fill="none" stroke={paint} strokeWidth="3.4" />
      <circle r="39" fill="none" stroke={paint} strokeWidth="1.4" />
      <path d={ROSETTE} fill="none" stroke={paint} strokeWidth="3" />
      <circle r="6" fill="#F5F5F7" />
    </svg>
  );
}
