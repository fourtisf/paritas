import { z } from "zod";

const Env = z.object({
  CHAIN_ID: z.coerce.number().refine((n) => [4663, 46630, 31337].includes(n), "CHAIN_ID must be 4663, 46630 or 31337"),
  RPC_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6379"),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  RFQ_MAKER_KEYS: z.string().default(""), // comma-separated API keys for maker websocket connections
  RFQ_WAIT_MS: z.coerce.number().default(700),
  INDEXER_BATCH_BLOCKS: z.coerce.number().default(2000),
  INDEXER_CONFIRMATIONS: z.coerce.number().default(2),
  // Reference prices for the website before a market is live (display only, lib/refPrices.ts). No key: off.
  FINNHUB_API_KEY: z.string().default(""),
  FINNHUB_URL: z.string().default("https://finnhub.io/api/v1"),
  FINNHUB_WS_URL: z.string().default("wss://ws.finnhub.io"),
  // Wallet verification (lib/eligibility.ts). The attester key signs EligibilityRegistry attestations: secret, never
  // committed. Its address is roles.attester in deployments/<chainId>.json. Empty: verification is off.
  ATTESTER_PRIVATE_KEY: z.string().regex(/^(0x[0-9a-fA-F]{64})?$/, "ATTESTER_PRIVATE_KEY must be 0x and 64 hex characters").default(""),
  GEOIP_DB: z.string().default(""), // country database (.mmdb), see lib/geo.ts
  // Proxies whose X-Forwarded-For is trusted for the client IP: only Nginx on this machine.
  TRUST_PROXY: z.string().default("127.0.0.1,::1"),
});

export const env = Env.parse(process.env);
