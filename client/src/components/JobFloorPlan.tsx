/**
 * JobFloorPlan.tsx — Job tab wrapper around FloorPlanSketcher.
 *
 * Responsibilities:
 *   - Load / autosave the floor plan JSON for a job.
 *   - Show photo counts per room (so the tech knows what still needs coverage).
 *   - Render a live "Saved just now / Saving… / Unsaved" pill above the sketcher.
 *
 * The heavy lifting (drawing, dragging, resizing, renaming) lives in the
 * sketcher component. This wrapper only handles I/O + telemetry.
 *
 * Autosave contract:
 *   - We debounce ~1.2s after the last edit, then POST the plan JSON.
 *   - We also flush on tab hide / unload so a half-finished room outline
 *     isn't lost if the user closes the tab before the debounce fires.
 *   - The FloorPlanSketcher's built-in Save button still exists and is
 *     wired to `saveNow()` so users who want the reassurance of a manual
 *     save can still get it — same intent, immediate execution.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Check, CloudUpload, AlertCircle } from "lucide-react";
import FloorPlanSketcher, { FloorPlanData } from "@/components/FloorPlanSketcher";
import { useAutoSave, autoSaveLabel } from "@/hooks/useAutoSave";
import type { Photo } from "@shared/schema";

interface Props {
  jobId: number;
  readOnly?: boolean;
}

const EMPTY: FloorPlanData = { rooms: [] };

export default function JobFloorPlan({ jobId, readOnly }: Props) {
  const { toast } = useToast();
  const [plan, setPlan] = useState<FloorPlanData>(EMPTY);
  const [hydrated, setHydrated] = useState(false);

  // Server plan is the source of truth on mount, but once the user starts
  // editing we keep the working copy in local state and autosave any diff.
  const { data: serverPlan, isFetched } = useQuery<{ planJson: string } | null>({
    queryKey: ["/api/jobs", String(jobId), "floor-plan"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/floor-plan`).then(r => r.status === 404 ? null : r.json()),
  });
  useEffect(() => {
    if (!isFetched) return;
    if (serverPlan) {
      try {
        const parsed = JSON.parse(serverPlan.planJson || "{}");
        if (parsed && Array.isArray(parsed.rooms)) setPlan(parsed);
      } catch {
        // Corrupt JSON → start fresh; next autosave overwrites the row.
      }
    }
    setHydrated(true);
  }, [serverPlan, isFetched]);

  // Photo counts per floor-plan room id, for the badge on each room shape.
  const { data: photos = [] } = useQuery<Photo[]>({
    queryKey: ["/api/jobs", String(jobId), "photos"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/photos`).then(r => r.json()),
  });
  const photoCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of photos) {
      const rid = (p as any).floorPlanRoomId;
      if (rid) map[rid] = (map[rid] || 0) + 1;
    }
    return map;
  }, [photos]);

  // No success toast on autosave — the pill communicates status.
  // Errors still toast so a failure can't be missed silently.
  const saveMut = useMutation({
    mutationFn: (p: FloorPlanData) => apiRequest("PUT", `/api/jobs/${jobId}/floor-plan`, {
      planJson: JSON.stringify(p),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "floor-plan"] });
    },
    onError: () => toast({ title: "Save failed \u2014 will retry", variant: "destructive" }),
  });

  const { status, lastSavedAt, saveNow } = useAutoSave<FloorPlanData>({
    value: plan,
    ready: hydrated && !readOnly,
    save: (v) => new Promise((resolve, reject) => {
      saveMut.mutate(v, { onSuccess: () => resolve(undefined), onError: (e) => reject(e) });
    }),
  });
  const [, setTick] = useState(0);
  useEffect(() => {
    if (status !== "saved") return;
    const t = setInterval(() => setTick(x => x + 1), 15000);
    return () => clearInterval(t);
  }, [status]);
  const label = useMemo(() => autoSaveLabel(status, lastSavedAt), [status, lastSavedAt]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Floor plan</h3>
          <p className="text-sm text-gray-600">
            Sketch each room on this job. You can rename, drag, resize, or delete rooms
            any time — even after photos have been linked to them.
          </p>
        </div>
        {!readOnly && label && (
          <button
            type="button"
            onClick={() => { saveNow(); }}
            title="Autosave status — click to save immediately"
            className={
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors shrink-0 "
              + (status === "saving"
                ? "border-[hsl(var(--titan-blue))]/40 text-[hsl(var(--titan-blue))] bg-[hsl(var(--titan-blue))]/10"
                : status === "dirty"
                ? "border-amber-300 text-amber-600 bg-amber-50"
                : status === "error"
                ? "border-red-300 text-red-600 bg-red-50"
                : "border-muted-foreground/20 text-muted-foreground hover:bg-muted")
            }
            data-testid="floor-plan-autosave-pill"
          >
            {status === "saving"    ? <CloudUpload className="w-3.5 h-3.5 animate-pulse" />
            : status === "dirty"     ? <CloudUpload className="w-3.5 h-3.5" />
            : status === "error"     ? <AlertCircle className="w-3.5 h-3.5" />
            : status === "saved"     ? <Check className="w-3.5 h-3.5" />
            : null}
            <span>{label}</span>
          </button>
        )}
      </div>
      <FloorPlanSketcher
        value={plan}
        onChange={setPlan}
        photoCounts={photoCounts}
        onSave={() => saveNow()}
        saving={status === "saving"}
        readOnly={readOnly}
      />
    </div>
  );
}
