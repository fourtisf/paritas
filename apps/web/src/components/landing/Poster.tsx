"use client";
import { useEffect, useState } from "react";
import { hypo } from "./format";

/** The no-WebGL poster (prototype `.js-ros`). Shown by CSS only under html.no-gl; paths are built after mount. */
export function Poster() {
  const [paths, setPaths] = useState<string[]>([]);
  useEffect(() => setPaths([hypo(100, 36, 52, 292, 4200), hypo(105, 42, 40, 200, 2000)]), []);
  const op = [0.5, 0.35];
  return (
    <svg className="poster js-ros" viewBox="-300 -300 600 600" aria-hidden="true">
      {paths.map((d, i) => <path key={i} d={d} stroke="url(#silver)" strokeOpacity={op[i]} strokeWidth=".8" />)}
    </svg>
  );
}
