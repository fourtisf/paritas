"use client";
import { useEffect, useState, type ReactNode } from "react";
import { X_URL } from "@/lib/links";

const LINKS = [
  ["#quote", "Quote"],
  ["#router", "Router"],
  ["#receipt", "Receipt"],
  ["#hours", "Hours"],
  ["#app-preview", "App"],
  ["#vaults", "Vaults"],
] as const;

/** The X logo (Simple Icons, CC0). */
const XMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" /></svg>
);

/** Floating nav: highlights the section in view and opens the mobile menu. */
export function Nav({ logo }: { logo: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState<string | null>(null);
  useEffect(() => {
    const navOn = () => {
      const y = innerHeight * 0.4;
      let cur: string | null = null;
      for (const [href] of LINKS) {
        const s = document.querySelector(href);
        if (s && s.getBoundingClientRect().top < y) cur = href;
      }
      setOn(cur);
    };
    navOn();
    window.addEventListener("scroll", navOn, { passive: true });
    return () => window.removeEventListener("scroll", navOn);
  }, []);
  return (
    <header className="nav" id="nav">
      <div className="wrap">
        <div className="nav-in">
          <a className="logo" href="#top" aria-label="Paritas home">{logo}<b>Paritas</b></a>
          <ul className="nav-links" id="navLinks">
            {LINKS.map(([href, label]) => (
              <li key={href}><a href={href} className={on === href ? "on" : undefined}>{label}</a></li>
            ))}
          </ul>
          <div className="nav-cta">
            <a className="btn btn-g btn-sm nav-x" href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="Paritas on X"><XMark /></a>
            <span className="nav-ca"><span>CA</span>Coming soon</span>
            <a className="btn btn-g btn-sm" href="#faq">FAQ</a>
            <a className="btn btn-w btn-sm" href="/app/trade">Launch app</a>
            <button className="menu-btn" id="menuBtn" aria-expanded={open} aria-controls="mobileMenu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}><span></span></button>
          </div>
        </div>
      </div>
      <nav className={"mobile-menu" + (open ? " open" : "")} id="mobileMenu" aria-label="Mobile" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}>
        {LINKS.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
        <a href="#faq">FAQ</a>
        <a href={X_URL} target="_blank" rel="noopener noreferrer">X · @useparitas</a>
        <span className="mm-ca">CA: Coming soon</span>
        <a className="btn btn-w" href="/app/trade">Launch app</a>
      </nav>
    </header>
  );
}
