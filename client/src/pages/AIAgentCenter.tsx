/**
 * AI Agent Center — General Manager
 * Owner + General Manager only. Seven autonomous agents that read the live job
 * files and produce review-ready output:
 *   1. Daily File Audit — missing info / dates / docs / notes
 *   2. Schedule Builder — reads notes, proposes next-day shifts, tags people
 *   3. Scope → Email — drafts carrier + customer emails for review
 *   4. Inbox Responder — drafts replies grounded in the matched job file
 *   5. Lead & Asbestos Flagger — auto-flags each job (writes to Hazmat Flags)
 *   6. CompanyCam Photos — included in the job document packet (JobDocuments)
 *   7. Dash Sync — pulls notes + documents to keep each file complete
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Bot, ShieldAlert, CalendarClock, Mail, Inbox, FlaskConical, RefreshCw,
  CheckCircle2, AlertTriangle, XCircle, Loader2, Sparkles, ClipboardCheck,
  Send, Pencil, Trash2, Users, FileWarning, Lock, FileText, Copy,
} from "lucide-react";

type TabKey = "audit" | "schedule" | "scope" | "narrative" | "inbox" | "hazmat" | "dash";

const TABS: { key: TabKey; label: string; icon: any }[] = [
  { key: "audit", label: "Daily File Audit", icon: ClipboardCheck },
  { key: "schedule", label: "Schedule Builder", icon: CalendarClock },
  { key: "scope", label: "Scope → Email", icon: Mail },
  { key: "narrative", label: "Insurance Narrative", icon: FileText },
  { key: "inbox", label: "Inbox Responder", icon: Inbox },
  { key: "hazmat", label: "Lead & Asbestos", icon: FlaskConical },
  { key: "dash", label: "Dash Sync", icon: RefreshCw },
];

const RED = "hsl(var(--titan-red))";
const BLUE = "hsl(var(--titan-blue))";

function riskColor(risk: string) {
  return risk === "high" ? "bg-red-600 text-white" : risk === "medium" ? "bg-amber-500 text-white" : "bg-green-600 text-white";
}
function sevColor(sev: string) {
  return sev === "high" ? "text-red-600" : sev === "medium" ? "text-amber-600" : "text-slate-500";
}
function sevIcon(sev: string) {
  return sev === "high" ? XCircle : sev === "medium" ? AlertTriangle : CheckCircle2;
}

export default function AIAgentCenter() {
  const { user, token } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<TabKey>("audit");

  const canAccess = user?.role === "owner" || user?.role === "general_manager";

  const { data: status } = useQuery<any>({
    queryKey: ["/api/ai-agent/status"],
    queryFn: () => apiRequest("/api/ai-agent/status").then(r => r.json()),
    enabled: canAccess,
  });

  if (!canAccess) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center">
        <Lock className="w-10 h-10 mx-auto mb-3 text-slate-400" />
        <h2 className="text-lg font-semibold mb-1" data-testid="text-access-denied">Restricted</h2>
        <p className="text-sm text-slate-500">
          The AI Agent Center is available to the Owner and General Manager only.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${RED}, ${BLUE})` }}>
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-tight" data-testid="text-page-title">AI Agent Center</h1>
            <p className="text-sm text-slate-500">Autonomous job-file agents · General Manager</p>
          </div>
        </div>
        <div className="text-right">
          <Badge className={status?.llmAvailable ? "bg-green-600 text-white" : "bg-slate-400 text-white"} data-testid="badge-llm-status">
            <Sparkles className="w-3 h-3 mr-1" />
            {status?.llmAvailable ? "AI online" : "Rules mode"}
          </Badge>
          <div className="text-xs text-slate-500 mt-1">
            {status?.jobsTracked ?? 0} job files · {status?.pendingDrafts ?? 0} drafts pending
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 mb-5 border-b pb-3">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              data-testid={`tab-${t.key}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                active ? "text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
              style={active ? { backgroundColor: BLUE } : {}}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "audit" && <AuditTab token={token!} toast={toast} />}
      {tab === "schedule" && <ScheduleTab token={token!} toast={toast} />}
      {tab === "scope" && <ScopeTab token={token!} toast={toast} />}
      {tab === "narrative" && <NarrativeTab token={token!} toast={toast} />}
      {tab === "inbox" && <InboxTab token={token!} toast={toast} />}
      {tab === "hazmat" && <HazmatTab token={token!} toast={toast} />}
      {tab === "dash" && <DashTab token={token!} toast={toast} />}
    </div>
  );
}

// ─── Shared run button ────────────────────────────────────────────────────────
function RunButton({ onClick, pending, label, testId }: any) {
  return (
    <Button onClick={onClick} disabled={pending} data-testid={testId} style={{ backgroundColor: RED }} className="text-white hover:opacity-90">
      {pending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
      {label}
    </Button>
  );
}

// ═══ AGENT 1 — DAILY FILE AUDIT ════════════════════════════════════════════════
function AuditTab({ token, toast }: any) {
  const [result, setResult] = useState<any>(null);
  const run = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai-agent/audit", {}).then(r => r.json()),
    onSuccess: (d) => { setResult(d); queryClient.invalidateQueries({ queryKey: ["/api/ai-agent/status"] }); },
    onError: (e: any) => toast({ title: "Audit failed", description: e.message, variant: "destructive" }),
  });
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500 max-w-xl">
          Reads every job file and flags missing information, missed or overdue dates, missing required documents, and stale notes — based on where each job sits in its lifecycle.
        </p>
        <RunButton onClick={() => run.mutate()} pending={run.isPending} label="Run daily audit" testId="button-run-audit" />
      </div>

      {result && (
        <>
          <Card className="mb-4 border-l-4" style={{ borderLeftColor: BLUE }}>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="w-4 h-4" style={{ color: BLUE }} /> Daily Briefing</CardTitle></CardHeader>
            <CardContent><p className="text-sm leading-relaxed whitespace-pre-wrap" data-testid="text-audit-overview">{result.overview}</p>
              <div className="text-xs text-slate-500 mt-2">{result.totalJobs} jobs · {result.totalIssues} issues</div>
            </CardContent>
          </Card>
          <div className="space-y-3">
            {result.findings?.map((f: any) => (
              <Card key={f.jobId} data-testid={`card-audit-${f.jobId}`}>
                <CardContent className="py-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-sm">{f.jobNumber} <span className="text-slate-400 font-normal">· {f.status}</span></div>
                    <Badge className={f.completeness >= 80 ? "bg-green-600 text-white" : f.completeness >= 60 ? "bg-amber-500 text-white" : "bg-red-600 text-white"}>
                      {f.completeness}% complete
                    </Badge>
                  </div>
                  {f.issues.length === 0 ? (
                    <div className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> No issues found</div>
                  ) : (
                    <ul className="space-y-1">
                      {f.issues.map((i: any, idx: number) => {
                        const Icon = sevIcon(i.severity);
                        return <li key={idx} className={`text-xs flex items-center gap-1.5 ${sevColor(i.severity)}`}><Icon className="w-3.5 h-3.5 shrink-0" /> {i.label}</li>;
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ═══ AGENT 2 — SCHEDULE BUILDER ════════════════════════════════════════════════
function ScheduleTab({ token, toast }: any) {
  const [result, setResult] = useState<any>(null);
  const [shifts, setShifts] = useState<any[]>([]);
  const propose = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai-agent/schedule/propose", {}).then(r => r.json()),
    onSuccess: (d) => { setResult(d); setShifts(d.shifts || []); },
    onError: (e: any) => toast({ title: "Schedule failed", description: e.message, variant: "destructive" }),
  });
  const commit = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai-agent/schedule/commit", { date: result?.targetDate, shifts }).then(r => r.json()),
    onSuccess: (d) => { toast({ title: `Committed ${d.created} shifts`, description: `Added to Scheduling for ${d.date}` }); },
    onError: (e: any) => toast({ title: "Commit failed", description: e.message, variant: "destructive" }),
  });
  const update = (i: number, k: string, v: string) => setShifts(s => s.map((x, idx) => idx === i ? { ...x, [k]: v } : x));
  const remove = (i: number) => setShifts(s => s.filter((_, idx) => idx !== i));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500 max-w-xl">
          Reads recent job notes and builds the next working day's field schedule, tagging the right technician for each task. Review, edit, then commit to Scheduling.
        </p>
        <RunButton onClick={() => propose.mutate()} pending={propose.isPending} label="Build tomorrow's schedule" testId="button-run-schedule" />
      </div>

      {result && (
        <>
          <Card className="mb-4 border-l-4" style={{ borderLeftColor: BLUE }}>
            <CardContent className="py-3">
              <div className="text-sm font-semibold mb-1">Proposed schedule — {result.targetDate}</div>
              <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="text-schedule-rationale">{result.rationale}</p>
              {result.taggedPeople?.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <Users className="w-3.5 h-3.5 text-slate-400" />
                  {result.taggedPeople.map((p: string) => <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>)}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-2 mb-4">
            {shifts.map((s, i) => (
              <Card key={i} data-testid={`card-shift-${i}`}>
                <CardContent className="py-3 grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-12 md:col-span-2 text-sm font-semibold">{s.jobNumber}</div>
                  <Input className="col-span-6 md:col-span-3 h-8 text-xs" value={s.techName} onChange={e => update(i, "techName", e.target.value)} data-testid={`input-shift-tech-${i}`} />
                  <Input className="col-span-6 md:col-span-4 h-8 text-xs" value={s.title} onChange={e => update(i, "title", e.target.value)} data-testid={`input-shift-title-${i}`} />
                  <Input className="col-span-4 md:col-span-1 h-8 text-xs" value={s.startTime} onChange={e => update(i, "startTime", e.target.value)} />
                  <Input className="col-span-4 md:col-span-1 h-8 text-xs" value={s.endTime} onChange={e => update(i, "endTime", e.target.value)} />
                  <button className="col-span-4 md:col-span-1 text-slate-400 hover:text-red-600 flex justify-center" onClick={() => remove(i)} data-testid={`button-remove-shift-${i}`}><Trash2 className="w-4 h-4" /></button>
                  {s.reason && <div className="col-span-12 text-xs text-slate-400 -mt-1">{s.reason}</div>}
                </CardContent>
              </Card>
            ))}
          </div>
          <Button onClick={() => commit.mutate()} disabled={commit.isPending || !shifts.length} data-testid="button-commit-schedule" style={{ backgroundColor: BLUE }} className="text-white">
            {commit.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CalendarClock className="w-4 h-4 mr-2" />}
            Commit {shifts.length} shifts to Scheduling
          </Button>
        </>
      )}
    </div>
  );
}

// ═══ AGENT 3 — SCOPE → EMAIL ═══════════════════════════════════════════════════
function ScopeTab({ token, toast }: any) {
  const [jobId, setJobId] = useState<string>("");
  const [result, setResult] = useState<any>(null);
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("/api/jobs").then(r => r.json()) });

  const run = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai-agent/scope-email", { jobId: Number(jobId) }).then(r => r.json()),
    onSuccess: (d) => { setResult(d); queryClient.invalidateQueries({ queryKey: ["/api/ai-agent/status"] }); },
    onError: (e: any) => toast({ title: "Draft failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div>
      <p className="text-sm text-slate-500 max-w-2xl mb-4">
        Reviews the initial scope-of-work notes for a job and drafts an email to the carrier/adjuster on file <em>and</em> the customer — ready for your review before anything is sent.
      </p>
      <div className="flex items-end gap-2 mb-5">
        <div className="flex-1 max-w-xs">
          <label className="text-xs text-slate-500 mb-1 block">Job file</label>
          <Select value={jobId} onValueChange={setJobId}>
            <SelectTrigger className="h-9" data-testid="select-scope-job"><SelectValue placeholder="Select a job" /></SelectTrigger>
            <SelectContent>
              {jobs.map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber} — {j.lossType} · {j.status}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <RunButton onClick={() => run.mutate()} pending={run.isPending} label="Draft carrier + customer emails" testId="button-run-scope" />
      </div>

      {result?.drafts && (
        <div className="grid md:grid-cols-2 gap-4">
          {result.drafts.map((d: any) => <DraftCard key={d.id} draft={d} token={token} toast={toast} label={d.kind === "carrier" ? "To Carrier / Adjuster" : "To Customer"} />)}
        </div>
      )}
    </div>
  );
}

// ═══ AGENT — INSURANCE NARRATIVE GENERATOR ═════════════════════════════════════
function NarrativeTab({ token, toast }: any) {
  const [jobId, setJobId] = useState<string>("");
  const [result, setResult] = useState<any>(null);
  const [body, setBody] = useState<string>("");
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("/api/jobs").then(r => r.json()) });

  const run = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai-agent/narrative", { jobId: Number(jobId) }).then(r => r.json()),
    onSuccess: (d) => { setResult(d); setBody(d.narrative || ""); queryClient.invalidateQueries({ queryKey: ["/api/ai-agent/status"] }); },
    onError: (e: any) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/ai-agent/drafts/${result.draftId}`, { body }).then(r => r.json()),
    onSuccess: () => { toast({ title: "Saved", description: "Narrative updated in drafts." }); queryClient.invalidateQueries({ queryKey: ["/api/ai-agent/status"] }); },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const copy = async () => {
    try {
      const ta = document.getElementById("narrative-body") as HTMLTextAreaElement | null;
      if (ta) { ta.select(); document.execCommand("copy"); ta.setSelectionRange(0, 0); }
      toast({ title: "Copied", description: "Narrative copied to clipboard." });
    } catch { toast({ title: "Copy", description: "Select the text and copy manually." }); }
  };

  return (
    <div>
      <p className="text-sm text-slate-500 max-w-2xl mb-4">
        Reads the job file — loss details, water category/class, psychrometric drying logs, equipment deployed, and notes — and drafts the professional insurance narrative an adjuster uses to justify the claim. Review and edit before sending.
      </p>
      <div className="flex items-end gap-2 mb-5">
        <div className="flex-1 max-w-xs">
          <label className="text-xs text-slate-500 mb-1 block">Job file</label>
          <Select value={jobId} onValueChange={setJobId}>
            <SelectTrigger className="h-9" data-testid="select-narrative-job"><SelectValue placeholder="Select a job" /></SelectTrigger>
            <SelectContent>
              {jobs.map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber} — {j.lossType} · {j.status}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <RunButton onClick={() => run.mutate()} pending={run.isPending} label="Generate narrative" testId="button-run-narrative" />
      </div>

      {result && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4" style={{ color: BLUE }} />
              <span data-testid="text-narrative-subject">{result.subject}</span>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge className={result.usedLlm ? "bg-green-600 text-white" : "bg-slate-400 text-white"}>
                <Sparkles className="w-3 h-3 mr-1" />{result.usedLlm ? "AI-written" : "Rules-generated"}
              </Badge>
              <span className="text-xs text-slate-500">{result.dryingReadings} drying reading(s) · {result.equipmentUnits} equipment unit(s)</span>
            </div>
          </CardHeader>
          <CardContent>
            <Textarea
              id="narrative-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={20}
              className="font-mono text-xs leading-relaxed"
              data-testid="textarea-narrative-body"
            />
            <div className="flex flex-wrap gap-2 mt-3">
              <Button onClick={copy} variant="outline" size="sm" data-testid="button-copy-narrative">
                <Copy className="w-4 h-4 mr-1.5" /> Copy
              </Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending} size="sm" style={{ backgroundColor: BLUE }} className="text-white hover:opacity-90" data-testid="button-save-narrative">
                {save.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />} Save to drafts
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══ AGENT 4 — INBOX RESPONDER ═════════════════════════════════════════════════
function InboxTab({ token, toast }: any) {
  const [result, setResult] = useState<any>(null);
  const run = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai-agent/inbox/draft-replies", {}).then(r => r.json()),
    onSuccess: (d) => { setResult(d); queryClient.invalidateQueries({ queryKey: ["/api/ai-agent/status"] }); },
    onError: (e: any) => toast({ title: "Draft failed", description: e.message, variant: "destructive" }),
  });
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500 max-w-xl">
          Reads the inbox, matches each email to its job file (by claim number, carrier, or adjuster), and drafts a reply grounded in that file's data — for your review.
        </p>
        <RunButton onClick={() => run.mutate()} pending={run.isPending} label="Draft inbox replies" testId="button-run-inbox" />
      </div>
      {result && (
        <div className="space-y-4">
          <div className="text-xs text-slate-500">Processed {result.processed} inbox emails · {result.drafts.length} replies drafted</div>
          {result.drafts.map((d: any) => (
            <div key={d.id}>
              <div className="text-xs text-slate-500 mb-1">
                In reply to <span className="font-medium">{d.from}</span> — "{d.originalSubject}"
                {d.linkedJob && <Badge variant="secondary" className="ml-2 text-xs">{d.linkedJob}</Badge>}
              </div>
              <DraftCard draft={d} token={token} toast={toast} label="Draft reply" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ AGENT 5 — LEAD & ASBESTOS FLAGGER ═════════════════════════════════════════
function HazmatTab({ token, toast }: any) {
  const [result, setResult] = useState<any>(null);
  const run = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai-agent/hazmat/scan", {}).then(r => r.json()),
    onSuccess: (d) => { setResult(d); queryClient.invalidateQueries({ queryKey: ["/api/ai-agent/status"] }); queryClient.invalidateQueries({ queryKey: ["/api/hazmat-flags"] }); },
    onError: (e: any) => toast({ title: "Scan failed", description: e.message, variant: "destructive" }),
  });
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500 max-w-xl">
          Assesses every job for lead-based paint (pre-1978) and asbestos-containing materials (pre-1990) potential using year built, loss type, and scope notes. Medium/high flags are written to the Hazmat Flags page.
        </p>
        <RunButton onClick={() => run.mutate()} pending={run.isPending} label="Scan all jobs" testId="button-run-hazmat" />
      </div>
      {result && (
        <>
          <div className="text-xs text-slate-500 mb-3" data-testid="text-hazmat-summary">Scanned {result.totalJobs} jobs · {result.highRiskJobs} high-risk. Flags saved to the Hazmat Flags page.</div>
          <div className="space-y-3">
            {result.flags.map((f: any) => (
              <Card key={f.jobId} data-testid={`card-hazmat-${f.jobId}`}>
                <CardContent className="py-3">
                  <div className="font-semibold text-sm mb-2">{f.jobNumber}</div>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div className="flex items-start gap-2">
                      <FileWarning className="w-4 h-4 mt-0.5 text-slate-400" />
                      <div>
                        <div className="flex items-center gap-2"><span className="text-xs font-semibold">Lead</span><Badge className={riskColor(f.lead?.risk)}>{f.lead?.risk}</Badge>{f.lead?.testingRequired && <Badge variant="outline" className="text-xs">Testing required</Badge>}</div>
                        <p className="text-xs text-slate-500 mt-1">{f.lead?.reason}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <FileWarning className="w-4 h-4 mt-0.5 text-slate-400" />
                      <div>
                        <div className="flex items-center gap-2"><span className="text-xs font-semibold">Asbestos</span><Badge className={riskColor(f.asbestos?.risk)}>{f.asbestos?.risk}</Badge>{f.asbestos?.testingRequired && <Badge variant="outline" className="text-xs">Testing required</Badge>}</div>
                        <p className="text-xs text-slate-500 mt-1">{f.asbestos?.reason}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ═══ AGENT 7 — DASH SYNC ═══════════════════════════════════════════════════════
function DashTab({ token, toast }: any) {
  const [result, setResult] = useState<any>(null);
  const run = useMutation({
    mutationFn: () => apiRequest("POST", "/api/migration/dash/sync", { scopes: ["notes", "documents"] }).then(r => r.json()),
    onSuccess: (d) => { setResult(d); },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500 max-w-xl">
          Pulls all notes and documents from Dash so every job file stays complete. Notes matching a local job number are merged directly into the live file. Requires a Dash connection in Migration Center.
        </p>
        <RunButton onClick={() => run.mutate()} pending={run.isPending} label="Sync notes + documents from Dash" testId="button-run-dash" />
      </div>
      <Card className="border-l-4 mb-3" style={{ borderLeftColor: BLUE }}>
        <CardContent className="py-3 text-xs text-slate-500">
          CompanyCam photos are also available inside each job's document packet — open a job, go to Documents, and use "Download Packet" to include synced photos. Configure CompanyCam and Dash tokens in Migration Center.
        </CardContent>
      </Card>
      {result && (
        <Card data-testid="card-dash-result">
          <CardContent className="py-3">
            <div className="text-sm font-semibold mb-2">Sync {result.ok ? "complete" : "finished with issues"}</div>
            <ul className="space-y-1">
              {(result.results || []).map((r: any, i: number) => (
                <li key={i} className={`text-xs flex items-center gap-1.5 ${r.status === "success" ? "text-green-600" : "text-red-600"}`}>
                  {r.status === "success" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                  {r.scope}: {r.message || r.error || `${r.records} records`}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Editable draft card (used by Scope + Inbox agents) ────────────────────────
function DraftCard({ draft, token, toast, label }: any) {
  const [subject, setSubject] = useState(draft.subject || "");
  const [body, setBody] = useState(draft.body || "");
  const [state, setState] = useState<"pending" | "approved" | "dismissed">("pending");

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/ai-agent/drafts/${draft.id}`, { subject, body }).then(r => r.json()),
    onSuccess: () => toast({ title: "Draft updated" }),
  });
  const approve = useMutation({
    mutationFn: () => apiRequest("POST", `/api/ai-agent/drafts/${draft.id}/approve`, {}).then(r => r.json()),
    onSuccess: (d) => { setState("approved"); toast({ title: "Approved", description: `Saved to ${d.movedTo}` }); queryClient.invalidateQueries({ queryKey: ["/api/ai-agent/status"] }); },
  });
  const dismiss = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/ai-agent/drafts/${draft.id}`).then(r => r.json()),
    onSuccess: () => { setState("dismissed"); },
  });

  if (state === "dismissed") return null;

  return (
    <Card data-testid={`card-draft-${draft.id}`} className={state === "approved" ? "opacity-60 border-green-500" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs uppercase tracking-wide text-slate-500">{label}</CardTitle>
          {draft.recipientEmail && <span className="text-xs text-slate-400">{draft.recipientEmail}</span>}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <Input value={subject} onChange={e => setSubject(e.target.value)} className="text-sm font-medium h-8" data-testid={`input-draft-subject-${draft.id}`} />
        <Textarea value={body} onChange={e => setBody(e.target.value)} rows={8} className="text-sm" data-testid={`textarea-draft-body-${draft.id}`} />
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={save.isPending} data-testid={`button-save-draft-${draft.id}`}><Pencil className="w-3.5 h-3.5 mr-1" /> Save edits</Button>
          <Button size="sm" onClick={() => approve.mutate()} disabled={approve.isPending || state === "approved"} style={{ backgroundColor: BLUE }} className="text-white" data-testid={`button-approve-draft-${draft.id}`}>
            {state === "approved" ? <><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approved</> : <><Send className="w-3.5 h-3.5 mr-1" /> Approve → Drafts</>}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => dismiss.mutate()} className="text-slate-400" data-testid={`button-dismiss-draft-${draft.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}
