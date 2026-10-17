import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Redis } from "ioredis";
import { env } from "./lib/env";
import { registerMaker } from "./lib/rfq";
import { deployment } from "./lib/chain";
import quoteRoutes from "./routes/quote";
import readRoutes from "./routes/read";

const app = Fastify({ logger: true });

// Until deployments/<chainId>.json has real addresses (mainnet before launch), endpoints that need them answer 503
// and /markets is empty. Say so once at startup instead of in every request log.
const NOT_DEPLOYED = /^deployments\/\d+\.json: /;
deployment().catch((e: Error) => app.log.error(`Paritas is not deployed on chain ${env.CHAIN_ID} yet: ${e.message}`));
app.setErrorHandler((err, _req, reply) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (NOT_DEPLOYED.test(msg)) return reply.code(503).send({ error: "not deployed", detail: msg });
  reply.send(err);
});
await app.register(cors, { origin: env.CORS_ORIGINS.split(",") });
await app.register(websocket);
await app.register(readRoutes);
await app.register(quoteRoutes);

// Live stream for the app: new fills and session changes, published by the indexer on Redis.
const sub = new Redis(env.REDIS_URL);
const clients = new Set<{ send(s: string): void; readyState: number }>();
await sub.subscribe("paritas:fills", "paritas:session");
sub.on("message", (channel, message) => {
  for (const c of clients) if (c.readyState === 1) c.send(JSON.stringify({ channel, data: JSON.parse(message) }));
});

app.register(async (scope) => {
  scope.get("/stream", { websocket: true }, (socket) => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
  });
  scope.get("/makers", { websocket: true }, (socket, req) => {
    const key = new URL(req.url, "http://x").searchParams.get("key") ?? "";
    if (!registerMaker(socket as any, key)) socket.close();
  });
});

await app.listen({ port: env.PORT, host: "0.0.0.0" });
