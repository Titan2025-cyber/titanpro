import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import {
  Plus, RefreshCw, Clock, CheckCircle2, AlertCircle, XCircle,
  MessageSquareWarning, ChevronDown, DollarSign, CalendarClock,
  User, Building2, FileText, Pencil, Bell, BellOff
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface Supplement {
  id: number;
  jobId: number;
  jobNumber?: string;
  title: string;
  carrier: string;
  adjusterName?: string;
  amountRequested: number;
  amountApproved?: number;
  status: "pending" | "approved" | "partial" | "denied" | "disputed";
  submittedAt?: string;
  responseAt?: string;
  followUpDue?: string;
  notes?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (n?: number) =>
  n != null ? `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

const fmtDate = (s?: string) => {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const isOverdue = (s?: string) => {
  if (!s) return false;
  return new Date(s) < new Date();
};

const STATUS_CONFIG: Record<Supplement["status"], { label: string; color: string; icon: React.ElementType }> = {
  pending:  { label: "Pending",  color: "bg-yellow-100 text-yellow-800 border-yellow-300",  icon: Clock },
  approved: { label: "Approved", color: "bg-green-100 text-green-800 border-green-300",    icon: CheckCircle2 },
  partial:  { label: "Partial",  color: "bg-blue-100 text-blue-800 border-blue-300",        icon: ChevronDown },
  denied:   { label: "Denied",   color: "bg-red-100 text-[hsl(var(--titan-red))] border-red-300", icon: XCircle },
  disputed: { label: "Disputed", color: "bg-orange-100 text-orange-800 border-orange-300", icon: MessageSquareWarning },
};

const STATUSES = ["pending", "approved", "partial", "denied", "disputed"] as const;
const FILTERS = ["all", ...STATUSES] as const;
type Filter = typeof FILTERS[number];

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const futureFollowUp = () => new Date(Date.now() + THIRTY_DAYS).toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────────────────────────────
// Summary Bar
// ─────────────────────────────────────────────────────────────────────────────
function SummaryBar({ supplements }: { supplements: Supplement[] }) {
  const totalRequested = supplements.reduce((s, x) => s + (x.amountRequested || 0), 0);
  const totalApproved = supplements.reduce((s, x) => s + (x.amountApproved || 0), 0);
  const pending = supplements.filter(x => x.status === "pending").length;
  const approved = supplements.filter(x => x.status === "approved" || x.status === "partial").length;
  const recoveryRate = totalRequested > 0 ? ((totalApproved / totalRequested) * 100).toFixed(1) : "0.0";

  const tiles = [
    { label: "Total Submitted",  value: supplements.length.toString(),      sub: "supplements",     color: "text-[hsl(var(--titan-blue))]",    bg: "bg-blue-50 border-blue-200" },
    { label: "Approved / Partial", value: approved.toString(),               sub: "supplements",     color: "text-green-700",                   bg: "bg-green-50 border-green-200" },
    { label: "Pending",          value: pending.toString(),                  sub: "awaiting response", color: "text-yellow-700",                bg: "bg-yellow-50 border-yellow-200" },
    { label: "$ Approved",       value: fmt(totalApproved),                  sub: `of ${fmt(totalRequested)} requested`, color: "text-[hsl(var(--titan-blue))]", bg: "bg-blue-50 border-blue-200" },
    { label: "Recovery Rate",    value: `${recoveryRate}%`,                  sub: "approved vs requested", color: totalApproved / (totalRequested || 1) >= 0.8 ? "text-green-700" : "text-orange-700", bg: "bg-muted border-border" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="summary-bar">
      {tiles.map(t => (
        <div key={t.label} className={`rounded-lg border p-3 ${t.bg}`}>
          <p className={`text-xl font-bold ${t.color}`}>{t.value}</p>
          <p className="text-xs font-semibold text-foreground mt-0.5">{t.label}</p>
          <p className="text-xs text-muted-foreground">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// New Supplement Dialog
// ─────────────────────────────────────────────────────────────────────────────
interface NewSupplementDialogProps {
  jobId?: number;
  jobs?: { id: number; jobNumber: string }[];
  onSuccess?: () => void;
  trigger?: React.ReactNode;
}

function NewSupplementDialog({ jobId, jobs, onSuccess, trigger }: NewSupplementDialogProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    jobId: jobId ? String(jobId) : "",
    title: "",
    amountRequested: "",
    carrier: "",
    adjusterName: "",
    submittedAt: new Date().toISOString().slice(0, 10),
    followUpDue: futureFollowUp(),
    status: "pending" as Supplement["status"],
    notes: "",
  });
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/jobs/${data.jobId}/supplements`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplements"] });
      if (form.jobId) queryClient.invalidateQueries({ queryKey: [`/api/jobs/${form.jobId}/supplements`] });
      setOpen(false);
      setForm(f => ({ ...f, title: "", amountRequested: "", carrier: "", adjusterName: "", notes: "" }));
      toast({ title: "Supplement created" });
      onSuccess?.();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const f = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const resolvedJobId = jobId ?? (form.jobId ? Number(form.jobId) : null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white" data-testid="button-new-supplement">
            <Plus className="w-4 h-4 mr-2" />New Supplement
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Supplement</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {/* Job selector — only shown on page level (no jobId prop) */}
          {!jobId && jobs && (
            <div>
              <Label>Job</Label>
              <Select value={form.jobId} onValueChange={v => f("jobId", v)}>
                <SelectTrigger data-testid="select-job"><SelectValue placeholder="Select job" /></SelectTrigger>
                <SelectContent>
                  {jobs.map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>Title</Label>
            <Input value={form.title} onChange={e => f("title", e.target.value)} placeholder="e.g. Additional drying equipment" data-testid="input-supplement-title" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount Requested ($)</Label>
              <Input type="number" value={form.amountRequested} onChange={e => f("amountRequested", e.target.value)} placeholder="0.00" data-testid="input-amount-requested" />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => f("status", v as any)}>
                <SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Carrier</Label>
              <Input value={form.carrier} onChange={e => f("carrier", e.target.value)} placeholder="e.g. State Farm" data-testid="input-carrier" />
            </div>
            <div>
              <Label>Adjuster Name</Label>
              <Input value={form.adjusterName} onChange={e => f("adjusterName", e.target.value)} data-testid="input-adjuster-name" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Submitted At</Label>
              <Input type="date" value={form.submittedAt} onChange={e => f("submittedAt", e.target.value)} data-testid="input-submitted-at" />
            </div>
            <div>
              <Label>Follow-Up Due</Label>
              <Input type="date" value={form.followUpDue} onChange={e => f("followUpDue", e.target.value)} data-testid="input-follow-up-due" />
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => f("notes", e.target.value)} placeholder="Any additional details…" rows={3} data-testid="input-notes" />
          </div>

          <Button
            className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
            disabled={createMutation.isPending || !form.title || !form.amountRequested || !resolvedJobId}
            onClick={() => createMutation.mutate({
              ...form,
              jobId: resolvedJobId,
              amountRequested: Number(form.amountRequested),
            })}
            data-testid="button-create-supplement"
          >
            {createMutation.isPending ? "Creating…" : "Create Supplement"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Supplement Dialog
// ─────────────────────────────────────────────────────────────────────────────
function UpdateSupplementDialog({ supplement }: { supplement: Supplement }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    responseAt: supplement.responseAt?.slice(0, 10) ?? "",
    amountApproved: supplement.amountApproved != null ? String(supplement.amountApproved) : "",
    status: supplement.status,
    notes: supplement.notes ?? "",
  });
  const { toast } = useToast();

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/supplements/${supplement.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplements"] });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${supplement.jobId}/supplements`] });
      setOpen(false);
      toast({ title: "Supplement updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const f = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid={`button-update-${supplement.id}`}>
          <Pencil className="w-3 h-3" />Update
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Update Supplement</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Response Received</Label>
            <Input type="date" value={form.responseAt} onChange={e => f("responseAt", e.target.value)} data-testid="input-response-at" />
          </div>
          <div>
            <Label>Amount Approved ($)</Label>
            <Input type="number" value={form.amountApproved} onChange={e => f("amountApproved", e.target.value)} placeholder="0.00" data-testid="input-amount-approved" />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => f("status", v as any)}>
              <SelectTrigger data-testid="select-update-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => f("notes", e.target.value)} rows={2} />
          </div>
          <Button
            className="w-full bg-[hsl(var(--titan-blue))] hover:opacity-90 text-white"
            disabled={updateMutation.isPending}
            onClick={() => updateMutation.mutate({
              responseAt: form.responseAt || undefined,
              amountApproved: form.amountApproved ? Number(form.amountApproved) : undefined,
              status: form.status,
              notes: form.notes || undefined,
            })}
            data-testid="button-save-update"
          >
            {updateMutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Supplement Card
// ─────────────────────────────────────────────────────────────────────────────
function SupplementCard({ supplement, showJobLink = true }: { supplement: Supplement; showJobLink?: boolean }) {
  const { toast } = useToast();
  const cfg = STATUS_CONFIG[supplement.status];
  const StatusIcon = cfg.icon;
  const gap = (supplement.amountRequested || 0) - (supplement.amountApproved || 0);
  const overdue = isOverdue(supplement.followUpDue);

  const followUpMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/supplements/${supplement.id}`, {
      followUpDue: futureFollowUp(),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplements"] });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${supplement.jobId}/supplements`] });
      toast({ title: "Follow-up set to 30 days from now" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/supplements/${supplement.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplements"] });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${supplement.jobId}/supplements`] });
      toast({ title: "Supplement deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card
      className={`border-l-4 ${
        supplement.status === "approved" ? "border-l-green-500" :
        supplement.status === "partial"  ? "border-l-[hsl(var(--titan-blue))]" :
        supplement.status === "denied"   ? "border-l-[hsl(var(--titan-red))]" :
        supplement.status === "disputed" ? "border-l-orange-500" :
        "border-l-yellow-500"
      }`}
      data-testid={`supplement-card-${supplement.id}`}
    >
      <CardContent className="p-4">
        {/* Top row */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm">{supplement.title}</h3>
              <Badge className={`text-xs border gap-1 px-1.5 py-0.5 ${cfg.color}`}>
                <StatusIcon className="w-3 h-3" />
                {cfg.label}
              </Badge>
            </div>
            {showJobLink && supplement.jobId && (
              <Link href={`/jobs/${supplement.jobId}`}>
                <span className="text-xs text-[hsl(var(--titan-blue))] hover:underline mt-0.5 block" data-testid={`supplement-job-link-${supplement.id}`}>
                  <FileText className="w-3 h-3 inline mr-1" />
                  {supplement.jobNumber || `Job #${supplement.jobId}`}
                </span>
              </Link>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <UpdateSupplementDialog supplement={supplement} />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid={`button-delete-${supplement.id}`}
            >
              <XCircle className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 mt-2 flex-wrap text-xs text-muted-foreground">
          {supplement.carrier && (
            <span className="flex items-center gap-1">
              <Building2 className="w-3 h-3" />{supplement.carrier}
            </span>
          )}
          {supplement.adjusterName && (
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />{supplement.adjusterName}
            </span>
          )}
        </div>

        {/* Amounts */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div className="bg-muted/50 rounded p-2 text-center">
            <p className="text-xs text-muted-foreground">Requested</p>
            <p className="font-bold text-sm text-foreground">{fmt(supplement.amountRequested)}</p>
          </div>
          <div className={`rounded p-2 text-center ${supplement.amountApproved != null ? "bg-green-50" : "bg-muted/30"}`}>
            <p className="text-xs text-muted-foreground">Approved</p>
            <p className="font-bold text-sm text-green-700">{fmt(supplement.amountApproved)}</p>
          </div>
          <div className={`rounded p-2 text-center ${gap > 0 ? "bg-red-50" : "bg-muted/30"}`}>
            <p className="text-xs text-muted-foreground">Gap</p>
            <p className={`font-bold text-sm ${gap > 0 ? "text-[hsl(var(--titan-red))]" : "text-muted-foreground"}`}>
              {supplement.amountApproved != null ? fmt(gap) : "—"}
            </p>
          </div>
        </div>

        {/* Dates */}
        <div className="flex items-center gap-4 mt-3 flex-wrap text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <CalendarClock className="w-3 h-3" />
            Submitted: {fmtDate(supplement.submittedAt)}
          </span>
          {supplement.responseAt && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <CheckCircle2 className="w-3 h-3" />
              Response: {fmtDate(supplement.responseAt)}
            </span>
          )}
          {supplement.followUpDue && (
            <span className={`flex items-center gap-1 font-medium ${overdue ? "text-[hsl(var(--titan-red))]" : "text-muted-foreground"}`}>
              {overdue ? <AlertCircle className="w-3 h-3" /> : <Bell className="w-3 h-3" />}
              Follow-up: {fmtDate(supplement.followUpDue)}
              {overdue && " (OVERDUE)"}
            </span>
          )}
        </div>

        {/* Notes */}
        {supplement.notes && (
          <p className="mt-2 text-xs text-muted-foreground italic border-t pt-2">{supplement.notes}</p>
        )}

        {/* Action: Mark Follow-Up Done */}
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => followUpMutation.mutate()}
            disabled={followUpMutation.isPending}
            data-testid={`button-followup-done-${supplement.id}`}
          >
            <BellOff className="w-3 h-3" />
            Mark Follow-Up Done
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared inner list — used by both page and SupplementPanel
// ─────────────────────────────────────────────────────────────────────────────
interface SupplementListProps {
  supplements: Supplement[];
  isLoading: boolean;
  showJobLink?: boolean;
  jobId?: number;
  jobs?: { id: number; jobNumber: string }[];
  job?: any;
}

function SupplementList({ supplements, isLoading, showJobLink = true, jobId, jobs, job }: SupplementListProps) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = filter === "all" ? supplements : supplements.filter(s => s.status === filter);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-36 bg-muted animate-pulse rounded-lg" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <SummaryBar supplements={supplements} />

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Supplement status filter">
        {FILTERS.map(f => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filter === f
                ? "bg-[hsl(var(--titan-blue))] text-white border-[hsl(var(--titan-blue))]"
                : "bg-background text-muted-foreground border-border hover:bg-muted"
            }`}
            data-testid={`filter-${f}`}
          >
            {f === "all" ? "All" : STATUS_CONFIG[f as Supplement["status"]].label}
            {f !== "all" && (
              <span className="ml-1 opacity-70">
                ({supplements.filter(s => s.status === (f as Supplement["status"])).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No supplements found</p>
          <p className="text-xs mt-1">
            {filter === "all"
              ? "Create your first supplement to start tracking carrier negotiations."
              : `No ${STATUS_CONFIG[filter as Supplement["status"]]?.label.toLowerCase()} supplements.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(s => (
            <SupplementCard key={s.id} supplement={s} showJobLink={showJobLink} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SupplementPanel — for embedding in job detail
// ─────────────────────────────────────────────────────────────────────────────
export function SupplementPanel({ jobId, job }: { jobId: number; job: any }) {
  const { data: supplements = [], isLoading } = useQuery<Supplement[]>({
    queryKey: [`/api/jobs/${jobId}/supplements`],
  });

  return (
    <div className="space-y-4" data-testid={`supplement-panel-${jobId}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Supplements</h3>
        <NewSupplementDialog
          jobId={jobId}
          trigger={
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" data-testid={`button-new-supplement-panel-${jobId}`}>
              <Plus className="w-3 h-3" />Add Supplement
            </Button>
          }
        />
      </div>
      <SupplementList
        supplements={supplements}
        isLoading={isLoading}
        showJobLink={false}
        jobId={jobId}
        job={job}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function Supplements() {
  const { data: supplements = [], isLoading, refetch } = useQuery<Supplement[]>({
    queryKey: ["/api/supplements"],
  });

  // Fetch jobs for the job selector in new-supplement dialog
  const { data: jobs = [] } = useQuery<{ id: number; jobNumber: string }[]>({
    queryKey: ["/api/jobs"],
  });

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Supplements</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Track supplement submissions and carrier negotiations</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => refetch()}
            data-testid="button-refresh-supplements"
          >
            <RefreshCw className="w-3.5 h-3.5" />Refresh
          </Button>
          <NewSupplementDialog jobs={jobs} />
        </div>
      </div>

      <SupplementList
        supplements={supplements}
        isLoading={isLoading}
        showJobLink={true}
        jobs={jobs}
      />
    </div>
  );
}
