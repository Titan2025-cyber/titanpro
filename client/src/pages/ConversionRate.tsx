import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, Target, ClipboardList, CheckCircle2, FileSignature, RotateCcw, Check, X, Pencil, Info,
} from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

// ─── Types ──────────────────────────────────────────────────────────────────
interface Job {
  id: number;
  jobNumber: string;
  lossType: string;
  status: string;
  progressStage?: string | null;
  salesDate?: string | null;
  leadSource?: string | null;
  createdAt?: string | null;
  address?: string | null;
}

interface JobDocument {
  id: number;
  jobId: number;
  docType: string;   // "work_authorization" | ...
  status: string;    // "unsigned" | "signed" | "uploaded"
  signedAt?: string | null;
}

interface ConversionOverride {
  job_id: number;
  sold: number;      // 1 or 0
  reason: string | null;
  set_by: string | null;
  set_at: string;
}

function pct(sold: number, taken: number): number {
  return taken > 0 ? Math.round((sold / taken) * 1000) / 10 : 0;
}
function rateColor(rate: number): string {
  if (rate >= 60) return "text-green-600";
  if (rate >= 40) return "text-amber-600";
  return "text-red-600";
}

// Bucket a job into a year-month key from its createdAt (fallback: salesDate).
function takenMonth(j: Job): string | null {
  const raw = j.createdAt || j.salesDate;
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}
function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function ConversionRate() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = ["owner", "admin", "office", "general_manager"].includes(user?.role || "");

  const { data: jobs = [], isLoading } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: jobDocs = [], isLoading: docsLoading } = useQuery<JobDocument[]>({
    queryKey: ["/api/job-documents"],
  });
  const { data: overrides = [], isLoading: ovrLoading } = useQuery<ConversionOverride[]>({
    queryKey: ["/api/conversion-overrides"],
  });

  // Set of job ids that have a signed Work Authorization on file.
  const signedWorkAuthJobIds = useMemo(() => {
    const s = new Set<number>();
    for (const d of jobDocs) {
      if (d.docType === "work_authorization" && (d.status === "signed" || !!d.signedAt)) {
        s.add(d.jobId);
      }
    }
    return s;
  }, [jobDocs]);

  // Map from job id → override row (undefined means "no override, use derived").
  const overrideByJob = useMemo(() => {
    const m = new Map<number, ConversionOverride>();
    for (const o of overrides) m.set(o.job_id, o);
    return m;
  }, [overrides]);

  // Effective sold state: override wins over the derived signed-Work-Auth signal.
  function isSold(jobId: number): boolean {
    const o = overrideByJob.get(jobId);
    if (o) return o.sold === 1;
    return signedWorkAuthJobIds.has(jobId);
  }
  function soldSource(jobId: number): "override" | "signed" | "unsigned" {
    if (overrideByJob.has(jobId)) return "override";
    return signedWorkAuthJobIds.has(jobId) ? "signed" : "unsigned";
  }

  // ─── Month picker ─────────────────────────────────────────────────────────
  // Show every month that has at least one taken-in job, newest first, and
  // default to the current month. Simpler than a preset+custom range picker
  // and matches how Cody actually reviews sales.
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) {
      const ym = takenMonth(j);
      if (ym) set.add(ym);
    }
    set.add(currentYearMonth());
    return Array.from(set).sort().reverse();
  }, [jobs]);

  const [selectedMonth, setSelectedMonth] = useState<string>(currentYearMonth());

  // Reason-capture dialog. Manual overrides always ask why so the audit
  // trail on conversion_overrides.reason is actually useful three months later.
  const [reasonDlg, setReasonDlg] = useState<null | { jobId: number; jobNumber: string; sold: boolean }>(null);
  const [reasonText, setReasonText] = useState("");
  const monthJobs = useMemo(
    () => jobs.filter(j => takenMonth(j) === selectedMonth),
    [jobs, selectedMonth],
  );

  // ─── Stats + monthly trend ────────────────────────────────────────────────
  const takenInSelected = monthJobs.length;
  const soldSelected = monthJobs.filter(j => isSold(j.id)).length;
  const rateSelected = pct(soldSelected, takenInSelected);

  // Last 12 months for the chart, oldest-first for a natural time axis.
  const trend = useMemo(() => {
    const map = new Map<string, { taken: number; sold: number }>();
    for (const j of jobs) {
      const ym = takenMonth(j);
      if (!ym) continue;
      const row = map.get(ym) || { taken: 0, sold: 0 };
      row.taken += 1;
      if (isSold(j.id)) row.sold += 1;
      map.set(ym, row);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([ym, v]) => ({
        month: monthLabel(ym),
        "Taken In": v.taken,
        Sold: v.sold,
        Rate: pct(v.sold, v.taken),
      }));
    // isSold reads two Maps; both are memoised, and the closure over them is
    // stable within a render, so the trend recomputes exactly when it should.
  }, [jobs, overrideByJob, signedWorkAuthJobIds]);

  // ─── Mutations ────────────────────────────────────────────────────────────
  const setOverride = useMutation({
    mutationFn: ({ jobId, sold, reason }: { jobId: number; sold: boolean; reason?: string }) =>
      apiRequest("PUT", `/api/conversion-overrides/${jobId}`, { sold, reason: reason ?? "" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversion-overrides"] });
      toast({ title: "Conversion updated" });
      setReasonDlg(null);
      setReasonText("");
    },
    onError: (e: any) => toast({
      title: "Update failed",
      description: String(e?.message || e),
      variant: "destructive",
    }),
  });

  // Open the reason dialog. We pass jobNumber into the dialog title so the
  // operator can double-check they're overriding the right job before saving.
  function openReason(job: Job, sold: boolean) {
    setReasonDlg({ jobId: job.id, jobNumber: job.jobNumber, sold });
    // Pre-fill with the existing override reason if there is one — makes
    // "edit" behaviour feel obvious.
    setReasonText(overrideByJob.get(job.id)?.reason || "");
  }

  const clearOverride = useMutation({
    mutationFn: (jobId: number) =>
      apiRequest("DELETE", `/api/conversion-overrides/${jobId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversion-overrides"] });
      toast({ title: "Reset to signed-Work-Auth default" });
    },
    onError: (e: any) => toast({
      title: "Reset failed",
      description: String(e?.message || e),
      variant: "destructive",
    }),
  });

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (isLoading || docsLoading || ovrLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6" data-testid="conversion-rate-page">
      {/* Month picker */}
      <Card data-testid="month-picker">
        <CardContent className="p-4 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium">Month</span>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-60" data-testid="select-month">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map(ym => (
                <SelectItem key={ym} value={ym}>{monthLabel(ym)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="secondary" className="ml-auto" data-testid="badge-month">{monthLabel(selectedMonth)}</Badge>
        </CardContent>
      </Card>

      {/* KPI cards for the selected month */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card data-testid="kpi-taken-in">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2"><ClipboardList className="w-5 h-5 text-blue-700" /></div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Jobs Taken In</p>
              <p className="text-2xl font-bold" data-testid="text-taken-in">{takenInSelected}</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-sold">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-green-100 p-2"><CheckCircle2 className="w-5 h-5 text-green-700" /></div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Jobs Sold</p>
              <p className="text-2xl font-bold" data-testid="text-sold">{soldSelected}</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-rate">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-[hsl(var(--titan-blue))]/10 p-2"><Target className="w-5 h-5 text-[hsl(var(--titan-blue))]" /></div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Conversion Rate</p>
              <p className={`text-2xl font-bold ${rateColor(rateSelected)}`} data-testid="text-rate">{rateSelected}%</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <FileSignature className="w-3 h-3" /> A job counts as “sold” only when a Work Authorization has been signed on it.
        {canManage ? " Use the row buttons below to manually override or reset a job." : ""}
      </p>

      {/* Monthly trend (last 12 months, independent of picker) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[hsl(var(--titan-blue))]" /> Monthly Trend — Last 12 Months
          </CardTitle>
        </CardHeader>
        <CardContent>
          {trend.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No dated jobs to chart yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={trend} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis yAxisId="left" fontSize={12} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" fontSize={12} unit="%" domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="Taken In" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="left" dataKey="Sold" fill="#1E5AB4" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="Rate" name="Conversion %" stroke="#CC0000" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Editable job list for the selected month */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Pencil className="w-4 h-4 text-[hsl(var(--titan-blue))]" /> Jobs Taken In — {monthLabel(selectedMonth)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job #</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Loss Type</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthJobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canManage ? 6 : 5} className="text-center text-muted-foreground py-6">
                    No jobs taken in during this month.
                  </TableCell>
                </TableRow>
              )}
              {monthJobs.map(j => {
                const sold = isSold(j.id);
                const src = soldSource(j.id);
                const busy = setOverride.isPending || clearOverride.isPending;
                return (
                  <TableRow key={j.id} data-testid={`row-job-${j.id}`}>
                    <TableCell className="font-medium">
                      <Link href={`/jobs/${j.id}`} className="text-[hsl(var(--titan-blue))] hover:underline">{j.jobNumber}</Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[240px] truncate">{j.address || "—"}</TableCell>
                    <TableCell className="text-sm capitalize">{j.lossType || "—"}</TableCell>
                    <TableCell className="text-sm capitalize">{(j.leadSource || "other").replace(/_/g, " ")}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge className={sold ? "bg-green-600 text-white" : "bg-slate-500 text-white"}>
                          {sold ? "Sold" : "Not sold"}
                        </Badge>
                        {src === "override" && (
                          <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-700">Manual</Badge>
                        )}
                        {src === "signed" && (
                          <Badge variant="outline" className="text-[10px]">Signed W/A</Badge>
                        )}
                      </div>
                      {src === "override" && overrideByJob.get(j.id)?.reason && (
                        <div className="text-[11px] text-muted-foreground mt-1 flex items-start gap-1 max-w-[280px]">
                          <Info className="w-3 h-3 mt-0.5 shrink-0" />
                          <span className="line-clamp-2" title={overrideByJob.get(j.id)?.reason || ""}>
                            {overrideByJob.get(j.id)?.reason}
                          </span>
                        </div>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            size="sm"
                            variant={sold ? "default" : "outline"}
                            className={sold ? "h-8 bg-green-600 hover:bg-green-700" : "h-8"}
                            title="Force sold"
                            onClick={() => openReason(j, true)}
                            disabled={busy}
                            data-testid={`button-mark-sold-${j.id}`}
                          >
                            <Check className="w-3.5 h-3.5 mr-1" />Sold
                          </Button>
                          <Button
                            size="sm"
                            variant={!sold ? "default" : "outline"}
                            className={!sold ? "h-8" : "h-8"}
                            title="Force not sold"
                            onClick={() => openReason(j, false)}
                            disabled={busy}
                            data-testid={`button-mark-notsold-${j.id}`}
                          >
                            <X className="w-3.5 h-3.5 mr-1" />Not sold
                          </Button>
                          {src === "override" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              title="Reset to signed-Work-Auth default"
                              onClick={() => clearOverride.mutate(j.id)}
                              disabled={busy}
                              data-testid={`button-reset-${j.id}`}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Reason dialog for manual overrides. Required, not optional — the
          whole point of the override log is knowing why a number moved. */}
      <Dialog open={!!reasonDlg} onOpenChange={(o) => { if (!o) { setReasonDlg(null); setReasonText(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Mark {reasonDlg?.jobNumber} as {reasonDlg?.sold ? "Sold" : "Not sold"}
            </DialogTitle>
            <DialogDescription>
              A short note goes in the audit log with your name and the time.
              Example: “Customer verbal approval, signing Monday” or
              “Customer backed out after adjuster visit.”
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="conv-reason" className="text-xs">Reason</Label>
            <Textarea
              id="conv-reason"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              rows={3}
              placeholder="Why is this being overridden?"
              maxLength={500}
              data-testid="input-override-reason"
            />
            <p className="text-[10px] text-muted-foreground text-right">{reasonText.length} / 500</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReasonDlg(null); setReasonText(""); }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!reasonDlg) return;
                setOverride.mutate({
                  jobId: reasonDlg.jobId,
                  sold: reasonDlg.sold,
                  reason: reasonText.trim(),
                });
              }}
              disabled={setOverride.isPending || reasonText.trim().length < 3}
              data-testid="button-save-override"
            >
              {setOverride.isPending ? "Saving…" : `Save as ${reasonDlg?.sold ? "Sold" : "Not sold"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
