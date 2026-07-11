// ─────────────────────────────────────────────────────────────────────────────
// Presence heartbeat — runs for EVERY signed-in staff member.
//
// While the Titan Pro tab is open, this sends a lightweight heartbeat to the
// server every ~30s reporting two independent signals:
//   - focused: the tab is currently open & focused (counts toward "open" time)
//   - active:  the user interacted (click / keypress / mouse / scroll / nav)
//              since the last heartbeat (counts toward "active" time)
//
// The server accumulates open-time and active-time separately per user/session.
// Only the OWNER can view the resulting reports (see Team Activity page).
// This component renders nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";

const HEARTBEAT_MS = 30_000; // send every 30s

export function PresenceTracker() {
  const { user } = useAuth();
  // Tracks whether the user interacted since the last heartbeat was sent.
  const interactedRef = useRef(false);

  useEffect(() => {
    if (!user) return; // only track signed-in staff

    const markInteracted = () => { interactedRef.current = true; };
    const events: (keyof WindowEventMap)[] = [
      "mousedown", "keydown", "mousemove", "scroll", "touchstart", "click", "wheel",
    ];
    for (const ev of events) window.addEventListener(ev, markInteracted, { passive: true });

    async function beat() {
      try {
        const focused = document.visibilityState === "visible" && document.hasFocus();
        const active = interactedRef.current && focused;
        // Reset the interaction flag for the next interval window.
        interactedRef.current = false;
        await apiRequest("POST", "/api/presence/heartbeat", { focused, active });
      } catch {
        // Never let presence tracking disrupt the app — swallow errors silently.
      }
    }

    // Send one immediately so "online" shows up right away, then on an interval.
    beat();
    const iv = window.setInterval(beat, HEARTBEAT_MS);
    // Also send a beat when the tab regains focus, for snappier live status.
    const onVis = () => { if (document.visibilityState === "visible") beat(); };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      for (const ev of events) window.removeEventListener(ev, markInteracted);
    };
  }, [user?.id]);

  return null;
}
