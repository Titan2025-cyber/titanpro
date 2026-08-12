/**
 * JobPhotos.tsx — Per-job photo module
 * Embedded directly in JobDetail tabs and Technician view.
 * Supports camera capture, file upload, categorized viewing, and deletion.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Camera, Upload, Trash2, FolderOpen, X, ZoomIn, CloudUpload, AlertTriangle, RefreshCw, FileText, CheckSquare, Square, MapPin, Sparkles, Pencil, Share2, Mic, MicOff } from "lucide-react";
import jsPDF from "jspdf";
import { extractExif, fileToDataUrl } from "@/lib/photoExif";
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

  // Load a data URL into an HTMLImageElement so we can draw it to a canvas.
  const loadImage = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });

  // Burn a bottom-right date/time watermark onto the photo. Uses a dark pill
  // behind white text so it stays legible on any background. Downscales the
  // longest edge to 2048px to keep base64 payloads reasonable for SQLite.
  const stampPhoto = async (dataUrl: string, takenAt: Date): Promise<string> => {
    const img = await loadImage(dataUrl);
    const maxEdge = 2048;
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);

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

    // JPEG @ 0.9 keeps quality high while shrinking base64 by ~4x vs PNG.
    return canvas.toDataURL("image/jpeg", 0.9);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    let successCount = 0;
    const createdIds: number[] = [];
    for (const file of Array.from(files)) {
      // ── EXIF FIRST ── Extract camera GPS + original timestamp + device before
      // we downscale/re-encode. This preserves the evidentiary chain: even if
      // we compress the pixels, the coordinates + capture time are the
      // camera's own, not the server clock.
      const exif = await extractExif(file);

      // Prefer the camera's DateTimeOriginal, then the file's lastModified,
      // then wall-clock now.
      const shutterMs = exif.originalTakenAt
        ? new Date(exif.originalTakenAt).getTime()
        : (file.lastModified && file.lastModified > 0 ? file.lastModified : Date.now());
      const takenAt = new Date(shutterMs);

      // Downscale huge camera images (up to 12MP+) to 1800px long edge before
      // base64 encoding. Cuts payload size by ~10x with no perceptible loss.
      let dataUrl: string;
      try {
        dataUrl = await fileToDataUrl(file, 1800, 0.85);
      } catch {
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }

      let stamped = dataUrl;
      try {
        stamped = await stampPhoto(dataUrl, takenAt);
      } catch {
        // If canvas stamping fails (very old browser, huge file), fall back
        // to the original bytes — takenAt is still recorded on the record.
      }

      try {
        const res = await apiRequest("POST", "/api/photos", {
          jobId,
          filename: file.name,
          dataUrl: stamped,
          caption: caption || file.name,
          category,
          phase: phase && phase !== "both" ? phase : "mitigation",
          takenAt: takenAt.toISOString(),
          // New enrichment fields — EXIF-derived when available, room from the
          // shared uploader input.
          latitude: exif.latitude || null,
          longitude: exif.longitude || null,
          originalTakenAt: exif.originalTakenAt || null,
          deviceMake: exif.deviceMake || null,
          deviceModel: exif.deviceModel || null,
          room: room.trim() || null,
        });
        const created = await res.json().catch(() => null);
        if (created?.id) createdIds.push(created.id);
        queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "photos"] });
        successCount++;
      } catch (e) {
        toast({ title: "Upload failed", variant: "destructive" });
      }
    }
    setUploading(false);
    setCaption("");
    if (successCount > 0) {
      toast({ title: `${successCount} photo${successCount === 1 ? "" : "s"} saved to job` });
    }
    // Fire-and-forget AI classification for each newly-created photo. Runs in
    // the background; a query invalidation refreshes the tiles when each one
    // finishes. Failures are silent so a bad AI call never blocks upload.
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

  const generateReport = async () => {
    const chosen = filtered.filter(p => selectedIds.has(p.id));
    if (chosen.length === 0) {
      toast({ title: "No photos selected", description: "Tap photos to include them in the report.", variant: "destructive" });
      return;
    }
    setGeneratingReport(true);
    try {
      const doc = new jsPDF({ unit: "mm", format: "letter" });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 12;
      const gap = 8;
      // 2-up layout: two photos per page, stacked vertically. Each half gets
      // ~40% of page height for the image and ~10% for the caption block.
      const halfH = (pageH - margin * 2 - gap) / 2;
      const imgH = halfH * 0.72;
      const captionH = halfH - imgH;
      const imgW = pageW - margin * 2;

      // ── Cover page ───────────────────────────────────────────────────────
      // Titan-branded header + real job info pulled from /api/jobs/:id so the
      // customer, adjuster, carrier, and loss context appear on the first page.
      const HDR_BLUE = [0, 82, 158] as [number, number, number];
      const HDR_RED = [204, 0, 0] as [number, number, number];
      const TEXT = [24, 32, 48] as [number, number, number];
      const MUTED = [110, 116, 128] as [number, number, number];

      // Header band
      doc.setFillColor(...HDR_BLUE);
      doc.rect(0, 0, pageW, 22, "F");
      doc.setFillColor(...HDR_RED);
      doc.rect(0, 22, pageW, 1.5, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("TITAN RESTORATION", margin, 14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("Photo Documentation Report", pageW - margin, 14, { align: "right" });

      // Title
      doc.setTextColor(...TEXT);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      const customerName = job?.customerName || job?.customer || "";
      const heading = customerName ? customerName : `Job ${job?.jobNumber || jobId}`;
      doc.text(heading, margin, 40);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(...MUTED);
      const subline = job?.address
        ? job.address
        : `Job report — ${new Date().toLocaleDateString()}`;
      doc.text(subline, margin, 47);

      // Job details — two-column key/value list
      const startY = 62;
      const colGap = 4;
      const colW = (pageW - margin * 2 - colGap) / 2;
      const rows: Array<[string, string]> = [];
      const push = (label: string, value: any) => {
        const s = value == null || value === "" ? "" : String(value).trim();
        if (s) rows.push([label, s]);
      };
      push("Job Number", job?.jobNumber);
      push("Loss Type", job?.lossType);
      push("Status", job?.status);
      push("Stage", job?.progressStage);
      push("Customer", job?.customerName || job?.customer);
      push("Phone", job?.customerPhone);
      push("Email", job?.customerEmail);
      push("Address", job?.address);
      push("Insurance Carrier", job?.insuranceCarrier);
      push("Claim #", job?.claimNumber);
      push("Policy #", job?.policyNumber);
      push("Adjuster", job?.adjusterName);
      push("Adjuster Phone", job?.adjusterPhone);
      push("Adjuster Email", job?.adjusterEmail);
      push("Assigned Tech", job?.assignedTech);

      doc.setFontSize(9);
      let y = startY;
      const lineH = 5.2;
      for (let i = 0; i < rows.length; i += 2) {
        const left = rows[i];
        const right = rows[i + 1];
        // Left column
        doc.setTextColor(...MUTED);
        doc.setFont("helvetica", "normal");
        doc.text(left[0].toUpperCase(), margin, y);
        doc.setTextColor(...TEXT);
        doc.setFont("helvetica", "bold");
        doc.text(doc.splitTextToSize(left[1], colW - 2), margin, y + lineH);
        // Right column
        if (right) {
          doc.setTextColor(...MUTED);
          doc.setFont("helvetica", "normal");
          doc.text(right[0].toUpperCase(), margin + colW + colGap, y);
          doc.setTextColor(...TEXT);
          doc.setFont("helvetica", "bold");
          doc.text(doc.splitTextToSize(right[1], colW - 2), margin + colW + colGap, y + lineH);
        }
        y += lineH * 2 + 3;
        if (y > pageH - 40) break;   // don't overflow onto photo section
      }

      // Bottom meta — photo count + generation timestamp
      doc.setFontSize(9);
      doc.setTextColor(...MUTED);
      doc.setFont("helvetica", "normal");
      doc.text(
        `${chosen.length} photo${chosen.length === 1 ? "" : "s"} included • Generated ${new Date().toLocaleString()}`,
        pageW / 2,
        pageH - 12,
        { align: "center" }
      );

      // Photo pages
      const pageHeaderText = [
        customerName || `Job ${job?.jobNumber || jobId}`,
        job?.jobNumber && customerName ? `Job ${job.jobNumber}` : null,
        job?.address || null,
      ].filter(Boolean).join("  •  ");

      for (let i = 0; i < chosen.length; i++) {
        const photo = chosen[i];
        const slot = i % 2;
        if (slot === 0) {
          doc.addPage();
          // Slim header bar with customer + job on every photo page.
          doc.setFillColor(...HDR_BLUE);
          doc.rect(0, 0, pageW, 8, "F");
          doc.setTextColor(255, 255, 255);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text(pageHeaderText, margin, 5.5);
          doc.setFont("helvetica", "normal");
          doc.text(`Page ${doc.getNumberOfPages() - 1}`, pageW - margin, 5.5, { align: "right" });
          doc.setTextColor(...TEXT);
        }
        const y0 = margin + 4 + slot * (halfH + gap);

        // Image — jsPDF accepts data URIs directly for JPEG/PNG.
        try {
          const dataUrl = photo.dataUrl;
          const fmt = dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
          // Preserve aspect ratio by fitting into the imgW x imgH box.
          doc.addImage(dataUrl, fmt, margin, y0, imgW, imgH, undefined, "FAST");
        } catch (e) {
          doc.setFontSize(9);
          doc.text(`[image failed to load: ${photo.filename || photo.id}]`, margin + 2, y0 + 10);
        }

        // Caption block
        const capY = y0 + imgH + 5;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        const line1 = photo.caption?.trim() || photo.filename || `Photo ${photo.id}`;
        doc.text(doc.splitTextToSize(line1, imgW), margin, capY);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        const parts: string[] = [];
        if (photo.category) parts.push(photo.category.charAt(0).toUpperCase() + photo.category.slice(1));
        if (photo.takenAt) {
          const t = new Date(photo.takenAt);
          if (!isNaN(t.getTime())) parts.push(t.toLocaleString());
        }
        if (parts.length) doc.text(parts.join(" • "), margin, capY + 5);
      }

      // Build a human-friendly filename from real job info.
      const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
      const nameSlug = customerName ? safe(customerName) : (job?.jobNumber ? safe(String(job.jobNumber)) : `Job_${jobId}`);
      const filename = `Photo_Report_${nameSlug}_${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(filename);
      toast({ title: "Report generated", description: `${chosen.length} photo${chosen.length === 1 ? "" : "s"} exported as PDF.` });
      // Exit select mode after successful export.
      setSelectMode(false);
      setSelectedIds(new Set());
    } catch (e: any) {
      toast({ title: "Report failed", description: e?.message || "Try again.", variant: "destructive" });
    } finally {
      setGeneratingReport(false);
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

  return (
    <div className="space-y-4">
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
              <div className="flex items-center gap-1.5">
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
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => { if (confirm("Delete this photo?")) deleteMutation.mutate(lightbox.id); }}
                  data-testid={`button-delete-photo-${lightbox.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />Delete
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
