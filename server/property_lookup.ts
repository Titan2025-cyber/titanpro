// ─────────────────────────────────────────────────────────────────────────────
// property_lookup.ts
//
// Free property-record lookup by street address using OpenStreetMap only.
//
// Pipeline:
//   1. Nominatim geocodes the address → lat/lon (existing throttled client).
//   2. Overpass API finds the closest building within ~40m and returns its
//      tags (start_date, building:levels) + geometry (for footprint area).
//   3. We derive:
//        yearBuilt  = tags.start_date parsed as YYYY (or first 4 digits)
//        squareFeet = footprint m² × levels × 10.7639 (m² → ft²)
//
// This is best-effort. Residential OSM data in South Carolina and Georgia is
// sparse — most single-family lots return no building tags. We surface a
// "source" hint so the UI can show "auto-filled" vs empty state truthfully
// and never silently fabricate data.
// ─────────────────────────────────────────────────────────────────────────────
import { geocodeAddress } from "./geocoder";

const USER_AGENT = "TitanPro-Restoration/1.0 (property lookup for job intake)";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const RADIUS_M = 40;
const REQUEST_TIMEOUT_MS = 8_000;

export interface PropertyLookupResult {
  yearBuilt: number | null;
  squareFeet: number | null;
  latitude: number | null;
  longitude: number | null;
  // "osm" when Overpass returned building tags we could parse;
  // "geocode" when we only found coordinates but no building data;
  // null when Nominatim couldn't resolve the address at all.
  source: "osm" | "geocode" | null;
  note: string;
}

function parseStartDateYear(tag: string | undefined | null): number | null {
  if (!tag) return null;
  const m = String(tag).match(/(\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  if (!Number.isFinite(y) || y < 1700 || y > new Date().getFullYear() + 1) return null;
  return y;
}

// Rough polygon area in m² (equirectangular projection, fine for < 1000 m²).
function polygonAreaM2(coords: Array<[number, number]>): number {
  if (coords.length < 3) return 0;
  const latRad = coords[0][0] * Math.PI / 180;
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * Math.cos(latRad);
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const [lat1, lon1] = coords[i];
    const [lat2, lon2] = coords[(i + 1) % coords.length];
    const x1 = lon1 * mPerDegLon;
    const y1 = lat1 * mPerDegLat;
    const x2 = lon2 * mPerDegLon;
    const y2 = lat2 * mPerDegLat;
    area += (x1 * y2 - x2 * y1);
  }
  return Math.abs(area) / 2;
}

export async function lookupProperty(address: string): Promise<PropertyLookupResult> {
  const empty: PropertyLookupResult = {
    yearBuilt: null, squareFeet: null, latitude: null, longitude: null,
    source: null, note: "",
  };

  const clean = (address || "").trim();
  if (!clean || clean.length < 6) {
    return { ...empty, note: "Address is too short to look up." };
  }

  const geo = await geocodeAddress(clean);
  if (!geo) {
    return { ...empty, note: "Could not locate this address on the map yet." };
  }

  const q = `[out:json][timeout:5];
    (
      way(around:${RADIUS_M},${geo.lat},${geo.lng})["building"];
      relation(around:${RADIUS_M},${geo.lat},${geo.lng})["building"];
    );
    out tags center geom;`;

  let ovData: any = null;
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const resp = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: "data=" + encodeURIComponent(q),
      signal: controller.signal,
    });
    clearTimeout(to);
    if (!resp.ok) throw new Error(`overpass ${resp.status}`);
    ovData = await resp.json();
  } catch (_e) {
    return {
      ...empty,
      latitude: geo.lat, longitude: geo.lng, source: "geocode",
      note: "Located on the map, but public building records didn't respond in time. Enter year built manually.",
    };
  }

  const elements: any[] = Array.isArray(ovData?.elements) ? ovData.elements : [];
  if (elements.length === 0) {
    return {
      ...empty,
      latitude: geo.lat, longitude: geo.lng, source: "geocode",
      note: "No building record found in public OpenStreetMap data. Enter year built manually.",
    };
  }

  function distanceSq(el: any): number {
    const c = el.center || (el.geometry && el.geometry[0]);
    if (!c) return Number.POSITIVE_INFINITY;
    const lat = c.lat ?? c[0];
    const lon = c.lon ?? c[1];
    if (typeof lat !== "number" || typeof lon !== "number") return Number.POSITIVE_INFINITY;
    const dLat = lat - geo.lat;
    const dLon = lon - geo.lng;
    return dLat * dLat + dLon * dLon;
  }
  elements.sort((a, b) => distanceSq(a) - distanceSq(b));
  const b = elements[0];
  const tags = b?.tags || {};

  const yearBuilt = parseStartDateYear(tags.start_date)
    || parseStartDateYear(tags["construction_date"])
    || parseStartDateYear(tags["year_built"]);

  let squareFeet: number | null = null;
  if (Array.isArray(b?.geometry) && b.geometry.length >= 3) {
    const coords: Array<[number, number]> = b.geometry
      .map((p: any) => [p.lat, p.lon] as [number, number])
      .filter(([lat, lon]) => typeof lat === "number" && typeof lon === "number");
    const areaM2 = polygonAreaM2(coords);
    const levels = Number(tags["building:levels"]) || 1;
    if (areaM2 > 8 && areaM2 < 5000) {
      squareFeet = Math.round(areaM2 * levels * 10.7639);
      if (squareFeet > 20_000) squareFeet = null;
    }
  }

  const parts: string[] = [];
  if (yearBuilt) parts.push(`year built ${yearBuilt}`);
  if (squareFeet) parts.push(`~${squareFeet.toLocaleString()} sq ft`);
  const note = parts.length
    ? `Auto-filled from OpenStreetMap (${parts.join(", ")}). Verify and edit if needed.`
    : "Located the property, but OpenStreetMap has no year or footprint on file. Enter manually.";

  return {
    yearBuilt: yearBuilt || null,
    squareFeet: squareFeet || null,
    latitude: geo.lat,
    longitude: geo.lng,
    source: (yearBuilt || squareFeet) ? "osm" : "geocode",
    note,
  };
}
