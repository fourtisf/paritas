/** The guilloché mark (hypotrochoids) used by the logo, the portfolio card and empty states. */
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

function hypo(R: number, r: number, d: number, radius: number, steps: number) {
  const k = (R - r) / r, T = Math.PI * 2 * (r / gcd(R, r)), sc = radius / (R - r + d);
  let s = "";
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * T;
    s += (i ? "L" : "M") + (((R - r) * Math.cos(t) + d * Math.cos(k * t)) * sc).toFixed(2) + " " + (((R - r) * Math.sin(t) - d * Math.sin(k * t)) * sc).toFixed(2);
  }
  return s;
}

const OUTER = hypo(30, 11, 15, 46, 900);
const INNER = hypo(20, 8, 9, 30, 700);

export function MarkPaths({ w = 2.6 }: { w?: number }) {
  return (
    <>
      <path d={OUTER} fill="none" stroke="url(#holoG)" strokeWidth={w} />
      <path d={INNER} fill="none" stroke="#F5F5F7" strokeWidth={w} opacity=".45" />
    </>
  );
}

export function Mark({ w, className, size }: { w?: number; className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="-50 -50 100 100" aria-hidden="true">
      <MarkPaths w={w} />
    </svg>
  );
}

export const Rosette = ({ className = "ros" }: { className?: string }) => <Mark w={0.8} className={className} />;

/** The SVG gradients the prototype defines once per page (holoG for rings and marks, holoH for chart lines). */
export function SvgDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <linearGradient id="holoG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset=".5" stopColor="#B8B8C0" />
          <stop offset="1" stopColor="#6C6C76" />
        </linearGradient>
        <linearGradient id="holoH" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#F5F5F7" />
          <stop offset="1" stopColor="#F5F5F7" />
        </linearGradient>
      </defs>
    </svg>
  );
}
