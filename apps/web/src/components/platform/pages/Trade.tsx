"use client";
/**
 * /app/trade (prototype pageTrade, ticketHTML, updateTicket, ladder, reviewSwap, runSwap).
 * Prices: GET /markets. Quote, cost lines and venue ladder: POST /quote via useQuote. Swap: useSwap.
 * Balances and eligibility: wagmi. Tape: GET /fills + the live stream.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { parseUnits } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { useConfig } from "wagmi";
import { getBlock } from "wagmi/actions";
import { TIERS, type VenueId } from "@paritas/shared";
import { CHAIN_ID } from "@/lib/wagmi";
import { ago, clamp, compact, fmtPct, nf, short, units } from "@/lib/format";
import { routeRowFromReceipt, useCandles, useFills, useMarketMap, toFill, type UIFill } from "@/hooks/data";
import { useQuote, type QuoteResponse } from "@/hooks/useQuote";
import { useSwap } from "@/hooks/useSwap";
import { useWallet } from "@/hooks/useWallet";
import { useChainNow } from "@/hooks/useChainNow";
import { useDeployment, type Market } from "../deployment";
import { useSettings } from "../settings";
import { Modal, ModalHead, useUI } from "../ui";
import { Icon } from "../Icon";
import { Tok, TokBtn } from "../Tok";
import { AreaChart } from "../charts";
import { SpinCoin } from "../three";
import { SessionCard, useSess } from "../session";
import { CHAIN_NAME, ConnectModal, FlowError, Steps, Success } from "../modals";
import { Chg, cssVar, Ln, LivePx, SideTxt, useNarrow, VenueChip, VENUES } from "../bits";
import { useLiveIds } from "../Shell";
import { useTestFaucet } from "../faucet";
import { useVerifyOpen, VerifyModal } from "../verify";

type Side = "buy" | "sell";
const TF_LABEL = { "1D": "24 hours", "1W": "7 days", "1M": "30 days" } as const;

/** Number -> decimal string for the API (no exponent, trailing zeros trimmed). */
const toAmount = (n: number, dp: number) => (n > 0 ? n.toFixed(dp).replace(/\.?0+$/, "") : "0");

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function TradePage() {
  const params = useSearchParams();
  const router = useRouter();
  const { d, markets, bySymbol, byToken } = useDeployment();
  const m = bySymbol(params.get("m") ?? "") ?? bySymbol("NVDAx") ?? markets[0];
  const { map } = useMarketMap();
  const row = map?.get(m.symbol);
  const { s, fmt } = useSettings();
  const ui = useUI();
  const w = useWallet();
  const sess = useSess();
  const narrow = useNarrow(900);
  const now = useChainNow(15_000) * 1000;
  const live = useLiveIds();

  const [side, setSide] = useState<Side>("buy");
  const [amt, setAmt] = useState(10_000);
  const [raw, setRaw] = useState<string | null>(null); // the input while focused
  const [tf, setTf] = useState<"1D" | "1W" | "1M">("1D");
  const [tape, setTape] = useState<"all" | "mine">("all");
  const [wlq, setWlq] = useState("");
  const buy = side === "buy";
  const payT = buy ? "USDG" : m.symbol, recvT = buy ? m.symbol : "USDG";
  const payDec = buy ? 6 : 18, recvDec = buy ? 18 : 6;

  const shown = amt > 0 ? nf(amt, buy ? 2 : amt < 100 ? 4 : 2).replace(/\.00$/, "") : ""; // the input when not focused
  const dAmt = useDebounced(amt, 250);
  const quote = useQuote({ symbol: m.symbol, side, amount: toAmount(dAmt, buy ? 6 : 8), trader: w.address, slippageBps: s.slip, venues: s.pref });
  const q = amt > 0 ? quote.data : undefined;
  // a quote kept from the previous block is fine; one for a different amount is shown dimmed until the new one lands
  const stale = !q || q.args.amount !== toAmount(amt, buy ? 6 : 8) || q.args.side !== side || q.args.symbol !== m.symbol;
  const has = amt > 0;
  const ok = !!q?.ok && has;
  const mid = q && q.oraclePriceWad !== "0" ? units(q.oraclePriceWad, 18) : row?.mid;

  // chart and stats
  const candles = useCandles(m.symbol, tf);
  const day = useCandles(m.symbol, "1D");
  const pts = useMemo(() => {
    const c = candles.data ?? [];
    return c.length && row ? [...c, { t: Math.max(now, c[c.length - 1].t + 1), v: row.mid }] : c;
  }, [candles.data, row, now]);
  const d1 = [...(day.data ?? []).map((p) => p.v), ...(row ? [row.mid] : [])];
  const chg = pts.length && row ? (row.mid / pts[0].v - 1) * 100 : row?.chg ?? 0;
  const tier = TIERS[m.tier];

  // tape
  const fills = useFills(tape === "mine" ? { trader: w.address, limit: 12 } : { symbol: m.symbol, limit: 12 }, tape === "all" || !!w.address);
  const tapeRows = (fills.data ?? []).map((r) => toFill(r, byToken, w.address)).filter(Boolean) as UIFill[];

  const select = (sym: string) => {
    const next = map?.get(sym);
    if (side === "sell" && row && next) setAmt(+((amt * row.mid) / next.mid).toFixed(4));
    router.replace(`/app/trade?m=${sym}`, { scroll: false });
  };
  const flip = () => {
    const out = ok && q?.expectedOut ? units(q.expectedOut, recvDec) : 0;
    setSide(buy ? "sell" : "buy");
    setAmt(out > 0 ? +out.toFixed(buy ? 4 : 2) : 0);
    setRaw(null);
  };
  const setSideTo = (x: Side) => x !== side && flip();

  // button
  const payBal = w.balances[payT];
  const faucet = useTestFaucet(() => w.refetch());
  const canVerify = useVerifyOpen();
  const need = has ? parseUnits(toAmount(amt, buy ? 6 : 18), payDec) : 0n;
  let label = "Review swap", act: "review" | "connect" | "faucet" | "verify" | null = "review";
  if (!w.isConnected) (label = "Connect wallet"), (act = "connect");
  else if (w.eligible === false && canVerify) (label = "Verify wallet"), (act = "verify");
  else if (!has) (label = "Enter an amount"), (act = null);
  else if (quote.isError && !q) (label = "Quotes are unavailable"), (act = null);
  else if (q && !q.ok) (label = "No route inside the limit"), (act = null);
  else if (payBal !== undefined && payBal < need && faucet.available && payT === "USDG") (label = faucet.busy ? "Adding test USDG…" : "Get 10,000 test USDG"), (act = faucet.busy ? null : "faucet");
  else if (payBal !== undefined && payBal < need) (label = "Not enough " + payT), (act = null);
  else if (w.eligible === false) (label = "Wallet not verified for stock tokens"), (act = null);
  else if (!q || stale) (label = "Getting a quote…"), (act = null);

  const swapBtn = () => {
    if (act === "connect") ui.openModal(<ConnectModal />);
    if (act === "faucet") void faucet.mint();
    if (act === "verify") ui.openModal(<VerifyModal onDone={() => w.refetch()} />);
    if (act === "review" && q) ui.openModal(<ReviewModal q={q} m={m} side={side} amt={amt} />);
  };

  const wl = markets.filter((x) => !wlq || (x.symbol + x.name).toLowerCase().includes(wlq.toLowerCase()));
  const holiday = sess.session === "closed" && sess.holiday;
  const vaultPausedCopy = holiday ? "for the market holiday" : "for the weekend";

  return (
    <div className="trade">
      <aside className="pane wl" aria-label="Watchlist">
        <div className="wl-h">
          <div className="ttl">
            <b>Markets</b>
            <span className="muted" style={{ fontSize: 12 }}>
              Chainlink prices
            </span>
          </div>
          <div className="search">
            <Icon n="search" />
            <input className="input" placeholder="Search" value={wlq} onChange={(e) => setWlq(e.target.value)} aria-label="Search markets" />
          </div>
        </div>
        <ul className="wl-list">
          {wl.length ? (
            wl.map((x) => {
              const r = map?.get(x.symbol);
              return (
                <li key={x.symbol}>
                  <button className="wl-item" aria-current={x.symbol === m.symbol} onClick={() => select(x.symbol)}>
                    <Tok sym={x.symbol} />
                    <span style={{ minWidth: 0 }}>
                      <span className="mk-sym" style={{ display: "block" }}>
                        {x.symbol}
                      </span>
                      <span className="mk-name" style={{ display: "block" }}>
                        {x.name}
                      </span>
                    </span>
                    <span className="wl-px">
                      <LivePx v={r?.mid} />
                      {r ? <Chg v={r.chg} style={{ fontWeight: 600 }} /> : <span className="muted">–</span>}
                    </span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="muted" style={{ padding: 12 }}>
              No market matches.
            </li>
          )}
        </ul>
        <SessionCard />
      </aside>

      <section className="pane center" aria-label="Market">
        <div className="mh">
          <div className="mh-l">
            <SpinCoin sym={m.symbol} />
            <div>
              <div className="mh-sym">{m.symbol}</div>
              <div className="mk-name">
                {m.name} · Tier {m.tier} · {CHAIN_NAME}
              </div>
            </div>
          </div>
          <div className="seg" role="group" aria-label="Time range">
            {(["1D", "1W", "1M"] as const).map((k) => (
              <button key={k} aria-pressed={tf === k} onClick={() => setTf(k)}>
                {k}
              </button>
            ))}
          </div>
        </div>
        <div className="mh-px" style={{ padding: "0 22px" }}>
          <LivePx v={row?.mid} />
          <span className="muted">USDG</span>
          <Chg v={chg} />
          <span className="muted" style={{ fontSize: 12.5 }}>
            {TF_LABEL[tf]}
          </span>
        </div>
        <div className="mh-stats">
          <div>
            24h high<b className="num">{d1.length ? nf(Math.max(...d1)) : "–"}</b>
          </div>
          <div>
            24h low<b className="num">{d1.length ? nf(Math.min(...d1)) : "–"}</b>
          </div>
          <div>
            Vault TVL<b>{row?.vault ? compact(row.vault.tvlUsd) + " USDG" : "Not open"}</b>
          </div>
          <div>
            Vault spread now<b>{m.vault && row?.vault?.open && sess.m ? fmt.cost(tier.halfSpreadBps * sess.m.mul) : "Paused"}</b>
          </div>
          <div>
            Chainlink feed
            <b className={row?.feedFresh ? "up" : "muted"}>{!row ? "–" : row.feedFresh ? "Live" : sess.session === "closed" ? `Paused ${vaultPausedCopy}` : "Out of date"}</b>
          </div>
        </div>
        <div className="chart-wrap">
          <AreaChart
            pts={pts}
            h={narrow ? 240 : 300}
            refV={pts[0]?.v}
            fmtX={tf === "1D" ? fmt.time : fmt.shortDate}
            label={m.symbol + " price"}
            tip={(p) => (
              <>
                <b>{nf(p.v)} USDG</b>
                <div className="muted">{fmt.dt(p.t)}</div>
              </>
            )}
            empty={<p className="muted" style={{ margin: 0, fontSize: 13 }}>{candles.isError ? "Price history is unavailable right now." : "Price history starts when the indexer has sampled the feed."}</p>}
          />
        </div>
        <div className="sect">
          <div className="sect-h">
            <div>
              <div className="sect-t">Where each venue would fill you</div>
              <div className="sect-s">
                {has && q && mid ? `${buy ? "Buying" : "Selling"} ${buy ? nf(q.notionalUsd, 0) + " USDG of " + m.symbol : nf(amt, 4) + " " + m.symbol}, measured from the share price of ${nf(mid)}` : "Enter an amount on the ticket"}
              </div>
            </div>
            <div className="legend">
              <span>
                <i style={cssVar("--c", "var(--v-vault)")} />
                Vault
              </span>
              <span>
                <i style={cssVar("--c", "var(--v-pool)")} />
                Uniswap
              </span>
              <span>
                <i style={cssVar("--c", "var(--v-rfq)")} />
                Makers
              </span>
            </div>
          </div>
          <Ladder q={has ? q : undefined} buy={buy} bandBps={q?.priceLimitBps ?? tier.bandBps} />
        </div>
        <div className="sect" style={{ paddingBottom: 6 }}>
          <div className="sect-h">
            <div className="sect-t">Tape</div>
            <div className="seg" role="group" aria-label="Fills shown">
              {(
                [
                  ["all", "All " + m.symbol],
                  ["mine", "Your trades"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} aria-pressed={tape === k} onClick={() => setTape(k)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="t-wrap" style={{ paddingBottom: 12 }}>
          {tapeRows.length ? (
            <table className="t">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Side</th>
                  <th>Venue</th>
                  <th className="r">Size, USDG</th>
                  <th className="r">Price</th>
                  <th className="r">vs share</th>
                </tr>
              </thead>
              <tbody>
                {tapeRows.map((f) => (
                  <tr key={f.id} className={`hov ${live.has(f.id) ? "flash" : ""}`} onClick={() => router.push(`/app/activity?fill=${encodeURIComponent(f.id)}`)}>
                    <td className="num">
                      {fmt.time(f.t)}
                      <span className="sub">{ago(f.t, now)}</span>
                    </td>
                    <td>
                      <SideTxt s={f.side} />
                    </td>
                    <td>
                      <VenueChip v={f.venue} />
                    </td>
                    <td className="r num">{nf(f.N, 2)}</td>
                    <td className="r num">{nf(f.price)}</td>
                    <td className="r num">{fmt.cost(f.cost, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty" style={{ padding: 28 }}>
              <p>{tape === "mine" ? (w.isConnected ? "No trades from your wallet yet." : "Connect a wallet to see your trades.") : fills.isError ? "The tape is unavailable right now." : "No fills in the last day."}</p>
            </div>
          )}
        </div>
      </section>

      <aside className="pane ticket-pane" aria-label="Swap ticket">
        <div className="ticket">
          <div className="foil" />
          <div className="tk-b">
            <div className="tk-h">
              <b>Ticket</b>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div className="seg side" role="group" aria-label="Direction">
                  <button data-side="buy" aria-pressed={buy} onClick={() => setSideTo("buy")}>
                    Buy
                  </button>
                  <button data-side="sell" aria-pressed={!buy} onClick={() => setSideTo("sell")}>
                    Sell
                  </button>
                </div>
                <button className="icon-btn" style={{ width: 36, height: 36 }} aria-label="Slippage" onClick={(e) => ui.openPop(e.currentTarget, <SlipPop />)}>
                  <Icon n="gear" />
                </button>
              </div>
            </div>
            <div className="field">
              <div className="field-l">
                <label htmlFor="payAmt">You pay</label>
                <span>
                  {w.isConnected ? (
                    <>
                      Balance <span className="num">{payBal === undefined ? "–" : nf(units(payBal, payDec), buy ? 2 : 4)}</span>{" "}
                      <button
                        onClick={() => {
                          setAmt(payBal ? units(payBal, payDec) : 0);
                          setRaw(null);
                        }}
                      >
                        Max
                      </button>
                    </>
                  ) : !buy && q ? (
                    "≈ " + nf(q.notionalUsd, 2) + " USDG"
                  ) : (
                    ""
                  )}
                </span>
              </div>
              <div className="field-row">
                <input
                  className="amt num"
                  id="payAmt"
                  inputMode="decimal"
                  autoComplete="off"
                  value={raw ?? shown}
                  onFocus={() => setRaw(shown)}
                  onBlur={() => setRaw(null)}
                  onChange={(e) => {
                    setRaw(e.target.value);
                    const v = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
                    setAmt(isFinite(v) ? v : 0);
                  }}
                />
                {buy ? <TokBtn sym="USDG" /> : <PickBtn sym={m.symbol} onPick={select} />}
              </div>
              <div className="presets">
                {[1000, 10000, 50000, 250000].map((n) => (
                  <button
                    key={n}
                    className="preset"
                    onClick={() => {
                      setAmt(buy ? n : row ? +(n / row.mid).toFixed(4) : 0);
                      setRaw(null);
                    }}
                  >
                    ${n / 1000}k
                  </button>
                ))}
              </div>
            </div>
            <div className="flipw">
              <button className="flip" aria-label="Switch direction" onClick={flip}>
                <Icon n="flip" />
              </button>
            </div>
            <div className="field">
              <div className="field-l">
                <span>You receive</span>
                <span>
                  {w.isConnected && (
                    <>
                      Balance <span className="num">{w.balances[recvT] === undefined ? "–" : nf(units(w.balances[recvT], recvDec), buy ? 4 : 2)}</span>
                    </>
                  )}
                </span>
              </div>
              <div className="field-row">
                <input className="amt num" readOnly tabIndex={-1} aria-label="Estimated amount received" value={ok && q?.expectedOut ? nf(units(q.expectedOut, recvDec), buy ? 4 : 2) : ""} style={{ opacity: stale ? 0.6 : 1 }} />
                {buy ? <PickBtn sym={m.symbol} onPick={select} /> : <TokBtn sym="USDG" />}
              </div>
            </div>
            <div className="perf" aria-hidden="true" />
            <div className="lns" style={{ opacity: stale ? 0.6 : 1, transition: "opacity .15s" }}>
              {ok && q && mid ? (
                <CostLines q={q} buy={buy} mid={mid} recvT={recvT} recvDec={recvDec} />
              ) : (
                <p className="muted" style={{ margin: 0, fontSize: 13, textAlign: "center" }}>
                  {!has ? "Enter an amount to print a quote." : quote.isError && !q ? "Quotes are unavailable right now. Try again in a moment." : !q ? "Getting a quote…" : q.reason ?? "No venue can fill this inside the price limit."}
                </p>
              )}
            </div>
            <div>
              {sess.session === "closed" ? (
                <div className="note note-warn">
                  <span>
                    <Icon n="pause" />
                  </span>
                  <span>
                    <b>Vaults are paused {vaultPausedCopy}.</b> Uniswap and market makers are still quoting, usually wider.
                  </span>
                </div>
              ) : sess.session !== "regular" && sess.m ? (
                <div className="note note-cyan">
                  <span>
                    <Icon n="clock" />
                  </span>
                  <span>
                    <b>{sess.copy.label}.</b> Vault spread is ×{nf(sess.m.mul, 1)}. Regular hours usually cost less.
                  </span>
                </div>
              ) : null}
              {!m.vault && (
                <div className="note">
                  <span>
                    <Icon n="info" />
                  </span>
                  <span>The {m.symbol} vault opens in the second wave. Orders route through Uniswap and makers.</span>
                </div>
              )}
            </div>
            <button className="btn btn-holo btn-lg btn-block" style={{ marginTop: 16 }} disabled={!act} onClick={swapBtn}>
              {label}
            </button>
            <p className="tk-foot">Quotes refresh every block.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function CostLines({ q, buy, mid, recvT, recvDec }: { q: QuoteResponse; buy: boolean; mid: number; recvT: string; recvDec: number }) {
  const { fmt } = useSettings();
  const legs = q.legs ?? [];
  const cost = q.costBps ?? 0;
  const price = buy ? mid * (1 + cost / 1e4) : mid * (1 - cost / 1e4);
  const used = Math.max(...legs.map((l) => l.costBps), cost);
  const main = q.mainVenue ?? legs[0]?.venue ?? "vault";
  return (
    <>
      <Ln k="Route">
        <span className="route-pill">
          <span className="dot" style={cssVar("--c", VENUES[main].c)} />
          {legs.length > 1 ? legs.map((l) => VENUES[l.venue].short).join(" + ") : VENUES[main].name}
        </span>
      </Ln>
      <Ln k="Share price (Chainlink)">
        <b className="num">{nf(mid)}</b>
      </Ln>
      {legs.length > 1
        ? legs.map((l) => (
            <Ln key={l.venue} k={`${VENUES[l.venue].name}, ${compact(units(l.amountIn, buy ? 6 : 18) * (buy ? 1 : mid))} USDG`}>
              <span className="num">{fmt.cost(l.costBps, true)}</span>
            </Ln>
          ))
        : legs[0]?.lines.map((l) => (
            <Ln key={l.label} k={l.label}>
              <span className="num">{fmt.cost(l.bps, true)}</span>
            </Ln>
          ))}
      <Ln k="Your price" cls="total">
        <b className="num">{nf(price)} USDG</b>
      </Ln>
      <Ln k="Minimum received">
        <span className="num">
          {nf(units(q.minAmountOut ?? "0", recvDec), recvT === "USDG" ? 2 : 4)} {recvT}
        </span>
      </Ln>
      <div className="ln">
        <span>Price limit used</span>
        <i />
        <span className="num">
          {fmt.cost(used)} of {fmtPct(q.priceLimitBps)}
        </span>
      </div>
      <div className="lim">
        <i style={{ width: `${clamp((used / q.priceLimitBps) * 100, 2, 100)}%` }} />
      </div>
    </>
  );
}

function Ladder({ q, buy, bandBps }: { q?: QuoteResponse; buy: boolean; bandBps: number }) {
  const { fmt } = useSettings();
  const span = bandBps * 1.35;
  const X = (bps: number) => clamp(50 + ((buy ? bps : -bps) / span) * 50, 1.5, 98.5);
  const bandL = 50 - (bandBps / span) * 50, bandW = (bandBps / span) * 100;
  const order: VenueId[] = ["vault", "pool", "rfq"];
  return (
    <div className="ladder">
      {order.map((id) => {
        const V = VENUES[id];
        const r = q?.venueQuotes.find((x) => x.id === id);
        const best = !!q?.ok && q.mainVenue === id;
        const on = !!r?.available;
        return (
          <div key={id} className={`lane ${best ? "best" : ""} ${on ? "" : "off"}`} style={cssVar("--c", V.c)}>
            <div className="lane-n">
              <span className="dot" />
              <span className="nm">{V.name}</span>
            </div>
            <div className="lane-track">
              <span className="band" style={{ left: `${bandL}%`, width: `${bandW}%` }} />
              <span className="zero" style={{ left: "50%" }} />
              {r?.costBps != null && <span className="mark" style={{ left: `${X(r.costBps)}%` }} title={`${V.name}: ${fmt.cost(r.costBps, true)}`} />}
            </div>
            <div className="lane-v">
              {!r ? (
                "–"
              ) : r.costBps != null ? (
                <>
                  <span className="num">{fmt.cost(r.costBps, true)}</span>
                  <small>{r.available ? (best ? "Best price" : "Quoted") : r.reason}</small>
                </>
              ) : (
                <small>{r.reason}</small>
              )}
            </div>
          </div>
        );
      })}
      <div className="axis">
        <span />
        <div className="axis-t">
          <span style={{ left: `${bandL}%` }}>
            {buy ? "−" : "+"}
            {fmtPct(bandBps)}
          </span>
          <span style={{ left: "50%" }}>Share price</span>
          <span style={{ left: `${bandL + bandW}%` }}>
            {buy ? "+" : "−"}
            {fmtPct(bandBps)}
          </span>
        </div>
        <span className="muted" style={{ fontSize: 11, textAlign: "right" }}>
          Price limit band
        </span>
      </div>
    </div>
  );
}

function PickBtn({ sym, onPick }: { sym: string; onPick(s: string): void }) {
  const ui = useUI();
  return (
    <button className="tokbtn" onClick={(e) => ui.openPop(e.currentTarget, <MarketPicker onPick={onPick} />, { width: 320 })}>
      <Tok sym={sym} size="sm" />
      {sym}
      <Icon n="chev" />
    </button>
  );
}

function MarketPicker({ onPick }: { onPick(s: string): void }) {
  const { markets } = useDeployment();
  const { map } = useMarketMap();
  const ui = useUI();
  const [f, setF] = useState("");
  return (
    <>
      <div className="search" style={{ margin: "4px 4px 6px" }}>
        <Icon n="search" />
        <input className="input" placeholder="Search markets" aria-label="Search markets" value={f} onChange={(e) => setF(e.target.value)} />
      </div>
      <div className="pop-list">
        {markets
          .filter((x) => (x.symbol + x.name).toLowerCase().includes(f.toLowerCase()))
          .map((x) => (
            <button
              key={x.symbol}
              className="pop-item"
              onClick={() => {
                ui.closePop();
                onPick(x.symbol);
              }}
            >
              <Tok sym={x.symbol} size="sm" />
              <span style={{ flex: 1 }}>
                <b style={{ fontWeight: 650 }}>{x.symbol}</b> <span className="muted">{x.name}</span>
              </span>
              <span className="t2 num">{map?.get(x.symbol) ? nf(map.get(x.symbol)!.mid) : "–"}</span>
            </button>
          ))}
      </div>
    </>
  );
}

function SlipPop() {
  const { s, set } = useSettings();
  return (
    <div style={{ padding: 10, width: 286 }}>
      <div style={{ fontWeight: 650, marginBottom: 10 }}>Ticket settings</div>
      <div className="field-l" style={{ marginBottom: 8 }}>
        <span>Slippage tolerance</span>
        <b style={{ color: "var(--text)" }}>{fmtPct(s.slip)}</b>
      </div>
      <div className="seg" style={{ width: "100%" }}>
        {[10, 30, 50, 100].map((v) => (
          <button key={v} style={{ flex: 1 }} aria-pressed={s.slip === v} onClick={() => set({ slip: v })}>
            {fmtPct(v)}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "12px 0 0" }}>
        The swap reverts if the price moves past your tolerance.
      </p>
    </div>
  );
}

function ReviewModal({ q, m, side, amt }: { q: QuoteResponse; m: Market; side: Side; amt: number }) {
  const { s, fmt } = useSettings();
  const ui = useUI();
  const buy = side === "buy";
  const payT = buy ? "USDG" : m.symbol, recvT = buy ? m.symbol : "USDG";
  const mid = units(q.oraclePriceWad, 18);
  const cost = q.costBps ?? 0;
  const legs = q.legs ?? [];
  const used = Math.max(...legs.map((l) => l.costBps), cost);
  const recvDec = buy ? 18 : 6;
  return (
    <Modal label="Review swap">
      <ModalHead title="Review swap" />
      <div className="modal-b">
        <div className="field" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="field-l">You pay</div>
            <div className="num" style={{ fontSize: 24, fontWeight: 650 }}>
              {nf(amt, payT === "USDG" ? 2 : 4)}
            </div>
          </div>
          <TokBtn sym={payT} />
        </div>
        <div className="flipw">
          <span className="flip" style={{ cursor: "default" }}>
            <Icon n="flip" />
          </span>
        </div>
        <div className="field" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="field-l">You receive, estimated</div>
            <div className="num" style={{ fontSize: 24, fontWeight: 650 }}>
              {nf(units(q.expectedOut ?? "0", recvDec), recvT === "USDG" ? 2 : 4)}
            </div>
          </div>
          <TokBtn sym={recvT} />
        </div>
        <div className="lns" style={{ marginTop: 16 }}>
          <Ln k="Route">
            {legs.length > 1 ? (
              <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {legs.map((l) => (
                  <VenueChip key={l.venue} v={l.venue} />
                ))}
              </span>
            ) : (
              <VenueChip v={q.mainVenue ?? "vault"} />
            )}
          </Ln>
          <Ln k="Share price (Chainlink)">
            <b className="num">{nf(mid)}</b>
          </Ln>
          {legs.length > 1
            ? legs.map((l) => (
                <Ln key={l.venue} k={VENUES[l.venue].name}>
                  <span className="num">{fmt.cost(l.costBps, true)}</span>
                </Ln>
              ))
            : legs[0]?.lines.map((l) => (
                <Ln key={l.label} k={l.label}>
                  <span className="num">{fmt.cost(l.bps, true)}</span>
                </Ln>
              ))}
          <Ln k="Your price" cls="total">
            <b className="num">{nf(buy ? mid * (1 + cost / 1e4) : mid * (1 - cost / 1e4))} USDG</b>
          </Ln>
          <Ln k="Minimum received">
            <span className="num">
              {nf(units(q.minAmountOut ?? "0", recvDec), recvT === "USDG" ? 2 : 4)} {recvT}
            </span>
          </Ln>
          <Ln k="Price limit check">
            <span className="up">
              {fmt.cost(used)} of {fmtPct(q.priceLimitBps)}
            </span>
          </Ln>
        </div>
        <button className="btn btn-holo btn-lg btn-block" style={{ marginTop: 18 }} autoFocus onClick={() => ui.openModal(<SwapFlow q={q} m={m} side={side} />)}>
          Confirm swap
        </button>
      </div>
    </Modal>
  );
}

function SwapFlow({ q, m, side }: { q: QuoteResponse; m: Market; side: Side }) {
  const { d } = useDeployment();
  const { s, fmt } = useSettings();
  const ui = useUI();
  const qc = useQueryClient();
  const w = useWallet();
  const swap = useSwap({ router: d.paritas.swapRouter, usdg: d.usdg });
  const config = useConfig();
  const started = useRef(false);
  const buy = side === "buy";
  const payT = buy ? "USDG" : m.symbol;
  useEffect(() => {
    if (started.current) return; // never send twice (React dev mode re-runs effects)
    started.current = true;
    swap.run(q, payT).then(async (r) => {
      w.refetch();
      qc.invalidateQueries({ queryKey: ["fills"] });
      if (!r) return;
      // the receipt page can show this swap right away, before the indexer has stored it
      const block = await getBlock(config, { blockNumber: r.blockNumber });
      const row = routeRowFromReceipt(r, CHAIN_ID, Number(block.timestamp));
      qc.setQueryData(["fill", row.id], row);
      if (s.notif.fills) ui.toast("Swap settled", `${nf(units(r.buy ? r.amountOut : r.amountIn, 18), 4)} ${m.symbol} · ${fmt.cost(row.costBps)} from the share price`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const r = swap.receipt;
  const done = !!r;
  return (
    <Modal label="Swapping">
      {!done && <ModalHead title="Swapping" />}
      <div className="modal-b">
        {r ? (
          <Success
            coin={m.symbol}
            title="Swap settled"
            body={
              <>
                {r.buy ? "Bought" : "Sold"} {nf(units(r.buy ? r.amountOut : r.amountIn, 18), 4)} {m.symbol} for {nf(units(r.buy ? r.amountIn : r.amountOut + r.protocolFee, 6), 2)} USDG via{" "}
                {r.fills.length > 1 ? r.fills.map((f) => VENUES[f.venue].via).join(" and ") : VENUES[r.fills[0]?.venue ?? "vault"].via}.
                <br />
                <span className="muted" style={{ fontSize: 12.5 }}>
                  Block {nf(Number(r.blockNumber), 0)} · {short(r.txHash)}
                </span>
              </>
            }
            extra={
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <Link className="btn btn-line" href={`/app/activity?fill=${encodeURIComponent(`${CHAIN_ID}:${r.routeId}`)}`} data-close>
                  View receipt
                </Link>
                <button className="btn btn-holo" data-close>
                  Done
                </button>
              </div>
            }
          />
        ) : (
          <>
            <Steps steps={swap.steps} />
            {swap.error && <FlowError message={swap.error} />}
          </>
        )}
      </div>
    </Modal>
  );
}
