"use client";
import { useEffect, useState, type ReactNode } from "react";
import { TELEGRAM_URL, TOKEN_CA, X_URL } from "@/lib/links";

const LINKS = [
  ["#quote", "Quote"],
  ["#router", "Router"],
  ["#receipt", "Receipt"],
  ["#hours", "Hours"],
  ["#app-preview", "App"],
  ["#vaults", "Vaults"],
] as const;

/** The X and Telegram logos (Simple Icons, CC0). */
const XMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" /></svg>
);
const TelegramMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>
);

/** The token's contract address: short in the nav, the whole address on the clipboard. */
function CaCopy({ menu = false }: { menu?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(TOKEN_CA).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const short = `${TOKEN_CA.slice(0, 6)}…${TOKEN_CA.slice(-4)}`;
  if (menu) return <button type="button" className="mm-ca" onClick={copy}>CA: {copied ? "Copied" : `${short} · tap to copy`}</button>;
  return (
    <button type="button" className="nav-ca" onClick={copy} title={TOKEN_CA} aria-label={`Copy the Paritas token contract address ${TOKEN_CA}`}>
      <span>CA</span>
      {copied ? "Copied" : short}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></svg>
    </button>
  );
}

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
            <a className="btn btn-g btn-sm nav-x" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label="Paritas channel on Telegram"><TelegramMark /></a>
            <CaCopy />
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
        <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">Telegram · Paritas channel</a>
        <CaCopy menu />
        <a className="btn btn-w" href="/app/trade">Launch app</a>
      </nav>
    </header>
  );
}
