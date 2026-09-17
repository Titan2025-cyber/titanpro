// ─────────────────────────────────────────────────────────────────────────────
// Push 7 · Geofence auto-punch
//
// Runs alongside LocationTracker for signed-in employees. While the app is
// open on a phone:
//
//   1. Poll browser geolocation every ~60s (same cadence as LocationTracker
//      so we don't double-drain the battery).
//   2. Ask the server for today's "target" jobs — jobs I'm scheduled at
//      today (from shifts) with lat/lng.
//   3. If NOT clocked in AND inside a target's fence continuously for the
//      configured dwell (default 3 min) → auto clock-IN on that job, with a
//      "Undo" toast (2 min window).
//   4. If CLOCKED IN AND currently outside the fence of the job I punched
//      into, continuously for the configured dwell (default 8 min) → auto
//      clock-OUT with an Undo toast.
//   5. Every attempt (fired, skipped, undone) is logged to
//      /api/time-clock/auto-events so the office has a paper trail and can
//      review "why didn't the app punch him in?"
//
// LIMITATIONS the user must accept (see docs/PUSH_7_NOTES.md):
//   • Only fires while the app is open (foreground or foreground-ish).
//     iOS Safari WILL throttle / kill JS geolocation once the tab is
//     backgrounded or the phone locks. This is not fixable in a web app.
//     Level-3 native or telematics is the only way to get true set-and-forget.
//   • Business hours + days-of-week guardrails prevent 2AM drive-by punches.
//   • Nothing about payroll or overtime happens here. Manual edit endpoint
//     is still the source of truth for corrections.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

const POLL_INTERVAL_MS = 60_000;
const GEO_TIMEOUT_MS   = 15_000;
const GEO_MAX_AGE_MS   = 30_000;
const UNDO_WINDOW_MS   = 120_000; // 2 minutes

type Target = {
  jobId: number;
  jobNumber: string;
  address: string | null;
  latitude: number;
  longitude: number;
};

type Settings = {
  enabled: boolean;
  radiusFt: number;
  enterDwellSec: number;
  exitDwellSec: number;
  businessHoursStart: string;   // "06:00"
  businessHoursEnd: string;     // "20:00"
  daysOfWeek: string;           // "1,2,3,4,5,6"
};

type OpenClock = {
  id: number;
  employee_id: number | null;
  employee_name: string;
  job_id: number | null;
  clock_in_at: string;
};

type TargetsResp = { settings: Settings | null; targets: Target[] };

// Haversine — miles doesn't matter, feet does. 6371km = 20 902 231 ft.
function distanceFt(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R_FT = 20_902_231;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R_FT * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function withinBusinessHours(s: Settings, now: Date): boolean {
  // Days: comma-separated 0-6 (0=Sunday)
  const allowedDays = s.daysOfWeek.split(",").map(x => parseInt(x.trim(), 10));
  if (!allowedDays.includes(now.getDay())) return false;
  const [sh, sm] = s.businessHoursStart.split(":").map(Number);
  const [eh, em] = s.businessHoursEnd.split(":").map(Number);
  const startMin = sh * 60 + (sm || 0);
  const endMin   = eh * 60 + (em || 0);
  const nowMin   = now.getHours() * 60 + now.getMinutes();
  return nowMin >= startMin && nowMin < endMin;
}

export function GeofenceAutoPunch() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Poll targets every 5 min — they change when shifts get scheduled.
  const { data: targetsResp } = useQuery<TargetsResp>({
    queryKey: ["/api/my/geofence-targets"],
    enabled: !!user,
    refetchInterval: 5 * 60_000,
  });

  // Current clock-in state (piggy-back on the endpoint LocationTracker uses).
  const { data: openRows = [] } = useQuery<OpenClock[]>({
    queryKey: ["/api/time-clock/open"],
    enabled: !!user,
    refetchInterval: 60_000,
  });

  // Which one, if any, is MINE.
  const myOpen: OpenClock | undefined = user
    ? openRows.find(r =>
        (typeof r.employee_id === "number" && r.employee_id === user.id)
        || r.employee_name === user.name
      )
    : undefined;

  // ─── Dwell state — persists across polls but not across page loads ──────
  //
  // We track two things:
  //   insideSinceMs — first fix inside a target's fence in the current streak
  //   outsideSinceMs — first fix outside my open-clock target's fence
  // Both are reset the moment the corresponding side of the fence changes.
  const insideRef = useRef<{ jobId: number; sinceMs: number } | null>(null);
  const outsideRef = useRef<{ sinceMs: number } | null>(null);

  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  // ─── Undo bookkeeping ────────────────────────────────────────────────────
  //
  // Each auto-event we record gets a client-side id we can revert. We keep
  // only the *most recent* pending undo — old ones stale out after 2 min.
  const [pendingUndo, setPendingUndo] = useState<{
    autoEventId: number;
    kind: "clock_in" | "clock_out";
    expiresAtMs: number;
  } | null>(null);

  useEffect(() => {
    if (!pendingUndo) return;
    const t = window.setTimeout(() => setPendingUndo(null),
      Math.max(0, pendingUndo.expiresAtMs - Date.now()));
    return () => window.clearTimeout(t);
  }, [pendingUndo]);

  const doUndo = useCallback(async () => {
    if (!pendingUndo) return;
    try {
      await apiRequest(`/api/time-clock/auto-events/${pendingUndo.autoEventId}/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      toast({ title: pendingUndo.kind === "clock_in" ? "Clock-in undone" : "Clock-out undone" });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock"] });
      setPendingUndo(null);
      // Reset dwell so we don't immediately re-punch after undo.
      insideRef.current = null;
      outsideRef.current = null;
    } catch (e: any) {
      toast({ title: "Couldn't undo", description: e.message, variant: "destructive" });
    }
  }, [pendingUndo, toast, queryClient]);

  // ─── Main polling loop ───────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const settings = targetsResp?.settings;
    if (!settings || !settings.enabled) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    const targets = targetsResp.targets || [];
    // No targets → nothing to auto-punch. Reset dwell so we don't fire the
    // moment a shift appears.
    if (!myOpen && targets.length === 0) {
      insideRef.current = null;
      return;
    }

    async function tick() {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const nowDate = new Date();
        if (!withinBusinessHours(settings!, nowDate)) {
          // Log a skip once every ~10 min so the audit shows we're awake but
          // outside hours. Keep it lightweight — no toasts.
          if (nowDate.getMinutes() % 10 === 0) {
            try {
              await apiRequest("/api/time-clock/auto-events", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ eventType: "skip", skipReason: "outside_hours" }),
              });
            } catch {}
          }
          insideRef.current = null;
          outsideRef.current = null;
          return;
        }

        // Get a fresh GPS fix.
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: GEO_TIMEOUT_MS,
            maximumAge: GEO_MAX_AGE_MS,
          })
        );
        const { latitude, longitude } = pos.coords;
        const nowMs = Date.now();

        // ── Are we currently inside any target's fence? ──────────────────
        const insideOfAny = targets.find(t =>
          distanceFt({ lat: latitude, lng: longitude }, { lat: t.latitude, lng: t.longitude })
            <= settings!.radiusFt
        );

        // ── Case A: NOT clocked in → look for auto clock-IN ──────────────
        if (!myOpen) {
          if (insideOfAny) {
            // Same target as previous streak? Keep timer running.
            if (insideRef.current?.jobId !== insideOfAny.jobId) {
              insideRef.current = { jobId: insideOfAny.jobId, sinceMs: nowMs };
            }
            const dwellSec = Math.round((nowMs - insideRef.current.sinceMs) / 1000);
            if (dwellSec >= settings!.enterDwellSec) {
              // Fire clock-in.
              const distFt = distanceFt(
                { lat: latitude, lng: longitude },
                { lat: insideOfAny.latitude, lng: insideOfAny.longitude }
              );
              try {
                const tc = await apiRequest("/api/time-clock/clock-in", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    jobId: insideOfAny.jobId, lat: latitude, lng: longitude,
                    notes: "auto-punch (geofence)",
                  }),
                }).then(r => r.json());

                const ev = await apiRequest("/api/time-clock/auto-events", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    eventType: "clock_in",
                    jobId: insideOfAny.jobId,
                    distanceFt: Math.round(distFt),
                    dwellSec, timeClockId: tc.id,
                    latitude, longitude,
                  }),
                }).then(r => r.json());

                queryClient.invalidateQueries({ queryKey: ["/api/time-clock/open"] });
                queryClient.invalidateQueries({ queryKey: ["/api/time-clock"] });

                setPendingUndo({
                  autoEventId: ev.id,
                  kind: "clock_in",
                  expiresAtMs: Date.now() + UNDO_WINDOW_MS,
                });
                toast({
                  title: `Clocked in at ${insideOfAny.address || insideOfAny.jobNumber}`,
                  description: "You're on the clock. Tap Undo within 2 min if this wasn't right.",
                });
                insideRef.current = null;
              } catch (e: any) {
                // Log the skip so audit shows we tried.
                try {
                  await apiRequest("/api/time-clock/auto-events", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      eventType: "skip", skipReason: `clock_in_failed:${e.message}`,
                      jobId: insideOfAny.jobId, latitude, longitude,
                    }),
                  });
                } catch {}
              }
            }
          } else {
            // Outside all fences → reset streak.
            insideRef.current = null;
          }
        }

        // ── Case B: CLOCKED IN → look for auto clock-OUT ─────────────────
        else {
          // Only auto clock-out if we punched into a job WITH lat/lng we
          // can compare against. If the current punch has no job_id, do
          // nothing — the tech will manually clock out.
          const currentJob = myOpen.job_id
            ? targets.find(t => t.jobId === myOpen.job_id)
            : undefined;

          if (currentJob) {
            const distFt = distanceFt(
              { lat: latitude, lng: longitude },
              { lat: currentJob.latitude, lng: currentJob.longitude }
            );
            const outside = distFt > settings!.radiusFt;
            if (outside) {
              if (!outsideRef.current) outsideRef.current = { sinceMs: nowMs };
              const dwellSec = Math.round((nowMs - outsideRef.current.sinceMs) / 1000);
              if (dwellSec >= settings!.exitDwellSec) {
                try {
                  await apiRequest("/api/time-clock/clock-out", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ lat: latitude, lng: longitude }),
                  });

                  const ev = await apiRequest("/api/time-clock/auto-events", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      eventType: "clock_out",
                      jobId: currentJob.jobId,
                      distanceFt: Math.round(distFt),
                      dwellSec, timeClockId: myOpen.id,
                      latitude, longitude,
                    }),
                  }).then(r => r.json());

                  queryClient.invalidateQueries({ queryKey: ["/api/time-clock/open"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/time-clock"] });

                  setPendingUndo({
                    autoEventId: ev.id,
                    kind: "clock_out",
                    expiresAtMs: Date.now() + UNDO_WINDOW_MS,
                  });
                  toast({
                    title: `Clocked out from ${currentJob.address || currentJob.jobNumber}`,
                    description: "You're off the clock. Tap Undo within 2 min if this wasn't right.",
                  });
                  outsideRef.current = null;
                } catch (e: any) {
                  try {
                    await apiRequest("/api/time-clock/auto-events", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        eventType: "skip", skipReason: `clock_out_failed:${e.message}`,
                        jobId: currentJob.jobId, latitude, longitude,
                      }),
                    });
                  } catch {}
                }
              }
            } else {
              // Back inside the fence → reset the outside streak.
              outsideRef.current = null;
            }
          }
        }
      } catch (err: any) {
        // GPS failure — log once so the diagnostic page shows why.
        const code = err?.code;
        const reason = code === 1 ? "permission_denied"
          : code === 2 ? "position_unavailable"
          : code === 3 ? "timeout"
          : (err?.message || "unknown");
        try {
          (window as any).__lastGeoError = { reason, at: new Date().toISOString() };
        } catch {}
      } finally {
        inFlightRef.current = false;
      }
    }

    // Fire once immediately (short-circuit dwell if the app was just opened
    // AT the job — we still respect enterDwellSec because insideRef starts
    // null and the FIRST fix only sets sinceMs).
    tick();
    timerRef.current = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [user, targetsResp, myOpen?.id, myOpen?.job_id, queryClient, toast]);

  // ─── UI: undo banner ─────────────────────────────────────────────────────
  //
  // Toasts vanish; a persistent banner keeps the Undo affordance visible for
  // the full 2 min in case the tech didn't notice the toast. Positioned at
  // the top so it doesn't collide with mobile bottom nav.
  if (!pendingUndo) return null;
  const secLeft = Math.max(0, Math.floor((pendingUndo.expiresAtMs - Date.now()) / 1000));
  return (
    <div
      className="fixed top-2 inset-x-2 z-[9999] mx-auto max-w-md rounded-lg bg-slate-900 text-white shadow-lg border border-slate-700 flex items-center gap-3 px-3 py-2"
      data-testid="geofence-undo-banner"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">
          {pendingUndo.kind === "clock_in" ? "Auto clocked-in" : "Auto clocked-out"}
        </div>
        <div className="text-xs text-slate-300">Undo available for {secLeft}s</div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="h-8"
        onClick={doUndo}
        data-testid="geofence-undo-btn"
      >
        Undo
      </Button>
    </div>
  );
}
