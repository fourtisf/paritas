import type { CSSProperties } from "react";

/** Token badge (prototype tok()). Every hue is the same silver; the label is the ticker without the "x". */
export function Tok({ sym, size = "" }: { sym: string; size?: "" | "sm" | "lg" }) {
  const style = { "--h": "#E6E6EA", ...(sym === "USDG" ? { fontSize: 14 } : {}) } as CSSProperties;
  return (
    <span className={`tok ${size}`.trim()} style={style} aria-hidden="true">
      {sym === "USDG" ? "$" : sym.replace(/x$/, "")}
    </span>
  );
}

export const TokBtn = ({ sym }: { sym: string }) => (
  <span className="tokbtn static">
    <Tok sym={sym} size="sm" />
    {sym}
  </span>
);
