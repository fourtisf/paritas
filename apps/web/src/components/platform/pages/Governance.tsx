"use client";
/**
 * /app/governance (prototype pageGovernance). Pause state, timelock operations and the deploy block come from
 * GET /governance (indexed TimelockController events + ParamController.globalPaused); fees, session multipliers and
 * tier parameters from config/protocol.json via @paritas/shared (on-chain values only change through the timelock).
 */
import { decodeFunctionData } from "viem";
import { useBlock } from "wagmi";
import { paramControllerAbi, PROTOCOL, SESSION_COPY, SESSION_PARAMS, TIERS, type SessionName, type TierKey } from "@paritas/shared";
import { clamp, compact, dur, fmtPct, nf, short } from "@/lib/format";
import { useGovernance, type GovOp } from "@/hooks/data";
import { useChainNow } from "@/hooks/useChainNow";
import { useDeployment } from "../deployment";
import { useSettings } from "../settings";
import { Icon } from "../Icon";
import { SESS_COLOR, sessionMul } from "../session";
import { cssVar } from "../bits";

const TITLES: Record<string, string> = {
  setTier: "Change tier parameters",
  setSession: "Change session parameters",
  setFees: "Change fees",
  setMarket: "List or update a market",
  setRfqLimits: "Change maker quote limits",
  setOracleAges: "Change oracle age limits",
  setGuardian: "Change the guardian",
  unpauseAll: "Unpause swaps",
  unpauseMarket: "Unpause a market",
  transferOwnership: "Transfer ownership",
};

/** The API's title if it has one, else the ParamController call it schedules, in words. */
function opTitle(op: GovOp, paramController: string) {
  if (op.title) return op.title;
  if (op.target.toLowerCase() === paramController.toLowerCase()) {
    try {
      const { functionName } = decodeFunctionData({ abi: paramControllerAbi, data: op.data });
      return TITLES[functionName] ?? functionName;
    } catch {
      /* not a ParamController call */
    }
  }
  return `Timelock call to ${short(op.target)}`;
}

export function GovernancePage() {
  const { d, markets } = useDeployment();
  const g = useGovernance();
  const { fmt } = useSettings();
  const now = useChainNow(30_000) * 1000;
  const deployBlock = useBlock({ blockNumber: BigInt(d.paritas.deployedAtBlock || 0), query: { staleTime: Infinity } });
  const ops = g.data?.ops ?? [];
  const queued = ops.filter((o) => o.status === "scheduled" || o.status === "ready");
  const done = ops.filter((o) => o.status === "executed");
  const delayH = (g.data?.delaySec ?? PROTOCOL.governance.timelockDelaySec) / 3600;
  const paused = g.data?.paused === true;
  const fees = PROTOCOL.fees;
  return (
    <div className="page">
      <div className="ph">
        <div>
          <h1>Governance</h1>
          <p>Spreads, limits and fees only change through a public {nf(delayH, 0)}-hour timelock. The guardian can pause swaps and nothing else; deposits stay withdrawable no matter what.</p>
        </div>
      </div>
      <div className="strip">
        <div className="st">
          <b className={paused ? "down" : g.data ? "up" : ""} style={{ fontSize: 22 }}>
            {!g.data ? "–" : paused ? "Paused" : "Active"}
          </b>
          <span>{paused ? "Swaps, paused by the guardian" : "Swaps, guardian has not paused"}</span>
        </div>
        <div className="st">
          <b>
            {nf(delayH, 0)}
            <small>hours</small>
          </b>
          <span>Timelock on every change</span>
        </div>
        <div className="st">
          <b>
            {PROTOCOL.governance.multisigThreshold} of {PROTOCOL.governance.multisigSigners}
            <small>multisig</small>
          </b>
          <span>Owner, signers in the docs</span>
        </div>
        <div className="st">
          <b>{g.data ? queued.length : "–"}</b>
          <span>Changes waiting in public</span>
        </div>
      </div>
      <div className="grid g-2-1">
        <section className="panel">
          <div className="panel-h">
            <div>
              <div className="panel-t">Timeline</div>
              <div className="panel-s">Queued changes first, then history</div>
            </div>
          </div>
          <ol className="tl">
            {queued.map((o) => {
              const q = Date.parse(o.scheduledAt), eta = Date.parse(o.readyAt);
              const f = (now - q) / (eta - q);
              return (
                <li key={o.id}>
                  <span className="tl-i q">
                    <Icon n="clock" />
                  </span>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                      <div className="tl-t">{opTitle(o, d.paritas.paramController)}</div>
                      <span className="chip" style={cssVar("--c", "var(--lav)")}>
                        {eta > now ? "in " + dur(eta - now) : "Ready to execute"}
                      </span>
                    </div>
                    <div className="tl-d">Target {short(o.target)}</div>
                    <div className="prog">
                      <i style={{ width: `${clamp(f * 100, 0, 100)}%` }} />
                    </div>
                    <div className="tl-m">
                      <span>Queued {fmt.dt(q)}</span>
                      <span>Executable {fmt.dt(eta)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
            {done.map((o) => (
              <li key={o.id}>
                <span className="tl-i">
                  <Icon n="check" />
                </span>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div className="tl-t">{opTitle(o, d.paritas.paramController)}</div>
                    <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                      {fmt.date(Date.parse(o.executedAt ?? o.readyAt))}
                    </span>
                  </div>
                  <div className="tl-d">Executed through the timelock after {nf(delayH, 0)} hours in public.</div>
                </div>
              </li>
            ))}
            <li>
              <span className="tl-i">
                <Icon n="bolt" />
              </span>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div className="tl-t">Contracts deployed</div>
                  <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    {deployBlock.data ? fmt.date(Number(deployBlock.data.timestamp) * 1000) : "Block " + nf(d.paritas.deployedAtBlock, 0)}
                  </span>
                </div>
                <div className="tl-d">Router, vault factory, oracle router, RFQ settlement and parameter controller.</div>
              </div>
            </li>
          </ol>
        </section>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <section className="panel">
            <div className="panel-h">
              <div className="panel-t">Fees</div>
            </div>
            <div className="panel-b">
              <dl className="kv" style={{ margin: 0 }}>
                <div>
                  <dt>Protocol fee, every swap</dt>
                  <dd>{fees.protocolFeeBps} bps</dd>
                </div>
                <div>
                  <dt>Maker quote fee</dt>
                  <dd>{fees.rfqFeeBps} bps</dd>
                </div>
                <div>
                  <dt>Protocol share of vault spread</dt>
                  <dd>{nf(fees.spreadShareBps / 100, 0)}%</dd>
                </div>
                <div>
                  <dt>Deposit and withdraw fees</dt>
                  <dd>None</dd>
                </div>
              </dl>
            </div>
          </section>
          <section className="panel">
            <div className="panel-h">
              <div className="panel-t">Session multipliers</div>
            </div>
            <div className="panel-b">
              <dl className="kv" style={{ margin: 0 }}>
                {(Object.keys(SESSION_PARAMS) as SessionName[]).map((k) => {
                  const m = sessionMul(k);
                  return (
                    <div key={k}>
                      <dt style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="dot" style={cssVar("--c", SESS_COLOR[k])} />
                        {SESSION_COPY[k].label}
                      </dt>
                      <dd>{m ? `×${nf(m.mul, 1)} spread, ×${nf(m.clip, 2)} size` : "Vault paused"}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          </section>
        </div>
      </div>
      <section className="panel mt">
        <div className="panel-h">
          <div>
            <div className="panel-t">Parameters by tier</div>
            <div className="panel-s">Before session multipliers</div>
          </div>
        </div>
        <div className="t-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Markets</th>
                <th className="r">Base spread</th>
                <th className="r">Max inventory adjustment</th>
                <th className="r">Price limit</th>
                <th className="r">Largest vault order</th>
                <th className="r">Vault cap</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(TIERS) as TierKey[]).map((k) => {
                const t = TIERS[k];
                return (
                  <tr key={k}>
                    <td>
                      <b>Tier {k}</b>
                    </td>
                    <td className="t2">
                      {markets
                        .filter((m) => m.tier === k)
                        .map((m) => m.symbol)
                        .join(", ")}
                    </td>
                    <td className="r">{fmt.cost(t.halfSpreadBps)}</td>
                    <td className="r">{fmt.cost(t.skewBps)}</td>
                    <td className="r">{fmtPct(t.bandBps)}</td>
                    <td className="r num">{nf(t.clipUsd, 0)}</td>
                    <td className="r">{compact(t.capUsd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
