/**
 * CertificateOfCompletion.tsx
 * E-sign form that generates a branded PDF certificate upon job completion.
 * Auto-triggers follow-up email schedule on save.
 *
 * Exports:
 *   CertificateOfCompletion  — full e-sign form (used in JobDocuments)
 *   CertOfCompletionCard     — compact card for document library listing
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { useRef, useState, useEffect, useCallback } from "react";
import {
  CheckCircle2, X, AlertTriangle, Award, CalendarCheck,
  ClipboardList, Star, ShieldCheck, FileText
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
// jsPDF (~600KB) is loaded on demand so it isn't bundled into JobDetail on
// every page load — only fetched when a certificate PDF is actually generated.
const loadJsPDF = async () => (await import("jspdf")).default;
type JsPDFDoc = Awaited<ReturnType<typeof loadJsPDF>> extends new (...args: any[]) => infer R ? R : any;
import type { Job, Contact, JobDocument } from "@shared/schema";

// ─── Brand constants (matches pdfEngine.ts) ──────────────────────────────────
const RED    = [204, 0, 0]    as const;
const BLUE   = [30, 90, 180]  as const;
const DARK   = [20, 20, 20]   as const;
const GRAY   = [100, 100, 100] as const;
const LGRAY  = [220, 220, 220] as const;
const WHITE  = [255, 255, 255] as const;
const OFFWHITE = [248, 248, 250] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Reusable Signature Pad (same pattern as WorkAuthorizationForm)
// ─────────────────────────────────────────────────────────────────────────────
function SignaturePad({
  label,
  onSign,
  onClear,
  testId,
}: {
  label: string;
  onSign: (dataUrl: string) => void;
  onClear: () => void;
  testId?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasSig, setHasSig] = useState(false);

  const getPos = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = useCallback((e: MouseEvent | TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    drawing.current = true;
  }, []);

  const draw = useCallback((e: MouseEvent | TouchEvent) => {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e, canvas);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasSig(true);
  }, []);

  const endDraw = useCallback(() => {
    drawing.current = false;
    const canvas = canvasRef.current;
    if (!canvas || !hasSig) return;
    onSign(canvas.toDataURL("image/png"));
  }, [hasSig, onSign]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSig(false);
    onClear();
  }, [onClear]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", draw);
    canvas.addEventListener("mouseup", endDraw);
    canvas.addEventListener("mouseleave", endDraw);
    canvas.addEventListener("touchstart", startDraw, { passive: false });
    canvas.addEventListener("touchmove", draw, { passive: false });
    canvas.addEventListener("touchend", endDraw);
    return () => {
      canvas.removeEventListener("mousedown", startDraw);
      canvas.removeEventListener("mousemove", draw);
      canvas.removeEventListener("mouseup", endDraw);
      canvas.removeEventListener("mouseleave", endDraw);
      canvas.removeEventListener("touchstart", startDraw);
      canvas.removeEventListener("touchmove", draw);
      canvas.removeEventListener("touchend", endDraw);
    };
  }, [startDraw, draw, endDraw]);

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold">{label}</Label>
      <div className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-white dark:bg-gray-900 overflow-hidden cursor-crosshair">
        <canvas
          ref={canvasRef}
          width={600}
          height={150}
          className="w-full touch-none"
          style={{ height: "150px" }}
          data-testid={testId || "signature-canvas"}
        />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Draw signature above using mouse or touch
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-destructive"
          onClick={clear}
          data-testid={`${testId || "signature"}-clear`}
        >
          <X className="w-3 h-3 mr-1" />Clear
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF generator
// ─────────────────────────────────────────────────────────────────────────────
interface CertPDFData {
  jobNumber: string;
  address: string;
  completionDate: string;
  workScope: string;
  finalReadings: string;
  homeownerSatisfaction: string;
  reservationNotes: string;
  propertyCondition: string;
  warrantyOffered: string;
  returnInspectionDate: string;
  signerName: string;
  homeownerSigUrl: string;
  techSigUrl?: string;
  techName?: string;
  signedAt: string;
  documentId: string;
}

async function generateCertPDF(data: CertPDFData): Promise<string> {
  const jsPDF = await loadJsPDF();
  const doc: JsPDFDoc = new jsPDF({ orientation: "portrait", unit: "mm", format: "letter" });
  const PW = 215.9;
  const M  = 14;

  const setFont = (w: "normal" | "bold", sz: number, color = DARK) => {
    doc.setFont("helvetica", w);
    doc.setFontSize(sz);
    doc.setTextColor(...color);
  };
  const hRule = (y: number, color = LGRAY, lw = 0.3) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(lw);
    doc.line(M, y, PW - M, y);
  };
  const fieldRow = (label: string, value: string, x: number, y: number, maxW = 82) => {
    setFont("bold", 7.5, GRAY);
    doc.text(label.toUpperCase(), x, y);
    setFont("normal", 9, DARK);
    const lines = doc.splitTextToSize(value || "—", maxW);
    doc.text(lines, x, y + 4.5);
    return y + 4.5 + (lines.length - 1) * 4.5;
  };

  // ── Header band ─────────────────────────────────────────────────────────
  doc.setFillColor(...RED);
  doc.rect(0, 0, PW, 22, "F");
  doc.setFillColor(...BLUE);
  doc.rect(0, 22, PW, 5, "F");

  setFont("bold", 18, WHITE);
  doc.text("TITAN RESTORATION LLC", M, 14);
  setFont("normal", 8, WHITE);
  doc.text("Augusta, GA  ·  706-922-0154  ·  titanrestorationllc.com", M, 20);

  // ── Title ────────────────────────────────────────────────────────────────
  let y = 38;
  setFont("bold", 16, [30, 90, 180]);
  doc.text("CERTIFICATE OF COMPLETION", PW / 2, y, { align: "center" });

  y += 5;
  setFont("normal", 8.5, GRAY);
  doc.text("Issued upon satisfactory completion of all contracted restoration services", PW / 2, y, { align: "center" });

  y += 7;
  hRule(y, BLUE as unknown as [number, number, number], 0.6);

  // ── Job info table ───────────────────────────────────────────────────────
  y += 7;
  doc.setFillColor(...OFFWHITE);
  doc.roundedRect(M, y - 4, PW - M * 2, 26, 2, 2, "F");

  const col1 = M + 4;
  const col2 = PW / 2 + 4;

  fieldRow("Job Number", data.jobNumber, col1, y, 80);
  fieldRow("Completion Date", new Date(data.completionDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), col2, y, 80);
  y += 9;
  fieldRow("Property Address", data.address || "—", col1, y, PW - M * 2 - 8);
  y += 12;

  hRule(y);

  // ── Work scope ───────────────────────────────────────────────────────────
  y += 7;
  setFont("bold", 10, BLUE as unknown as [number, number, number]);
  doc.text("SCOPE OF COMPLETED WORK", M, y);
  y += 5;
  setFont("normal", 8.5, DARK);
  const scopeLines = doc.splitTextToSize(data.workScope || "—", PW - M * 2);
  doc.text(scopeLines, M, y);
  y += scopeLines.length * 4.5 + 4;

  hRule(y);

  // ── Final readings ───────────────────────────────────────────────────────
  y += 7;
  setFont("bold", 10, BLUE as unknown as [number, number, number]);
  doc.text("FINAL CLEARANCE READINGS", M, y);
  y += 5;
  setFont("normal", 8.5, DARK);
  const readingLines = doc.splitTextToSize(data.finalReadings || "—", PW - M * 2);
  doc.text(readingLines, M, y);
  y += readingLines.length * 4.5 + 4;

  hRule(y);

  // ── Satisfaction & warranty row ───────────────────────────────────────────
  y += 7;
  doc.setFillColor(...OFFWHITE);
  doc.roundedRect(M, y - 4, PW - M * 2, 26, 2, 2, "F");

  fieldRow("Homeowner Satisfaction", data.homeownerSatisfaction, col1, y, 80);
  fieldRow("Warranty Terms", data.warrantyOffered, col2, y, 80);

  y += 9;
  if (data.returnInspectionDate) {
    fieldRow("Follow-Up Inspection Scheduled", new Date(data.returnInspectionDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), col1, y, 80);
  }
  y += 9;

  if (data.reservationNotes) {
    hRule(y);
    y += 7;
    setFont("bold", 9, [180, 80, 0]);
    doc.text("HOMEOWNER RESERVATION NOTES", M, y);
    y += 5;
    setFont("normal", 8.5, DARK);
    const resLines = doc.splitTextToSize(data.reservationNotes, PW - M * 2);
    doc.text(resLines, M, y);
    y += resLines.length * 4.5 + 4;
  }

  // ── Property condition ────────────────────────────────────────────────────
  if (data.propertyCondition) {
    hRule(y);
    y += 7;
    setFont("bold", 10, BLUE as unknown as [number, number, number]);
    doc.text("PROPERTY CONDITION AT HANDOVER", M, y);
    y += 5;
    setFont("normal", 8.5, DARK);
    const condLines = doc.splitTextToSize(data.propertyCondition, PW - M * 2);
    doc.text(condLines, M, y);
    y += condLines.length * 4.5 + 4;
  }

  // ── Homeowner signature ───────────────────────────────────────────────────
  // Add new page if close to bottom
  if (y > 220) {
    doc.addPage();
    y = 20;
  }

  hRule(y, BLUE as unknown as [number, number, number], 0.6);
  y += 8;

  setFont("bold", 10, DARK);
  doc.text("SIGNATURES", M, y);
  y += 7;

  // Homeowner sig block
  doc.setFillColor(...OFFWHITE);
  doc.roundedRect(M, y - 4, 85, 38, 2, 2, "F");

  setFont("bold", 7.5, GRAY);
  doc.text("HOMEOWNER / AUTHORIZED REPRESENTATIVE", M + 3, y + 1);
  setFont("normal", 9, DARK);
  doc.text(data.signerName, M + 3, y + 7);

  if (data.homeownerSigUrl && data.homeownerSigUrl.startsWith("data:image")) {
    doc.addImage(data.homeownerSigUrl, "PNG", M + 3, y + 9, 75, 18);
  }

  setFont("normal", 7.5, GRAY);
  doc.text(`Signed: ${new Date(data.signedAt).toLocaleString()}`, M + 3, y + 30);

  // Tech sig block (if present)
  if (data.techSigUrl || data.techName) {
    doc.setFillColor(...OFFWHITE);
    doc.roundedRect(PW / 2 + 4, y - 4, 85, 38, 2, 2, "F");

    setFont("bold", 7.5, GRAY);
    doc.text("TITAN TECHNICIAN", PW / 2 + 7, y + 1);
    setFont("normal", 9, DARK);
    doc.text(data.techName || "Technician", PW / 2 + 7, y + 7);

    if (data.techSigUrl && data.techSigUrl.startsWith("data:image")) {
      doc.addImage(data.techSigUrl, "PNG", PW / 2 + 7, y + 9, 75, 18);
    }
  }

  y += 42;

  // ── Footer ───────────────────────────────────────────────────────────────
  hRule(y);
  y += 5;
  setFont("normal", 7, GRAY);
  doc.text(`Document ID: ${data.documentId}  ·  Generated: ${new Date(data.signedAt).toLocaleString()}`, M, y);
  doc.text("Titan Restoration LLC  ·  Augusta, GA  ·  706-922-0154  ·  titanrestorationllc.com", PW - M, y, { align: "right" });

  return doc.output("datauristring");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
interface CertificateOfCompletionProps {
  job: Job;
  contact?: Contact;
  jobId: number;
  onClose: () => void;
}

export function CertificateOfCompletion({
  job,
  contact,
  jobId,
  onClose,
}: CertificateOfCompletionProps) {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [homeownerSig, setHomeownerSig] = useState("");
  const [techSig, setTechSig] = useState("");

  const [form, setForm] = useState({
    signerName: contact?.name || "",
    techName: job.assignedTech || "",
    completionDate: today,
    workScope: "",
    finalReadings: "",
    homeownerSatisfaction: "Fully Satisfied",
    reservationNotes: "",
    propertyCondition: "",
    warrantyOffered: "1 Year Workmanship Warranty",
    returnInspectionDate: "",
  });

  const set = (k: keyof typeof form, v: string) =>
    setForm(f => ({ ...f, [k]: v }));

  const showReservationNotes = form.homeownerSatisfaction !== "Fully Satisfied";

  const createMutation = useMutation({
    mutationFn: async () => {
      const signedAt = new Date().toISOString();
      const documentId = `CERT-${job.jobNumber}-${Date.now()}`;

      let pdfDataUri: string | undefined;
      try {
        pdfDataUri = await generateCertPDF({
          jobNumber: job.jobNumber,
          address: job.address || "",
          completionDate: form.completionDate,
          workScope: form.workScope,
          finalReadings: form.finalReadings,
          homeownerSatisfaction: form.homeownerSatisfaction,
          reservationNotes: form.reservationNotes,
          propertyCondition: form.propertyCondition,
          warrantyOffered: form.warrantyOffered,
          returnInspectionDate: form.returnInspectionDate,
          signerName: form.signerName,
          homeownerSigUrl: homeownerSig,
          techSigUrl: techSig || undefined,
          techName: form.techName || undefined,
          signedAt,
          documentId,
        });
      } catch (err) {
        console.error("CertPDF generation failed", err);
      }

      // Save the document
      await apiRequest("POST", `/api/jobs/${jobId}/documents`, {
        docType: "certificate_of_completion",
        title: `Certificate of Completion — ${job.jobNumber}`,
        formData: JSON.stringify(form),
        signatureData: homeownerSig,
        signerName: form.signerName,
        signerRole: "homeowner",
        signedAt,
        status: "signed",
        createdBy: "Titan Pro",
        fileData: pdfDataUri,
        fileName: `Certificate_of_Completion_${job.jobNumber}.pdf`,
        fileMimeType: "application/pdf",
      });

      // Auto-schedule 3 follow-up emails
      try {
        await apiRequest("POST", `/api/jobs/${jobId}/schedule-follow-ups`, {
          triggerEvent: "certificate_signed",
          signerName: form.signerName,
          completionDate: form.completionDate,
        });
      } catch (err) {
        console.warn("Follow-up scheduling failed (non-critical)", err);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/jobs", String(jobId), "documents"],
      });
      toast({ title: "✅ Certificate signed, PDF generated & follow-ups scheduled" });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: "Error saving certificate",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const displayDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const canSave = !!homeownerSig && !!form.signerName && !!form.workScope;

  return (
    <Card className="border-[hsl(var(--titan-red)/0.4)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Award className="w-4 h-4 text-[hsl(var(--titan-red))]" />
          Certificate of Completion
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Document header preview */}
        <div className="border rounded-lg p-4 bg-muted/20 space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-base text-[hsl(var(--titan-red))]">
                TITAN RESTORATION LLC
              </p>
              <p className="text-muted-foreground">
                Augusta, GA · 706-922-0154 · titanrestorationllc.com
              </p>
            </div>
            <p className="text-muted-foreground">Date: {displayDate}</p>
          </div>
          <p className="font-semibold text-sm mt-2 pt-2 border-t uppercase tracking-wide text-[hsl(var(--titan-blue))]">
            Certificate of Completion
          </p>
          <p className="text-muted-foreground">
            Job #{job.jobNumber} · {job.address}
          </p>
        </div>

        {/* Fields */}
        <div className="grid grid-cols-2 gap-3">
          {/* Signer Name */}
          <div>
            <Label className="text-xs">Homeowner / Authorized Name *</Label>
            <Input
              className="mt-1 h-8 text-sm"
              value={form.signerName}
              onChange={e => set("signerName", e.target.value)}
              placeholder="Full legal name"
              data-testid="cert-input-signer-name"
            />
          </div>
          {/* Completion Date */}
          <div>
            <Label className="text-xs">Completion Date *</Label>
            <Input
              type="date"
              className="mt-1 h-8 text-xs"
              value={form.completionDate}
              onChange={e => set("completionDate", e.target.value)}
              data-testid="cert-input-completion-date"
            />
          </div>

          {/* Work Scope */}
          <div className="col-span-2">
            <Label className="text-xs">Work Completed (Scope) *</Label>
            <Textarea
              className="mt-1 text-sm min-h-[80px]"
              value={form.workScope}
              onChange={e => set("workScope", e.target.value)}
              placeholder="Describe all work performed: areas affected, materials removed/replaced, equipment deployed…"
              data-testid="cert-input-work-scope"
            />
          </div>

          {/* Final Readings */}
          <div className="col-span-2">
            <Label className="text-xs">Final Moisture Readings / Clearance Values</Label>
            <Textarea
              className="mt-1 text-sm min-h-[60px]"
              value={form.finalReadings}
              onChange={e => set("finalReadings", e.target.value)}
              placeholder="e.g. All drywall ≤1% WME, wood framing ≤16% WME, concrete ≤4% WME. GPP at 48 grains/lb. Cleared per IICRC S500."
              data-testid="cert-input-final-readings"
            />
          </div>

          {/* Satisfaction */}
          <div>
            <Label className="text-xs">Homeowner Satisfaction</Label>
            <Select
              value={form.homeownerSatisfaction}
              onValueChange={v => set("homeownerSatisfaction", v)}
            >
              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="cert-select-satisfaction">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Fully Satisfied", "Satisfied with Reservations", "Neutral", "Unsatisfied"].map(
                  s => <SelectItem key={s} value={s}>{s}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Warranty */}
          <div>
            <Label className="text-xs">Warranty Offered</Label>
            <Select
              value={form.warrantyOffered}
              onValueChange={v => set("warrantyOffered", v)}
            >
              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="cert-select-warranty">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  "90 Day Workmanship Warranty",
                  "1 Year Workmanship Warranty",
                  "No Warranty",
                  "Per Estimate Terms",
                ].map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Reservation notes (conditional) */}
          {showReservationNotes && (
            <div className="col-span-2">
              <Label className="text-xs text-amber-600">
                Reservation Notes (required when satisfaction is not Fully Satisfied)
              </Label>
              <Textarea
                className="mt-1 text-sm min-h-[60px] border-amber-300"
                value={form.reservationNotes}
                onChange={e => set("reservationNotes", e.target.value)}
                placeholder="Describe homeowner's concerns or reservations…"
                data-testid="cert-input-reservation-notes"
              />
            </div>
          )}

          {/* Property condition */}
          <div className="col-span-2">
            <Label className="text-xs">Property Condition at Handover</Label>
            <Textarea
              className="mt-1 text-sm min-h-[60px]"
              value={form.propertyCondition}
              onChange={e => set("propertyCondition", e.target.value)}
              placeholder="e.g. Property cleaned, debris removed, temporary barriers taken down. No outstanding hazards observed."
              data-testid="cert-input-property-condition"
            />
          </div>

          {/* Return inspection date */}
          <div>
            <Label className="text-xs">Return Inspection Date (optional)</Label>
            <Input
              type="date"
              className="mt-1 h-8 text-xs"
              value={form.returnInspectionDate}
              onChange={e => set("returnInspectionDate", e.target.value)}
              data-testid="cert-input-return-inspection"
            />
          </div>

          {/* Tech name */}
          <div>
            <Label className="text-xs">Lead Technician</Label>
            <Input
              className="mt-1 h-8 text-sm"
              value={form.techName}
              onChange={e => set("techName", e.target.value)}
              placeholder="Tech name"
              data-testid="cert-input-tech-name"
            />
          </div>
        </div>

        {/* Warranty statement */}
        <div className="border rounded-lg p-3 bg-muted/20 text-xs text-muted-foreground space-y-2">
          <p className="font-semibold text-foreground flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-[hsl(var(--titan-blue))]" />
            Warranty & Completion Statement
          </p>
          <p>
            I, the undersigned homeowner or authorized representative, acknowledge that{" "}
            <strong>Titan Restoration LLC</strong> has completed all contracted restoration
            services at the above-referenced property in accordance with industry standards
            (IICRC S500/S520 as applicable). All work has been performed in a professional
            and workmanlike manner.
          </p>
          <p>
            The warranty stated above covers defects in workmanship only and does not cover
            pre-existing conditions, owner-caused damage, or acts of nature. Warranty claims
            must be reported in writing within the warranty period.
          </p>
        </div>

        {/* Homeowner Signature */}
        <div data-testid="cert-homeowner-sig-section">
          <SignaturePad
            label="Homeowner / Authorized Representative Signature *"
            onSign={setHomeownerSig}
            onClear={() => setHomeownerSig("")}
            testId="cert-sig-homeowner"
          />
          {homeownerSig && (
            <div className="mt-2 flex items-center gap-2 text-xs text-green-600">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Homeowner signature captured · {new Date().toLocaleString()}
            </div>
          )}
        </div>

        {/* Tech Signature (optional) */}
        <div data-testid="cert-tech-sig-section">
          <SignaturePad
            label="Technician Signature (optional)"
            onSign={setTechSig}
            onClear={() => setTechSig("")}
            testId="cert-sig-tech"
          />
          {techSig && (
            <div className="mt-2 flex items-center gap-2 text-xs text-green-600">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Technician signature captured
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            className="flex-1 bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)] text-white"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !canSave}
            data-testid="cert-button-sign-save"
          >
            <Award className="w-4 h-4 mr-2" />
            {createMutation.isPending ? "Saving…" : "Sign & Save Certificate"}
          </Button>
          <Button variant="outline" onClick={onClose} data-testid="cert-button-cancel">
            Cancel
          </Button>
        </div>

        {!homeownerSig && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Homeowner signature required before saving
          </p>
        )}
        {!form.signerName && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Signer name required
          </p>
        )}
        {!form.workScope && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Work scope description required
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CertOfCompletionCard — compact card for document library
// ─────────────────────────────────────────────────────────────────────────────
interface CertOfCompletionCardProps {
  doc: JobDocument;
  onDownload?: () => void;
}

export function CertOfCompletionCard({ doc, onDownload }: CertOfCompletionCardProps) {
  const formData = (() => {
    try {
      return doc.formData ? JSON.parse(doc.formData) : {};
    } catch {
      return {};
    }
  })();

  const handleDownload = () => {
    if (doc.fileData) {
      const link = document.createElement("a");
      link.href = doc.fileData;
      link.download = doc.fileName || `Certificate_of_Completion.pdf`;
      link.click();
    }
    onDownload?.();
  };

  const satisfactionColor: Record<string, string> = {
    "Fully Satisfied": "bg-green-100 text-green-800",
    "Satisfied with Reservations": "bg-yellow-100 text-yellow-800",
    "Neutral": "bg-gray-100 text-gray-700",
    "Unsatisfied": "bg-red-100 text-red-800",
  };

  return (
    <div className="border rounded-lg p-3 bg-card flex items-start gap-3 hover:shadow-sm transition-shadow">
      <div className="w-8 h-8 rounded-full bg-[hsl(var(--titan-red)/0.1)] flex items-center justify-center flex-shrink-0">
        <Award className="w-4 h-4 text-[hsl(var(--titan-red))]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{doc.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Signed by {doc.signerName || "—"} ·{" "}
          {doc.signedAt
            ? new Date(doc.signedAt).toLocaleDateString()
            : "—"}
        </p>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          <Badge className="text-[10px] h-4 px-1.5 bg-green-100 text-green-800">
            <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
            Signed
          </Badge>
          {formData.homeownerSatisfaction && (
            <Badge
              className={`text-[10px] h-4 px-1.5 ${
                satisfactionColor[formData.homeownerSatisfaction] ||
                "bg-gray-100 text-gray-700"
              }`}
            >
              <Star className="w-2.5 h-2.5 mr-0.5" />
              {formData.homeownerSatisfaction}
            </Badge>
          )}
          {formData.warrantyOffered && (
            <Badge className="text-[10px] h-4 px-1.5 bg-blue-100 text-blue-800">
              <ShieldCheck className="w-2.5 h-2.5 mr-0.5" />
              {formData.warrantyOffered}
            </Badge>
          )}
        </div>
      </div>
      {doc.fileData && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs flex-shrink-0"
          onClick={handleDownload}
          data-testid="cert-card-download"
        >
          <FileText className="w-3 h-3 mr-1" />
          PDF
        </Button>
      )}
    </div>
  );
}
