"use client";
/**
 * /app/portfolio (prototype pagePortfolio, mountPortfolio).
 * Balances and vault shares: wagmi. Prices: GET /markets. Trades and vault flows: GET /portfolio/:address.
 * "Value over time" values today's holdings at past Chainlink prices (usePortfolioHistory).
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { compact, nf, short, sum, units } from "@/lib/format";
import { useMarketMap, usePortfolio, toFill, type UIFill } from "@/hooks/data";
import { useWallet } from "@/hooks/useWallet";
import { usePortfolioHistory, useVaultPositions } from "@/hooks/usePortfolioHistory";
import { useChainNow } from "@/hooks/useChainNow";
import { useDeployment } from "../deployment";
import { useSettings } from "../settings";
import { useUI } from "../ui";
import { Icon } from "../Icon";
import { Tok } from "../Tok";
import { Mark, MarkPaths, Rosette } from "../Guilloche";
import { AreaChart } from "../charts";
import { CHAIN_NAME, ConnectModal } from "../modals";
import { cssVar, SideTxt, VenueChip } from "../bits";

export function PortfolioPage() {
  const w = useWallet();
  const ui = useUI();
  if (!w.isConnected || !w.address) {
    return (
      <div className="page">
        <div className="ph">
          <div>
            <h1>Portfolio</h1>
            <p>Your balances, vault positions and every trade, in one place.</p>
          </div>
        </div>
        <section className="panel">
          <div className="empty">
            <Rosette />
            <h3>Connect a wallet to see your portfolio</h3>
            <p>Balances, vault positions and a receipt for every trade you make on Paritas.</p>
            <button className="btn btn-holo" style={{ marginTop: 8 }} onClick={() => ui.openModal(<ConnectModal />)}>
              <Icon n="wallet" />
              Connect wallet
            </button>
          </div>
        </section>
      </div>
    );
  }
  return <Connected address={w.address} />;
}

function Connected({ address }: { address: `0x${string}` }) {
  const w = useWallet();
  const ui = useUI();
  const router = useRouter();
  const { fmt } = useSettings();
  const { markets, byToken } = useDeployment();
  const { map } = useMarketMap();
  const { positions } = useVaultPositions();
  const pf = usePortfolio(address);
  const now = useChainNow(30_000) * 1000;
  const [ptf, setPtf] = useState<"1W" | "1M">("1W");

  const hold = [
    { k: "USDG", v: units(w.balances.USDG ?? 0n, 6), px: 1, chg: 0 },
    ...markets.map((m) => ({ k: m.symbol, v: units(w.balances[m.symbol] ?? 0n, 18), px: map?.get(m.symbol)?.mid ?? 0, chg: map?.get(m.symbol)?.chg ?? 0 })),
  ]
    .filter((h) => h.v > 1e-6)
    .map((h) => ({ ...h, val: h.v * h.px }))
    .sort((a, b) => b.val - a.val);
  const pos = Object.values(positions);
  const wallet = sum(hold, (h) => h.val);
  const vaults = sum(pos, (p) => p.value);
  const fees = sum(pos, (p) => p.fees);

  // today's holdings (wallet + what vault shares redeem for) at past prices, ending at the live value
  const stock: Record<string, number> = {};
  for (const m of markets) stock[m.symbol] = units(w.balances[m.symbol] ?? 0n, 18) + (positions[m.symbol]?.stock ?? 0);
  const usd = units(w.balances.USDG ?? 0n, 6) + sum(pos, (p) => p.usd);
  const hist = usePortfolioHistory(ptf, { usd, stock });
  const pts = w.loaded && map ? [...hist, { t: Math.max(now, (hist[hist.length - 1]?.t ?? 0) + 1), v: wallet + vaults }] : [];

  const mine = (pf.data?.routes ?? []).map((r) => toFill(r, byToken, address)).filter(Boolean) as UIFill[];

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Portfolio</h1>
          <p>Valued at Chainlink prices. Vault positions include the spread they have earned.</p>
        </div>
        <div className="ph-a">
          <button
            className="btn btn-line"
            onClick={() => {
              navigator.clipboard?.writeText(address).catch(() => {});
              ui.toast("Address copied");
            }}
          >
            <Icon n="copy" />
            Copy address
          </button>
          <Link className="btn btn-holo" href="/app/trade">
            <Icon n="trade" />
            Trade
          </Link>
        </div>
      </div>
      <div className="pf">
        <div className="pcard" data-tilt>
          <span className="glare" />
          <svg className="g" viewBox="-50 -50 100 100" aria-hidden="true">
            <MarkPaths w={0.5} />
          </svg>
          <span className="shine" />
          <div className="pcard-top">
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontStretch: "125%", fontWeight: 700 }}>
              <Mark w={3} size={22} />
              Paritas
            </span>
            {w.eligible === false ? (
              <span className="chip" style={cssVar("--c", "var(--warn)")}>
                <Icon n="lock" />
                Not verified
              </span>
            ) : (
              <span className="chip" style={cssVar("--c", "var(--up)")}>
                <Icon n="shield" />
                Eligible
              </span>
            )}
          </div>
          <div className="pcard-v">
            <span>Total value</span>
            <b className="num">{w.loaded && map ? nf(wallet + vaults, 2) : "–"}</b>
            <span>USDG</span>
          </div>
          <div className="pcard-f">
            <span className="num">{short(address)}</span>
            <span>{CHAIN_NAME}</span>
          </div>
        </div>
        <section className="panel">
          <div className="panel-h">
            <div>
              <div className="panel-t">Value over time</div>
              <div className="panel-s">
                Wallet {compact(wallet)} · vaults {compact(vaults)} · fees {nf(fees, 2)}
              </div>
            </div>
            <div className="seg">
              {(["1W", "1M"] as const).map((k) => (
                <button key={k} aria-pressed={ptf === k} onClick={() => setPtf(k)}>
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-b">
            <AreaChart
              pts={pts}
              h={200}
              fmtX={fmt.shortDate}
              fmtY={(x) => compact(x)}
              label="Portfolio value"
              tip={(p) => (
                <>
                  <b>{nf(p.v, 2)} USDG</b>
                  <div className="muted">{fmt.dt(p.t)}</div>
                </>
              )}
              empty={<p className="muted" style={{ margin: 0, fontSize: 13 }}>Loading your balances…</p>}
            />
          </div>
        </section>
      </div>
      <div className="grid g-2 mt">
        <section className="panel">
          <div className="panel-h">
            <div className="panel-t">Wallet</div>
          </div>
          {hold.length ? (
            <div className="t-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th className="r">Balance</th>
                    <th className="r">Price</th>
                    <th className="r">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {hold.map((h) => (
                    <tr key={h.k}>
                      <td>
                        <div className="mk">
                          <Tok sym={h.k} size="sm" />
                          <b style={{ fontWeight: 650 }}>{h.k}</b>
                        </div>
                      </td>
                      <td className="r num">{nf(h.v, h.k === "USDG" ? 2 : 4)}</td>
                      <td className="r num">
                        {nf(h.px)}
                        {h.k !== "USDG" && (
                          <span className={`sub ${h.chg >= 0 ? "up" : "down"}`}>
                            {h.chg >= 0 ? "+" : "−"}
                            {nf(Math.abs(h.chg))}%
                          </span>
                        )}
                      </td>
                      <td className="r num">
                        <b>{nf(h.val, 2)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty" style={{ padding: 32 }}>
              <p>{w.loaded ? "This wallet holds no USDG or stock tokens." : "Loading balances…"}</p>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-h">
            <div className="panel-t">Vault positions</div>
            <Link className="btn btn-soft btn-sm" href="/app/pool">
              Manage
            </Link>
          </div>
          {pos.length ? (
            <div className="t-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Vault</th>
                    <th className="r">Value</th>
                    <th className="r">Fees, 30d</th>
                    <th className="r">Since</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.map((p) => (
                    <tr key={p.sym}>
                      <td>
                        <div className="mk">
                          <Tok sym={p.sym} size="sm" />
                          <b style={{ fontWeight: 650 }}>{p.sym}</b>
                        </div>
                      </td>
                      <td className="r num">
                        <b>{nf(p.value, 2)}</b>
                      </td>
                      <td className={`r num ${p.fees >= 0 ? "up" : "down"}`}>
                        {p.fees >= 0 ? "+" : "−"}
                        {nf(Math.abs(p.fees), 2)}
                      </td>
                      <td className="r muted">{p.since ? fmt.date(p.since) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty" style={{ padding: 32 }}>
              <p>No vault positions yet.</p>
              <Link className="btn btn-soft" href="/app/pool">
                Browse vaults
              </Link>
            </div>
          )}
        </section>
      </div>
      <section className="panel mt">
        <div className="panel-h">
          <div>
            <div className="panel-t">Your trades</div>
            <div className="panel-s">Open one to see its receipt</div>
          </div>
        </div>
        {mine.length ? (
          <div className="t-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Venue</th>
                  <th className="r">Size, USDG</th>
                  <th className="r">vs share</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((f) => (
                  <tr key={f.id} className="hov" onClick={() => router.push(`/app/activity?fill=${encodeURIComponent(f.id)}`)}>
                    <td>{fmt.dt(f.t)}</td>
                    <td>
                      <div className="mk">
                        <Tok sym={f.sym} size="sm" />
                        <b style={{ fontWeight: 650 }}>{f.sym}</b>
                      </div>
                    </td>
                    <td>
                      <SideTxt s={f.side} />
                    </td>
                    <td>
                      <VenueChip v={f.venue} />
                    </td>
                    <td className="r num">{nf(f.N, 2)}</td>
                    <td className="r num">{fmt.cost(f.cost, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty" style={{ padding: 36 }}>
            <p>No trades yet. Every swap you make gets an itemized receipt here.</p>
            <Link className="btn btn-holo" href="/app/trade">
              Make a trade
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
