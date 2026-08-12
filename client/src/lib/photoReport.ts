/**
 * photoReport.ts — PDF report generator (three templates).
 *
 * Placeholder shim wired to the existing jsPDF flow; the full three-template
 * engine (adjuster / customer / internal) with room grouping, EXIF footer,
 * comparison pages, and optional watermark lands in commit 2.
 *
 * The signature is stable so the client call site doesn't need to change
 * when we swap the internals.
 */
import jsPDF from "jspdf";
import type { Photo } from "@shared/schema";

export type ReportTemplate = "adjuster" | "customer" | "internal";

export interface ReportOptions {
  template: ReportTemplate;
  photos: Photo[];
  job?: { jobNumber?: string; customer?: string; address?: string };
  brandLogoDataUrl?: string;
  companyPhone?: string;
  burnInMeta?: boolean;
  floorPlanJson?: string | null;
}

export async function generatePhotoReport(opts: ReportOptions): Promise<Blob> {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const pad = 36;

  // Cover
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(templateTitle(opts.template), pad, pad + 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  const meta = [
    opts.job?.customer ? `Customer: ${opts.job.customer}` : "",
    opts.job?.address ? `Address: ${opts.job.address}` : "",
    opts.job?.jobNumber ? `Job #: ${opts.job.jobNumber}` : "",
    `Generated: ${new Date().toLocaleString()}`,
    `Photos: ${opts.photos.length}`,
  ].filter(Boolean);
  meta.forEach((t, i) => doc.text(t, pad, pad + 60 + i * 16));

  // Group by room (falls back to "Unassigned").
  const byRoom = new Map<string, Photo[]>();
  for (const p of opts.photos) {
    const key = (p as any).room?.trim() || "Unassigned";
    if (!byRoom.has(key)) byRoom.set(key, []);
    byRoom.get(key)!.push(p);
  }

  for (const [room, list] of byRoom) {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(room, pad, pad + 10);
    let y = pad + 30;
    for (const p of list) {
      if (y > H - 260) { doc.addPage(); y = pad; }
      try {
        const dataUrl = (p as any).dataUrl || "";
        if (dataUrl) doc.addImage(dataUrl, "JPEG", pad, y, W - pad * 2, 200, undefined, "FAST");
      } catch { /* ignore bad images */ }
      y += 210;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const captionParts = [
        (p as any).caption || (p as any).filename || "",
        (p as any).category ? `[${(p as any).category}]` : "",
        (p as any).damageType ? `${(p as any).damageType}${(p as any).severity ? ` / ${(p as any).severity}` : ""}` : "",
      ].filter(Boolean).join(" · ");
      doc.text(captionParts.slice(0, 120), pad, y);
      y += 14;
      if (opts.burnInMeta) {
        const footer = [
          (p as any).originalTakenAt ? new Date((p as any).originalTakenAt).toLocaleString() : (p as any).takenAt,
          (p as any).latitude && (p as any).longitude ? `${(p as any).latitude},${(p as any).longitude}` : "",
          (p as any).deviceModel || "",
        ].filter(Boolean).join(" · ");
        doc.setFontSize(8);
        doc.setTextColor(120);
        doc.text(footer.slice(0, 140), pad, y);
        doc.setTextColor(0);
        y += 14;
      }
      y += 8;
    }
  }
  return doc.output("blob");
}

function templateTitle(t: ReportTemplate) {
  return t === "adjuster" ? "Insurance / Adjuster Report"
       : t === "customer" ? "Customer Progress Report"
       : "Internal QA Report";
}
