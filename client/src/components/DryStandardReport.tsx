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
// jsPDF (~600KB) is loaded on demand so it isn't bundled into JobDetail on
// every page load — only fetched when a drying report is actually generated.
const loadJsPDF = async () => (await import("jspdf")).default;
type JsPDFDoc = Awaited<ReturnType<typeof loadJsPDF>> extends new (...args: any[]) => infer R ? R : any;
import type { Job, DryingRecord } from "@shared/schema";

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
async function generateDryReportPDF(job: Job, records: DryingRecord[]): Promise<string> {
  const jsPDF = await loadJsPDF();
  const doc: JsPDFDoc = new jsPDF({ orientation: "landscape", unit: "mm", format: "letter" });
  const PW = 279.4;
  const PH = 215.9;
  const M  = 12;

  const setFont = (w: "normal" | "bold", sz: number, color: readonly [number, number, number] = DARK) => {
    doc.setFont("helvetica", w);
    doc.setFontSize(sz);
    doc.setTextColor(color[0], color[1], color[2]);
  };
  const hRule = (y: number, color: readonly [number, number, number] = LGRAY, lw = 0.3) => {
    doc.setDrawColor(color[0], color[1], color[2]);
    doc.setLineWidth(lw);
    doc.line(M, y, PW - M, y);
  };

  // ── PAGE 1: Header + Job Info + S500 Standards ────────────────────────────
  // Header band
  doc.setFillColor(RED[0], RED[1], RED[2]);
  doc.rect(0, 0, PW, 20, "F");
  doc.setFillColor(BLUE[0], BLUE[1], BLUE[2]);
  doc.rect(0, 20, PW, 4, "F");

  setFont("bold", 16, WHITE);
  doc.text("TITAN RESTORATION LLC", M, 13);
  setFont("normal", 8, WHITE);
  doc.text("Augusta, GA  ·  706-922-0154  ·  titanrestorationllc.com", M, 19);

  // Report title (right side of header)
  setFont("bold", 10, WHITE);
  doc.text("STRUCTURAL DRYING REPORT", PW - M, 10, { align: "right" });
  setFont("normal", 8, WHITE);
  doc.text("IICRC S500 Standard for Professional Water Damage Restoration", PW - M, 16, { align: "right" });

  let y = 32;

  // Job info table
  doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
  doc.roundedRect(M, y - 4, PW - M * 2, 28, 2, 2, "F");

  const col1 = M + 4;
  const col2 = PW / 4 + 4;
  const col3 = PW / 2 + 4;
  const col4 = (PW * 3) / 4 + 4;

  const fieldCell = (label: string, value: string, x: number, cy: number, maxW = 55) => {
    setFont("bold", 7, GRAY);
    doc.text(label.toUpperCase(), x, cy);
    setFont("normal", 8.5, DARK);
    const lines = doc.splitTextToSize(value || "—", maxW);
    doc.text(lines, x, cy + 4);
    return cy + 4 + (lines.length - 1) * 4;
  };

  fieldCell("Job Number", job.jobNumber, col1, y);
  fieldCell("Property Address", job.address || "—", col2, y, 60);
  fieldCell("Loss Type", (job.lossType || "—").replace(/_/g, " ").toUpperCase(), col3, y);
  fieldCell("Assigned Tech", job.assignedTech || "—", col4, y);

  y += 10;
  fieldCell("Insurance Carrier", job.insuranceCarrier || "—", col1, y);
  fieldCell("Claim Number", job.claimNumber || "—", col2, y);
  fieldCell("Policy Number", (job as any).policyNumber || "—", col3, y);
  fieldCell("Report Date", new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), col4, y);

  y += 12;
  hRule(y);

  // ── S500 Psychrometric Standards section ───────────────────────────────────
  y += 6;
  setFont("bold", 10, BLUE);
  doc.text("IICRC S500 PSYCHROMETRIC STANDARDS REFERENCE", M, y);

  y += 5;
  // Standards box
  doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
  doc.roundedRect(M, y - 2, PW - M * 2, 22, 2, 2, "F");

  setFont("bold", 8, DARK);
  doc.text("Target Moisture Equivalence (WME):", M + 4, y + 4);
  setFont("normal", 8, DARK);
  doc.text(`Wood/Framing: ≤${S500_TARGETS.wood.wme}%`, M + 4, y + 9);
  doc.text(`Drywall/Gypsum: ≤${S500_TARGETS.drywall.wme}%`, M + 4, y + 13);
  doc.text(`Concrete/Masonry: ≤${S500_TARGETS.concrete.wme}%`, M + 4, y + 17);

  setFont("bold", 8, DARK);
  doc.text("Atmospheric Targets:", PW / 3 + 4, y + 4);
  setFont("normal", 8, DARK);
  doc.text(`Target GPP: ≤${S500_TARGETS.gpp.value} grains/lb (indoor humidity goal)`, PW / 3 + 4, y + 9);
  doc.text("Relative Humidity: Typically ≤50% for structural drying", PW / 3 + 4, y + 13);
  doc.text("Temperature: 70–90°F recommended for optimal drying", PW / 3 + 4, y + 17);

  setFont("bold", 8, DARK);
  doc.text("Clearance Criteria (S500 §13.2):", (PW * 2) / 3 + 4, y + 4);
  setFont("normal", 8, DARK);
  doc.text("All affected materials at or below dry standard", (PW * 2) / 3 + 4, y + 9);
  doc.text("Ambient conditions normalized to pre-loss levels", (PW * 2) / 3 + 4, y + 13);
  doc.text("No visible mold growth or odor observed", (PW * 2) / 3 + 4, y + 17);

  y += 26;
  hRule(y);

  // ── PAGE 2+: Daily Drying Log table ──────────────────────────────────────
  if (records.length > 0) {
    doc.addPage();
    // Re-draw a mini header
    doc.setFillColor(RED[0], RED[1], RED[2]);
    doc.rect(0, 0, PW, 12, "F");
    setFont("bold", 11, WHITE);
    doc.text("TITAN RESTORATION LLC  —  DAILY DRYING LOG", PW / 2, 8, { align: "center" });

    y = 18;
    setFont("bold", 10, BLUE);
    doc.text("DAILY DRYING LOG", M, y);
    setFont("normal", 8, GRAY);
    doc.text(`Job #${job.jobNumber}  ·  ${records.length} log entries`, PW - M, y, { align: "right" });

    y += 5;

    // Table headers
    const cols = [
      { header: "Date", w: 22 },
      { header: "Area / Location", w: 38 },
      { header: "Material", w: 30 },
      { header: "WME%", w: 14 },
      { header: "Temp°F", w: 16 },
      { header: "RH%", w: 13 },
      { header: "GPP", w: 13 },
      { header: "Equipment Running", w: 40 },
      { header: "Notes", w: 45 },
      { header: "Tech", w: 20 },
    ];

    // Header row
    doc.setFillColor(BLUE[0], BLUE[1], BLUE[2]);
    doc.rect(M, y - 4, PW - M * 2, 7, "F");
    let cx = M + 1;
    cols.forEach(c => {
      setFont("bold", 7, WHITE);
      doc.text(c.header, cx, y);
      cx += c.w;
    });

    y += 4;

    // Data rows
    records.forEach((rec, i) => {
      const rowH = 6;
      if (y + rowH > PH - 15) {
        doc.addPage();
        doc.setFillColor(RED[0], RED[1], RED[2]);
        doc.rect(0, 0, PW, 12, "F");
        setFont("bold", 11, WHITE);
        doc.text("TITAN RESTORATION LLC  —  DAILY DRYING LOG (continued)", PW / 2, 8, { align: "center" });
        y = 18;
        // Re-draw header row
        doc.setFillColor(BLUE[0], BLUE[1], BLUE[2]);
        doc.rect(M, y - 4, PW - M * 2, 7, "F");
        cx = M + 1;
        cols.forEach(c => {
          setFont("bold", 7, WHITE);
          doc.text(c.header, cx, y);
          cx += c.w;
        });
        y += 4;
      }

      // Alternating row bg
      if (i % 2 === 0) {
        doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
        doc.rect(M, y - 3.5, PW - M * 2, rowH, "F");
      }

      // Parse moisture readings for WME
      let wme = "—";
      try {
        const mr = JSON.parse(rec.moistureReadings || "[]");
        if (mr.length > 0) {
          const maxReading = Math.max(...mr.map((r: any) => r.reading || 0));
          wme = `${maxReading}%`;
        }
      } catch {}

      // Parse equipment
      let equip = "—";
      try {
        const eq = JSON.parse(rec.equipment || "[]");
        if (eq.length > 0) {
          equip = eq
            .slice(0, 3)
            .map((e: any) => `${e.qty || 1}x ${e.type || ""}`.trim())
            .join(", ");
          if (eq.length > 3) equip += `…+${eq.length - 3}`;
        }
      } catch {}

      const gpp = rec.tempF && rec.relativeHumidity
        ? String(calcGPP(rec.tempF, rec.relativeHumidity))
        : "—";

      const cells = [
        rec.recordDate ? new Date(rec.recordDate).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" }) : "—",
        rec.area || "—",
        rec.material || "—",
        wme,
        rec.tempF ? `${rec.tempF}°` : "—",
        rec.relativeHumidity ? `${rec.relativeHumidity}%` : "—",
        gpp,
        equip,
        rec.notes ? rec.notes.slice(0, 60) : "—",
        rec.technician || "—",
      ];

      cx = M + 1;
      cells.forEach((cell, ci) => {
        setFont("normal", 7, DARK);
        const truncated = String(cell).slice(0, Math.floor(cols[ci].w / 2.2));
        doc.text(truncated, cx, y);
        cx += cols[ci].w;
      });

      y += rowH;
    });
  }

  // ── Page 3: Moisture trend + Equipment summary + Final clearance ──────────
  doc.addPage();
  doc.setFillColor(RED[0], RED[1], RED[2]);
  doc.rect(0, 0, PW, 12, "F");
  setFont("bold", 11, WHITE);
  doc.text("TITAN RESTORATION LLC  —  DRYING ANALYSIS & CLEARANCE", PW / 2, 8, { align: "center" });

  y = 20;

  // Moisture trend
  setFont("bold", 11, BLUE);
  doc.text("MOISTURE TREND — HIGHEST READING TO CLEARANCE", M, y);
  y += 6;

  if (records.length > 0) {
    // Find highest and final readings
    let allReadings: Array<{ date: string; wme: number; material: string; area: string }> = [];
    records.forEach(rec => {
      try {
        const mr = JSON.parse(rec.moistureReadings || "[]");
        mr.forEach((r: any) => {
          if (r.reading) {
            allReadings.push({
              date: rec.recordDate || "",
              wme: r.reading,
              material: r.material || rec.material || "—",
              area: r.location || rec.area || "—",
            });
          }
        });
      } catch {}
    });

    if (allReadings.length > 0) {
      const sorted = [...allReadings].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const highest = allReadings.reduce((p, c) => c.wme > p.wme ? c : p);
      const final = allReadings[allReadings.length - 1];

      doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
      doc.roundedRect(M, y - 2, PW - M * 2, 18, 2, 2, "F");

      setFont("bold", 8, GRAY);
      doc.text("INITIAL HIGH READING", M + 4, y + 3);
      setFont("bold", 12, RED);
      doc.text(`${highest.wme}% WME`, M + 4, y + 9);
      setFont("normal", 7.5, GRAY);
      doc.text(`${highest.material} — ${highest.area}`, M + 4, y + 13);
      doc.text(`Date: ${highest.date ? new Date(highest.date).toLocaleDateString() : "—"}`, M + 4, y + 16);

      // Arrow
      setFont("bold", 14, BLUE);
      doc.text("→", PW / 2, y + 9, { align: "center" });

      setFont("bold", 8, GRAY);
      doc.text("FINAL CLEARANCE READING", PW * 0.55, y + 3);
      const finalColor = final.wme <= 16 ? GREEN : AMBER;
      setFont("bold", 12, finalColor);
      doc.text(`${final.wme}% WME`, PW * 0.55, y + 9);
      setFont("normal", 7.5, GRAY);
      doc.text(`${final.material} — ${final.area}`, PW * 0.55, y + 13);
      doc.text(`Date: ${final.date ? new Date(final.date).toLocaleDateString() : "—"}`, PW * 0.55, y + 16);

      // Reduction %
      const pct = ((highest.wme - final.wme) / highest.wme * 100).toFixed(0);
      setFont("bold", 8, GREEN);
      doc.text(`${pct}% moisture reduction achieved`, PW - M, y + 9, { align: "right" });
    }
  } else {
    setFont("normal", 9, GRAY);
    doc.text("No drying records found for this job.", M, y + 6);
  }

  y += 22;
  hRule(y);

  // Equipment summary
  y += 6;
  setFont("bold", 11, BLUE);
  doc.text("EQUIPMENT SUMMARY", M, y);
  y += 6;

  const equipMap: Record<string, number> = {};
  records.forEach(rec => {
    try {
      const eq = JSON.parse(rec.equipment || "[]");
      eq.forEach((e: any) => {
        if (e.type) {
          equipMap[e.type] = (equipMap[e.type] || 0) + (e.qty || 1);
        }
      });
    } catch {}
  });

  const equipList = Object.entries(equipMap);
  if (equipList.length > 0) {
    doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
    const equipH = Math.ceil(equipList.length / 3) * 7 + 6;
    doc.roundedRect(M, y - 2, PW - M * 2, equipH, 2, 2, "F");

    const perCol = Math.ceil(equipList.length / 3);
    equipList.forEach(([type, qty], i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const ex = M + 4 + col * (PW / 3 - 4);
      const ey = y + 3 + row * 6.5;
      setFont("bold", 8, DARK);
      doc.text(`${qty}x`, ex, ey);
      setFont("normal", 8, DARK);
      doc.text(type, ex + 7, ey);
    });

    y += equipH + 4;
  } else {
    setFont("normal", 9, GRAY);
    doc.text("No equipment records found.", M, y + 4);
    y += 12;
  }

  hRule(y);

  // Final clearance confirmation
  y += 6;
  setFont("bold", 11, BLUE);
  doc.text("FINAL CLEARANCE STATEMENT — IICRC S500 §13.2", M, y);
  y += 6;

  doc.setFillColor(OFFWHITE[0], OFFWHITE[1], OFFWHITE[2]);
  doc.roundedRect(M, y - 2, PW - M * 2, 30, 2, 2, "F");

  setFont("normal", 8.5, DARK);
  const clearanceText =
    "I attest, in accordance with IICRC S500 §13.2, that all affected materials at the above-referenced property " +
    "have been verified at or below established drying standards. Moisture content of all structural materials has been " +
    "reduced to acceptable levels (Wood ≤16% WME, Drywall ≤1% WME, Concrete ≤4% WME). Indoor atmospheric conditions " +
    "(temperature, relative humidity, grains per pound) have been normalized to pre-loss levels. No visible mold growth, " +
    "standing water, or elevated moisture readings were observed at the time of clearance. All drying equipment has been " +
    "removed. The property is hereby released from active structural drying protocols.";
  const clearLines = doc.splitTextToSize(clearanceText, PW - M * 2 - 8);
  doc.text(clearLines, M + 4, y + 4);

  y += 34;

  // Technician signature line
  setFont("bold", 8, GRAY);
  doc.text("TECHNICIAN SIGNATURE", M, y);
  hRule(y + 4, DARK, 0.3);
  setFont("normal", 8, GRAY);
  doc.text(job.assignedTech || "________________________", M, y + 9);
  doc.text("Certified Technician, Titan Restoration LLC", M, y + 14);

  setFont("bold", 8, GRAY);
  doc.text("DATE", PW / 2, y);
  hRule(y + 4, DARK, 0.3);
  setFont("normal", 8, GRAY);
  doc.text(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), PW / 2, y + 9);

  // Footer disclaimer
  const footerY = PH - 10;
  hRule(footerY - 5);
  setFont("normal", 6.5, GRAY);
  doc.text(
    "This report prepared in accordance with IICRC S500 Standard for Professional Water Damage Restoration.  Titan Restoration LLC · Augusta, GA · 706-922-0154",
    PW / 2,
    footerY,
    { align: "center" }
  );

  // Page numbers
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    setFont("normal", 7, GRAY);
    doc.text(`Page ${p} of ${pageCount}`, PW - M, PH - 5, { align: "right" });
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
    const sorted = [...records].sort((a, b) =>
      new Date(b.recordDate || 0).getTime() - new Date(a.recordDate || 0).getTime()
    );
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
                This report will compile all drying log entries into a multi-page
                IICRC S500-compliant PDF with job info, daily log table, moisture trend,
                equipment summary, and technician clearance attestation.
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
                        <TableHead className="text-xs h-7">Date</TableHead>
                        <TableHead className="text-xs h-7">Area</TableHead>
                        <TableHead className="text-xs h-7">Material</TableHead>
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
                      {records.slice(0, 5).map(rec => {
                        const gpp =
                          rec.tempF && rec.relativeHumidity
                            ? calcGPP(rec.tempF, rec.relativeHumidity)
                            : null;
                        return (
                          <TableRow key={rec.id} className="text-xs">
                            <TableCell className="py-1.5">
                              {rec.recordDate
                                ? new Date(rec.recordDate).toLocaleDateString()
                                : "—"}
                            </TableCell>
                            <TableCell className="py-1.5">{rec.area || "—"}</TableCell>
                            <TableCell className="py-1.5">{rec.material || "—"}</TableCell>
                            <TableCell className="py-1.5">
                              {rec.relativeHumidity ? `${rec.relativeHumidity}%` : "—"}
                            </TableCell>
                            <TableCell className="py-1.5">
                              {rec.tempF ? `${rec.tempF}°F` : "—"}
                            </TableCell>
                            <TableCell className="py-1.5">
                              {gpp !== null ? (
                                <span className={gpp <= 55 ? "text-green-600" : "text-amber-600"}>
                                  {gpp}
                                </span>
                              ) : "—"}
                            </TableCell>
                            <TableCell className="py-1.5">{rec.technician || "—"}</TableCell>
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
