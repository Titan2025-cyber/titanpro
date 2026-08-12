/**
 * JobPhotos.tsx — Per-job photo module
 * Embedded directly in JobDetail tabs and Technician view.
 * Supports camera capture, file upload, categorized viewing, and deletion.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Camera, Upload, Trash2, FolderOpen, X, ZoomIn, CloudUpload, AlertTriangle, RefreshCw, FileText, CheckSquare, Square, MapPin, Sparkles, Pencil, Share2, Mic, MicOff } from "lucide-react";
import { extractExif } from "@/lib/photoExif";
import { generatePhotoReport } from "@/lib/photoReport";
import PhotoAnnotator from "@/components/PhotoAnnotator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Photo } from "@shared/schema";
import { SyncChip, useJobQueue } from "@/components/SyncChip";

const CATEGORIES = ["general", "before", "during", "after", "damage", "moisture", "equipment"];

const CATEGORY_COLORS: Record<string, string> = {
  general: "bg-gray-100 text-gray-700",
  before: "bg-blue-100 text-blue-700",
  during: "bg-yellow-100 text-yellow-700",
  after: "bg-green-100 text-green-700",
  damage: "bg-red-100 text-red-700",
  moisture: "bg-cyan-100 text-cyan-700",
  equipment: "bg-purple-100 text-purple-700",
};

interface Props {
  jobId: number;
  readOnly?: boolean;
  /** When set to 'mitigation' or 'reconstruction', only photos for that phase
   * are shown and new uploads are tagged with it. 'both'/undefined = show all. */
  phase?: string;
}

export default function JobPhotos({ jobId, readOnly = false, phase }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState("general");
  // Room label captured at upload time. Autocompletes off other photos on this
  // job so techs pick from an existing room name instead of typing new ones.
  const [room, setRoom] = useState("");
  // Toggle: run AI room/damage/severity classifier on each photo after upload.
  // Costs a small credit per image; user can turn off for bulk imports.
  const [aiEnabled, setAiEnabled] = useState(true);
  const [annotatingPhoto, setAnnotatingPhoto] = useState<Photo | null>(null);
  const [reportTemplate, setReportTemplate] = useState<"adjuster" | "customer" | "internal">("adjuster");
  const [uploading, setUploading] = useState(false);
  // Bulk-upload drag-drop state. `dragActive` drives the visual
  // highlight of the drop zone. `bulkProgress` tracks per-file phase
  // ("pending"|"uploading"|"done"|"failed") so the UI can render a
  // progress bar + per-file status list while an entire folder or camera
  // roll pours in.
  const [dragActive, setDragActive] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ name: string; status: "pending"|"uploading"|"done"|"failed"; error?: string }[]>([]);
  const [activeFilter, setActiveFilter] = useState("all");
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  // Photo report mode: when true, tiles become selectable (checkbox in the
  // corner) and clicking toggles selection instead of opening the lightbox.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [generatingReport, setGeneratingReport] = useState(false);

  const { data: photos = [], isLoading } = useQuery<Photo[]>({
    queryKey: ["/api/jobs", String(jobId), "photos"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/photos`).then(r => r.json()),
  });

  // Full job record for the PDF cover page — pulls customer name, address,
  // claim info, adjuster, loss type, etc. so the report reflects real job
  // context instead of filler like "Job #123". Cheap: hits the same cache
  // the parent JobDetail page already warms.
  const { data: job } = useQuery<any>({
    queryKey: [`/api/jobs/${jobId}`],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}`).then(r => r.json()),
  });

  // Floor plan for this job — used to populate the room dropdown in the
  // photo lightbox so a tech can link an existing photo to a floor-plan
  // room and see the pin count go up in the sketcher.
  const { data: floorPlan } = useQuery<any>({
    queryKey: [`/api/jobs/${jobId}/floor-plan`],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/floor-plan`).then(r => r.json()).catch(() => null),
  });
  const floorPlanRooms: { id: string; name: string }[] = Array.isArray(floorPlan?.planJson?.rooms)
    ? floorPlan.planJson.rooms.map((r: any) => ({ id: r.id, name: r.name || r.id }))
    : (() => {
        try {
          const j = typeof floorPlan?.planJson === "string" ? JSON.parse(floorPlan.planJson) : floorPlan?.planJson;
          return Array.isArray(j?.rooms) ? j.rooms.map((r: any) => ({ id: r.id, name: r.name || r.id })) : [];
        } catch { return []; }
      })();

  // Patch a single photo row — used by the lightbox controls for room /
  // floor-plan link / annotation save.
  const patchPhoto = async (photoId: number, body: Record<string, any>) => {
    await apiRequest("PATCH", `/api/photos/${photoId}`, body);
    queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "photos"] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/photos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "photos"] });
      setLightbox(null);
    },
  });

  // Format a Date as "Jul 29, 2026 · 11:24 AM" in the tech's locale.
  const formatStamp = (d: Date) => {
    try {
      return d.toLocaleString(undefined, {
        year: "numeric", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit",
      });
    } catch {
      return d.toISOString();
    }
  };

  // Downscale + timestamp-stamp a File in ONE canvas pass. The previous
  // implementation ran fileToDataUrl (decode + downscale + encode) then
  // handed the base64 back to stampPhoto (which decoded it again, scaled
  // to a DIFFERENT max edge, and re-encoded). That double-decode is the
  // dominant cost on phones — easily 400–800ms per 12MP camera photo.
  // This version does file → bitmap → single downscale-to-1600 → stamp →
  // encode-once. Uses createImageBitmap when available (way faster than
  // Image + FileReader on mobile Safari + Chrome).
  const processPhoto = async (file: File, takenAt: Date): Promise<string> => {
    const maxEdge = 1600;
    // createImageBitmap decodes the JPEG off the main thread and honours
    // EXIF orientation automatically. Fall back to <img> only if the API
    // is missing (old browsers).
    let bitmap: ImageBitmap | HTMLImageElement;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as any);
    } catch {
      const url = URL.createObjectURL(file);
      try {
        bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = url;
        });
      } finally {
        // Revoke on the next tick so the Image had a chance to load.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    }
    const srcW = (bitmap as any).width;
    const srcH = (bitmap as any).height;
    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d unsupported");
    ctx.drawImage(bitmap as any, 0, 0, w, h);
    // Free the bitmap immediately — large photos hold multi-MB GPU memory.
    if ((bitmap as any).close) (bitmap as any).close();

    const label = formatStamp(takenAt);
    // Scale font to the image so it looks the same on any resolution.
    const fontSize = Math.max(16, Math.round(Math.min(w, h) * 0.035));
    ctx.font = `600 ${fontSize}px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    const padX = Math.round(fontSize * 0.7);
    const padY = Math.round(fontSize * 0.4);
    const textWidth = ctx.measureText(label).width;
    const pillWidth = textWidth + padX * 2;
    const pillHeight = fontSize + padY * 2;
    const margin = Math.round(fontSize * 0.6);
    const x = w - pillWidth - margin;
    const y = h - pillHeight - margin;

    // Dark pill with rounded corners (rounded rect polyfill for older Safari)
    ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
    const r = Math.round(pillHeight / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + pillWidth - r, y);
    ctx.quadraticCurveTo(x + pillWidth, y, x + pillWidth, y + r);
    ctx.lineTo(x + pillWidth, y + pillHeight - r);
    ctx.quadraticCurveTo(x + pillWidth, y + pillHeight, x + pillWidth - r, y + pillHeight);
    ctx.lineTo(x + r, y + pillHeight);
    ctx.quadraticCurveTo(x, y + pillHeight, x, y + pillHeight - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + padX, y + pillHeight / 2 + 1);

    // JPEG @ 0.72 is visually indistinguishable at 1600px for restoration
    // documentation and cuts payload ~45% vs 0.85. Base64 output is ~250–
    // 450 KB for a 12MP photo, well within a fast upload.
    return canvas.toDataURL("image/jpeg", 0.72);
  };

  // Process + POST a single photo. Returns the created photo id (for the
  // AI classify sweep at the end) or null on failure. Errors are captured
  // into the progress panel via `onFail` so the outer runner can keep the
  // batch moving instead of aborting the whole upload.
  const uploadOnePhoto = async (
    file: File,
    idx: number,
  ): Promise<number | null> => {
    setBulkProgress(p => p.map((row, i) => i === idx ? { ...row, status: "uploading" } : row));
    try {
      // ── EXIF FIRST ── Extract camera GPS + original timestamp + device
      // before any decode/re-encode. Preserves the evidentiary chain.
      const exif = await extractExif(file);
      const shutterMs = exif.originalTakenAt
        ? new Date(exif.originalTakenAt).getTime()
        : (file.lastModified && file.lastModified > 0 ? file.lastModified : Date.now());
      const takenAt = new Date(shutterMs);

      // ONE decode + downscale + stamp + encode pass. See processPhoto().
      let dataUrl: string;
      try {
        dataUrl = await processPhoto(file, takenAt);
      } catch {
        // If the fast path throws (ancient browser, corrupt bitmap), fall
        // back to a plain FileReader read so we can still upload the raw
        // bytes rather than dropping the photo.
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }

      const res = await apiRequest("POST", "/api/photos", {
        jobId,
        filename: file.name,
        dataUrl,
        caption: caption || file.name,
        category,
        phase: phase && phase !== "both" ? phase : "mitigation",
        takenAt: takenAt.toISOString(),
        latitude: exif.latitude || null,
        longitude: exif.longitude || null,
        originalTakenAt: exif.originalTakenAt || null,
        deviceMake: exif.deviceMake || null,
        deviceModel: exif.deviceModel || null,
        room: room.trim() || null,
      });
      const created = await res.json().catch(() => null);
      setBulkProgress(p => p.map((row, i) => i === idx ? { ...row, status: "done" } : row));
      return created?.id ?? null;
    } catch (e: any) {
      setBulkProgress(p => p.map((row, i) => i === idx ? { ...row, status: "failed", error: e?.message } : row));
      return null;
    }
  };

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files as any) as File[];
    if (list.length === 0) return;
    setUploading(true);
    setBulkProgress(list.map(f => ({ name: f.name, status: "pending" })));

    // Bounded parallelism: run up to CONCURRENCY uploads at a time. The
    // client can decode + encode 3 photos concurrently on a modern phone
    // without stuttering the UI, and the server accepts them in parallel.
    // Keep at 3 to avoid saturating slow field-LTE uplinks with too many
    // simultaneous multi-MB base64 POSTs.
    const CONCURRENCY = 3;
    const createdIds: number[] = [];
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= list.length) return;
        const id = await uploadOnePhoto(list[idx], idx);
        if (id != null) createdIds.push(id);
      }
    };
    const workers = Array.from({ length: Math.min(CONCURRENCY, list.length) }, () => worker());
    await Promise.all(workers);

    // Single cache invalidation at the end, not per-photo. Prevents N
    // full refetches of the photo list during a big batch.
    queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "photos"] });

    setUploading(false);
    setCaption("");
    // Auto-clear the progress panel after a short beat so the tech can see
    // the final tally before it fades. Failures stay visible longer.
    const anyFailed = bulkProgress.some(p => p.status === "failed");
    setTimeout(() => setBulkProgress([]), anyFailed ? 12000 : 3500);
    const successCount = createdIds.length;
    if (successCount > 0) {
      toast({ title: `${successCount} photo${successCount === 1 ? "" : "s"} saved to job` });
    }
    // Fire-and-forget AI classification for each newly-created photo. Runs
    // in the background; a single invalidation refreshes tiles when the
    // whole sweep finishes. Failures are silent so a bad AI call never
    // blocks upload.
    if (aiEnabled && createdIds.length > 0) {
      Promise.all(createdIds.map(id => apiRequest("POST", `/api/photos/${id}/classify`, {}).catch(() => null)))
        .then(() => queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "photos"] }));
    }
  };

  // Phase scope: 'both'/undefined shows everything; otherwise only photos
  // tagged with the active phase (null phase treated as 'mitigation').
  const phaseScoped = !phase || phase === "both"
    ? photos
    : photos.filter(p => ((p as any).phase || "mitigation") === phase);

  const categoryCounts = CATEGORIES.reduce<Record<string, number>>((acc, c) => {
    acc[c] = phaseScoped.filter(p => p.category === c).length;
    return acc;
  }, {});

  const filtered = activeFilter === "all" ? phaseScoped : phaseScoped.filter(p => p.category === activeFilter);

  // ── Photo report (PDF) helpers ───────────────────────────────────────
  // Tap a tile in select mode to add/remove it from the report. All selected
  // photos render into a compact multi-page PDF (2 per page in a grid) with
  // caption, category, and timestamp beneath each image.
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllVisible = () => {
    setSelectedIds(new Set(filtered.map(p => p.id)));
  };
  const clearSelection = () => setSelectedIds(new Set());

  // Photo report launcher — swaps in the full three-template PDF engine
  // (adjuster / customer / internal), with optional annotation burn-in,
  // watermark, and share-link creation. The old inline jsPDF layout is
  // preserved as a fallback path when no template is chosen; here we always
  // route through the engine because the toolbar now exposes the template.
  const generateReport = async () => {
    const chosen = filtered.filter(p => selectedIds.has(p.id));
    if (chosen.length === 0) {
      toast({ title: "No photos selected", description: "Tap photos to include them in the report.", variant: "destructive" });
      return;
    }
    setGeneratingReport(true);
    try {
      const blob = await generatePhotoReport({
        jobNumber: String(job?.jobNumber || jobId),
        jobAddress: job?.address || undefined,
        customerName: job?.customerName || job?.customer || undefined,
        template: reportTemplate,
        photos: chosen,
        burnAnnotations: true,
        watermark: reportTemplate === "adjuster" ? "TITAN RESTORATION" : undefined,
      });
      const safe = (s: string) => s.replace(/[^a-zA-Z0-9-_]+/g, "_").slice(0, 60);
      const customerName = job?.customerName || job?.customer || "";
      const nameSlug = customerName ? safe(customerName) : (job?.jobNumber ? safe(String(job.jobNumber)) : `Job_${jobId}`);
      const filename = `Photo_Report_${nameSlug}_${reportTemplate}_${new Date().toISOString().slice(0, 10)}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast({ title: "Report generated", description: `${chosen.length} photo${chosen.length === 1 ? "" : "s"} exported (${reportTemplate}).` });
      setSelectMode(false);
      setSelectedIds(new Set());
    } catch (e: any) {
      toast({ title: "Report failed", description: e?.message || "Try again.", variant: "destructive" });
    } finally {
      setGeneratingReport(false);
    }
  };

  // Create a public share link (share token) for the selected photos and
  // copy it to the clipboard so the tech can paste it to a customer or
  // adjuster right from the field. Server tracks views + last-viewed-at.
  const createShareLink = async () => {
    const chosen = filtered.filter(p => selectedIds.has(p.id));
    if (chosen.length === 0) {
      toast({ title: "No photos selected", description: "Select at least one photo first.", variant: "destructive" });
      return;
    }
    try {
      const res = await apiRequest("POST", `/api/jobs/${jobId}/share-tokens`, {
        template: reportTemplate,
        photoIds: chosen.map(p => p.id),
      });
      const body = await res.json();
      const link = `${window.location.origin}/public/reports/${body.token}`;
      try { await navigator.clipboard.writeText(link); } catch {}
      toast({ title: "Share link copied", description: link });
    } catch (e: any) {
      toast({ title: "Share failed", description: e?.message || "Try again.", variant: "destructive" });
    }
  };

  // Offline-queued photo POSTs for this job (saved on-device, not yet synced).
  const {
    pending: pendingQueue,
    pendingCount,
    failed: failedQueue,
    failedCount,
    oldestPendingAt,
    online,
    retryFailed,
    retryOne,
    discardOne,
  } = useJobQueue(jobId, "/photos");

  // Parse a queued POST body into a renderable thumbnail preview.
  const parseQueued = (q: { id: string; body: string | null; lastError?: string }) => {
    try {
      const b = q.body ? JSON.parse(q.body) : null;
      if (!b || b.jobId !== jobId || !b.dataUrl) return null;
      return {
        id: q.id,
        dataUrl: b.dataUrl as string,
        category: (b.category as string) || "general",
        caption: (b.caption as string) || "",
        lastError: q.lastError,
      };
    } catch {
      return null;
    }
  };
  type PendingPhoto = { id: string; dataUrl: string; category: string; caption: string; lastError?: string };
  const inFilter = (p: PendingPhoto) => activeFilter === "all" || p.category === activeFilter;

  const pendingPhotos = pendingQueue
    .map(parseQueued)
    .filter((x): x is PendingPhoto => x !== null)
    .filter(inFilter);
  const failedPhotos = failedQueue
    .map(parseQueued)
    .filter((x): x is PendingPhoto => x !== null)
    .filter(inFilter);

  // Drag handlers on the outer wrapper so techs can drop files anywhere on
  // the photos tab, not just onto a tiny target. dragenter/dragleave use a
  // small counter to avoid flicker when moving between nested children.
  const dragCounterRef = useRef(0);
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (readOnly) return;
    dragCounterRef.current++;
    if (e.dataTransfer?.items?.length) setDragActive(true);
  };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragActive(false);
    if (readOnly) return;
    // Prefer dataTransfer.files (works for OS-native drag + browser's file
    // picker drops); fall back to items only when files is empty.
    const dropped: File[] = [];
    if (e.dataTransfer?.files?.length) {
      for (const f of Array.from(e.dataTransfer.files)) {
        if (f.type.startsWith("image/")) dropped.push(f);
      }
    }
    if (dropped.length === 0 && e.dataTransfer?.items?.length) {
      for (const item of Array.from(e.dataTransfer.items)) {
        const f = item.getAsFile();
        if (f && f.type.startsWith("image/")) dropped.push(f);
      }
    }
    if (dropped.length > 0) handleFiles(dropped);
  };

  const totalProgress = bulkProgress.length;
  const doneProgress = bulkProgress.filter(p => p.status === "done").length;
  const failedProgress = bulkProgress.filter(p => p.status === "failed").length;
  const progressPct = totalProgress === 0 ? 0 : Math.round((doneProgress + failedProgress) / totalProgress * 100);

  return (
    <div
      className={`space-y-4 relative ${dragActive ? "ring-2 ring-teal-600 rounded-lg" : ""}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Full-panel drop overlay — appears whenever files are being dragged
          over the photos tab. Uses pointer-events:none so it doesn't block
          the drop event from firing on the wrapper. */}
      {dragActive && !readOnly && (
        <div className="pointer-events-none absolute inset-0 z-40 bg-teal-500/10 border-2 border-dashed border-teal-600 rounded-lg flex items-center justify-center">
          <div className="bg-white/95 rounded-lg shadow-lg px-6 py-4 text-center">
            <CloudUpload className="w-8 h-8 text-teal-600 mx-auto mb-1"/>
            <div className="font-semibold text-slate-900">Drop photos to upload</div>
            <div className="text-xs text-slate-600">Tag: {room.trim() || "no room"} · Category: {category}</div>
          </div>
        </div>
      )}

      {/* Bulk-upload progress panel. Renders while an upload batch is in
          flight and briefly after completion so the tech sees the tally.
          Failed rows expose the error message inline. */}
      {bulkProgress.length > 0 && (
        <div className="border rounded-lg bg-white p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">
              Uploading {doneProgress + failedProgress} of {totalProgress}
              {failedProgress > 0 && <span className="text-red-600 ml-2">({failedProgress} failed)</span>}
            </div>
            <div className="text-xs text-slate-500 tabular-nums">{progressPct}%</div>
          </div>
          <div className="h-1.5 bg-slate-100 rounded overflow-hidden">
            <div className="h-full bg-teal-600 transition-all" style={{ width: `${progressPct}%` }}/>
          </div>
          <div className="max-h-32 overflow-y-auto text-xs space-y-0.5">
            {bulkProgress.map((row, i) => (
              <div key={i} className={`flex items-center justify-between gap-2 px-1 py-0.5 rounded ${row.status === "failed" ? "bg-red-50" : row.status === "done" ? "text-slate-500" : ""}`}>
                <span className="truncate flex-1">{row.name}</span>
                <span className={`text-[10px] uppercase font-semibold ${row.status === "failed" ? "text-red-600" : row.status === "done" ? "text-emerald-600" : row.status === "uploading" ? "text-teal-700" : "text-slate-400"}`}>
                  {row.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload bar */}
      {!readOnly && (
        <div className="border rounded-lg p-3 bg-muted/20 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Room</Label>
              <Input
                className="h-8 text-xs mt-1"
                value={room}
                onChange={e => setRoom(e.target.value)}
                list={`room-suggestions-${jobId}`}
                placeholder="Kitchen, Master Bath…"
              />
              {/* Autocomplete off existing rooms already used on this job
                  plus a small set of common defaults. */}
              <datalist id={`room-suggestions-${jobId}`}>
                {Array.from(new Set([
                  ...photos.map((p:any) => p.room).filter(Boolean),
                  "Kitchen", "Living Room", "Master Bath", "Master Bedroom", "Bedroom 2", "Bedroom 3",
                  "Hall Bath", "Laundry", "Garage", "Basement", "Attic", "Dining Room", "Office", "Exterior",
                ])).map(r => <option key={r as string} value={r as string}/>)}
              </datalist>
            </div>
            <div>
              <Label className="text-xs">Caption (optional)</Label>
              <Input
                className="h-8 text-xs mt-1"
                value={caption}
                onChange={e => setCaption(e.target.value)}
                placeholder="Photo description…"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={aiEnabled} onChange={e => setAiEnabled(e.target.checked)}/>
            <Sparkles className="w-3 h-3 text-teal-600"/>
            Auto-tag with AI (room / damage type / severity)
          </label>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => handleFiles(e.target.files)} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={e => handleFiles(e.target.files)} />
            <Button
              size="sm"
              variant="outline"
              className="flex-1 border-[hsl(var(--titan-blue))] text-[hsl(var(--titan-blue))]"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              data-testid="button-upload-photos"
            >
              <Upload className="w-3.5 h-3.5 mr-1.5" />{uploading ? "Uploading…" : "Choose Files"}
            </Button>
            <Button
              size="sm"
              className="flex-1 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
              disabled={uploading}
              onClick={() => cameraRef.current?.click()}
              data-testid="button-take-photo"
            >
              <Camera className="w-3.5 h-3.5 mr-1.5" />Take Photo
            </Button>
          </div>
        </div>
      )}

      {/* Sync status — pending / failed field captures for this job */}
      {(pendingCount > 0 || failedCount > 0 || phaseScoped.length > 0) && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {phaseScoped.length > 0 ? `${phaseScoped.length} photo${phaseScoped.length === 1 ? "" : "s"}` : ""}
          </span>
          <div className="flex items-center gap-1.5">
            {failedCount > 0 && (
              <SyncChip
                count={0}
                failedCount={failedCount}
                online={online}
                onRetry={retryFailed}
                data-testid="sync-chip-photos"
              />
            )}
            {pendingCount > 0 && (
              <SyncChip
                count={pendingCount}
                online={online}
                oldestPendingAt={oldestPendingAt}
                data-testid={failedCount > 0 ? "sync-chip-photos-pending" : "sync-chip-photos"}
              />
            )}
          </div>
        </div>
      )}

      {/* Category filter pills */}
      {phaseScoped.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveFilter("all")}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${activeFilter === "all" ? "bg-[hsl(var(--titan-blue))] text-white border-transparent" : "border-border hover:bg-muted"}`}
          >
            All ({phaseScoped.length})
          </button>
          {CATEGORIES.filter(c => categoryCounts[c] > 0).map(c => (
            <button
              key={c}
              onClick={() => setActiveFilter(c)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${activeFilter === c ? "bg-[hsl(var(--titan-blue))] text-white border-transparent" : "border-border hover:bg-muted"}`}
            >
              {c.charAt(0).toUpperCase() + c.slice(1)} ({categoryCounts[c]})
            </button>
          ))}
        </div>
      )}

      {/* Photo report toolbar — select mode toggle + PDF export.
          Hidden when there are no photos to work with. */}
      {phaseScoped.length > 0 && (
        <div className="flex items-center justify-between gap-2 border rounded-lg bg-muted/30 px-2 py-1.5">
          {selectMode ? (
            <>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium">
                  {selectedIds.size} selected
                </span>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={selectAllVisible} data-testid="button-photos-select-all">
                  Select all visible
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearSelection} data-testid="button-photos-clear-selection">
                  Clear
                </Button>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Template selector — controls which PDF layout + which
                    metadata gets included in the export. Also drives
                    watermark defaults (adjuster reports get one). */}
                <Select value={reportTemplate} onValueChange={v => setReportTemplate(v as any)}>
                  <SelectTrigger className="h-7 text-xs w-[130px]" data-testid="select-report-template">
                    <SelectValue placeholder="Template"/>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="adjuster">Adjuster</SelectItem>
                    <SelectItem value="customer">Customer</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => { setSelectMode(false); clearSelection(); }}
                  data-testid="button-photos-cancel-select"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={createShareLink}
                  disabled={selectedIds.size === 0}
                  data-testid="button-photos-share-link"
                >
                  <Share2 className="w-3.5 h-3.5 mr-1" />
                  Share link
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
                  onClick={generateReport}
                  disabled={generatingReport || selectedIds.size === 0}
                  data-testid="button-photos-generate-report"
                >
                  <FileText className="w-3.5 h-3.5 mr-1" />
                  {generatingReport ? "Generating…" : `Export PDF (${selectedIds.size})`}
                </Button>
              </div>
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">
                Build a PDF report from selected photos.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setSelectMode(true)}
                data-testid="button-photos-enter-select"
              >
                <CheckSquare className="w-3.5 h-3.5 mr-1" />
                Select for report
              </Button>
            </>
          )}
        </div>
      )}

      {/* Photo grid */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="aspect-square bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 && pendingPhotos.length === 0 && failedPhotos.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <FolderOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">{activeFilter === "all" ? "No photos yet — upload the first one above." : `No ${activeFilter} photos yet.`}</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {/* Failed (offline-queued) photos — sync failed, tap to retry */}
          {failedPhotos.map(f => (
            <div
              key={f.id}
              className="relative rounded-lg overflow-hidden border-2 border-red-400 dark:border-red-600 bg-muted aspect-square"
              data-testid={`photo-failed-${f.id}`}
              title={`Sync failed${f.lastError ? ` (${f.lastError})` : ""} — tap retry to try again`}
            >
              <img
                src={f.dataUrl}
                alt={f.caption || "Failed upload"}
                className="w-full h-full object-cover opacity-50"
              />
              <div className="absolute inset-0 bg-red-900/20" />
              <div className="absolute top-1.5 left-1.5">
                <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50/95 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:border-red-700/60 dark:bg-red-950/80 dark:text-red-300">
                  <AlertTriangle className="h-2.5 w-2.5" />Failed
                </span>
              </div>
              <div className="absolute inset-0 flex items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => retryOne(f.id)}
                  className="inline-flex items-center gap-1 rounded-md bg-white/90 hover:bg-white px-2 py-1 text-[11px] font-medium text-red-700 shadow-sm"
                  data-testid={`photo-retry-${f.id}`}
                >
                  <RefreshCw className="h-3 w-3" />Retry
                </button>
                <button
                  type="button"
                  onClick={() => discardOne(f.id)}
                  className="inline-flex items-center rounded-md bg-white/90 hover:bg-white px-2 py-1 text-[11px] font-medium text-muted-foreground shadow-sm"
                  data-testid={`photo-discard-${f.id}`}
                >
                  Discard
                </button>
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLORS[f.category] || "bg-gray-100 text-gray-700"}`}>
                  {f.category}
                </span>
              </div>
            </div>
          ))}
          {/* Pending (offline-queued) photos — saved on-device, awaiting sync */}
          {pendingPhotos.map(pending => (
            <div
              key={pending.id}
              className="relative rounded-lg overflow-hidden border border-amber-300 dark:border-amber-700/60 bg-muted aspect-square"
              data-testid={`photo-pending-${pending.id}`}
              title="Saved on this device — will sync when back online"
            >
              <img
                src={pending.dataUrl}
                alt={pending.caption || "Pending upload"}
                className="w-full h-full object-cover opacity-70"
              />
              <div className="absolute inset-0 bg-amber-900/10" />
              <div className="absolute top-1.5 left-1.5">
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50/95 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/80 dark:text-amber-300">
                  <CloudUpload className="h-2.5 w-2.5" />Queued
                </span>
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLORS[pending.category] || "bg-gray-100 text-gray-700"}`}>
                  {pending.category}
                </span>
              </div>
            </div>
          ))}
          {filtered.map(photo => {
            const takenDate = photo.takenAt ? new Date(photo.takenAt) : null;
            const tileStamp = takenDate && !isNaN(takenDate.getTime())
              ? takenDate.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
              : null;
            const isSelected = selectedIds.has(photo.id);
            return (
              <div
                key={photo.id}
                className={`relative group rounded-lg overflow-hidden border bg-muted aspect-square cursor-pointer ${
                  selectMode && isSelected ? "ring-2 ring-[hsl(var(--titan-blue))] ring-offset-2" : ""
                }`}
                data-testid={`photo-${photo.id}`}
                onClick={() => selectMode ? toggleSelect(photo.id) : setLightbox(photo)}
              >
                <img
                  src={photo.dataUrl}
                  alt={photo.caption || photo.filename}
                  className={`w-full h-full object-cover transition-transform group-hover:scale-105 ${
                    selectMode && !isSelected ? "opacity-70" : ""
                  }`}
                />
                {selectMode ? (
                  <div className="absolute top-1.5 right-1.5 rounded-full bg-white/95 dark:bg-black/80 p-0.5 shadow-sm">
                    {isSelected ? (
                      <CheckSquare className="w-5 h-5 text-[hsl(var(--titan-blue))]" />
                    ) : (
                      <Square className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                ) : (
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <ZoomIn className="w-6 h-6 text-white" />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLORS[photo.category ?? ""] || "bg-gray-100 text-gray-700"}`}>
                      {photo.category}
                    </span>
                    {tileStamp && (
                      <span className="text-[10px] font-medium text-white/95 tabular-nums drop-shadow" title={takenDate!.toLocaleString()}>
                        {tileStamp}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <button
              className="absolute -top-10 right-0 text-white hover:text-gray-300 transition-colors"
              onClick={() => setLightbox(null)}
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={lightbox.dataUrl}
              alt={lightbox.caption || lightbox.filename}
              className="w-full rounded-lg max-h-[75vh] object-contain"
            />
            <div className="mt-3 flex items-center justify-between">
              <div>
                <p className="text-white font-medium text-sm">{lightbox.caption || lightbox.filename}</p>
                <div className="flex flex-wrap gap-2 mt-1 items-center">
                  <Badge className={CATEGORY_COLORS[lightbox.category ?? ""]}>{lightbox.category}</Badge>
                  {lightbox.takenAt && !isNaN(new Date(lightbox.takenAt).getTime()) && (
                    <span className="text-gray-300 text-xs tabular-nums">
                      Taken {new Date(lightbox.takenAt).toLocaleString(undefined, {
                        year: "numeric", month: "short", day: "numeric",
                        hour: "numeric", minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              </div>
              {!readOnly && (
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs bg-white/90"
                    onClick={() => { setAnnotatingPhoto(lightbox); }}
                    data-testid={`button-annotate-photo-${lightbox.id}`}
                  >
                    <Pencil className="w-3.5 h-3.5 mr-1"/> Annotate
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => { if (confirm("Delete this photo?")) deleteMutation.mutate(lightbox.id); }}
                    data-testid={`button-delete-photo-${lightbox.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />Delete
                  </Button>
                </div>
              )}
            </div>

            {/* Editable metadata: room label + floor-plan room link.
                Techs can adjust in the field if AI misclassified or if a
                new room was added to the plan after upload. */}
            {!readOnly && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-white/70 mb-1">Room label</div>
                  <Input
                    defaultValue={(lightbox as any).room || ""}
                    onBlur={e => {
                      const v = e.target.value.trim();
                      if (v !== ((lightbox as any).room || "")) patchPhoto(lightbox.id, { room: v || null });
                    }}
                    placeholder="e.g. Kitchen"
                    className="h-8 text-xs"
                    data-testid={`input-photo-room-${lightbox.id}`}
                  />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-white/70 mb-1">Link to floor-plan room</div>
                  <Select
                    value={((lightbox as any).floorPlanRoomId as string) || "none"}
                    onValueChange={v => patchPhoto(lightbox.id, { floorPlanRoomId: v === "none" ? null : v })}
                  >
                    <SelectTrigger className="h-8 text-xs" data-testid={`select-photo-plan-room-${lightbox.id}`}>
                      <SelectValue placeholder="No link"/>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No link</SelectItem>
                      {floorPlanRooms.map(r => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Annotation overlay */}
      {annotatingPhoto && (
        <PhotoAnnotator
          photo={annotatingPhoto}
          onClose={() => setAnnotatingPhoto(null)}
          onSave={async (json) => {
            await patchPhoto(annotatingPhoto.id, { annotationsJson: json });
            toast({ title: "Annotations saved" });
          }}
        />
      )}
    </div>
  );
}
