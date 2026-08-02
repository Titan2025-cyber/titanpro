// ─────────────────────────────────────────────────────────────────────────────
// Nominatim geocoder for the Service Area map on the dashboard.
//
// Design notes
// ─ Nominatim is free, no API key required, but has a strict 1 request/second
//   rate limit and requires a descriptive User-Agent. We serialize requests
//   through a queue that enforces >=1050ms between calls to stay well under.
// ─ Results are cached in-memory keyed on the normalized address so repeated
//   jobs at the same address don't re-hit the service.
// ─ Results are also persisted to the jobs table (latitude/longitude/geocodedAt)
//   so restarts don't force re-geocoding.
// ─ On error we return null; the caller records a null lat/lng and moves on.
//   The map simply skips jobs without coordinates.
// ─────────────────────────────────────────────────────────────────────────────

import type Database from "better-sqlite3";

const MIN_INTERVAL_MS = 1_050;         // Nominatim asks for <=1 req/sec
const USER_AGENT = "TitanPro/1.0 (Titan Restoration LLC; ops@titanaugusta.com)";

type CacheEntry = { lat: number; lng: number; at: number };
const cache = new Map<string, CacheEntry>();
let lastCallAt = 0;
let queue: Promise<void> = Promise.resolve();

function normalize(addr: string): string {
  return addr.replace(/\s+/g, " ").trim().toLowerCase();
}

async function throttle(): Promise<void> {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCallAt));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCallAt = Date.now();
}

/**
 * Look up lat/lng for a free-form address. Returns null when the address is
 * empty, the geocoder returns no results, or the network call fails.
 *
 * Requests are serialized so concurrent callers still respect the 1 req/sec
 * limit. The result is cached in-memory for the process lifetime.
 */
export async function geocodeAddress(rawAddress: string | null | undefined): Promise<{ lat: number; lng: number } | null> {
  if (!rawAddress) return null;
  const key = normalize(rawAddress);
  if (!key) return null;
  const hit = cache.get(key);
  if (hit) return { lat: hit.lat, lng: hit.lng };

  // Chain onto the shared queue so only one HTTP call happens at a time.
  let resolve!: () => void;
  const gate = new Promise<void>(r => { resolve = r; });
  const prev = queue;
  queue = queue.then(() => gate);

  try {
    await prev;
    await throttle();
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", rawAddress);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "0");
    const res = await fetch(url.toString(), { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" } });
    if (!res.ok) return null;
    const arr = await res.json() as Array<{ lat: string; lon: string }>;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const lat = parseFloat(arr[0].lat);
    const lng = parseFloat(arr[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    cache.set(key, { lat, lng, at: Date.now() });
    return { lat, lng };
  } catch {
    return null;
  } finally {
    resolve();
  }
}

/**
 * Fire-and-forget: geocode a job's address and, if successful, write the
 * coordinates back to the jobs row. Safe to call from the request handler
 * because it runs asynchronously and swallows all errors.
 */
export function geocodeJobInBackground(sqlite: Database.Database, jobId: number, address: string | null | undefined) {
  if (!address) return;
  (async () => {
    const coords = await geocodeAddress(address);
    if (!coords) return;
    try {
      sqlite.prepare(
        "UPDATE jobs SET latitude = ?, longitude = ?, geocoded_at = ? WHERE id = ?"
      ).run(coords.lat, coords.lng, new Date().toISOString(), jobId);
    } catch { /* schema race — ignore */ }
  })();
}
