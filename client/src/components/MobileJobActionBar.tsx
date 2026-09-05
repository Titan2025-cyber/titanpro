// ─── MobileJobActionBar ──────────────────────────────────────────────────────
// Sticky bottom action bar that appears only on small screens (< md). Puts
// the four things a field tech actually does on-site one tap away:
//   • Check In (with GPS)
//   • Take Photo (jumps to the Photos tab and pops the camera)
//   • Add Note (jumps to Notes tab)
//   • Call customer (tel: link when contact phone exists)
// Fat 56px tap targets, high contrast, safe-area padding for iOS notch.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { Camera, MapPin, StickyNote, Phone, LogOut, Loader2, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";

interface Props {
  jobId: number;
  contactPhone?: string | null;
  onSwitchTab: (tab: string) => void;
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

export function MobileJobActionBar({ jobId, contactPhone, onSwitchTab }: Props) {
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
    // Try geolocation but don't block the check-in if it's slow / denied.
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

  useEffect(() => {
    // Reserve bottom padding on <body> so page content isn't hidden behind the bar
    document.body.classList.add("has-mobile-actionbar");
    return () => document.body.classList.remove("has-mobile-actionbar");
  }, []);

  const dialHref = contactPhone ? `tel:${String(contactPhone).replace(/[^\d+]/g, "")}` : null;

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
        <div className="grid grid-cols-4 gap-0">
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
            onClick={() => {
              onSwitchTab("photos");
              // Give React a tick, then click the Take Photo button if present
              setTimeout(() => {
                const btn = document.querySelector<HTMLButtonElement>('[data-testid="button-take-photo"]');
                btn?.click();
              }, 250);
            }}
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
        </div>
      </div>
    </>
  );
}
