import { useCallback, useEffect, useState } from "react";
import { CloudUpload, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  getQueueForJob,
  isOnline,
  flushQueue,
  retryRequest,
  retryAllFailed,
  discardRequest,
  formatAge,
  OFFLINE_QUEUE_EVENT,
  type QueuedRequest,
} from "@/lib/offlineQueue";
import { buildAuthHeaders } from "@/lib/queryClient";

/**
 * Reactively reads the offline outbox for one job's queued writes, optionally
 * narrowed to a URL fragment (e.g. "/photos", "/drying-records"). Re-reads on
 * enqueue/drain (OFFLINE_QUEUE_EVENT) and on online/offline transitions.
 *
 * Splits the queue into `pending` (still trying / waiting) and `failed` (needs
 * an explicit retry). Exposes the oldest pending timestamp so callers can show
 * an age ("queued 2h ago"), and retry/discard helpers for failed captures.
 *
 * Safe in the preview iframe: getQueueForJob resolves to [] when IndexedDB is
 * unavailable, so this simply reports an empty queue and the retry helpers
 * cleanly no-op.
 */
export function useJobQueue(jobId: number | null | undefined, urlMatch?: string) {
  const [items, setItems] = useState<QueuedRequest[]>([]);
  const [online, setOnline] = useState<boolean>(isOnline());
  // A ticking clock so relative-age labels ("3m", "2h") stay fresh without a
  // queue change. Bumped once a minute.
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    if (jobId == null) {
      setItems([]);
      return;
    }
    const rows = await getQueueForJob(Number(jobId), urlMatch);
    setItems(rows);
  }, [jobId, urlMatch]);

  useEffect(() => {
    if (jobId == null) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      const rows = await getQueueForJob(Number(jobId), urlMatch);
      if (!cancelled) setItems(rows);
    };

    const onOnline = () => {
      setOnline(true);
      run();
    };
    const onOffline = () => {
      setOnline(false);
      run();
    };

    run();
    window.addEventListener(OFFLINE_QUEUE_EVENT, run);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // Light poll so a chip flips to "synced" shortly after a background drain.
    const poll = window.setInterval(run, 8000);
    // Independent 60s clock so age labels advance on their own.
    const clock = window.setInterval(() => setTick((t) => t + 1), 60000);

    return () => {
      cancelled = true;
      window.removeEventListener(OFFLINE_QUEUE_EVENT, run);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [jobId, urlMatch]);

  const pending = items.filter((q) => !q.failed);
  const failed = items.filter((q) => q.failed);
  const oldestPendingAt =
    pending.length > 0 ? Math.min(...pending.map((q) => q.createdAt)) : null;

  // Clear the failed flag(s) and kick a flush. Auth headers are rebuilt at
  // replay time so an expired token doesn't re-fail the retry.
  const retryFailed = useCallback(async () => {
    await retryAllFailed((q) => items.some((it) => it.id === q.id));
    await flushQueue(buildAuthHeaders);
    await refresh();
  }, [items, refresh]);

  const retryOne = useCallback(
    async (id: string) => {
      await retryRequest(id);
      await flushQueue(buildAuthHeaders);
      await refresh();
    },
    [refresh],
  );

  const discardOne = useCallback(
    async (id: string) => {
      await discardRequest(id);
      await refresh();
    },
    [refresh],
  );

  return {
    // Full list (pending + failed) for callers that want everything.
    queued: items,
    // Kept for backward compatibility: total items still in the outbox.
    count: items.length,
    pending,
    pendingCount: pending.length,
    failed,
    failedCount: failed.length,
    oldestPendingAt,
    online,
    retryFailed,
    retryOne,
    discardOne,
  };
}

type SyncChipProps = {
  /** Number of items still trying / waiting to sync for this scope. */
  count: number;
  /** Number of items that failed and need an explicit retry. */
  failedCount?: number;
  /** Whether the device currently has connectivity. */
  online?: boolean;
  /** Oldest pending capture time — shows a relative age when older than ~1min. */
  oldestPendingAt?: number | null;
  /** Called when the user taps the failed chip to retry. */
  onRetry?: () => void;
  /** Shorter label for tight spaces. */
  compact?: boolean;
  className?: string;
  "data-testid"?: string;
};

const CHIP_BASE =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium";

/**
 * Tiny status badge for field-capture screens. Priority order:
 *  - red    "N failed"   → needs a tap to retry (click to retry)
 *  - amber  "Syncing N"  → drain in progress (online, items pending)
 *  - amber  "N queued ·age" → saved on-device, waiting for signal
 *  - green  "Synced"     → nothing pending
 */
export function SyncChip({
  count,
  failedCount = 0,
  online = true,
  oldestPendingAt = null,
  onRetry,
  compact = false,
  className = "",
  ...rest
}: SyncChipProps) {
  const testId = rest["data-testid"] ?? "sync-chip";

  // Failed takes visual priority — it's the state a tech must act on.
  if (failedCount > 0) {
    const tone =
      "border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-700/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70";
    return (
      <button
        type="button"
        onClick={onRetry}
        className={`${CHIP_BASE} ${tone} ${onRetry ? "cursor-pointer" : ""} ${className}`}
        data-testid={`${testId}-failed`}
        title={`${failedCount} field capture${failedCount === 1 ? "" : "s"} failed to sync — tap to retry`}
      >
        <AlertTriangle className="h-3 w-3" />
        {failedCount} failed{onRetry ? " · retry" : ""}
      </button>
    );
  }

  if (count > 0) {
    const syncing = online;
    const tone =
      "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300";
    const age =
      oldestPendingAt != null ? formatAge(oldestPendingAt) : null;
    const showAge = age && age !== "just now";
    return (
      <span
        className={`${CHIP_BASE} ${tone} ${className}`}
        data-testid={testId}
        title={
          syncing
            ? `${count} field capture${count === 1 ? "" : "s"} syncing`
            : `${count} field capture${count === 1 ? "" : "s"} saved on this device, waiting to sync${showAge ? ` — oldest ${age}` : ""}`
        }
      >
        {syncing ? (
          <RefreshCw className="h-3 w-3 animate-spin" />
        ) : (
          <CloudUpload className="h-3 w-3" />
        )}
        {syncing ? `Syncing ${count}` : `${count} queued`}
        {!syncing && showAge ? <span className="opacity-70">· {age}</span> : null}
      </span>
    );
  }

  // Nothing pending — quiet "synced" affirmation.
  const tone =
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300";
  return (
    <span className={`${CHIP_BASE} ${tone} ${className}`} data-testid={testId} title="All field captures synced">
      <CheckCircle2 className="h-3 w-3" />
      Synced
    </span>
  );
}

export default SyncChip;
