"use client";
import { useEffect } from "react";
import { clamp } from "./format";

/** Tilt and glare on vault and promise cards, and the app preview frame flattening as it scrolls in. */
export function Effects() {
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const offs: Array<() => void> = [];
    if (matchMedia("(hover: hover)").matches) {
      let cur: HTMLElement | null = null;
      const move = (e: MouseEvent) => {
        const el = (e.target as HTMLElement).closest?.<HTMLElement>(".vc,.pr") ?? null;
        if (cur && cur !== el) cur.style.transform = "";
        cur = el;
        if (!el) return;
        const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 7}deg) rotateY(${(x - 0.5) * 9}deg) translateZ(0)`;
        el.style.setProperty("--gx", x * 100 + "%");
        el.style.setProperty("--gy", y * 100 + "%");
      };
      document.addEventListener("mousemove", move, { passive: true });
      offs.push(() => document.removeEventListener("mousemove", move));
    }
    const frame = document.getElementById("frame");
    if (frame) {
      const tilt = () => {
        const r = frame.getBoundingClientRect(), vh = innerHeight, p = clamp((vh - r.top) / (vh * 0.9), 0, 1);
        frame.style.setProperty("--tilt", (22 * (1 - p)).toFixed(2) + "deg");
        frame.style.setProperty("--sc", (0.92 + 0.08 * p).toFixed(3));
      };
      tilt();
      window.addEventListener("scroll", tilt, { passive: true });
      offs.push(() => window.removeEventListener("scroll", tilt));
    }
    return () => offs.forEach((f) => f());
  }, []);
  return null;
}
