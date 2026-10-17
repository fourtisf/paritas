"use client";
/**
 * /app/activity (prototype pageActivity, exRow, receiptHTML). Every fill with its receipt.
 * Rows: GET /fills (server filters: market, venue, side, wallet) + the live stream. ?fill=<id> opens a receipt.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { isHolidayAt, HOLIDAY_COPY, SESSION_COPY, type VenueId } from "@paritas/shared";
import { ago, compact, nf, short, sum } from "@/lib/format";
import { toFill, useFill, useFills, type UIFill } from "@/hooks/data";
import { useChainNow } from "@/hooks/useChainNow";
import { useDeployment } from "../deployment";
import { useSettings } from "../settings";
import { Icon } from "../Icon";
import { Tok } from "../Tok";
import { cssVar, ExplorerButton, Ln, SideTxt, VenueChip, VENUES } from "../bits";
import { useLiveIds } from "../Shell";

const ADDR = /^0x[0-9a-f]{40}$/i;

export function Receipt({ f }: { f: UIFill | null | undefined }) {
  const { fmt } = useSettings();
  if (!f) {
    return (
      <div className="rc">
        <div className="foil" />
        <div className="rc-b">
          <p className="muted" style={{ margin: 0 }}>
            Select a fill to see its receipt.
          </p>
        </div>
      </div>
    );
  }
  const sessLabel = f.sess === "closed" && isHolidayAt(f.t / 1000) ? HOLIDAY_COPY.label : SESSION_COPY[f.sess].label;
  return (
    <div className="rc">
      <div className="foil" />
      <div className="rc-b">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Receipt · block <span className="num">{nf(f.block, 0)}</span>
            </div>
            <div className="rc-t">
              {f.side === "buy" ? "Bought" : "Sold"} {nf(f.qty, 4)} {f.sym}
            </div>
          </div>
          <Tok sym={f.sym} size="lg" />
        </div>
        <div className="perf" style={{ margin: "16px -20px" }} />
        <div className="lns">
          <Ln k="Route">
            {f.legs.length > 1 ? (
              <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {f.legs.map((l, i) => (
                  <VenueChip key={i} v={l.venue} />
                ))}
              </span>
            ) : (
              <VenueChip v={f.venue} />
            )}
          </Ln>
          <Ln k="Session">{sessLabel}</Ln>
          <Ln k="Share price (Chainlink)">
            <b className="num">{nf(f.mid)}</b>
          </Ln>
          {f.legs.length > 1
            ? f.legs.map((l, i) => (
                <Ln key={i} k={`${VENUES[l.venue].name}, ${compact(l.usd)} USDG`}>
                  <span className="num">{fmt.cost(l.cost, true)}</span>
                </Ln>
              ))
            : f.lines.map((l) => (
                <Ln key={l.label} k={l.label}>
                  <span className="num">{fmt.cost(l.bps, true)}</span>
                </Ln>
              ))}
          <Ln k="Fill price" cls="total">
            <b className="num">{nf(f.price)} USDG</b>
          </Ln>
          <Ln k={f.side === "buy" ? "Paid" : "Received"}>
            <span className="num">{nf(f.N, 2)} USDG</span>
          </Ln>
          <Ln k="Cost vs share price">
            <span className="num">{nf((f.N * f.cost) / 1e4, 2)} USDG</span>
          </Ln>
          <Ln k="Wallet">{f.mine ? "You" : <span className="num">{short(f.wallet)}</span>}</Ln>
          <Ln k="Time">{fmt.dt(f.t)}</Ln>
        </div>
        <ExplorerButton tx={f.tx} style={{ marginTop: 16 }} />
      </div>
    </div>
  );
}

export function ActivityPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { markets, byToken } = useDeployment();
  const { address } = useAccount();
  const { fmt } = useSettings();
  const now = useChainNow(15_000) * 1000;
  const live = useLiveIds();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [sym, setSym] = useState("all");
  const [venue, setVenue] = useState<"all" | VenueId>("all");
  const [side, setSide] = useState<"all" | "buy" | "sell">("all");
  const [limit, setLimit] = useState(30);
  const sel = params.get("fill");
  const receiptRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim().toLowerCase()), 220);
    return () => clearTimeout(t);
  }, [q]);

  const fills = useFills({
    symbol: sym === "all" ? undefined : sym,
    venue: venue === "all" ? undefined : venue,
    side: side === "all" ? undefined : side,
    trader: ADDR.test(dq) ? dq : undefined,
    limit,
  });
  const list = useMemo(
    () =>
      ((fills.data ?? []).map((r) => toFill(r, byToken, address)).filter(Boolean) as UIFill[]).filter(
        (f) => !dq || ADDR.test(dq) || f.tx.toLowerCase().includes(dq) || f.wallet.toLowerCase().includes(dq) || f.sym.toLowerCase().includes(dq),
      ),
    [fills.data, byToken, address, dq],
  );
  const inList = list.find((f) => f.id === sel);
  const one = useFill(sel && !inList ? sel : null);
  const selected = inList ?? (one.data ? toFill(one.data, byToken, address) : sel ? undefined : list[0]);
  const selId = selected?.id ?? null;
  const total = sum(list, (f) => f.N);

  const pick = (id: string) => {
    router.replace(`/app/activity?fill=${encodeURIComponent(id)}`, { scroll: false });
    if (window.innerWidth < 1100) receiptRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const reset = () => {
    setQ("");
    setDq("");
    setSym("all");
    setVenue("all");
    setSide("all");
    setLimit(30);
    router.replace("/app/activity", { scroll: false });
  };

  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Activity</h1>
          <p>Every fill on Paritas with its receipt: share price, each cost line, the venue and the block it settled in.</p>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {nf(list.length, 0)} fills · {compact(total)} USDG
        </div>
      </div>
      <div className="act">
        <section className="panel">
          <div className="filters">
            <div className="search" style={{ flex: 1, minWidth: 200, maxWidth: 320 }}>
              <Icon n="search" />
              <input className="input" placeholder="Transaction, wallet or market" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search fills" />
            </div>
            <select
              className="sel"
              aria-label="Market"
              value={sym}
              onChange={(e) => {
                setSym(e.target.value);
                setLimit(30);
              }}
            >
              <option value="all">All markets</option>
              {markets.map((m) => (
                <option key={m.symbol} value={m.symbol}>
                  {m.symbol}
                </option>
              ))}
            </select>
            <div className="seg" role="group" aria-label="Venue">
              {(
                [
                  ["all", "All"],
                  ["vault", "Vault"],
                  ["pool", "Uniswap"],
                  ["rfq", "Makers"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  aria-pressed={venue === k}
                  onClick={() => {
                    setVenue(k);
                    setLimit(30);
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Side">
              {(
                [
                  ["all", "Both"],
                  ["buy", "Buys"],
                  ["sell", "Sells"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  aria-pressed={side === k}
                  onClick={() => {
                    setSide(k);
                    setLimit(30);
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="t-wrap">
            {list.length ? (
              <table className="t">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Market</th>
                    <th>Side</th>
                    <th>Venue</th>
                    <th className="r">Size, USDG</th>
                    <th className="r">vs share</th>
                    <th>Wallet</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((f) => (
                    <tr key={f.id} className={`hov ${selId === f.id ? "is-sel" : ""} ${live.has(f.id) ? "flash" : ""}`} onClick={() => pick(f.id)}>
                      <td className="num">
                        <b style={{ fontWeight: 650 }}>{fmt.time(f.t)}</b>
                        <span className="sub">{ago(f.t, now)}</span>
                      </td>
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
                      <td className="r num">
                        <b>{nf(f.N, 2)}</b>
                      </td>
                      <td className="r num">{fmt.cost(f.cost, true)}</td>
                      <td>
                        {f.mine ? (
                          <span className="chip" style={cssVar("--c", "var(--lav)")}>
                            You
                          </span>
                        ) : (
                          <span className="t2 num">{short(f.wallet)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty" style={{ padding: 44 }}>
                <p>{fills.isError ? "Fills are unavailable right now." : fills.isLoading ? "Loading fills…" : "No fills match these filters."}</p>
                {!fills.isLoading && !fills.isError && (
                  <button className="btn btn-soft" onClick={reset}>
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </div>
          {(fills.data?.length ?? 0) >= limit && limit < 200 && (
            <div style={{ padding: 14, textAlign: "center", borderTop: "1px solid var(--line)" }}>
              <button className="btn btn-soft" onClick={() => setLimit((l) => Math.min(200, l + 30))}>
                Show 30 more
              </button>
            </div>
          )}
        </section>
        <aside className="receipt" ref={receiptRef}>
          {sel && !selected && one.isLoading ? (
            <div className="rc">
              <div className="foil" />
              <div className="rc-b">
                <p className="muted" style={{ margin: 0 }}>
                  Loading the receipt…
                </p>
              </div>
            </div>
          ) : (
            <Receipt f={selected} />
          )}
        </aside>
      </div>
    </div>
  );
}
