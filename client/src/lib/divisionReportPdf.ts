/**
 * divisionReportPdf.ts — Division Profitability Report PDF (Titan Restoration LLC)
 *
 * Generates a branded, owner-only Division Profitability report entirely
 * client-side with jsPDF. Mirrors the Weekly Billing module: KPI totals,
 * per-division profitability cards, and the period breakdown table.
 *
 * Returns a base64 data URI; pair with downloadPDF() from pdfEngine.ts.
 */

import jsPDF from "jspdf";

// ─── Brand constants (match pdfEngine.ts) ────────────────────────────────────
const RED = [204, 0, 0] as const; // #CC0000
const BLUE = [30, 90, 180] as const; // #1E5AB4
const GREEN = [22, 163, 74] as const; // #16a34a
const ORANGE = [234, 88, 12] as const; // #ea580c
const DARK = [20, 20, 20] as const;
const GRAY = [110, 110, 110] as const;
const LGRAY = [220, 220, 220] as const;
const WHITE = [255, 255, 255] as const;

const W = 215.9; // US Letter width (mm)
const H = 279.4; // US Letter height (mm)
const ML = 14; // left margin
const MR = W - 14; // right edge

// jsPDF's built-in Helvetica only supports WinAnsi/Latin-1. Replace common
// Unicode punctuation (arrows, en/em dashes, minus sign, curly quotes) with
// ASCII equivalents so nothing renders as garbled glyphs.
function asciiSafe(s: string): string {
  return (s || "")
    .replace(/\u2192/g, "to") // → arrow
    .replace(/\u2013|\u2014/g, "-") // en/em dash
    .replace(/\u2212/g, "-") // minus sign
    .replace(/\u2018|\u2019/g, "'") // curly single quotes
    .replace(/\u201C|\u201D/g, '"'); // curly double quotes
}

function money(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

// ─── Types (align with WeeklyBilling ReportResponse) ─────────────────────────
export interface DivisionReportRow {
  division: string; // "mitigation" | "reconstruction" | "unassigned"
  label: string; // human label
  collected: number;
  cost: number;
  net: number;
  marginPct: number;
  profitable: boolean;
}

export interface DivisionReportPeriod {
  label: string; // e.g. "Jun 30 – Jul 6" or "July 2026"
  billed: number;
  settled: number;
  collected: number;
  cost: number;
  creditMemos: number;
}

export interface DivisionReportData {
  generatedAt: string; // ISO timestamp
  groupBy: "week" | "month";
  divisionFilter: string; // "All divisions" | "Mitigation" | "Reconstruction"
  rangeLabel: string; // e.g. "2026-01-01 → 2026-07-03" or "All time"
  totals: { billed: number; settled: number; collected: number; cost: number; net: number };
  collectionRate: number; // %
  divisions: DivisionReportRow[];
  periods: DivisionReportPeriod[];
}

// ─── Layout helpers ──────────────────────────────────────────────────────────
function setFont(doc: jsPDF, weight: "normal" | "bold", size: number, color: readonly number[] = DARK) {
  doc.setFont("helvetica", weight);
  doc.setFontSize(size);
  doc.setTextColor(color[0], color[1], color[2]);
}

function drawHeader(doc: jsPDF, rangeLabel: string): number {
  // Red accent bar
  doc.setFillColor(RED[0], RED[1], RED[2]);
  doc.rect(0, 0, W, 22, "F");
  setFont(doc, "bold", 16, WHITE);
  doc.text("TITAN RESTORATION LLC", ML, 10);
  setFont(doc, "normal", 8);
  doc.setTextColor(255, 200, 200);
  doc.text("Recover · Restore · Rebuild", ML, 16);
  setFont(doc, "normal", 7.5, WHITE);
  doc.text("706-922-0154  |  cody@titanaugusta.com  |  titanaugusta.pro", MR, 10, { align: "right" });
  doc.text("Augusta, GA  |  CSRA  |  Licensed & Insured", MR, 16, { align: "right" });

  // Blue title bar
  doc.setFillColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.rect(0, 22, W, 16, "F");
  setFont(doc, "bold", 13, WHITE);
  doc.text("Division Profitability Report", ML, 33);
  setFont(doc, "normal", 8);
  doc.setTextColor(180, 210, 255);
  doc.text("Mitigation vs. Reconstruction  -  Owner Confidential", ML, 38.5);
  // The full date range appears in the context line just below the header, so
  // we keep the blue bar clean and avoid crowding the right edge.
  void rangeLabel;

  return 48;
}

function drawFooter(doc: jsPDF, pageNum: number, totalPages: number, generatedAt: string) {
  doc.setFillColor(RED[0], RED[1], RED[2]);
  doc.rect(0, H - 14, W, 14, "F");
  setFont(doc, "normal", 7, WHITE);
  doc.text("Titan Restoration LLC  ·  706-922-0154  ·  titanaugusta.pro  ·  Augusta, GA", ML, H - 7);
  doc.text(`Page ${pageNum} of ${totalPages}`, MR, H - 7, { align: "right" });
  setFont(doc, "normal", 6.5);
  doc.setTextColor(255, 200, 200);
  doc.text(`Owner confidential — generated ${generatedAt}. Internal financial report; do not distribute.`, ML, H - 3);
}

// ─── Main generator ──────────────────────────────────────────────────────────
export function generateDivisionReportPDF(data: DivisionReportData): string {
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  let y = drawHeader(doc, data.rangeLabel);

  const genLabel = new Date(data.generatedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // ─── Report context line ───────────────────────────────────────────────────
  setFont(doc, "normal", 8.5, GRAY);
  doc.text(
    asciiSafe(
      `${data.divisionFilter}  -  Grouped by ${data.groupBy}  -  Range: ${data.rangeLabel}  -  Generated ${genLabel}`,
    ),
    ML,
    y,
  );
  y += 8;

  // ─── KPI summary strip ──────────────────────────────────────────────────────
  const kpis: { label: string; value: string; color: readonly number[] }[] = [
    { label: "TOTAL BILLED", value: money(data.totals.billed), color: DARK },
    { label: "TOTAL SETTLED", value: money(data.totals.settled), color: BLUE },
    { label: "TOTAL COLLECTED", value: money(data.totals.collected), color: GREEN },
    { label: "TOTAL COST", value: money(data.totals.cost), color: ORANGE },
    { label: "NET PROFIT", value: money(data.totals.net), color: data.totals.net >= 0 ? GREEN : RED },
    { label: "COLLECTION RATE", value: `${data.collectionRate}%`, color: DARK },
  ];
  const stripW = MR - ML;
  const kpiW = stripW / kpis.length;
  const kpiH = 16;
  doc.setDrawColor(LGRAY[0], LGRAY[1], LGRAY[2]);
  doc.setLineWidth(0.3);
  doc.setFillColor(248, 248, 250);
  doc.roundedRect(ML, y, stripW, kpiH, 1.5, 1.5, "FD");
  kpis.forEach((k, i) => {
    const cx = ML + i * kpiW + kpiW / 2;
    if (i > 0) {
      doc.setDrawColor(230, 230, 232);
      doc.line(ML + i * kpiW, y + 2.5, ML + i * kpiW, y + kpiH - 2.5);
    }
    setFont(doc, "bold", 6, GRAY);
    doc.text(k.label, cx, y + 5.5, { align: "center" });
    setFont(doc, "bold", 10.5, k.color);
    doc.text(k.value, cx, y + 12, { align: "center" });
  });
  y += kpiH + 10;

  // ─── Division profitability cards ───────────────────────────────────────────
  setFont(doc, "bold", 11, DARK);
  doc.text("Division Profitability", ML, y);
  y += 6;

  const active = data.divisions.filter((d) => !(d.collected === 0 && d.cost === 0));
  const cards = active.length ? active : data.divisions;

  if (cards.length === 0) {
    setFont(doc, "normal", 9, GRAY);
    doc.text("No division activity in this range.", ML, y + 4);
    y += 12;
  } else {
    const gap = 6;
    const cardW = (MR - ML - gap * (cards.length - 1)) / cards.length;
    const cardH = 42;
    cards.forEach((d, i) => {
      const x = ML + i * (cardW + gap);
      const accent = d.division === "mitigation" ? BLUE : d.division === "reconstruction" ? RED : GRAY;
      const positive = d.net >= 0;
      // card body
      doc.setFillColor(WHITE[0], WHITE[1], WHITE[2]);
      doc.setDrawColor(LGRAY[0], LGRAY[1], LGRAY[2]);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, "FD");
      // left accent bar
      doc.setFillColor(accent[0], accent[1], accent[2]);
      doc.rect(x, y, 1.6, cardH, "F");

      const px = x + 5;
      setFont(doc, "bold", 10, accent);
      doc.text(asciiSafe(d.label), px, y + 7);
      // status badge
      const status = d.collected === 0 && d.cost === 0 ? "No activity" : positive ? "Profitable" : "Losing money";
      const badgeColor = d.collected === 0 && d.cost === 0 ? GRAY : positive ? GREEN : RED;
      setFont(doc, "bold", 7, badgeColor);
      doc.text(status.toUpperCase(), x + cardW - 5, y + 7, { align: "right" });

      doc.setDrawColor(238, 238, 240);
      doc.line(px, y + 10, x + cardW - 5, y + 10);

      const rowY = y + 16;
      const line = (label: string, val: string, ry: number, valColor: readonly number[], bold = false) => {
        setFont(doc, "normal", 8.5, GRAY);
        doc.text(label, px, ry);
        setFont(doc, bold ? "bold" : "normal", 9, valColor);
        doc.text(val, x + cardW - 5, ry, { align: "right" });
      };
      line("Brought In", money(d.collected), rowY, GREEN);
      line("Cost", money(d.cost), rowY + 6.5, ORANGE);
      line("Net", money(d.net), rowY + 13.5, positive ? GREEN : RED, true);
      line("Margin", d.collected > 0 ? `${d.marginPct}%` : "—", rowY + 20, positive ? GREEN : RED);
    });
    y += cardH + 10;
  }

  // ─── Period breakdown table ─────────────────────────────────────────────────
  const drawBreakdownHeaderRow = (ty: number) => {
    doc.setFillColor(BLUE[0], BLUE[1], BLUE[2]);
    doc.rect(ML, ty, MR - ML, 8, "F");
    setFont(doc, "bold", 7.5, WHITE);
    doc.text(data.groupBy === "month" ? "MONTH" : "WEEK", ML + 2, ty + 5.3);
    doc.text("BILLED", cols.billed, ty + 5.3, { align: "right" });
    doc.text("SETTLED", cols.settled, ty + 5.3, { align: "right" });
    doc.text("BROUGHT IN", cols.collected, ty + 5.3, { align: "right" });
    doc.text("COST", cols.cost, ty + 5.3, { align: "right" });
    doc.text("NET", cols.net, ty + 5.3, { align: "right" });
    doc.text("CREDITS", cols.credits, ty + 5.3, { align: "right" });
    return ty + 8;
  };

  // right-aligned column x positions
  const tableRight = MR - 2;
  const colGap = (MR - ML - 40) / 6;
  const firstCol = ML + 40 + colGap;
  const cols = {
    billed: firstCol,
    settled: firstCol + colGap,
    collected: firstCol + colGap * 2,
    cost: firstCol + colGap * 3,
    net: firstCol + colGap * 4,
    credits: tableRight,
  };

  setFont(doc, "bold", 11, DARK);
  doc.text(`${data.groupBy === "month" ? "Monthly" : "Weekly"} Breakdown`, ML, y);
  y += 4;
  y = drawBreakdownHeaderRow(y);

  const rowH = 6.6;
  const bottomLimit = H - 20;

  if (data.periods.length === 0) {
    setFont(doc, "normal", 9, GRAY);
    doc.text("No periods to show for this range.", ML + 2, y + 6);
    y += 12;
  } else {
    data.periods.forEach((p, idx) => {
      // page break
      if (y + rowH > bottomLimit) {
        doc.addPage();
        y = drawHeader(doc, data.rangeLabel);
        setFont(doc, "bold", 11, DARK);
        doc.text(`${data.groupBy === "month" ? "Monthly" : "Weekly"} Breakdown (continued)`, ML, y);
        y += 4;
        y = drawBreakdownHeaderRow(y);
      }
      if (idx % 2 === 1) {
        doc.setFillColor(246, 247, 249);
        doc.rect(ML, y, MR - ML, rowH, "F");
      }
      const pnet = p.collected - p.cost;
      setFont(doc, "normal", 8, DARK);
      doc.text(asciiSafe(p.label), ML + 2, y + 4.6);
      doc.text(money(p.billed), cols.billed, y + 4.6, { align: "right" });
      setFont(doc, "normal", 8, BLUE);
      doc.text(money(p.settled), cols.settled, y + 4.6, { align: "right" });
      setFont(doc, "normal", 8, GREEN);
      doc.text(money(p.collected), cols.collected, y + 4.6, { align: "right" });
      setFont(doc, "normal", 8, ORANGE);
      doc.text(p.cost ? money(p.cost) : "—", cols.cost, y + 4.6, { align: "right" });
      setFont(doc, "normal", 8, pnet >= 0 ? GREEN : RED);
      doc.text(money(pnet), cols.net, y + 4.6, { align: "right" });
      setFont(doc, "normal", 8, RED);
      doc.text(p.creditMemos ? money(p.creditMemos) : "—", cols.credits, y + 4.6, { align: "right" });
      y += rowH;
    });

    // Totals row
    if (y + 8 > bottomLimit) {
      doc.addPage();
      y = drawHeader(doc, data.rangeLabel);
    }
    doc.setDrawColor(DARK[0], DARK[1], DARK[2]);
    doc.setLineWidth(0.5);
    doc.line(ML, y, MR, y);
    y += 1;
    setFont(doc, "bold", 8.5, DARK);
    doc.text("Total", ML + 2, y + 5);
    doc.text(money(data.totals.billed), cols.billed, y + 5, { align: "right" });
    setFont(doc, "bold", 8.5, BLUE);
    doc.text(money(data.totals.settled), cols.settled, y + 5, { align: "right" });
    setFont(doc, "bold", 8.5, GREEN);
    doc.text(money(data.totals.collected), cols.collected, y + 5, { align: "right" });
    setFont(doc, "bold", 8.5, ORANGE);
    doc.text(money(data.totals.cost), cols.cost, y + 5, { align: "right" });
    setFont(doc, "bold", 8.5, data.totals.net >= 0 ? GREEN : RED);
    doc.text(money(data.totals.net), cols.net, y + 5, { align: "right" });
    y += 10;
  }

  // ─── Methodology footnote ───────────────────────────────────────────────────
  if (y + 16 < bottomLimit) {
    setFont(doc, "normal", 6.8, GRAY);
    const note = asciiSafe(
      "Each job carries a division tag. Jobs tagged \u201CBoth\u201D split Brought In and Cost 50/50 across Mitigation and Reconstruction. " +
        "Billed = invoice totals by invoice date. Settled = approved/partial supplement amounts by response date. " +
        "Brought In = payments received (excludes credit memos) by payment date. Cost = job costs by cost date. Net = Brought In \u2212 Cost.",
    );
    const lines = doc.splitTextToSize(note, MR - ML);
    doc.text(lines, ML, y + 4);
  }

  // ─── Footers on every page ──────────────────────────────────────────────────
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    drawFooter(doc, i, total, genLabel);
  }

  // Strip jsPDF's non-standard `;filename=generated.pdf` param — see
  // pdfEngine.finalizePdf for the full rationale. Kept inline here to avoid
  // pulling pdfEngine's whole surface just for one call.
  const uri = doc.output("datauristring");
  const commaIdx = uri.indexOf(",");
  return commaIdx < 0 ? uri : `data:application/pdf;base64,${uri.slice(commaIdx + 1)}`;
}
