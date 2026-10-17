import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { Redis } from "ioredis";
import { env } from "./lib/env";
import { registerMaker } from "./lib/rfq";
import quoteRoutes from "./routes/quote";
import readRoutes from "./routes/read";

const app = Fastify({ logger: true });
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
