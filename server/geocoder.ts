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

// Last-error diagnostic surface. The /api/jobs/geocode-status route reads this
// so the operator can tell whether pins are missing because of a network
// egress problem, an empty result set, or a bad API key. Populated by every
// call; overwritten on success so it never lies about the current state.
export const geocoderStatus: {
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
  provider: "google" | "nominatim" | null;
} = {
  lastError: null,
  lastErrorAt: null,
  lastSuccessAt: null,
  provider: null,
};

function recordError(msg: string) {
  geocoderStatus.lastError = msg;
  geocoderStatus.lastErrorAt = new Date().toISOString();
  console.warn(`[geocoder] ${msg}`);
}
function recordSuccess(provider: "google" | "nominatim") {
  geocoderStatus.lastError = null;
  geocoderStatus.lastSuccessAt = new Date().toISOString();
  geocoderStatus.provider = provider;
}

// Google Maps geocoding — tried first when GOOGLE_MAPS_API_KEY is set.
// No rate limiting on the free tier (40k/mo), high-quality US results, and
// unlike Nominatim, Google will resolve strip-of-highway addresses that
// OSM has never seen.
async function geocodeViaGoogle(query: string): Promise<{ lat: number; lng: number } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_GEOCODING_API_KEY;
  if (!key) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", key);
  url.searchParams.set("region", "us");
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      recordError(`Google Maps HTTP ${res.status} for "${query}"`);
      return null;
    }
    const data: any = await res.json();
    if (data.status === "REQUEST_DENIED" || data.status === "INVALID_REQUEST") {
      recordError(`Google Maps: ${data.status} — ${data.error_message || "(no message)"}`);
      return null;
    }
    if (data.status === "ZERO_RESULTS") return null;
    if (data.status !== "OK") {
      recordError(`Google Maps status ${data.status} for "${query}"`);
      return null;
    }
    const loc = data.results?.[0]?.geometry?.location;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null;
    console.log(`[geocoder] google resolved "${query}" → ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`);
    return { lat: loc.lat, lng: loc.lng };
  } catch (err: any) {
    recordError(`Google Maps fetch failed for "${query}": ${err?.message || err}`);
    return null;
  }
}

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
  const cacheKey = normalize(rawAddress);
  if (!cacheKey) return null;
  const hit = cache.get(cacheKey);
  if (hit) return { lat: hit.lat, lng: hit.lng };

  // Try Google Maps first when GOOGLE_MAPS_API_KEY is set. Google isn't
  // subject to Nominatim's 1 req/sec throttle, so it's the fast path when
  // many jobs are entered back-to-back. Falls back to Nominatim on miss.
  const google = await geocodeViaGoogle(rawAddress);
  if (google) {
    cache.set(cacheKey, { lat: google.lat, lng: google.lng, at: Date.now() });
    recordSuccess("google");
    return google;
  }

  // Chain onto the shared queue so only one Nominatim HTTP call happens at
  // a time (their TOS requires <=1 req/sec).
  let resolve!: () => void;
  const gate = new Promise<void>(r => { resolve = r; });
  const prev = queue;
  queue = queue.then(() => gate);

  // Try the raw address first; if Nominatim returns zero hits, retry with
  // country hint appended. SC/GA residential addresses without ", USA" often
  // 0-hit because Nominatim assumes the caller knows the country.
  const attempts = [rawAddress];
  const upper = rawAddress.toUpperCase();
  if (!/UNITED STATES|\bUSA\b|\bUS\b/.test(upper)) attempts.push(`${rawAddress}, USA`);

  try {
    await prev;
    for (const query of attempts) {
      await throttle();
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", query);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      url.searchParams.set("addressdetails", "0");
      url.searchParams.set("countrycodes", "us");   // Titan's service area is US-only
      let res: Response;
      try {
        res = await fetch(url.toString(), {
          headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
        });
      } catch (fetchErr: any) {
        recordError(`Nominatim fetch failed for "${query}": ${fetchErr?.message || fetchErr}`);
        continue;
      }
      if (!res.ok) {
        recordError(`Nominatim HTTP ${res.status} for "${query}"`);
        continue;
      }
      let arr: Array<{ lat: string; lon: string }>;
      try {
        arr = await res.json() as any;
      } catch (jsonErr) {
        console.warn(`[geocoder] JSON parse failed for "${query}"`);
        continue;
      }
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const lat = parseFloat(arr[0].lat);
      const lng = parseFloat(arr[0].lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      cache.set(cacheKey, { lat, lng, at: Date.now() });
      recordSuccess("nominatim");
      console.log(`[geocoder] nominatim resolved "${rawAddress}" → ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      return { lat, lng };
    }
    recordError(`no results for "${rawAddress}" after ${attempts.length} attempt(s)`);
    return null;
  } catch (err: any) {
    recordError(`unexpected error for "${rawAddress}": ${err?.message || err}`);
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
      console.log(`[geocoder] saved job #${jobId} → ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);
    } catch (err: any) {
      console.warn(`[geocoder] DB write failed for job #${jobId}:`, err?.message || err);
    }
  })();
}
