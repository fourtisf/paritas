"use client";
import { useEffect, useRef } from "react";

/**
 * Mounts the prototype's landing scene (three/landing-scene.js) on a fresh <canvas id="gl"> per mount: dispose()
 * releases the WebGL context, so a canvas is never reused (React strict mode mounts twice in dev).
 * The page must render the prototype's landing DOM (section ids, data-pose, the .poster fallback).
 */
export function LandingCanvas() {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // No WebGL: show the .no-gl poster without asking three.js to fail (it logs errors when it does).
    const probe = document.createElement("canvas");
    if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) {
      document.documentElement.classList.add("no-gl");
      return () => document.documentElement.classList.remove("no-gl");
    }
    const canvas = document.createElement("canvas");
    canvas.id = "gl";
    canvas.setAttribute("aria-hidden", "true");
    el.appendChild(canvas);
    // next/font serves Archivo under a generated family name; the coin labels must use the same face.
    const fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--font-archivo").trim() || '"Archivo"';
    let dispose: (() => void) | null = null;
    let cancelled = false;
    import("@/three/landing-scene").then((m) => {
      if (!cancelled) dispose = m.mountLandingScene({ fontFamily });
    });
    return () => {
      cancelled = true;
      dispose?.();
      canvas.remove();
    };
  }, []);
  return <span ref={host} style={{ display: "contents" }} />;
}
