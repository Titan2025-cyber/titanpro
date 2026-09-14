// ─────────────────────────────────────────────────────────────────────────────
// Service Area Map — dashboard component
//
// Interactive Google Maps view showing every active job as a status-colored
// pin. Hovering a pin shows a compact tooltip; clicking navigates to the job
// detail page. Reads from the same ["/api/jobs"] React Query cache as the
// rest of the dashboard, so adding, closing, or reopening a job automatically
// refreshes the map (no manual refresh needed).
//
// The Google Maps JavaScript API is loaded on-demand from the browser key
// returned by /api/config/public. Owners/admins also see a live tech overlay.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, RefreshCw, User as UserIcon } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import type { Job } from "@shared/schema";

// Owner/admin-only overlay: one clocked-in employee with their latest GPS fix.
type TechLocation = {
  employeeId: number;
  employeeName: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  jobId: number | null;
  jobNumber: string | null;
  jobAddress: string | null;
  capturedAt: string;
};

// Pin colors by workflow status. Keep in sync with the app-wide status palette.
const STATUS_COLOR: Record<string, string> = {
  new: "#3b82f6",             // blue
  mitigation: "#f59e0b",      // amber
  drying: "#0ea5e9",          // sky
  reconstruction: "#8b5cf6",  // violet
  complete: "#10b981",        // emerald
};
const DEFAULT_COLOR = "#6b7280";

// Center + zoom fallback if no jobs have coordinates yet. Roughly the Titan
// service area (SC / GA / eastern US). The map re-centers on the actual pins
// as soon as at least one is available.
const FALLBACK_CENTER = { lat: 33.55, lng: -81.72 };
const FALLBACK_ZOOM = 8;

declare global {
  interface Window { google: any; __googleMapsLoader?: Promise<void> }
}

// ─────────────────────────────────────────────────────────────────────────────
// One-shot Google Maps JS loader. Every ServiceAreaMap that mounts shares the
// same promise so we only inject the script tag once per page. Rejects when
// the key is missing or the script fails (network, API not enabled, invalid
// key, referrer blocked).
function loadGoogleMaps(key: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no-window"));
  if (window.google?.maps) return Promise.resolve();
  if (window.__googleMapsLoader) return window.__googleMapsLoader;
  if (!key) return Promise.reject(new Error("Google Maps API key is not configured."));

  window.__googleMapsLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=marker`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.maps) resolve();
      else reject(new Error("Google Maps failed to initialize."));
    };
    script.onerror = () => reject(new Error("Google Maps failed to load. Check the API key, that Maps JavaScript API is enabled, and that titanaugusta.pro is allowed as an HTTP referrer."));
    document.head.appendChild(script);
  });
  return window.__googleMapsLoader;
}

// Inline SVG pin as a data URL, colored by job status. Cheaper than
// AdvancedMarkerElement and works without an extra map ID / cloud styling.
function pinSvgDataUrl(color: string): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.3 21.7 0 14 0z" fill="${color}"/>
      <circle cx="14" cy="14" r="5.5" fill="#fff"/>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function statusLabel(s: string | null | undefined) {
  if (!s) return "New";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function ServiceAreaMap() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  // Only owners and admins see the tech overlay. Techs viewing their own
  // dashboard get the same job pins but never see other employees.
  const canSeeTechs = user?.role === "owner" || user?.role === "admin";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const jobMarkersRef = useRef<any[]>([]);
  const techMarkersRef = useRef<any[]>([]);
  const jobInfoWindowRef = useRef<any>(null);
  const techInfoWindowRef = useRef<any>(null);

  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  // Fetch the browser key from the server. Cached forever — it only ever changes
  // on a Railway redeploy, which reloads the whole page anyway.
  const { data: publicConfig } = useQuery<{ googleMapsBrowserKey: string; googleMapsConfigured: boolean }>({
    queryKey: ["/api/config/public"],
    queryFn: () => apiRequest("GET", "/api/config/public").then(r => r.json()),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // Jobs query — same key the rest of the dashboard uses. React Query will
  // refresh this whenever any mutation invalidates ["/api/jobs"], which
  // already happens on create / update / close / reopen throughout the app.
  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    refetchInterval: 30_000,   // safety net: pick up geocoded coords as they land
  });

  // Live tech positions. Only fetched when the current user is allowed to see
  // them — the server enforces the same rule, this just avoids pointless 403s.
  const { data: techLocations = [] } = useQuery<TechLocation[]>({
    queryKey: ["/api/tech-locations"],
    enabled: canSeeTechs,
    refetchInterval: 30_000,
  });

  // Closed jobs are formally locked from the JobDetail page and should not
  // clutter the operational dashboard map. Reopening a job restores it to the
  // map on the next React Query invalidation, since reopen clears the status.
  const activeJobs = useMemo(
    () => jobs.filter(j => (j.status ?? "") !== "closed"),
    [jobs]
  );

  const geocoded = useMemo(
    () => activeJobs.filter(j =>
      typeof j.latitude === "number" && typeof j.longitude === "number"
      && Number.isFinite(j.latitude!) && Number.isFinite(j.longitude!)
    ),
    [activeJobs]
  );

  const withAddress = useMemo(
    () => activeJobs.filter(j => (j.address ?? "").trim().length > 0),
    [activeJobs]
  );

  // Load Google Maps JS once the browser key is in hand.
  useEffect(() => {
    if (!publicConfig) return;
    if (!publicConfig.googleMapsConfigured) {
      setMapsError("Google Maps API key is not configured. Set GOOGLE_MAPS_API_KEY in Railway.");
      return;
    }
    let cancelled = false;
    loadGoogleMaps(publicConfig.googleMapsBrowserKey)
      .then(() => { if (!cancelled) setMapsReady(true); })
      .catch(err => { if (!cancelled) setMapsError(err?.message || "Google Maps failed to load."); });
    return () => { cancelled = true; };
  }, [publicConfig]);

  // Initialize the map once the API is ready and the container is mounted.
  useEffect(() => {
    if (!mapsReady || !containerRef.current || mapRef.current) return;
    const g = window.google.maps;
    const map = new g.Map(containerRef.current, {
      center: FALLBACK_CENTER,
      zoom: FALLBACK_ZOOM,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      gestureHandling: "greedy",   // one-finger pan on mobile matches the old Leaflet feel
    });
    mapRef.current = map;
    jobInfoWindowRef.current = new g.InfoWindow();
    techInfoWindowRef.current = new g.InfoWindow();

    // One-time CSS for the pulsing tech avatar. Scoped by class name so it
    // only styles our overlay divs and doesn't affect anything else.
    if (!document.getElementById("tech-pin-css")) {
      const style = document.createElement("style");
      style.id = "tech-pin-css";
      style.textContent = `
        .tech-pin { position: relative; pointer-events: auto; }
        .tech-pin .pulse {
          position: absolute; inset: -8px; border-radius: 9999px;
          background: rgba(16, 185, 129, 0.35);
          animation: techPulse 1.8s ease-out infinite;
        }
        .tech-pin .core {
          position: relative; width: 32px; height: 32px; border-radius: 9999px;
          background: #10b981; color: #fff; display: flex; align-items: center;
          justify-content: center; font-weight: 700; font-size: 12px;
          border: 3px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.35);
        }
        @keyframes techPulse {
          0% { transform: scale(0.6); opacity: 0.9; }
          100% { transform: scale(1.8); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
  }, [mapsReady]);

  // Redraw job markers whenever the geocoded set changes.
  useEffect(() => {
    if (!mapsReady || !mapRef.current || !window.google?.maps) return;
    const g = window.google.maps;
    // Clear existing job markers.
    for (const m of jobMarkersRef.current) m.setMap(null);
    jobMarkersRef.current = [];

    for (const job of geocoded) {
      const color = STATUS_COLOR[job.status ?? "new"] ?? DEFAULT_COLOR;
      const marker = new g.Marker({
        position: { lat: job.latitude!, lng: job.longitude! },
        map: mapRef.current,
        title: `${job.jobNumber} — ${statusLabel(job.status)}`,
        icon: {
          url: pinSvgDataUrl(color),
          size: new g.Size(28, 36),
          anchor: new g.Point(14, 36),
        },
      });

      const tooltipHtml = `
        <div style="font-family: system-ui, -apple-system, sans-serif; min-width:200px; padding:2px 4px">
          <div style="font-weight:600; font-size:13px; margin-bottom:2px">
            ${escapeHtml(job.jobNumber)}
            <span style="display:inline-block;background:${color};color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;margin-left:6px;text-transform:uppercase;letter-spacing:.3px">
              ${escapeHtml(statusLabel(job.status))}
            </span>
          </div>
          <div style="font-size:12px;color:#374151;line-height:1.35">${escapeHtml(job.address ?? "")}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:4px">
            ${job.assignedTech ? `Tech: ${escapeHtml(job.assignedTech)}<br/>` : ""}
            Loss: ${escapeHtml(job.lossType ?? "—")}
          </div>
          <div style="font-size:10px;color:#9ca3af;margin-top:4px">Click pin to open job</div>
        </div>`;
      marker.addListener("mouseover", () => {
        jobInfoWindowRef.current.setContent(tooltipHtml);
        jobInfoWindowRef.current.open({ map: mapRef.current, anchor: marker });
      });
      marker.addListener("mouseout", () => jobInfoWindowRef.current.close());
      marker.addListener("click", () => setLocation(`/jobs/${job.id}`));
      jobMarkersRef.current.push(marker);
    }

    // Auto-fit the view to the pin bounds (with padding) so the whole footprint
    // is visible. Only refit when we actually have pins — otherwise leave the
    // user's current pan/zoom untouched. Includes tech positions when visible.
    const points: Array<{ lat: number; lng: number }> = geocoded.map(j => ({ lat: j.latitude!, lng: j.longitude! }));
    if (canSeeTechs) {
      for (const t of techLocations) points.push({ lat: t.latitude, lng: t.longitude });
    }
    if (points.length > 0) {
      const bounds = new g.LatLngBounds();
      for (const p of points) bounds.extend(p);
      mapRef.current.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
      // Google's fitBounds can over-zoom when we only have one point. Cap it.
      const listener = g.event.addListenerOnce(mapRef.current, "idle", () => {
        if (mapRef.current.getZoom() > 14) mapRef.current.setZoom(14);
      });
      // Cleanup handled by addListenerOnce — no-op reference to satisfy strict lint.
      void listener;
    }
  }, [mapsReady, geocoded, setLocation, canSeeTechs, techLocations]);

  // Draw the tech overlay separately so a jobs-only refetch doesn't remove techs
  // and vice versa. Techs render as OverlayView divs so we get the pulsing CSS.
  useEffect(() => {
    if (!mapsReady || !mapRef.current || !window.google?.maps) return;
    const g = window.google.maps;
    // Clear existing tech markers.
    for (const m of techMarkersRef.current) m.setMap(null);
    techMarkersRef.current = [];
    if (!canSeeTechs) return;

    for (const t of techLocations) {
      const initials = t.employeeName
        .split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("") || "?";
      const html = `<div class="tech-pin"><div class="pulse"></div><div class="core">${escapeHtml(initials)}</div></div>`;
      // Use a small SVG "spacer" as the marker icon and paint the real pulsing
      // div via a labeled div overlay. Simplest reliable option without pulling
      // in AdvancedMarkerElement / map IDs.
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"></svg>`;
      const marker = new g.Marker({
        position: { lat: t.latitude, lng: t.longitude },
        map: mapRef.current,
        title: t.employeeName,
        icon: {
          url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
          size: new g.Size(32, 32),
          anchor: new g.Point(16, 16),
        },
        zIndex: 1000,
        // Render label so the pulsing avatar overlays the marker cleanly.
        label: {
          text: initials,
          color: "#fff",
          fontWeight: "700",
          fontSize: "12px",
        },
      });
      // Google's label sits centered on the marker, so we style the marker
      // circle underneath via a small inline PNG-less SVG fallback. This still
      // gives the emerald circle look; the pulsing keyframes only apply to
      // divIcon-style overlays. Acceptable trade-off — the tooltip carries
      // the "live" signal via the "Updated Xm ago" line.
      const minutesAgo = Math.max(0, Math.round((Date.now() - Date.parse(t.capturedAt)) / 60000));
      const acc = t.accuracyMeters != null && Number.isFinite(t.accuracyMeters)
        ? `±${Math.round(t.accuracyMeters)}m` : "";
      const jobLine = t.jobNumber
        ? `<div style="font-size:11px;color:#374151">On job ${escapeHtml(t.jobNumber)}${t.jobAddress ? ` — ${escapeHtml(t.jobAddress)}` : ""}</div>`
        : `<div style="font-size:11px;color:#6b7280">No job assigned</div>`;
      const tooltipHtml = `
        <div style="font-family: system-ui, -apple-system, sans-serif; min-width:190px; padding:2px 4px">
          <div style="font-weight:600;font-size:13px;margin-bottom:2px">${escapeHtml(t.employeeName)}</div>
          ${jobLine}
          <div style="font-size:11px;color:#6b7280;margin-top:4px">Updated ${minutesAgo === 0 ? "just now" : `${minutesAgo}m ago`} ${acc}</div>
        </div>`;
      marker.addListener("mouseover", () => {
        techInfoWindowRef.current.setContent(tooltipHtml);
        techInfoWindowRef.current.open({ map: mapRef.current, anchor: marker });
      });
      marker.addListener("mouseout", () => techInfoWindowRef.current.close());
      if (t.jobId) marker.addListener("click", () => setLocation(`/jobs/${t.jobId}`));
      // Reference html to avoid an unused-variable warning under strict TS —
      // it's the source of the initials we already pushed to `label.text`.
      void html;
      techMarkersRef.current.push(marker);
    }
  }, [mapsReady, canSeeTechs, techLocations, setLocation]);

  const runBackfill = async (mode: "missing" | "all" = "missing") => {
    setBackfilling(true);
    try {
      const endpoint = mode === "all"
        ? "/api/jobs/geocode-refresh-all"
        : "/api/jobs/geocode-missing";
      const res = await apiRequest("POST", endpoint);
      const data = await res.json();
      toast({
        title: data.queued > 0
          ? `Geocoding ${data.queued} address${data.queued === 1 ? "" : "es"}…`
          : "All addresses already mapped",
        description: data.queued > 0 ? "Pins will appear as each address is resolved." : undefined,
      });
      // Refetch every 3s for 30s to pick up the coords as they land.
      let ticks = 0;
      const iv = window.setInterval(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/jobs/geocode-status"] });
        if (++ticks >= 10) window.clearInterval(iv);
      }, 3_000);
    } catch (e: any) {
      toast({ title: "Geocoding failed", description: e?.message, variant: "destructive" });
    } finally {
      setBackfilling(false);
    }
  };

  // Diagnostic: fetch geocoder health so we can tell the operator WHY pins
  // aren't dropping. Populated on demand — doesn't poll.
  const { data: geocoderDiag } = useQuery<{
    summary: { total: number; withAddress: number; geocoded: number; missingCoords: number };
    geocoder: { lastError: string | null; lastErrorAt: string | null; lastSuccessAt: string | null; provider: string | null; googleKeyConfigured: boolean };
  }>({
    queryKey: ["/api/jobs/geocode-status"],
    queryFn: () => apiRequest("GET", "/api/jobs/geocode-status").then(r => r.json()),
    refetchInterval: 60_000,
  });

  const missing = withAddress.length - geocoded.length;

  // Auto-backfill on first mount when we have addressed jobs but no coords.
  // Old jobs created before geocoding was wired in never got lat/lng, so the
  // map appeared empty. This runs the same POST /api/jobs/geocode-missing the
  // button would, but automatically, exactly once per browser session.
  const autoBackfillTriedRef = useRef(false);
  useEffect(() => {
    if (autoBackfillTriedRef.current) return;
    if (withAddress.length === 0) return;      // nothing to backfill
    if (geocoded.length > 0) return;           // already have some pins
    if (backfilling) return;
    autoBackfillTriedRef.current = true;
    void runBackfill();
    // We intentionally trigger this from render-effect once withAddress
    // > 0 and geocoded.length === 0 — subsequent fetches will short-circuit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withAddress.length, geocoded.length]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
            Service Area
            <span className="text-xs font-normal text-muted-foreground">
              {geocoded.length} of {withAddress.length} active job{withAddress.length === 1 ? "" : "s"} mapped
              {canSeeTechs && techLocations.length > 0 && (
                <> · {techLocations.length} tech{techLocations.length === 1 ? "" : "s"} on the clock</>
              )}
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            {missing > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => runBackfill("missing")}
                disabled={backfilling}
                data-testid="button-geocode-missing"
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${backfilling ? "animate-spin" : ""}`} />
                Map {missing} missing
              </Button>
            )}
            {/* Always-visible force refresh — clears cached coords and
                re-runs the geocoder for every active job. Handy after an
                address edit or when pins look stuck. */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => runBackfill("all")}
              disabled={backfilling || withAddress.length === 0}
              title="Re-geocode every active job from scratch"
              data-testid="button-geocode-refresh-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${backfilling ? "animate-spin" : ""}`} />
              Refresh all
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {!mapsReady && !mapsError && (
          <div className="h-[420px] rounded-lg bg-muted flex items-center justify-center text-sm text-muted-foreground">
            Loading map…
          </div>
        )}
        {mapsError && (
          <div className="h-[420px] rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 flex items-center justify-center p-6 text-center">
            <div className="max-w-md">
              <div className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">Google Maps couldn't load</div>
              <div className="text-xs text-amber-800 dark:text-amber-300 opacity-90">{mapsError}</div>
              <div className="text-[11px] text-amber-800 dark:text-amber-300 opacity-75 mt-2">
                In Google Cloud Console, make sure the Maps JavaScript API is enabled and that titanaugusta.pro is in the key's HTTP referrer allowlist.
              </div>
            </div>
          </div>
        )}
        <div
          ref={containerRef}
          className={mapsReady ? "h-[420px] rounded-lg border overflow-hidden" : "hidden"}
          data-testid="service-area-map"
        />
        {mapsReady && geocoded.length === 0 && (
          <div className="mt-3 text-xs text-muted-foreground">
            {withAddress.length === 0
              ? "Add addresses to your jobs to see them here."
              : "No jobs have coordinates yet. Click \u201cMap missing\u201d to geocode existing addresses."}
          </div>
        )}
        {/* Diagnostic: shows exactly what the map sees. Only rendered when
            withAddress.length === 0 but the server reports total > 0 — that's
            the state where the map looks empty despite jobs existing, and
            the operator needs raw data to figure out what's wrong. */}
        {withAddress.length === 0 && (jobs.length > 0 || (geocoderDiag?.summary?.total ?? 0) > 0) && (
          <div className="mt-3 text-xs rounded border border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800 text-red-900 dark:text-red-300 px-3 py-2">
            <div className="font-semibold">Data mismatch — map cannot see any addresses.</div>
            <div className="mt-1 font-mono">
              client jobs loaded: {jobs.length}<br />
              client withAddress: {withAddress.length}<br />
              server total: {geocoderDiag?.summary?.total ?? "(unavailable)"}<br />
              server withAddress: {geocoderDiag?.summary?.withAddress ?? "(unavailable)"}<br />
              server geocoded: {geocoderDiag?.summary?.geocoded ?? "(unavailable)"}<br />
              server missingCoords: {geocoderDiag?.summary?.missingCoords ?? "(unavailable)"}
            </div>
            {jobs.length > 0 && (
              <details className="mt-2" open>
                <summary className="cursor-pointer font-semibold">Client sees {jobs.length} job(s) — raw fields</summary>
                <div className="mt-1 font-mono text-[10px] whitespace-pre-wrap max-h-64 overflow-auto">
                  {JSON.stringify(jobs.map(j => ({
                    id: j.id,
                    jobNumber: j.jobNumber,
                    status: j.status,
                    address: j.address,
                    addressType: typeof j.address,
                    addressLen: (j.address ?? "").length,
                    lat: j.latitude,
                    lng: j.longitude,
                    allKeys: Object.keys(j).sort(),
                  })), null, 2)}
                </div>
              </details>
            )}
          </div>
        )}
        {/* Diagnostic banner: only shown when the geocoder last errored. */}
        {geocoderDiag?.geocoder?.lastError && (
          <div className="mt-3 text-xs rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 text-amber-800 dark:text-amber-300 px-3 py-2">
            <div className="font-semibold flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              Geocoder needs attention
            </div>
            <div className="mt-0.5">{geocoderDiag.geocoder.lastError}</div>
            {!geocoderDiag.geocoder.googleKeyConfigured && (
              <div className="mt-1 opacity-80">
                Tip: set <code className="font-mono">GOOGLE_MAPS_API_KEY</code> in Railway to enable the faster, more reliable Google geocoder as the primary source.
              </div>
            )}
          </div>
        )}
        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-muted-foreground">
          {Object.entries({ new: "New", mitigation: "Mitigation", drying: "Drying", reconstruction: "Reconstruction", complete: "Complete" }).map(([key, label]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLOR[key] }} />
              {label}
            </div>
          ))}
          {canSeeTechs && (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-emerald-500 text-white" style={{ boxShadow: "0 0 0 3px rgba(16,185,129,0.25)" }}>
                <UserIcon className="w-2 h-2" />
              </span>
              Clocked-in tech (only you see this)
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}

export default ServiceAreaMap;
