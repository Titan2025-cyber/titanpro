import { useEffect, useRef, useState } from "react";
import { WifiOff, RefreshCw, CheckCircle2, CloudUpload } from "lucide-react";
import { queryClient, buildAuthHeaders } from "@/lib/queryClient";
import {
  OFFLINE_QUEUE_EVENT,
  queueCount,
  flushQueue,
  isOnline,
} from "@/lib/offlineQueue";

// ─────────────────────────────────────────────────────────────────────────────
// OfflineIndicator — the unmissable field-status banner.
//
// Restoration techs work where there is no signal. This component makes the
// connectivity state impossible to miss and guarantees the tech knows their
// captures are safe:
//   • Offline  → persistent red banner: "Working offline — N items queued"
//   • Back online with a backlog → amber "Syncing N items…"
//   • Drained  → brief green "All items synced" confirmation, then hides.
//
// It also owns the auto-sync loop: it drains the durable outbox on reconnect,
// on an interval, and whenever the queue changes. Nothing here changes any
// existing screen — it simply mounts once, globally.
// ─────────────────────────────────────────────────────────────────────────────

type Phase = "online-empty" | "offline" | "syncing" | "just-synced";

export default function OfflineIndicator() {
  const [online, setOnline] = useState(isOnline());
  const [count, setCount] = useState(0);
  const [phase, setPhase] = useState<Phase>("online-empty");
  const justSyncedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushing = useRef(false);

  // Refresh queue count from IndexedDB.
  async function refreshCount() {
    try {
      setCount(await queueCount());
    } catch {
      /* IndexedDB unavailable (private mode / SSR) — indicator stays hidden */
    }
  }

  // Drain the outbox, refreshing auth headers at replay time.
  async function doFlush() {
    if (flushing.current || !isOnline()) return;
    flushing.current = true;
    try {
      const before = await queueCount();
      if (before > 0) setPhase("syncing");
      const result = await flushQueue((url) => buildAuthHeaders(url.replace(/^https?:\/\/[^/]+/, "")));
      await refreshCount();
      const remaining = result.remaining;
      if (remaining === 0 && (result.synced > 0)) {
        // Confirm success briefly, then invalidate caches so freshly-synced
        // field data appears everywhere it's displayed.
        setPhase("just-synced");
        queryClient.invalidateQueries();
        if (justSyncedTimer.current) clearTimeout(justSyncedTimer.current);
        justSyncedTimer.current = setTimeout(() => setPhase(isOnline() ? "online-empty" : "offline"), 3500);
      } else if (remaining > 0) {
        // Still items left (transient failure mid-run) — keep trying.
        setPhase(isOnline() ? "syncing" : "offline");
        setTimeout(() => { flushing.current = false; doFlush(); }, 4000);
        return;
      } else {
        setPhase(isOnline() ? "online-empty" : "offline");
      }
    } finally {
      flushing.current = false;
    }
  }

  useEffect(() => {
    refreshCount();

    const onOnline = () => { setOnline(true); doFlush(); };
    const onOffline = () => { setOnline(false); setPhase("offline"); refreshCount(); };
    const onQueueChange = () => { refreshCount(); };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(OFFLINE_QUEUE_EVENT, onQueueChange);

    // Safety-net poller: retry sync every 20s in case an 'online' event was
    // missed (some mobile browsers are unreliable about firing it).
    const poll = setInterval(() => { if (isOnline()) doFlush(); }, 20000);

    // Attempt an initial drain on mount (e.g. app reopened after being closed
    // offline with a backlog, now back on signal).
    if (isOnline()) doFlush();

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(OFFLINE_QUEUE_EVENT, onQueueChange);
      clearInterval(poll);
      if (justSyncedTimer.current) clearTimeout(justSyncedTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Decide what (if anything) to show.
  const showOffline = !online;
  const showSyncing = online && phase === "syncing" && count > 0;
  const showSynced = online && phase === "just-synced";
  const showOfflineBacklog = online && count > 0 && phase !== "syncing" && phase !== "just-synced";

  if (!showOffline && !showSyncing && !showSynced && !showOfflineBacklog) return null;

  let bg = "bg-amber-500";
  let icon = <CloudUpload className="h-4 w-4" />;
  let text = "";

  if (showOffline) {
    bg = "bg-red-600";
    icon = <WifiOff className="h-4 w-4 shrink-0" />;
    text = count > 0
      ? `Working offline — ${count} ${count === 1 ? "item" : "items"} saved on this device, will sync when you're back online`
      : "Working offline — your captures are saved on this device and will sync automatically";
  } else if (showSyncing) {
    bg = "bg-amber-500";
    icon = <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />;
    text = `Back online — syncing ${count} ${count === 1 ? "item" : "items"}…`;
  } else if (showSynced) {
    bg = "bg-green-600";
    icon = <CheckCircle2 className="h-4 w-4 shrink-0" />;
    text = "All field captures synced";
  } else if (showOfflineBacklog) {
    bg = "bg-amber-500";
    icon = <CloudUpload className="h-4 w-4 shrink-0" />;
    text = `${count} ${count === 1 ? "item" : "items"} waiting to sync — tap to retry`;
  }

  return (
    <div
      className={`fixed top-0 inset-x-0 z-[100] ${bg} text-white text-sm font-medium shadow-md`}
      role="status"
      aria-live="polite"
      data-testid="offline-indicator"
      onClick={() => { if (isOnline()) doFlush(); }}
      style={{ cursor: showOfflineBacklog ? "pointer" : "default" }}
    >
      <div className="max-w-5xl mx-auto flex items-center gap-2 px-4 py-2 justify-center text-center">
        {icon}
        <span data-testid="offline-indicator-text">{text}</span>
      </div>
    </div>
  );
}
