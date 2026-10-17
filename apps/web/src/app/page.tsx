import { LandingCanvas } from "@/components/three/LandingCanvas";

/**
 * PORT ME: prototypes/paritas-landing.html is the spec. Convert its <body> sections to JSX 1:1
 * (#quote, #router, #receipt, #hours, #app-preview, #vaults, #safety, #faq, #launch), keep every id,
 * class and data-pose attribute, move its <style> into styles/landing.css, and its inline (non-module)
 * script into small client components. Screenshots: docs/screenshots/landing-*.png
 */
export default function Landing() {
  return (
    <main>
      <LandingCanvas />
      <section data-pose="hero" style={{ position: "relative", zIndex: 1, minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <h1 style={{ fontStretch: "125%", fontSize: "clamp(40px,7vw,88px)", letterSpacing: "-.03em", margin: 0 }}>The best price on every stock token.</h1>
      </section>
    </main>
  );
}
