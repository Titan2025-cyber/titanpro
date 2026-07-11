import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import titanLogo from "@/assets/titan-logo.png";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import {
  Briefcase, FileText, DollarSign, AlertCircle, Plus, Phone, TrendingUp,
  Clock, CheckCircle2, Activity, Bell, ArrowRight, Zap, MapPin, Users, Timer, Download, Search, X, CalendarRange,
  Droplets, Hammer,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import type { Job, Invoice, Payment } from "@shared/schema";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  mitigation: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  drying: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  reconstruction: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  complete: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  closed: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const LOSS_ICONS: Record<string, string> = {
  water: "💧", fire: "🔥", mold: "🍄", storm: "⛈️", biohazard: "☣️", reconstruction: "🏗️"
};

const PIPELINE_STAGES = [
  { label: "New", status: "new", color: "bg-blue-500" },
  { label: "Mitigation", status: "mitigation", color: "bg-yellow-500" },
  { label: "Drying", status: "drying", color: "bg-orange-500" },
  { label: "Reconstruction", status: "reconstruction", color: "bg-purple-500" },
  { label: "Complete", status: "complete", color: "bg-green-500" },
];

// ── Phase (mitigation vs reconstruction) value helpers ───────────────────────
// Mirrors the logic used on the Jobs page. "Value" of a phase = its estimate
// total, falling back to its invoice total when no estimate exists.
interface PhaseFin { estimateTotal: number; invoiceTotal: number; }
interface JobFin {
  estimateTotal: number; invoiceTotal: number;
  byPhase?: { mitigation?: PhaseFin; reconstruction?: PhaseFin };
}
function phaseVal(f?: PhaseFin): number {
  if (!f) return 0;
  return f.estimateTotal > 0 ? f.estimateTotal : f.invoiceTotal;
}
function jobPhaseValues(f?: JobFin): { mitigation: number; reconstruction: number; total: number } {
  if (!f) return { mitigation: 0, reconstruction: 0, total: 0 };
  const mitigation = phaseVal(f.byPhase?.mitigation);
  const reconstruction = phaseVal(f.byPhase?.reconstruction);
  if (!f.byPhase || (mitigation === 0 && reconstruction === 0)) {
    const whole = f.estimateTotal > 0 ? f.estimateTotal : f.invoiceTotal;
    return { mitigation: whole, reconstruction: 0, total: whole };
  }
  return { mitigation, reconstruction, total: mitigation + reconstruction };
}
function fmtMoney(n: number) {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default function Dashboard() {
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: invoices = [] } = useQuery<Invoice[]>({ queryKey: ["/api/invoices"] });
  const { data: payments = [] } = useQuery<Payment[]>({ queryKey: ["/api/payments"] });
  const { data: activityRaw = [] } = useQuery<any[]>({
    queryKey: ["/api/activity-log"],
    queryFn: () => apiRequest("GET", "/api/activity-log").then(r => r.json()),
  });
  const { data: payoutRequests = [] } = useQuery<any[]>({ queryKey: ["/api/payout-requests"] });
  const { data: financialsRaw = {} } = useQuery<Record<string, JobFin>>({
    queryKey: ["/api/jobs/financials"],
    queryFn: () => apiRequest("GET", "/api/jobs/financials").then(r => r.json()),
  });
  const finMap: Record<number, JobFin> = Object.fromEntries(
    Object.entries(financialsRaw).map(([k, v]) => [Number(k), v])
  );
  const { data: jobAgeAlerts = [] } = useQuery<any[]>({
    queryKey: ["/api/job-age-alerts"],
    queryFn: () => apiRequest("GET", "/api/job-age-alerts?days=14").then(r => r.json()),
  });

  const activeJobs = jobs.filter(j => j.status !== "closed" && j.status !== "complete");

  // Pipeline value split by phase across active jobs (mitigation vs reconstruction).
  const pipelinePhase = activeJobs.reduce((acc, j) => {
    const v = jobPhaseValues(finMap[j.id]);
    acc.mitigation += v.mitigation;
    acc.reconstruction += v.reconstruction;
    acc.total += v.total;
    return acc;
  }, { mitigation: 0, reconstruction: 0, total: 0 });
  const mitPct = pipelinePhase.total > 0 ? Math.round((pipelinePhase.mitigation / pipelinePhase.total) * 100) : 0;
  const reconPct = pipelinePhase.total > 0 ? 100 - mitPct : 0;
  const totalRevenue = payments.filter(p => p.type === "received").reduce((s, p) => s + (p.amount || 0), 0);
  const outstanding = invoices.filter(i => i.status !== "paid" && i.status !== "draft").reduce((s, i) => s + (i.total || 0), 0);
  const newJobs = jobs.filter(j => j.status === "new").length;
  const completedThisMonth = jobs.filter(j => {
    if (j.status !== "complete") return false;
    const d = j.jobComplete || j.createdAt || "";
    const now = new Date();
    const jd = new Date(d);
    return jd.getMonth() === now.getMonth() && jd.getFullYear() === now.getFullYear();
  }).length;
  const pendingPayouts = payoutRequests.filter((p: any) => p.status === "pending").length;
  const pendingPayoutAmount = payoutRequests.filter((p: any) => p.status === "pending").reduce((s: number, p: any) => s + (p.amount || 0), 0);

  // Revenue trend: last 4 weeks
  const weeklyRevenue = (() => {
    const weeks: number[] = [0, 0, 0, 0];
    payments.filter(p => p.type === "received").forEach(p => {
      const d = new Date(p.paidAt || "");
      const diff = Math.floor((Date.now() - d.getTime()) / (7 * 24 * 60 * 60 * 1000));
      if (diff >= 0 && diff < 4) weeks[3 - diff] += p.amount || 0;
    });
    return weeks;
  })();

  const maxWeek = Math.max(...weeklyRevenue, 1);

  const recentActivity = activityRaw.slice(0, 8);

  // Cycle time: avg days from created to complete for last 30 completed jobs
  const completedJobs = jobs.filter(j => j.status === "complete" && j.jobComplete && j.createdAt);
  const avgCycleDays = completedJobs.length > 0
    ? Math.round(completedJobs.slice(-30).reduce((s, j) => {
        return s + Math.max(0, Math.floor((new Date(j.jobComplete!).getTime() - new Date(j.createdAt!).getTime()) / 86400000));
      }, 0) / completedJobs.slice(-30).length)
    : null;
  const criticalStuck = (jobAgeAlerts as any[]).filter((a: any) => (a.stuckDays || 0) >= 30).length;

  const ACTION_ICONS: Record<string, string> = {
    created: "✨", updated: "✏️", status_changed: "🔄", note_added: "📝",
    photo_added: "📸", signed: "✍️", paid: "💰", assigned: "👤", sms_sent: "💬",
  };

  // ---- Bucket drill-down ----
  const [openBucket, setOpenBucket] = useState<null | "active" | "revenue" | "ar" | "cycle" | "payouts">(null);
  const [bucketSearch, setBucketSearch] = useState("");
  const [bucketStatus, setBucketStatus] = useState("all");
  const [bucketFrom, setBucketFrom] = useState(""); // date-range start (revenue/AR)
  const [bucketTo, setBucketTo] = useState("");     // date-range end (revenue/AR)
  const openBucketPanel = (b: "active" | "revenue" | "ar" | "cycle" | "payouts") => { setBucketSearch(""); setBucketStatus("all"); setBucketFrom(""); setBucketTo(""); setOpenBucket(b); };
  const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

  const receivedPayments = payments.filter(p => p.type === "received");
  const outstandingInvoices = invoices.filter(i => i.status !== "paid" && i.status !== "draft");
  const pendingPayoutList = (payoutRequests as any[]).filter((p: any) => p.status === "pending");
  const completedWithCycle = completedJobs.map(j => ({
    job: j,
    days: Math.max(0, Math.floor((new Date(j.jobComplete!).getTime() - new Date(j.createdAt!).getTime()) / 86400000)),
  })).sort((a, b) => b.days - a.days);

  // ---- Bucket filtering (search + status) ----
  const q = bucketSearch.trim().toLowerCase();
  const match = (...vals: (string | number | null | undefined)[]) =>
    q === "" || vals.some(v => String(v ?? "").toLowerCase().includes(q));

  // Date-range filter (revenue & A/R panels). Compares the record's date (YYYY-MM-DD
  // slice) against the inclusive from/to bounds. Empty bounds are open-ended.
  const inDateRange = (dateStr?: string | null) => {
    if (!bucketFrom && !bucketTo) return true;
    if (!dateStr) return false;
    const d = String(dateStr).slice(0, 10);
    if (bucketFrom && d < bucketFrom) return false;
    if (bucketTo && d > bucketTo) return false;
    return true;
  };
  const dateRangeActive = !!(bucketFrom || bucketTo);

  const filteredActiveJobs = activeJobs.filter(j =>
    (bucketStatus === "all" || j.status === bucketStatus) &&
    match(j.jobNumber, j.status, j.lossType, j.address, j.assignedTech, j.insuranceCarrier)
  );
  const filteredPayments = receivedPayments.filter((p: any) =>
    inDateRange(p.paidAt) &&
    match(p.method, p.reference, p.notes, p.jobId ? `job #${p.jobId}` : "", p.amount)
  );
  const filteredInvoices = outstandingInvoices.filter((inv: any) =>
    (bucketStatus === "all" || inv.status === bucketStatus) &&
    inDateRange(inv.createdAt || inv.dueDate) &&
    match(inv.invoiceNumber, inv.status, inv.clientName, inv.total)
  );
  const filteredCycle = completedWithCycle.filter(({ job, days }) =>
    match(job.jobNumber, job.lossType, job.address, `${days}d`, `${days}`)
  );
  const filteredPayouts = pendingPayoutList.filter((p: any) =>
    inDateRange(p.createdAt) &&
    match(p.partnerName, p.requestedBy, p.jobId ? `job #${p.jobId}` : "", p.amount)
  );

  const filteredRevenueTotal = filteredPayments.reduce((s: number, p: any) => s + (p.amount || 0), 0);
  const filteredARTotal = filteredInvoices.reduce((s: number, inv: any) => s + (inv.total || 0), 0);
  const filteredPayoutTotal = filteredPayouts.reduce((s: number, p: any) => s + (p.amount || 0), 0);
  const filteredAvgCycle = filteredCycle.length > 0
    ? Math.round(filteredCycle.reduce((s, c) => s + c.days, 0) / filteredCycle.length)
    : 0;

  const activeStatuses = Array.from(new Set(activeJobs.map(j => j.status)));
  const arStatuses = Array.from(new Set(outstandingInvoices.map((i: any) => i.status)));

  const BUCKETS = {
    active: {
      title: "Active Jobs",
      subtitle: `${activeJobs.length} job${activeJobs.length !== 1 ? "s" : ""} in progress · ${newJobs} new lead${newJobs !== 1 ? "s" : ""}`,
    },
    revenue: {
      title: "Revenue Received",
      subtitle: `${receivedPayments.length} payment${receivedPayments.length !== 1 ? "s" : ""} · ${money(totalRevenue)} collected`,
    },
    ar: {
      title: "Outstanding A/R",
      subtitle: `${outstandingInvoices.length} unpaid invoice${outstandingInvoices.length !== 1 ? "s" : ""} · ${money(outstanding)} owed`,
    },
    cycle: {
      title: "Cycle Time — Completed Jobs",
      subtitle: avgCycleDays !== null ? `${completedWithCycle.length} completed · ${avgCycleDays}d average` : "No completed jobs yet",
    },
    payouts: {
      title: "Pending Payouts",
      subtitle: `${pendingPayoutList.length} request${pendingPayoutList.length !== 1 ? "s" : ""} · ${money(pendingPayoutAmount)} total`,
    },
  } as const;

  const closeBucket = () => setOpenBucket(null);

  const exportCSV = (filename: string, headers: string[], rows: (string | number)[][], totalRow?: (string | number)[]) => {
    const esc = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const allRows = [headers, ...rows];
    if (totalRow) allRows.push(totalRow);
    const csv = allRows.map(r => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const stamp = () => new Date().toISOString().slice(0, 10);

  const exportRevenueCSV = () => exportCSV(
    `titan-revenue-${stamp()}.csv`,
    ["Source / Method", "Reference / Notes", "Job", "Date", "Amount"],
    filteredPayments.map((p: any) => [
      p.method || p.reference || "Payment received",
      p.notes || "",
      p.jobId ? `Job #${p.jobId}` : "",
      fmtDate(p.paidAt || p.createdAt),
      (p.amount || 0),
    ]),
    [`TOTAL (${filteredPayments.length} payments)`, "", "", "", filteredRevenueTotal],
  );

  const exportARCSV = () => exportCSV(
    `titan-outstanding-ar-${stamp()}.csv`,
    ["Invoice", "Status", "Client", "Due Date", "Amount"],
    filteredInvoices.map((inv: any) => [
      inv.invoiceNumber || `Invoice #${inv.id}`,
      inv.status || "",
      inv.clientName || "",
      fmtDate(inv.dueDate),
      (inv.total || 0),
    ]),
    [`TOTAL (${filteredInvoices.length} invoices)`, "", "", "", filteredARTotal],
  );

  const exportActiveJobsCSV = () => exportCSV(
    `titan-active-jobs-${stamp()}.csv`,
    ["Job #", "Status", "Loss Type", "Address", "Assigned Tech", "Insurance Carrier"],
    filteredActiveJobs.map(job => [
      job.jobNumber || `Job #${job.id}`,
      job.status || "",
      job.lossType || "",
      job.address || "",
      job.assignedTech || "",
      job.insuranceCarrier || "Self-pay",
    ]),
    [`TOTAL: ${filteredActiveJobs.length} active jobs`, "", "", "", "", ""],
  );

  const exportPayoutsCSV = () => exportCSV(
    `titan-pending-payouts-${stamp()}.csv`,
    ["Partner / Requester", "Job", "Requested", "Amount"],
    filteredPayouts.map((p: any) => [
      p.partnerName || p.requestedBy || `Payout #${p.id}`,
      p.jobId ? `Job #${p.jobId}` : "",
      fmtDate(p.createdAt || p.requestedAt),
      (p.amount || 0),
    ]),
    [`TOTAL (${filteredPayouts.length} requests)`, "", "", filteredPayoutTotal],
  );

  return (
    <>
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Command Center</h1>
          <p className="text-sm text-muted-foreground">Titan Restoration LLC · Augusta, GA · {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
        </div>
        <Link href="/jobs">
          <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white" data-testid="button-new-job">
            <Plus className="w-4 h-4 mr-2" />New Job
          </Button>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card role="button" tabIndex={0} onClick={() => openBucketPanel("active")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBucketPanel("active"); } }} data-testid="bucket-active-jobs" className="border-l-4 border-l-[hsl(var(--titan-blue))] cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-[hsl(var(--titan-blue))]">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Active Jobs</p>
                <p className="text-3xl font-bold text-foreground mt-1">{activeJobs.length}</p>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">{newJobs} new leads <ArrowRight className="w-3 h-3 opacity-60" /></p>
              </div>
              <div className="p-2 bg-[hsl(var(--titan-blue)/0.1)] rounded-lg">
                <Briefcase className="w-5 h-5 text-[hsl(var(--titan-blue))]" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card role="button" tabIndex={0} onClick={() => openBucketPanel("revenue")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBucketPanel("revenue"); } }} data-testid="bucket-revenue" className="border-l-4 border-l-green-500 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-green-500">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Revenue MTD</p>
                <p className="text-3xl font-bold text-foreground mt-1">${(totalRevenue / 1000).toFixed(1)}k</p>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">{completedThisMonth} jobs complete <ArrowRight className="w-3 h-3 opacity-60" /></p>
              </div>
              <div className="p-2 bg-green-100 rounded-lg">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card role="button" tabIndex={0} onClick={() => openBucketPanel("ar")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBucketPanel("ar"); } }} data-testid="bucket-ar" className="border-l-4 border-l-orange-500 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-orange-500">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Outstanding A/R</p>
                <p className="text-3xl font-bold text-foreground mt-1">${outstanding.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">{invoices.filter(i => i.status === "overdue").length} overdue <ArrowRight className="w-3 h-3 opacity-60" /></p>
              </div>
              <div className="p-2 bg-orange-100 rounded-lg">
                <FileText className="w-5 h-5 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card role="button" tabIndex={0} onClick={() => openBucketPanel("cycle")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBucketPanel("cycle"); } }} data-testid="bucket-cycle" className="border-l-4 border-l-purple-500 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-purple-500">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Avg Cycle Time</p>
                <p className="text-3xl font-bold text-foreground mt-1">{avgCycleDays !== null ? `${avgCycleDays}d` : "—"}</p>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">job completion <ArrowRight className="w-3 h-3 opacity-60" /></p>
              </div>
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                <Timer className="w-5 h-5 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card role="button" tabIndex={0} onClick={() => openBucketPanel("payouts")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBucketPanel("payouts"); } }} data-testid="bucket-payouts" className="border-l-4 border-l-[hsl(var(--titan-red))] cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all focus:outline-none focus:ring-2 focus:ring-[hsl(var(--titan-red))]">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Pending Payouts</p>
                <p className="text-3xl font-bold text-foreground mt-1">{pendingPayouts}</p>
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">${pendingPayoutAmount.toLocaleString()} total <ArrowRight className="w-3 h-3 opacity-60" /></p>
              </div>
              <div className="p-2 bg-[hsl(var(--titan-red)/0.1)] rounded-lg">
                <AlertCircle className="w-5 h-5 text-[hsl(var(--titan-red))]" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Job Age Alert Banner */}
      {criticalStuck > 0 && (
        <Link href="/job-age-alerts">
          <div className="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg cursor-pointer hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                {criticalStuck} job{criticalStuck !== 1 ? "s" : ""} stuck 30+ days — action needed
              </p>
              <p className="text-xs text-red-600 dark:text-red-500">Click to view job age report</p>
            </div>
            <ArrowRight className="w-4 h-4 text-red-600" />
          </div>
        </Link>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Pipeline + Recent Jobs */}
        <div className="lg:col-span-2 space-y-6">
          {/* Pipeline Visual */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[hsl(var(--titan-blue))]" />Job Pipeline</CardTitle>
                <Link href="/jobs"><span className="text-xs text-[hsl(var(--titan-blue))] hover:underline cursor-pointer flex items-center gap-1">All Jobs <ArrowRight className="w-3 h-3" /></span></Link>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-2 mb-4">
                {PIPELINE_STAGES.map(p => {
                  const count = jobs.filter(j => j.status === p.status).length;
                  const pct = jobs.length > 0 ? Math.round((count / jobs.length) * 100) : 0;
                  return (
                    <div key={p.status} className="text-center min-w-0">
                      <div className="text-2xl font-bold text-foreground">{count}</div>
                      <div className={`w-full h-1.5 rounded-full mt-1 mb-1 ${p.color} opacity-80`} />
                      <div className="text-[10px] sm:text-xs text-muted-foreground leading-tight break-words">{p.label}</div>
                    </div>
                  );
                })}
              </div>

              {/* Pipeline value by phase: mitigation vs reconstruction */}
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground">PIPELINE VALUE BY PHASE</p>
                  <span className="text-xs font-semibold text-foreground" data-testid="pipeline-phase-total">{fmtMoney(pipelinePhase.total)}</span>
                </div>
                {/* Split bar */}
                <div className="flex h-2 w-full rounded-full overflow-hidden bg-muted" title={`Mitigation ${mitPct}% · Reconstruction ${reconPct}%`}>
                  <div className="bg-[hsl(var(--titan-blue))]" style={{ width: `${mitPct}%` }} />
                  <div className="bg-[hsl(var(--titan-red))]" style={{ width: `${reconPct}%` }} />
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div className="rounded-lg border p-2 bg-[hsl(var(--titan-blue)/0.06)] border-[hsl(var(--titan-blue)/0.25)]">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Droplets className="w-3.5 h-3.5 text-[hsl(var(--titan-blue))]" />Mitigation
                      <span className="ml-auto">{mitPct}%</span>
                    </div>
                    <div className="text-sm font-bold text-foreground mt-0.5" data-testid="pipeline-phase-mit">{fmtMoney(pipelinePhase.mitigation)}</div>
                  </div>
                  <div className="rounded-lg border p-2 bg-[hsl(var(--titan-red)/0.06)] border-[hsl(var(--titan-red)/0.25)]">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Hammer className="w-3.5 h-3.5 text-[hsl(var(--titan-red))]" />Reconstruction
                      <span className="ml-auto">{reconPct}%</span>
                    </div>
                    <div className="text-sm font-bold text-foreground mt-0.5" data-testid="pipeline-phase-recon">{fmtMoney(pipelinePhase.reconstruction)}</div>
                  </div>
                </div>
              </div>

              {/* Revenue Trend Bars */}
              <div className="mt-4 pt-4 border-t">
                <p className="text-xs font-medium text-muted-foreground mb-3">WEEKLY REVENUE (last 4 weeks)</p>
                {weeklyRevenue.every(v => v === 0) ? (
                  <div className="flex items-center justify-center h-16 text-xs text-muted-foreground italic">
                    No payments recorded yet — bars will appear as revenue is collected
                  </div>
                ) : (
                  <div className="flex items-end gap-2 h-16">
                    {weeklyRevenue.map((v, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <div
                          className="w-full rounded-t bg-[hsl(var(--titan-blue)/0.7)] transition-all"
                          style={{ height: `${Math.max((v / maxWeek) * 52, v > 0 ? 4 : 0)}px` }}
                        />
                        <span className="text-xs text-muted-foreground">W{i + 1}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Active Jobs List */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><Briefcase className="w-4 h-4 text-[hsl(var(--titan-red))]" />Active Jobs</CardTitle>
                <Link href="/jobs"><span className="text-xs text-[hsl(var(--titan-blue))] hover:underline cursor-pointer flex items-center gap-1">View all <ArrowRight className="w-3 h-3" /></span></Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {activeJobs.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">No active jobs</div>
              ) : (
                <div className="divide-y">
                  {activeJobs.slice(0, 6).map(job => (
                    <Link key={job.id} href={`/jobs/${job.id}`}>
                      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer" data-testid={`job-row-${job.id}`}>
                        <div className="text-xl w-8 text-center">{LOSS_ICONS[job.lossType] || "📋"}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-foreground">{job.jobNumber}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[job.status]}`}>
                              {job.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span className="truncate">{job.address || "No address"}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-medium text-foreground">{job.assignedTech || "—"}</div>
                          <div className="text-xs text-muted-foreground">{job.insuranceCarrier || "Self-pay"}</div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Activity Feed + Quick Actions */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Zap className="w-4 h-4 text-yellow-500" />Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {[
                { href: "/jobs", label: "New Job", icon: Briefcase, color: "bg-[hsl(var(--titan-red))]" },
                { href: "/estimates", label: "Estimate", icon: FileText, color: "bg-[hsl(var(--titan-blue))]" },
                { href: "/invoices", label: "Invoice", icon: DollarSign, color: "bg-green-600" },
                { href: "/scheduling", label: "Schedule", icon: Clock, color: "bg-purple-600" },
                { href: "/messaging", label: "Message", icon: Bell, color: "bg-orange-500" },
                { href: "/partner-portal", label: "Payouts", icon: Users, color: "bg-teal-600" },
              ].map(({ href, label, icon: Icon, color }) => (
                <Link key={href} href={href}>
                  <button className={`w-full flex items-center gap-2 p-3 rounded-lg text-white font-medium text-xs ${color} hover:opacity-90 transition-opacity`}>
                    <Icon className="w-4 h-4 shrink-0" />
                    {label}
                  </button>
                </Link>
              ))}
            </CardContent>
          </Card>

          {/* Live Activity Feed */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4 text-[hsl(var(--titan-blue))]" />Activity Feed</CardTitle>
                <Link href="/activity"><span className="text-xs text-[hsl(var(--titan-blue))] hover:underline cursor-pointer flex items-center gap-1">All <ArrowRight className="w-3 h-3" /></span></Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {recentActivity.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">No recent activity</div>
              ) : (
                <div className="divide-y">
                  {recentActivity.map((a: any) => (
                    <div key={a.id} className="flex items-start gap-3 px-4 py-3">
                      <span className="text-base mt-0.5">{ACTION_ICONS[a.action] || "📋"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground leading-snug">{a.description}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {a.actor} · {new Date(a.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Company Card */}
          <Card className="border-[hsl(var(--titan-red)/0.3)]">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded bg-white border flex items-center justify-center shrink-0 p-1">
                  <img src={titanLogo} alt="Titan Restoration" className="w-full h-full object-contain" />
                </div>
                <div>
                  <p className="font-bold text-foreground text-sm">Titan Restoration LLC</p>
                  <p className="text-xs text-muted-foreground">Recover · Restore · Rebuild</p>
                  <div className="flex gap-3 mt-1 flex-wrap">
                    <a href="tel:7069220154" className="flex items-center gap-1 text-xs text-[hsl(var(--titan-red))] hover:underline">
                      <Phone className="w-3 h-3" /> 706-922-0154
                    </a>
                    <a href="https://titanrestorationllc.com" target="_blank" rel="noopener" className="text-xs text-[hsl(var(--titan-blue))] hover:underline">
                      titanrestorationllc.com
                    </a>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>

    {/* Bucket drill-down dialog */}
    <Dialog open={openBucket !== null} onOpenChange={(o) => { if (!o) closeBucket(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        {openBucket && (
          <>
            <DialogHeader>
              <DialogTitle>{BUCKETS[openBucket].title}</DialogTitle>
              <DialogDescription>{BUCKETS[openBucket].subtitle}</DialogDescription>
            </DialogHeader>

            {/* Search + status filter */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={bucketSearch}
                  onChange={(e) => setBucketSearch(e.target.value)}
                  placeholder="Search…"
                  className="pl-8 pr-8 h-9"
                  data-testid="input-bucket-search"
                />
                {bucketSearch && (
                  <button
                    onClick={() => setBucketSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label="Clear search"
                    data-testid="button-clear-bucket-search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {(openBucket === "active" || openBucket === "ar") && (
                <select
                  value={bucketStatus}
                  onChange={(e) => setBucketStatus(e.target.value)}
                  data-testid="select-bucket-status"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm capitalize focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="all">All statuses</option>
                  {(openBucket === "active" ? activeStatuses : arStatuses).map(s => (
                    <option key={s} value={s} className="capitalize">{s}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Date-range filter (revenue = payment date, A/R = invoice date, payouts = request date) */}
            {(openBucket === "revenue" || openBucket === "ar" || openBucket === "payouts") && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarRange className="w-3.5 h-3.5" />
                  {openBucket === "revenue" ? "Payment date" : openBucket === "ar" ? "Invoice date" : "Request date"}
                </span>
                <Input
                  type="date"
                  value={bucketFrom}
                  max={bucketTo || undefined}
                  onChange={(e) => setBucketFrom(e.target.value)}
                  className="h-9 w-auto"
                  aria-label="From date"
                  data-testid="input-bucket-date-from"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={bucketTo}
                  min={bucketFrom || undefined}
                  onChange={(e) => setBucketTo(e.target.value)}
                  className="h-9 w-auto"
                  aria-label="To date"
                  data-testid="input-bucket-date-to"
                />
                {dateRangeActive && (
                  <button
                    onClick={() => { setBucketFrom(""); setBucketTo(""); }}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    data-testid="button-clear-bucket-dates"
                  >
                    <X className="w-3.5 h-3.5" />Clear dates
                  </button>
                )}
              </div>
            )}

            <div className="overflow-y-auto -mx-6 px-6">

              {/* Active Jobs */}
              {openBucket === "active" && (
                activeJobs.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">No active jobs</div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="flex justify-end px-3 py-2 border-b bg-background">
                      <Button variant="outline" size="sm" onClick={exportActiveJobsCSV} data-testid="button-export-active-jobs-csv" className="h-8 text-xs">
                        <Download className="w-3.5 h-3.5 mr-1.5" />Export CSV
                      </Button>
                    </div>
                    {filteredActiveJobs.length === 0 ? (
                      <div className="py-10 text-center text-sm text-muted-foreground">No jobs match your filters</div>
                    ) : (
                    <div className="divide-y">
                    {filteredActiveJobs.map(job => (
                      <Link key={job.id} href={`/jobs/${job.id}`} onClick={closeBucket}>
                        <div className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50 cursor-pointer" data-testid={`bucket-row-job-${job.id}`}>
                          <div className="text-xl w-7 text-center shrink-0">{LOSS_ICONS[job.lossType] || "📋"}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-foreground">{job.jobNumber}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[job.status]}`}>{job.status}</span>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                              <MapPin className="w-3 h-3 shrink-0" /><span className="truncate">{job.address || "No address"}</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-xs font-medium text-foreground">{job.assignedTech || "—"}</div>
                            <div className="text-xs text-muted-foreground">{job.insuranceCarrier || "Self-pay"}</div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                        </div>
                      </Link>
                    ))}
                    </div>
                    )}
                  </div>
                )
              )}

              {/* Revenue received */}
              {openBucket === "revenue" && (
                receivedPayments.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">No payments received yet</div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="flex justify-end px-3 py-2 border-b bg-background">
                      <Button variant="outline" size="sm" onClick={exportRevenueCSV} data-testid="button-export-revenue-csv" className="h-8 text-xs">
                        <Download className="w-3.5 h-3.5 mr-1.5" />Export CSV
                      </Button>
                    </div>
                    {filteredPayments.length === 0 ? (
                      <div className="py-10 text-center text-sm text-muted-foreground">No payments match your search</div>
                    ) : (<>
                    <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      <span>Source / Method</span><span className="text-right">Date</span><span className="text-right">Amount</span>
                    </div>
                    <div className="divide-y">
                      {filteredPayments.map((p: any) => (
                        <div key={p.id} className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-3 items-center" data-testid={`bucket-row-payment-${p.id}`}>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{p.method || p.reference || "Payment received"}</p>
                            <p className="text-xs text-muted-foreground truncate">{p.notes || (p.jobId ? `Job #${p.jobId}` : "—")}</p>
                          </div>
                          <span className="text-xs text-muted-foreground text-right">{fmtDate(p.paidAt || p.createdAt)}</span>
                          <span className="text-sm font-semibold text-green-600 text-right">{money(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 bg-muted/50 text-sm font-bold">
                      <span>Total{q || bucketStatus !== "all" || dateRangeActive ? " (filtered)" : ""} received</span><span className="text-right text-green-600">{money(filteredRevenueTotal)}</span>
                    </div>
                    </>)}
                  </div>
                )
              )}

              {/* Outstanding A/R */}
              {openBucket === "ar" && (
                outstandingInvoices.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">No outstanding invoices — all paid up</div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="flex justify-end px-3 py-2 border-b bg-background">
                      <Button variant="outline" size="sm" onClick={exportARCSV} data-testid="button-export-ar-csv" className="h-8 text-xs">
                        <Download className="w-3.5 h-3.5 mr-1.5" />Export CSV
                      </Button>
                    </div>
                    {filteredInvoices.length === 0 ? (
                      <div className="py-10 text-center text-sm text-muted-foreground">No invoices match your filters</div>
                    ) : (<>
                    <div className="divide-y">
                      {filteredInvoices.map((inv: any) => (
                        <Link key={inv.id} href="/invoices" onClick={closeBucket}>
                          <div className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50 cursor-pointer" data-testid={`bucket-row-invoice-${inv.id}`}>
                            <FileText className="w-4 h-4 text-orange-500 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold text-foreground">{inv.invoiceNumber || `Invoice #${inv.id}`}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${inv.status === "overdue" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"}`}>{inv.status}</span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">Due {fmtDate(inv.dueDate)}{inv.clientName ? ` · ${inv.clientName}` : ""}</p>
                            </div>
                            <span className="text-sm font-semibold text-foreground text-right shrink-0">{money(inv.total)}</span>
                            <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                          </div>
                        </Link>
                      ))}
                    </div>
                    <div className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 bg-muted/50 text-sm font-bold">
                      <span>Total{q || bucketStatus !== "all" || dateRangeActive ? " (filtered)" : ""} outstanding</span><span className="text-right text-orange-600">{money(filteredARTotal)}</span>
                    </div>
                    </>)}
                  </div>
                )
              )}

              {/* Cycle time */}
              {openBucket === "cycle" && (
                completedWithCycle.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">No completed jobs yet</div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    {filteredCycle.length === 0 ? (
                      <div className="py-10 text-center text-sm text-muted-foreground">No jobs match your search</div>
                    ) : (<>
                    <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      <span>Job</span><span className="text-right">Completed</span><span className="text-right">Cycle</span>
                    </div>
                    <div className="divide-y">
                      {filteredCycle.map(({ job, days }) => (
                        <Link key={job.id} href={`/jobs/${job.id}`} onClick={closeBucket}>
                          <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-3 items-center hover:bg-muted/50 cursor-pointer" data-testid={`bucket-row-cycle-${job.id}`}>
                            <div className="min-w-0 flex items-center gap-2">
                              <span className="text-lg shrink-0">{LOSS_ICONS[job.lossType] || "📋"}</span>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-foreground truncate">{job.jobNumber}</p>
                                <p className="text-xs text-muted-foreground truncate">{job.address || "No address"}</p>
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground text-right">{fmtDate(job.jobComplete)}</span>
                            <span className="text-sm font-semibold text-purple-600 text-right">{days}d</span>
                          </div>
                        </Link>
                      ))}
                    </div>
                    <div className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 bg-muted/50 text-sm font-bold">
                      <span>Average{q ? " (filtered)" : ""} cycle time</span><span className="text-right text-purple-600">{filteredAvgCycle}d</span>
                    </div>
                    </>)}
                  </div>
                )
              )}

              {/* Pending payouts */}
              {openBucket === "payouts" && (
                pendingPayoutList.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">No pending payout requests</div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="flex justify-end px-3 py-2 border-b bg-background">
                      <Button variant="outline" size="sm" onClick={exportPayoutsCSV} data-testid="button-export-payouts-csv" className="h-8 text-xs">
                        <Download className="w-3.5 h-3.5 mr-1.5" />Export CSV
                      </Button>
                    </div>
                    {filteredPayouts.length === 0 ? (
                      <div className="py-10 text-center text-sm text-muted-foreground">No payouts match your search</div>
                    ) : (<>
                    <div className="divide-y">
                      {filteredPayouts.map((p: any) => (
                        <Link key={p.id} href="/partner-portal" onClick={closeBucket}>
                          <div className="flex items-center gap-3 px-3 py-3 hover:bg-muted/50 cursor-pointer" data-testid={`bucket-row-payout-${p.id}`}>
                            <Users className="w-4 h-4 text-[hsl(var(--titan-red))] shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-foreground truncate">{p.partnerName || p.requestedBy || `Payout #${p.id}`}</p>
                              <p className="text-xs text-muted-foreground truncate">Requested {fmtDate(p.createdAt || p.requestedAt)}{p.jobId ? ` · Job #${p.jobId}` : ""}</p>
                            </div>
                            <span className="text-sm font-semibold text-foreground text-right shrink-0">{money(p.amount)}</span>
                            <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                          </div>
                        </Link>
                      ))}
                    </div>
                    <div className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 bg-muted/50 text-sm font-bold">
                      <span>Total{q || dateRangeActive ? " (filtered)" : ""} pending</span><span className="text-right text-[hsl(var(--titan-red))]">{money(filteredPayoutTotal)}</span>
                    </div>
                    </>)}
                  </div>
                )
              )}

            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
