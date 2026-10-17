"use client";
import { useEffect } from "react";

/** Mounts the prototype's landing scene. The page must render the prototype's landing DOM (ids and data-pose). */
export function LandingCanvas() {
  useEffect(() => {
    let cancelled = false;
    import("@/three/landing-scene").then((m) => {
      if (!cancelled) m.mountLandingScene();
    });
    return () => {
      cancelled = true; // TODO: call the dispose() you add to mountLandingScene
    };
  }, []);
  return <canvas id="gl" aria-hidden="true" style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 0 }} />;
}
