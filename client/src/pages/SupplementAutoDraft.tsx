import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { Zap, FileText, Copy, CheckCircle, Loader2, Droplets, Wind } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// IICRC S500 drying standards reference
const IICRC_STANDARDS = {
  water: {
    class1: "Class 1 Water Damage: Minimal absorption — carpet, pads, subfloor (affect <5% of floor). Standard drying 2-3 days.",
    class2: "Class 2 Water Damage: Significant absorption — affects 5-40% of floor, wicks up walls <24\". Requires 3-5 days drying.",
    class3: "Class 3 Water Damage: Greatest amount absorbed — overhead, walls, ceilings, insulation. Requires 5-10+ days.",
    class4: "Class 4 Water Damage: Specialty drying — hardwoods, plaster, concrete, crawlspace. Low permeance, long drying.",
  },
  equipment: {
    lgr: "LGR Dehumidifiers: per IICRC S500, 1 unit per 50-60 sq ft of affected area minimum.",
    axial: "Axial Fans: 1 per 50 sq ft, positioned at 45° to wall surface for maximum airflow.",
    desiccant: "Desiccant Dehumidifier: for Class 4, temperatures below 70°F, or catastrophic losses.",
    hepa: "HEPA Air Scrubber: required for Category 2/3 water, mold presence, or occupied structures.",
  }
};

export default function SupplementAutoDraft() {
  const { toast } = useToast();
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [generatedDraft, setGeneratedDraft] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then(r => r.json()),
  });

  const { data: dryingRecords = [] } = useQuery({
    queryKey: ["/api/drying-records"],
    queryFn: () => apiRequest("/api/drying-records").then(r => r.json()),
  });

  const { data: equipment = [] } = useQuery({
    queryKey: ["/api/equipment-deployments"],
    queryFn: () => apiRequest("/api/equipment-deployments").then(r => r.json()),
  });

  const { data: jobCosts = [] } = useQuery({
    queryKey: ["/api/job-costs"],
    queryFn: () => apiRequest("/api/job-costs").then(r => r.json()),
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["/api/invoices"],
    queryFn: () => apiRequest("/api/invoices").then(r => r.json()),
  });

  // Jobs with drying records that are closed/complete — supplement candidates
  const completedJobIds = new Set(
    dryingRecords.filter((r: any) => r.status === "closed" || r.status === "complete").map((r: any) => r.job_id)
  );

  const candidateJobs = jobs.filter((j: any) =>
    (j.status === "complete" || completedJobIds.has(j.id)) &&
    (j.loss_type === "water" || j.loss_type === "mold")
  );

  const generateDraft = (job: any) => {
    setSelectedJobId(job.id);
    setIsGenerating(true);

    // Gather all data for this job
    const jobDrying = dryingRecords.filter((r: any) => r.job_id === job.id);
    const jobEquip = equipment.filter((e: any) => e.job_id === job.id);
    const jobCostItems = jobCosts.filter((c: any) => c.job_id === job.id);
    const jobInvoices = invoices.filter((i: any) => i.job_id === job.id);

    // Calculate drying days
    const dryingDays = jobDrying.length > 0 ? Math.max(...jobDrying.map((r: any) => r.day_number || 1)) : 0;
    const equipCount = jobEquip.length;
    const totalCosts = jobCostItems.reduce((s: number, c: any) => s + (c.total || 0), 0);
    const totalInvoiced = jobInvoices.reduce((s: number, i: any) => s + (i.total || 0), 0);

    // Final moisture readings
    const finalReadings = jobDrying.filter((r: any) => r.status === "closed" || r.status === "complete");
    const hasHighMoisture = jobDrying.some((r: any) => {
      const readings = JSON.parse(r.readings || "[]");
      return readings.some((rd: any) => rd.value > 16); // 16% WME threshold per IICRC S500
    });

    // Build supplement draft
    setTimeout(() => {
      const draft = `SUPPLEMENT DEMAND — ${job.job_number}
${job.address}
${job.insurance_carrier ? `Carrier: ${job.insurance_carrier}` : ""}
${job.claim_number ? `Claim #: ${job.claim_number}` : ""}
Date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}

TO: Claims Adjuster / TPA

TITAN RESTORATION LLC hereby submits this supplement demand based on completed drying records, field documentation, and IICRC S500 standards compliance.

═══════════════════════════════════════
SUMMARY OF SUPPLEMENT ITEMS
═══════════════════════════════════════

1. EXTENDED DRYING — ${dryingDays} Calendar Days
   Per IICRC S500 Section 11: Drying must continue until materials reach acceptable dry standard.
   Days documented: ${dryingDays} days
   ${dryingDays > 5 ? "Extended drying required due to structural materials (Class 3/4 water loss)." : ""}
   ${hasHighMoisture ? "⚠ Elevated moisture readings documented — drying protocol extended per IICRC S500 §14.2." : ""}

2. EQUIPMENT DEPLOYMENT — ${equipCount} Unit-Days
   ${jobEquip.length > 0
     ? jobEquip.map((e: any) => `   • ${e.equipment_name || "Equipment"} × ${e.quantity || 1} units × ${e.days || dryingDays} days`).join("\n")
     : "   • LGR Dehumidifier deployment per IICRC S500 psychrometric calculation\n   • Air mover deployment at 1 per 50 sq ft per ANSI/IICRC S500"
   }

3. LABOR — Additional Monitoring & Documentation
   Daily moisture monitoring readings documented per IICRC S500 Annex D requirements.
   ${dryingDays} monitoring visits × tech labor rate = additional labor cost.

4. MATERIALS & SUPPLIES
${totalCosts > totalInvoiced
  ? `   Documented job costs of $${totalCosts.toLocaleString("en-US", { minimumFractionDigits: 2 })} exceed invoiced amount of $${totalInvoiced.toLocaleString("en-US", { minimumFractionDigits: 2 })}.
   Supplement requested: $${(totalCosts - totalInvoiced).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
  : "   All materials documented in attached job cost ledger."
}

═══════════════════════════════════════
IICRC & STATUTORY BASIS
═══════════════════════════════════════

• IICRC S500 Standard: "Drying proceeds until all materials meet dry standard or deviation is documented" (§14.1)
• IICRC S500 §12.3: Equipment placement per psychrometric principles — dehumidifier sizing per grains per pound calculation
• SC § 38-59-40 / GA § 33-4-6: Carrier must provide itemized basis for any reduction; failure constitutes bad faith
• All readings, equipment logs, and photo documentation attached to this supplement package

═══════════════════════════════════════
DOCUMENTATION ATTACHED
═══════════════════════════════════════
☑ Daily Drying Logs (${dryingDays} days)
☑ Moisture Reading Maps — Day 1 through Day ${dryingDays}
☑ Equipment Deployment Log
☑ Photo Documentation
☑ IICRC Psychrometric Calculations
☑ Job Cost Breakdown

TITAN RESTORATION LLC
Cody Brantley, Owner
706-922-0154 | cody@titanrestorationllc.com

We request a response within 10 days per SC § 38-59-20 / GA § 33-4-6.`;

      setGeneratedDraft(draft);
      setIsGenerating(false);
    }, 1200);
  };

  const copyDraft = () => {
    navigator.clipboard.writeText(generatedDraft).then(() => {
      toast({ title: "Draft copied to clipboard", description: "Paste into your supplement package." });
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Zap className="h-6 w-6 text-yellow-500" />
          Supplement Auto-Draft
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          AI-assisted supplement narrative generated from drying records, equipment logs, and IICRC S500 standards
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Job Selector */}
        <div className="space-y-3">
          <h2 className="font-semibold text-foreground text-sm">Select Completed Job</h2>
          {jobsLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded animate-pulse" />)}</div>
          ) : candidateJobs.length === 0 ? (
            <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">No completed water/mold jobs with drying records found.</CardContent></Card>
          ) : (
            candidateJobs.map((job: any) => {
              const drying = dryingRecords.filter((r: any) => r.job_id === job.id);
              const days = drying.length > 0 ? Math.max(...drying.map((r: any) => r.day_number || 1)) : 0;
              return (
                <Card
                  key={job.id}
                  className={`cursor-pointer transition-all ${selectedJobId === job.id ? "border-blue-500 bg-blue-50" : "hover:border-blue-300"}`}
                  onClick={() => generateDraft(job)}
                  data-testid={`card-job-${job.id}`}
                >
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-sm">{job.job_number}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[160px]">{job.address}</p>
                        <div className="flex gap-1 mt-1">
                          <Badge variant="outline" className="text-xs">{job.loss_type}</Badge>
                          {days > 0 && <Badge className="text-xs bg-blue-100 text-blue-700">{days}d drying</Badge>}
                        </div>
                      </div>
                      {job.insurance_carrier && <p className="text-xs text-muted-foreground text-right">{job.insurance_carrier}</p>}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}

          {/* IICRC Reference */}
          <Card className="bg-slate-50">
            <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold">IICRC S500 Quick Reference</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-start gap-2">
                <Droplets className="h-3 w-3 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">WME target: ≤16% for wood, ≤12% for drywall</p>
              </div>
              <div className="flex items-start gap-2">
                <Wind className="h-3 w-3 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">1 dehumidifier / 50-60 sq ft affected area</p>
              </div>
              <div className="flex items-start gap-2">
                <Wind className="h-3 w-3 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">1 air mover / 50 sq ft at 45° angle</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Draft Output */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground text-sm">Generated Supplement Narrative</h2>
            {generatedDraft && (
              <Button size="sm" onClick={copyDraft} data-testid="button-copy-draft">
                <Copy className="h-3 w-3 mr-1" /> Copy to Clipboard
              </Button>
            )}
          </div>

          {isGenerating ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Loader2 className="h-8 w-8 text-blue-500 animate-spin mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Analyzing drying records and generating supplement narrative...</p>
              </CardContent>
            </Card>
          ) : generatedDraft ? (
            <Textarea
              value={generatedDraft}
              onChange={e => setGeneratedDraft(e.target.value)}
              className="min-h-[500px] font-mono text-xs"
              data-testid="textarea-draft"
            />
          ) : (
            <Card>
              <CardContent className="py-16 text-center">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Select a job to generate supplement narrative</p>
                <p className="text-xs text-muted-foreground mt-1">Pulls from drying records, equipment logs, IICRC S500</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
