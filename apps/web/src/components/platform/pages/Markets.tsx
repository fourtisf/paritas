"use client";
/**
 * /app/markets (prototype pageMarkets, stageCopy, tile, mountMarkets).
 * Markets and vaults: GET /markets. 24-hour totals, venue split and volume by hour: GET /stats.
 * "Best for $10k": a real POST /quote per market. Sparks: 1D candles.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { TIERS, type VenueId } from "@paritas/shared";
import { API_URL } from "@/lib/wagmi";
import { compact, fmtPct, nf } from "@/lib/format";
import { useCandles, useMarketMap, useStats, type MarketRow } from "@/hooks/data";
import type { QuoteResponse } from "@/hooks/useQuote";
import { useDeployment, type Market } from "../deployment";
import { useSettings } from "../settings";
import { useSess } from "../session";
import { Icon } from "../Icon";
import { Tok } from "../Tok";
import { BarsChart, Donut, Spark } from "../charts";
import { CoinCarousel } from "../three";
import { Chg, cssVar, LivePx, VENUES } from "../bits";

/** Which venue the router would use for a $10,000 buy right now (null: no route). */
function useBest10k(symbol: string) {
  const { s } = useSettings();
  return useQuery({
    queryKey: ["best10k", symbol, s.pref],
    refetchInterval: 30_000,
    queryFn: async (): Promise<VenueId | null> => {
      const r = await fetch(`${API_URL}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, side: "buy", amount: "10000", slippageBps: s.slip, venues: s.pref }) });
      if (!r.ok) throw new Error(await r.text());
      const q: QuoteResponse = await r.json();
      return q.ok ? q.mainVenue ?? null : null;
    },
  });
}

/** Tiles say "Vault" / "Uniswap" / "Market"; the featured card says "Vault" / "Uniswap pool" / "Market maker". */
const bestName = (v: VenueId) => VENUES[v].short;
const bestLong = (v: VenueId) => VENUES[v].name.replace("Paritas ", "").replace(/^./, (c) => c.toUpperCase());

function StageCopy({ m, row }: { m: Market; row?: MarketRow }) {
  const best = useBest10k(m.symbol);
  return (
    <>
      <div>
        <div className="stage-k">
          <span className="dot live" style={cssVar("--c", "var(--up)")} />
          Featured market
        </div>
        <div className="stage-sym">{m.symbol}</div>
        <div className="stage-name">
          {m.name} · Tier {m.tier}
        </div>
        <div className="stage-px">
          <LivePx v={row?.mid} />
          <span className="muted">USDG</span>
          {row && <Chg v={row.chg} />}
        </div>
        <div className="stage-meta">
          <div>
            Vault TVL<b>{row?.vault ? compact(row.vault.tvlUsd) : "Not open"}</b>
          </div>
          <div>
            Price limit<b>{fmtPct(TIERS[m.tier].bandBps)}</b>
          </div>
          <div>
            Best for $10k<b>{best.data ? bestLong(best.data) : "–"}</b>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Link className="btn btn-holo" href={`/app/trade?m=${m.symbol}`}>
          <Icon n="trade" />
          Trade {m.symbol}
        </Link>
        <span className="stage-hint">
          <Icon n="flip" />
          Drag the coins to browse
        </span>
      </div>
    </>
  );
}

function Tile({ m, row }: { m: Market; row?: MarketRow }) {
  const { fmt } = useSettings();
  const sess = useSess();
  const best = useBest10k(m.symbol);
  const day = useCandles(m.symbol, "1D");
  const vals = [...(day.data ?? []).map((p) => p.v), ...(row ? [row.mid] : [])];
  const t = TIERS[m.tier];
  const inv = row?.vault ? row.vault.tokenShareBps / 100 : 50;
  const status = !m.vault ? (
    <span className="chip">Second wave</span>
  ) : row?.vault?.open && sess.m ? (
    <span className="chip" style={cssVar("--c", "var(--up)")}>
      <span className="dot live" style={cssVar("--c", "var(--up)")} />
      Quoting {fmt.cost(t.halfSpreadBps * sess.m.mul)}
    </span>
  ) : (
    <span className="chip" style={cssVar("--c", "var(--warn)")}>
      <Icon n="pause" />
      Vault paused
    </span>
  );
  return (
    <Link className="tile" data-tilt href={`/app/trade?m=${m.symbol}`}>
      <span className="glare" />
      <div className="tile-h">
        <div className="mk">
          <Tok sym={m.symbol} />
          <div>
            <div className="mk-sym">{m.symbol}</div>
            <div className="mk-name">{m.name}</div>
          </div>
        </div>
        {status}
      </div>
      <div className="tile-px">
        <LivePx v={row?.mid} />
        {row && <Chg v={row.chg} style={{ fontSize: 13 }} />}
      </div>
      <Spark vals={vals} w={300} h={54} up={(row?.chg ?? 0) >= 0} fill />
      <div className="tile-f">
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {row?.vault ? (
            <>
              <span className="invbar" title={`Inventory ${nf(inv, 1)}% token`}>
                <i style={{ width: `${inv}%`, background: "#E6E6EA" }} />
                <i style={{ flex: 1, background: "#3A3A42" }} />
              </span>
              {compact(row.vault.tvlUsd)} TVL
            </>
          ) : (
            "Tier " + m.tier
          )}
        </span>
        <span>
          {best.data ? (
            <>
              Best: <b style={{ color: VENUES[best.data].hex, fontWeight: 650 }}>{bestName(best.data)}</b>
            </>
          ) : best.isLoading ? (
            "–"
          ) : (
            "No route"
          )}
        </span>
      </div>
    </Link>
  );
}

export function MarketsPage() {
  const router = useRouter();
  const { markets } = useDeployment();
  const { map, data: rows } = useMarketMap();
  const stats = useStats();
  const { fmt } = useSettings();
  const sess = useSess();
  const [focus, setFocus] = useState(() => Math.max(0, markets.findIndex((m) => m.symbol === "NVDAx")));
  const tvl = (rows ?? []).reduce((a, r) => a + (r.vault?.tvlUsd ?? 0), 0);
  const nVaults = (rows ?? []).filter((r) => r.vault && r.vault.tvlUsd > 0).length;
  const st = stats.data;
  const tot = st ? st.byVenue.vault + st.byVenue.pool + st.byVenue.rfq : 0;
  const frac = (k: VenueId) => (st && tot ? st.byVenue[k] / tot : 0);
  const fm = markets[focus] ?? markets[0];
  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Markets</h1>
          <p>Every Stock Token quotes around the Chainlink price of its share. Pick a market to trade, or see which venue is winning right now.</p>
        </div>
        <div className="ph-a">
          <Link className="btn btn-line" href="/app/activity">
            <Icon n="activity" />
            Activity
          </Link>
          <Link className="btn btn-holo" href="/app/trade">
            <Icon n="trade" />
            Trade
          </Link>
        </div>
      </div>
      <div className="strip">
        <div className="st">
          <b>
            {rows ? compact(tvl) : "–"}
            <small>USDG</small>
          </b>
          <span>Locked in {nVaults} vaults</span>
        </div>
        <div className="st">
          <b>
            {st ? compact(st.volumeUsd) : "–"}
            <small>USDG</small>
          </b>
          <span>Traded in 24 hours</span>
        </div>
        <div className="st">
          <b>{st ? nf(st.fills, 0) : "–"}</b>
          <span>Fills in 24 hours</span>
        </div>
        <div className="st">
          <b>{st ? fmt.cost(st.avgCostBps) : "–"}</b>
          <span>Average distance from share price</span>
        </div>
        <div className="st">
          <b style={{ fontSize: 20, display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`dot ${sess.session === "closed" ? "" : "live"}`} style={cssVar("--c", sess.color)} />
            {sess.copy.short}
          </b>
          <span>{sess.m ? "Vault spread ×" + nf(sess.m.mul, 1) : "Vaults paused"}</span>
        </div>
      </div>
      <section className="stage" aria-label="Featured market">
        <div className="stage-copy">
          <StageCopy m={fm} row={map?.get(fm.symbol)} />
        </div>
        <CoinCarousel syms={markets.map((m) => m.symbol)} start={focus} onFocus={setFocus} onPick={(i) => router.push(`/app/trade?m=${markets[i].symbol}`)} />
      </section>
      <div className="tiles">
        {markets.map((m) => (
          <Tile key={m.symbol} m={m} row={map?.get(m.symbol)} />
        ))}
      </div>
      <div className="grid g-2-1 mt">
        <section className="panel">
          <div className="panel-h">
            <div>
              <div className="panel-t">Volume by hour</div>
              <div className="panel-s">Last 24 hours, stacked by venue</div>
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
          <div className="panel-b">
            <BarsChart buckets={st?.hourly ?? []} h={230} fmtX={fmt.time} />
          </div>
        </section>
        <section className="panel">
          <div className="panel-h">
            <div>
              <div className="panel-t">Who filled the volume</div>
              <div className="panel-s">Share of 24-hour volume by venue</div>
            </div>
          </div>
          <div className="panel-b">
            <div className="donut-wrap">
              <Donut
                parts={[
                  { f: frac("vault"), c: "#F5F5F7" },
                  { f: frac("pool"), c: "#8A8A93" },
                  { f: frac("rfq"), c: "#6E8FB8" },
                ]}
                size={148}
                stroke={14}
                center={
                  <div>
                    <b style={{ fontSize: 16 }}>{st ? compact(tot) : "–"}</b>
                    <span>USDG</span>
                  </div>
                }
              />
              <ul className="vlist">
                {(["vault", "pool", "rfq"] as const).map((k) => (
                  <li key={k}>
                    <i style={cssVar("--c", VENUES[k].c)} />
                    <span>
                      {VENUES[k].name}
                      <small>{st ? compact(st.byVenue[k]) : "–"} USDG</small>
                    </span>
                    <b>{nf(frac(k) * 100, 0)}%</b>
                  </li>
                ))}
              </ul>
            </div>
            <div className="note note-lav">
              <span>
                <Icon n="shield" />
              </span>
              <span>The router fills at the best of the three, and no venue can settle outside the market&apos;s price limit.</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
