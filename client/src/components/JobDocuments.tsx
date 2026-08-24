/**
 * JobDocuments.tsx
 * Per-job document center:
 *  1. Work Authorization Form  — e-sign with canvas signature pad
 *  2. Deviation of Standard Form — e-sign deviation from IICRC S500/S520 scope
 *  3. PDF Upload — attach any document to the job file
 *  4. Document Library — view/download/delete all docs for this job
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRef, useState, useEffect, useCallback } from "react";
import {
  FileText, Upload, Pen, CheckCircle2, Trash2, Download,
  ChevronDown, ChevronUp, X, Eye, FileUp, AlertTriangle,
  ClipboardCheck, FilePen, Award, Printer, Package, CheckSquare, Square, Loader2, ShieldCheck, Send
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
// pdfEngine (which bundles jsPDF, ~600KB) is loaded on demand via dynamic
// import() so it is fetched only when a user actually generates, downloads,
// or previews a PDF — not on every JobDetail page load.
const loadPdfEngine = () => import("@/lib/pdfEngine");
// documentPacket bundles pdf-lib for merging job files into a single printable
// packet — loaded on demand so it never slows the initial page render.
const loadDocumentPacket = () => import("@/lib/documentPacket");
import { CertificateOfCompletion } from "@/components/CertificateOfCompletion";
import { SendForSignature } from "@/components/SendForSignature";
import type { JobDocument, Job, Contact } from "@shared/schema";
import { fmtDateShort, todayLocalISO } from "@/lib/dates";

// ─────────────────────────────────────────────────────────────────────────────
// Signature Pad
// ─────────────────────────────────────────────────────────────────────────────
function SignaturePad({ onSign, onClear }: { onSign: (dataUrl: string) => void; onClear: () => void }) {
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
    // Thicker stroke + solid black on a solid-white canvas so the signature
    // is always visible — regardless of dark mode. The canvas is explicitly
    // filled white in the mount effect below.
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#000000";
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
    // Repaint white so the signature area doesn't flash back to transparent
    // (which reveals the dark background in dark mode).
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasSig(false);
    onClear();
  }, [onClear]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Prime the canvas with a solid white fill so the black signature is always
    // visible even when the container is in dark mode. Otherwise the canvas is
    // transparent and inherits the dark bg — people were drawing black on
    // black and thinking the pad was broken.
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
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
      <div className="border-2 border-dashed border-muted-foreground/30 rounded-lg bg-white overflow-hidden cursor-crosshair">
        <canvas
          ref={canvasRef}
          width={600}
          height={150}
          className="w-full touch-none"
          style={{ height: "150px" }}
          data-testid="signature-canvas"
        />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Draw your signature above using mouse or touch</p>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={clear}>
          <X className="w-3 h-3 mr-1" />Clear
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Work Authorization Form
// ─────────────────────────────────────────────────────────────────────────────
function WorkAuthorizationForm({
  job, contact, jobId, onClose, phase
}: { job: Job; contact?: Contact; jobId: number; onClose: () => void; phase?: string }) {
  const { toast } = useToast();
  const [sigData, setSigData] = useState<string>("");
  const [form, setForm] = useState({
    signerName: contact?.name || "",
    signerRole: "homeowner",
    relationship: "Property Owner",
    propertyAddress: job.address || "",
    authorizationScope: "mitigation",
    startDate: todayLocalISO(),
    specialInstructions: "",
    insuranceCarrier: job.insuranceCarrier || "",
    claimNumber: job.claimNumber || "",
    policyNumber: job.policyNumber || "",
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const signedAt = new Date().toISOString();
      // Generate branded PDF immediately at sign time
      let pdfDataUri: string | undefined;
      try {
        const { generateWorkAuthPDF } = await loadPdfEngine();
        pdfDataUri = generateWorkAuthPDF({
          jobNumber: job.jobNumber,
          signerName: form.signerName,
          relationship: form.relationship,
          propertyAddress: form.propertyAddress,
          authorizationScope: form.authorizationScope,
          startDate: form.startDate,
          insuranceCarrier: form.insuranceCarrier,
          claimNumber: form.claimNumber,
          policyNumber: form.policyNumber,
          specialInstructions: form.specialInstructions,
          signatureDataUrl: sigData,
          signedAt,
          lossType: job.lossType,
          assignedTech: job.assignedTech || undefined,
        });
      } catch (e) {
        console.error("PDF generation failed", e);
      }
      return apiRequest("POST", `/api/jobs/${jobId}/documents`, {
        docType: "work_authorization",
        title: `Work Authorization — ${job.jobNumber}`,
        formData: JSON.stringify(form),
        signatureData: sigData,
        signerName: form.signerName,
        signerRole: form.signerRole,
        signedAt,
        status: sigData ? "signed" : "unsigned",
        createdBy: "Titan Pro",
        phase: phase && phase !== "both" ? phase : "mitigation",
        // Store the generated PDF so it can be downloaded later
        fileData: pdfDataUri,
        fileName: `Work_Authorization_${job.jobNumber}.pdf`,
        fileMimeType: "application/pdf",
      });
    },
    onSuccess: async (_savedDoc: any, _vars, _ctx) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "documents"] });

      // Signed work auth = the job is sold. Advance the pipeline to
      // pre-production automatically so the operator doesn't have to
      // manually drag it. Only nudge forward from the pre-sale stages;
      // never regress a job that's already in WIP/invoicing/AR/complete.
      //
      // Also stamp salesDate (today, if missing) and preProductionDate
      // (today, if missing) so the pipeline age counters start counting
      // from the moment the customer signed rather than from job
      // creation.
      // Advance from ANY earlier stage (pending_sale, blank, or any legacy /
      // never-set value like 'new' or 'lead'). Only *later* stages are
      // considered locked in.
      const wasSigned = !!sigData;
      const lockedStages = new Set([
        "wip", "invoice_pending", "accounts_receivable", "complete",
      ]);
      const shouldAdvance =
        wasSigned && !lockedStages.has((job.progressStage || "").toString());

      if (shouldAdvance) {
        // salesDate and preProductionDate are 'YYYY-MM-DD' date-only fields,
        // not timestamps — use the local-timezone helper so a late-night sign
        // doesn't stamp tomorrow's UTC date.
        const todayISO = todayLocalISO();
        const patch: Record<string, any> = {
          progressStage: "pre_production",
          preProductionDate: (job as any).preProductionDate || todayISO,
          salesDate: (job as any).salesDate || todayISO,
        };
        try {
          await apiRequest("PATCH", `/api/jobs/${jobId}`, patch);
          // Refresh anything that reads job state or pipeline buckets.
          queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
          queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId)] });
          queryClient.invalidateQueries({ queryKey: ["/api/jobs/pipeline"] });
          toast({ title: "✅ Work Auth signed — job moved to Pre-Production" });
        } catch (err: any) {
          // Don't block the save flow — the doc is already stored. Surface
          // the stage-advance failure separately so the operator knows to
          // move it manually.
          console.warn("[work-auth] failed to auto-advance stage:", err?.message || err);
          toast({
            title: "Work Auth saved, but stage didn't update",
            description: "Move the job to Pre-Production from the pipeline manually.",
            variant: "destructive",
          });
        }
      } else {
        toast({ title: "✅ Work Authorization signed & PDF generated" });
      }

      onClose();
    },
  });

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <Card className="border-[hsl(var(--titan-blue)/0.4)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
          Work Authorization Form
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Form preview header */}
        <div className="border rounded-lg p-4 bg-muted/20 space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-base text-[hsl(var(--titan-red))]">TITAN RESTORATION LLC</p>
              <p className="text-muted-foreground">Augusta, GA · 706-922-0154 · titanaugusta.pro</p>
            </div>
            <p className="text-muted-foreground">Date: {today}</p>
          </div>
          <p className="font-semibold text-sm mt-2 pt-2 border-t">AUTHORIZATION TO PERFORM RESTORATION SERVICES</p>
        </div>

        {/* Send to customer for remote signature (email link with sign page). */}
        <SendForSignature
          jobId={jobId}
          docType="work_authorization"
          title={`Work Authorization — ${job.jobNumber}`}
          getFormData={() => form}
          defaultEmail={contact?.email || (job as any).customerEmail || ""}
          defaultName={form.signerName}
          defaultRole="homeowner"
        />

        {/* Fields */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Property Owner / Insured Name</Label>
            <Input className="mt-1 h-8 text-sm" value={form.signerName}
              onChange={e => setForm(f => ({ ...f, signerName: e.target.value }))}
              placeholder="Full legal name" data-testid="input-signer-name" />
          </div>
          <div>
            <Label className="text-xs">Relationship to Property</Label>
            <Select value={form.relationship} onValueChange={v => setForm(f => ({ ...f, relationship: v }))}>
              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Property Owner", "Tenant", "Power of Attorney", "Property Manager", "Other"].map(r => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Property Address</Label>
            <Input className="mt-1 h-8 text-sm" value={form.propertyAddress}
              onChange={e => setForm(f => ({ ...f, propertyAddress: e.target.value }))}
              data-testid="input-property-address" />
          </div>
          <div>
            <Label className="text-xs">Scope of Authorization</Label>
            <Select value={form.authorizationScope} onValueChange={v => setForm(f => ({ ...f, authorizationScope: v }))}>
              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mitigation">Emergency Mitigation Only</SelectItem>
                <SelectItem value="mitigation_reconstruction">Mitigation & Reconstruction</SelectItem>
                <SelectItem value="full">Full Scope of Restoration</SelectItem>
                <SelectItem value="assessment">Assessment / Inspection Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Authorization Date</Label>
            <Input type="date" className="mt-1 h-8 text-xs" value={form.startDate}
              onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Insurance Carrier</Label>
            <Input className="mt-1 h-8 text-sm" value={form.insuranceCarrier}
              onChange={e => setForm(f => ({ ...f, insuranceCarrier: e.target.value }))}
              placeholder="e.g. State Farm" />
          </div>
          <div>
            <Label className="text-xs">Claim Number</Label>
            <Input className="mt-1 h-8 text-sm" value={form.claimNumber}
              onChange={e => setForm(f => ({ ...f, claimNumber: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Special Instructions / Access Notes</Label>
            <Textarea className="mt-1 text-sm min-h-[60px]" value={form.specialInstructions}
              onChange={e => setForm(f => ({ ...f, specialInstructions: e.target.value }))}
              placeholder="e.g. Gate code 1234, pets in yard, key under mat…" />
          </div>
        </div>

        {/* Legal text — must mirror the PDF terms exactly */}
        <div className="border rounded-lg p-3 bg-muted/20 text-[11px] leading-snug text-muted-foreground space-y-2 max-h-[220px] overflow-y-auto">
          <p className="font-semibold text-foreground text-xs">Authorization to Perform Restoration Services — Terms & Conditions</p>
          <p>I, the undersigned Property Owner / Authorized Representative (“Owner”), authorize <strong>Titan Restoration LLC</strong> (“Contractor”) to enter the property and perform the mitigation, remediation, and/or restoration services described in the Scope of Authorization above. Owner represents that Owner has legal authority to authorize this work.</p>
          <p><strong>1. Scope & IICRC standards.</strong> Contractor will perform work using generally accepted industry practices and applicable IICRC standards (S500 water, S520 mold, S700 fire, S760 trauma). Additional or changed work will be documented in a written change order.</p>
          <p><strong>2. Pricing.</strong> Work is priced using Contractor's published pricing schedule. This pricing may differ from insurance software defaults (e.g., Xactimate). Owner acknowledges receiving Contractor's Custom Pricing Acknowledgment, which is incorporated by reference.</p>
          <p><strong>3. Primary payment obligation.</strong> Owner is the primary party responsible for full payment of all services rendered, regardless of insurance coverage. Owner shall pay any deductible, non-covered items, depreciation holdback withheld until completion, betterment/upgrades, and any shortfall between Contractor's invoice and insurance proceeds. Payment is due within 30 days of invoice.</p>
          <p><strong>4. Direction to pay / insurance proceeds.</strong> Owner directs their insurance carrier and any mortgagee to include Titan Restoration LLC as a co-payee on all loss-payment drafts for this claim and to send Titan's portion of proceeds directly to Titan. Owner authorizes Contractor to speak with the carrier about scope, pricing, and payment status. This is a direction to pay only; it is not a public-adjuster engagement.</p>
          <p><strong>5. Endorsement & proof of loss.</strong> Owner shall promptly endorse insurance drafts naming Contractor as a payee, cooperate in a sworn proof of loss when required, and forward Titan's portion within 5 business days of receipt.</p>
          <p><strong>6. Late payment, interest & collections.</strong> Undisputed balances not paid within 30 days accrue interest at 1% per month or the maximum rate allowed by law. Owner shall pay Contractor's reasonable collection costs, court costs, and attorneys' fees to collect any undisputed balance.</p>
          <p><strong>7. Lien rights.</strong> Contractor may file and enforce a mechanic's/materialman's lien against the property under S.C. Code Title 29, Ch. 5 (SC) or O.C.G.A. Title 44, Ch. 14, Art. 8 (GA) for unpaid work.</p>
          <p><strong>8. Prompt pay (carrier).</strong> Owner acknowledges that carriers must acknowledge and pay undisputed claims within statutory time limits: S.C. Code § 38-59-20 and O.C.G.A. §§ 13-11-1 to 13-11-11.</p>
          <p><strong>9. Access, power & utilities.</strong> Owner will provide safe access, continuous electrical power for drying/remediation equipment, and reasonable use of water. Owner will not disable, unplug, or move Contractor's equipment; if equipment is disabled or removed without written approval, resulting damage or delay is Owner's responsibility.</p>
          <p><strong>10. Governing law, venue & cancellation.</strong> This Authorization is governed by the laws of {job.address?.includes(", GA") ? "Georgia" : job.address?.includes(", SC") ? "South Carolina" : "Georgia"}. <strong>SC homeowners</strong> have the right to cancel this contract within 3 business days after signing if signed at a location other than Contractor's regular place of business. <strong>GA homeowners</strong> may cancel within 5 business days of receiving a written denial of coverage from the carrier (HB 423). Cancellation must be in writing and delivered to Contractor at cody@titanaugusta.com. Owner remains responsible for the reasonable value of work already performed and materials already ordered.</p>
        </div>

        {/* Signature pad */}
        <div>
          <Label className="text-xs font-semibold">Electronic Signature — {form.signerName || "Homeowner / Insured"}</Label>
          <div className="mt-2">
            <SignaturePad onSign={setSigData} onClear={() => setSigData("")} />
          </div>
          {sigData && (
            <div className="mt-2 flex items-center gap-2 text-xs text-green-600">
              <CheckCircle2 className="w-3.5 h-3.5" />Signature captured · {new Date().toLocaleString()}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            className="flex-1 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !form.signerName || !sigData}
            data-testid="button-save-work-auth"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            {createMutation.isPending ? "Saving…" : "Sign & Save Authorization"}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
        {!sigData && <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Signature required before saving</p>}
      </CardContent>
    </Card>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Direction to Pay Notice Form (carrier notice, homeowner-signed)
// ─────────────────────────────────────────────────────────────────────────────
function DirectionToPayForm({
  job, contact, jobId, onClose, phase
}: { job: Job; contact?: Contact; jobId: number; onClose: () => void; phase?: string }) {
  const { toast } = useToast();
  const [sigData, setSigData] = useState<string>("");
  const [form, setForm] = useState({
    signerName: contact?.name || "",
    signerRole: "homeowner",
    relationship: "Property Owner / Named Insured",
    propertyAddress: job.address || "",
    dateOfLoss: (job as any).dateOfLoss || "",
    lossType: job.lossType || "",
    insuranceCarrier: job.insuranceCarrier || "",
    claimNumber: job.claimNumber || "",
    policyNumber: job.policyNumber || "",
    adjusterName: (job as any).adjusterName || "",
    adjusterEmail: (job as any).adjusterEmail || "",
    adjusterPhone: (job as any).adjusterPhone || "",
    mortgageeName: (job as any).mortgageeName || "",
    mortgageeLoanNumber: (job as any).mortgageeLoanNumber || "",
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const signedAt = new Date().toISOString();
      let pdfDataUri: string | undefined;
      try {
        const { generateDirectionToPayPDF } = await loadPdfEngine();
        pdfDataUri = generateDirectionToPayPDF({
          jobNumber: job.jobNumber,
          signerName: form.signerName,
          relationship: form.relationship,
          propertyAddress: form.propertyAddress,
          dateOfLoss: form.dateOfLoss,
          lossType: form.lossType,
          insuranceCarrier: form.insuranceCarrier,
          claimNumber: form.claimNumber,
          policyNumber: form.policyNumber,
          adjusterName: form.adjusterName,
          adjusterEmail: form.adjusterEmail,
          adjusterPhone: form.adjusterPhone,
          mortgageeName: form.mortgageeName,
          mortgageeLoanNumber: form.mortgageeLoanNumber,
          signatureDataUrl: sigData,
          signedAt,
        });
      } catch (e) {
        console.error("PDF generation failed", e);
      }
      return apiRequest("POST", `/api/jobs/${jobId}/documents`, {
        docType: "direction_to_pay_notice",
        title: `Direction to Pay Notice — ${job.jobNumber}`,
        formData: JSON.stringify(form),
        signatureData: sigData,
        signerName: form.signerName,
        signerRole: form.signerRole,
        signedAt,
        status: sigData ? "signed" : "unsigned",
        createdBy: "Titan Pro",
        phase: phase && phase !== "both" ? phase : "mitigation",
        fileData: pdfDataUri,
        fileName: `Direction_to_Pay_${job.jobNumber}.pdf`,
        fileMimeType: "application/pdf",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "documents"] });
      toast({ title: "✅ Direction to Pay signed & PDF generated" });
      onClose();
    },
  });

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <Card className="border-[hsl(var(--titan-blue)/0.4)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
          Direction to Pay Notice
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Form preview header */}
        <div className="border rounded-lg p-4 bg-muted/20 space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-base text-[hsl(var(--titan-red))]">TITAN RESTORATION LLC</p>
              <p className="text-muted-foreground">Augusta, GA · 706-922-0154 · titanaugusta.pro</p>
            </div>
            <p className="text-muted-foreground">Date: {today}</p>
          </div>
          <p className="font-semibold text-sm mt-2 pt-2 border-t">DIRECTION TO PAY — NOTICE TO INSURANCE CARRIER</p>
        </div>

        {/* Send to customer for remote signature. */}
        <SendForSignature
          jobId={jobId}
          docType="direction_to_pay_notice"
          title={`Direction to Pay — ${job.jobNumber}`}
          getFormData={() => form}
          defaultEmail={contact?.email || (job as any).customerEmail || ""}
          defaultName={form.signerName}
          defaultRole="insured"
        />

        {/* Insured / property */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Named Insured</Label>
            <Input className="mt-1 h-8 text-sm" value={form.signerName}
              onChange={e => setForm(f => ({ ...f, signerName: e.target.value }))}
              placeholder="Full legal name" data-testid="input-dtp-signer-name" />
          </div>
          <div>
            <Label className="text-xs">Relationship</Label>
            <Select value={form.relationship} onValueChange={v => setForm(f => ({ ...f, relationship: v }))}>
              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Property Owner / Named Insured", "Named Insured (co-owner)", "Power of Attorney", "Property Manager", "Other"].map(r => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Property Address</Label>
            <Input className="mt-1 h-8 text-sm" value={form.propertyAddress}
              onChange={e => setForm(f => ({ ...f, propertyAddress: e.target.value }))}
              data-testid="input-dtp-address" />
          </div>
          <div>
            <Label className="text-xs">Date of Loss</Label>
            <Input type="date" className="mt-1 h-8 text-xs" value={form.dateOfLoss}
              onChange={e => setForm(f => ({ ...f, dateOfLoss: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Loss Type</Label>
            <Input className="mt-1 h-8 text-sm" value={form.lossType}
              onChange={e => setForm(f => ({ ...f, lossType: e.target.value }))}
              placeholder="e.g. water, fire, mold" />
          </div>
        </div>

        {/* Carrier / adjuster */}
        <div className="border rounded-lg p-3 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Insurance Carrier</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Carrier Name *</Label>
              <Input className="mt-1 h-8 text-sm" value={form.insuranceCarrier}
                onChange={e => setForm(f => ({ ...f, insuranceCarrier: e.target.value }))}
                placeholder="e.g. State Farm" data-testid="input-dtp-carrier" />
            </div>
            <div>
              <Label className="text-xs">Claim Number *</Label>
              <Input className="mt-1 h-8 text-sm" value={form.claimNumber}
                onChange={e => setForm(f => ({ ...f, claimNumber: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Policy Number</Label>
              <Input className="mt-1 h-8 text-sm" value={form.policyNumber}
                onChange={e => setForm(f => ({ ...f, policyNumber: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Adjuster Name</Label>
              <Input className="mt-1 h-8 text-sm" value={form.adjusterName}
                onChange={e => setForm(f => ({ ...f, adjusterName: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Adjuster Email</Label>
              <Input type="email" className="mt-1 h-8 text-sm" value={form.adjusterEmail}
                onChange={e => setForm(f => ({ ...f, adjusterEmail: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Adjuster Phone</Label>
              <Input type="tel" className="mt-1 h-8 text-sm" value={form.adjusterPhone}
                onChange={e => setForm(f => ({ ...f, adjusterPhone: e.target.value }))} />
            </div>
          </div>
        </div>

        {/* Mortgagee (optional) */}
        <div className="border rounded-lg p-3 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mortgagee (optional — appears as co-payee if provided)</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Mortgagee Name</Label>
              <Input className="mt-1 h-8 text-sm" value={form.mortgageeName}
                onChange={e => setForm(f => ({ ...f, mortgageeName: e.target.value }))}
                placeholder="e.g. Wells Fargo Home Mortgage" />
            </div>
            <div>
              <Label className="text-xs">Loan #</Label>
              <Input className="mt-1 h-8 text-sm" value={form.mortgageeLoanNumber}
                onChange={e => setForm(f => ({ ...f, mortgageeLoanNumber: e.target.value }))} />
            </div>
          </div>
        </div>

        {/* Instruction text preview */}
        <div className="border rounded-lg p-3 bg-muted/20 text-[11px] leading-snug text-muted-foreground space-y-2 max-h-[220px] overflow-y-auto">
          <p className="font-semibold text-foreground text-xs">Instructions to Carrier</p>
          <p>As the named Insured, I direct the above carrier and any mortgagee holding my policy proceeds to comply with the following on this claim:</p>
          <p><strong>1. Name Titan as co-payee</strong> on all loss-payment drafts (ACV, RCV / recoverable depreciation, supplements, additional payments), alongside the Insured and any mortgagee.</p>
          <p><strong>2. Send Titan's portion directly</strong> to Titan Restoration LLC (706-922-0154, cody@titanaugusta.com) using the mailing/EFT details Titan provides.</p>
          <p><strong>3. Share scope and estimate information</strong> with Titan at the same time it is shared with the Insured, so pricing and scope can be reconciled before close-out.</p>
          <p><strong>4. Prompt pay.</strong> This is written notice under prompt-payment law: S.C. Code § 38-59-20 (SC — acknowledge within 15 working days, pay undisputed claims within 30 days) and O.C.G.A. §§ 13-11-1 to 13-11-11 (GA Prompt Pay Act — 15 days for undisputed amounts on completed work).</p>
          <p>This is a direction to pay only. It is not an Assignment of Benefits and it does not transfer ownership of the claim; the Insured remains the claimant. Titan Restoration LLC is the general contractor of record and is not acting as a public adjuster.</p>
        </div>

        {/* Signature pad */}
        <div>
          <Label className="text-xs font-semibold">Electronic Signature — {form.signerName || "Named Insured"}</Label>
          <div className="mt-2">
            <SignaturePad onSign={setSigData} onClear={() => setSigData("")} />
          </div>
          {sigData && (
            <div className="mt-2 flex items-center gap-2 text-xs text-green-600">
              <CheckCircle2 className="w-3.5 h-3.5" />Signature captured · {new Date().toLocaleString()}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            className="flex-1 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !form.signerName || !form.insuranceCarrier || !form.claimNumber || !sigData}
            data-testid="button-save-direction-to-pay"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            {createMutation.isPending ? "Saving…" : "Sign & Save Notice"}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
        {!sigData && <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Signature required before saving</p>}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Pricing Acknowledgment Form (homeowner-signed)
// ─────────────────────────────────────────────────────────────────────────────
function CustomPricingForm({
  job, contact, jobId, onClose, phase
}: { job: Job; contact?: Contact; jobId: number; onClose: () => void; phase?: string }) {
  const { toast } = useToast();
  const [sigData, setSigData] = useState<string>("");
  const [form, setForm] = useState({
    signerName: contact?.name || "",
    signerRole: "homeowner",
    relationship: "Property Owner",
    propertyAddress: job.address || "",
    insuranceCarrier: job.insuranceCarrier || "",
    claimNumber: job.claimNumber || "",
    policyNumber: job.policyNumber || "",
    lossType: job.lossType || "",
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const signedAt = new Date().toISOString();
      let pdfDataUri: string | undefined;
      try {
        const { generateCustomPricingPDF } = await loadPdfEngine();
        pdfDataUri = generateCustomPricingPDF({
          jobNumber: job.jobNumber,
          signerName: form.signerName,
          relationship: form.relationship,
          propertyAddress: form.propertyAddress,
          insuranceCarrier: form.insuranceCarrier,
          claimNumber: form.claimNumber,
          policyNumber: form.policyNumber,
          lossType: form.lossType,
          signatureDataUrl: sigData,
          signedAt,
        });
      } catch (e) {
        console.error("PDF generation failed", e);
      }
      return apiRequest("POST", `/api/jobs/${jobId}/documents`, {
        docType: "custom_pricing_acknowledgment",
        title: `Custom Pricing Acknowledgment — ${job.jobNumber}`,
        formData: JSON.stringify(form),
        signatureData: sigData,
        signerName: form.signerName,
        signerRole: form.signerRole,
        signedAt,
        status: sigData ? "signed" : "unsigned",
        createdBy: "Titan Pro",
        phase: phase && phase !== "both" ? phase : "mitigation",
        fileData: pdfDataUri,
        fileName: `Custom_Pricing_Acknowledgment_${job.jobNumber}.pdf`,
        fileMimeType: "application/pdf",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "documents"] });
      toast({ title: "✅ Custom Pricing Acknowledgment signed & PDF generated" });
      onClose();
    },
  });

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <Card className="border-[hsl(var(--titan-blue)/0.4)]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
          Custom Pricing Acknowledgment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Form preview header */}
        <div className="border rounded-lg p-4 bg-muted/20 space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-base text-[hsl(var(--titan-red))]">TITAN RESTORATION LLC</p>
              <p className="text-muted-foreground">Augusta, GA · 706-922-0154 · titanaugusta.pro</p>
            </div>
            <p className="text-muted-foreground">Date: {today}</p>
          </div>
          <p className="font-semibold text-sm mt-2 pt-2 border-t">CUSTOM PRICING ACKNOWLEDGMENT & CARRIER PRICING NOTICE</p>
        </div>

        {/* Send to customer for remote signature. */}
        <SendForSignature
          jobId={jobId}
          docType="custom_pricing_acknowledgment"
          title={`Custom Pricing Acknowledgment — ${job.jobNumber}`}
          getFormData={() => form}
          defaultEmail={contact?.email || (job as any).customerEmail || ""}
          defaultName={form.signerName}
          defaultRole="homeowner"
        />

        {/* Fields */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Property Owner / Insured Name</Label>
            <Input className="mt-1 h-8 text-sm" value={form.signerName}
              onChange={e => setForm(f => ({ ...f, signerName: e.target.value }))}
              placeholder="Full legal name" data-testid="input-cpa-signer-name" />
          </div>
          <div>
            <Label className="text-xs">Relationship to Property</Label>
            <Select value={form.relationship} onValueChange={v => setForm(f => ({ ...f, relationship: v }))}>
              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Property Owner", "Tenant", "Power of Attorney", "Property Manager", "Other"].map(r => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Property Address</Label>
            <Input className="mt-1 h-8 text-sm" value={form.propertyAddress}
              onChange={e => setForm(f => ({ ...f, propertyAddress: e.target.value }))}
              data-testid="input-cpa-address" />
          </div>
          <div>
            <Label className="text-xs">Insurance Carrier</Label>
            <Input className="mt-1 h-8 text-sm" value={form.insuranceCarrier}
              onChange={e => setForm(f => ({ ...f, insuranceCarrier: e.target.value }))}
              placeholder="e.g. State Farm" />
          </div>
          <div>
            <Label className="text-xs">Claim Number</Label>
            <Input className="mt-1 h-8 text-sm" value={form.claimNumber}
              onChange={e => setForm(f => ({ ...f, claimNumber: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Policy Number</Label>
            <Input className="mt-1 h-8 text-sm" value={form.policyNumber}
              onChange={e => setForm(f => ({ ...f, policyNumber: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Loss Type</Label>
            <Input className="mt-1 h-8 text-sm" value={form.lossType}
              onChange={e => setForm(f => ({ ...f, lossType: e.target.value }))}
              placeholder="e.g. water, fire, mold" />
          </div>
        </div>

        {/* Terms preview — matches PDF Part A + Part B */}
        <div className="border rounded-lg p-3 bg-muted/20 text-[11px] leading-snug text-muted-foreground space-y-2 max-h-[260px] overflow-y-auto">
          <p className="font-semibold text-foreground text-xs">Part A — Property Owner Acknowledgment</p>
          <p><strong>A1. Custom pricing schedule.</strong> I understand Titan prices work using its published Custom Pricing Schedule for equipment, labor, materials, and services actually performed. Titan does not price at generic third-party software defaults (including Xactimate baseline rates).</p>
          <p><strong>A2. Difference from insurance estimate.</strong> I understand my carrier's initial estimate may be lower than Titan's invoice. Titan will work in good faith with the carrier to reconcile pricing using scope documentation, drying/moisture records, IICRC standards, and market-rate references.</p>
          <p><strong>A3. Primary payment obligation.</strong> I remain primarily responsible for full payment of Titan's invoice regardless of what the carrier ultimately pays. I will pay any deductible, non-covered items, betterment/upgrades, depreciation holdback withheld until completion, and any shortfall.</p>
          <p><strong>A4. Direction to pay / co-operation.</strong> I have executed (or will execute) Titan's Direction to Pay Notice directing my carrier to name Titan as co-payee on all loss-payment drafts. I will promptly endorse those drafts and forward Titan's portion within 5 business days of receipt.</p>
          <p><strong>A5. No public-adjuster role.</strong> Titan is my general contractor, not my public adjuster. Titan may discuss scope and pricing with the carrier but is not negotiating my coverage or claim on my behalf.</p>

          <p className="font-semibold text-foreground text-xs pt-2 mt-2 border-t">Part B — Notice to Insurance Carrier</p>
          <p><strong>B1. Policy language.</strong> Standard property policies obligate the carrier to pay the reasonable and necessary cost to repair or replace with materials of like kind and quality — they do not require pricing at any specific software default. Please identify the specific policy provision, if any, that mandates Xactimate baseline pricing on this claim.</p>
          <p><strong>B2. Xactimate is a tool, not a ceiling.</strong> Xactimate itself publishes market-conditions modifiers and acknowledges that published unit costs are averages requiring adjustment for local labor, material availability, emergency-response conditions, and demand surges. Titan's pricing reflects these documented conditions.</p>
          <p><strong>B3. IICRC and RSMeans basis.</strong> Titan's scope follows IICRC S500 (water), S520 (mold), and S700 (fire) protocols. Line items are supported by IICRC standards of care, RSMeans construction cost data, and manufacturer specifications — objective references the carrier can independently verify.</p>
          <p><strong>B4. Documentation available.</strong> On request Titan will provide daily drying logs with moisture readings, equipment run-time records, time-stamped job photos, IICRC-referenced scope narrative, and supporting invoices for materials and subcontracted labor.</p>
          <p><strong>B5. Appraisal clause.</strong> If pricing cannot be reconciled through good-faith review, the Insured reserves the right to invoke the appraisal provision of the policy.</p>
          <p><strong>B6. Unfair claims practices.</strong> The Insured reserves all rights under S.C. Code § 38-59-20 and O.C.G.A. § 33-6-34 regarding claim-handling practices, and under S.C. Code § 38-59-20 and O.C.G.A. §§ 13-11-1 to 13-11-11 regarding prompt payment of undisputed amounts.</p>
        </div>

        {/* Signature pad */}
        <div>
          <Label className="text-xs font-semibold">Electronic Signature — {form.signerName || "Homeowner / Insured"}</Label>
          <div className="mt-2">
            <SignaturePad onSign={setSigData} onClear={() => setSigData("")} />
          </div>
          {sigData && (
            <div className="mt-2 flex items-center gap-2 text-xs text-green-600">
              <CheckCircle2 className="w-3.5 h-3.5" />Signature captured · {new Date().toLocaleString()}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            className="flex-1 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !form.signerName || !sigData}
            data-testid="button-save-custom-pricing"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            {createMutation.isPending ? "Saving…" : "Sign & Save Acknowledgment"}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
        {!sigData && <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Signature required before saving</p>}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Right to Renovate Form (EPA "Renovate Right" lead-hazard pamphlet acknowledgment)
// ─────────────────────────────────────────────────────────────────────────────
function RightToRenovateForm({
  job, contact, jobId, onClose, phase
}: { job: Job; contact?: Contact; jobId: number; onClose: () => void; phase?: string }) {
  const { toast } = useToast();
  const [sigData, setSigData] = useState<string>("");
  const [form, setForm] = useState({
    signerName: contact?.name || "",
    relationship: "Property Owner",
    propertyAddress: job.address || "",
    yearBuilt: "",
    leadStatus: "unknown",
    renovationScope: "",
    deliveryMethod: "in_person",
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const signedAt = new Date().toISOString();
      let pdfDataUri: string | undefined;
      try {
        const { generateRightToRenovatePDF } = await loadPdfEngine();
        pdfDataUri = generateRightToRenovatePDF({
          jobNumber: job.jobNumber,
          signerName: form.signerName,
          relationship: form.relationship,
          propertyAddress: form.propertyAddress,
          yearBuilt: form.yearBuilt || undefined,
          leadStatus: form.leadStatus,
          renovationScope: form.renovationScope || undefined,
          deliveryMethod: form.deliveryMethod,
          signatureDataUrl: sigData,
          signedAt,
          assignedTech: job.assignedTech || undefined,
        });
      } catch (e) {
        console.error("PDF generation failed", e);
      }
      return apiRequest("POST", `/api/jobs/${jobId}/documents`, {
        docType: "right_to_renovate",
        title: `Right to Renovate — ${job.jobNumber}`,
        formData: JSON.stringify(form),
        signatureData: sigData,
        signerName: form.signerName,
        signerRole: "homeowner",
        signedAt,
        status: sigData ? "signed" : "unsigned",
        createdBy: "Titan Pro",
        phase: phase && phase !== "both" ? phase : "mitigation",
        fileData: pdfDataUri,
        fileName: `Right_to_Renovate_${job.jobNumber}.pdf`,
        fileMimeType: "application/pdf",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "documents"] });
      toast({ title: "✅ Right to Renovate signed & PDF generated" });
      onClose();
    },
  });

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <Card className="border-emerald-500/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          Right to Renovate — Lead Hazard Acknowledgment
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Form preview header */}
        <div className="border rounded-lg p-4 bg-emerald-50/40 dark:bg-emerald-950/10 space-y-1 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-base text-emerald-700">TITAN RESTORATION LLC</p>
              <p className="text-muted-foreground">EPA Lead-Safe Certified Firm · 706-922-0154</p>
            </div>
            <p className="text-muted-foreground">Date: {today}</p>
          </div>
          <p className="font-semibold text-sm mt-2 pt-2 border-t">RECEIPT OF EPA "RENOVATE RIGHT" LEAD-HAZARD PAMPHLET</p>
        </div>

        {/* Send to customer for remote signature. */}
        <SendForSignature
          jobId={jobId}
          docType="right_to_renovate"
          title={`Right to Renovate — ${job.jobNumber}`}
          getFormData={() => form}
          defaultEmail={contact?.email || (job as any).customerEmail || ""}
          defaultName={form.signerName}
          defaultRole="homeowner"
        />

        {/* Fields */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Property Owner / Occupant Name</Label>
            <Input className="mt-1 h-8 text-sm" value={form.signerName}
              onChange={e => setForm(f => ({ ...f, signerName: e.target.value }))}
              placeholder="Full legal name" data-testid="input-rtr-signer-name" />
          </div>
          <div>
            <Label className="text-xs">Relationship to Property</Label>
            <Select value={form.relationship} onValueChange={v => setForm(f => ({ ...f, relationship: v }))}>
              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Property Owner", "Tenant", "Power of Attorney", "Property Manager", "Other"].map(r => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Property Address</Label>
            <Input className="mt-1 h-8 text-sm" value={form.propertyAddress}
              onChange={e => setForm(f => ({ ...f, propertyAddress: e.target.value }))}
              data-testid="input-rtr-address" />
          </div>
          <div>
            <Label className="text-xs">Year Built</Label>
            <Input className="mt-1 h-8 text-sm" value={form.yearBuilt}
              onChange={e => setForm(f => ({ ...f, yearBuilt: e.target.value }))}
              placeholder="e.g. 1965" data-testid="input-rtr-year" />
          </div>
          <div>
            <Label className="text-xs">Lead-Based Paint Status</Label>
            <Select value={form.leadStatus} onValueChange={v => setForm(f => ({ ...f, leadStatus: v }))}>
              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-rtr-lead"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pre1978">Built before 1978 (assume lead present)</SelectItem>
                <SelectItem value="post1978">Built 1978 or later</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
                <SelectItem value="exempt">Exempt (e.g. no paint disturbed)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Pamphlet Delivered By</Label>
            <Select value={form.deliveryMethod} onValueChange={v => setForm(f => ({ ...f, deliveryMethod: v }))}>
              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="select-rtr-delivery"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="in_person">In Person</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="mail">U.S. Mail</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Renovation Scope (optional)</Label>
            <Input className="mt-1 h-8 text-sm" value={form.renovationScope}
              onChange={e => setForm(f => ({ ...f, renovationScope: e.target.value }))}
              placeholder="e.g. drywall removal, flooring, painting…" data-testid="input-rtr-scope" />
          </div>
        </div>

        {/* Legal text */}
        <div className="border rounded-lg p-3 bg-muted/20 text-xs text-muted-foreground space-y-2">
          <p className="font-semibold text-foreground">Acknowledgment of Receipt — 40 CFR Part 745 (RRP Rule)</p>
          <p>Federal law requires that individuals receive certain information before renovating more than six square feet of painted surfaces in a room for interior projects (or more than twenty square feet of painted surfaces for exterior projects) in housing, child-care facilities, and schools built before 1978.</p>
          <p>I have received a copy of the EPA pamphlet <strong>"Renovate Right: Important Lead Hazard Information for Families, Child Care Providers and Schools"</strong> informing me of the potential risk of lead-hazard exposure from renovation activity to be performed in my dwelling unit. I received this pamphlet before the work began.</p>
          <p>Titan Restoration LLC is an EPA Lead-Safe Certified firm and will use certified renovators and lead-safe work practices as required for pre-1978 properties.</p>
        </div>

        {/* Signature pad */}
        <div>
          <Label className="text-xs font-semibold">Electronic Signature — {form.signerName || "Owner / Occupant"}</Label>
          <div className="mt-2">
            <SignaturePad onSign={setSigData} onClear={() => setSigData("")} />
          </div>
          {sigData && (
            <div className="mt-2 flex items-center gap-2 text-xs text-green-600">
              <CheckCircle2 className="w-3.5 h-3.5" />Signature captured · {new Date().toLocaleString()}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !form.signerName || !sigData}
            data-testid="button-save-rtr"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            {createMutation.isPending ? "Saving…" : "Sign & Save Acknowledgment"}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
        {!sigData && <p className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Signature required before saving</p>}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Deviation of Standard Form
// ─────────────────────────────────────────────────────────────────────────────
function DeviationOfStandardForm({
  job, contact, jobId, onClose, phase
}: { job: Job; contact?: Contact; jobId: number; onClose: () => void; phase?: string }) {
  const { toast } = useToast();
  const [sigData, setSigData] = useState<string>("");
  const [techSigData, setTechSigData] = useState<string>("");
  const [form, setForm] = useState({
    signerName: contact?.name || "",
    techName: job.assignedTech || "",
    propertyAddress: job.address || "",
    deviationCategory: "",
    iicrcStandard: "IICRC S500 — Water Damage",
    standardRequirement: "",
    proposedDeviation: "",
    reasonForDeviation: "",
    alternativeMethod: "",
    riskAcknowledgment: "",
    insuranceCarrierApproval: "pending",
    carrierRepName: "",
    claimNumber: job.claimNumber || "",
  });

  const DEVIATION_CATEGORIES = [
    "Drying Equipment — Below Minimum Ratio (S500 §11.4)",
    "Drying Timeline — Extended Beyond Standard (S500 §12.3)",
    "Water Category Upgrade — Reclassification Required",
    "Water Class Upgrade — Expanded Scope",
    "Structural Removal — Beyond Drying Protocol",
    "Antimicrobial — Omission at Owner Request",
    "Contents — Delayed Pack-Out at Owner Request",
    "Demolition — Selective Instead of Full",
    "Reconstruction — Modified Scope at Owner Request",
    "Other — See Description",
  ];

  const IICRC_STANDARDS = [
    "IICRC S500 — Water Damage",
    "IICRC S520 — Mold Remediation",
    "IICRC S700 — Storm Damage",
    "IICRC S770 — Sewage Backflow",
    "IICRC S100 — Carpet Cleaning",
  ];

  const createMutation = useMutation({
    mutationFn: async () => {
      const signedAt = new Date().toISOString();
      let pdfDataUri: string | undefined;
      try {
        const { generateDeviationPDF } = await loadPdfEngine();
        pdfDataUri = generateDeviationPDF({
          jobNumber: job.jobNumber,
          signerName: form.signerName,
          techName: form.techName,
          propertyAddress: form.propertyAddress,
          iicrcStandard: form.iicrcStandard,
          deviationCategory: form.deviationCategory,
          standardRequirement: form.standardRequirement,
          proposedDeviation: form.proposedDeviation,
          reasonForDeviation: form.reasonForDeviation,
          alternativeMethod: form.alternativeMethod,
          insuranceCarrierApproval: form.insuranceCarrierApproval,
          carrierRepName: form.carrierRepName,
          claimNumber: form.claimNumber,
          signatureDataUrl: sigData,
          techSignatureDataUrl: techSigData || undefined,
          signedAt,
        });
      } catch (e) {
        console.error("Deviation PDF generation failed", e);
      }
      return apiRequest("POST", `/api/jobs/${jobId}/documents`, {
        docType: "deviation_of_standard",
        title: `Deviation of Standard — ${job.jobNumber}`,
        formData: JSON.stringify({ ...form, techSignature: techSigData ? "signed" : "unsigned" }),
        signatureData: sigData,
        signerName: form.signerName,
        signerRole: "homeowner",
        signedAt,
        status: sigData ? "signed" : "unsigned",
        createdBy: form.techName,
        phase: phase && phase !== "both" ? phase : "mitigation",
        fileData: pdfDataUri,
        fileName: `Deviation_of_Standard_${job.jobNumber}.pdf`,
        fileMimeType: "application/pdf",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "documents"] });
      toast({ title: "✅ Deviation of Standard signed & PDF generated" });
      onClose();
    },
  });

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <Card className="border-amber-300 dark:border-amber-700">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          Deviation of Standard Form
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Header */}
        <div className="border rounded-lg p-4 bg-amber-50 dark:bg-amber-950/30 space-y-1 text-xs border-amber-200 dark:border-amber-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-base text-[hsl(var(--titan-red))]">TITAN RESTORATION LLC</p>
              <p className="text-muted-foreground">Augusta, GA · 706-922-0154 · titanaugusta.pro</p>
            </div>
            <p className="text-muted-foreground">Date: {today}</p>
          </div>
          <p className="font-semibold text-sm mt-2 pt-2 border-t border-amber-200">DEVIATION FROM IICRC STANDARDS — WRITTEN AUTHORIZATION</p>
          <p className="text-amber-700 dark:text-amber-400">This document records a requested or required deviation from IICRC industry standards. Per IICRC protocol, any deviation must be documented in writing and signed by all parties.</p>
        </div>
        <SendForSignature
          jobId={jobId}
          docType="deviation_of_standard"
          title={`Deviation of Standard — ${job.jobNumber}`}
          getFormData={() => form}
          defaultEmail={contact?.email || (job as any).customerEmail || ""}
          defaultName={form.signerName}
          defaultRole="homeowner"
        />

        {/* Fields */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Property Owner / Insured</Label>
            <Input className="mt-1 h-8 text-sm" value={form.signerName}
              onChange={e => setForm(f => ({ ...f, signerName: e.target.value }))}
              placeholder="Full legal name" />
          </div>
          <div>
            <Label className="text-xs">Assigned Technician</Label>
            <Input className="mt-1 h-8 text-sm" value={form.techName}
              onChange={e => setForm(f => ({ ...f, techName: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Property Address</Label>
            <Input className="mt-1 h-8 text-sm" value={form.propertyAddress}
              onChange={e => setForm(f => ({ ...f, propertyAddress: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Applicable IICRC Standard</Label>
            <Select value={form.iicrcStandard} onValueChange={v => setForm(f => ({ ...f, iicrcStandard: v }))}>
              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{IICRC_STANDARDS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Deviation Category</Label>
            <Select value={form.deviationCategory} onValueChange={v => setForm(f => ({ ...f, deviationCategory: v }))}>
              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>{DEVIATION_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Standard Requirement Being Deviated From</Label>
            <Textarea className="mt-1 text-xs min-h-[60px]" value={form.standardRequirement}
              onChange={e => setForm(f => ({ ...f, standardRequirement: e.target.value }))}
              placeholder="Describe the specific IICRC standard requirement (cite section number if known)…" />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Proposed Deviation / Modified Approach</Label>
            <Textarea className="mt-1 text-xs min-h-[60px]" value={form.proposedDeviation}
              onChange={e => setForm(f => ({ ...f, proposedDeviation: e.target.value }))}
              placeholder="Describe specifically what will be done differently from the standard…" />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Reason for Deviation</Label>
            <Textarea className="mt-1 text-xs min-h-[60px]" value={form.reasonForDeviation}
              onChange={e => setForm(f => ({ ...f, reasonForDeviation: e.target.value }))}
              placeholder="e.g. Owner refusal, insurance carrier restriction, pre-existing conditions, access limitations…" />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Alternative Method / Mitigation Measures</Label>
            <Textarea className="mt-1 text-xs min-h-[60px]" value={form.alternativeMethod}
              onChange={e => setForm(f => ({ ...f, alternativeMethod: e.target.value }))}
              placeholder="Describe any compensating measures being taken to reduce risk from this deviation…" />
          </div>
          <div>
            <Label className="text-xs">Insurance Carrier Approval Status</Label>
            <Select value={form.insuranceCarrierApproval} onValueChange={v => setForm(f => ({ ...f, insuranceCarrierApproval: v }))}>
              <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending Carrier Review</SelectItem>
                <SelectItem value="approved">Approved by Carrier</SelectItem>
                <SelectItem value="not_applicable">Not Applicable / No Carrier</SelectItem>
                <SelectItem value="owner_only">Owner Authorization Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Carrier Rep / Adjuster Name</Label>
            <Input className="mt-1 h-8 text-sm" value={form.carrierRepName}
              onChange={e => setForm(f => ({ ...f, carrierRepName: e.target.value }))}
              placeholder="If approved by carrier" />
          </div>
        </div>

        {/* Risk acknowledgment */}
        <div className="border rounded-lg p-3 bg-amber-50 dark:bg-amber-950/20 text-xs border-amber-200 dark:border-amber-800 space-y-2">
          <p className="font-semibold text-amber-800 dark:text-amber-300">Risk & Liability Acknowledgment</p>
          <p className="text-muted-foreground">By signing below, the property owner/insured acknowledges: (1) they have been informed of the IICRC industry standard and the risks associated with deviation; (2) they are requesting or consenting to this deviation from standard protocol; (3) Titan Restoration LLC has documented this deviation as required and bears no additional liability for outcomes resulting from the approved deviation; (4) this documentation will be included in the full job file.</p>
        </div>

        {/* Homeowner signature */}
        <div>
          <Label className="text-xs font-semibold">Property Owner / Insured Signature</Label>
          <div className="mt-2">
            <SignaturePad onSign={setSigData} onClear={() => setSigData("")} />
          </div>
          {sigData && (
            <div className="mt-2 flex items-center gap-2 text-xs text-green-600">
              <CheckCircle2 className="w-3.5 h-3.5" />Owner signature captured · {new Date().toLocaleString()}
            </div>
          )}
        </div>

        {/* Tech signature */}
        <div>
          <Label className="text-xs font-semibold">Technician / Company Representative Signature</Label>
          <div className="mt-2">
            <SignaturePad onSign={setTechSigData} onClear={() => setTechSigData("")} />
          </div>
          {techSigData && (
            <div className="mt-2 flex items-center gap-2 text-xs text-green-600">
              <CheckCircle2 className="w-3.5 h-3.5" />Tech signature captured
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !form.signerName || !sigData || !form.deviationCategory}
            data-testid="button-save-deviation"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            {createMutation.isPending ? "Saving…" : "Sign & Save Deviation Form"}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
        {(!sigData || !form.deviationCategory) && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {!form.deviationCategory ? "Select deviation category" : "Owner signature required"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Document Card (library item)
// ─────────────────────────────────────────────────────────────────────────────
function DocCard({
  doc, jobId, job, contact, selected, onToggleSelect,
}: {
  doc: JobDocument;
  jobId: number;
  job?: Job;
  contact?: Contact;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
}) {
  const [printing, setPrinting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Inline sign-now flow: capture signature with SignaturePad and PATCH it
  // onto the existing doc record. Set when the user clicks "Sign now".
  const [signMode, setSignMode] = useState(false);
  const [inlineSig, setInlineSig] = useState<string>("");
  const [inlineSignerName, setInlineSignerName] = useState<string>(doc.signerName || contact?.name || "");
  const [savingSig, setSavingSig] = useState(false);
  // Send-for-signature flow: reveal the SendForSignature dialog inline.
  const [sendMode, setSendMode] = useState(false);
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/documents/${doc.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "documents"] });
      toast({ title: "Document deleted" });
    },
  });

  const formData = doc.formData ? JSON.parse(doc.formData) : null;
  const hasPDF = !!(doc.fileData && doc.fileMimeType === "application/pdf");

  const DOC_TYPE_LABELS: Record<string, { label: string; color: string; icon: any }> = {
    work_authorization: { label: "Work Authorization", color: "bg-blue-100 text-blue-700", icon: ClipboardCheck },
    direction_to_pay_notice: { label: "Direction to Pay Notice", color: "bg-sky-100 text-sky-700", icon: ClipboardCheck },
    custom_pricing_acknowledgment: { label: "Custom Pricing Acknowledgment", color: "bg-indigo-100 text-indigo-700", icon: ClipboardCheck },
    deviation_of_standard: { label: "Deviation of Standard", color: "bg-amber-100 text-amber-700", icon: AlertTriangle },
    right_to_renovate: { label: "Right to Renovate", color: "bg-emerald-100 text-emerald-700", icon: ShieldCheck },
    certificate_of_completion: { label: "Certificate of Completion", color: "bg-green-100 text-green-700", icon: Award },
    pdf_upload: { label: "PDF Document", color: "bg-purple-100 text-purple-700", icon: FileText },
    other: { label: "Document", color: "bg-gray-100 text-gray-700", icon: FileText },
  };

  const meta = DOC_TYPE_LABELS[doc.docType] || DOC_TYPE_LABELS.other;
  const Icon = meta.icon;

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasPDF) {
      const { downloadPDF } = await loadPdfEngine();
      downloadPDF(doc.fileData!, doc.fileName || `${doc.title}.pdf`);
    } else if (doc.signatureData) {
      const content = [
        `TITAN RESTORATION LLC`,
        `706-922-0154 | titanaugusta.pro`,
        ``,
        doc.title,
        `${"-".repeat(60)}`,
        `Signed by: ${doc.signerName}`,
        `Date: ${doc.signedAt ? fmtDateShort(doc.signedAt) : "N/A"}`,
        ``,
        ...(formData ? Object.entries(formData).map(([k, v]) => `${k}: ${v}`) : []),
        ``,
        `[Electronic signature on file]`,
      ].join("\n");
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.title.replace(/\s+/g, "_")}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handlePreview = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasPDF) {
      const { previewPDF } = await loadPdfEngine();
      previewPDF(doc.fileData!);
    }
  };

  const handlePrint = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setPrinting(true);
    try {
      const { printSingleDocument } = await loadDocumentPacket();
      await printSingleDocument(doc, job, contact);
    } finally {
      setPrinting(false);
    }
  };

  // Persist an in-person signature onto the existing doc. For form-backed
  // docs (work_authorization, direction_to_pay_notice, etc.) we also try to
  // regenerate the branded PDF so the freshly signed copy has the signature
  // baked in — falling back gracefully if the generator isn't found.
  const saveInlineSignature = async () => {
    if (!inlineSig) {
      toast({ title: "Draw a signature first", variant: "destructive" });
      return;
    }
    if (!inlineSignerName.trim()) {
      toast({ title: "Enter the signer's name", variant: "destructive" });
      return;
    }
    setSavingSig(true);
    const signedAt = new Date().toISOString();
    // Try to regenerate the PDF with the signature embedded, if possible.
    let regeneratedPdf: string | undefined;
    try {
      const engine: any = await loadPdfEngine();
      const fd = formData || {};
      if (doc.docType === "work_authorization" && engine.generateWorkAuthPDF) {
        regeneratedPdf = engine.generateWorkAuthPDF({
          jobNumber: job?.jobNumber, signerName: inlineSignerName,
          relationship: fd.relationship, propertyAddress: fd.propertyAddress,
          authorizationScope: fd.authorizationScope, startDate: fd.startDate,
          insuranceCarrier: fd.insuranceCarrier, claimNumber: fd.claimNumber,
          policyNumber: fd.policyNumber, specialInstructions: fd.specialInstructions,
          signatureDataUrl: inlineSig, signedAt,
          lossType: (job as any)?.lossType, assignedTech: (job as any)?.assignedTech,
        });
      } else if (doc.docType === "direction_to_pay_notice" && engine.generateDirectionToPayPDF) {
        regeneratedPdf = engine.generateDirectionToPayPDF({ ...fd, jobNumber: job?.jobNumber, signerName: inlineSignerName, signatureDataUrl: inlineSig, signedAt });
      } else if (doc.docType === "custom_pricing_acknowledgment" && engine.generateCustomPricingPDF) {
        regeneratedPdf = engine.generateCustomPricingPDF({ ...fd, jobNumber: job?.jobNumber, signerName: inlineSignerName, signatureDataUrl: inlineSig, signedAt });
      } else if (doc.docType === "right_to_renovate" && engine.generateRightToRenovatePDF) {
        regeneratedPdf = engine.generateRightToRenovatePDF({ ...fd, jobNumber: job?.jobNumber, signerName: inlineSignerName, signatureDataUrl: inlineSig, signedAt });
      } else if (doc.docType === "deviation_of_standard" && engine.generateDeviationPDF) {
        regeneratedPdf = engine.generateDeviationPDF({ ...fd, jobNumber: job?.jobNumber, signerName: inlineSignerName, signatureDataUrl: inlineSig, signedAt });
      }
    } catch (e) {
      console.warn("[sign-now] pdf regeneration skipped:", e);
    }
    try {
      await apiRequest("PATCH", `/api/documents/${doc.id}`, {
        signatureData: inlineSig,
        signerName: inlineSignerName,
        signedAt,
        status: "signed",
        ...(regeneratedPdf ? { fileData: regeneratedPdf, fileMimeType: "application/pdf" } : {}),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "documents"] });
      toast({ title: "✅ Signed and saved" });
      setSignMode(false);
      setInlineSig("");
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message || "try again", variant: "destructive" });
    } finally {
      setSavingSig(false);
    }
  };

  return (
    <Card data-testid={`doc-card-${doc.id}`} className="overflow-hidden">
      <CardContent className="p-0">
        {/* Collapsed header row */}
        <div
          className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
          onClick={() => setExpanded(e => !e)}
        >
          {onToggleSelect && (
            <button
              className="shrink-0 text-muted-foreground hover:text-[hsl(var(--titan-blue))] transition-colors"
              onClick={e => { e.stopPropagation(); onToggleSelect(doc.id); }}
              data-testid={`select-doc-${doc.id}`}
              title={selected ? "Deselect" : "Select for packet"}
              aria-pressed={selected}
            >
              {selected
                ? <CheckSquare className="w-5 h-5 text-[hsl(var(--titan-blue))]" />
                : <Square className="w-5 h-5" />}
            </button>
          )}
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${meta.color}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{doc.title}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="outline" className={`text-xs border-0 ${meta.color}`}>{meta.label}</Badge>
              {doc.status === "signed" && (
                <Badge className="text-xs bg-green-100 text-green-700 border-0">
                  <CheckCircle2 className="w-3 h-3 mr-1" />Signed
                </Badge>
              )}
              {doc.status === "uploaded" && (
                <Badge className="text-xs bg-purple-100 text-purple-700 border-0">Uploaded</Badge>
              )}
              {doc.status === "unsigned" && (
                <Badge className="text-xs bg-gray-100 text-gray-600 border-0">Unsigned</Badge>
              )}
              {hasPDF && (
                <Badge className="text-xs bg-red-50 text-[hsl(var(--titan-red))] border border-red-200">
                  <FileText className="w-3 h-3 mr-1" />PDF Ready
                </Badge>
              )}
            </div>
          </div>

          {/* Prominent action buttons visible on collapsed row for PDF docs */}
          <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={handlePrint}
              disabled={printing}
              data-testid={`button-print-doc-${doc.id}`}
              title="Print this document"
            >
              {printing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Printer className="w-3 h-3" />}
              <span className="hidden sm:inline">Print</span>
            </Button>
            {hasPDF && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 border-[hsl(var(--titan-blue))] text-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue)/0.08)]"
                  onClick={handlePreview}
                  data-testid={`button-preview-pdf-${doc.id}`}
                  title="Open PDF in new tab"
                >
                  <Eye className="w-3 h-3" />
                  <span className="hidden sm:inline">Preview</span>
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1 bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
                  onClick={handleDownload}
                  data-testid={`button-download-pdf-${doc.id}`}
                  title="Download PDF"
                >
                  <Download className="w-3 h-3" />
                  <span className="hidden sm:inline">Download PDF</span>
                </Button>
              </>
            )}
            {doc.createdAt && (
              <span className="text-xs text-muted-foreground hidden md:block ml-1">
                {fmtDateShort(doc.createdAt)}
              </span>
            )}
            {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground ml-1" /> : <ChevronDown className="w-4 h-4 text-muted-foreground ml-1" />}
          </div>
        </div>

        {expanded && (
          <div className="border-t p-4 space-y-4">
            {/* Signed form detail */}
            {formData && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Form Details</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {Object.entries(formData).filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="flex flex-col">
                      <span className="text-muted-foreground capitalize">{k.replace(/([A-Z])/g, " $1").trim()}</span>
                      <span className="font-medium truncate">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Signature preview */}
            {doc.signatureData && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Electronic Signature</p>
                <div className="border rounded-lg p-2 bg-white dark:bg-gray-900 inline-block">
                  <img src={doc.signatureData} alt="Signature" className="max-h-20 max-w-full" />
                </div>
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Signed by {doc.signerName} · {doc.signedAt ? fmtDateShort(doc.signedAt) : ""}
                </p>
              </div>
            )}

            {/* PDF info + full action bar */}
            {hasPDF && (
              <div className="border rounded-lg p-3 bg-muted/20 flex items-center gap-3">
                <FileText className="w-5 h-5 text-[hsl(var(--titan-red))] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{doc.fileName}</p>
                  {doc.fileSize && (
                    <p className="text-xs text-muted-foreground">{(doc.fileSize / 1024).toFixed(1)} KB</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm" variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={handlePreview}
                    data-testid={`button-preview-pdf-exp-${doc.id}`}
                  >
                    <Eye className="w-3 h-3" />Preview
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1 bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
                    onClick={handleDownload}
                    data-testid={`button-download-pdf-exp-${doc.id}`}
                  >
                    <Download className="w-3 h-3" />Download PDF
                  </Button>
                </div>
              </div>
            )}

            {/* ── Sign / send actions ─────────────────────────────────────────────
                Any doc: Sign now (in-person, captures signature and PATCHes
                onto the record) or Send for signing (emails a signing link
                to the customer via /api/signature-requests). Works for
                unsigned form docs and uploaded PDFs alike. */}
            {doc.status !== "signed" && doc.docType !== "pdf_upload" && (
              <div className="border rounded-lg p-3 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-blue-900 dark:text-blue-100">Signature needed</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={signMode ? "secondary" : "outline"}
                      className="h-7 text-xs gap-1"
                      onClick={() => { setSignMode(v => !v); setSendMode(false); }}
                      data-testid={`button-sign-now-${doc.id}`}
                    >
                      <FileText className="w-3 h-3" />
                      {signMode ? "Cancel" : "Sign now"}
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
                      onClick={() => { setSendMode(v => !v); setSignMode(false); }}
                      data-testid={`button-send-signing-${doc.id}`}
                    >
                      <Send className="w-3 h-3" />
                      {sendMode ? "Hide" : "Send for signing"}
                    </Button>
                  </div>
                </div>

                {signMode && (
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">Signer's Name</Label>
                      <Input
                        className="mt-1 h-8 text-sm"
                        value={inlineSignerName}
                        onChange={e => setInlineSignerName(e.target.value)}
                        placeholder="Full legal name"
                      />
                    </div>
                    <SignaturePad
                      onSign={setInlineSig}
                      onClear={() => setInlineSig("")}
                    />
                    <Button
                      size="sm"
                      className="w-full h-8 text-xs gap-1 bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
                      onClick={saveInlineSignature}
                      disabled={!inlineSig || savingSig}
                      data-testid={`button-save-inline-sig-${doc.id}`}
                    >
                      {savingSig ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                      Save signature
                    </Button>
                  </div>
                )}

                {sendMode && (
                  <SendForSignature
                    jobId={jobId}
                    docType={doc.docType}
                    title={doc.title}
                    getFormData={() => formData || {}}
                    defaultEmail={contact?.email || (job as any)?.customerEmail || ""}
                    defaultName={doc.signerName || contact?.name || ""}
                    defaultRole="homeowner"
                  />
                )}
              </div>
            )}

            {/* Delete */}
            <div className="flex gap-2">
              {!hasPDF && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleDownload}>
                  <Download className="w-3 h-3 mr-1" />Download
                </Button>
              )}
              <Button
                size="sm" variant="ghost" className="h-7 text-xs text-destructive ml-auto"
                onClick={() => { if (confirm("Delete this document?")) deleteMutation.mutate(); }}
                data-testid={`button-delete-doc-${doc.id}`}
              >
                <Trash2 className="w-3 h-3 mr-1" />Delete
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF Upload
// ─────────────────────────────────────────────────────────────────────────────
function PdfUpload({ jobId, onClose, phase }: { jobId: number; onClose: () => void; phase?: string }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ name: string; size: number; data: string } | null>(null);

  const handleFile = (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPreview({ name: file.name, size: file.size, data: reader.result as string });
      if (!title) setTitle(file.name.replace(/\.[^/.]+$/, ""));
    };
    reader.readAsDataURL(file);
  };

  const uploadMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/jobs/${jobId}/documents`, {
      docType: "pdf_upload",
      title: title || preview?.name || "Document",
      fileData: preview?.data,
      fileName: preview?.name,
      fileMimeType: "application/pdf",
      fileSize: preview?.size,
      status: "uploaded",
      createdBy: "Titan Pro",
      phase: phase && phase !== "both" ? phase : "mitigation",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "documents"] });
      toast({ title: "Document uploaded" });
      onClose();
    },
  });

  return (
    <Card className="border-purple-200 dark:border-purple-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileUp className="w-4 h-4 text-purple-600" />Upload PDF Document
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
        />

        {!preview ? (
          <button
            className="w-full border-2 border-dashed border-purple-300 dark:border-purple-700 rounded-lg p-8 text-center hover:bg-purple-50 dark:hover:bg-purple-950/20 transition-colors cursor-pointer"
            onClick={() => fileRef.current?.click()}
            data-testid="button-choose-pdf"
          >
            <FileUp className="w-8 h-8 mx-auto mb-2 text-purple-400" />
            <p className="text-sm font-medium text-purple-700 dark:text-purple-300">Click to choose a PDF</p>
            <p className="text-xs text-muted-foreground mt-1">Estimates, scopes, adjuster letters, insurance docs, certificates…</p>
          </button>
        ) : (
          <div className="border rounded-lg p-4 bg-purple-50 dark:bg-purple-950/20 flex items-center gap-3">
            <FileText className="w-8 h-8 text-purple-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{preview.name}</p>
              <p className="text-xs text-muted-foreground">{(preview.size / 1024).toFixed(1)} KB</p>
            </div>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setPreview(null)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}

        <div>
          <Label className="text-xs">Document Title</Label>
          <Input
            className="mt-1 h-8 text-sm"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="e.g. Insurance Scope of Loss, Adjuster Report…"
            data-testid="input-doc-title"
          />
        </div>

        <div className="flex gap-2">
          <Button
            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
            onClick={() => uploadMutation.mutate()}
            disabled={uploadMutation.isPending || !preview}
            data-testid="button-upload-pdf"
          >
            <Upload className="w-4 h-4 mr-2" />
            {uploadMutation.isPending ? "Uploading…" : "Upload Document"}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
type ActiveForm = "work_auth" | "direction_to_pay" | "custom_pricing" | "deviation" | "right_to_renovate" | "pdf_upload" | "completion" | null;

export default function JobDocuments({ jobId, readOnly = false, phase }: { jobId: number; readOnly?: boolean; phase?: string }) {
  const [activeForm, setActiveForm] = useState<ActiveForm>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [packetBusy, setPacketBusy] = useState<null | "print-all" | "download-all" | "print-sel" | "download-sel" | "claim">(null);
  const { toast } = useToast();

  const { data: allDocs = [], isLoading } = useQuery<JobDocument[]>({
    queryKey: ["/api/jobs", String(jobId), "documents"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/documents`).then(r => r.json()),
  });

  // Phase scope: 'both'/undefined shows all; otherwise only docs for the phase
  // (null phase treated as 'mitigation').
  const docs = !phase || phase === "both"
    ? allDocs
    : allDocs.filter(d => ((d as any).phase || "mitigation") === phase);

  // Fetch THIS job directly. Previously we did jobs.find(j => j.id === jobId)
  // on the whole /api/jobs list, but that endpoint filters out closed jobs on
  // the server, so the Work Authorization / Direction to Pay / Custom Pricing
  // buttons became silent no-ops on any job whose status transitioned to
  // 'closed' — the outer conditional `activeForm === 'work_auth' && job`
  // failed because `job` was undefined. Using /api/jobs/:id (which does not
  // filter by status) means the Documents tab works consistently on both
  // open and closed jobs.
  const { data: job } = useQuery<Job>({
    queryKey: ["/api/jobs", jobId],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}`).then(r => r.json()),
  });
  const { data: contacts = [] } = useQuery<any[]>({ queryKey: ["/api/contacts"] });
  const contact = job ? contacts.find((c: any) => c.id === (job as any).contactId) : undefined;

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectedDocs = docs.filter(d => selectedIds.has(d.id));
  const allSelected = docs.length > 0 && selectedIds.size === docs.length;

  const runPacket = useCallback(
    async (mode: "print-all" | "download-all" | "print-sel" | "download-sel") => {
      const which = mode.endsWith("-all") ? docs : docs.filter(d => selectedIds.has(d.id));
      if (which.length === 0) {
        toast({ title: "No documents selected", variant: "destructive" });
        return;
      }
      setPacketBusy(mode);
      try {
        const { buildJobDocumentPacket, printPdfDataUri, downloadPdfDataUri } = await loadDocumentPacket();
        // Pull CompanyCam photos for this job so they are appended to the packet.
        // Fails gracefully to an empty array if no photos / no integration configured.
        let photos: any[] = [];
        try {
          const pr = await apiRequest("GET", `/api/jobs/${jobId}/companycam-photos`);
          const pj = await pr.json();
          photos = Array.isArray(pj?.photos) ? pj.photos : [];
        } catch {
          photos = [];
        }
        const uri = await buildJobDocumentPacket(job, contact, which, photos);
        const fname = `Titan_${job?.jobNumber || "job"}_Document_Packet.pdf`;
        if (mode.startsWith("print")) printPdfDataUri(uri);
        else downloadPdfDataUri(uri, fname);
        toast({
          title: mode.startsWith("print") ? "Opening print packet…" : "Packet downloaded",
          description: `${which.length} document${which.length !== 1 ? "s" : ""} combined into one PDF.`,
        });
      } catch (err: any) {
        toast({ title: "Could not build packet", description: String(err?.message || err), variant: "destructive" });
      } finally {
        setPacketBusy(null);
      }
    },
    [docs, selectedIds, job, contact, jobId, toast]
  );

  // ── Defensible Claim Packet ────────────────────────────────────────────────
  // One-click carrier/court-ready evidence file: standard doc packet + drying log
  // + AI insurance narrative (with provenance receipts) + photos-with-metadata.
  const runClaimPacket = useCallback(async () => {
    setPacketBusy("claim");
    try {
      const { buildDefensibleClaimPacket, downloadPdfDataUri } = await loadDocumentPacket();

      // Drying / moisture records (IICRC S500 log)
      let dryingRecords: any[] = [];
      try {
        const r = await apiRequest("GET", `/api/jobs/${jobId}/drying-records`);
        const j = await r.json();
        dryingRecords = (Array.isArray(j) ? j : []).map((d: any) => ({
          dayNumber: d.dayNumber ?? d.day_number,
          readingDate: d.readingDate ?? d.reading_date,
          readingTime: d.readingTime ?? d.reading_time,
          techName: d.techName ?? d.tech_name,
          waterCategory: d.waterCategory ?? d.water_category,
          waterClass: d.waterClass ?? d.water_class,
          tempF: d.tempF ?? d.temp_f,
          rhPct: d.rhPct ?? d.rh_pct,
          gpp: d.gpp,
          dewPointF: d.dewPointF ?? d.dew_point_f,
          dryingGoalMet: d.dryingGoalMet ?? d.drying_goal_met,
          structuralDryingComplete: d.structuralDryingComplete ?? d.structural_drying_complete,
          observations: d.observations,
        }));
      } catch { dryingRecords = []; }

      // AI insurance narrative + its provenance receipts (from agent_drafts)
      let aiNarrative: any = null;
      try {
        const r = await apiRequest("GET", `/api/ai-agent/drafts`);
        const j = await r.json();
        const rows = Array.isArray(j) ? j : (j?.drafts || []);
        const mine = rows
          .filter((d: any) => Number(d.jobId ?? d.job_id) === Number(jobId) && (d.kind === "insurance_narrative"))
          .sort((a: any, b: any) => String(b.createdAt ?? b.created_at).localeCompare(String(a.createdAt ?? a.created_at)));
        const n = mine[0];
        if (n) {
          let meta: any = {};
          try { meta = typeof (n.metaJson ?? n.meta_json) === "string" ? JSON.parse(n.metaJson ?? n.meta_json) : (n.metaJson ?? n.meta_json ?? {}); } catch { meta = {}; }
          aiNarrative = {
            subject: n.subject,
            body: n.body,
            status: n.status,
            createdAt: n.createdAt ?? n.created_at,
            usedLlm: !!meta.usedLlm,
            dryingReadings: meta.dryingReadings,
            equipmentUnits: meta.equipmentUnits,
          };
        }
      } catch { aiNarrative = null; }

      // Photos with full metadata (Titan photos first, then CompanyCam)
      let photos: any[] = [];
      try {
        const r = await apiRequest("GET", `/api/jobs/${jobId}/photos`);
        const j = await r.json();
        photos = (Array.isArray(j) ? j : []).map((p: any) => ({
          id: p.id,
          dataUrl: p.dataUrl ?? p.data_url,
          caption: p.caption,
          category: p.category,
          takenAt: p.takenAt ?? p.taken_at,
          phase: p.phase,
        }));
      } catch { photos = []; }
      if (photos.length === 0) {
        try {
          const pr = await apiRequest("GET", `/api/jobs/${jobId}/companycam-photos`);
          const pj = await pr.json();
          photos = (Array.isArray(pj?.photos) ? pj.photos : []).map((p: any) => ({
            id: p.id, uri: p.uri, caption: p.caption, category: p.category, takenAt: p.capturedAt ?? p.taken_at,
          }));
        } catch { /* none */ }
      }

      if (docs.length === 0 && dryingRecords.length === 0 && !aiNarrative && photos.length === 0) {
        toast({ title: "Nothing to include yet", description: "Add documents, drying logs, an AI narrative, or photos first.", variant: "destructive" });
        setPacketBusy(null);
        return;
      }

      const uri = await buildDefensibleClaimPacket(job, contact, docs, { dryingRecords, aiNarrative, photos });
      downloadPdfDataUri(uri, `Titan_${job?.jobNumber || "job"}_Claim_Packet.pdf`);
      const parts: string[] = [`${docs.length} doc${docs.length !== 1 ? "s" : ""}`];
      if (dryingRecords.length) parts.push(`${dryingRecords.length} drying reading${dryingRecords.length !== 1 ? "s" : ""}`);
      if (aiNarrative) parts.push("AI narrative");
      if (photos.length) parts.push(`${photos.length} photo${photos.length !== 1 ? "s" : ""}`);
      toast({ title: "Claim packet built", description: parts.join(" · ") });
    } catch (err: any) {
      toast({ title: "Could not build claim packet", description: String(err?.message || err), variant: "destructive" });
    } finally {
      setPacketBusy(null);
    }
  }, [docs, job, contact, jobId, toast]);

  const signedCount = docs.filter(d => d.status === "signed").length;
  const uploadedCount = docs.filter(d => d.status === "uploaded").length;
  const unsignedCount = docs.filter(d => d.status === "unsigned").length;

  const hasWorkAuth = docs.some(d => d.docType === "work_authorization" && d.status === "signed");
  const hasDirectionToPay = docs.some(d => d.docType === "direction_to_pay_notice" && d.status === "signed");
  const hasCustomPricing = docs.some(d => d.docType === "custom_pricing_acknowledgment" && d.status === "signed");
  const hasDeviation = docs.some(d => d.docType === "deviation_of_standard");
  const hasRightToRenovate = docs.some(d => d.docType === "right_to_renovate" && d.status === "signed");
  const hasCompletion = docs.some(d => d.docType === "certificate_of_completion" && d.status === "signed");

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
            <span className="text-sm font-semibold">{docs.length} Document{docs.length !== 1 ? "s" : ""}</span>
          </div>
          {docs.length > 0 && (
            <div className="flex gap-1.5 text-xs">
              {signedCount > 0 && <Badge className="bg-green-100 text-green-700 border-0">{signedCount} Signed</Badge>}
              {uploadedCount > 0 && <Badge className="bg-purple-100 text-purple-700 border-0">{uploadedCount} Uploaded</Badge>}
              {unsignedCount > 0 && <Badge variant="outline" className="text-xs">{unsignedCount} Unsigned</Badge>}
            </div>
          )}
        </div>

        {/* Packet actions — combine every document into one branded PDF */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Defensible Claim Packet — always available (docs + drying log + AI narrative + photos) */}
          <Button
            size="sm"
            className="h-8 text-xs gap-1.5 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
            onClick={runClaimPacket}
            disabled={packetBusy !== null}
            data-testid="button-build-claim-packet"
            title="Build a carrier/court-ready claim packet: signed docs, drying log, AI narrative with receipts, and photos with metadata"
          >
            {packetBusy === "claim" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            Build Claim Packet
          </Button>
        {docs.length > 0 && (
          <>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
              onClick={() => runPacket("print-all")}
              disabled={packetBusy !== null}
              data-testid="button-print-all-docs"
              title="Combine all job documents into one printable packet"
            >
              {packetBusy === "print-all" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              Print All
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5 border-[hsl(var(--titan-blue))] text-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue)/0.08)]"
              onClick={() => runPacket("download-all")}
              disabled={packetBusy !== null}
              data-testid="button-download-all-docs"
              title="Download all job documents as one combined PDF"
            >
              {packetBusy === "download-all" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
              Download Packet
            </Button>
            <Button
              size="sm"
              variant={selectMode ? "secondary" : "ghost"}
              className="h-8 text-xs gap-1.5"
              onClick={() => { setSelectMode(m => !m); if (selectMode) setSelectedIds(new Set()); }}
              data-testid="button-toggle-select-docs"
              title="Select specific documents to print or download"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              {selectMode ? "Cancel Select" : "Select"}
            </Button>
          </>
        )}
        </div>
      </div>

      {/* Multi-select action bar */}
      {selectMode && docs.length > 0 && (
        <div className="flex items-center justify-between gap-2 flex-wrap rounded-lg border border-[hsl(var(--titan-blue))]/30 bg-[hsl(var(--titan-blue)/0.05)] px-3 py-2">
          <div className="flex items-center gap-3">
            <button
              className="flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--titan-blue))]"
              onClick={() => setSelectedIds(allSelected ? new Set() : new Set(docs.map(d => d.id)))}
              data-testid="button-select-all-docs"
            >
              {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              {allSelected ? "Deselect all" : "Select all"}
            </button>
            <span className="text-xs text-muted-foreground">{selectedDocs.length} selected</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
              onClick={() => runPacket("print-sel")}
              disabled={packetBusy !== null || selectedDocs.length === 0}
              data-testid="button-print-selected-docs"
            >
              {packetBusy === "print-sel" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              Print Selected
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5"
              onClick={() => runPacket("download-sel")}
              disabled={packetBusy !== null || selectedDocs.length === 0}
              data-testid="button-download-selected-docs"
            >
              {packetBusy === "download-sel" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Download Selected
            </Button>
          </div>
        </div>
      )}

      {/* Required documents checklist */}
      {!readOnly && (
        <div className="border rounded-lg p-3 bg-muted/20 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Required Documents</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                activeForm === "work_auth" ? "border-[hsl(var(--titan-blue))] bg-[hsl(var(--titan-blue)/0.05)]" :
                hasWorkAuth ? "border-green-300 bg-green-50 dark:bg-green-950/20" :
                "border-border hover:border-[hsl(var(--titan-blue))] hover:bg-muted/40"
              }`}
              onClick={() => setActiveForm(activeForm === "work_auth" ? null : "work_auth")}
              disabled={readOnly}
              data-testid="button-open-work-auth"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${hasWorkAuth ? "bg-green-100 text-green-700" : "bg-blue-100 text-[hsl(var(--titan-blue))]"}`}>
                {hasWorkAuth ? <CheckCircle2 className="w-4 h-4" /> : <ClipboardCheck className="w-4 h-4" />}
              </div>
              <div>
                <p className="text-sm font-medium">Work Authorization</p>
                <p className="text-xs text-muted-foreground">{hasWorkAuth ? "Signed ✓" : "Tap to complete & sign"}</p>
              </div>
            </button>

            <button
              className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                activeForm === "direction_to_pay" ? "border-sky-400 bg-sky-50 dark:bg-sky-950/20" :
                hasDirectionToPay ? "border-green-300 bg-green-50 dark:bg-green-950/20" :
                "border-border hover:border-sky-400 hover:bg-muted/40"
              }`}
              onClick={() => setActiveForm(activeForm === "direction_to_pay" ? null : "direction_to_pay")}
              disabled={readOnly}
              data-testid="button-open-direction-to-pay"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${hasDirectionToPay ? "bg-green-100 text-green-700" : "bg-sky-100 text-sky-600"}`}>
                {hasDirectionToPay ? <CheckCircle2 className="w-4 h-4" /> : <ClipboardCheck className="w-4 h-4" />}
              </div>
              <div>
                <p className="text-sm font-medium">Direction to Pay Notice</p>
                <p className="text-xs text-muted-foreground">{hasDirectionToPay ? "Signed ✓" : "Notice to carrier — co-payee direction"}</p>
              </div>
            </button>

            <button
              className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                activeForm === "custom_pricing" ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/20" :
                hasCustomPricing ? "border-green-300 bg-green-50 dark:bg-green-950/20" :
                "border-border hover:border-indigo-400 hover:bg-muted/40"
              }`}
              onClick={() => setActiveForm(activeForm === "custom_pricing" ? null : "custom_pricing")}
              disabled={readOnly}
              data-testid="button-open-custom-pricing"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${hasCustomPricing ? "bg-green-100 text-green-700" : "bg-indigo-100 text-indigo-600"}`}>
                {hasCustomPricing ? <CheckCircle2 className="w-4 h-4" /> : <ClipboardCheck className="w-4 h-4" />}
              </div>
              <div>
                <p className="text-sm font-medium">Custom Pricing Acknowledgment</p>
                <p className="text-xs text-muted-foreground">{hasCustomPricing ? "Signed ✓" : "Owner + carrier pricing basis"}</p>
              </div>
            </button>

            <button
              className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                activeForm === "deviation" ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20" :
                hasDeviation ? "border-green-300 bg-green-50 dark:bg-green-950/20" :
                "border-border hover:border-amber-400 hover:bg-muted/40"
              }`}
              onClick={() => setActiveForm(activeForm === "deviation" ? null : "deviation")}
              disabled={readOnly}
              data-testid="button-open-deviation"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${hasDeviation ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-600"}`}>
                {hasDeviation ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              </div>
              <div>
                <p className="text-sm font-medium">Deviation of Standard</p>
                <p className="text-xs text-muted-foreground">{hasDeviation ? "On file ✓" : "If deviating from IICRC protocol"}</p>
              </div>
            </button>

            <button
              className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                activeForm === "right_to_renovate" ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20" :
                hasRightToRenovate ? "border-green-300 bg-green-50 dark:bg-green-950/20" :
                "border-border hover:border-emerald-400 hover:bg-muted/40"
              }`}
              onClick={() => setActiveForm(activeForm === "right_to_renovate" ? null : "right_to_renovate")}
              disabled={readOnly}
              data-testid="button-open-right-to-renovate"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${hasRightToRenovate ? "bg-green-100 text-green-700" : "bg-emerald-100 text-emerald-600"}`}>
                {hasRightToRenovate ? <CheckCircle2 className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
              </div>
              <div>
                <p className="text-sm font-medium">Right to Renovate</p>
                <p className="text-xs text-muted-foreground">{hasRightToRenovate ? "Signed ✓" : "EPA lead pamphlet acknowledgment"}</p>
              </div>
            </button>

            <button
              className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                activeForm === "pdf_upload" ? "border-purple-400 bg-purple-50 dark:bg-purple-950/20" :
                "border-border hover:border-purple-400 hover:bg-muted/40"
              }`}
              onClick={() => setActiveForm(activeForm === "pdf_upload" ? null : "pdf_upload")}
              disabled={readOnly}
              data-testid="button-open-pdf-upload"
            >
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-purple-100 text-purple-600">
                <FileUp className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Upload PDF Document</p>
                <p className="text-xs text-muted-foreground">Insurance docs, scopes, adjuster letters…</p>
              </div>
            </button>

            <button
              className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                activeForm === "completion" ? "border-green-500 bg-green-50 dark:bg-green-950/20" :
                hasCompletion ? "border-green-300 bg-green-50 dark:bg-green-950/20" :
                "border-border hover:border-green-500 hover:bg-muted/40"
              }`}
              onClick={() => setActiveForm(activeForm === "completion" ? null : "completion")}
              disabled={readOnly}
              data-testid="button-open-completion"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${hasCompletion ? "bg-green-100 text-green-700" : "bg-green-100 text-green-600"}`}>
                {hasCompletion ? <CheckCircle2 className="w-4 h-4" /> : <Award className="w-4 h-4" />}
              </div>
              <div>
                <p className="text-sm font-medium">Certificate of Completion</p>
                <p className="text-xs text-muted-foreground">{hasCompletion ? "Signed ✓" : "Sign at job close"}</p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Active form */}
      {!readOnly && activeForm === "work_auth" && job && (
        <WorkAuthorizationForm job={job} contact={contact} jobId={jobId} onClose={() => setActiveForm(null)} phase={phase} />
      )}
      {!readOnly && activeForm === "direction_to_pay" && job && (
        <DirectionToPayForm job={job} contact={contact} jobId={jobId} onClose={() => setActiveForm(null)} phase={phase} />
      )}
      {!readOnly && activeForm === "custom_pricing" && job && (
        <CustomPricingForm job={job} contact={contact} jobId={jobId} onClose={() => setActiveForm(null)} phase={phase} />
      )}
      {!readOnly && activeForm === "deviation" && job && (
        <DeviationOfStandardForm job={job} contact={contact} jobId={jobId} onClose={() => setActiveForm(null)} phase={phase} />
      )}
      {!readOnly && activeForm === "right_to_renovate" && job && (
        <RightToRenovateForm job={job} contact={contact} jobId={jobId} onClose={() => setActiveForm(null)} phase={phase} />
      )}
      {!readOnly && activeForm === "pdf_upload" && (
        <PdfUpload jobId={jobId} onClose={() => setActiveForm(null)} phase={phase} />
      )}
      {!readOnly && activeForm === "completion" && job && (
        <CertificateOfCompletion job={job} contact={contact} jobId={jobId} onClose={() => setActiveForm(null)} />
      )}

      {/* Document library */}
      {isLoading ? (
        <div className="space-y-2">{[1, 2].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : docs.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No documents yet. Add a Work Authorization or upload a PDF above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => (
            <DocCard
              key={doc.id}
              doc={doc}
              jobId={jobId}
              job={job}
              contact={contact as Contact | undefined}
              selected={selectMode ? selectedIds.has(doc.id) : undefined}
              onToggleSelect={selectMode ? toggleSelect : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
