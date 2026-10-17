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
});

export const env = Env.parse(process.env);
