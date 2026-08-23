// Public /sign/:token page. NO auth. The customer opens this from the email
// link, sees a read-only preview of what Titan filled in, draws their
// signature, and submits. We regenerate the exact PDF using the same
// pdfEngine functions that the internal UI uses so the final signed
// document is visually identical.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, AlertTriangle, Loader2, Eraser, ShieldCheck } from "lucide-react";

const loadPdfEngine = () => import("@/lib/pdfEngine");
const loadCertEngine = () => import("@/components/CertificateOfCompletion");

type SignRequest = {
  id: number;
  token: string;
  jobId: number;
  docType: string;
  title: string;
  formData: Record<string, any> | null;
  recipientEmail: string;
  recipientName: string | null;
  recipientRole: string | null;
  status: string;
  expiresAt: string;
  alreadySigned?: boolean;
  job?: {
    id: number;
    jobNumber?: string;
    customerName?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
};

// ─── Signature pad ──────────────────────────────────────────────────────────
function SignaturePad({
  onSign,
  onClear,
}: {
  onSign: (dataUrl: string) => void;
  onClear: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    // Scale for retina crispness.
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#0A2540";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setDrawing(true);
    setEmpty(false);
    const { x, y } = point(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    e.preventDefault();
    const { x, y } = point(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const end = () => {
    if (!drawing) return;
    setDrawing(false);
    onSign(canvasRef.current!.toDataURL("image/png"));
  };

  const clear = () => {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
    setEmpty(true);
    onClear();
  };

  return (
    <div>
      <div className="border-2 border-dashed rounded-lg bg-white">
        <canvas
          ref={canvasRef}
          className="w-full h-40 touch-none block"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
      </div>
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-muted-foreground">
          {empty ? "Sign here using your finger or mouse" : "Signed"}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          <Eraser className="w-3.5 h-3.5 mr-1" /> Clear
        </Button>
      </div>
    </div>
  );
}

// ─── PDF generation dispatch ────────────────────────────────────────────────
// Given a docType + formData + signature, produce a PDF data URL that mirrors
// the internal signing flow. Each generator uses the same shape the internal
// forms use, so we pull fields off formData with the same names.
async function generatePdfForDocType(
  docType: string,
  formData: Record<string, any>,
  job: SignRequest["job"],
  signerName: string,
  signatureDataUrl: string,
): Promise<string> {
  const signedAt = new Date().toISOString();
  const jobNumber = String(job?.jobNumber || formData.jobNumber || "");
  const propertyAddress =
    formData.propertyAddress ||
    [job?.address, job?.city, job?.state, job?.zip].filter(Boolean).join(", ") ||
    "";

  switch (docType) {
    case "work_authorization": {
      const { generateWorkAuthPDF } = await loadPdfEngine();
      return generateWorkAuthPDF({
        jobNumber,
        signerName,
        relationship: formData.relationship || "Property Owner",
        propertyAddress,
        authorizationScope: formData.authorizationScope || "mitigation",
        startDate: formData.startDate || new Date().toISOString().slice(0, 10),
        insuranceCarrier: formData.insuranceCarrier || "",
        claimNumber: formData.claimNumber || "",
        policyNumber: formData.policyNumber || "",
        specialInstructions: formData.specialInstructions || "",
        signatureDataUrl,
        signedAt,
        lossType: formData.lossType || undefined,
        assignedTech: formData.assignedTech || undefined,
      });
    }
    case "direction_to_pay_notice": {
      const { generateDirectionToPayPDF } = await loadPdfEngine();
      return generateDirectionToPayPDF({
        jobNumber,
        signerName,
        relationship: formData.relationship || "Insured",
        propertyAddress,
        dateOfLoss: formData.dateOfLoss,
        lossType: formData.lossType,
        insuranceCarrier: formData.insuranceCarrier || "",
        claimNumber: formData.claimNumber || "",
        policyNumber: formData.policyNumber || "",
        adjusterName: formData.adjusterName,
        adjusterEmail: formData.adjusterEmail,
        adjusterPhone: formData.adjusterPhone,
        mortgageeName: formData.mortgageeName,
        mortgageeLoanNumber: formData.mortgageeLoanNumber,
        signatureDataUrl,
        signedAt,
      });
    }
    case "custom_pricing_acknowledgment": {
      const { generateCustomPricingPDF } = await loadPdfEngine();
      return generateCustomPricingPDF({
        jobNumber,
        signerName,
        relationship: formData.relationship || "Property Owner",
        propertyAddress,
        insuranceCarrier: formData.insuranceCarrier,
        claimNumber: formData.claimNumber,
        policyNumber: formData.policyNumber,
        lossType: formData.lossType,
        signatureDataUrl,
        signedAt,
      });
    }
    case "right_to_renovate": {
      const { generateRightToRenovatePDF } = await loadPdfEngine();
      return generateRightToRenovatePDF({
        jobNumber,
        signerName,
        relationship: formData.relationship || "Property Owner",
        propertyAddress,
        yearBuilt: formData.yearBuilt,
        leadStatus: formData.leadStatus || "unknown",
        renovationScope: formData.renovationScope,
        deliveryMethod: formData.deliveryMethod || "email",
        pamphletVersion: formData.pamphletVersion,
        signatureDataUrl,
        signedAt,
        assignedTech: formData.assignedTech,
      });
    }
    case "deviation_of_standard": {
      const { generateDeviationPDF } = await loadPdfEngine();
      return generateDeviationPDF({
        jobNumber,
        signerName,
        techName: formData.techName || "",
        propertyAddress,
        iicrcStandard: formData.iicrcStandard || "",
        deviationCategory: formData.deviationCategory || "",
        standardRequirement: formData.standardRequirement || "",
        proposedDeviation: formData.proposedDeviation || "",
        reasonForDeviation: formData.reasonForDeviation || "",
        alternativeMethod: formData.alternativeMethod || "",
        insuranceCarrierApproval: formData.insuranceCarrierApproval || "",
        carrierRepName: formData.carrierRepName,
        claimNumber: formData.claimNumber,
        signatureDataUrl,
        techSignatureDataUrl: formData.techSignatureDataUrl,
        signedAt,
      });
    }
    case "certificate_of_completion": {
      // The certificate generator lives inside CertificateOfCompletion.tsx.
      // Lazy-import so this route doesn't force the whole certificate UI
      // onto the initial bundle.
      const { generateCertPDF } = await loadCertEngine();
      const documentId = `CERT-${jobNumber || "job"}-${Date.now()}`;
      return await generateCertPDF({
        jobNumber,
        address: propertyAddress,
        completionDate: formData.completionDate || new Date().toISOString().slice(0, 10),
        workScope: formData.workScope || "",
        finalReadings: formData.finalReadings || "",
        homeownerSatisfaction: formData.homeownerSatisfaction || "Fully Satisfied",
        reservationNotes: formData.reservationNotes || "",
        propertyCondition: formData.propertyCondition || "",
        warrantyOffered: formData.warrantyOffered || "1 Year Workmanship Warranty",
        returnInspectionDate: formData.returnInspectionDate || "",
        signerName,
        homeownerSigUrl: signatureDataUrl,
        techSigUrl: formData.techSigUrl || undefined,
        techName: formData.techName || undefined,
        signedAt,
        documentId,
      });
    }
    default:
      throw new Error(`Unsupported document type: ${docType}`);
  }
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function SignDocument() {
  const params = useParams<{ token: string }>();
  const token = params.token || "";

  const [state, setState] = useState<"loading" | "ready" | "signing" | "done" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [req, setReq] = useState<SignRequest | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState("");
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/public/sign/${token}`);
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        const data: SignRequest = await res.json();
        if (cancelled) return;
        setReq(data);
        setSignerName(data.recipientName || data.formData?.signerName || "");
        if (data.alreadySigned) setState("done");
        else setState("ready");
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || "Could not load signing session.");
        setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const summary = useMemo(() => {
    if (!req) return null;
    const f = req.formData || {};
    const rows: Array<[string, string]> = [];
    const push = (label: string, val: any) => {
      if (val == null || val === "") return;
      rows.push([label, String(val)]);
    };
    push("Property owner / insured", f.signerName);
    push("Property address",
      f.propertyAddress ||
      [req.job?.address, req.job?.city, req.job?.state, req.job?.zip].filter(Boolean).join(", "),
    );
    push("Job number", req.job?.jobNumber || f.jobNumber);
    push("Insurance carrier", f.insuranceCarrier);
    push("Claim number", f.claimNumber);
    push("Policy number", f.policyNumber);
    if (req.docType === "work_authorization") {
      push("Authorization scope", f.authorizationScope);
      push("Start date", f.startDate);
      push("Special instructions", f.specialInstructions);
    }
    if (req.docType === "direction_to_pay_notice") {
      push("Date of loss", f.dateOfLoss);
      push("Mortgagee", f.mortgageeName);
      push("Loan #", f.mortgageeLoanNumber);
    }
    if (req.docType === "right_to_renovate") {
      push("Year built", f.yearBuilt);
      push("Lead status", f.leadStatus);
      push("Delivery method", f.deliveryMethod);
    }
    if (req.docType === "deviation_of_standard") {
      push("IICRC standard", f.iicrcStandard);
      push("Deviation category", f.deviationCategory);
      push("Standard requirement", f.standardRequirement);
      push("Proposed deviation", f.proposedDeviation);
      push("Reason", f.reasonForDeviation);
      push("Alternative method", f.alternativeMethod);
    }
    if (req.docType === "certificate_of_completion") {
      push("Work scope", f.workScope);
      push("Completion date", f.completionDate);
      push("Technician", f.techName);
    }
    return rows;
  }, [req]);

  const submit = async () => {
    if (!req) return;
    if (!signerName.trim()) return setError("Please type your full legal name.");
    if (!signatureDataUrl.startsWith("data:image/")) return setError("Please draw your signature above.");
    if (!agreed) return setError("Please confirm you have read and agree to sign.");
    setError(null);
    setState("signing");

    try {
      // Merge fresh signer name back into formData so the PDF reflects any
      // name correction the customer made on the sign page.
      const updatedFormData = { ...(req.formData || {}), signerName };
      const pdfDataUrl = await generatePdfForDocType(
        req.docType,
        updatedFormData,
        req.job || null,
        signerName,
        signatureDataUrl,
      );
      const res = await fetch(`/api/public/sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signerName,
          signerRole: req.recipientRole || "homeowner",
          signatureDataUrl,
          pdfDataUrl,
          updatedFormData,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setState("done");
    } catch (e: any) {
      setError(e?.message || "Failed to submit signature. Please try again.");
      setState("ready");
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F7F8FA] py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <header className="text-center mb-6">
          <h1 className="text-2xl font-bold text-[#0A2540]">Titan Restoration</h1>
          <p className="text-sm text-muted-foreground">Augusta, GA · (706) 922-0154 · titanaugusta.pro</p>
        </header>

        {state === "loading" && (
          <Card><CardContent className="p-8 text-center">
            <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading document…</p>
          </CardContent></Card>
        )}

        {state === "error" && (
          <Card className="border-red-300"><CardContent className="p-8 text-center space-y-2">
            <AlertTriangle className="w-8 h-8 mx-auto text-red-500" />
            <p className="font-medium">{error || "Something went wrong."}</p>
            <p className="text-sm text-muted-foreground">
              If you believe this is a mistake, contact Titan Restoration at (706) 922-0154.
            </p>
          </CardContent></Card>
        )}

        {state === "done" && (
          <Card className="border-emerald-300"><CardContent className="p-8 text-center space-y-3">
            <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500" />
            <h2 className="text-xl font-semibold">Thank you — your document is signed.</h2>
            <p className="text-sm text-muted-foreground">
              A copy has been saved to your Titan Restoration job file. You can close this window.
            </p>
          </CardContent></Card>
        )}

        {(state === "ready" || state === "signing") && req && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#0A2540]" />
                {req.title}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Please review the details below, type your full legal name, sign, and submit. This
                link expires on {new Date(req.expiresAt).toLocaleDateString()}.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Preview of what Titan filled in */}
              {summary && summary.length > 0 && (
                <div className="border rounded-lg bg-muted/30 divide-y">
                  {summary.map(([label, value]) => (
                    <div key={label} className="grid grid-cols-3 gap-2 px-3 py-2 text-sm">
                      <div className="text-muted-foreground">{label}</div>
                      <div className="col-span-2 font-medium break-words whitespace-pre-wrap">{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Full legal name */}
              <div>
                <Label className="text-sm">Type your full legal name</Label>
                <Input
                  className="mt-1"
                  value={signerName}
                  onChange={e => setSignerName(e.target.value)}
                  placeholder="Full legal name"
                  data-testid="input-public-sign-name"
                />
              </div>

              {/* Signature */}
              <div>
                <Label className="text-sm">Draw your signature</Label>
                <div className="mt-1">
                  <SignaturePad
                    onSign={setSignatureDataUrl}
                    onClear={() => setSignatureDataUrl("")}
                  />
                </div>
              </div>

              {/* Agreement */}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={agreed}
                  onChange={e => setAgreed(e.target.checked)}
                  data-testid="checkbox-public-sign-agree"
                />
                <span>
                  I confirm that I am the person named above, I have read this document, and I
                  intend the drawn signature to serve as my legally binding electronic signature.
                </span>
              </label>

              {error && (
                <div className="text-sm text-red-600 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> {error}
                </div>
              )}

              <Button
                className="w-full bg-[#0A2540] hover:bg-[#0A2540]/90 text-white h-11"
                onClick={submit}
                disabled={state === "signing"}
                data-testid="button-public-sign-submit"
              >
                {state === "signing" ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…</>
                ) : (
                  "Sign and submit"
                )}
              </Button>

              <p className="text-[11px] text-muted-foreground text-center">
                By clicking "Sign and submit" you agree that your electronic signature is the legal
                equivalent of your manual signature.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
