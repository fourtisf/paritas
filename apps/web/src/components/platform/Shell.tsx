"use client";
/**
 * The platform frame (prototype <header class="bar">, #mnav, #toasts, #layer): logo, network pill, nav, session dial,
 * settings and the account button. Also owns the live stream (WS /stream) and the session-change toast.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useDisconnect } from "wagmi";
import { SESSION_COPY } from "@paritas/shared";
import { CHAIN_ID } from "@/lib/wagmi";
import { apiWsUrl } from "@/lib/env";
import { short } from "@/lib/format";
import { useSession } from "@/hooks/useSession";
import { useClockSeeded } from "@/hooks/useChainNow";
import { useWallet } from "@/hooks/useWallet";
import { Icon, type IconName } from "./Icon";
import { SvgDefs } from "./Guilloche";
import { SealMark } from "@/components/brand/Seal";
import { UIProvider, useUI } from "./ui";
import { SettingsProvider, useSettings } from "./settings";
import { DialFace, DialPop } from "./session";
import { CHAIN_NAME, ConnectModal, SettingsModal } from "./modals";
import { useTilt } from "./three";
import { useTestFaucet } from "./faucet";

export const NAV: [string, string][] = [
  ["trade", "Trade"],
  ["markets", "Markets"],
  ["pool", "Pool"],
  ["portfolio", "Portfolio"],
  ["activity", "Activity"],
  ["governance", "Governance"],
];

const NETWORK_PILL: Record<number, [string, string] | undefined> = {
  31337: ["Local chain", "Local anvil chain with test tokens. Transactions are real on your node only."],
  46630: ["Testnet", "Robinhood Chain testnet. Test tokens only."],
};

/** Route ids that just arrived on the live stream, so tables can flash them. */
const LiveCtx = createContext<Set<string>>(new Set());
export const useLiveIds = () => useContext(LiveCtx);

function LiveStream({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ids, setIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let ws: WebSocket | null = null;
    let stop = false;
    let retry: ReturnType<typeof setTimeout>;
    const open = () => {
      ws = new WebSocket(apiWsUrl("/stream"));
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.channel !== "paritas:fills") return;
        setIds((s) => new Set(s).add(msg.data.id));
        qc.invalidateQueries({ queryKey: ["fills"] });
        qc.invalidateQueries({ queryKey: ["stats"] });
        qc.invalidateQueries({ queryKey: ["portfolio"] });
      };
      ws.onclose = () => {
        if (!stop) retry = setTimeout(open, 3000);
      };
    };
    retry = setTimeout(open, 0); // not synchronously: React dev mode mounts effects twice
    return () => {
      stop = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [qc]);
  return <LiveCtx.Provider value={ids}>{children}</LiveCtx.Provider>;
}

function SessionToasts() {
  const { s } = useSettings();
  const ui = useUI();
  const { session } = useSession(s.sim);
  const seeded = useClockSeeded();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!seeded) return;
    if (last.current === null || session === last.current) {
      last.current = session;
      return;
    }
    last.current = session;
    if (s.notif.session) ui.toast("Session changed", SESSION_COPY[session].label + ". " + SESSION_COPY[session].desc, "clock");
  }, [session, s.notif.session, ui]);
  return null;
}

function Account() {
  const ui = useUI();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const w = useWallet();
  const faucet = useTestFaucet(() => w.refetch());
  if (!isConnected || !address) {
    return (
      <button className="btn btn-holo" onClick={() => ui.openModal(<ConnectModal />)}>
        <Icon n="wallet" />
        Connect
      </button>
    );
  }
  const menu = (
    <div
      onClick={(ev) => {
        const k = (ev.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a;
        if (k === "copy") {
          navigator.clipboard?.writeText(address).catch(() => {});
          ui.toast("Address copied");
        }
        if (k === "set") ui.openModal(<SettingsModal />);
        if (k === "faucet") void faucet.mint();
        if (k === "out") {
          disconnect();
          ui.toast("Wallet disconnected", "", "out");
        }
        if (k) ui.closePop();
      }}
    >
      <div className="pop-sec">
        {short(address)} · {CHAIN_NAME}
      </div>
      <div className="pop-sec" style={{ paddingTop: 0 }}>
        {w.eligible === false ? (
          <span className="chip" style={{ "--c": "var(--warn)" } as CSSProperties}>
            <Icon n="lock" />
            Not verified for stock tokens
          </span>
        ) : (
          <span className="chip" style={{ "--c": "var(--up)" } as CSSProperties}>
            <Icon n="shield" />
            Eligible trader and LP
          </span>
        )}
      </div>
      {faucet.available && (
        <button className="pop-item" data-a="faucet">
          <Icon n="plus" />
          Get 10,000 test USDG
        </button>
      )}
      <button className="pop-item" data-a="copy">
        <Icon n="copy" />
        Copy address
      </button>
      <Link className="pop-item" href="/app/portfolio" data-a="pf">
        <Icon n="portfolio" />
        Portfolio
      </Link>
      <button className="pop-item" data-a="set">
        <Icon n="gear" />
        Settings
      </button>
      <button className="pop-item" data-a="out">
        <Icon n="out" />
        Disconnect
      </button>
    </div>
  );
  return (
    <button className="dial" style={{ padding: "0 12px 0 5px" }} aria-haspopup="menu" onClick={(e) => ui.openPop(e.currentTarget, menu)}>
      <span style={{ width: 30, height: 30, borderRadius: "50%", background: "conic-gradient(from 120deg,#F5F5F7,#55555E,#C9C9D0,#2A2A30,#F5F5F7)" }} />
      <span className="acct-addr dial-t">{short(address)}</span>
      <Icon n="chev" />
    </button>
  );
}

function Bar() {
  const ui = useUI();
  const path = usePathname();
  const cur = path.split("/")[2] ?? "trade";
  const pill = NETWORK_PILL[CHAIN_ID];
  return (
    <>
      <header className="bar">
        {/* plain <a>: the landing page has its own stylesheet, so leave the app with a full page load */}
        <a className="logo" href="/" aria-label="Paritas website">
          <SealMark />
          <b>Paritas</b>
        </a>
        {pill && (
          <span className="demo" title={pill[1]}>
            <span className="dot" style={{ "--c": "var(--warn)" } as CSSProperties} />
            <span>{pill[0]}</span>
          </span>
        )}
        <nav className="tabs" aria-label="Main">
          {NAV.map(([k, l]) => (
            <Link key={k} href={`/app/${k}`} aria-current={cur === k ? "page" : undefined}>
              <Icon n={k as IconName} />
              {l}
            </Link>
          ))}
        </nav>
        <div className="bar-r">
          <button className="dial" aria-haspopup="dialog" onClick={(e) => ui.openPop(e.currentTarget, <DialPop />)}>
            <DialFace />
          </button>
          <button className="icon-btn" aria-label="Settings" onClick={() => ui.openModal(<SettingsModal />)}>
            <Icon n="gear" />
          </button>
          <div>
            <Account />
          </div>
        </div>
      </header>
      <nav className="mnav" aria-label="Quick navigation">
        {NAV.map(([k, l]) => (
          <Link key={k} href={`/app/${k}`} aria-current={cur === k ? "page" : undefined}>
            <Icon n={k as IconName} />
            {l === "Governance" ? "Gov" : l}
          </Link>
        ))}
      </nav>
    </>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  useTilt();
  return (
    <SettingsProvider>
      <UIProvider>
        <LiveStream>
          <SvgDefs />
          <Bar />
          <SessionToasts />
          <main id="view" tabIndex={-1}>
            {children}
          </main>
        </LiveStream>
      </UIProvider>
    </SettingsProvider>
  );
}
