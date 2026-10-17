import { PrismaClient } from "@prisma/client";
export const db = new PrismaClient();

/** Prisma Decimal(78,0) -> bigint without float rounding. */
export const big = (d: { toFixed(): string } | null | undefined) => (d == null ? 0n : BigInt(d.toFixed()));
/** JSON-safe: bigint -> string, recursively. Use on every response that carries amounts. */
export const json = (x: unknown): unknown =>
  typeof x === "bigint" ? x.toString() : Array.isArray(x) ? x.map(json) : x && typeof x === "object" && !(x instanceof Date) && !("toFixed" in (x as any))
    ? Object.fromEntries(Object.entries(x as object).map(([k, v]) => [k, json(v)]))
    : x && typeof x === "object" && "toFixed" in (x as any) ? (x as any).toFixed() : x;
