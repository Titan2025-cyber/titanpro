/**
 * documentPacket.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Print / combine job-file documents into a single branded PDF packet.
 *
 * Two public helpers:
 *   • buildJobDocumentPacket(job, contact, documents)  → base64 PDF data URI
 *       - Branded cover page (Titan Restoration LLC) listing every document
 *       - For each signed form / non-PDF doc: a rendered detail page
 *         (form fields + electronic signature image)
 *       - For each uploaded PDF (fileData): the actual PDF pages, merged in
 *         via pdf-lib so the packet is ONE continuous file.
 *   • printSingleDocument(doc)  → open + print a single document
 *
 * jsPDF renders the cover + form pages; pdf-lib merges everything.
 * All heavy libs are dynamically imported so they only load when a user
 * actually prints — keeping the JobDetail page fast.
 */

import type { JobDocument, Job, Contact } from "@shared/schema";

// Titan brand colors
const RED = { r: 204, g: 0, b: 0 };
const BLUE = { r: 30, g: 90, b: 180 };

/** jsPDF Helvetica is Latin-1 only — strip characters it can't render. */
function asciiSafe(s: unknown): string {
  return String(s ?? "")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x00-\xFF]/g, "");
}

const DOC_TYPE_LABEL: Record<string, string> = {
  work_authorization: "Work Authorization",
  deviation_of_standard: "Deviation of Standard",
  right_to_renovate: "Right to Renovate",
  certificate_of_completion: "Certificate of Completion",
  pdf_upload: "Uploaded PDF Document",
  other: "Document",
};

function docLabel(doc: JobDocument): string {
  return DOC_TYPE_LABEL[doc.docType] || DOC_TYPE_LABEL.other;
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return "";
  return dt.toLocaleString();
}

export interface CompanyCamPhoto {
  id: string;
  uri: string;
  captured_at?: string;
  project_id?: string;
}

/** Fetch a remote image URL and return a PNG/JPEG data URI (or null on failure). */
async function fetchImageDataUri(url: string): Promise<{ dataUri: string; format: "PNG" | "JPEG" } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const format: "PNG" | "JPEG" = /png/i.test(blob.type) ? "PNG" : "JPEG";
    const dataUri: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return { dataUri, format };
  } catch {
    return null;
  }
}

/** Convert a base64 data-URI PDF into a Uint8Array of the raw bytes. */
function dataUriToUint8(dataUri: string): Uint8Array {
  const comma = dataUri.indexOf(",");
  const b64 = comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Build the jsPDF "shell" — cover page + one detail page per non-PDF /
 * signed-form document. Returns the raw PDF bytes (Uint8Array).
 */
async function buildShellPdf(
  job: Job | undefined,
  contact: Contact | undefined,
  documents: JobDocument[],
  photos: CompanyCamPhoto[] = []
): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 54; // margin

  // ── Cover page ────────────────────────────────────────────────────────────
  // Red header band
  doc.setFillColor(RED.r, RED.g, RED.b);
  doc.rect(0, 0, PW, 92, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("TITAN RESTORATION LLC", M, 42);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Recover  |  Restore  |  Rebuild", M, 60);
  doc.text("706-922-0154   |   titanrestorationllc.com", M, 76);

  // Blue sub-band
  doc.setFillColor(BLUE.r, BLUE.g, BLUE.b);
  doc.rect(0, 92, PW, 34, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("JOB DOCUMENT PACKET", M, 114);

  // Job / contact info block
  let y = 158;
  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Job Details", M, y);
  y += 6;
  doc.setDrawColor(RED.r, RED.g, RED.b);
  doc.setLineWidth(1.5);
  doc.line(M, y, M + 90, y);
  y += 20;

  const info: [string, string][] = [
    ["Job Number", job?.jobNumber || "—"],
    ["Division", (job as any)?.division || "—"],
    ["Status", (job as any)?.status || "—"],
    ["Property Address", (job as any)?.propertyAddress || (job as any)?.address || "—"],
    ["Client", contact?.name || "—"],
    ["Client Phone", (contact as any)?.phone || "—"],
    ["Client Email", (contact as any)?.email || "—"],
    ["Packet Generated", new Date().toLocaleString()],
    ["Total Documents", String(documents.length)],
    ["CompanyCam Photos", String(photos.length)],
  ];
  doc.setFontSize(10);
  for (const [k, v] of info) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(90, 90, 90);
    doc.text(asciiSafe(k), M, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20, 20, 20);
    const lines = doc.splitTextToSize(asciiSafe(v), PW - M - 200);
    doc.text(lines, M + 160, y);
    y += Math.max(18, lines.length * 14);
  }

  // Contents list
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);
  doc.text("Contents", M, y);
  y += 6;
  doc.setDrawColor(BLUE.r, BLUE.g, BLUE.b);
  doc.line(M, y, M + 70, y);
  y += 20;
  doc.setFontSize(10);
  documents.forEach((d, i) => {
    if (y > PH - 60) { doc.addPage(); y = M; }
    doc.setFont("helvetica", "bold");
    doc.setTextColor(RED.r, RED.g, RED.b);
    doc.text(`${i + 1}.`, M, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20, 20, 20);
    const title = asciiSafe(d.title || docLabel(d));
    doc.text(doc.splitTextToSize(title, PW - M - 200), M + 20, y);
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(9);
    doc.text(asciiSafe(docLabel(d)), PW - M - 150, y);
    doc.setFontSize(10);
    y += 18;
  });

  // ── Detail page for each non-PDF / signed-form document ────────────────────
  for (const d of documents) {
    const hasPDF = !!(d.fileData && d.fileMimeType === "application/pdf");
    if (hasPDF) continue; // real PDF gets merged later — no shell page needed

    doc.addPage();
    let yy = M;

    // Header band
    doc.setFillColor(BLUE.r, BLUE.g, BLUE.b);
    doc.rect(0, 0, PW, 56, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(asciiSafe(d.title || docLabel(d)), M, 34);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(asciiSafe(`${docLabel(d)}  •  Job ${job?.jobNumber || ""}`), M, 48);
    yy = 84;

    // Status line
    doc.setTextColor(90, 90, 90);
    doc.setFontSize(9);
    doc.text(
      asciiSafe(
        `Status: ${d.status || "—"}` +
          (d.signerName ? `   |   Signed by: ${d.signerName}` : "") +
          (d.signedAt ? `   |   ${fmtDate(d.signedAt)}` : "")
      ),
      M,
      yy
    );
    yy += 22;

    // Form fields
    let formData: Record<string, any> | null = null;
    try { formData = d.formData ? JSON.parse(d.formData) : null; } catch { formData = null; }

    if (formData && Object.keys(formData).length) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(RED.r, RED.g, RED.b);
      doc.text("FORM DETAILS", M, yy);
      yy += 16;
      doc.setFontSize(9);
      for (const [k, v] of Object.entries(formData)) {
        if (v === "" || v == null) continue;
        if (yy > PH - 80) { doc.addPage(); yy = M; }
        const label = asciiSafe(k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim());
        doc.setFont("helvetica", "bold");
        doc.setTextColor(90, 90, 90);
        doc.text(label, M, yy);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(20, 20, 20);
        const vLines = doc.splitTextToSize(asciiSafe(v), PW - M - 190);
        doc.text(vLines, M + 170, yy);
        yy += Math.max(15, vLines.length * 12);
      }
      yy += 8;
    } else if (!d.signatureData) {
      doc.setFont("helvetica", "italic");
      doc.setTextColor(120, 120, 120);
      doc.setFontSize(10);
      doc.text(
        asciiSafe("This document has no attached PDF or form data on file."),
        M,
        yy
      );
      yy += 20;
    }

    // Signature
    if (d.signatureData) {
      if (yy > PH - 160) { doc.addPage(); yy = M; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(RED.r, RED.g, RED.b);
      doc.text("ELECTRONIC SIGNATURE", M, yy);
      yy += 12;
      try {
        doc.addImage(d.signatureData, "PNG", M, yy, 200, 70);
      } catch { /* ignore bad sig image */ }
      yy += 78;
      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.5);
      doc.line(M, yy, M + 200, yy);
      yy += 12;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(60, 60, 60);
      doc.text(asciiSafe(`${d.signerName || ""}  —  ${fmtDate(d.signedAt)}`), M, yy);
      yy += 12;
      doc.setTextColor(120, 120, 120);
      doc.text("Electronic signature on file", M, yy);
    }
  }

  // ── CompanyCam photo appendix ──────────────────────────────────────────────
  if (photos.length) {
    doc.addPage();
    // Header band
    doc.setFillColor(RED.r, RED.g, RED.b);
    doc.rect(0, 0, PW, 56, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("COMPANYCAM PHOTO DOCUMENTATION", M, 34);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(asciiSafe(`${photos.length} photos  •  Job ${job?.jobNumber || ""}`), M, 48);

    // 2-column photo grid
    const colW = (PW - M * 2 - 16) / 2;
    const imgH = 150;
    let px = M;
    let py = 84;
    let col = 0;
    for (const p of photos) {
      const img = await fetchImageDataUri(p.uri);
      if (py + imgH + 28 > PH - 40) { doc.addPage(); py = M; px = M; col = 0; }
      // frame
      doc.setDrawColor(210, 210, 210);
      doc.setLineWidth(0.5);
      doc.rect(px, py, colW, imgH);
      if (img) {
        try { doc.addImage(img.dataUri, img.format, px + 2, py + 2, colW - 4, imgH - 4); }
        catch { /* skip unrenderable image */ }
      } else {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text("(photo unavailable)", px + 8, py + imgH / 2);
      }
      // caption
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(110, 110, 110);
      doc.text(asciiSafe(fmtDate(p.captured_at) || p.id), px + 2, py + imgH + 12);
      // advance grid
      if (col === 0) { px = M + colW + 16; col = 1; }
      else { px = M; col = 0; py += imgH + 28; }
    }
  }

  // Footer page numbers
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(
      asciiSafe(`Titan Restoration LLC  •  Job ${job?.jobNumber || ""}  •  Page ${p} of ${pageCount}`),
      M,
      PH - 24
    );
  }

  const uri = doc.output("datauristring");
  return dataUriToUint8(uri);
}

/**
 * Build a single merged PDF packet:  shell (cover + form pages) + every
 * uploaded PDF merged in-order. Returns a base64 data URI.
 */
export async function buildJobDocumentPacket(
  job: Job | undefined,
  contact: Contact | undefined,
  documents: JobDocument[],
  photos: CompanyCamPhoto[] = []
): Promise<string> {
  const { PDFDocument } = await import("pdf-lib");

  const shellBytes = await buildShellPdf(job, contact, documents, photos);
  const merged = await PDFDocument.create();

  // Shell first
  const shellDoc = await PDFDocument.load(shellBytes);
  const shellPages = await merged.copyPages(shellDoc, shellDoc.getPageIndices());
  shellPages.forEach(p => merged.addPage(p));

  // Then each uploaded PDF, in the same order as `documents`
  for (const d of documents) {
    const hasPDF = !!(d.fileData && d.fileMimeType === "application/pdf");
    if (!hasPDF) continue;
    try {
      const bytes = dataUriToUint8(d.fileData!);
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    } catch (err) {
      // If a specific PDF fails to parse, skip it rather than breaking the packet.
      console.warn(`Skipping unmergeable PDF: ${d.title}`, err);
    }
  }

  const mergedBytes = await merged.save();
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < mergedBytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, mergedBytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return `data:application/pdf;base64,${btoa(bin)}`;
}

/** Open a PDF data URI in a new tab and trigger the browser print dialog. */
export function printPdfDataUri(dataUri: string) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(
    `<!doctype html><html><head><title>Print</title>` +
      `<style>html,body{margin:0;height:100%}iframe{border:none;width:100%;height:100%}</style>` +
      `</head><body><iframe id="pf" src="${dataUri}"></iframe>` +
      `<script>` +
      `var f=document.getElementById('pf');` +
      `f.onload=function(){setTimeout(function(){try{f.contentWindow.focus();f.contentWindow.print();}catch(e){window.print();}},400);};` +
      `<\/script></body></html>`
  );
  win.document.close();
}

/** Download a PDF data URI as a file. */
export function downloadPdfDataUri(dataUri: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUri;
  a.download = filename.endsWith(".pdf") ? filename : filename + ".pdf";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Print a single document.
 *  • Uploaded PDF → print the PDF directly.
 *  • Signed form / other → build a one-doc branded PDF via the shell builder
 *    and print that.
 */
export async function printSingleDocument(
  doc: JobDocument,
  job?: Job,
  contact?: Contact
) {
  const hasPDF = !!(doc.fileData && doc.fileMimeType === "application/pdf");
  if (hasPDF) {
    printPdfDataUri(doc.fileData!);
    return;
  }
  // Build a single-document packet (skips the multi-doc "Contents" clutter
  // by passing just this one document).
  const uri = await buildJobDocumentPacket(job, contact, [doc]);
  printPdfDataUri(uri);
}
