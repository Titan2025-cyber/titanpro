// ─────────────────────────────────────────────────────────────────────────────
// Location tracker — clocked-in employees only.
//
// While a signed-in employee has an open time_clock entry, this component
// reads the browser's geolocation every ~60s and POSTs it to
// /api/tech-locations/me. The server refuses the write unless the employee
// is actually clocked in, so if the clock-in check is out of sync we still
// fail safe — no positions get recorded off-shift.
//
// The overlay of these positions is rendered on the owner/admin dashboard map
// only (see ServiceAreaMap.tsx). Techs never see other techs on the map.
//
// This component renders nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";

const PING_INTERVAL_MS = 60_000;   // 1 minute between fixes
const GEO_TIMEOUT_MS   = 15_000;   // give the GPS chip up to 15s
const GEO_MAX_AGE_MS   = 30_000;   // reuse a fix at most 30s old

type OpenClock = { id: number; employee_id: number | null; employee_name: string };

export function LocationTracker() {
  const { user } = useAuth();
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  // Are they currently clocked in? The client already relies on this endpoint
  // for the time-clock UI, so it's cheap to reuse and always fresh.
  const { data: openRows = [] } = useQuery<OpenClock[]>({
    queryKey: ["/api/time-clock/open"],
    enabled: !!user,
    refetchInterval: 60_000,
  });

  // Am *I* (this user) clocked in? Match by employee id when present,
  // otherwise fall back to name. Owners tend to have accounts too but don't
  // usually clock in — if they do, we still track them. That's expected.
  const isClockedIn = !!user && openRows.some(r =>
    (typeof r.employee_id === "number" && r.employee_id === (user.id as any))
    || r.employee_name === user.name
  );

  useEffect(() => {
    // Not clocked in → make sure any prior interval is stopped.
    if (!isClockedIn) {
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    async function pushFix() {
      if (inFlightRef.current) return;   // never stack requests
      inFlightRef.current = true;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: GEO_TIMEOUT_MS,
            maximumAge: GEO_MAX_AGE_MS,
          })
        );
        const { latitude, longitude, accuracy } = pos.coords;
        // Report the fix to the server AND, best-effort, log the round-trip
        // response so we can tell from the browser console whether the ping
        // is silently being dropped (server: 'not_clocked_in') vs actually
        // succeeding. This diagnostic doesn't cost anything in production.
        const res = await apiRequest("POST", "/api/tech-locations/me", { latitude, longitude, accuracy });
        try {
          const body = await res.clone().json();
          // eslint-disable-next-line no-console
          console.info("[LocationTracker] fix pushed", { latitude, longitude, accuracy, response: body });
        } catch {}
      } catch (err: any) {
        // Log the reason so the diagnostic screen can pick it up. We still
        // don't surface it to the tech — they can't do anything about
        // permission-denied except re-grant it in the browser settings.
        const code = err?.code;
        const reason = code === 1 ? "permission_denied"
          : code === 2 ? "position_unavailable"
          : code === 3 ? "timeout"
          : (err?.message || "unknown");
        // eslint-disable-next-line no-console
        console.warn("[LocationTracker] fix failed:", reason);
        try {
          (window as any).__lastGeoError = { reason, at: new Date().toISOString() };
        } catch {}
      } finally {
        inFlightRef.current = false;
      }
    }

    // Fire once immediately so the owner sees the tech within seconds of
    // clock-in, then on the standard interval.
    pushFix();
    timerRef.current = window.setInterval(pushFix, PING_INTERVAL_MS);
    return () => {
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [isClockedIn]);

  return null;
}
