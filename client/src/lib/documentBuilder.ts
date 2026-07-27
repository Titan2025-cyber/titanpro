/**
 * documentBuilder.ts — Titan Restoration LLC customizable branded document engine
 *
 * Produces branded PDF and Excel (.xlsx) output from a single `DocConfig`.
 * Used by the Document Builder module under Business Dev. Fully client-side.
 *
 * jsPDF's built-in Helvetica is Latin-1 only, so all text runs through
 * asciiSafe() to avoid garbled glyphs (arrows, dashes, curly quotes).
 */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ─── Brand ───────────────────────────────────────────────────────────────────
const RED: [number, number, number] = [204, 0, 0];
const BLUE: [number, number, number] = [30, 90, 180];
const DARK: [number, number, number] = [20, 20, 20];
const GRAY: [number, number, number] = [110, 110, 110];
const WHITE: [number, number, number] = [255, 255, 255];

// ─── Config types ──────────────────────────────────────────────────────────
export type DocBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "kpis"; items: { label: string; value: string }[] }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "signature"; label: string; name?: string }
  | { type: "spacer" };

export interface DocConfig {
  title: string;
  subtitle?: string;
  docId?: string;
  accent?: "red" | "blue";
  showHeader?: boolean;
  showFooter?: boolean;
  confidential?: boolean;
  blocks: DocBlock[];
}

// ─── Latin-1 safety ────────────────────────────────────────────────────────
export function asciiSafe(s: any): string {
  return String(s ?? "")
    .replace(/\u2192/g, "to").replace(/\u2190/g, "<-")
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2018\u2019\u2032]/g, "'").replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/\u2022/g, "-").replace(/\u2026/g, "...")
    .replace(/[^\x00-\xFF]/g, "");
}

function accentColor(cfg: DocConfig): [number, number, number] {
  return cfg.accent === "red" ? RED : BLUE;
}

function drawHeader(doc: jsPDF, cfg: DocConfig): number {
  const W = 215.9; // letter width mm
  doc.setFillColor(...RED);
  doc.rect(0, 0, W, 22, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(...WHITE);
  doc.text("TITAN RESTORATION LLC", 14, 10);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(255, 200, 200);
  doc.text("Recover - Restore - Rebuild", 14, 16);
  doc.setFontSize(7.5); doc.setTextColor(...WHITE);
  doc.text("706-922-0154  |  cody@titanaugusta.com  |  titanaugusta.pro", W - 14, 10, { align: "right" });
  doc.text("Augusta, GA  |  Licensed & Insured", W - 14, 16, { align: "right" });

  doc.setFillColor(...BLUE);
  doc.rect(0, 22, W, 16, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...WHITE);
  doc.text(asciiSafe(cfg.title), 14, 33);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(180, 210, 255);
  if (cfg.subtitle) doc.text(asciiSafe(cfg.subtitle), 14, 38.5);
  if (cfg.docId) doc.text(asciiSafe(cfg.docId), W - 14, 38.5, { align: "right" });
  return 50;
}

function drawFooter(doc: jsPDF, cfg: DocConfig, pageNum: number, totalPages: number) {
  const W = 215.9;
  doc.setFillColor(...RED);
  doc.rect(0, 283, W, 14, "F");
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...WHITE);
  doc.text("Titan Restoration LLC  ·  706-922-0154  ·  titanaugusta.pro", 14, 290);
  doc.text(`Page ${pageNum} of ${totalPages}`, W - 14, 290, { align: "right" });
  if (cfg.confidential) {
    doc.setFontSize(6.5); doc.setTextColor(255, 200, 200);
    doc.text("Confidential — for internal use only.", 14, 294);
  }
}

/** Build a branded PDF from the config. Returns a base64 datauristring. */
export function buildBrandedPDF(cfg: DocConfig): string {
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  const W = 215.9, LM = 14, RM = 201.9, contentW = RM - LM;
  const acc = accentColor(cfg);
  let y = cfg.showHeader === false ? 20 : drawHeader(doc, cfg);

  const ensureSpace = (needed: number) => {
    if (y + needed > 278) { doc.addPage(); y = cfg.showHeader === false ? 20 : drawHeader(doc, cfg); }
  };

  for (const block of cfg.blocks) {
    if (block.type === "spacer") { y += 6; continue; }
    if (block.type === "heading") {
      ensureSpace(14);
      doc.setFillColor(...acc); doc.rect(LM, y - 4, 2, 7, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(11.5); doc.setTextColor(...DARK);
      doc.text(asciiSafe(block.text), LM + 5, y + 1);
      y += 10;
      continue;
    }
    if (block.type === "paragraph") {
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...DARK);
      const lines = doc.splitTextToSize(asciiSafe(block.text), contentW);
      ensureSpace(lines.length * 5 + 2);
      doc.text(lines, LM, y);
      y += lines.length * 5 + 3;
      continue;
    }
    if (block.type === "kpis") {
      const items = block.items.filter(i => i.label || i.value);
      const perRow = Math.min(4, Math.max(1, items.length));
      const cardW = (contentW - (perRow - 1) * 4) / perRow;
      let i = 0;
      while (i < items.length) {
        ensureSpace(24);
        const rowItems = items.slice(i, i + perRow);
        rowItems.forEach((it, idx) => {
          const x = LM + idx * (cardW + 4);
          doc.setFillColor(247, 248, 250); doc.setDrawColor(225, 228, 232); doc.setLineWidth(0.3);
          doc.roundedRect(x, y, cardW, 20, 1.5, 1.5, "FD");
          doc.setFillColor(...acc); doc.rect(x, y, 2, 20, "F");
          doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...GRAY);
          doc.text(asciiSafe(it.label).toUpperCase(), x + 5, y + 6);
          doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...DARK);
          const v = doc.splitTextToSize(asciiSafe(it.value), cardW - 7);
          doc.text(v[0] || "-", x + 5, y + 15);
        });
        y += 24;
        i += perRow;
      }
      continue;
    }
    if (block.type === "table") {
      ensureSpace(20);
      autoTable(doc, {
        startY: y,
        head: [block.columns.map(asciiSafe)],
        body: block.rows.map(r => r.map(asciiSafe)),
        margin: { left: LM, right: 14 },
        styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.2, textColor: DARK as any },
        headStyles: { fillColor: acc as any, textColor: WHITE as any, fontStyle: "bold", fontSize: 8 },
        alternateRowStyles: { fillColor: [247, 248, 250] as any },
        theme: "grid",
      });
      y = (doc as any).lastAutoTable.finalY + 6;
      continue;
    }
    if (block.type === "signature") {
      ensureSpace(24);
      y += 8;
      doc.setDrawColor(...DARK); doc.setLineWidth(0.4);
      doc.line(LM, y, LM + 80, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GRAY);
      doc.text(asciiSafe(block.label).toUpperCase(), LM, y + 4);
      if (block.name) { doc.setFontSize(9); doc.setTextColor(...DARK); doc.text(asciiSafe(block.name), LM, y - 2); }
      // date line
      doc.line(LM + 100, y, RM, y);
      doc.setFontSize(7.5); doc.setTextColor(...GRAY);
      doc.text("DATE", LM + 100, y + 4);
      y += 12;
      continue;
    }
  }

  // Footers
  if (cfg.showFooter !== false) {
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) { doc.setPage(p); drawFooter(doc, cfg, p, total); }
  }

  return doc.output("datauristring");
}

/** Download a base64 data URI as a file. */
export function downloadDataUri(dataUri: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUri; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

/** Open a base64 PDF data URI in a new tab. */
export function previewDataUri(dataUri: string) {
  const win = window.open();
  if (win) win.document.write(`<iframe src="${dataUri}" style="border:0;width:100%;height:100vh"></iframe>`);
}
