"use client";
/**
 * /app/pool (prototype pagePool, vrow, vaultDetail, vdForm).
 * Vault TVL, inventory and open state: GET /markets. Caps and spreads: config tiers. Positions: wagmi (vault shares x
 * previewWithdraw) and GET /portfolio flows for fees. Deposit / withdraw: AnchorVault via useVaultTx.
 */
import { useEffect, useRef, useState } from "react";
import { parseUnits } from "viem";
import { useReadContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { anchorVaultAbi, TIERS } from "@paritas/shared";
import { clamp, compact, nf, sum, units } from "@/lib/format";
import { useMarketMap, type MarketRow } from "@/hooks/data";
import { useWallet } from "@/hooks/useWallet";
import { useVaultTx } from "@/hooks/useVault";
import { useVaultPositions, type VaultPosition } from "@/hooks/usePortfolioHistory";
import { useDeployment, type Market } from "../deployment";
import { useSettings } from "../settings";
import { Modal, ModalHead, useUI } from "../ui";
import { Icon } from "../Icon";
import { Tok, TokBtn } from "../Tok";
import { Donut } from "../charts";
import { useSess } from "../session";
import { ConnectModal, FlowError, Steps, Success } from "../modals";
import { cssVar, Ln } from "../bits";

const HUE = "#E6E6EA";

function StatusChip({ m, row, quoting, live = false }: { m: Market; row?: MarketRow; quoting: boolean; live?: boolean }) {
  if (!m.vault) return <span className="chip">Second wave</span>;
  if (row?.vault?.open && quoting)
    return (
      <span className="chip" style={cssVar("--c", "var(--up)")}>
        {live && <span className="dot live" style={cssVar("--c", "var(--up)")} />}
        Quoting
      </span>
    );
  return (
    <span className="chip" style={cssVar("--c", "var(--warn)")}>
      Paused
    </span>
  );
}

export function PoolPage() {
  const { markets, bySymbol } = useDeployment();
  const { map } = useMarketMap();
  const w = useWallet();
  const ui = useUI();
  const sess = useSess();
  const { positions } = useVaultPositions();
  const [sel, setSel] = useState("NVDAx");
  const [tab, setTab] = useState<"dep" | "wd">("dep");
  const detail = useRef<HTMLElement>(null);
  const m = bySymbol(sel) ?? markets[0];
  const vaultOpenNow = !!sess.m; // the session lets vaults quote
  const tvl = sum(markets, (x) => map?.get(x.symbol)?.vault?.tvlUsd ?? 0);
  const mine = sum(Object.values(positions), (p) => p.value);
  const fees = sum(Object.values(positions), (p) => p.fees);
  const quoting = markets.filter((x) => map?.get(x.symbol)?.vault?.open).length;
  const paused = sess.session === "closed";
  const pausedFor = sess.holiday ? "for the market holiday" : "for the weekend";

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Pool</h1>
          <p>Vault returns come from the spread traders pay. No emissions, no points. Withdrawals work in every state, including halts and weekends.</p>
        </div>
        {!w.isConnected && (
          <div className="ph-a">
            <button className="btn btn-holo" onClick={() => ui.openModal(<ConnectModal />)}>
              <Icon n="wallet" />
              Connect wallet
            </button>
          </div>
        )}
      </div>
      <div className="strip">
        <div className="st">
          <b>
            {map ? compact(tvl) : "–"}
            <small>USDG</small>
          </b>
          <span>Total in vaults</span>
        </div>
        <div className="st">
          <b>
            {w.isConnected ? compact(mine) : "–"}
            <small>{w.isConnected ? "USDG" : ""}</small>
          </b>
          <span>Your liquidity</span>
        </div>
        <div className="st">
          <b>
            {w.isConnected ? nf(fees, 2) : "–"}
            <small>{w.isConnected ? "USDG" : ""}</small>
          </b>
          <span>Your fees, 30 days</span>
        </div>
        <div className="st">
          <b>
            {map ? quoting : "–"}
            <small>of {markets.length}</small>
          </b>
          <span>Vaults quoting now</span>
        </div>
      </div>
      {paused && (
        <div className="note note-warn" style={{ margin: "0 0 16px" }}>
          <span>
            <Icon n="pause" />
          </span>
          <span>
            <b>Vaults are paused {pausedFor}.</b> Deposits reopen when US markets do. Withdrawals keep working.
          </span>
        </div>
      )}
      <div className="pool">
        <div>
          {markets.map((x) => {
            const r = map?.get(x.symbol);
            const t = TIERS[x.tier];
            const p = positions[x.symbol];
            const inv = (r?.vault?.tokenShareBps ?? 5000) / 100;
            return (
              <button
                key={x.symbol}
                className="vrow"
                aria-current={sel === x.symbol}
                onClick={() => {
                  setSel(x.symbol);
                  if (window.innerWidth < 1100) setTimeout(() => detail.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
                }}
              >
                <span className="mk">
                  <Tok sym={x.symbol} />
                  <span>
                    <span className="mk-sym" style={{ display: "block" }}>
                      {x.symbol}
                    </span>
                    <span style={{ display: "block", marginTop: 3 }}>
                      <StatusChip m={x} row={r} quoting={vaultOpenNow} />
                    </span>
                  </span>
                </span>
                <span className="hide-m">
                  <span className="k">TVL / cap</span>
                  <span className="v" style={{ display: "block" }}>
                    {x.vault && r?.vault ? compact(r.vault.tvlUsd) + " / " + compact(t.capUsd) : x.vault ? "–" : "Not open"}
                  </span>
                  <span className="capbar" style={{ display: "block" }}>
                    <i style={{ width: `${clamp(((r?.vault?.tvlUsd ?? 0) / t.capUsd) * 100, 0, 100)}%` }} />
                  </span>
                </span>
                <span className="hide-m">
                  <span className="k">Inventory</span>
                  <span className="invbar" style={{ display: "flex", width: "100%", marginTop: 7 }}>
                    <i style={{ width: `${inv}%`, background: HUE }} />
                    <i style={{ flex: 1, background: "#3A3A42" }} />
                  </span>
                </span>
                <span className="hide-m">
                  <span className="k">Spread APR</span>
                  <span className="v" style={{ display: "block" }}>
                    –
                  </span>
                </span>
                <span style={{ textAlign: "right" }}>
                  <span className="k">Your position</span>
                  <span className="v num" style={{ display: "block" }}>
                    {p ? compact(p.value) : "–"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <aside className="panel vd" ref={detail}>
          <VaultDetail m={m} row={map?.get(m.symbol)} pos={positions[m.symbol]} quoting={vaultOpenNow} tab={tab} setTab={setTab} />
        </aside>
      </div>
    </div>
  );
}

function VaultDetail({ m, row, pos, quoting, tab, setTab }: { m: Market; row?: MarketRow; pos?: VaultPosition; quoting: boolean; tab: "dep" | "wd"; setTab(t: "dep" | "wd"): void }) {
  const { fmt } = useSettings();
  const t = TIERS[m.tier];
  const tokPct = (row?.vault?.tokenShareBps ?? 5000) / 100;
  return (
    <>
      <div className="foil" style={{ borderRadius: "20px 20px 0 0" }} />
      <div className="vd-h">
        <div className="mk">
          <Tok sym={m.symbol} size="lg" />
          <div>
            <div className="mh-sym" style={{ fontSize: 19 }}>
              {m.symbol} vault
            </div>
            <div className="mk-name">
              {m.name} · Tier {m.tier}
            </div>
          </div>
        </div>
        <StatusChip m={m} row={row} quoting={quoting} live />
      </div>
      <div className="vd-viz">
        <Donut
          parts={[
            { f: tokPct / 100, c: HUE },
            { f: 1 - tokPct / 100, c: "#3A3A42" },
          ]}
          size={122}
          stroke={12}
          center={
            <div>
              <b>
                {nf(tokPct, 0)} / {nf(100 - tokPct, 0)}
              </b>
              <span>{m.symbol.replace("x", "")} / USDG</span>
            </div>
          }
        />
        <dl className="kv" style={{ margin: 0 }}>
          <div>
            <dt>TVL</dt>
            <dd className="num">{m.vault && row?.vault ? compact(row.vault.tvlUsd) : "–"}</dd>
          </div>
          <div>
            <dt>Cap</dt>
            <dd>{compact(t.capUsd)}</dd>
          </div>
          <div>
            <dt>Spread APR, 30d</dt>
            <dd>–</dd>
          </div>
          <div>
            <dt>Base spread</dt>
            <dd>{fmt.cost(t.halfSpreadBps)}</dd>
          </div>
          <div>
            <dt>Your position</dt>
            <dd className="num">{pos ? nf(pos.value, 2) : "–"}</dd>
          </div>
        </dl>
      </div>
      <div className="vd-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "dep"} onClick={() => setTab("dep")}>
          Deposit
        </button>
        <button role="tab" aria-selected={tab === "wd"} onClick={() => setTab("wd")}>
          Withdraw
        </button>
      </div>
      <div className="vd-b">{tab === "dep" ? <DepositForm key={m.symbol} m={m} row={row} quoting={quoting} /> : <WithdrawForm key={m.symbol} m={m} row={row} pos={pos} />}</div>
    </>
  );
}

const parse = (s: string) => parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
const toAmt = (n: number, dp: number) => (n > 0 ? n.toFixed(dp).replace(/\.?0+$/, "") : "0");

function DepositForm({ m, row, quoting }: { m: Market; row?: MarketRow; quoting: boolean }) {
  const ui = useUI();
  const w = useWallet();
  const sess = useSess();
  const mid = row?.mid ?? 0;
  const [u, setU] = useState("5000");
  const [t, setT] = useState(() => (mid ? nf(5000 / mid, 4) : ""));
  const [balanced, setBalanced] = useState(true);
  const seeded = useRef(!!mid);
  useEffect(() => {
    // the stock leg needs the price; fill it once the first /markets answer lands
    if (!seeded.current && mid) {
      seeded.current = true;
      setT(nf(parse(u) / mid, 4));
    }
  }, [mid, u]);
  const uN = parse(u), tN = parse(t);
  const usdIn = uN > 0 ? parseUnits(toAmt(uN, 6), 6) : 0n;
  const stockIn = tN > 0 ? parseUnits(toAmt(tN, 18), 18) : 0n;
  const open = !!m.vault && !!row?.vault?.open && quoting;
  const preview = useReadContract({
    address: m.vault ?? undefined,
    abi: anchorVaultAbi,
    functionName: "previewDeposit",
    args: [usdIn, stockIn],
    query: { enabled: open && (usdIn > 0n || stockIn > 0n), refetchInterval: 8_000 },
  });
  if (!w.isConnected) {
    return (
      <>
        <p className="t2" style={{ margin: "0 0 12px", fontSize: 13.5 }}>
          Connect a wallet to deposit into this vault.
        </p>
        <button className="btn btn-holo btn-block btn-lg" onClick={() => ui.openModal(<ConnectModal />)}>
          Connect wallet
        </button>
      </>
    );
  }
  const tvl = row?.vault?.tvlUsd ?? 0;
  const cap = TIERS[m.tier].capUsd;
  // the value the vault credits: the stock leg at its bid (deposits are priced like a trade)
  const v = preview.data ? units(preview.data[1], 18) : uN + tN * mid;
  const balU = w.balances.USDG, balT = w.balances[m.symbol];
  const paused = sess.session === "closed";
  let lab = `Deposit ${nf(v, 2)} USDG of value`, dis = false;
  if (!m.vault) (lab = "Opens in the second wave"), (dis = true);
  else if (paused) (lab = "Deposits reopen when markets do"), (dis = true);
  else if (!row?.vault?.open) (lab = "Vault paused"), (dis = true);
  else if (!row.feedFresh) (lab = "Waiting for a fresh Chainlink price"), (dis = true);
  else if (v <= 0) (lab = "Enter an amount"), (dis = true);
  else if (balU !== undefined && usdIn > balU) (lab = "Not enough USDG"), (dis = true);
  else if (balT !== undefined && stockIn > balT) (lab = "Not enough " + m.symbol), (dis = true);
  else if (v > cap - tvl) (lab = "Above the vault cap"), (dis = true);
  else if (w.eligible === false) (lab = "Wallet not verified for stock tokens"), (dis = true);
  return (
    <>
      <div className="field">
        <div className="field-l">
          <label htmlFor="dU">USDG</label>
          <span>
            Balance <span className="num">{balU === undefined ? "–" : nf(units(balU, 6), 2)}</span>
          </span>
        </div>
        <div className="field-row">
          <input
            className="amt num"
            id="dU"
            inputMode="decimal"
            value={u}
            onChange={(e) => {
              setU(e.target.value);
              if (balanced && mid) setT(nf(parse(e.target.value) / mid, 4));
            }}
          />
          <TokBtn sym="USDG" />
        </div>
      </div>
      <div style={{ height: 8 }} />
      <div className="field">
        <div className="field-l">
          <label htmlFor="dT">{m.symbol}</label>
          <span>
            Balance <span className="num">{balT === undefined ? "–" : nf(units(balT, 18), 4)}</span>
          </span>
        </div>
        <div className="field-row">
          <input
            className="amt num"
            id="dT"
            inputMode="decimal"
            value={t}
            onChange={(e) => {
              setT(e.target.value);
              if (balanced && mid) setU(nf(parse(e.target.value) * mid, 2));
            }}
          />
          <TokBtn sym={m.symbol} />
        </div>
      </div>
      <label className="switch" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={balanced} onChange={(e) => setBalanced(e.target.checked)} />
        <span className="switch-track" />
        <span className="t2" style={{ fontSize: 13.5 }}>
          Keep it balanced at the Chainlink price
        </span>
      </label>
      <div className="lns" style={{ marginTop: 14 }}>
        <Ln k="Deposit value">
          <b className="num">{nf(v, 2)} USDG</b>
        </Ln>
        <Ln k="Share of vault after">
          <span className="num">{nf(v > 0 ? (v / (tvl + v)) * 100 : 0, 3)}%</span>
        </Ln>
        <Ln k="Capacity left">
          <span className="num">{compact(Math.max(0, cap - tvl))}</span>
        </Ln>
      </div>
      {paused ? (
        <div className="note note-warn">
          <span>
            <Icon n="pause" />
          </span>
          <span>
            <b>Deposits are paused {sess.holiday ? "for the market holiday" : "for the weekend"}.</b> They reopen when US markets do.
          </span>
        </div>
      ) : (
        <div className="note note-lav">
          <span>
            <Icon n="info" />
          </span>
          <span>Shares are minted at the Chainlink price, less the vault spread. Deposits are priced like a trade.</span>
        </div>
      )}
      <button className="btn btn-holo btn-lg btn-block" style={{ marginTop: 16 }} disabled={dis} onClick={() => ui.openModal(<DepositFlow m={m} usdIn={usdIn} stockIn={stockIn} />)}>
        {lab}
      </button>
    </>
  );
}

function DepositFlow({ m, usdIn, stockIn }: { m: Market; usdIn: bigint; stockIn: bigint }) {
  const { d } = useDeployment();
  const { s } = useSettings();
  const ui = useUI();
  const qc = useQueryClient();
  const w = useWallet();
  const tx = useVaultTx();
  const started = useRef(false);
  const [done, setDone] = useState<number | null>(null);
  useEffect(() => {
    if (started.current) return; // never send twice (React dev mode re-runs effects)
    started.current = true;
    tx.deposit({ vault: m.vault!, usdg: d.usdg, stock: m.token, sym: m.symbol, usdIn, stockIn, slipBps: s.slip }).then((r) => {
      w.refetch();
      qc.invalidateQueries({ queryKey: ["markets"] });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      if (!r) return;
      const v = units(r.valueWad, 18);
      setDone(v);
      ui.toast("Deposit confirmed", `${nf(v, 2)} USDG into the ${m.symbol} vault`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Modal label="Depositing">
      {done === null && <ModalHead title="Depositing" />}
      <div className="modal-b">
        {done !== null ? (
          <Success title="Deposit confirmed" body={`You added ${nf(done, 2)} USDG of value to the ${m.symbol} vault.`} />
        ) : (
          <>
            <Steps steps={tx.steps} />
            {tx.error && <FlowError message={tx.error} />}
          </>
        )}
      </div>
    </Modal>
  );
}

function WithdrawForm({ m, row, pos }: { m: Market; row?: MarketRow; pos?: VaultPosition }) {
  const ui = useUI();
  const w = useWallet();
  const [pct, setPct] = useState(50);
  if (!w.isConnected) {
    return (
      <>
        <p className="t2" style={{ margin: "0 0 12px", fontSize: 13.5 }}>
          Connect a wallet to withdraw from this vault.
        </p>
        <button className="btn btn-holo btn-block btn-lg" onClick={() => ui.openModal(<ConnectModal />)}>
          Connect wallet
        </button>
      </>
    );
  }
  const shares = w.positions[m.symbol]?.shares ?? 0n;
  if (!pos || shares === 0n) {
    return (
      <p className="t2" style={{ margin: 0, fontSize: 13.5 }}>
        You have no position in this vault yet.
      </p>
    );
  }
  const f = pct / 100;
  const tk = pos.stock * f, us = pos.usd * f, v = tk * (row?.mid ?? 0) + us;
  const burn = pct >= 100 ? shares : (shares * BigInt(pct)) / 100n;
  return (
    <>
      <div className="field">
        <div className="field-l">
          <label htmlFor="wR">Amount to withdraw</label>
          <b style={{ color: "var(--text)" }}>{pct}%</b>
        </div>
        <input className="range" id="wR" type="range" min={1} max={100} value={pct} onChange={(e) => setPct(+e.target.value)} style={{ marginTop: 14 }} />
        <div className="presets">
          {[25, 50, 75, 100].map((x) => (
            <button key={x} className="preset" onClick={() => setPct(x)}>
              {x === 100 ? "Max" : x + "%"}
            </button>
          ))}
        </div>
      </div>
      <div className="lns" style={{ marginTop: 14 }}>
        <Ln k="You receive">
          <b className="num">
            {nf(tk, 4)} {m.symbol}
          </b>
        </Ln>
        <Ln k="and">
          <b className="num">{nf(us, 2)} USDG</b>
        </Ln>
        <Ln k="Value at the Chainlink price">
          <span className="num">{nf(v, 2)}</span>
        </Ln>
      </div>
      <div className="note note-lav">
        <span>
          <Icon n="shield" />
        </span>
        <span>
          <b>Paid out in kind.</b> You receive your share of both tokens. No oracle is used, so this works even during a halt.
        </span>
      </div>
      <button className="btn btn-holo btn-lg btn-block" style={{ marginTop: 16 }} onClick={() => ui.openModal(<WithdrawFlow m={m} shares={burn} mid={row?.mid ?? 0} />)}>
        Withdraw
      </button>
    </>
  );
}

function WithdrawFlow({ m, shares, mid }: { m: Market; shares: bigint; mid: number }) {
  const { s } = useSettings();
  const ui = useUI();
  const qc = useQueryClient();
  const w = useWallet();
  const tx = useVaultTx();
  const started = useRef(false);
  const [done, setDone] = useState<{ tk: number; us: number } | null>(null);
  useEffect(() => {
    if (started.current) return; // never send twice (React dev mode re-runs effects)
    started.current = true;
    tx.withdraw({ vault: m.vault!, shares, slipBps: s.slip }).then((r) => {
      w.refetch();
      qc.invalidateQueries({ queryKey: ["markets"] });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      if (!r) return;
      const tk = units(r.stockOut, 18), us = units(r.usdOut, 6);
      setDone({ tk, us });
      ui.toast("Withdrawal settled", `${nf(tk * mid + us, 2)} USDG of value from the ${m.symbol} vault`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Modal label="Withdrawing">
      {!done && <ModalHead title="Withdrawing" />}
      <div className="modal-b">
        {done ? (
          <Success title="Withdrawal settled" body={`${nf(done.tk, 4)} ${m.symbol} and ${nf(done.us, 2)} USDG are back in your wallet.`} />
        ) : (
          <>
            <Steps steps={tx.steps} />
            {tx.error && <FlowError message={tx.error} />}
          </>
        )}
      </div>
    </Modal>
  );
}
