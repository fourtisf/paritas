"use client";
/**
 * React wrappers for the platform 3D (three/p3d.js, verbatim from the prototype): the spinning coin in the trade
 * header, the Markets coin carousel and the success burst. Without WebGL nothing mounts and the static tokens stay
 * visible; reduced motion is handled inside p3d.js.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
import { Tok } from "./Tok";

type Handle = { dispose(): void };
type P3D = {
  spinCoin(el: HTMLElement, label: string, o?: { celebrate?: boolean }): Handle;
  carousel(el: HTMLElement, labels: string[], o: { start?: number; onFocus?: (i: number) => void; onPick?: (i: number) => void }): Handle;
};

let p3d: Promise<P3D | null> | null = null;
const loadP3D = () => (p3d ??= import("@/three/p3d").then((m) => m.installP3D() as Promise<P3D | null>));

function use3D(ref: React.RefObject<HTMLElement>, mount: (P: P3D, el: HTMLElement) => Handle, deps: unknown[]) {
  useEffect(() => {
    let h: Handle | null = null;
    let live = true;
    loadP3D().then((P) => {
      if (live && P && ref.current) h = mount(P, ref.current);
    });
    return () => {
      live = false;
      try {
        h?.dispose();
      } catch {
        /* already gone */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const label = (sym: string) => sym.replace(/x$/, "");

export function SpinCoin({ sym }: { sym: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  use3D(ref, (P, el) => P.spinCoin(el, label(sym)), [sym]);
  return (
    <span className="coin3d" ref={ref} data-sym={sym}>
      <Tok sym={sym} size="lg" />
    </span>
  );
}

export function Burst({ sym }: { sym: string }) {
  const ref = useRef<HTMLDivElement>(null);
  use3D(ref, (P, el) => P.spinCoin(el, label(sym), { celebrate: true }), [sym]);
  return (
    <div className="burst" ref={ref} data-sym={sym}>
      <div className="success-i">
        <Icon n="check" />
      </div>
    </div>
  );
}

export function CoinCarousel({ syms, start, onFocus, onPick, children }: { syms: string[]; start: number; onFocus(i: number): void; onPick(i: number): void; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef({ onFocus, onPick });
  cb.current = { onFocus, onPick };
  use3D(ref, (P, el) => P.carousel(el, syms.map(label), { start, onFocus: (i) => cb.current.onFocus(i), onPick: (i) => cb.current.onPick(i) }), [syms.join()]);
  return (
    <div className="coin-stage" ref={ref} aria-label="3D market carousel. Drag to spin, click a coin to trade it.">
      <div className="fallback">
        {syms.map((s) => (
          <Tok key={s} sym={s} size="lg" />
        ))}
      </div>
      {children}
    </div>
  );
}

/** Tilt and glare on [data-tilt] tiles (hover devices, no reduced motion), as in the prototype. */
export function useTilt() {
  useEffect(() => {
    if (!matchMedia("(hover: hover)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const move = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.("[data-tilt]") as HTMLElement | null;
      document.querySelectorAll<HTMLElement>("[data-tilt].tilting").forEach((x) => {
        if (x !== el) {
          x.classList.remove("tilting");
          x.style.transform = "";
        }
      });
      if (!el) return;
      const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      el.classList.add("tilting");
      el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * 6}deg) rotateY(${(x - 0.5) * 8}deg) translateY(-2px)`;
      el.style.setProperty("--gx", x * 100 + "%");
      el.style.setProperty("--gy", y * 100 + "%");
    };
    document.addEventListener("mousemove", move, { passive: true });
    return () => document.removeEventListener("mousemove", move);
  }, []);
}
