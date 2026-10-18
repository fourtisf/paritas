"use client";
/** Connect, Settings and the transaction-flow pieces (prototype connectModal, settingsModal, runFlow, successHTML). */
import { useState, type ReactNode } from "react";
import { useConnect, type Connector } from "wagmi";
import { SESSION_COPY, CHAINS, type SessionName } from "@paritas/shared";
import { CHAIN_ID } from "@/lib/wagmi";
import { clamp, fmtPct, short } from "@/lib/format";
import { Icon } from "./Icon";
import { Modal, ModalHead, useUI } from "./ui";
import { CAN_SIMULATE, DEFAULTS, useSettings, type Settings } from "./settings";
import { Burst } from "./three";
import { WALLETS, walletLogo } from "@/lib/wallets";
import { useSession } from "@/hooks/useSession";

export const CHAIN_NAME = CHAINS[CHAIN_ID].name;

/** A row's logo tile: the wallet's own EIP-6963 icon or our copy from public/wallets/; the generic wallet glyph otherwise. */
function WalletLogo({ src }: { src?: string }) {
  return <span className="wallet-i logo">{src ? <img src={src} alt="" width={24} height={24} /> : <Icon n="wallet" />}</span>;
}

export function ConnectModal() {
  const { connectors, connectAsync } = useConnect();
  const ui = useUI();
  const [busy, setBusy] = useState<string | null>(null);
  // EIP-6963: every installed extension announces itself (id = its rdns, with name and icon).
  const detected = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const legacy = connectors.find((c) => c.id === "injected");
  const wc = connectors.find((c) => c.id === "walletConnect");
  const cb = connectors.find((c) => c.id === "coinbaseWalletSDK");
  const mock = connectors.find((c) => c.id === "mock");
  const hasEthereum = typeof window !== "undefined" && "ethereum" in window;
  const more = WALLETS.filter((w) => !detected.some((c) => c.id === w.rdns || c.name === w.name));

  const go = async (c: Connector, key: string) => {
    setBusy(key);
    try {
      const r = await connectAsync({ connector: c });
      ui.closeModal();
      ui.toast("Wallet connected", `${short(r.accounts[0])} on ${CHAIN_NAME}`);
    } catch (e) {
      setBusy(null);
      const msg = e instanceof Error ? e.message : "";
      ui.toast(/not found|provider/i.test(msg) ? "No browser wallet found" : "Wallet not connected", /rejected/i.test(msg) ? "You cancelled in your wallet." : "Install a wallet extension or pick another option.", "info");
    }
  };
  const row = (key: string, name: string, sub: string, logo: ReactNode, onClick: () => void) => (
    <button key={key} className="wallet" onClick={onClick} disabled={!!busy}>
      {busy === key ? <span className="spin" /> : logo}
      <span className="wallet-t">
        <span className="wallet-n">{busy === key ? "Connecting…" : name}</span>
        <span className="wallet-s">{sub}</span>
      </span>
      <Icon n="chev" className="chev" />
    </button>
  );

  return (
    <Modal label="Connect a wallet">
      <ModalHead title="Connect a wallet" />
      <div className="modal-b">
        <p className="t2" style={{ margin: "0 0 14px", fontSize: 13.5 }}>
          Paritas never holds your assets. Swaps settle from your wallet to your wallet.
        </p>
        {mock && <div className="wallets">{row(mock.uid, "Local test wallet", "Anvil account #1 with test balances", <WalletLogo />, () => go(mock, mock.uid))}</div>}
        {(detected.length > 0 || (legacy && hasEthereum)) && (
          <>
            <div className="wallet-h">Detected in your browser</div>
            <div className="wallets">
              {detected.map((c) => row(c.uid, c.name, "Installed", <WalletLogo src={c.icon} />, () => go(c, c.uid)))}
              {!detected.length && legacy && hasEthereum && row(legacy.uid, "Browser wallet", "Installed", <WalletLogo />, () => go(legacy, legacy.uid))}
            </div>
          </>
        )}
        <div className="wallet-h">{detected.length ? "More wallets" : "Popular wallets"}</div>
        <div className="wallets wallets-2">
          {more.map((w) => {
            const logo = <WalletLogo src={walletLogo(w.id)} />;
            if (w.id === "coinbase" && cb) return row(w.id, w.name, "App or extension", logo, () => go(cb, w.id));
            if (wc) return row(w.id, w.name, "Scan with the app", logo, () => go(wc, w.id));
            return (
              <a key={w.id} className="wallet" href={w.url} target="_blank" rel="noopener noreferrer" aria-label={`Get ${w.name}`}>
                {logo}
                <span className="wallet-t">
                  <span className="wallet-n">{w.name}</span>
                  <span className="wallet-s">Get the app</span>
                </span>
                <Icon n="ext" className="chev ext" />
              </a>
            );
          })}
        </div>
        {wc && <div className="wallets" style={{ marginTop: 8 }}>{row(wc.uid, "WalletConnect", "Any other mobile wallet", <WalletLogo src={walletLogo("walletconnect")} />, () => go(wc, wc.uid))}</div>}
        <div className="note note-lav">
          <span>
            <Icon n="info" />
          </span>
          <span>
            {CHAIN_ID === 31337
              ? "Local chain: the test wallet sends real transactions to your anvil node. No wallet app is needed."
              : "Stock tokens are not offered to US persons. Your wallet must be verified before it can trade or provide liquidity."}
          </span>
        </div>
      </div>
    </Modal>
  );
}

function Seg<T extends string | number>({ value, options, onPick }: { value: T; options: [T, string][]; onPick(v: T): void }) {
  return (
    <div className="seg">
      {options.map(([k, l]) => (
        <button key={String(k)} aria-pressed={value === k} onClick={() => onPick(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange(v: boolean): void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" />
      <span className="sr">Toggle</span>
    </label>
  );
}

const PREF_LABEL: Record<Settings["pref"], string> = { best: "Best of all three", nomaker: "Exclude market makers", vault: "Paritas vault only" };

export function SettingsModal() {
  const { s, set } = useSettings();
  const ui = useUI();
  const live = useSession("live");
  return (
    <Modal label="Settings" wide>
      <ModalHead title="Settings" />
      <div className="modal-b">
        <div className="set-sec">
          <h3>Trading</h3>
          <div className="set-row">
            <div>
              <b>Slippage tolerance</b>
              <span className="s">The swap reverts if the price moves more than this</span>
            </div>
            <Seg value={s.slip} options={[10, 30, 50, 100].map((v) => [v, fmtPct(v)] as [number, string])} onPick={(v) => set({ slip: v })} />
          </div>
          <div className="set-row">
            <div>
              <b>Transaction deadline</b>
              <span className="s">Minutes before an unsent swap expires</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input className="input" type="number" min={1} max={120} defaultValue={s.deadline} style={{ width: 84 }} onChange={(e) => set({ deadline: clamp(+e.target.value || 20, 1, 120) })} />
              <span className="t2">min</span>
            </div>
          </div>
          <div className="set-row">
            <div>
              <b>Routing</b>
              <span className="s">Which venues the router may use</span>
            </div>
            <select
              className="sel"
              value={s.pref}
              onChange={(e) => {
                const v = e.target.value as Settings["pref"];
                set({ pref: v });
                ui.toast("Routing updated", PREF_LABEL[v]);
              }}
            >
              {(Object.keys(PREF_LABEL) as Settings["pref"][]).map((k) => (
                <option key={k} value={k}>
                  {PREF_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="set-sec">
          <h3>Display</h3>
          <div className="set-row">
            <div>
              <b>Time zone</b>
              <span className="s">Used in tables, charts and receipts</span>
            </div>
            <Seg value={s.tz} options={[["local", "Local"], ["utc", "UTC"], ["ny", "New York"]]} onPick={(v) => set({ tz: v })} />
          </div>
          <div className="set-row">
            <div>
              <b>Show costs as</b>
              <span className="s">Percent or basis points</span>
            </div>
            <Seg value={s.unit} options={[["pct", "Percent"], ["bps", "Basis points"]]} onPick={(v) => set({ unit: v })} />
          </div>
        </div>
        <div className="set-sec">
          <h3>Notifications</h3>
          <div className="set-row">
            <div>
              <b>Fill confirmations</b>
              <span className="s">When your swap settles</span>
            </div>
            <Switch on={s.notif.fills} onChange={(v) => set({ notif: { ...s.notif, fills: v } })} />
          </div>
          <div className="set-row">
            <div>
              <b>Session changes</b>
              <span className="s">When the market opens, closes or vaults pause</span>
            </div>
            <Switch on={s.notif.session} onChange={(v) => set({ notif: { ...s.notif, session: v } })} />
          </div>
        </div>
        {CAN_SIMULATE && (
          <div className="set-sec">
            <h3>Testing</h3>
            <div className="set-row">
              <div>
                <b>Simulate a session</b>
                <span className="s">See how the session dial and notes change across market hours. Quotes always use the chain&apos;s session.</span>
              </div>
              <select
                className="sel"
                value={s.sim}
                onChange={(e) => {
                  const v = e.target.value as Settings["sim"];
                  set({ sim: v });
                  ui.toast(v === "live" ? "Using the live session" : "Simulating " + SESSION_COPY[v as SessionName].label.toLowerCase(), "The session dial and notes now follow it.", "clock");
                }}
              >
                <option value="live">Live ({live.copy.label})</option>
                {(Object.keys(SESSION_COPY) as SessionName[]).map((k) => (
                  <option key={k} value={k}>
                    {SESSION_COPY[k].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="set-row">
              <div>
                <b>Reset settings</b>
                <span className="s">Restore slippage, deadline, routing and display</span>
              </div>
              <button
                className="btn btn-line btn-sm"
                onClick={() => {
                  set(DEFAULTS);
                  ui.closeModal();
                  ui.toast("Settings reset");
                }}
              >
                Reset
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export interface Step {
  label: string;
  detail: string;
  state: "todo" | "active" | "done" | "error";
}

/** The numbered step list of a running transaction (prototype runFlow). */
export function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li key={i} data-s={s.state === "todo" ? "wait" : s.state}>
          <span className="step-i">
            {s.state === "done" ? <Icon n="check" /> : s.state === "active" ? <span className="spin" /> : s.state === "error" ? <Icon n="x" /> : <span style={{ fontSize: 12, fontWeight: 650 }}>{i + 1}</span>}
          </span>
          <span>
            {s.label}
            <br />
            <span className="muted" style={{ fontSize: 12 }}>
              {s.detail}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Success({ title, body, extra, coin }: { title: string; body: ReactNode; extra?: ReactNode; coin?: string }) {
  return (
    <div className="success">
      {coin ? (
        <Burst sym={coin} />
      ) : (
        <div className="success-i">
          <Icon n="check" />
        </div>
      )}
      <div style={{ fontStretch: "125%", fontWeight: 700, fontSize: 21 }}>{title}</div>
      <p className="t2" style={{ margin: "8px 0 16px" }}>
        {body}
      </p>
      {extra ?? (
        <button className="btn btn-holo btn-block" data-close>
          Done
        </button>
      )}
    </div>
  );
}

/** Error state at the end of a failed flow, in plain words from packages/shared/src/errors.ts. */
export function FlowError({ message }: { message: string }) {
  return (
    <>
      <div className="note note-warn">
        <span>
          <Icon n="info" />
        </span>
        <span>{message}</span>
      </div>
      <button className="btn btn-line btn-block" data-close style={{ marginTop: 16 }}>
        Close
      </button>
    </>
  );
}
