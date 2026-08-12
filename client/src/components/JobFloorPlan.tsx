/**
 * JobFloorPlan.tsx — Job tab wrapper around FloorPlanSketcher.
 *
 * Responsibilities:
 *   - Load / save the floor plan JSON for a job.
 *   - Show photo counts per room (so the tech knows what still needs coverage).
 *   - Provide a compact toolbar for shared / private review.
 *
 * The heavy lifting (drawing, dragging, resizing, renaming) lives in the
 * sketcher component. This wrapper only handles I/O + telemetry.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import FloorPlanSketcher, { FloorPlanData } from "@/components/FloorPlanSketcher";
import type { Photo } from "@shared/schema";

interface Props {
  jobId: number;
  readOnly?: boolean;
}

const EMPTY: FloorPlanData = { rooms: [] };

export default function JobFloorPlan({ jobId, readOnly }: Props) {
  const { toast } = useToast();
  const [plan, setPlan] = useState<FloorPlanData>(EMPTY);

  // Server plan is the source of truth on mount, but once the user starts
  // editing we keep the working copy in local state and only sync on Save.
  const { data: serverPlan } = useQuery<{ planJson: string } | null>({
    queryKey: ["/api/jobs", String(jobId), "floor-plan"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/floor-plan`).then(r => r.status === 404 ? null : r.json()),
  });
  useEffect(() => {
    if (!serverPlan) return;
    try {
      const parsed = JSON.parse(serverPlan.planJson || "{}");
      if (parsed && Array.isArray(parsed.rooms)) setPlan(parsed);
    } catch {
      // Corrupt JSON → start fresh; user can re-save to overwrite.
    }
  }, [serverPlan]);

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

  const saveMut = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/jobs/${jobId}/floor-plan`, {
      planJson: JSON.stringify(plan),
    }),
    onSuccess: () => {
      toast({ title: "Floor plan saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "floor-plan"] });
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  return (
    <div className="p-4 space-y-3">
      <div>
        <h3 className="text-lg font-semibold">Floor plan</h3>
        <p className="text-sm text-gray-600">
          Sketch each room on this job. You can rename, drag, resize, or delete rooms
          any time — even after photos have been linked to them.
        </p>
      </div>
      <FloorPlanSketcher
        value={plan}
        onChange={setPlan}
        photoCounts={photoCounts}
        onSave={() => saveMut.mutate()}
        saving={saveMut.isPending}
        readOnly={readOnly}
      />
    </div>
  );
}
