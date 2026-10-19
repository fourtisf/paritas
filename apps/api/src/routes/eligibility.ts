import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Hex } from "viem";
import { attestWallet, attesterAddress, relayFunded } from "../lib/eligibility";
import { geoReady } from "../lib/geo";

const Body = z.object({
  account: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  issuedAt: z.number().int().positive(), // the "Time:" line of the signed declaration
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

// A few attempts per address per 10 minutes is plenty for a person and slows down probing.
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 50_000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

export default async function eligibilityRoutes(app: FastifyInstance) {
  /** Whether verification is open here (the app hides the button otherwise), and whether Paritas pays the fee. */
  app.get("/eligibility", async () => ({ open: attesterAddress !== null, attester: attesterAddress, geo: geoReady(), free: await relayFunded() }));

  /** Declaration signature in, EligibilityRegistry attestation out (lib/eligibility.ts). */
  app.post("/eligibility/attest", async (req, reply) => {
    if (limited(req.ip)) return reply.code(429).send({ error: "rate limited", message: "Too many attempts. Try again in a few minutes." });
    const b = Body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad request", message: "Something went wrong. Start verification again." });
    const r = await attestWallet({ ip: req.ip, account: b.data.account, issuedAt: b.data.issuedAt, signature: b.data.signature as Hex });
    if (!r.ok) {
      req.log.info({ error: r.error, account: b.data.account }, "eligibility refused");
      return reply.code(r.status).send({ error: r.error, message: r.message });
    }
    req.log.info({ account: r.attestation.account, country: r.country, txHash: r.txHash, alreadyVerified: r.alreadyVerified }, "eligibility granted");
    return { ...r.attestation, txHash: r.txHash, alreadyVerified: r.alreadyVerified };
  });
}
