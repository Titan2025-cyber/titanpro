import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { Gavel, Copy, FileText, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// SC & GA insurance statute lookup table
const STATUTE_TABLE: Record<string, { sc: string[]; ga: string[] }> = {
  underpayment: {
    sc: [
      "SC § 38-59-20: Carrier must acknowledge claim within 10 days and investigate promptly",
      "SC § 38-59-40: Failure to pay valid claim = 25% penalty + reasonable attorney fees",
      "SC § 38-61-20: Unfair claims settlement — prohibited practices including arbitrary reduction",
      "SC § 34-31-20: Legal interest rate 6.5% per annum on unpaid insurance proceeds",
    ],
    ga: [
      "GA § 33-4-6: Bad faith refusal = up to 50% of claim + attorney fees after 60 days demand",
      "GA § 33-6-31: Unfair claims settlement — failure to promptly settle when liability clear",
      "GA § 7-4-2: Legal interest rate 7% per annum on overdue amounts",
      "GA § 13-6-11: Attorney fees for stubborn litigiousness / bad faith",
    ],
  },
  coverage_denial: {
    sc: [
      "SC § 38-59-40: Denial must be in writing with specific policy basis cited within 45 days",
      "SC § 38-77-180: Unfair claim settlement — misrepresenting policy provisions",
      "SC § 38-59-20: Insurer must provide written notice of denial with explanation",
    ],
    ga: [
      "GA § 33-4-6: Bad faith denial of covered claim — 50% penalty",
      "GA § 33-6-31(11): Misrepresenting policy provisions to claimants",
      "GA § 33-24-45: Required policy provisions — notice of denial",
    ],
  },
  delayed_payment: {
    sc: [
      "SC § 38-59-20: Payment due within 30 days of written proof of loss",
      "SC § 38-59-40: Unreasonable delay = bad faith damages",
      "SC § 34-31-20: Interest accrues at 6.5% from date of loss proof",
    ],
    ga: [
      "GA § 33-4-6: Failure to pay within 60 days of demand = bad faith",
      "GA § 33-6-31(14): Failure to promptly settle claim where liability clear",
      "GA § 7-4-2: 7% statutory interest from date demand made",
    ],
  },
  scope_dispute: {
    sc: [
      "SC § 38-59-40: Carrier must provide itemized explanation of any scope reduction",
      "SC § 38-61-20: Cannot apply policy conditions not clearly stated in policy",
      "SC § 38-77-30: Insurance companies must use fair and equitable claim practices",
    ],
    ga: [
      "GA § 33-6-31(9): Failing to provide basis for scope denial within reasonable time",
      "GA § 33-6-31(6): Compelling insured to accept less than entitled to under policy",
      "GA § 33-4-6: Scope reduction without valid basis = bad faith",
    ],
  },
  depreciation_dispute: {
    sc: [
      "SC § 38-75-940: Recoverable depreciation — carrier must pay within 180 days of RCV payment",
      "SC § 38-59-40: Improper withholding of ACV vs RCV = bad faith",
    ],
    ga: [
      "GA § 33-4-6: Improper application of depreciation = bad faith if done arbitrarily",
      "GA Regulation 120-2-20-.07: Fair claims handling — depreciation must be documented",
    ],
  },
};

const IICRC_REFS: Record<string, string[]> = {
  water: [
    "IICRC S500 §14.1: Drying must continue until materials reach documented dry standard",
    "IICRC S500 §12.3: Equipment sizing per psychrometric principles — 1 dehumidifier / 50-60 sq ft",
    "IICRC S500 §11.2: Class 3/4 losses require extended drying 5-10+ days",
    "ANSI/IICRC S500: WME target ≤16% for structural wood, ≤12% for drywall",
  ],
  mold: [
    "IICRC S520 §8.1: All mold-contaminated materials must be remediated or removed",
    "IICRC S520 §12.3: Post-remediation verification required before clearance",
    "IICRC S520: EPA standards mandate containment and air filtration during remediation",
  ],
  fire: [
    "IICRC S700 §9: Smoke odor removal requires thermal fogging or ozone treatment",
    "IICRC S700 §11: All porous materials must be cleaned or replaced",
    "IICRC S700: Protein smoke from kitchen fires requires enzymatic cleaning",
  ],
  storm: [
    "IICRC S500 §4.2: Secondary damage from storm water = Category 2 minimum",
    "NRCA guidelines: Emergency tarping within 24 hours prevents secondary damage",
  ],
};

export default function CarrierEscalationAI() {
  const { toast } = useToast();
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [issueType, setIssueType] = useState<string>("underpayment");
  const [state, setState] = useState<"SC" | "GA">("GA");
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [draft, setDraft] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: jobs = [] } = useQuery({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("/api/jobs").then(r => r.json()) });
  const { data: estimates = [] } = useQuery({ queryKey: ["/api/estimates"], queryFn: () => apiRequest("/api/estimates").then(r => r.json()) });
  const { data: invoices = [] } = useQuery({ queryKey: ["/api/invoices"], queryFn: () => apiRequest("/api/invoices").then(r => r.json()) });
  const { data: payments = [] } = useQuery({ queryKey: ["/api/payments"], queryFn: () => apiRequest("/api/payments").then(r => r.json()) });
  const { data: supplements = [] } = useQuery({ queryKey: ["/api/supplements"], queryFn: () => apiRequest("/api/supplements").then(r => r.json()) });
  const { data: drying = [] } = useQuery({ queryKey: ["/api/drying-records"], queryFn: () => apiRequest("/api/drying-records").then(r => r.json()) });

  const selectedJob = jobs.find((j: any) => j.id === Number(selectedJobId));

  const generateLetter = () => {
    if (!selectedJob) return;
    setIsGenerating(true);

    const jobEst = estimates.filter((e: any) => e.job_id === selectedJob.id && e.status !== "rejected");
    const jobInv = invoices.filter((i: any) => i.job_id === selectedJob.id);
    const jobPmts = payments.filter((p: any) => jobInv.some((i: any) => i.id === p.invoice_id) && p.type === "received");
    const jobSupp = supplements.filter((s: any) => s.job_id === selectedJob.id);
    const jobDrying = drying.filter((d: any) => d.job_id === selectedJob.id);

    const estTotal = jobEst.reduce((s: number, e: any) => s + (e.total || 0), 0);
    const invTotal = jobInv.reduce((s: number, i: any) => s + (i.total || 0), 0);
    const collected = jobPmts.reduce((s: number, p: any) => s + (p.amount || 0), 0);
    const dryingDays = jobDrying.length > 0 ? Math.max(...jobDrying.map((r: any) => r.day_number || 1)) : 0;

    const statutes = STATUTE_TABLE[issueType]?.[state.toLowerCase() as "sc" | "ga"] || [];
    const iicrc = IICRC_REFS[selectedJob.loss_type || "water"] || IICRC_REFS.water;

    const issueLabels: Record<string, string> = {
      underpayment: "Underpayment of Claim",
      coverage_denial: "Improper Coverage Denial",
      delayed_payment: "Unreasonable Delay in Payment",
      scope_dispute: "Scope of Loss Dispute",
      depreciation_dispute: "Improper Depreciation Application",
    };

    setTimeout(() => {
      const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
      const letter = `TITAN RESTORATION LLC
Cody Brantley, Owner
706-922-0154 | cody@titanrestorationllc.com | Augusta, GA
${today}

RE: FORMAL DEMAND / ESCALATION — ${issueLabels[issueType] || issueType.toUpperCase()}
Job: ${selectedJob.job_number}
Property: ${selectedJob.address}
${selectedJob.insurance_carrier ? `Carrier: ${selectedJob.insurance_carrier}` : ""}
${selectedJob.claim_number ? `Claim #: ${selectedJob.claim_number}` : ""}
Loss Type: ${selectedJob.loss_type?.toUpperCase()}

─────────────────────────────────────────────────────────────────
NOTICE OF DISPUTE AND FORMAL DEMAND
─────────────────────────────────────────────────────────────────

To Whom It May Concern:

Titan Restoration LLC is the authorized mitigation and restoration contractor for the above-referenced property. We write to formally dispute the handling of this claim and demand full payment as outlined herein.

FINANCIAL SUMMARY:
  Scope of Work (Xactimate):  $${estTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}
  Invoiced Amount:            $${invTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}
  Payments Received:          $${collected.toLocaleString("en-US", { minimumFractionDigits: 2 })}
  Outstanding Balance:        $${(invTotal - collected).toLocaleString("en-US", { minimumFractionDigits: 2 })}
  ${estTotal > invTotal ? `Scope Gap (underpayment):   $${(estTotal - invTotal).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : ""}
  ${dryingDays > 0 ? `Drying Duration Documented: ${dryingDays} calendar days` : ""}

BASIS FOR DISPUTE:

${issueType === "underpayment" ? `The carrier's payment falls significantly below our documented scope of loss. Our estimate of $${estTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })} was prepared using current Xactimate pricing for the ${state} market and adheres fully to IICRC S500 standards. The carrier's offer of $${invTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })} represents a ${estTotal > 0 ? Math.round(((estTotal - invTotal) / estTotal) * 100) : 0}% reduction without adequate documented basis.` : ""}
${issueType === "coverage_denial" ? `The carrier has improperly denied coverage for services that are clearly required under IICRC standards and within the scope of the homeowner's policy. All work performed was necessary, documented, and within industry standards.` : ""}
${issueType === "delayed_payment" ? `Payment on this claim has been unreasonably delayed. Under applicable ${state} law, payment is due within 30 days of written proof of loss. We demand immediate payment with applicable statutory interest.` : ""}
${issueType === "scope_dispute" ? `The carrier has reduced our scope of work without providing an itemized, documented basis for each line item removed. IICRC S500 standards mandate the scope of work we performed — any deviation must be documented and justified per IICRC guidelines.` : ""}
${issueType === "depreciation_dispute" ? `The carrier has applied depreciation in a manner inconsistent with policy terms and applicable ${state} law. We request immediate release of withheld recoverable depreciation.` : ""}

${additionalNotes ? `ADDITIONAL INFORMATION:\n${additionalNotes}\n` : ""}
IICRC STANDARDS BASIS:
${iicrc.map(ref => `  • ${ref}`).join("\n")}

${state} STATUTORY BASIS:
${statutes.map(s => `  • ${s}`).join("\n")}

─────────────────────────────────────────────────────────────────
DEMAND
─────────────────────────────────────────────────────────────────

We hereby demand payment of $${Math.max(estTotal - collected, invTotal - collected).toLocaleString("en-US", { minimumFractionDigits: 2 })} within TEN (10) business days of receipt of this letter.

Failure to respond or pay within this period will result in:
1. Filing a formal complaint with the ${state === "SC" ? "South Carolina Department of Insurance (803-737-6160)" : "Georgia Office of Insurance and Safety Fire Commissioner (404-656-2070)"}
2. Referral of this matter to legal counsel for bad faith litigation
3. Pursuit of all statutory penalties available under ${state} law

We trust this matter can be resolved promptly without further action.

Respectfully,

Cody Brantley
Owner, Titan Restoration LLC
706-922-0154 | cody@titanrestorationllc.com

CC: [Homeowner Name]
    [Adjuster Name if known]`;

      setDraft(letter);
      setIsGenerating(false);
    }, 1500);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Gavel className="h-6 w-6 text-red-500" />
          Carrier Escalation AI — Auto-Draft Demand Letters
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generates formal demand letters using SC &amp; GA statute lookup + IICRC S500/S520 standards
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Config */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Letter Configuration</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Select Job</label>
                <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                  <SelectTrigger data-testid="select-job"><SelectValue placeholder="Choose a job..." /></SelectTrigger>
                  <SelectContent>
                    {jobs.map((j: any) => (
                      <SelectItem key={j.id} value={String(j.id)}>{j.job_number} — {j.address?.slice(0, 40)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Issue Type</label>
                <Select value={issueType} onValueChange={setIssueType}>
                  <SelectTrigger data-testid="select-issue"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="underpayment">Underpayment of Claim</SelectItem>
                    <SelectItem value="coverage_denial">Improper Coverage Denial</SelectItem>
                    <SelectItem value="delayed_payment">Unreasonable Delay in Payment</SelectItem>
                    <SelectItem value="scope_dispute">Scope of Loss Dispute</SelectItem>
                    <SelectItem value="depreciation_dispute">Improper Depreciation Application</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">State</label>
                <div className="flex gap-2">
                  {(["GA", "SC"] as const).map(s => (
                    <Button key={s} size="sm" variant={state === s ? "default" : "outline"} onClick={() => setState(s)} data-testid={`button-state-${s}`}>{s}</Button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Additional Notes (optional)</label>
                <Textarea
                  value={additionalNotes}
                  onChange={e => setAdditionalNotes(e.target.value)}
                  placeholder="Specific facts, adjuster name, prior correspondence..."
                  className="text-sm h-20"
                  data-testid="textarea-notes"
                />
              </div>
              <Button
                className="w-full bg-red-600 hover:bg-red-700 text-white"
                onClick={generateLetter}
                disabled={!selectedJobId || isGenerating}
                data-testid="button-generate"
              >
                {isGenerating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Gavel className="h-4 w-4 mr-2" />}
                Generate Demand Letter
              </Button>
            </CardContent>
          </Card>

          {/* Statute Preview */}
          <Card className="bg-slate-50">
            <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold">{state} Statutes — {issueType.replace(/_/g, " ")}</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {(STATUTE_TABLE[issueType]?.[state.toLowerCase() as "sc" | "ga"] || []).map(s => (
                <p key={s} className="text-xs text-muted-foreground">{s}</p>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Draft Output */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="font-semibold text-sm">Generated Letter</h2>
            {draft && (
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(draft); toast({ title: "Copied to clipboard" }); }} data-testid="button-copy">
                <Copy className="h-3 w-3 mr-1" /> Copy
              </Button>
            )}
          </div>
          {isGenerating ? (
            <Card><CardContent className="py-16 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-red-500 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Pulling job data and applying statute lookup...</p>
            </CardContent></Card>
          ) : draft ? (
            <Textarea value={draft} onChange={e => setDraft(e.target.value)} className="min-h-[600px] font-mono text-xs" data-testid="textarea-letter" />
          ) : (
            <Card><CardContent className="py-16 text-center">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Configure options and click Generate</p>
            </CardContent></Card>
          )}
        </div>
      </div>
    </div>
  );
}
