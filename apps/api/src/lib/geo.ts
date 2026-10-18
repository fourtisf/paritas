import { readFileSync, statSync } from "node:fs";
import { Reader, type CountryResponse } from "mmdb-lib";
import { env } from "./env";

/**
 * Country (ISO 3166 alpha-2) of an IP address, from a MaxMind-format country database at GEOIP_DB: DB-IP "IP to
 * Country Lite" (free, CC BY 4.0) or GeoLite2 Country. deploy/geoip.sh downloads it and refreshes it monthly; the file
 * is re-read when it changes. null when there is no database, or the address is private or not in it.
 */
let reader: Reader<CountryResponse> | null = null;
let mtime = 0;
let checkedAt = 0;

function current(): Reader<CountryResponse> | null {
  if (!env.GEOIP_DB) return null;
  if (Date.now() - checkedAt < 60_000) return reader;
  checkedAt = Date.now();
  try {
    const m = statSync(env.GEOIP_DB).mtimeMs;
    if (m !== mtime) {
      reader = new Reader<CountryResponse>(readFileSync(env.GEOIP_DB));
      mtime = m;
    }
  } catch {
    reader = null;
    mtime = 0;
  }
  return reader;
}

export function geoReady() {
  return current() !== null;
}

export function countryOf(ip: string): string | null {
  const r = current();
  if (!r) return null;
  try {
    const rec = r.get(ip.replace(/^::ffff:/, ""));
    return rec?.country?.iso_code ?? rec?.registered_country?.iso_code ?? null;
  } catch {
    return null; // not an IP address
  }
}
