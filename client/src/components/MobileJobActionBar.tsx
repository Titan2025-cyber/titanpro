// Job Action Bars
//
// Two surfaces for the same four field actions - Check In, Photo, Note, Call:
//   * MobileJobActionBar - sticky bottom bar, mobile only, always on screen
//     no matter where the tech scrolls.
//   * JobFieldActionBar  - inline block, sits under the customer card on the
//     Activity tab at every breakpoint so the actions are usable without
//     scrolling to the bottom.
// Both share the same check-in mutation and GPS handling below.

import { useEffect, useState } from "react";
import { Camera, MapPin, StickyNote, Phone, LogOut, Loader2, Check, Navigation } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";

interface Props {
  jobId: number;
  contactPhone?: string | null;
  jobAddress?: string | null;
  onSwitchTab: (tab: string) => void;
}

// Build a maps deep-link that prefers the native app on iOS/Android and
// falls back to google.com/maps in the browser. Universal 'https://' URL
// works everywhere (iOS opens Google Maps app if installed, else Safari;
// Android opens Google Maps app directly).
function mapsDirectionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}

interface CheckinRow {
  id: number;
  action: "checkin" | "checkout";
  actor: string;
  at: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
}

// Shared check-in/out logic + query used by both bars. Extracted as a hook so
// the inline JobFieldActionBar and the sticky MobileJobActionBar stay in sync
// on state (checked-in badge, in-flight spinner) without duplicating fetches.
function useJobCheckin(jobId: number) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"none" | "checkin" | "checkout">("none");
  const [confirmed, setConfirmed] = useState(false);

  const { data: checkins = [] } = useQuery<CheckinRow[]>({
    queryKey: [`/api/jobs/${jobId}/checkins`],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/checkins`).then(r => r.json()),
  });
  const latest = checkins[0];
  const isCheckedIn = latest?.action === "checkin";

  async function stamp(kind: "checkin" | "checkout") {
    setBusy(kind);
    // Try geolocation but do not block the check-in if it's slow / denied.
    const coords = await new Promise<{ lat: number|null; lng: number|null; acc: number|null }>((resolve) => {
      if (!navigator.geolocation) return resolve({ lat: null, lng: null, acc: null });
      const timer = setTimeout(() => resolve({ lat: null, lng: null, acc: null }), 8000);
      navigator.geolocation.getCurrentPosition(
        (p) => { clearTimeout(timer); resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); },
        () => { clearTimeout(timer); resolve({ lat: null, lng: null, acc: null }); },
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 30000 }
      );
    });
    try {
      await apiRequest("POST", `/api/jobs/${jobId}/checkin`, {
        latitude: coords.lat, longitude: coords.lng, accuracy: coords.acc, kind,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}/checkins`] });
      setConfirmed(true);
      setTimeout(() => setConfirmed(false), 1500);
      toast({ title: kind === "checkin" ? "Checked in" : "Checked out", description: coords.lat ? "Location saved" : "No location (GPS denied)" });
    } catch (e: any) {
      toast({ title: "Check-in failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setBusy("none");
    }
  }

  return { busy, confirmed, isCheckedIn, stamp };
}

// Shared handler for the Photo action. Flips to the Photos tab and pops the
// camera on the next tick, once the tab has mounted its Take Photo button.
function triggerPhoto(onSwitchTab: (tab: string) => void) {
  onSwitchTab("photos");
  setTimeout(() => {
    const btn = document.querySelector<HTMLButtonElement>('[data-testid="button-take-photo"]');
    btn?.click();
  }, 250);
}

// JobFieldActionBar (inline)
//
// Full-width card that sits under the customer info on the Activity tab so
// the four field actions are usable at the top of the page without scrolling.
// Same behavior as the sticky mobile bar, styled to fit inline with the rest
// of the Activity cards.
export function JobFieldActionBar({ jobId, contactPhone, jobAddress, onSwitchTab }: Props) {
  const { busy, confirmed, isCheckedIn, stamp } = useJobCheckin(jobId);
  const dialHref = contactPhone ? `tel:${String(contactPhone).replace(/[^\d+]/g, "")}` : null;
  const dirHref = jobAddress && jobAddress.trim() ? mapsDirectionsUrl(jobAddress.trim()) : null;

  const baseBtn =
    "min-h-[68px] flex flex-col items-center justify-center gap-1 rounded-lg border transition active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--titan-blue))]";
  const neutralBtn = `${baseBtn} border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800`;

  return (
    <div
      className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white/50 dark:bg-neutral-900/40 p-2"
      role="toolbar"
      aria-label="Job field actions"
      data-testid="card-job-field-actions"
    >
      <div className="grid grid-cols-5 gap-2">
        {/* Check-in / Check-out */}
        <button
          type="button"
          className={
            isCheckedIn
              ? `${baseBtn} border-transparent bg-[hsl(var(--titan-red))] text-white hover:brightness-110`
              : neutralBtn
          }
          onClick={() => stamp(isCheckedIn ? "checkout" : "checkin")}
          disabled={busy !== "none"}
          data-testid="btn-field-checkin"
        >
          {busy !== "none" ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : confirmed ? (
            <Check className="w-5 h-5" />
          ) : isCheckedIn ? (
            <LogOut className="w-5 h-5" />
          ) : (
            <MapPin className="w-5 h-5" />
          )}
          <span className="text-[11px] font-medium leading-tight">{isCheckedIn ? "Check out" : "Check in"}</span>
        </button>

        <button
          type="button"
          className={neutralBtn}
          onClick={() => triggerPhoto(onSwitchTab)}
          data-testid="btn-field-photo"
        >
          <Camera className="w-5 h-5" />
          <span className="text-[11px] font-medium leading-tight">Photo</span>
        </button>

        <button
          type="button"
          className={neutralBtn}
          onClick={() => onSwitchTab("notes")}
          data-testid="btn-field-note"
        >
          <StickyNote className="w-5 h-5" />
          <span className="text-[11px] font-medium leading-tight">Note</span>
        </button>

        {dialHref ? (
          <a
            href={dialHref}
            className={`${baseBtn} border-emerald-200/60 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/60`}
            data-testid="btn-field-call"
          >
            <Phone className="w-5 h-5" />
            <span className="text-[11px] font-medium leading-tight">Call</span>
          </a>
        ) : (
          <button
            type="button"
            disabled
            className={`${baseBtn} border-neutral-200 dark:border-neutral-800 text-neutral-400 dark:text-neutral-600`}
            title="No phone on file for this contact"
          >
            <Phone className="w-5 h-5" />
            <span className="text-[11px] font-medium leading-tight">Call</span>
          </button>
        )}

        {/* Directions - opens Google Maps with the job address as destination */}
        {dirHref ? (
          <a
            href={dirHref}
            target="_blank"
            rel="noopener noreferrer"
            className={`${baseBtn} border-sky-200/60 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-950/60`}
            data-testid="btn-field-directions"
            title={`Directions to ${jobAddress}`}
          >
            <Navigation className="w-5 h-5" />
            <span className="text-[11px] font-medium leading-tight">Directions</span>
          </a>
        ) : (
          <button
            type="button"
            disabled
            className={`${baseBtn} border-neutral-200 dark:border-neutral-800 text-neutral-400 dark:text-neutral-600`}
            title="No address on file for this job"
          >
            <Navigation className="w-5 h-5" />
            <span className="text-[11px] font-medium leading-tight">Directions</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function MobileJobActionBar({ jobId, contactPhone, jobAddress, onSwitchTab }: Props) {
  const { busy, confirmed, isCheckedIn, stamp } = useJobCheckin(jobId);

  useEffect(() => {
    // Reserve bottom padding on <body> so page content isn't hidden behind the bar
    document.body.classList.add("has-mobile-actionbar");
    return () => document.body.classList.remove("has-mobile-actionbar");
  }, []);

  const dialHref = contactPhone ? `tel:${String(contactPhone).replace(/[^\d+]/g, "")}` : null;
  const dirHref = jobAddress && jobAddress.trim() ? mapsDirectionsUrl(jobAddress.trim()) : null;

  return (
    <>
      <style>{`
        .has-mobile-actionbar { padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px)); }
        @media (min-width: 768px) { .has-mobile-actionbar { padding-bottom: 0; } }
      `}</style>
      <div
        className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 shadow-[0_-4px_20px_-8px_rgba(0,0,0,0.15)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        role="toolbar"
        aria-label="Job actions"
      >
        <div className="grid grid-cols-5 gap-0">
          {/* Check-in / Check-out */}
          <button
            type="button"
            className={`min-h-[64px] flex flex-col items-center justify-center gap-0.5 active:scale-95 transition ${
              isCheckedIn
                ? "bg-[hsl(var(--titan-red))] text-white"
                : "text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
            onClick={() => stamp(isCheckedIn ? "checkout" : "checkin")}
            disabled={busy !== "none"}
            data-testid="btn-mobile-checkin"
          >
            {busy !== "none" ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : confirmed ? (
              <Check className="w-6 h-6" />
            ) : isCheckedIn ? (
              <LogOut className="w-6 h-6" />
            ) : (
              <MapPin className="w-6 h-6" />
            )}
            <span className="text-[11px] font-medium leading-tight">{isCheckedIn ? "Check out" : "Check in"}</span>
          </button>

          {/* Photo */}
          <button
            type="button"
            className="min-h-[64px] flex flex-col items-center justify-center gap-0.5 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95 transition"
            onClick={() => triggerPhoto(onSwitchTab)}
            data-testid="btn-mobile-photo"
          >
            <Camera className="w-6 h-6" />
            <span className="text-[11px] font-medium leading-tight">Photo</span>
          </button>

          {/* Note */}
          <button
            type="button"
            className="min-h-[64px] flex flex-col items-center justify-center gap-0.5 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95 transition"
            onClick={() => onSwitchTab("notes")}
            data-testid="btn-mobile-note"
          >
            <StickyNote className="w-6 h-6" />
            <span className="text-[11px] font-medium leading-tight">Note</span>
          </button>

          {/* Call */}
          {dialHref ? (
            <a
              href={dialHref}
              className="min-h-[64px] flex flex-col items-center justify-center gap-0.5 text-emerald-700 dark:text-emerald-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95 transition"
              data-testid="btn-mobile-call"
            >
              <Phone className="w-6 h-6" />
              <span className="text-[11px] font-medium leading-tight">Call</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="min-h-[64px] flex flex-col items-center justify-center gap-0.5 text-neutral-400 dark:text-neutral-600"
            >
              <Phone className="w-6 h-6" />
              <span className="text-[11px] font-medium leading-tight">Call</span>
            </button>
          )}

          {/* Directions - opens Google Maps to the job address */}
          {dirHref ? (
            <a
              href={dirHref}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[64px] flex flex-col items-center justify-center gap-0.5 text-sky-700 dark:text-sky-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 active:scale-95 transition"
              data-testid="btn-mobile-directions"
            >
              <Navigation className="w-6 h-6" />
              <span className="text-[11px] font-medium leading-tight">Directions</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="min-h-[64px] flex flex-col items-center justify-center gap-0.5 text-neutral-400 dark:text-neutral-600"
            >
              <Navigation className="w-6 h-6" />
              <span className="text-[11px] font-medium leading-tight">Directions</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
