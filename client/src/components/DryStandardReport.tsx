/**
 * DryStandardReport.tsx
 * Generates a complete IICRC S500 Structural Drying Report PDF from job drying records.
 *
 * Export: DryStandardReportGenerator
 * Props: { job: Job, jobId: number }
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  FileText, Download, Save, Loader2, CheckCircle2,
  Droplets, Thermometer, Wind, ClipboardList, AlertTriangle, Info
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { registerDejaVuSans } from "@/assets/dejavu-sans";
// jsPDF (~600KB) is loaded on demand so it isn't bundled into JobDetail on
// every page load — only fetched when a drying report is actually generated.
const loadJsPDF = async () => (await import("jspdf")).default;
type JsPDFDoc = Awaited<ReturnType<typeof loadJsPDF>> extends new (...args: any[]) => infer R ? R : any;
import type { Job, DryingRecord } from "@shared/schema";
import { fmtDate, fmtDateShort } from "@/lib/dates";

// ─── Brand constants ──────────────────────────────────────────────────────────
const RED      = [204, 0, 0]    as const;
const BLUE     = [30, 90, 180]  as const;
const DARK     = [20, 20, 20]   as const;
const GRAY     = [100, 100, 100] as const;
const LGRAY    = [220, 220, 220] as const;
const WHITE    = [255, 255, 255] as const;
const OFFWHITE = [248, 248, 250] as const;
const GREEN    = [34, 139, 34]  as const;
const AMBER    = [180, 100, 0]  as const;

// ─── IICRC S500 targets ───────────────────────────────────────────────────────
const S500_TARGETS = {
  wood:     { wme: 16, label: "Wood/Framing" },
  drywall:  { wme: 1,  label: "Drywall/Gypsum" },
  concrete: { wme: 4,  label: "Concrete/Masonry" },
  gpp:      { value: 55, label: "Indoor GPP Goal" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function calcGPP(tempF: number, rh: number): number {
  const tempC = (tempF - 32) * 5 / 9;
  const pws = 6.1078 * Math.exp(17.27 * tempC / (tempC + 237.3));
  const p = 101.325;
  const w = 0.62198 * (pws * rh / 100) / (p - pws * rh / 100);
  return Math.round(w * 7000 * 10) / 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF generator
// ─────────────────────────────────────────────────────────────────────────────
// Safe JSON.parse for arrays stored as text on DryingRecord. Returns [] on
// any parse failure so downstream renderers never crash on malformed data.
function parseArr<T = any>(s: string | null | undefined): T[] {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

// Runtime hours between (startDate,startTime) and (endDate,endTime). Kept in
// sync with DryingRecords.tsx so the on-screen runtime matches what the PDF
// prints. Time components are optional and default to 00:00 for records that
// predate the time fields. Precision is one decimal hour (e.g. 2.3h).
function pdfRuntimeHours(
  startDate?: string,
  endDate?: string,
  startTime?: string,
  endTime?: string,
): number | null {
  if (!startDate || !endDate) return null;
  const st = /^\d{2}:\d{2}$/.test(startTime || "") ? startTime : "00:00";
  const et = /^\d{2}:\d{2}$/.test(endTime || "") ? endTime : "00:00";
  const s = new Date(`${startDate}T${st}:00`);
  const e = new Date(`${endDate}T${et}:00`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const hrs = (e.getTime() - s.getTime()) / 3_600_000;
  if (hrs < 0) return null;
  return Math.round(hrs * 10) / 10;
}

// Compact "MM/DD HH:MM" label for the equipment tables. HH:MM comes straight
// from the tech's local-time input — no timezone conversion so the printed
// label matches what they typed in the field.
function fmtDateTimeShort(date?: string, time?: string): string {
  if (!date) return "—";
  const base = fmtDateShort(date);
  return time && /^\d{2}:\d{2}$/.test(time) ? `${base} ${time}` : base;
}

// Sort drying records ascending by day (readingDate then dayNumber) so the
// per-day breakdown in the PDF matches the natural drying timeline.
function sortRecordsByDay(records: DryingRecord[]): DryingRecord[] {
  return [...records].sort((a, b) => {
    const da = (a.readingDate || "").localeCompare(b.readingDate || "");
    if (da !== 0) return da;
    return (a.dayNumber || 0) - (b.dayNumber || 0);
  });
}

async function generateDryReportPDF(job: Job, records: DryingRecord[]): Promise<string> {
  const jsPDF = await loadJsPDF();
  // Portrait letter — per-day panels stack vertically so each day gets a
  // dedicated readable column. Landscape worked for one flat table but is
  // awkward for the per-day breakdown insurance carriers actually want.
  const doc: JsPDFDoc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });

  // Register DejaVu Sans (subset) on this doc so we can render the S500
  // target lines with the real ≤ symbol. jsPDF's built-in Helvetica is
  // WinAnsi-only and corrupts non-WinAnsi glyphs (see 3c49aaf).
  registerDejaVuSans(doc);
  const PW = 215.9;
  const PH = 279.4;
  const M  = 12;
  const CONTENT_W = PW - M * 2;

  const setFont = (w: "normal" | "bold", sz: number, color: readonly [number, number, number] = DARK) => {
    doc.setFont("helvetica", w);
    doc.setFontSize(sz);
    doc.setTextColor(color[0], color[1], color[2]);
  };
  const hRule = (y: number, color: readonly [number, number, number] = LGRAY, lw = 0.3, x1 = M, x2 = PW - M) => {
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.setLineWidth(lw);
    doc.line(x1, y, x2, y);
  };

  // Standard red/blue Titan banner. Drawn on every page so the report reads
  // consistently even when a day breaks across pages.
  const drawBanner = (title: string, subtitle?: string) => {
    doc.setFillColor(RED[0], RED[1], RED[2]);
    doc.rect(0, 0, PW, 16, "F");
    doc.setFillColor(BLUE[0], BLUE[1], BLUE[2]);
    doc.rect(0, 16, PW, 3, "F");
    setFont("bold", 12, WHITE);
    doc.text("TITAN RESTORATION LLC", M, 10);
    setFont("normal", 7, WHITE);
    doc.text("Augusta, GA  ·  706-922-0154  ·  titanaugusta.pro", M, 15);
    setFont("bold", 9, WHITE);
    doc.text(title, PW - M, 8, { align: "right" });
    if (subtitle) {
      setFont("normal", 7, WHITE);
      doc.text(subtitle, PW - M, 13, { align: "right" });
    }
    return 24; // y position where content should start
  };

  // Guarantee `needed` mm of space below y; add a page with continuation
  // banner if not. Returns the (possibly new) y position.
  const ensureSpace = (y: number, needed: number, dayLabel?: string): number => {
    if (y + needed <= PH - 14) return y;
    doc.addPage();
    return drawBanner(
      "STRUCTURAL DRYING REPORT",
      dayLabel ? `${dayLabel} (continued)` : "IICRC S500",
    );
  };

  // ================================================================
  // PAGE 1 — Cover: banner, job info, S500 targets, coverage
  // ================================================================
  let y = drawBanner(
    "STRUCTURAL DRYING REPORT",
    "IICRC S500 · Professional Water Damage Restoration",
  );

  y += 4;
  setFont("bold", 10, BLUE);
  doc.text("JOB INFORMATION", M, y);
  y += 4;
  doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
  doc.roundedRect(M, y, CONTENT_W, 40, 2, 2, "F");

  const colL = M + 4;
  const colR = M + CONTENT_W / 2 + 2;
  const fieldCell = (label: string, value: string, x: number, cy: number, maxW = CONTENT_W / 2 - 6) => {
    setFont("bold", 7, GRAY);
    doc.text(label.toUpperCase(), x, cy);
    setFont("normal", 9, DARK);
    const lines = doc.splitTextToSize(value != null && value !== "" ? value : "", maxW);
    doc.text(lines, x, cy + 4);
  };

  fieldCell("Job Number", job.jobNumber, colL, y + 5);
  fieldCell("Assigned Tech", job.assignedTech || "—", colR, y + 5);
  fieldCell("Property Address", job.address || "—", colL, y + 14);
  fieldCell("Loss Type", (job.lossType || "—").replace(/_/g, " ").toUpperCase(), colR, y + 14);
  fieldCell("Insurance Carrier", job.insuranceCarrier || "", colL, y + 23);
  fieldCell("Claim Number", job.claimNumber || "", colR, y + 23);
  fieldCell("Policy Number", (job as any).policyNumber || "", colL, y + 32);
  fieldCell("Report Date", new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), colR, y + 32);

  y += 46;

  // S500 Targets block
  setFont("bold", 10, BLUE);
  doc.text("IICRC S500 CLEARANCE TARGETS", M, y);
  y += 3;
  doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
  doc.roundedRect(M, y, CONTENT_W, 32, 2, 2, "F");
  setFont("bold", 8, DARK);
  doc.text("Moisture Equivalence (WME)", M + 4, y + 6);
  // Switch to DejaVu Sans for these six target lines so the ≤ symbol renders
  // as an actual math glyph instead of the WinAnsi fallback.
  doc.setFont("DejaVuSans", "normal");
  doc.setFontSize(8);
  doc.setTextColor(DARK[0], DARK[1], DARK[2]);
  doc.text(`Wood/Framing: ≤ ${S500_TARGETS.wood.wme}%`, M + 4, y + 11);
  doc.text(`Drywall/Gypsum: ≤ ${S500_TARGETS.drywall.wme}%`, M + 4, y + 16);
  doc.text(`Concrete/Masonry: ≤ ${S500_TARGETS.concrete.wme}%`, M + 4, y + 21);

  setFont("bold", 8, DARK);
  doc.text("Atmospheric Targets", M + CONTENT_W / 2 + 2, y + 6);
  doc.setFont("DejaVuSans", "normal");
  doc.setFontSize(8);
  doc.setTextColor(DARK[0], DARK[1], DARK[2]);
  doc.text(`Indoor GPP: ≤ ${S500_TARGETS.gpp.value} grains/lb`, M + CONTENT_W / 2 + 2, y + 11);
  doc.text("Relative Humidity: ≤ 50% typical", M + CONTENT_W / 2 + 2, y + 16);
  doc.text("Temperature: 70–90°F optimal", M + CONTENT_W / 2 + 2, y + 21);
  // Return control to Helvetica for the rest of the report.
  setFont("normal", 8, DARK);

  setFont("italic" as any, 7, GRAY);
  doc.text("Clearance per S500 §13.2: all materials at/below dry standard, ambient conditions normalized, no visible mold.", M + 4, y + 28);

  y += 38;

  // Coverage KPIs
  const sorted = sortRecordsByDay(records);
  const visitCount = sorted.filter(r => r.recordType !== "missed").length;
  const missedCount = sorted.filter(r => r.recordType === "missed").length;
  const dayNumbers = Array.from(new Set(sorted.map(r => r.dayNumber || 0).filter(n => n > 0))).sort((a, b) => a - b);

  setFont("bold", 10, BLUE);
  doc.text("DRYING COVERAGE", M, y);
  y += 4;
  doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
  doc.roundedRect(M, y, CONTENT_W, 16, 2, 2, "F");
  const kpiW = CONTENT_W / 4;
  const drawKpi = (label: string, value: string, x: number, valueColor: readonly [number, number, number] = BLUE) => {
    setFont("bold", 7, GRAY);
    doc.text(label.toUpperCase(), x + 4, y + 5);
    setFont("bold", 12, valueColor);
    doc.text(value, x + 4, y + 12);
  };
  drawKpi("Total Days", String(dayNumbers.length || sorted.length), M);
  drawKpi("Visits", String(visitCount), M + kpiW);
  drawKpi("Missed", String(missedCount), M + kpiW * 2, missedCount > 0 ? AMBER : GRAY);
  drawKpi("Log Entries", String(sorted.length), M + kpiW * 3);

  // ================================================================
  // Per-day breakdown — one panel per record
  // ================================================================
  if (sorted.length === 0) {
    doc.addPage();
    y = drawBanner("STRUCTURAL DRYING REPORT", "Per-Day Breakdown");
    setFont("normal", 10, GRAY);
    doc.text("No drying records logged for this job.", M, y + 8);
  } else {
    doc.addPage();
    y = drawBanner("STRUCTURAL DRYING REPORT", "Per-Day Breakdown");
  }

  sorted.forEach((rec, idx) => {
    const dayLabel = `Day ${rec.dayNumber || idx + 1} — ${rec.readingDate ? fmtDate(rec.readingDate) : "—"}${rec.readingTime ? " @ " + rec.readingTime : ""}`;

    y = ensureSpace(y, 26, dayLabel);

    // Day banner strip
    doc.setFillColor(BLUE[0], BLUE[1], BLUE[2]);
    doc.rect(M, y, CONTENT_W, 8, "F");
    setFont("bold", 10, WHITE);
    doc.text(dayLabel, M + 3, y + 5.6);
    setFont("normal", 8, WHITE);
    const rightLabel = rec.recordType === "missed"
      ? `MISSED DAY${rec.missedReason ? " — " + rec.missedReason : ""}`
      : `Tech: ${rec.techName || "—"}`;
    doc.text(rightLabel, PW - M - 3, y + 5.6, { align: "right" });
    y += 10;

    // Missed-day short-circuit
    if (rec.recordType === "missed") {
      setFont("normal", 9, DARK);
      const reasonLines = doc.splitTextToSize(
        `Reason: ${rec.missedReason || "Not specified"}. Logged by ${rec.techName || "—"} per S500 continuity-of-coverage documentation.`,
        CONTENT_W - 4,
      );
      doc.text(reasonLines, M + 2, y + 4);
      y += reasonLines.length * 4 + 8;
      return;
    }

    // Row 1: Water classification + goals
    y = ensureSpace(y, 18, dayLabel);
    doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
    doc.roundedRect(M, y, CONTENT_W, 14, 1.5, 1.5, "F");
    setFont("bold", 7, GRAY);
    doc.text("WATER CATEGORY", M + 3, y + 4);
    setFont("bold", 9, DARK);
    doc.text((rec.waterCategory || "—").toUpperCase().replace("CATEGORY", "CAT "), M + 3, y + 9);
    setFont("bold", 7, GRAY);
    doc.text("WATER CLASS", M + 45, y + 4);
    setFont("bold", 9, DARK);
    doc.text((rec.waterClass || "—").toUpperCase().replace("CLASS", "CLASS "), M + 45, y + 9);
    setFont("bold", 7, GRAY);
    doc.text("DRYING GOAL", M + 85, y + 4);
    setFont("bold", 9, rec.dryingGoalMet ? GREEN : AMBER);
    doc.text(rec.dryingGoalMet ? "MET" : "NOT YET", M + 85, y + 9);
    setFont("bold", 7, GRAY);
    doc.text("STRUCTURAL DRY", M + 130, y + 4);
    setFont("bold", 9, rec.structuralDryingComplete ? GREEN : GRAY);
    doc.text(rec.structuralDryingComplete ? "COMPLETE" : "IN PROGRESS", M + 130, y + 9);
    y += 16;

    // Row 2: Psychrometric (multi-slot with legacy fallback)
    const psychro = parseArr<{ location: string; tempF?: number; rhPct?: number; gpp?: number; dewPointF?: number }>(rec.psychrometricReadings);
    const psychroRows: Array<{ location: string; tempF?: number; rhPct?: number; gpp?: number; dewPointF?: number }> =
      psychro.length > 0
        ? psychro
        : (rec.tempF || rec.rhPct)
          ? [{ location: "inside", tempF: rec.tempF ?? undefined, rhPct: rec.rhPct ?? undefined, gpp: rec.gpp ?? undefined, dewPointF: rec.dewPointF ?? undefined }]
          : [];

    y = ensureSpace(y, 8 + Math.max(psychroRows.length, 1) * 5 + 4, dayLabel);
    setFont("bold", 9, BLUE);
    doc.text("PSYCHROMETRIC READINGS", M, y);
    y += 3;
    if (psychroRows.length === 0) {
      setFont("italic" as any, 8, GRAY);
      doc.text("No psychrometric readings recorded.", M + 2, y + 4);
      y += 8;
    } else {
      doc.setFillColor(LGRAY[0], LGRAY[1], LGRAY[2]);
      doc.rect(M, y, CONTENT_W, 5, "F");
      setFont("bold", 7, DARK);
      doc.text("LOCATION", M + 2, y + 3.5);
      doc.text("TEMP °F", M + 45, y + 3.5);
      doc.text("RH %", M + 75, y + 3.5);
      doc.text("GPP", M + 100, y + 3.5);
      doc.text("DEW PT °F", M + 125, y + 3.5);
      y += 5;
      psychroRows.forEach((p, i) => {
        if (i % 2 === 0) {
          doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
          doc.rect(M, y, CONTENT_W, 5, "F");
        }
        setFont("normal", 8, DARK);
        doc.text((p.location || "—").toString().toUpperCase(), M + 2, y + 3.5);
        doc.text(p.tempF != null ? `${p.tempF}°` : "—", M + 45, y + 3.5);
        doc.text(p.rhPct != null ? `${p.rhPct}%` : "—", M + 75, y + 3.5);
        const gppVal = p.gpp != null
          ? p.gpp
          : (p.tempF != null && p.rhPct != null ? calcGPP(p.tempF, p.rhPct) : null);
        doc.text(gppVal != null ? String(gppVal) : "—", M + 100, y + 3.5);
        doc.text(p.dewPointF != null ? `${p.dewPointF}°` : "—", M + 125, y + 3.5);
        y += 5;
      });
      y += 2;
    }

    // Row 3: Affected areas
    const areas = parseArr<{ room?: string; material?: string; sqft?: number; wetPct?: number }>(rec.affectedAreas);
    y = ensureSpace(y, 8 + Math.max(areas.length, 1) * 5 + 4, dayLabel);
    setFont("bold", 9, BLUE);
    doc.text("AFFECTED AREAS", M, y);
    y += 3;
    if (areas.length === 0) {
      setFont("italic" as any, 8, GRAY);
      doc.text("No affected areas logged for this day.", M + 2, y + 4);
      y += 8;
    } else {
      doc.setFillColor(LGRAY[0], LGRAY[1], LGRAY[2]);
      doc.rect(M, y, CONTENT_W, 5, "F");
      setFont("bold", 7, DARK);
      doc.text("ROOM / AREA", M + 2, y + 3.5);
      doc.text("MATERIAL", M + 65, y + 3.5);
      doc.text("SQ FT", M + 125, y + 3.5);
      doc.text("WET %", M + 155, y + 3.5);
      y += 5;
      areas.forEach((a, i) => {
        y = ensureSpace(y, 5, dayLabel);
        if (i % 2 === 0) {
          doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
          doc.rect(M, y, CONTENT_W, 5, "F");
        }
        setFont("normal", 8, DARK);
        doc.text(doc.splitTextToSize(a.room || "—", 60)[0], M + 2, y + 3.5);
        doc.text(doc.splitTextToSize(a.material || "—", 55)[0], M + 65, y + 3.5);
        doc.text(a.sqft != null ? String(a.sqft) : "—", M + 125, y + 3.5);
        doc.text(a.wetPct != null ? `${a.wetPct}%` : "—", M + 155, y + 3.5);
        y += 5;
      });
      y += 2;
    }

    // Row 4: Moisture readings
    const moisture = parseArr<{ location?: string; material?: string; reading?: number; gpp?: number; target?: number }>(rec.moistureReadings);
    y = ensureSpace(y, 8 + Math.max(moisture.length, 1) * 5 + 4, dayLabel);
    setFont("bold", 9, BLUE);
    doc.text("MOISTURE READINGS", M, y);
    y += 3;
    if (moisture.length === 0) {
      setFont("italic" as any, 8, GRAY);
      doc.text("No moisture readings logged for this day.", M + 2, y + 4);
      y += 8;
    } else {
      doc.setFillColor(LGRAY[0], LGRAY[1], LGRAY[2]);
      doc.rect(M, y, CONTENT_W, 5, "F");
      setFont("bold", 7, DARK);
      doc.text("LOCATION", M + 2, y + 3.5);
      doc.text("MATERIAL", M + 55, y + 3.5);
      doc.text("READING %", M + 110, y + 3.5);
      doc.text("TARGET %", M + 140, y + 3.5);
      doc.text("STATUS", M + 170, y + 3.5);
      y += 5;
      moisture.forEach((m, i) => {
        y = ensureSpace(y, 5, dayLabel);
        if (i % 2 === 0) {
          doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
          doc.rect(M, y, CONTENT_W, 5, "F");
        }
        const reading = m.reading != null ? Number(m.reading) : null;
        const target = m.target != null ? Number(m.target) : null;
        const withinTarget = reading != null && target != null ? reading <= target : null;
        setFont("normal", 8, DARK);
        doc.text(doc.splitTextToSize(m.location || "—", 50)[0], M + 2, y + 3.5);
        doc.text(doc.splitTextToSize(m.material || "—", 52)[0], M + 55, y + 3.5);
        setFont("bold", 8, reading != null && target != null && reading > target ? RED : DARK);
        doc.text(reading != null ? `${reading}%` : "—", M + 110, y + 3.5);
        setFont("normal", 8, DARK);
        doc.text(target != null ? `${target}%` : "—", M + 140, y + 3.5);
        if (withinTarget === true) { setFont("bold", 8, GREEN); doc.text("DRY", M + 170, y + 3.5); }
        else if (withinTarget === false) { setFont("bold", 8, AMBER); doc.text("WET", M + 170, y + 3.5); }
        else { setFont("normal", 8, GRAY); doc.text("—", M + 170, y + 3.5); }
        y += 5;
      });
      y += 2;
    }

    // Row 5: Equipment on site — now shows per-room placement plus deployment
    // window (start/end/runtime). Rows are grouped by room so the daily view
    // matches the whole-job Equipment Runtime Summary at the end of the PDF.
    type EquipmentEntry = {
      type?: string;
      qty?: number;
      placement?: string;
      serialNumber?: string;
      room?: string;
      startDate?: string;
      startTime?: string;
      endDate?: string;
      endTime?: string;
    };
    const equipment = parseArr<EquipmentEntry>(rec.equipment);
    y = ensureSpace(y, 8 + Math.max(equipment.length, 1) * 5 + 4, dayLabel);
    setFont("bold", 9, BLUE);
    doc.text("EQUIPMENT ON SITE", M, y);
    y += 3;
    if (equipment.length === 0) {
      setFont("italic" as any, 8, GRAY);
      doc.text("No equipment logged for this day.", M + 2, y + 4);
      y += 8;
    } else {
      // Group by room label. Empty / missing room → "Unassigned".
      const groupsMap = new Map<string, EquipmentEntry[]>();
      equipment.forEach(e => {
        const key = (e.room || "").trim() || "Unassigned";
        const bucket = groupsMap.get(key) || [];
        bucket.push(e);
        groupsMap.set(key, bucket);
      });
      const groups = Array.from(groupsMap.entries()).sort(([a], [b]) => a.localeCompare(b));

      // Column layout for the equipment grid. Sums to ~CONTENT_W (~191mm).
      // Start/End widen to fit "MM/DD HH:MM" (~13 chars at 7.5pt).
      const COL_TYPE = 2;
      const COL_QTY = 44;
      const COL_PLACE = 54;
      const COL_SERIAL = 88;
      const COL_START = 120;
      const COL_END = 148;
      const COL_RT = 178;

      groups.forEach(([room, items]) => {
        y = ensureSpace(y, 5 + items.length * 5 + 2, dayLabel);
        // Room banner
        doc.setFillColor(LGRAY[0], LGRAY[1], LGRAY[2]);
        doc.rect(M, y, CONTENT_W, 5, "F");
        setFont("bold", 7, DARK);
        doc.text(`ROOM: ${room}`, M + 2, y + 3.5);
        // Header labels aligned right — keeps the banner readable.
        setFont("bold", 6.5, DARK);
        doc.text("TYPE", M + COL_TYPE, y + 3.5);
        doc.text("QTY", M + COL_QTY, y + 3.5);
        doc.text("PLACEMENT", M + COL_PLACE, y + 3.5);
        doc.text("SERIAL", M + COL_SERIAL, y + 3.5);
        doc.text("START", M + COL_START, y + 3.5);
        doc.text("END", M + COL_END, y + 3.5);
        doc.text("RUNTIME", M + COL_RT, y + 3.5);
        y += 5;

        items.forEach((e, i) => {
          y = ensureSpace(y, 5, dayLabel);
          if (i % 2 === 0) {
            doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
            doc.rect(M, y, CONTENT_W, 5, "F");
          }
          setFont("normal", 7.5, DARK);
          doc.text(doc.splitTextToSize(e.type || "—", 48)[0], M + COL_TYPE, y + 3.5);
          doc.text(e.qty != null ? String(e.qty) : "—", M + COL_QTY, y + 3.5);
          doc.text(doc.splitTextToSize(e.placement || "—", 36)[0], M + COL_PLACE, y + 3.5);
          doc.text(doc.splitTextToSize(e.serialNumber || "—", 30)[0], M + COL_SERIAL, y + 3.5);
          doc.text(fmtDateTimeShort(e.startDate, e.startTime), M + COL_START, y + 3.5);
          doc.text(
            e.endDate
              ? fmtDateTimeShort(e.endDate, e.endTime)
              : (e.startDate ? "active" : "—"),
            M + COL_END, y + 3.5
          );
          // Runtime hours (0.1h precision). If still running, show a
          // running-total from start to this record's reading date @ end-of-day.
          let rtLabel = "—";
          if (e.startDate && e.endDate) {
            const hrs = pdfRuntimeHours(e.startDate, e.endDate, e.startTime, e.endTime);
            rtLabel = hrs != null ? `${hrs}h` : "—";
          } else if (e.startDate && rec.readingDate) {
            const hrs = pdfRuntimeHours(e.startDate, rec.readingDate, e.startTime, "23:59");
            rtLabel = hrs != null ? `${hrs}h (running)` : "—";
          }
          doc.text(rtLabel, M + COL_RT, y + 3.5);
          y += 5;
        });
      });
      const totalUnits = equipment.reduce((sum, e) => sum + (Number(e.qty) || 0), 0);
      setFont("italic" as any, 7, GRAY);
      doc.text(`Total units on site: ${totalUnits}`, M + 2, y + 3);
      y += 6;
    }

    // Row 6: Observations
    if (rec.observations && rec.observations.trim()) {
      const obsLines = doc.splitTextToSize(rec.observations.trim(), CONTENT_W - 4);
      y = ensureSpace(y, 6 + obsLines.length * 4 + 4, dayLabel);
      setFont("bold", 9, BLUE);
      doc.text("OBSERVATIONS", M, y);
      y += 3;
      doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
      doc.roundedRect(M, y, CONTENT_W, obsLines.length * 4 + 4, 1.5, 1.5, "F");
      setFont("normal", 8, DARK);
      doc.text(obsLines, M + 3, y + 4);
      y += obsLines.length * 4 + 6;
    }

    // Signature line for the day
    y = ensureSpace(y, 10, dayLabel);
    setFont("bold", 7, GRAY);
    doc.text("TECH SIGNATURE", M, y);
    hRule(y + 3, DARK, 0.3, M + 30, PW - M);
    setFont("normal", 8, DARK);
    doc.text(rec.techSignature || rec.techName || "", M + 32, y + 2);
    y += 8;

    // Divider between days
    if (idx < sorted.length - 1) {
      hRule(y, LGRAY, 0.5);
      y += 4;
    }
  });

  // ================================================================
  // Trailer — moisture trend, aggregated equipment, clearance
  // ================================================================
  doc.addPage();
  y = drawBanner("STRUCTURAL DRYING REPORT", "Summary & Clearance");

  setFont("bold", 11, BLUE);
  doc.text("MOISTURE TREND", M, y);
  y += 5;

  const allReadings: Array<{ date: string; wme: number; material: string; location: string }> = [];
  sorted.forEach(rec => {
    parseArr<{ reading?: number; material?: string; location?: string }>(rec.moistureReadings).forEach(r => {
      if (r.reading != null && Number(r.reading) > 0) {
        allReadings.push({
          date: rec.readingDate || "",
          wme: Number(r.reading),
          material: r.material || "—",
          location: r.location || "—",
        });
      }
    });
  });

  if (allReadings.length > 0) {
    const highest = allReadings.reduce((p, c) => c.wme > p.wme ? c : p);
    const final = allReadings[allReadings.length - 1];
    doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
    doc.roundedRect(M, y, CONTENT_W, 22, 2, 2, "F");

    setFont("bold", 7, GRAY);
    doc.text("INITIAL HIGH READING", M + 4, y + 5);
    setFont("bold", 14, RED);
    doc.text(`${highest.wme}% WME`, M + 4, y + 12);
    setFont("normal", 7.5, GRAY);
    doc.text(`${highest.material} — ${highest.location}`, M + 4, y + 16);
    doc.text(`Date: ${highest.date ? fmtDateShort(highest.date) : "—"}`, M + 4, y + 19);

    // Helvetica WinAnsi has no U+2192 (→). Use ">" for a clean arrow-ish glyph.
    setFont("bold", 18, BLUE);
    doc.text(">", PW / 2, y + 12, { align: "center" });

    setFont("bold", 7, GRAY);
    doc.text("FINAL READING", PW * 0.6, y + 5);
    const finalColor = final.wme <= 16 ? GREEN : AMBER;
    setFont("bold", 14, finalColor);
    doc.text(`${final.wme}% WME`, PW * 0.6, y + 12);
    setFont("normal", 7.5, GRAY);
    doc.text(`${final.material} — ${final.location}`, PW * 0.6, y + 16);
    doc.text(`Date: ${final.date ? fmtDateShort(final.date) : "—"}`, PW * 0.6, y + 19);

    const pct = highest.wme > 0 ? ((highest.wme - final.wme) / highest.wme * 100).toFixed(0) : "0";
    setFont("bold", 8, GREEN);
    doc.text(`${pct}% reduction`, PW - M - 3, y + 12, { align: "right" });
    y += 26;
  } else {
    setFont("normal", 9, GRAY);
    doc.text("No moisture readings recorded.", M, y + 4);
    y += 10;
  }

  setFont("bold", 11, BLUE);
  doc.text("EQUIPMENT RUNTIME SUMMARY", M, y);
  y += 5;

  // Reconstruct one row per physical asset per room by de-duplicating on
  // (type, serialNumber, room) across all days. earliestStart / latestEnd
  // give the true deployment window; when any occurrence has a blank
  // endDate we treat the asset as still deployed and use the last known
  // reading date as the running-total endpoint. If the same asset was
  // deployed to multiple rooms across the job we get one row per room —
  // matches the field workflow where a mover is physically moved.
  type RollupEntry = {
    type: string;
    serial: string;
    room: string;
    qty: number;
    earliestStart?: string;      // YYYY-MM-DD
    earliestStartTime?: string;  // HH:MM aligned with earliestStart
    latestEnd?: string;
    latestEndTime?: string;
    stillDeployed: boolean;
  };
  const rollup = new Map<string, RollupEntry>();
  const lastReadingDate = sorted.length ? (sorted[sorted.length - 1].readingDate || "") : "";
  sorted.forEach(rec => {
    parseArr<{ type?: string; qty?: number; serialNumber?: string; room?: string; startDate?: string; startTime?: string; endDate?: string; endTime?: string }>(rec.equipment).forEach(e => {
      const type = (e.type || "").trim() || "—";
      const serial = (e.serialNumber || "").trim();
      const room = (e.room || "").trim() || "Unassigned";
      // Serial-less rows collapse per (type, room) so we don't produce
      // spurious duplicate rows when techs didn't record a serial.
      const key = `${type}␟${serial || "∅"}␟${room}`;
      const cur = rollup.get(key) || {
        type, serial, room,
        qty: 0,
        earliestStart: undefined,
        earliestStartTime: undefined,
        latestEnd: undefined,
        latestEndTime: undefined,
        stillDeployed: false,
      };
      cur.qty = Math.max(cur.qty, Number(e.qty) || 1);
      // Compare on date+time so the same date with different times still
      // resolves to the correct extreme. Missing time → 00:00.
      const startKey = e.startDate ? `${e.startDate}T${e.startTime && /^\d{2}:\d{2}$/.test(e.startTime) ? e.startTime : "00:00"}` : "";
      const endKey   = e.endDate   ? `${e.endDate}T${e.endTime && /^\d{2}:\d{2}$/.test(e.endTime)     ? e.endTime   : "00:00"}` : "";
      const curStartKey = cur.earliestStart ? `${cur.earliestStart}T${cur.earliestStartTime || "00:00"}` : "";
      const curEndKey   = cur.latestEnd     ? `${cur.latestEnd}T${cur.latestEndTime || "00:00"}`       : "";
      if (startKey && (!curStartKey || startKey < curStartKey)) {
        cur.earliestStart = e.startDate;
        cur.earliestStartTime = e.startTime;
      }
      if (endKey && (!curEndKey || endKey > curEndKey)) {
        cur.latestEnd = e.endDate;
        cur.latestEndTime = e.endTime;
      } else if (!e.endDate) {
        // Any occurrence without an endDate means "still on site" for this asset.
        cur.stillDeployed = true;
      }
      rollup.set(key, cur);
    });
  });

  const entries = Array.from(rollup.values()).sort((a, b) =>
    a.room.localeCompare(b.room) || a.type.localeCompare(b.type) || a.serial.localeCompare(b.serial));

  if (entries.length === 0) {
    setFont("normal", 9, GRAY);
    doc.text("No equipment recorded across drying days.", M, y + 4);
    y += 10;
  } else {
    // Group by room and render room banner + rows.
    const byRoom = new Map<string, RollupEntry[]>();
    entries.forEach(e => {
      const b = byRoom.get(e.room) || [];
      b.push(e);
      byRoom.set(e.room, b);
    });

    // Column layout mirrors the per-day equipment table so the report reads
    // consistently. Widen START/END here too for "MM/DD HH:MM".
    const COL_TYPE = 2;
    const COL_QTY = 44;
    const COL_SERIAL = 54;
    const COL_START = 92;
    const COL_END = 125;
    const COL_RT = 160;

    Array.from(byRoom.entries()).sort(([a], [b]) => a.localeCompare(b)).forEach(([room, items]) => {
      y = ensureSpace(y, 5 + items.length * 5 + 4);
      doc.setFillColor(LGRAY[0], LGRAY[1], LGRAY[2]);
      doc.rect(M, y, CONTENT_W, 5, "F");
      setFont("bold", 7.5, DARK);
      doc.text(`ROOM: ${room}`, M + 2, y + 3.5);
      setFont("bold", 6.5, DARK);
      doc.text("TYPE", M + COL_TYPE, y + 3.5);
      doc.text("QTY", M + COL_QTY, y + 3.5);
      doc.text("SERIAL", M + COL_SERIAL, y + 3.5);
      doc.text("START", M + COL_START, y + 3.5);
      doc.text("END", M + COL_END, y + 3.5);
      doc.text("TOTAL RUNTIME", M + COL_RT, y + 3.5);
      y += 5;

      let roomTotalHrs = 0;
      items.forEach((e, i) => {
        y = ensureSpace(y, 5);
        if (i % 2 === 0) {
          doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
          doc.rect(M, y, CONTENT_W, 5, "F");
        }
        setFont("normal", 7.5, DARK);
        doc.text(doc.splitTextToSize(e.type, 48)[0], M + COL_TYPE, y + 3.5);
        doc.text(String(e.qty), M + COL_QTY, y + 3.5);
        doc.text(doc.splitTextToSize(e.serial || "—", 36)[0], M + COL_SERIAL, y + 3.5);
        doc.text(fmtDateTimeShort(e.earliestStart, e.earliestStartTime), M + COL_START, y + 3.5);
        // Endpoint for runtime: latestEnd if pulled, else last known reading
        // date if still deployed. Label matches so the total reads honestly.
        const endForCalc = !e.stillDeployed && e.latestEnd ? e.latestEnd : lastReadingDate;
        const endTimeForCalc = !e.stillDeployed ? e.latestEndTime : "23:59";
        const endLabel = !e.stillDeployed && e.latestEnd
          ? fmtDateTimeShort(e.latestEnd, e.latestEndTime)
          : (e.stillDeployed ? "still on site" : "—");
        doc.text(endLabel, M + COL_END, y + 3.5);
        const hrs = pdfRuntimeHours(e.earliestStart, endForCalc, e.earliestStartTime, endTimeForCalc);
        if (hrs != null) roomTotalHrs += hrs * (e.qty || 1);
        const rtLabel = hrs != null
          ? (e.stillDeployed ? `${hrs}h (running)` : `${hrs}h`)
          : "—";
        doc.text(rtLabel, M + COL_RT, y + 3.5);
        y += 5;
      });

      // Per-room subtotal in unit-hours (qty × hours) — the number carriers
      // actually want for reimbursement calculations.
      setFont("italic" as any, 7, GRAY);
      doc.text(`Room subtotal: ${Math.round(roomTotalHrs * 10) / 10} unit-hours`, M + 2, y + 3);
      y += 6;
    });
  }

  // Clearance block: measure text height first so the box wraps content
  // exactly and the signatures below never fall off the page. Reserve space
  // for section heading + box + signatures + footer clearance (PH-14).
  setFont("normal", 8.5, DARK);
  const clearanceText =
    "I attest, in accordance with IICRC S500 §13.2, that all affected materials at the above-referenced property " +
    "have been verified at or below established drying standards. Moisture content of all structural materials has been " +
    "reduced to acceptable levels (Wood <= 16% WME, Drywall <= 1% WME, Concrete <= 4% WME). Indoor atmospheric conditions " +
    "(temperature, relative humidity, grains per pound) have been normalized to pre-loss levels. No visible mold growth, " +
    "standing water, or elevated moisture readings were observed at the time of clearance. All drying equipment has been " +
    "removed. The property is hereby released from active structural drying protocols.";
  const clearLines = doc.splitTextToSize(clearanceText, CONTENT_W - 8) as string[];
  const LINE_H = 4.2;                            // 8.5pt text with a touch of leading
  const boxH = clearLines.length * LINE_H + 8;   // padding top + bottom
  const SIG_BLOCK_H = 20;                        // heading + rule + name + subtitle
  const HEADING_H = 8;
  const totalNeeded = HEADING_H + boxH + SIG_BLOCK_H + 4;
  y = ensureSpace(y, totalNeeded);

  setFont("bold", 11, BLUE);
  doc.text("FINAL CLEARANCE STATEMENT — IICRC S500 §13.2", M, y);
  y += 4;

  doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
  doc.roundedRect(M, y, CONTENT_W, boxH, 2, 2, "F");
  setFont("normal", 8.5, DARK);
  doc.text(clearLines, M + 4, y + 5, { lineHeightFactor: 1.25 });
  y += boxH + 6;

  setFont("bold", 8, GRAY);
  doc.text("TECHNICIAN SIGNATURE", M, y);
  hRule(y + 4, DARK, 0.3, M, M + 80);
  setFont("normal", 8, DARK);
  doc.text(job.assignedTech || "________________________", M, y + 9);
  setFont("normal", 7, GRAY);
  doc.text("Certified Technician, Titan Restoration LLC", M, y + 14);

  setFont("bold", 8, GRAY);
  doc.text("DATE", M + 100, y);
  hRule(y + 4, DARK, 0.3, M + 100, PW - M);
  setFont("normal", 8, DARK);
  doc.text(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), M + 100, y + 9);

  // Footer + page numbers on every page
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    hRule(PH - 11);
    setFont("normal", 6.5, GRAY);
    doc.text(
      "Prepared in accordance with IICRC S500 Standard for Professional Water Damage Restoration. Titan Restoration LLC · Augusta, GA · 706-922-0154",
      PW / 2,
      PH - 7,
      { align: "center" },
    );
    setFont("normal", 7, GRAY);
    doc.text(`Page ${p} of ${pageCount}`, PW - M, PH - 3, { align: "right" });
    doc.text(`Job #${job.jobNumber}`, M, PH - 3);
  }

  return doc.output("datauristring");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
interface DryStandardReportGeneratorProps {
  job: Job;
  jobId: number;
}

export function DryStandardReportGenerator({
  job,
  jobId,
}: DryStandardReportGeneratorProps) {
  const { toast } = useToast();
  const [pdfDataUri, setPdfDataUri] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  const { data: records = [], isLoading: recordsLoading } = useQuery<DryingRecord[]>({
    queryKey: ["/api/jobs", String(jobId), "drying-records"],
    queryFn: () =>
      apiRequest("GET", `/api/jobs/${jobId}/drying-records`).then(r => r.json()),
  });

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const uri = await generateDryReportPDF(job, records);
      setPdfDataUri(uri);
      setShowPreview(false);
      toast({ title: "✅ Drying Report PDF generated" });
    } catch (err: any) {
      toast({
        title: "PDF generation failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!pdfDataUri) return;
    const link = document.createElement("a");
    link.href = pdfDataUri;
    link.download = `Drying_Report_${job.jobNumber}.pdf`;
    link.click();
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/jobs/${jobId}/documents`, {
        docType: "dry_standard_report",
        title: `IICRC S500 Drying Report — ${job.jobNumber}`,
        formData: JSON.stringify({ generatedAt: new Date().toISOString(), recordCount: records.length }),
        status: "signed",
        createdBy: "Titan Pro",
        fileData: pdfDataUri,
        fileName: `Drying_Report_${job.jobNumber}.pdf`,
        fileMimeType: "application/pdf",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/jobs", String(jobId), "documents"],
      });
      toast({ title: "✅ Drying Report saved to job file" });
    },
    onError: (err: any) => {
      toast({
        title: "Save failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  // Summary stats for preview
  const uniqueEquip = (() => {
    const seen = new Set<string>();
    records.forEach(r => {
      try {
        JSON.parse(r.equipment || "[]").forEach((e: any) => {
          if (e.type) seen.add(e.type);
        });
      } catch {}
    });
    return Array.from(seen);
  })();

  const highestWME = (() => {
    let max = 0;
    records.forEach(r => {
      try {
        JSON.parse(r.moistureReadings || "[]").forEach((m: any) => {
          if (m.reading > max) max = m.reading;
        });
      } catch {}
    });
    return max;
  })();

  const latestWME = (() => {
    if (records.length === 0) return 0;
    // Records are keyed by readingDate (YYYY-MM-DD) with a per-day dayNumber.
    // Fall back to dayNumber tie-break so multiple entries on the same day
    // still order deterministically.
    const sorted = [...records].sort((a, b) => {
      const da = (b.readingDate || "").localeCompare(a.readingDate || "");
      if (da !== 0) return da;
      return (b.dayNumber || 0) - (a.dayNumber || 0);
    });
    let latest = 0;
    try {
      const mr = JSON.parse(sorted[0].moistureReadings || "[]");
      if (mr.length > 0) latest = mr[mr.length - 1].reading || 0;
    } catch {}
    return latest;
  })();

  return (
    <Card className="border-[hsl(var(--titan-blue)/0.4)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
          IICRC S500 Structural Drying Report
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Report preview summary */}
        {showPreview && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="w-3.5 h-3.5 flex-shrink-0" />
              <span>
                This report will compile every drying log entry into a multi-page
                IICRC S500-compliant PDF with a per-day breakdown (psychrometric readings,
                affected areas, moisture readings, equipment, observations, and signature),
                followed by a moisture trend, equipment summary, and technician clearance attestation.
              </span>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="border rounded-lg p-3 text-center bg-muted/20">
                {recordsLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  <p className="text-xl font-bold text-[hsl(var(--titan-blue))]">{records.length}</p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">Log Entries</p>
              </div>
              <div className="border rounded-lg p-3 text-center bg-muted/20">
                <p className="text-xl font-bold text-red-600">{highestWME > 0 ? `${highestWME}%` : "—"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Peak WME</p>
              </div>
              <div className="border rounded-lg p-3 text-center bg-muted/20">
                <p className={`text-xl font-bold ${latestWME <= 16 && latestWME > 0 ? "text-green-600" : latestWME > 16 ? "text-amber-600" : "text-muted-foreground"}`}>
                  {latestWME > 0 ? `${latestWME}%` : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Latest WME</p>
              </div>
              <div className="border rounded-lg p-3 text-center bg-muted/20">
                <p className="text-xl font-bold text-[hsl(var(--titan-blue))]">{uniqueEquip.length}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Equipment Types</p>
              </div>
            </div>

            {/* S500 target reference */}
            <div className="border rounded-lg p-3 bg-blue-50 dark:bg-blue-950/20 space-y-1 text-xs">
              <p className="font-semibold text-[hsl(var(--titan-blue))]">
                IICRC S500 Clearance Targets (will appear in report)
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
                <span>Wood / Framing: ≤{S500_TARGETS.wood.wme}% WME</span>
                <span>Indoor GPP Goal: ≤{S500_TARGETS.gpp.value} grains/lb</span>
                <span>Drywall / Gypsum: ≤{S500_TARGETS.drywall.wme}% WME</span>
                <span>Relative Humidity: ≤50% target</span>
                <span>Concrete / Masonry: ≤{S500_TARGETS.concrete.wme}% WME</span>
                <span>Temperature: 70–90°F recommended</span>
              </div>
            </div>

            {/* Recent log preview */}
            {records.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Recent Log Entries (preview)
                </p>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs h-7">Day</TableHead>
                        <TableHead className="text-xs h-7">Date</TableHead>
                        <TableHead className="text-xs h-7">Readings</TableHead>
                        <TableHead className="text-xs h-7">
                          <span className="flex items-center gap-1">
                            <Droplets className="w-3 h-3" />RH%
                          </span>
                        </TableHead>
                        <TableHead className="text-xs h-7">
                          <span className="flex items-center gap-1">
                            <Thermometer className="w-3 h-3" />Temp
                          </span>
                        </TableHead>
                        <TableHead className="text-xs h-7">GPP</TableHead>
                        <TableHead className="text-xs h-7">Tech</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...records]
                        .sort((a, b) => {
                          const da = (a.readingDate || "").localeCompare(b.readingDate || "");
                          if (da !== 0) return da;
                          return (a.dayNumber || 0) - (b.dayNumber || 0);
                        })
                        .slice(0, 5)
                        .map(rec => {
                          const gpp =
                            rec.tempF && rec.rhPct
                              ? calcGPP(rec.tempF, rec.rhPct)
                              : null;
                          let readingCount = 0;
                          try { readingCount = (JSON.parse(rec.moistureReadings || "[]") as any[]).length; } catch {}
                          return (
                            <TableRow key={rec.id} className="text-xs">
                              <TableCell className="py-1.5 font-semibold">Day {rec.dayNumber || "—"}</TableCell>
                              <TableCell className="py-1.5">
                                {rec.readingDate ? fmtDateShort(rec.readingDate) : "—"}
                              </TableCell>
                              <TableCell className="py-1.5">
                                {rec.recordType === "missed" ? (
                                  <span className="text-amber-600">Missed</span>
                                ) : readingCount > 0 ? (
                                  `${readingCount} reading${readingCount === 1 ? "" : "s"}`
                                ) : "—"}
                              </TableCell>
                              <TableCell className="py-1.5">
                                {rec.rhPct != null ? `${rec.rhPct}%` : "—"}
                              </TableCell>
                              <TableCell className="py-1.5">
                                {rec.tempF != null ? `${rec.tempF}°F` : "—"}
                              </TableCell>
                              <TableCell className="py-1.5">
                                {gpp !== null ? (
                                  <span className={gpp <= 55 ? "text-green-600" : "text-amber-600"}>
                                    {gpp}
                                  </span>
                                ) : "—"}
                              </TableCell>
                              <TableCell className="py-1.5">{rec.techName || "—"}</TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                  {records.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center py-1.5 border-t">
                      +{records.length - 5} more entries in full report
                    </p>
                  )}
                </div>
              </div>
            )}

            {records.length === 0 && !recordsLoading && (
              <div className="border border-dashed rounded-lg p-4 text-center text-xs text-muted-foreground">
                <AlertTriangle className="w-4 h-4 mx-auto mb-1 text-amber-500" />
                No drying records found for this job. The report will still be generated
                with job info and S500 standards reference.
              </div>
            )}
          </div>
        )}

        {/* Generated PDF actions */}
        {pdfDataUri && (
          <div className="border rounded-lg p-4 bg-green-50 dark:bg-green-950/20 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400">
              <CheckCircle2 className="w-4 h-4" />
              Drying Report PDF ready — {records.length} log entries compiled
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownload}
                data-testid="dry-report-btn-download"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Download PDF
              </Button>
              <Button
                size="sm"
                className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue)/0.85)] text-white"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                data-testid="dry-report-btn-save"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                )}
                {saveMutation.isPending ? "Saving…" : "Save to Job File"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowPreview(p => !p)}
                data-testid="dry-report-btn-toggle-preview"
              >
                {showPreview ? "Hide" : "Show"} Preview
              </Button>
            </div>
          </div>
        )}

        {/* Generate button */}
        <Button
          className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)] text-white"
          onClick={handleGenerate}
          disabled={generating || recordsLoading}
          data-testid="dry-report-btn-generate"
        >
          {generating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating Report…
            </>
          ) : (
            <>
              <FileText className="w-4 h-4 mr-2" />
              {pdfDataUri ? "Regenerate Drying Report PDF" : "Generate Drying Report PDF"}
            </>
          )}
        </Button>

        <p className="text-[10px] text-muted-foreground text-center">
          This report is prepared in accordance with IICRC S500 Standard for
          Professional Water Damage Restoration
        </p>
      </CardContent>
    </Card>
  );
}
