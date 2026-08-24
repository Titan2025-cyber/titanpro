/**
 * useAutoSave — Small hook that debounces a save mutation and exposes a
 * user-friendly status string so a parent component can render a live
 * "Saved just now / Saving… / Unsaved" pill.
 *
 * Contract:
 *   • Parent owns the working state and passes it in as `value`.
 *   • Whenever `value` changes AND the component is "ready" (i.e. we've
 *     hydrated from the server so the very first server → local sync
 *     doesn't fire a redundant save), we start a debounce timer.
 *   • On expiry we call `save(value)`. Errors are surfaced via status;
 *     a fresh edit resets the debounce and the next flush retries.
 *
 * Deliberately does NOT own network work — parent's mutation does that
 * so query invalidation, toasts, and role/permission errors stay in
 * one place.
 */
import { useEffect, useRef, useState } from "react";

export type AutoSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface UseAutoSaveOptions<T> {
  /** The current working value. Parent updates this on every edit. */
  value: T;
  /** Called when the debounce fires. Return a promise that resolves on success. */
  save: (v: T) => Promise<unknown>;
  /**
   * Set to true once the parent has finished hydrating from the server,
   * so the initial "load into local state" doesn't fire an autosave.
   */
  ready: boolean;
  /** Debounce window in ms. Default 1200ms — feels instant, avoids thrash. */
  debounceMs?: number;
}

export function useAutoSave<T>({ value, save, ready, debounceMs = 1200 }: UseAutoSaveOptions<T>) {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard the very first render — value === initial state doesn't mean
  // the user edited anything.
  const skipFirstRef = useRef(true);
  // Snapshot of the value at the last successful save. Used to avoid
  // re-saving when React re-runs the effect with an equivalent-by-value
  // update (e.g. history push that produces the same JSON).
  const lastSavedJsonRef = useRef<string>("");
  // Track in-flight save so a rapid follow-up edit chains instead of racing.
  const savingRef = useRef(false);
  const queuedRef = useRef<T | null>(null);
  // Keep the latest save() closure without retriggering effects when the
  // parent recreates it on every render.
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = async (v: T) => {
    if (savingRef.current) {
      queuedRef.current = v;
      return;
    }
    savingRef.current = true;
    setStatus("saving");
    try {
      await saveRef.current(v);
      lastSavedJsonRef.current = JSON.stringify(v);
      setLastSavedAt(Date.now());
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      savingRef.current = false;
      const q = queuedRef.current;
      queuedRef.current = null;
      if (q !== null) {
        // Fire the queued save immediately — the user has edits waiting.
        flush(q);
      }
    }
  };

  useEffect(() => {
    if (!ready) return;
    if (skipFirstRef.current) {
      skipFirstRef.current = false;
      lastSavedJsonRef.current = JSON.stringify(value);
      return;
    }
    const nextJson = JSON.stringify(value);
    if (nextJson === lastSavedJsonRef.current) {
      // No real change (e.g. same content, different reference).
      return;
    }
    setStatus("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flush(value), debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ready, debounceMs]);

  // Save on tab blur / unload so a half-typed room name doesn't vanish
  // if the user closes the tab before the debounce fires.
  useEffect(() => {
    if (!ready) return;
    const flushNow = () => {
      const nextJson = JSON.stringify(value);
      if (nextJson !== lastSavedJsonRef.current) {
        flush(value);
      }
    };
    const onVis = () => { if (document.visibilityState === "hidden") flushNow(); };
    window.addEventListener("beforeunload", flushNow);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("beforeunload", flushNow);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ready]);

  const saveNow = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    return flush(value);
  };

  return { status, lastSavedAt, saveNow };
}

/** Human-friendly label for the pill next to the sketcher toolbar. */
export function autoSaveLabel(status: AutoSaveStatus, lastSavedAt: number | null): string {
  switch (status) {
    case "saving": return "Saving…";
    case "dirty":  return "Saving in a moment…";
    case "error":  return "Save failed — will retry";
    case "saved": {
      if (!lastSavedAt) return "Saved";
      const s = Math.round((Date.now() - lastSavedAt) / 1000);
      if (s < 5) return "Saved just now";
      if (s < 60) return `Saved ${s}s ago`;
      const m = Math.round(s / 60);
      if (m < 60) return `Saved ${m}m ago`;
      return "Saved";
    }
    default: return "";
  }
}
