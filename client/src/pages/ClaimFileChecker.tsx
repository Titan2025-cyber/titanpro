import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, XCircle, AlertCircle, ShieldCheck, FileText, Camera, DollarSign } from "lucide-react";
import { useState } from "react";

interface CheckItem { label: string; key: string; weight: number; required: boolean; }

const CHECKLIST_ITEMS: CheckItem[] = [
  { label: "Job address entered", key: "address", weight: 10, required: true },
  { label: "Loss type specified", key: "loss_type", weight: 8, required: true },
  { label: "Insurance carrier assigned", key: "insurance_carrier", weight: 8, required: true },
  { label: "Claim number on file", key: "claim_number", weight: 7, required: true },
  { label: "Contact linked to job", key: "contact_id", weight: 7, required: true },
  { label: "Estimate created", key: "has_estimate", weight: 10, required: true },
  { label: "At least 10 photos uploaded", key: "has_photos", weight: 10, required: true },
  { label: "Drying records completed", key: "has_drying", weight: 8, required: false },
  { label: "Invoice generated", key: "has_invoice", weight: 8, required: true },
  { label: "Work authorization signed", key: "has_work_auth", weight: 8, required: true },
  { label: "Job costs documented", key: "has_costs", weight: 6, required: false },
  { label: "Supplements filed (if applicable)", key: "has_supplement", weight: 5, required: false },
  { label: "Follow-up logged", key: "has_followup", weight: 5, required: false },
];

const REQUIRED_SCORE = 75;

export default function ClaimFileChecker() {
  const [selectedJob, setSelectedJob] = useState<any>(null);

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then(r => r.json()),
    select: (d: any[]) => d.filter((j: any) => !["complete","closed"].includes(j.status)),
  });
  const { data: estimates = [] } = useQuery({ queryKey: ["/api/estimates"], queryFn: () => apiRequest("/api/estimates").then(r => r.json()) });
  const { data: invoices = [] } = useQuery({ queryKey: ["/api/invoices"], queryFn: () => apiRequest("/api/invoices").then(r => r.json()) });
  const { data: photos = [] } = useQuery({ queryKey: ["/api/photos"], queryFn: () => apiRequest("/api/photos").then(r => r.json()) });
  const { data: drying = [] } = useQuery({ queryKey: ["/api/drying-records"], queryFn: () => apiRequest("/api/drying-records").then(r => r.json()) });
  const { data: costs = [] } = useQuery({ queryKey: ["/api/job-costs"], queryFn: () => apiRequest("/api/job-costs").then(r => r.json()) });
  const { data: supplements = [] } = useQuery({ queryKey: ["/api/supplements"], queryFn: () => apiRequest("/api/supplements").then(r => r.json()) });
  const { data: followups = [] } = useQuery({ queryKey: ["/api/follow-ups"], queryFn: () => apiRequest("/api/follow-ups").then(r => r.json()) });
  const { data: docs = [] } = useQuery({ queryKey: ["/api/job-documents"], queryFn: () => apiRequest("/api/job-documents").then(r => r.json()) });

  const getChecks = (job: any) => {
    if (!job) return [];
    const jobPhotos = photos.filter((p: any) => p.job_id === job.id);
    const jobDocs = docs.filter((d: any) => d.job_id === job.id);
    const workAuth = jobDocs.some((d: any) => (d.document_type || "").toLowerCase().includes("work") || (d.document_type || "").toLowerCase().includes("auth"));

    const values: Record<string, boolean> = {
      address: !!job.address,
      loss_type: !!job.loss_type,
      insurance_carrier: !!job.insurance_carrier,
      claim_number: !!job.claim_number,
      contact_id: !!job.contact_id,
      has_estimate: estimates.some((e: any) => e.job_id === job.id),
      has_photos: jobPhotos.length >= 10,
      has_drying: drying.some((d: any) => d.job_id === job.id),
      has_invoice: invoices.some((i: any) => i.job_id === job.id),
      has_work_auth: workAuth,
      has_costs: costs.some((c: any) => c.job_id === job.id),
      has_supplement: supplements.some((s: any) => s.job_id === job.id),
      has_followup: followups.some((f: any) => f.job_id === job.id),
    };
    return CHECKLIST_ITEMS.map(item => ({ ...item, passed: values[item.key] ?? false }));
  };

  const getScore = (checks: any[]) => {
    const total = checks.reduce((s, c) => s + c.weight, 0);
    const earned = checks.filter(c => c.passed).reduce((s: number, c: any) => s + c.weight, 0);
    return Math.round((earned / total) * 100);
  };

  const checks = getChecks(selectedJob);
  const score = getScore(checks);
  const missingRequired = checks.filter(c => c.required && !c.passed);
  const canEscalate = score >= REQUIRED_SCORE && missingRequired.length === 0;

  const getScoreColor = (s: number) => s >= 90 ? "text-green-600" : s >= 75 ? "text-blue-600" : s >= 50 ? "text-yellow-600" : "text-red-600";
  const getBarColor = (s: number) => s >= 90 ? "bg-green-500" : s >= 75 ? "bg-blue-500" : s >= 50 ? "bg-yellow-500" : "bg-red-500";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-blue-500" />
          AI Claim File Completeness Checker
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pipeline gate — ensures claim files are complete before advancing to Invoice Pending
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Job List */}
        <div className="space-y-2">
          <h2 className="font-semibold text-sm">Active Jobs</h2>
          {isLoading ? (
            <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-14 bg-muted rounded animate-pulse" />)}</div>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active jobs found</p>
          ) : (
            jobs.map((job: any) => {
              const jChecks = getChecks(job);
              const jScore = getScore(jChecks);
              const jMissing = jChecks.filter((c: any) => c.required && !c.passed).length;
              return (
                <Card
                  key={job.id}
                  className={`cursor-pointer transition-all ${selectedJob?.id === job.id ? "border-blue-500 bg-blue-50" : "hover:border-blue-300"}`}
                  onClick={() => setSelectedJob(job)}
                  data-testid={`card-job-${job.id}`}
                >
                  <CardContent className="pt-3 pb-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-sm">{job.job_number}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[150px]">{job.address}</p>
                      </div>
                      <div className="text-right">
                        <span className={`font-bold text-sm ${getScoreColor(jScore)}`}>{jScore}%</span>
                        {jMissing > 0 && <p className="text-xs text-red-500">{jMissing} required missing</p>}
                      </div>
                    </div>
                    <Progress value={jScore} className={`h-1 mt-2`} />
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Checklist Detail */}
        <div className="lg:col-span-2 space-y-4">
          {!selectedJob ? (
            <Card><CardContent className="py-16 text-center">
              <ShieldCheck className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Select a job to run the completeness check</p>
            </CardContent></Card>
          ) : (
            <>
              {/* Score Card */}
              <Card className={canEscalate ? "border-green-400 bg-green-50" : score >= 50 ? "border-yellow-400 bg-yellow-50" : "border-red-400 bg-red-50"}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-lg">{selectedJob.job_number}</p>
                      <p className="text-sm text-muted-foreground">{selectedJob.address}</p>
                    </div>
                    <div className="text-center">
                      <p className={`text-4xl font-bold ${getScoreColor(score)}`}>{score}%</p>
                      <p className="text-xs text-muted-foreground">Completeness Score</p>
                    </div>
                  </div>
                  <Progress value={score} className="mt-3 h-2" />
                  <div className="flex items-center justify-between mt-3">
                    {canEscalate ? (
                      <div className="flex items-center gap-2 text-green-700">
                        <CheckCircle className="h-5 w-5" />
                        <span className="font-semibold text-sm">File complete — ready for Invoice Pending</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-red-700">
                        <AlertCircle className="h-5 w-5" />
                        <span className="font-semibold text-sm">
                          {missingRequired.length} required items missing — cannot advance
                        </span>
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.location.hash = `/jobs/${selectedJob.id}`}
                      data-testid="button-view-job"
                    >
                      Open Job
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Checklist */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">File Completeness Checklist</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {checks.map((c: any) => (
                    <div key={c.key} className={`flex items-center justify-between p-2 rounded-lg ${c.passed ? "bg-green-50" : c.required ? "bg-red-50" : "bg-slate-50"}`} data-testid={`check-${c.key}`}>
                      <div className="flex items-center gap-2">
                        {c.passed
                          ? <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                          : c.required
                            ? <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                            : <AlertCircle className="h-4 w-4 text-yellow-500 shrink-0" />
                        }
                        <span className={`text-sm ${!c.passed && c.required ? "font-semibold text-red-700" : ""}`}>{c.label}</span>
                        {c.required && !c.passed && <Badge className="text-xs bg-red-100 text-red-700 ml-1">Required</Badge>}
                      </div>
                      <span className="text-xs text-muted-foreground">{c.weight}pts</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Action Panel */}
              {missingRequired.length > 0 && (
                <Card className="bg-red-50 border-red-200">
                  <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-red-800">Required Actions</CardTitle></CardHeader>
                  <CardContent className="space-y-1">
                    {missingRequired.map((c: any) => (
                      <p key={c.key} className="text-xs text-red-700 flex items-center gap-2">
                        <XCircle className="h-3 w-3 shrink-0" /> {c.label} — add this to the job file before advancing
                      </p>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
