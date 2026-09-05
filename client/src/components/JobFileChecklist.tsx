import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, XCircle, AlertCircle, ShieldCheck, Loader2,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// JobFileChecklist — per-job completeness gate embedded in JobDetail.
//
// Cody: "the file checker should work inside job detail on each individual
// job so someone can very quickly tell if something is missing."
//
// Uses per-job endpoints only (no global fetches) so this loads fast even
// on a job with hundreds of siblings in the database. Result is a single
// score + a list showing what's present, what's optional-but-missing, and
// what's REQUIRED-and-missing so the operator can fix it inline.
// ─────────────────────────────────────────────────────────────────────────────

type CheckItem = {
  key: string;
  label: string;
  weight: number;
  required: boolean;
  passed: boolean;
  hint?: string;
};

const REQUIRED_SCORE = 75;

export default function JobFileChecklist({ job }: { job: any }) {
  const jobId = job?.id;

  // Fire the six per-job list queries in parallel. Each returns [] until it
  // arrives so the checklist can render immediately with progressive fills.
  const estimates = useQuery<any[]>({
    queryKey: ["/api/jobs", jobId, "estimates"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/estimates`).then(r => r.json()),
    enabled: !!jobId,
  });
  const invoices = useQuery<any[]>({
    queryKey: ["/api/jobs", jobId, "invoices"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/invoices`).then(r => r.json()),
    enabled: !!jobId,
  });
  const photos = useQuery<any[]>({
    queryKey: ["/api/jobs", jobId, "photos"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/photos`).then(r => r.json()),
    enabled: !!jobId,
  });
  const drying = useQuery<any[]>({
    queryKey: ["/api/jobs", jobId, "drying-records"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/drying-records`).then(r => r.json()),
    enabled: !!jobId,
  });
  const documents = useQuery<any[]>({
    queryKey: ["/api/jobs", jobId, "documents"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/documents`).then(r => r.json()),
    enabled: !!jobId,
  });
  // Job-costs, follow-ups, and supplements only have global endpoints. Filter
  // client-side. These are small tables so the load is fine.
  const allCosts = useQuery<any[]>({
    queryKey: ["/api/job-costs"],
    queryFn: () => apiRequest("GET", "/api/job-costs").then(r => r.json()),
    enabled: !!jobId,
  });
  const allFollowUps = useQuery<any[]>({
    queryKey: ["/api/follow-ups"],
    queryFn: () => apiRequest("GET", "/api/follow-ups").then(r => r.json()),
    enabled: !!jobId,
  });
  const allSupplements = useQuery<any[]>({
    queryKey: ["/api/supplements"],
    queryFn: () => apiRequest("GET", "/api/supplements").then(r => r.json()),
    enabled: !!jobId,
  });

  const loading =
    estimates.isLoading || invoices.isLoading || photos.isLoading ||
    drying.isLoading || documents.isLoading || allCosts.isLoading ||
    allFollowUps.isLoading || allSupplements.isLoading;

  if (!jobId) return null;

  // Belt-and-braces id matching: raw SELECT * endpoints emit snake_case
  // (job_id) while Drizzle-typed endpoints emit camelCase (jobId). Match
  // either one so a schema change doesn't quietly break the checker.
  const matchesJob = (row: any) => {
    const rid = row?.job_id ?? row?.jobId;
    return Number(rid) === Number(jobId);
  };

  const jobCosts = (allCosts.data || []).filter(matchesJob);
  const jobFollowUps = (allFollowUps.data || []).filter(matchesJob);
  const jobSupplements = (allSupplements.data || []).filter(matchesJob);
  const jobPhotos = photos.data || [];
  const jobEstimates = estimates.data || [];
  const jobInvoices = invoices.data || [];
  const jobDrying = drying.data || [];
  const jobDocs = documents.data || [];

  // Work-authorization detection: any doc whose type or name contains
  // "work"/"auth" — matches Work Auth, Authorization, Work Order, etc.
  const workAuth = jobDocs.some((d: any) => {
    const s = `${d.documentType || d.document_type || ""} ${d.fileName || d.file_name || d.name || ""}`.toLowerCase();
    return /work|author/.test(s);
  });

  // Signed estimate detection: at least one estimate marked signed.
  const signedEstimate = jobEstimates.some((e: any) => !!(e.signedAt || e.signed_at));

  // Build the checklist. Same weights & spirit as the retired standalone
  // page — but adapted to the real camelCase field names on jobs.
  const checks: CheckItem[] = [
    { key: "address",     label: "Address entered",                   weight: 8,  required: true,  passed: !!(job.address),
      hint: "Fill the Job Address on the Insurance/Location panel." },
    { key: "lossType",    label: "Loss type specified",               weight: 6,  required: true,  passed: !!(job.lossType),
      hint: "Set Loss Type on the Insurance tab (water, fire, mold...)." },
    { key: "carrier",     label: "Insurance carrier assigned",        weight: 6,  required: true,  passed: !!(job.insuranceCarrier),
      hint: "Insurance tab · Carrier." },
    { key: "claim",       label: "Claim number on file",              weight: 6,  required: true,  passed: !!(job.claimNumber),
      hint: "Insurance tab · Claim #." },
    { key: "contact",     label: "Contact linked to job",             weight: 6,  required: true,  passed: !!(job.contactId),
      hint: "Every job needs a homeowner / policyholder contact." },
    { key: "estimate",    label: "Estimate created",                  weight: 10, required: true,  passed: jobEstimates.length > 0,
      hint: "Estimates tab · New Estimate." },
    { key: "signedEst",   label: "Estimate signed by customer",       weight: 8,  required: false, passed: signedEstimate,
      hint: "Send the estimate for e-sign from the Estimates tab." },
    { key: "workAuth",    label: "Work authorization on file",        weight: 8,  required: true,  passed: workAuth,
      hint: "Upload the signed Work Auth to Documents." },
    { key: "photos",      label: "At least 10 photos uploaded",       weight: 8,  required: true,  passed: jobPhotos.length >= 10,
      hint: `${jobPhotos.length} uploaded — carriers usually want 10+.` },
    { key: "drying",      label: "Drying records documented",         weight: 6,  required: false, passed: jobDrying.length > 0,
      hint: "Mitigation tab — daily moisture readings." },
    { key: "invoice",     label: "Invoice generated",                 weight: 8,  required: true,  passed: jobInvoices.length > 0,
      hint: "Invoices tab · New Invoice." },
    { key: "costs",       label: "Job costs recorded",                weight: 5,  required: false, passed: jobCosts.length > 0,
      hint: "Job Costing tab — labor, materials, subs." },
    { key: "supplement",  label: "Supplements filed (if applicable)", weight: 3,  required: false, passed: jobSupplements.length > 0 },
    { key: "followup",    label: "Follow-up logged",                  weight: 3,  required: false, passed: jobFollowUps.length > 0,
      hint: "Set a follow-up date so nothing falls through the cracks." },
  ];

  const total = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.filter(c => c.passed).reduce((s, c) => s + c.weight, 0);
  const score = Math.round((earned / total) * 100);
  const missingRequired = checks.filter(c => c.required && !c.passed);
  const missingOptional = checks.filter(c => !c.required && !c.passed);
  const ready = score >= REQUIRED_SCORE && missingRequired.length === 0;

  const scoreColor = score >= 90 ? "text-green-600 dark:text-green-400"
    : score >= 75 ? "text-blue-600 dark:text-blue-400"
    : score >= 50 ? "text-amber-600 dark:text-amber-400"
    : "text-red-600 dark:text-red-400";
  const barTint = score >= 90 ? "border-green-400 bg-green-50 dark:bg-green-950/30"
    : score >= 75 ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30"
    : score >= 50 ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30"
    : "border-red-400 bg-red-50 dark:bg-red-950/30";

  return (
    <div className="space-y-3">
      {/* ─── Score banner ─── */}
      <Card className={barTint}>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-6 h-6 text-[hsl(var(--titan-blue))]" />
              <div>
                <div className="font-semibold text-sm">Claim File Completeness</div>
                <div className="text-xs text-muted-foreground">
                  {loading ? "Checking…" : ready
                    ? "File is complete — ready to send to carrier / advance to billing."
                    : `${missingRequired.length} required item${missingRequired.length === 1 ? "" : "s"} missing`}
                </div>
              </div>
            </div>
            <div className="text-center min-w-[80px]">
              <div className={`text-3xl font-bold ${scoreColor}`}>{loading ? <Loader2 className="w-6 h-6 animate-spin inline" /> : `${score}%`}</div>
              <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Score</div>
            </div>
          </div>
          <Progress value={score} className="h-2 mt-3" />
        </CardContent>
      </Card>

      {/* ─── Required-missing (top of mind) ─── */}
      {!loading && missingRequired.length > 0 && (
        <Card className="border-red-300 bg-red-50/50 dark:bg-red-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> Required — fix before billing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-0">
            {missingRequired.map(c => (
              <div key={c.key} className="flex items-start gap-2 text-sm">
                <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">{c.label}</div>
                  {c.hint && <div className="text-xs text-muted-foreground">{c.hint}</div>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ─── Full checklist (compact grid) ─── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center justify-between">
            <span>Full Checklist</span>
            <span className="text-xs font-normal text-muted-foreground">
              {checks.filter(c => c.passed).length} / {checks.length} complete
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-1.5 pt-0">
          {checks.map(c => (
            <div
              key={c.key}
              className={`flex items-center gap-2 p-2 rounded text-sm ${
                c.passed
                  ? "bg-green-50 dark:bg-green-950/30"
                  : c.required
                    ? "bg-red-50 dark:bg-red-950/20"
                    : "bg-muted/40"
              }`}
              data-testid={`filecheck-${c.key}`}
            >
              {c.passed
                ? <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
                : c.required
                  ? <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  : <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />}
              <span className={`flex-1 truncate ${!c.passed && c.required ? "font-semibold" : ""}`}>{c.label}</span>
              {c.required && !c.passed && (
                <Badge variant="outline" className="text-[9px] h-4 px-1 border-red-300 text-red-600">req</Badge>
              )}
              <span className="text-[10px] text-muted-foreground shrink-0">{c.weight}pt</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ─── Optional-missing (nice-to-haves) ─── */}
      {!loading && missingOptional.length > 0 && (
        <div className="text-xs text-muted-foreground px-1">
          Optional gaps: {missingOptional.map(c => c.label).join(" · ")}
        </div>
      )}
    </div>
  );
}
