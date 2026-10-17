"use client";
/**
 * SVG charts from the prototype (areaChart, barsChart, spark, donut, ring), as React components.
 * Same geometry, classes and gradients; data comes from the API.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { clamp, compact, nf, sum } from "@/lib/format";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export interface Pt {
  t: number;
  v: number;
}

export function AreaChart(o: {
  pts: Pt[];
  h?: number;
  refV?: number;
  axis?: boolean;
  xlabels?: boolean;
  fmtX: (t: number) => string;
  fmtY?: (v: number) => string;
  label?: string;
  tip?: (p: Pt) => ReactNode;
  empty?: ReactNode;
}) {
  const [ref, cw] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gid = "a" + useId().replace(/:/g, "");
  const H = o.h ?? 300;
  const { pts } = o;
  if (!pts.length) {
    return (
      <div className="chart" ref={ref} style={{ height: H, display: "grid", placeItems: "center" }}>
        {o.empty ?? <p className="muted" style={{ margin: 0, fontSize: 13 }}>No price history yet.</p>}
      </div>
    );
  }
  const W = Math.max(260, cw);
  const pad = { l: 2, r: o.axis === false ? 2 : 60, t: 14, b: o.xlabels === false ? 4 : 26 };
  const vals = pts.map((p) => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const sp = hi - lo || hi * 0.01 || 1;
  lo -= sp * 0.18;
  hi += sp * 0.12;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const X = (i: number) => pad.l + (pts.length < 2 ? 0 : i / (pts.length - 1)) * iw;
  const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * ih;
  let d = "";
  pts.forEach((p, i) => (d += (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.v).toFixed(1)));
  const grid = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * (k + 0.5)) / 4);
  const n = W < 520 ? 3 : 5;
  const xl = [...new Set(Array.from({ length: n }, (_, k) => Math.round((k * (pts.length - 1)) / (n - 1))))];
  const lx = X(pts.length - 1), ly = Y(pts[pts.length - 1].v);
  const move = (clientX: number, svg: SVGSVGElement) => {
    const r = svg.getBoundingClientRect();
    setHover(clamp(Math.round(((clientX - r.left - pad.l) / iw) * (pts.length - 1)), 0, pts.length - 1));
  };
  const hx = hover != null ? X(hover) : 0, hy = hover != null ? Y(pts[hover].v) : 0;
  return (
    <div className="chart" ref={ref} style={{ height: H }} data-hover={hover != null ? "1" : undefined}>
      {cw > 0 && (
        <svg
          className="chart-svg"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={o.label ?? "Chart"}
          onMouseMove={(e) => move(e.clientX, e.currentTarget)}
          onTouchMove={(e) => move(e.touches[0].clientX, e.currentTarget)}
          onMouseLeave={() => setHover(null)}
          onTouchEnd={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFFFFF" stopOpacity=".14" />
              <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </linearGradient>
          </defs>
          {grid.map((v, k) => (
            <line key={k} x1={pad.l} x2={W - pad.r} y1={Y(v).toFixed(1)} y2={Y(v).toFixed(1)} className="gl" />
          ))}
          {o.refV != null && <line x1={pad.l} x2={W - pad.r} y1={Y(o.refV).toFixed(1)} y2={Y(o.refV).toFixed(1)} className="refl" />}
          <path d={`${d}L${lx.toFixed(1)} ${pad.t + ih}L${pad.l} ${pad.t + ih}Z`} fill={`url(#${gid})`} />
          <path d={d} fill="none" stroke="url(#holoH)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="9" fill="#FFFFFF" opacity=".14" />
          <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="3.5" fill="#FFFFFF" />
          {o.axis !== false &&
            grid.map((v, k) => (
              <text key={k} x={W - pad.r + 12} y={+Y(v).toFixed(1) + 4} className="axl">
                {o.fmtY ? o.fmtY(v) : nf(v)}
              </text>
            ))}
          {o.xlabels !== false &&
            xl.map((i, k) => (
              <text key={k} x={X(i).toFixed(1)} y={H - 6} textAnchor={k === 0 ? "start" : k === xl.length - 1 ? "end" : "middle"} className="axl">
                {o.fmtX(pts[i].t)}
              </text>
            ))}
          <line className="xh" y1={pad.t} y2={pad.t + ih} x1={hx} x2={hx} />
          <circle className="xd" r="4.5" cx={hx} cy={hy} fill="#F5F5F7" stroke="#050506" strokeWidth="2" />
        </svg>
      )}
      <div className="tip" style={hover != null ? { opacity: 1, left: clamp(hx, 80, W - 80), top: hy } : undefined}>
        {hover != null && (o.tip ? o.tip(pts[hover]) : nf(pts[hover].v))}
      </div>
    </div>
  );
}

export interface Bucket {
  t: number;
  v: [number, number, number]; // vault, pool, rfq
}

export function BarsChart({ buckets, h = 220, fmtX }: { buckets: Bucket[]; h?: number; fmtX: (t: number) => string }) {
  const [ref, cw] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(260, cw), H = h, pad = { l: 2, r: 54, t: 10, b: 26 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, n = buckets.length || 1;
  const max = Math.max(1, ...buckets.map((b) => sum(b.v, (x) => x))) * 1.12, colw = iw / n, bw = Math.max(3, colw * 0.58);
  const cols = ["#F5F5F7", "#8A8A93", "#6E8FB8"];
  return (
    <div className="chart" ref={ref} style={{ height: H }}>
      {cw > 0 && (
        <svg
          className="chart-svg"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Volume by hour"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHover(clamp(Math.floor((e.clientX - r.left - pad.l) / colw), 0, n - 1));
          }}
          onMouseLeave={() => setHover(null)}
        >
          <rect className="col-hl" x={hover != null ? pad.l + hover * colw : -100} y={pad.t} width={colw} height={ih} rx="6" />
          {[1, 2, 3].map((k) => {
            const v = (max * k) / 3.4, y = (pad.t + (1 - v / max) * ih).toFixed(1);
            return (
              <g key={k}>
                <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} className="gl" />
                <text x={W - pad.r + 12} y={+y + 4} className="axl">
                  {compact(v)}
                </text>
              </g>
            );
          })}
          {buckets.map((b, i) => {
            let y = pad.t + ih;
            const x = pad.l + i * colw + (colw - bw) / 2;
            return (
              <g key={i}>
                {b.v.map((val, j) => {
                  if (!val) return null;
                  const hh = (val / max) * ih;
                  y -= hh;
                  return <rect key={j} x={x.toFixed(1)} y={y.toFixed(1)} width={bw.toFixed(1)} height={Math.max(1, hh - 1.5).toFixed(1)} rx={Math.min(4, bw / 2).toFixed(1)} fill={cols[j]} />;
                })}
                {(i % 6 === 0 || i === n - 1) && (
                  <text x={(x + bw / 2).toFixed(1)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="axl">
                    {fmtX(b.t)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      <div className="tip" style={hover != null ? { opacity: 1, left: clamp(pad.l + hover * colw + colw / 2, 90, W - 90), top: pad.t + 20 } : undefined}>
        {hover != null && buckets[hover] && (
          <>
            <b>
              {fmtX(buckets[hover].t)} to {fmtX(buckets[hover].t + 36e5)}
            </b>
            <div className="row">
              <span style={{ color: "#F5F5F7" }}>Vault</span>
              <span>{compact(buckets[hover].v[0])}</span>
            </div>
            <div className="row">
              <span style={{ color: "#A3A3AC" }}>Uniswap</span>
              <span>{compact(buckets[hover].v[1])}</span>
            </div>
            <div className="row">
              <span style={{ color: "#8CA8CC" }}>Makers</span>
              <span>{compact(buckets[hover].v[2])}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function Spark({ vals, w = 96, h = 28, up = true, fill = false }: { vals: number[]; w?: number; h?: number; up?: boolean; fill?: boolean }) {
  const gid = "s" + useId().replace(/:/g, "");
  if (vals.length < 2) return <svg className="spark" width={fill ? "100%" : w} height={h} aria-hidden="true" />;
  const lo = Math.min(...vals), hi = Math.max(...vals), sp = hi - lo || 1, c = up ? "#5EF0B0" : "#FF6F8E";
  const d = vals.map((v, i) => (i ? "L" : "M") + ((i / (vals.length - 1)) * w).toFixed(1) + " " + (3 + (1 - (v - lo) / sp) * (h - 6)).toFixed(1)).join("");
  return (
    <svg className="spark" width={fill ? "100%" : w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      {fill && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={c} stopOpacity=".22" />
              <stop offset="1" stopColor={c} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d}L${w} ${h}L0 ${h}Z`} fill={`url(#${gid})`} />
        </>
      )}
      <path d={d} fill="none" stroke={c} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function Donut({ parts, size = 150, stroke = 16, center }: { parts: { f: number; c: string }[]; size?: number; stroke?: number; center?: ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {parts.map((p, i) => {
          const len = c * p.f;
          const el =
            len > 0 ? (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={p.c}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${Math.max(0, len - 6).toFixed(2)} ${c.toFixed(2)}`}
                strokeDashoffset={(-off - 3).toFixed(2)}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            ) : null;
          off += len;
          return el;
        })}
      </svg>
      <div className="ring-c">{center}</div>
    </div>
  );
}

export function Ring({ frac, size = 64, stroke = 5, color = "url(#holoG)", center }: { frac: number; size?: number; stroke?: number; color?: string; center?: ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(c * clamp(frac, 0.02, 1)).toFixed(2)} ${c.toFixed(2)}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          suppressHydrationWarning // session progress moves between the server render and hydration
        />
      </svg>
      {center && <div className="ring-c">{center}</div>}
    </div>
  );
}
