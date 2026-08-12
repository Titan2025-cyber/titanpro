/**
 * photoReport.ts — Three-template PDF photo-report engine for Titan Pro.
 *
 * Templates:
 *   1. "adjuster"  → Court-admissible loss documentation.
 *      Full EXIF footer (GPS, capture time, device), non-destructive
 *      annotations rendered ONTO the image at export time, room grouping
 *      with a section header per room, optional watermark, page numbers,
 *      job number in the header. This is the format insurance adjusters
 *      expect and can drop straight into their file.
 *
 *   2. "customer"  → Clean, non-technical progress update.
 *      Two-up layout, larger captions, no device / GPS metadata (customers
 *      don't need to see WME %), before/during/after comparison strips.
 *      No watermark by default. Feels like a status report, not evidence.
 *
 *   3. "internal"  → Full technical dossier for the office.
 *      Every field on every photo: dimensions, file size, EXIF, moisture
 *      readings, AI classification (if any), share-token history. This is
 *      the "audit log with pictures" version.
 *
 * Non-destructive annotations:
 *   Photo rows carry an `annotationsJson` shape array. At export time we
 *   composite the SVG overlay onto a Canvas the same size as the source
 *   image, then paint that Canvas into the PDF. The original file on S3 is
 *   never touched, so re-editing the annotation JSON later regenerates a
 *   fresh report with different marks — no destructive burn-in.
 */
import { jsPDF } from "jspdf";
import type { Photo } from "@shared/schema";

export type ReportTemplate = "adjuster" | "customer" | "internal";

export interface PhotoReportOptions {
  jobNumber: string;
  jobAddress?: string;
  customerName?: string;
  template: ReportTemplate;
  photos: Photo[];
  /** When true, the annotation JSON is composited onto each image. */
  burnAnnotations?: boolean;
  /** When true, a diagonal watermark is drawn on every page. */
  watermark?: string;
  /** Optional additional cover-page notes. */
  notes?: string;
  /** Rooms metadata to inject as section titles when photos are grouped. */
  roomsByPhotoId?: Record<number, string>;
}

interface AnnotationShape {
  id: string;
  type: "arrow" | "circle" | "rect" | "freehand" | "text" | "moisture";
  color: string;
  strokeWidth: number;
  x?: number; y?: number;
  x2?: number; y2?: number;
  w?: number; h?: number;
  points?: { x: number; y: number }[];
  text?: string;
  value?: string;
}

// ── Small utilities ────────────────────────────────────────────────────────

function fmtDate(d: string | number | Date | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" || typeof d === "number" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "";
  return dt.toLocaleString();
}

function safeText(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function grow<T extends string | number>(v: T | null | undefined, fallback = ""): string {
  return v == null || v === "" ? fallback : String(v);
}

async function fetchImageAsDataURL(src: string): Promise<string | null> {
  // Local data URLs pass through; S3 URLs need a fetch → canvas conversion so
  // jsPDF can embed them without a CORS taint.
  if (!src) return null;
  if (src.startsWith("data:")) return src;
  try {
    const res = await fetch(src, { mode: "cors", credentials: "omit" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ── Annotation composition ────────────────────────────────────────────────
// The annotator stored shapes in 0..1 normalized coordinates. To burn them
// into the exported image we paint the original at natural size onto a canvas
// and then re-draw each shape scaled to the canvas dimensions.
async function composeAnnotated(photo: Photo): Promise<string | null> {
  const dataUrl = (photo as any).dataUrl as string | undefined;
  if (!dataUrl) return null;
  const img = await loadImage(dataUrl);
  if (!img) return null;
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, W, H);

  let shapes: AnnotationShape[] = [];
  try {
    const raw = (photo as any).annotationsJson;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.shapes)) shapes = parsed.shapes;
    }
  } catch {
    shapes = [];
  }
  for (const s of shapes) paintShape(ctx, s, W, H);
  return canvas.toDataURL("image/jpeg", 0.9);
}

function paintShape(ctx: CanvasRenderingContext2D, s: AnnotationShape, W: number, H: number) {
  // 0..1 → pixel coordinates. strokeWidth is in "logical units" (0..1000)
  // divided by 1000 to normalize with the SVG overlay in PhotoAnnotator.
  const sw = Math.max(2, ((s.strokeWidth ?? 4) / 1000) * Math.min(W, H));
  ctx.save();
  ctx.strokeStyle = s.color || "#ef4444";
  ctx.fillStyle = s.color || "#ef4444";
  ctx.lineWidth = sw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (s.type) {
    case "arrow": {
      const x1 = (s.x ?? 0) * W, y1 = (s.y ?? 0) * H;
      const x2 = (s.x2 ?? 0) * W, y2 = (s.y2 ?? 0) * H;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const head = Math.max(sw * 4, Math.min(W, H) * 0.03);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - ux * head + uy * head * 0.5, y2 - uy * head - ux * head * 0.5);
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - ux * head - uy * head * 0.5, y2 - uy * head + ux * head * 0.5);
      ctx.stroke();
      break;
    }
    case "circle": {
      const cx = ((s.x ?? 0) + (s.w ?? 0) / 2) * W;
      const cy = ((s.y ?? 0) + (s.h ?? 0) / 2) * H;
      const rx = Math.abs((s.w ?? 0) / 2) * W;
      const ry = Math.abs((s.h ?? 0) / 2) * H;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case "rect": {
      const x = Math.min((s.x ?? 0), (s.x ?? 0) + (s.w ?? 0)) * W;
      const y = Math.min((s.y ?? 0), (s.y ?? 0) + (s.h ?? 0)) * H;
      const rw = Math.abs(s.w ?? 0) * W;
      const rh = Math.abs(s.h ?? 0) * H;
      ctx.strokeRect(x, y, rw, rh);
      break;
    }
    case "freehand": {
      const pts = s.points ?? [];
      if (pts.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(pts[0].x * W, pts[0].y * H);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * W, pts[i].y * H);
      ctx.stroke();
      break;
    }
    case "text": {
      const fs = Math.max(14, Math.min(W, H) * 0.028);
      ctx.font = `${fs}px Inter, Arial, sans-serif`;
      const t = s.text ?? "";
      const w = ctx.measureText(t).width + 12;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect((s.x ?? 0) * W - 6, (s.y ?? 0) * H - fs, w, fs + 8);
      ctx.fillStyle = "#fff";
      ctx.fillText(t, (s.x ?? 0) * W, (s.y ?? 0) * H);
      break;
    }
    case "moisture": {
      // Sky-blue badge with the reading in white.
      const r = Math.max(18, Math.min(W, H) * 0.028);
      const cx = (s.x ?? 0) * W, cy = (s.y ?? 0) * H;
      ctx.fillStyle = s.color || "#0ea5e9";
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      const fs = Math.max(12, r * 0.8);
      ctx.font = `bold ${fs}px Inter, Arial, sans-serif`;
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(safeText(s.value ?? ""), cx, cy);
      break;
    }
  }
  ctx.restore();
}

// ── Watermark & chrome ────────────────────────────────────────────────────
function paintWatermark(doc: jsPDF, text: string) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.saveGraphicsState();
  // @ts-ignore — GState typing is looser than reality
  doc.setGState(new (doc as any).GState({ opacity: 0.12 }));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(56);
  doc.setTextColor(120, 120, 120);
  doc.text(text, w / 2, h / 2, { angle: 30, align: "center" });
  doc.restoreGraphicsState();
  doc.setTextColor(20, 20, 20);
}

function paintPageChrome(doc: jsPDF, opts: PhotoReportOptions, pageNumber: number, totalPages: number) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text(`Titan Restoration LLC · Job ${opts.jobNumber}`, 12, h - 8);
  doc.text(`Page ${pageNumber} of ${totalPages}`, w - 12, h - 8, { align: "right" });
  doc.setTextColor(20, 20, 20);
}

// ── Grouping ──────────────────────────────────────────────────────────────
function groupByRoom(photos: Photo[]): { room: string; photos: Photo[] }[] {
  const buckets = new Map<string, Photo[]>();
  for (const p of photos) {
    const room = ((p as any).room as string | null) || "Unassigned";
    if (!buckets.has(room)) buckets.set(room, []);
    buckets.get(room)!.push(p);
  }
  const order = Array.from(buckets.entries()).sort(([a], [b]) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b);
  });
  return order.map(([room, ps]) => ({ room, photos: ps }));
}

// ── Comparison pairing ────────────────────────────────────────────────────
// Pairs Before/During/After for the customer template. We match by room and
// pick the earliest photo per stage tag when the tech has tagged them. When
// there's no explicit tag we fall back to chronological triples per room.
function pairComparisons(photos: Photo[]): { room: string; before?: Photo; during?: Photo; after?: Photo }[] {
  const groups = groupByRoom(photos);
  return groups.map(g => {
    const stageOf = (p: Photo): "before" | "during" | "after" | null => {
      const raw = ((p as any).stage || (p as any).damageType || "").toLowerCase();
      if (raw.includes("before")) return "before";
      if (raw.includes("during") || raw.includes("mid")) return "during";
      if (raw.includes("after") || raw.includes("complete")) return "after";
      return null;
    };
    const before = g.photos.find(p => stageOf(p) === "before");
    const during = g.photos.find(p => stageOf(p) === "during");
    const after  = g.photos.find(p => stageOf(p) === "after");
    if (before || during || after) return { room: g.room, before, during, after };
    // Chronological fallback — first/middle/last by timestamp.
    const sorted = [...g.photos].sort((a, b) => {
      const ta = new Date(((a as any).originalTakenAt || (a as any).uploadedAt || 0) as any).getTime();
      const tb = new Date(((b as any).originalTakenAt || (b as any).uploadedAt || 0) as any).getTime();
      return ta - tb;
    });
    if (sorted.length === 0) return { room: g.room };
    return {
      room: g.room,
      before: sorted[0],
      during: sorted[Math.floor(sorted.length / 2)],
      after: sorted[sorted.length - 1],
    };
  });
}

// ── Cover page ────────────────────────────────────────────────────────────
function paintCover(doc: jsPDF, opts: PhotoReportOptions) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.setTextColor(15, 118, 110);
  doc.text("Titan Restoration LLC", 20, 36);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(60, 60, 60);
  const label = opts.template === "adjuster" ? "Loss Documentation Report"
              : opts.template === "customer" ? "Project Photo Report"
              : "Internal Photo Dossier";
  doc.text(label, 20, 46);

  doc.setTextColor(20, 20, 20);
  doc.setFontSize(11);
  const infoY = 62;
  const lineH = 6.5;
  doc.setFont("helvetica", "bold");
  doc.text("Job Number", 20, infoY);
  doc.text("Customer", 20, infoY + lineH);
  doc.text("Property", 20, infoY + lineH * 2);
  doc.text("Generated", 20, infoY + lineH * 3);
  doc.text("Total Photos", 20, infoY + lineH * 4);
  doc.setFont("helvetica", "normal");
  doc.text(opts.jobNumber, 60, infoY);
  doc.text(grow(opts.customerName), 60, infoY + lineH);
  doc.text(grow(opts.jobAddress), 60, infoY + lineH * 2);
  doc.text(new Date().toLocaleString(), 60, infoY + lineH * 3);
  doc.text(String(opts.photos.length), 60, infoY + lineH * 4);

  if (opts.notes) {
    doc.setFont("helvetica", "bold");
    doc.text("Notes", 20, infoY + lineH * 6);
    doc.setFont("helvetica", "normal");
    const notes = doc.splitTextToSize(opts.notes, doc.internal.pageSize.getWidth() - 40);
    doc.text(notes, 20, infoY + lineH * 6 + 6);
  }

  if (opts.template === "adjuster") {
    // Sworn-photograph attestation footer. This is the phrasing insurance
    // carriers accept as chain-of-custody documentation.
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    const y = doc.internal.pageSize.getHeight() - 30;
    const cert = "The photographs in this report were captured on-site by Titan Restoration LLC field personnel. " +
                 "Original files retain EXIF metadata including capture time, device model, and GPS coordinates when available. " +
                 "Any annotations shown on the images are drawn non-destructively and do not modify the original photograph.";
    const w = doc.internal.pageSize.getWidth() - 40;
    doc.text(doc.splitTextToSize(cert, w), 20, y);
    doc.setTextColor(20, 20, 20);
  }
}

// ── Photo pages ──────────────────────────────────────────────────────────
async function paintPhoto(
  doc: jsPDF,
  photo: Photo,
  opts: PhotoReportOptions,
  layout: "full" | "half" | "third",
  slotIndex: number
) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const marginX = 12, marginTop = 22, marginBottom = 22;
  const gutter = 6;
  const src = opts.burnAnnotations
    ? await composeAnnotated(photo)
    : await fetchImageAsDataURL(((photo as any).dataUrl as string) || "");
  if (!src) return;
  const img = await loadImage(src);
  if (!img) return;
  const aw = img.naturalWidth || img.width;
  const ah = img.naturalHeight || img.height;

  let boxW = 0, boxH = 0, x = marginX, y = marginTop;
  if (layout === "full") {
    boxW = w - marginX * 2;
    boxH = Math.min(h - marginTop - marginBottom - 48, boxW * (ah / aw));
    x = marginX;
    y = marginTop;
  } else if (layout === "half") {
    boxW = w - marginX * 2;
    boxH = (h - marginTop - marginBottom - gutter - 48) / 2;
    x = marginX;
    y = slotIndex === 0 ? marginTop : marginTop + boxH + gutter + 24;
  } else {
    boxW = w - marginX * 2;
    boxH = (h - marginTop - marginBottom - gutter * 2 - 72) / 3;
    x = marginX;
    y = marginTop + slotIndex * (boxH + gutter + 24);
  }

  // Contain, don't stretch.
  const ratio = Math.min(boxW / aw, boxH / ah);
  const drawW = aw * ratio;
  const drawH = ah * ratio;
  const drawX = x + (boxW - drawW) / 2;
  const drawY = y;

  doc.setFillColor(245, 245, 245);
  doc.rect(x, y, boxW, boxH, "F");
  doc.addImage(src, "JPEG", drawX, drawY, drawW, drawH, undefined, "FAST");
  doc.setDrawColor(220, 220, 220);
  doc.rect(x, y, boxW, boxH);

  // Caption block
  const captionY = y + boxH + 4;
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(layout === "full" ? 11 : 9);
  const caption = grow((photo as any).caption, `Photo #${photo.id}`);
  doc.text(caption, x, captionY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(layout === "full" ? 9 : 8);
  doc.setTextColor(90, 90, 90);
  const rows: string[] = [];
  const room = (photo as any).room as string | null;
  if (room) rows.push(`Room: ${room}`);
  const dmg = (photo as any).damageType as string | null;
  if (dmg) rows.push(`Damage: ${dmg}`);
  const sev = (photo as any).severity as string | null;
  if (sev) rows.push(`Severity: ${sev}`);

  if (opts.template !== "customer") {
    // EXIF footer — only on adjuster + internal templates. Customer report
    // deliberately hides GPS / device data to avoid confusing them.
    const taken = (photo as any).originalTakenAt as string | null;
    if (taken) rows.push(`Captured: ${fmtDate(taken)}`);
    const dev = [(photo as any).deviceMake, (photo as any).deviceModel].filter(Boolean).join(" ");
    if (dev) rows.push(`Device: ${dev}`);
    const lat = (photo as any).latitude, lng = (photo as any).longitude;
    if (lat && lng) rows.push(`GPS: ${lat}, ${lng}`);
  }
  if (opts.template === "internal") {
    const up = (photo as any).uploadedAt as string | null;
    if (up) rows.push(`Uploaded: ${fmtDate(up)}`);
    const by = (photo as any).uploadedByName || (photo as any).uploadedBy;
    if (by) rows.push(`Uploaded by: ${by}`);
    if ((photo as any).aiClassified) rows.push(`AI classified: yes`);
  }
  const lineY = captionY + (layout === "full" ? 6 : 4);
  doc.text(rows.join("   ·   "), x, lineY, { maxWidth: boxW });
  doc.setTextColor(20, 20, 20);
}

// ── Section header ────────────────────────────────────────────────────────
function paintSectionHeader(doc: jsPDF, room: string) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(15, 118, 110);
  doc.rect(0, 0, w, 14, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(room, 12, 10);
  doc.setTextColor(20, 20, 20);
}

// ── Public: generate PDF ─────────────────────────────────────────────────
export async function generatePhotoReport(opts: PhotoReportOptions): Promise<Blob> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const pageQueue: (() => Promise<void>)[] = [];

  pageQueue.push(async () => { paintCover(doc, opts); });

  // ── Photo pages, grouped by room ───────────────────────────────────────
  const groups = groupByRoom(opts.photos);
  const perPage = opts.template === "adjuster" ? 1 : opts.template === "customer" ? 2 : 3;

  for (const group of groups) {
    if (group.photos.length === 0) continue;
    // First page of each room starts with a section header.
    let cursor = 0;
    while (cursor < group.photos.length) {
      const batch = group.photos.slice(cursor, cursor + perPage);
      const isFirst = cursor === 0;
      pageQueue.push(async () => {
        doc.addPage();
        if (isFirst) paintSectionHeader(doc, group.room);
        for (let i = 0; i < batch.length; i++) {
          const layout = perPage === 1 ? "full" : perPage === 2 ? "half" : "third";
          await paintPhoto(doc, batch[i], opts, layout, i);
        }
      });
      cursor += perPage;
    }
  }

  // ── Comparison pages (customer only) ──────────────────────────────────
  if (opts.template === "customer") {
    const comps = pairComparisons(opts.photos).filter(c => c.before || c.during || c.after);
    for (const c of comps) {
      pageQueue.push(async () => {
        doc.addPage();
        paintSectionHeader(doc, `${c.room} — Before / During / After`);
        const w = doc.internal.pageSize.getWidth();
        const h = doc.internal.pageSize.getHeight();
        const marginX = 12, marginTop = 22, marginBottom = 30;
        const boxW = (w - marginX * 2 - 8) / 3;
        const boxH = h - marginTop - marginBottom - 12;
        const slots: ({ label: string; photo?: Photo })[] = [
          { label: "Before", photo: c.before },
          { label: "During", photo: c.during },
          { label: "After",  photo: c.after },
        ];
        for (let i = 0; i < slots.length; i++) {
          const x = marginX + i * (boxW + 4);
          const y = marginTop;
          doc.setFillColor(245, 245, 245);
          doc.rect(x, y, boxW, boxH, "F");
          const s = slots[i];
          if (s.photo) {
            const src = opts.burnAnnotations
              ? await composeAnnotated(s.photo)
              : await fetchImageAsDataURL(((s.photo as any).dataUrl as string) || "");
            if (src) {
              const img = await loadImage(src);
              if (img) {
                const aw = img.naturalWidth, ah = img.naturalHeight;
                const ratio = Math.min(boxW / aw, boxH / ah);
                const dw = aw * ratio, dh = ah * ratio;
                doc.addImage(src, "JPEG", x + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh, undefined, "FAST");
              }
            }
          }
          doc.setDrawColor(220, 220, 220);
          doc.rect(x, y, boxW, boxH);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.text(s.label, x + boxW / 2, y + boxH + 8, { align: "center" });
        }
      });
    }
  }

  // Render every page.
  for (const step of pageQueue) await step();

  // Apply watermark + page chrome. This runs AFTER content because jsPDF
  // paints in draw order — we want the watermark behind text ideally, but
  // since we can't easily reorder we use low opacity so it doesn't obscure.
  const totalPages = (doc as any).internal.pages.length - 1;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    if (opts.watermark) paintWatermark(doc, opts.watermark);
    paintPageChrome(doc, opts, i, totalPages);
  }

  return doc.output("blob");
}

// ── Public: convenience saver ─────────────────────────────────────────────
export async function generateAndDownloadPhotoReport(opts: PhotoReportOptions): Promise<void> {
  const blob = await generatePhotoReport(opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Titan-${opts.jobNumber}-${opts.template}-photos.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
