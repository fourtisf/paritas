"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { marketBySymbol, MARKETS, type Deployment, type MarketConfig } from "@paritas/shared";

type Hex = `0x${string}`;

export interface Market extends MarketConfig {
  token: Hex;
  vault: Hex | null;
}

interface Ctx {
  d: Deployment;
  /** Listed markets with addresses, in config order. Logic is keyed by token address; symbols are for display. */
  markets: Market[];
  bySymbol(sym: string): Market | undefined;
  byToken(token: string): Market | undefined;
}

const DeploymentCtx = createContext<Ctx | null>(null);

export function DeploymentProvider({ deployment, children }: { deployment: Deployment; children: ReactNode }) {
  const value = useMemo(() => {
    const markets = MARKETS.filter((m) => deployment.stocks[m.symbol]).map((m) => ({
      ...m,
      token: deployment.stocks[m.symbol].token,
      vault: deployment.paritas.vaults[m.symbol] ?? null,
    }));
    const tokens = new Map(markets.map((m) => [m.token.toLowerCase(), m]));
    return {
      d: deployment,
      markets,
      bySymbol: (s: string) => (marketBySymbol(s) ? markets.find((m) => m.symbol === s) : undefined),
      byToken: (t: string) => tokens.get(t.toLowerCase()),
    };
  }, [deployment]);
  return <DeploymentCtx.Provider value={value}>{children}</DeploymentCtx.Provider>;
}

export function useDeployment() {
  const c = useContext(DeploymentCtx);
  if (!c) throw new Error("useDeployment outside DeploymentProvider");
  return c;
}
