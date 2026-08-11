/**
 * PartnerPortal.tsx — Admin payout management + Partner self-service portal
 *
 * Partner view tabs:
 *   1. Dashboard    — summary cards: jobs, earnings, pending payout
 *   2. My Jobs      — every referred job with status, stage, notes, and per-job earnings
 *   3. My Earnings  — payout history + pending payouts
 *   4. My Account   — payout method management
 *
 * Admin view:
 *   — Full payout request management + "Assign Partner to Job" quick action
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  DollarSign, Plus, CheckCircle, ExternalLink, Briefcase,
  TrendingUp, Clock, Home, FileText, ChevronDown, ChevronRight,
  Banknote, User, BadgeCheck, AlertCircle, MapPin, Wrench,
  Calendar, MessageSquare, Award, CreditCard, ArrowDownToLine,
  Send, XCircle, RefreshCw, Wallet, Heart, Percent, Target, Building2
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Contact, PayoutRequest, PayoutMethod, Job } from "@shared/schema";
import { fmtDate } from "@/lib/dates";

const PAYOUT_METHODS = ["cashapp", "venmo", "zelle", "direct_deposit"];

const STATUS_COLORS: Record<string, string> = {
  pending:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  paid:     "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

// Withdrawal status badge styles (admin queue)
const WD_STATUS_STYLE: Record<string, string> = {
  pending:    "bg-yellow-100 text-yellow-800",
  approved:   "bg-blue-100 text-blue-800",
  processing: "bg-purple-100 text-purple-800",
  paid:       "bg-green-100 text-green-800",
  rejected:   "bg-red-100 text-red-800",
};

const JOB_STATUS_COLORS: Record<string, string> = {
  new:            "bg-blue-100 text-blue-800",
  mitigation:     "bg-yellow-100 text-yellow-800",
  drying:         "bg-orange-100 text-orange-800",
  reconstruction: "bg-purple-100 text-purple-800",
  complete:       "bg-green-100 text-green-800",
  closed:         "bg-gray-100 text-gray-600",
};

const JOB_STATUS_LABELS: Record<string, string> = {
  new:            "New",
  mitigation:     "Mitigation",
  drying:         "Drying",
  reconstruction: "Reconstruction",
  complete:       "Complete",
  closed:         "Closed",
};

const LOSS_ICONS: Record<string, string> = {
  water: "💧", fire: "🔥", mold: "🟢", storm: "⛈️", biohazard: "☣️", reconstruction: "🏗️",
};

function fmt$(n: number) { return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtDate(d?: string | null) {
  if (!d) return "—";
  return fmtDate(d, { month: "short", day: "numeric", year: "numeric" });
}

// ── Job Progress Bar ──────────────────────────────────────────────────────────
function JobProgressBar({ status }: { status: string }) {
  const stages = ["new", "mitigation", "drying", "reconstruction", "complete"];
  const idx = stages.indexOf(status);
  return (
    <div className="flex items-center gap-0.5 mt-1">
      {stages.map((s, i) => (
        <div key={s} className="flex items-center gap-0.5 flex-1">
          <div className={`h-1.5 flex-1 rounded-full transition-colors ${i <= idx ? "bg-[hsl(var(--titan-blue))]" : "bg-muted"}`} />
        </div>
      ))}
    </div>
  );
}


// ── Withdraw Modal ────────────────────────────────────────────────────────────
function WithdrawModal({ partner, onClose }: { partner: Contact; onClose: () => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState("");
  const [note, setNote] = useState("");

  const { data: balance, isLoading: balLoading } = useQuery<{ totalEarned: number; totalWithdrawn: number; available: number }>({
    queryKey: ["/api/partner", String(partner.id), "balance"],
    queryFn: () => apiRequest("GET", `/api/partner/${partner.id}/balance`).then(r => r.json()),
  });

  const { data: allMethodsLocal = [] } = useQuery<PayoutMethod[]>({
    queryKey: ["/api/payout-methods"],
    queryFn: () => apiRequest("GET", "/api/payout-methods").then(r => r.json()),
  });
  const myMethods = allMethodsLocal.filter(m => m.contactId === partner.id);

  const METHOD_ICONS: Record<string, string> = { cashapp: "💵", venmo: "💙", zelle: "💜", direct_deposit: "🏦" };

  const withdraw = useMutation({
    mutationFn: () => apiRequest("POST", "/api/withdrawal-requests", {
      contactId: partner.id,
      amount: Number(amount),
      payoutMethodId: methodId ? Number(methodId) : null,
      partnerNote: note || null,
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/withdrawal-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/partner", String(partner.id), "balance"] });
      toast({ title: "Withdrawal requested!", description: "Titan will process your payment shortly." });
      onClose();
    },
    onError: async (err: any) => {
      // Try to get server error message
      toast({ title: "Request failed", description: err?.message || "Check your balance and try again.", variant: "destructive" });
    },
  });

  const available = balance?.available ?? 0;
  const requestedAmt = Number(amount) || 0;
  const valid = requestedAmt > 0 && requestedAmt <= available && myMethods.length > 0 && !!methodId;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-background border rounded-2xl shadow-2xl w-full max-w-sm space-y-4 p-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-green-500 to-[hsl(var(--titan-blue))] flex items-center justify-center">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Withdraw Funds</h3>
              <p className="text-xs text-muted-foreground">Available to withdraw</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><XCircle className="w-5 h-5" /></button>
        </div>

        {/* Available balance */}
        {balLoading ? (
          <div className="h-16 bg-muted animate-pulse rounded-xl" />
        ) : (
          <div className="rounded-xl bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 border border-green-200 dark:border-green-800 p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">Available Balance</p>
            <p className="text-3xl font-bold text-green-600">{fmt$(available)}</p>
            <div className="flex justify-center gap-4 mt-2 text-xs text-muted-foreground">
              <span>Earned: {fmt$(balance?.totalEarned ?? 0)}</span>
              <span>Withdrawn: {fmt$(balance?.totalWithdrawn ?? 0)}</span>
            </div>
          </div>
        )}

        {/* Amount */}
        <div>
          <Label className="text-xs font-medium">Amount to Withdraw</Label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">$</span>
            <Input
              type="number"
              className="pl-7 text-lg font-bold"
              placeholder="0.00"
              value={amount}
              max={available}
              min={1}
              step={0.01}
              onChange={e => setAmount(e.target.value)}
              data-testid="input-withdraw-amount"
            />
          </div>
          {requestedAmt > available && (
            <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />Exceeds available balance</p>
          )}
          {available > 0 && (
            <button className="text-xs text-[hsl(var(--titan-blue))] mt-1 hover:underline" onClick={() => setAmount(available.toFixed(2))}>
              Withdraw full amount ({fmt$(available)})
            </button>
          )}
        </div>

        {/* Payout method */}
        <div>
          <Label className="text-xs font-medium">Send to</Label>
          {myMethods.length === 0 ? (
            <div className="mt-1 p-3 rounded-lg border bg-yellow-50 dark:bg-yellow-950/20 text-xs text-yellow-700 dark:text-yellow-400 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              No payout methods on file. Go to the Account tab to add one first.
            </div>
          ) : (
            <div className="mt-1 space-y-2">
              {myMethods.map(m => (
                <label key={m.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${methodId === String(m.id) ? "border-[hsl(var(--titan-blue))] bg-blue-50 dark:bg-blue-950/20" : "hover:border-muted-foreground"}`}
                >
                  <input type="radio" name="method" value={m.id} checked={methodId === String(m.id)} onChange={() => setMethodId(String(m.id))} className="sr-only" />
                  <span className="text-xl">{METHOD_ICONS[m.method] || "💳"}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium capitalize">{m.method.replace("_", " ")}</p>
                    <p className="text-xs text-muted-foreground">{m.handle}</p>
                  </div>
                  {methodId === String(m.id) && <CheckCircle className="w-4 h-4 text-[hsl(var(--titan-blue))]" />}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Note */}
        <div>
          <Label className="text-xs font-medium">Note (optional)</Label>
          <Input className="mt-1 text-xs" placeholder="Any note for Titan team…" value={note} onChange={e => setNote(e.target.value)} data-testid="input-withdraw-note" />
        </div>

        {/* Submit */}
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold"
            disabled={!valid || withdraw.isPending || balLoading || available <= 0}
            onClick={() => withdraw.mutate()}
            data-testid="button-confirm-withdraw"
          >
            {withdraw.isPending ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Processing…</> : <><Send className="w-4 h-4 mr-2" />Request {requestedAmt > 0 ? fmt$(requestedAmt) : "Withdrawal"}</>}
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">Payments are processed by Titan Restoration · 706-922-0154</p>
      </div>
    </div>
  );
}

// ── Withdrawal History (partner view) ─────────────────────────────────────────
function WithdrawalHistory({ contactId }: { contactId: number }) {
  const { data: withdrawals = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/withdrawal-requests", String(contactId)],
    queryFn: () => apiRequest("GET", `/api/withdrawal-requests?contactId=${contactId}`).then(r => r.json()),
  });

  const STATUS_STYLE: Record<string, string> = {
    pending:    "bg-yellow-100 text-yellow-800",
    approved:   "bg-blue-100 text-blue-800",
    processing: "bg-purple-100 text-purple-800",
    paid:       "bg-green-100 text-green-800",
    rejected:   "bg-red-100 text-red-800",
  };
  const STATUS_ICON: Record<string, any> = {
    pending: Clock, approved: CheckCircle, processing: RefreshCw, paid: CheckCircle, rejected: XCircle,
  };

  if (isLoading) return <div className="h-16 bg-muted animate-pulse rounded-xl" />;
  if (withdrawals.length === 0) return (
    <div className="text-center py-6 text-xs text-muted-foreground border rounded-xl bg-muted/20">
      <ArrowDownToLine className="w-6 h-6 mx-auto mb-2 opacity-30" />
      No withdrawal requests yet
    </div>
  );

  return (
    <div className="space-y-2">
      {withdrawals.map((w: any) => {
        const method = w.method_snapshot ? JSON.parse(w.method_snapshot) : null;
        const Icon = STATUS_ICON[w.status] || Clock;
        return (
          <div key={w.id} className="flex items-start justify-between p-3 rounded-xl border bg-background text-sm">
            <div className="flex items-start gap-2.5">
              <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center ${STATUS_STYLE[w.status]}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div>
                <p className="font-semibold">{fmt$(w.amount)}</p>
                {method && <p className="text-xs text-muted-foreground capitalize">{method.method.replace("_"," ")} · {method.handle}</p>}
                <p className="text-xs text-muted-foreground">{fmtDate(w.requested_at)}</p>
                {w.admin_note && <p className="text-xs text-[hsl(var(--titan-blue))] mt-1 italic">"{w.admin_note}"</p>}
              </div>
            </div>
            <Badge className={`text-xs capitalize shrink-0 ${STATUS_STYLE[w.status]}`}>{w.status}</Badge>
          </div>
        );
      })}
    </div>
  );
}

// ── Partner Dashboard ─────────────────────────────────────────────────────────
function PartnerDashboard({ summary, partnerName, partner, onWithdraw }: { summary: any; partnerName: string; partner: Contact; onWithdraw: () => void }) {
  const { data: balance } = useQuery<{ totalEarned: number; totalWithdrawn: number; available: number }>({
    queryKey: ["/api/partner", String(partner.id), "balance"],
    queryFn: () => apiRequest("GET", `/api/partner/${partner.id}/balance`).then(r => r.json()),
  });
  const available = balance?.available ?? 0;

  // ── Partnership tenure calculation ───────────────────────────────────────────
  function getTenure(since: string | null | undefined): { label: string; days: number; months: number; years: number } {
    if (!since) return { label: "Partner", days: 0, months: 0, years: 0 };
    const start = new Date(since);
    const now = new Date();
    const diffMs = now.getTime() - start.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const months = Math.floor(days / 30.44);
    const years = Math.floor(days / 365.25);
    let label = "";
    if (years >= 1) {
      const remMonths = months - years * 12;
      label = remMonths > 0 ? `${years}y ${remMonths}mo` : `${years} year${years > 1 ? "s" : ""}`;
    } else if (months >= 1) {
      label = `${months} month${months > 1 ? "s" : ""}`;
    } else {
      label = `${days} day${days !== 1 ? "s" : ""}`;
    }
    return { label, days, months, years };
  }

  const tenure = getTenure(summary.partnerSince);
  const sinceDisplay = summary.partnerSince
    ? fmtDate(summary.partnerSince, { month: "long", day: "numeric", year: "numeric" })
    : null;

  const lifetimeStats = [
    { label: "Jobs Referred",      value: summary.totalJobs,            sub: `${summary.activeJobs} active · ${summary.completedJobs} complete`, icon: Briefcase, color: "text-[hsl(var(--titan-blue))]",  bg: "bg-blue-50 dark:bg-blue-950/30" },
    { label: "Total Earned",       value: fmt$(summary.totalEarned),    sub: "Lifetime commissions paid",                                         icon: Award,     color: "text-green-600",                 bg: "bg-green-50 dark:bg-green-950/30" },
    { label: "Pending Payout",     value: fmt$(summary.totalPending),   sub: "Approved · awaiting payment",                                       icon: Clock,     color: "text-yellow-600",                bg: "bg-yellow-50 dark:bg-yellow-950/30" },
    { label: "Warranty Visits",    value: summary.totalWarrantyCount ?? 0, sub: "Free fix-it visits on your jobs",                                icon: Wrench,    color: "text-orange-600",                bg: "bg-orange-50 dark:bg-orange-950/30" },
    { label: "Value Provided",     value: fmt$(summary.totalWarrantyCost ?? 0), sub: "Absorbed by Titan at no charge",                            icon: BadgeCheck, color: "text-rose-600",                bg: "bg-rose-50 dark:bg-rose-950/30" },
    { label: "Avg Job Value",      value: fmt$(summary.avgJobValue ?? 0),   sub: "Average across referred jobs",                                    icon: Target,    color: "text-cyan-600",                  bg: "bg-cyan-50 dark:bg-cyan-950/30" },
    { label: "Completion Rate",    value: `${summary.closeRate ?? 0}%`,     sub: `${summary.jobsThisYear ?? 0} referred this year`,                 icon: Percent,   color: "text-indigo-600",                bg: "bg-indigo-50 dark:bg-indigo-950/30" },
  ];

  return (
    <div className="space-y-4">
      {/* Hero welcome banner with tenure */}
      <div className="p-5 rounded-xl bg-gradient-to-r from-[hsl(var(--titan-red))] to-[hsl(var(--titan-blue))] text-white relative overflow-hidden">
        <div className="relative z-10">
          <p className="text-sm font-medium opacity-80">Welcome back,</p>
          <p className="text-2xl font-bold leading-tight">{partnerName}</p>
          {partner.company && <p className="text-sm opacity-75 mt-0.5">{partner.company}</p>}
          <div className="mt-3 pt-3 border-t border-white/20 flex items-center gap-4 flex-wrap">
            <div>
              <p className="text-xs opacity-70">Titan Partner Since</p>
              <p className="text-sm font-semibold">{sinceDisplay || "—"}</p>
            </div>
            <div className="h-8 w-px bg-white/20" />
            <div>
              <p className="text-xs opacity-70">Partnership Duration</p>
              <p className="text-sm font-bold">{tenure.label || "Just started!"}</p>
            </div>
            {tenure.days > 0 && (
              <>
                <div className="h-8 w-px bg-white/20" />
                <div>
                  <p className="text-xs opacity-70">Days Together</p>
                  <p className="text-sm font-bold">{tenure.days.toLocaleString()} days</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Available balance + Withdraw CTA */}
      <div className="rounded-xl border-2 border-green-300 dark:border-green-700 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5 text-green-600" />Available to Withdraw</p>
            <p className="text-3xl font-bold text-green-600 mt-0.5">{fmt$(available)}</p>
            {balance && (
              <p className="text-xs text-muted-foreground mt-1">
                {fmt$(balance.totalEarned)} earned · {fmt$(balance.totalWithdrawn)} withdrawn
              </p>
            )}
          </div>
          <Button
            onClick={onWithdraw}
            disabled={available <= 0}
            className="bg-green-600 hover:bg-green-700 text-white font-semibold shadow-lg"
            data-testid="button-withdraw-funds"
          >
            <ArrowDownToLine className="w-4 h-4 mr-1.5" />
            Withdraw
          </Button>
        </div>
      </div>

      {/* Goodwill tracker */}
      <div className="grid grid-cols-1 gap-3">
        <div className="rounded-xl border p-4 bg-gradient-to-br from-rose-50 to-pink-50 dark:from-rose-950/30 dark:to-pink-950/20" data-testid="card-goodwill">
          <div className="flex items-center gap-2 mb-2">
            <Heart className="w-4 h-4 text-rose-600" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Goodwill For Your Clients</span>
          </div>
          <p className="text-2xl font-bold text-rose-600" data-testid="text-goodwill-value">{fmt$(summary.goodwillValue ?? 0)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Value Titan has absorbed at no charge on your referred jobs — warranty visits and complimentary fixes that protect your reputation with your clients.
          </p>
        </div>
      </div>

      {/* Lifetime stats header */}
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest px-2">Lifetime Partnership Stats</p>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Lifetime counter grid */}
      <div className="grid grid-cols-2 gap-3">
        {lifetimeStats.map(c => (
          <div key={c.label} className={`rounded-xl p-3 border ${c.bg}`}>
            <div className="flex items-center gap-2 mb-1">
              <c.icon className={`w-4 h-4 ${c.color}`} />
              <span className="text-xs text-muted-foreground">{c.label}</span>
            </div>
            <p className={`text-lg font-bold ${c.color}`}>{typeof c.value === "number" ? c.value : c.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Partnership milestone badge */}
      {tenure.days >= 30 && (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <span className="text-2xl">
            {tenure.years >= 2 ? "🏆" : tenure.years >= 1 ? "🥇" : tenure.months >= 6 ? "🥈" : "⭐"}
          </span>
          <div>
            <p className="text-xs font-bold text-amber-800 dark:text-amber-400">
              {tenure.years >= 2 ? `${tenure.years}-Year Partner` :
               tenure.years >= 1 ? "1-Year Partner" :
               tenure.months >= 6 ? "6-Month Partner" : "Active Partner"}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-500">
              Thank you for {tenure.label} of partnership with Titan Restoration.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Partner Jobs List ─────────────────────────────────────────────────────────
function PartnerJobCard({ job }: { job: any }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="overflow-hidden" data-testid={`partner-job-${job.id}`}>
      <CardContent className="p-0">
        {/* Header row */}
        <button
          className="w-full text-left p-4 hover:bg-muted/30 transition-colors"
          onClick={() => setExpanded(e => !e)}
          data-testid={`button-expand-job-${job.id}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm text-[hsl(var(--titan-blue))]">{job.jobNumber}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${JOB_STATUS_COLORS[job.status] || "bg-gray-100 text-gray-600"}`}>
                  {JOB_STATUS_LABELS[job.status] || job.status}
                </span>
                {job.lossType && (
                  <span className="text-xs text-muted-foreground">
                    {LOSS_ICONS[job.lossType] || "📋"} {job.lossType.charAt(0).toUpperCase() + job.lossType.slice(1)}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 truncate">
                <MapPin className="w-3 h-3 shrink-0" />
                {job.address || "Address not set"}
              </p>
              <JobProgressBar status={job.status} />
            </div>
            <div className="text-right shrink-0">
              {job.paidToDate > 0 && (
                <p className="text-sm font-bold text-green-600">{fmt$(job.paidToDate)}<span className="text-xs font-normal text-muted-foreground ml-1">earned</span></p>
              )}
              {job.pendingPayoutAmount && (
                <p className="text-xs text-yellow-600 font-medium">{fmt$(job.pendingPayoutAmount)} <span className="opacity-75">{job.pendingPayoutStatus}</span></p>
              )}
              {!job.paidToDate && !job.pendingPayoutAmount && (
                <p className="text-xs text-muted-foreground">Payout TBD</p>
              )}
              <div className="flex items-center justify-end mt-1 text-muted-foreground">
                {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </div>
            </div>
          </div>
        </button>

        {/* Expanded details */}
        {expanded && (
          <div className="border-t bg-muted/20 px-4 pb-4 pt-3 space-y-3">
            {/* Job details grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div><span className="text-muted-foreground">Referred:</span> <span className="font-medium">{fmtDate(job.createdAt)}</span></div>
              <div><span className="text-muted-foreground">Tech:</span> <span className="font-medium">{job.assignedTech || "Unassigned"}</span></div>
              {job.mitigationStart && <div><span className="text-muted-foreground">Mitigation:</span> <span className="font-medium">{fmtDate(job.mitigationStart)}</span></div>}
              {job.jobComplete && <div><span className="text-muted-foreground">Completed:</span> <span className="font-medium">{fmtDate(job.jobComplete)}</span></div>}
              {job.insuranceCarrier && <div className="col-span-2"><span className="text-muted-foreground">Carrier:</span> <span className="font-medium">{job.insuranceCarrier}</span></div>}
              {job.totalInvoiced > 0 && <div className="col-span-2"><span className="text-muted-foreground">Job Value:</span> <span className="font-bold text-foreground">{fmt$(job.totalInvoiced)}</span></div>}
            </div>

            {/* Payout status */}
            <div className="flex items-center gap-2 p-2 rounded-lg border bg-background text-xs">
              <Banknote className="w-4 h-4 text-[hsl(var(--titan-blue))] shrink-0" />
              <div className="flex-1">
                {job.paidToDate > 0 && job.pendingPayoutAmount && (
                  <span><span className="font-semibold text-green-600">{fmt$(job.paidToDate)} paid</span> · <span className="text-yellow-600">{fmt$(job.pendingPayoutAmount)} {job.pendingPayoutStatus}</span></span>
                )}
                {job.paidToDate > 0 && !job.pendingPayoutAmount && (
                  <span className="font-semibold text-green-600">✓ {fmt$(job.paidToDate)} paid in full</span>
                )}
                {!job.paidToDate && job.pendingPayoutAmount && (
                  <span className="text-yellow-600 font-semibold">{fmt$(job.pendingPayoutAmount)} {job.pendingPayoutStatus} — awaiting payment</span>
                )}
                {!job.paidToDate && !job.pendingPayoutAmount && (
                  <span className="text-muted-foreground">Payout will be added when job invoices are processed</span>
                )}
              </div>
            </div>

            {/* Public notes / status updates */}
            {job.publicNotes && job.publicNotes.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-[hsl(var(--titan-blue))]" />
                  Status Updates from Titan ({job.publicNotes.length})
                </p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {job.publicNotes.map((note: any) => (
                    <div key={note.id} className="rounded-lg border bg-background p-2.5 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-[hsl(var(--titan-blue))]">{note.author}</span>
                        <span className="text-muted-foreground">{fmtDate(note.createdAt)}</span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">{note.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(!job.publicNotes || job.publicNotes.length === 0) && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 italic">
                <MessageSquare className="w-3 h-3" />No status updates posted yet — check back soon.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


// ── Partner Warranty Summary (partner-facing) ─────────────────────────────────
function PartnerWarrantySummary({ contactId }: { contactId: number }) {
  const { data, isLoading } = useQuery<{ calls: any[]; totalCalls: number; totalCostAbsorbed: number }>({
    queryKey: ["/api/partner", String(contactId), "warranty-calls"],
    queryFn: () => apiRequest("GET", `/api/partner/${contactId}/warranty-calls`).then(r => r.json()),
    staleTime: 0,
  });

  const calls = data?.calls || [];
  const totalCostAbsorbed = data?.totalCostAbsorbed || 0;
  const totalCalls = data?.totalCalls || 0;

  if (isLoading) return <div className="text-xs text-muted-foreground py-2">Loading warranty history…</div>;

  return (
    <div className="space-y-3">
      {/* Value banner */}
      <div className="rounded-xl border-2 border-orange-300 dark:border-orange-700 bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center flex-shrink-0">
            <Wrench className="w-5 h-5 text-orange-600" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">Titan has provided <span className="font-bold text-orange-700 dark:text-orange-400">{totalCalls} complimentary fix-it visit{totalCalls !== 1 ? "s" : ""}</span> on your referred jobs</p>
            <p className="text-xl font-bold text-orange-700 dark:text-orange-400 mt-0.5">{fmt$(totalCostAbsorbed)} in value provided</p>
            <p className="text-xs text-muted-foreground">at no charge to you — part of the Titan partner program</p>
          </div>
        </div>
      </div>

      {calls.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">No warranty visits on your jobs yet.</p>
      ) : (
        <div className="space-y-2">
          {calls.map((wc: any) => (
            <div key={wc.id} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20">
              <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Wrench className="w-4 h-4 text-orange-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-[hsl(var(--titan-blue))]">{wc.jobNumber}</span>
                  <span className="text-xs text-muted-foreground">{wc.visitDate}</span>
                  {wc.techAssigned && <span className="text-xs text-muted-foreground">· Tech: {wc.techAssigned}</span>}
                </div>
                <p className="text-sm font-medium mt-0.5 leading-snug">{wc.issueDescription}</p>
                {wc.resolution && <p className="text-xs text-muted-foreground mt-0.5">{wc.resolution}</p>}
                {wc.partnerNote && (
                  <p className="text-xs text-blue-700 dark:text-blue-400 mt-1 italic">"{wc.partnerNote}"</p>
                )}
                <p className="text-xs font-semibold text-orange-700 dark:text-orange-400 mt-1">
                  Value absorbed: {fmt$(wc.totalCost || 0)} — charged to you: $0.00
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Partner Earnings View ─────────────────────────────────────────────────────
function PartnerEarnings({ myPayouts, jobs }: { myPayouts: PayoutRequest[]; jobs: Job[] }) {
  const paid    = myPayouts.filter(p => p.status === "paid");
  const pending = myPayouts.filter(p => p.status === "pending" || p.status === "approved");
  const totalPaid    = paid.reduce((s, p) => s + p.amount, 0);
  const totalPending = pending.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl p-3 border bg-green-50 dark:bg-green-950/30">
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5 text-green-600" />Total Paid Out</p>
          <p className="text-xl font-bold text-green-600">{fmt$(totalPaid)}</p>
          <p className="text-xs text-muted-foreground">{paid.length} payment{paid.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="rounded-xl p-3 border bg-yellow-50 dark:bg-yellow-950/30">
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-yellow-600" />Pending</p>
          <p className="text-xl font-bold text-yellow-600">{fmt$(totalPending)}</p>
          <p className="text-xs text-muted-foreground">{pending.length} awaiting payment</p>
        </div>
      </div>

      {/* Pending payouts */}
      {pending.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2 text-yellow-700 dark:text-yellow-400 uppercase tracking-wide">Pending Payouts</p>
          <div className="space-y-2">
            {pending.map(p => {
              const job = jobs.find(j => j.id === p.jobId);
              return (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border bg-yellow-50/50 dark:bg-yellow-950/20 text-sm">
                  <div>
                    <p className="font-medium">{p.description || "Referral Payout"}</p>
                    {job && <p className="text-xs text-[hsl(var(--titan-blue))] flex items-center gap-1 mt-0.5"><Briefcase className="w-3 h-3" />{job.jobNumber}</p>}
                    <p className="text-xs text-muted-foreground">{fmtDate(p.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-yellow-700">{fmt$(p.amount)}</p>
                    <Badge className={`text-xs mt-1 ${STATUS_COLORS[p.status]}`}>{p.status}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Paid history */}
      <div>
        <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Payment History</p>
        {paid.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No payments yet.</p>
        ) : (
          <div className="space-y-2">
            {paid.map(p => {
              const job = jobs.find(j => j.id === p.jobId);
              return (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg border bg-background text-sm">
                  <div>
                    <p className="font-medium">{p.description || "Referral Payout"}</p>
                    {job && <p className="text-xs text-[hsl(var(--titan-blue))] flex items-center gap-1 mt-0.5"><Briefcase className="w-3 h-3" />{job.jobNumber}</p>}
                    <p className="text-xs text-muted-foreground">{p.paidAt ? `Paid ${fmtDate(p.paidAt)}` : fmtDate(p.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-600">{fmt$(p.amount)}</p>
                    <Badge className={`text-xs mt-1 ${STATUS_COLORS[p.status]}`}>Paid</Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Partner Account / Payout Methods ─────────────────────────────────────────
const LEAD_STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  submitted: { label: "Submitted",  cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
  contacted: { label: "Contacted",  cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  scheduled: { label: "Scheduled",  cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300" },
  converted: { label: "Converted",  cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  declined:  { label: "Declined",   cls: "bg-muted text-muted-foreground" },
};
const leadDate = (s?: string | null) => s ? fmtDate(s, { month: "short", day: "numeric", year: "numeric" }) : "\u2014";

function ReferJob({ partner }: { partner: Contact }) {
  const { toast } = useToast();
  const empty = {
    customerName: "", customerPhone: "", customerEmail: "", lossAddress: "",
    lossType: "water", insuranceCarrier: "", claimNumber: "", urgency: "standard", description: "",
  };
  const [form, setForm] = useState(empty);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const { data: leads = [], refetch } = useQuery<any[]>({
    queryKey: ["/api/partner/leads", partner.id],
    queryFn: () => apiRequest("GET", `/api/partner/${partner.id}/leads`).then(r => r.json()),
    staleTime: 0,
  });

  const submit = useMutation({
    mutationFn: () => apiRequest("POST", `/api/partner/${partner.id}/leads`, form).then(r => r.json()),
    onSuccess: () => {
      setForm(empty);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/partner/leads", partner.id] });
      toast({ title: "Job sent to Titan", description: "Our team will reach out to the customer shortly. Thank you for the referral!" });
    },
    onError: (err: any) => {
      toast({ title: "Could not submit", description: err?.message || "Please check the form and try again.", variant: "destructive" });
    },
  });

  const canSubmit = form.customerName.trim() && (form.customerPhone.trim() || form.lossAddress.trim());

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Send className="w-4 h-4 text-[hsl(var(--titan-red))]" />Refer a Job to Titan</CardTitle>
          <p className="text-xs text-muted-foreground">Send us a new customer and we'll take it from here. You'll earn your referral bonus when the job converts.</p>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Customer name <span className="text-[hsl(var(--titan-red))]">*</span></Label>
              <Input value={form.customerName} onChange={e => set("customerName", e.target.value)} placeholder="e.g. Jane Doe" data-testid="input-lead-name" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Customer phone</Label>
              <Input value={form.customerPhone} onChange={e => set("customerPhone", e.target.value)} placeholder="706-555-0000" data-testid="input-lead-phone" />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Customer email</Label>
              <Input value={form.customerEmail} onChange={e => set("customerEmail", e.target.value)} placeholder="optional" data-testid="input-lead-email" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Loss address</Label>
              <Input value={form.lossAddress} onChange={e => set("lossAddress", e.target.value)} placeholder="Street, City, GA" data-testid="input-lead-address" />
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Loss type</Label>
              <Select value={form.lossType} onValueChange={v => set("lossType", v)}>
                <SelectTrigger data-testid="select-lead-losstype"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="water">Water</SelectItem>
                  <SelectItem value="fire">Fire / Smoke</SelectItem>
                  <SelectItem value="mold">Mold</SelectItem>
                  <SelectItem value="storm">Storm / Wind</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Urgency</Label>
              <Select value={form.urgency} onValueChange={v => set("urgency", v)}>
                <SelectTrigger data-testid="select-lead-urgency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="emergency">Emergency (24hr)</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="scheduled">Not urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Insurance carrier</Label>
              <Input value={form.insuranceCarrier} onChange={e => set("insuranceCarrier", e.target.value)} placeholder="optional" data-testid="input-lead-carrier" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">What happened?</Label>
            <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3}
              placeholder="Brief description of the damage so our team can prioritize the response." data-testid="input-lead-description" />
          </div>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />Include at least a phone number or address so we can reach the customer.</p>
          <Button className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)] text-white"
            disabled={!canSubmit || submit.isPending} onClick={() => submit.mutate()} data-testid="button-submit-lead">
            <Send className="w-4 h-4 mr-2" />{submit.isPending ? "Sending\u2026" : "Send Job to Titan"}
          </Button>
        </CardContent>
      </Card>

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">My Referrals ({leads.length})</p>
        {leads.length === 0 ? (
          <div className="text-center py-8 border rounded-xl bg-muted/20">
            <Send className="w-7 h-7 mx-auto mb-2 text-muted-foreground opacity-40" />
            <p className="text-sm font-medium text-muted-foreground">No referrals yet</p>
            <p className="text-xs text-muted-foreground mt-1">Jobs you send will show up here with live status.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {leads.map((l: any) => {
              const st = LEAD_STATUS_STYLE[l.status] || LEAD_STATUS_STYLE.submitted;
              return (
                <div key={l.id} className="border rounded-xl p-3 bg-card" data-testid={`lead-row-${l.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-tight">{l.customer_name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {[l.loss_type && l.loss_type.charAt(0).toUpperCase() + l.loss_type.slice(1), l.loss_address, l.insurance_carrier].filter(Boolean).join(" \u00b7 ") || "\u2014"}
                      </p>
                    </div>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[11px] text-muted-foreground">Sent {leadDate(l.created_at)}</span>
                    {l.urgency === "emergency" && <span className="text-[11px] font-medium text-[hsl(var(--titan-red))] flex items-center gap-1"><AlertCircle className="w-3 h-3" />Emergency</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PartnerAccount({ partner }: { partner: Contact }) {
  const { toast } = useToast();
  const [newMethod, setNewMethod] = useState({ method: "cashapp", handle: "" });
  const { data: allMethodsLocal = [], refetch: refetchMethods } = useQuery<PayoutMethod[]>({
    queryKey: ["/api/payout-methods"],
    queryFn: () => apiRequest("GET", "/api/payout-methods").then(r => r.json()),
    staleTime: 0,
  });
  const myMethods = allMethodsLocal.filter(m => m.contactId === partner.id);
  const addMyMethod = useMutation({
    mutationFn: () => apiRequest("POST", "/api/payout-methods", { ...newMethod, contactId: partner.id }).then(r => r.json()),
    onSuccess: () => {
      refetchMethods();
      queryClient.invalidateQueries({ queryKey: ["/api/payout-methods"] });
      setNewMethod({ method: "cashapp", handle: "" });
      toast({ title: "Payout method added", description: `${newMethod.method.replace("_"," ")} — ${newMethod.handle}` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add method", description: err?.message || "Please try again.", variant: "destructive" });
    },
  });
  const deleteMethod = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/payout-methods/${id}`).then(r => r.json()),
    onSuccess: () => { refetchMethods(); toast({ title: "Method removed" }); },
    onError: () => { toast({ title: "Failed to remove method", variant: "destructive" }); },
  });
  const METHOD_ICONS: Record<string, string> = { cashapp: "💵", venmo: "💙", zelle: "💜", direct_deposit: "🏦" };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><User className="w-4 h-4" />My Profile</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-1 text-sm">
          <div className="flex items-center gap-2"><span className="text-muted-foreground w-20">Name</span><span className="font-medium">{partner.name}</span></div>
          {partner.company && <div className="flex items-center gap-2"><span className="text-muted-foreground w-20">Company</span><span className="font-medium">{partner.company}</span></div>}
          {partner.phone && <div className="flex items-center gap-2"><span className="text-muted-foreground w-20">Phone</span><span className="font-medium">{partner.phone}</span></div>}
          <div className="flex items-center gap-2"><span className="text-muted-foreground w-20">Type</span><Badge variant="outline" className="capitalize text-xs">{partner.type}</Badge></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><CreditCard className="w-4 h-4" />Payout Methods</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-2">
          {myMethods.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">No payout methods added yet. Add one below so Titan can send you funds.</p>
          )}
          {myMethods.map(m => (
            <div key={m.id} className="flex items-center gap-3 p-2.5 bg-muted rounded-lg text-sm">
              <span className="text-lg">{METHOD_ICONS[m.method] || "💳"}</span>
              <div className="flex-1">
                <span className="font-medium capitalize">{m.method.replace("_", " ")}</span>
                <span className="text-muted-foreground ml-2 text-xs">{m.handle}</span>
              </div>
              {m.isDefault && <Badge className="bg-green-100 text-green-700 text-xs">Default</Badge>}
              <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive"
                onClick={() => deleteMethod.mutate(m.id)} disabled={deleteMethod.isPending}>
                <XCircle className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}

          <div className="pt-2 border-t space-y-2">
            <p className="text-xs font-medium">Add Payout Method</p>
            <div className="grid grid-cols-3 gap-2">
              <Select value={newMethod.method} onValueChange={v => setNewMethod(m => ({ ...m, method: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYOUT_METHODS.map(m => (
                    <SelectItem key={m} value={m}>{METHOD_ICONS[m]} {m.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input className="h-8 text-xs col-span-2" placeholder="$cashtag, phone, or account #"
                value={newMethod.handle} onChange={e => setNewMethod(m => ({ ...m, handle: e.target.value }))} />
            </div>
            <Button size="sm" variant="outline" className="w-full" onClick={() => addMyMethod.mutate()}
              disabled={addMyMethod.isPending || !newMethod.handle} data-testid="button-add-payout-method">
              <Plus className="w-3.5 h-3.5 mr-1" />Add Method
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="text-center text-xs text-muted-foreground p-3 border rounded-lg bg-muted/20">
        <p className="font-medium text-foreground mb-1">Questions about your account?</p>
        <p>Call Titan Restoration at <a href="tel:7069220154" className="text-[hsl(var(--titan-blue))] font-medium">706-922-0154</a></p>
      </div>
    </div>
  );
}

// ── Partner Full View (after login) ──────────────────────────────────────────
// ── Company Portal View ───────────────────────────────────────────────────────
// Shown when a referral COMPANY logs in. Read-only summary of everything Titan
// has paid the company, aggregated across all its attached techs, with a
// per-tech breakdown and a full payment history.
function CompanyPortalView({ company, onLogout }: { company: Contact; onLogout: () => void }) {
  const { data, isLoading } = useQuery<{
    company: { id: number; name: string; email: string | null; phone: string | null };
    totalPaid: number;
    techCount: number;
    perTech: { id: number; name: string; email: string | null; paid: number; isCompany: boolean }[];
    payments: { id: number; amount: number; method: string; reference: string | null; paidAt: string; payee: string; jobNumber: string | null; jobAddress: string | null }[];
  }>({
    queryKey: ["/api/partner", String(company.id), "company-summary"],
    queryFn: () => apiRequest("GET", `/api/partner/${company.id}/company-summary`).then(r => r.json()),
  });

  const fmt = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (s: string) => s ? fmtDate(s, undefined, { month: "short", day: "numeric", year: "numeric" }) : "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-green-600 flex items-center justify-center text-white"><Building2 className="w-5 h-5" /></div>
          <div>
            <p className="font-semibold text-sm leading-tight" data-testid="text-portal-company-name">{company.name}</p>
            <p className="text-xs text-muted-foreground">Referral Company Portal</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onLogout} className="text-xs" data-testid="button-company-logout">Log Out</Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />)}</div>
      ) : (
        <div className="space-y-4">
          {/* Total paid hero */}
          <Card className="border-green-200">
            <CardContent className="p-5 text-center">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total Paid to {company.name}</p>
              <p className="text-3xl font-bold text-green-700 mt-1" data-testid="text-company-total-paid">{fmt(data?.totalPaid || 0)}</p>
              <p className="text-xs text-muted-foreground mt-1">Across {data?.techCount || 0} tech{(data?.techCount || 0) === 1 ? "" : "s"} + company direct</p>
            </CardContent>
          </Card>

          {/* Per-tech breakdown */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Paid by Tech</p>
            <div className="space-y-1.5">
              {(data?.perTech || []).filter(t => t.isCompany ? t.paid > 0 : true).map(t => (
                <div key={t.id} className="flex items-center justify-between border rounded-md px-3 py-2 text-sm bg-muted/20" data-testid={`tech-payout-${t.id}`}>
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="font-medium">{t.name}</span>
                  </div>
                  <span className="font-semibold text-green-700">{fmt(t.paid)}</span>
                </div>
              ))}
              {(data?.perTech || []).length === 0 && <p className="text-xs text-muted-foreground">No techs attached.</p>}
            </div>
          </div>

          {/* Payment history */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Payment History</p>
            {(data?.payments || []).length === 0 ? (
              <div className="text-center py-8 border rounded-xl bg-muted/20">
                <DollarSign className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-40" />
                <p className="text-sm font-medium text-muted-foreground">No payments recorded yet</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {(data?.payments || []).map(p => (
                  <div key={p.id} className="border rounded-md px-3 py-2 text-sm" data-testid={`payment-row-${p.id}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-green-700">{fmt(p.amount)}</span>
                      <span className="text-xs text-muted-foreground">{fmtDate(p.paidAt)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground mt-0.5">
                      <span>{p.payee}{p.jobNumber ? ` · Job ${p.jobNumber}` : ""}</span>
                      <span className="capitalize">{p.method}{p.reference ? ` · ${p.reference}` : ""}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PartnerView({ loggedInPartner, onLogout, jobs }: {
  loggedInPartner: Contact;
  onLogout: () => void;
  jobs: Job[];
}) {
  const [showWithdraw, setShowWithdraw] = useState(false);

  // Own live queries so mutations immediately reflect without parent re-render
  const { data: allRequestsLive = [] } = useQuery<PayoutRequest[]>({
    queryKey: ["/api/payout-requests"],
    queryFn: () => apiRequest("GET", "/api/payout-requests").then(r => r.json()),
  });
  const myPayouts = allRequestsLive.filter(r => r.contactId === loggedInPartner.id);

  const { data: partnerData, isLoading } = useQuery({
    queryKey: ["/api/partner", String(loggedInPartner.id), "jobs"],
    queryFn: () => apiRequest("GET", `/api/partner/${loggedInPartner.id}/jobs`).then(r => r.json()),
  });

  const summary = partnerData?.summary || { totalJobs: 0, activeJobs: 0, completedJobs: 0, totalInvoiced: 0, totalEarned: 0, totalPending: 0 };
  const partnerJobs: any[] = partnerData?.jobs || [];

  return (
    <div className="space-y-4">
      {showWithdraw && <WithdrawModal partner={loggedInPartner} onClose={() => setShowWithdraw(false)} />}

      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[hsl(var(--titan-red))] to-[hsl(var(--titan-blue))] flex items-center justify-center text-white font-bold text-sm">
            {loggedInPartner.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight">{loggedInPartner.name}</p>
            <p className="text-xs text-muted-foreground capitalize">{loggedInPartner.type} Partner</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white text-xs" onClick={() => setShowWithdraw(true)} data-testid="button-header-withdraw">
            <Wallet className="w-3.5 h-3.5 mr-1" />Withdraw
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-xs">Log Out</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />)}</div>
      ) : (
        <Tabs defaultValue="dashboard">
          <TabsList className="w-full grid grid-cols-5 h-9">
            <TabsTrigger value="dashboard" className="text-xs"><TrendingUp className="w-3 h-3 mr-1 hidden sm:inline" />Dashboard</TabsTrigger>
            <TabsTrigger value="refer" className="text-xs"><Send className="w-3 h-3 mr-1 hidden sm:inline" />Refer</TabsTrigger>
            <TabsTrigger value="jobs" className="text-xs"><Briefcase className="w-3 h-3 mr-1 hidden sm:inline" />My Jobs <Badge className="ml-1 h-4 text-xs px-1 bg-[hsl(var(--titan-blue))] text-white">{partnerJobs.length}</Badge></TabsTrigger>
            <TabsTrigger value="earnings" className="text-xs"><DollarSign className="w-3 h-3 mr-1 hidden sm:inline" />Earnings</TabsTrigger>
            <TabsTrigger value="account" className="text-xs"><User className="w-3 h-3 mr-1 hidden sm:inline" />Account</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="mt-4">
            <PartnerDashboard summary={summary} partnerName={loggedInPartner.name} partner={loggedInPartner} onWithdraw={() => setShowWithdraw(true)} />
          </TabsContent>

          <TabsContent value="refer" className="mt-4">
            <ReferJob partner={loggedInPartner} />
          </TabsContent>

          <TabsContent value="jobs" className="mt-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{partnerJobs.length} Referred Job{partnerJobs.length !== 1 ? "s" : ""}</p>
                <p className="text-xs text-muted-foreground">Tap any job to expand</p>
              </div>
              {partnerJobs.length === 0 ? (
                <div className="text-center py-12 border rounded-xl bg-muted/20">
                  <Briefcase className="w-8 h-8 mx-auto mb-2 text-muted-foreground opacity-40" />
                  <p className="text-sm font-medium text-muted-foreground">No jobs linked yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Jobs you refer will appear here once Titan links them to your account.</p>
                </div>
              ) : (
                partnerJobs.map((job: any) => <PartnerJobCard key={job.id} job={job} />)
              )}
            </div>
          </TabsContent>

          <TabsContent value="earnings" className="mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Earnings & Payouts</p>
                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white text-xs" onClick={() => setShowWithdraw(true)} data-testid="button-earnings-withdraw">
                  <ArrowDownToLine className="w-3.5 h-3.5 mr-1" />Withdraw Funds
                </Button>
              </div>
              <PartnerEarnings myPayouts={myPayouts} jobs={jobs} />
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Withdrawal History</p>
                <WithdrawalHistory contactId={loggedInPartner.id} />
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Warranty & Free Fix-It Visits</p>
                <PartnerWarrantySummary contactId={loggedInPartner.id} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="account" className="mt-4">
            <PartnerAccount partner={loggedInPartner} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ── Admin View ────────────────────────────────────────────────────────────────
function AdminView({
  contacts, allRequests, allMethods, jobs, partners,
}: {
  contacts: Contact[]; allRequests: PayoutRequest[]; allMethods: PayoutMethod[]; jobs: Job[]; partners: Contact[];
}) {
  const [addPayoutOpen, setAddPayoutOpen] = useState(false);
  const [addMethodOpen, setAddMethodOpen] = useState(false);
  const [payoutForm, setPayoutForm] = useState({ contactId: "", jobId: "", amount: "", description: "", adminNotes: "" });
  const [methodForm, setMethodForm] = useState({ contactId: "", method: "cashapp", handle: "" });
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({ jobId: "", partnerId: "" });

  const createPayout = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/payout-requests", data).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payout-requests"] }); setAddPayoutOpen(false); setPayoutForm({ contactId: "", jobId: "", amount: "", description: "", adminNotes: "" }); },
  });
  const updatePayout = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/payout-requests/${id}`, data).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/payout-requests"] }),
  });
  const createMethod = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/payout-methods", data).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payout-methods"] }); setAddMethodOpen(false); },
  });
  const assignPartner = useMutation({
    mutationFn: ({ jobId, partnerId }: { jobId: number; partnerId: number | null }) =>
      apiRequest("PATCH", `/api/jobs/${jobId}/referral-partner`, { referralPartnerId: partnerId }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/jobs"] }); setAssignOpen(false); },
  });

  // Withdrawal requests — live query
  const { data: allWithdrawals = [], refetch: refetchWithdrawals } = useQuery<any[]>({
    queryKey: ["/api/withdrawal-requests"],
    queryFn: () => apiRequest("GET", "/api/withdrawal-requests").then(r => r.json()),
  });
  const actionWithdrawal = useMutation({
    mutationFn: ({ id, status, adminNote }: { id: number; status: string; adminNote?: string }) =>
      apiRequest("PATCH", `/api/withdrawal-requests/${id}`, { status, adminNote }).then(r => r.json()),
    onSuccess: () => { refetchWithdrawals(); queryClient.invalidateQueries({ queryKey: ["/api/withdrawal-requests"] }); },
  });
  const pendingWithdrawals = allWithdrawals.filter((w: any) => w.status === "pending" || w.status === "approved" || w.status === "processing");

  const grouped: Record<string, PayoutRequest[]> = {};
  for (const req of allRequests) {
    const name = contacts.find(c => c.id === req.contactId)?.name || "Unknown";
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push(req);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-bold text-sm">Admin — Payout Management</h2>
        <div className="flex gap-2 flex-wrap">
          {/* Assign Partner to Job */}
          <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-assign-partner"><Briefcase className="w-3.5 h-3.5 mr-1" />Assign Partner to Job</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Assign Referral Partner to Job</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Job</Label>
                  <Select value={assignForm.jobId} onValueChange={v => setAssignForm(f => ({ ...f, jobId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select job" /></SelectTrigger>
                    <SelectContent>{jobs.slice(0, 50).map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber} — {j.address?.split(",")[0] || j.lossType}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Referral Partner</Label>
                  <Select value={assignForm.partnerId} onValueChange={v => setAssignForm(f => ({ ...f, partnerId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select partner" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Remove partner —</SelectItem>
                      {partners.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.type})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full bg-[hsl(var(--titan-blue))] text-white"
                  disabled={assignPartner.isPending || !assignForm.jobId}
                  onClick={() => assignPartner.mutate({ jobId: Number(assignForm.jobId), partnerId: assignForm.partnerId && assignForm.partnerId !== "none" ? Number(assignForm.partnerId) : null })}
                  data-testid="button-confirm-assign-partner">
                  {assignPartner.isPending ? "Saving…" : "Save Assignment"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={addMethodOpen} onOpenChange={setAddMethodOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm"><Plus className="w-3.5 h-3.5 mr-1" />Payout Method</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Payout Method</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Partner</Label>
                  <Select value={methodForm.contactId} onValueChange={v => setMethodForm(f => ({ ...f, contactId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select partner" /></SelectTrigger>
                    <SelectContent>{partners.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Method</Label>
                  <Select value={methodForm.method} onValueChange={v => setMethodForm(f => ({ ...f, method: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PAYOUT_METHODS.map(m => <SelectItem key={m} value={m}>{m.replace("_", " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Handle / Account Info</Label><Input value={methodForm.handle} onChange={e => setMethodForm(f => ({ ...f, handle: e.target.value }))} placeholder="$cashtag, phone, or account #" /></div>
                <Button className="w-full bg-[hsl(var(--titan-blue))] text-white"
                  onClick={() => createMethod.mutate({ ...methodForm, contactId: Number(methodForm.contactId) })}
                  disabled={createMethod.isPending}>Save</Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={addPayoutOpen} onOpenChange={setAddPayoutOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white" size="sm" data-testid="button-new-payout">
                <Plus className="w-3.5 h-3.5 mr-1" />New Payout
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Payout Request</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Partner</Label>
                  <Select value={payoutForm.contactId} onValueChange={v => setPayoutForm(f => ({ ...f, contactId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select partner" /></SelectTrigger>
                    <SelectContent>{partners.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.type})</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Link to Job</Label>
                  <Select value={payoutForm.jobId} onValueChange={v => setPayoutForm(f => ({ ...f, jobId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select job" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No job linked</SelectItem>
                      {jobs.slice(0, 50).map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber} — {j.address?.split(",")[0] || j.lossType}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Amount ($)</Label><Input type="number" value={payoutForm.amount} onChange={e => setPayoutForm(f => ({ ...f, amount: e.target.value }))} /></div>
                <div><Label>Description</Label><Input value={payoutForm.description} onChange={e => setPayoutForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Referral – Hayes Water Loss" /></div>
                <div><Label>Admin Notes</Label><Textarea value={payoutForm.adminNotes} onChange={e => setPayoutForm(f => ({ ...f, adminNotes: e.target.value }))} /></div>
                <Button className="w-full bg-[hsl(var(--titan-red))] text-white" disabled={createPayout.isPending}
                  onClick={() => createPayout.mutate({ ...payoutForm, contactId: Number(payoutForm.contactId), jobId: payoutForm.jobId ? Number(payoutForm.jobId) : null, amount: Number(payoutForm.amount) })}
                  data-testid="button-confirm-payout">Create Payout</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Withdrawal Requests Queue */}
      {pendingWithdrawals.length > 0 && (
        <div className="border-2 border-green-300 dark:border-green-700 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-green-50 dark:bg-green-950/30 border-b border-green-200 dark:border-green-800">
            <div className="flex items-center gap-2">
              <ArrowDownToLine className="w-4 h-4 text-green-600" />
              <span className="font-bold text-sm text-green-800 dark:text-green-300">Withdrawal Requests</span>
              <Badge className="bg-green-600 text-white text-xs">{pendingWithdrawals.length} pending</Badge>
            </div>
          </div>
          <div className="divide-y">
            {pendingWithdrawals.map((w: any) => {
              const contact = contacts.find(c => c.id === w.contact_id);
              const method = w.method_snapshot ? JSON.parse(w.method_snapshot) : null;
              return (
                <div key={w.id} className="px-4 py-3 flex items-start justify-between gap-3 bg-background" data-testid={`withdrawal-${w.id}`}>
                  <div>
                    <p className="font-semibold text-sm">{contact?.name || "Partner"}</p>
                    <p className="text-xs text-muted-foreground">
                      {method ? `${method.method.replace("_"," ")} · ${method.handle}` : "No method on file"}
                    </p>
                    <p className="text-xs text-muted-foreground">{fmtDate(w.requested_at)}</p>
                    {w.partner_note && <p className="text-xs italic text-muted-foreground mt-0.5">"{w.partner_note}"</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-lg text-green-600">{fmt$(w.amount)}</p>
                    <Badge className={`text-xs ${WD_STATUS_STYLE[w.status]}`}>{w.status}</Badge>
                    <div className="flex gap-1 mt-2 justify-end flex-wrap">
                      {w.status === "pending" && (
                        <Button size="sm" className="bg-[hsl(var(--titan-blue))] text-white text-xs h-7 px-2"
                          onClick={() => actionWithdrawal.mutate({ id: w.id, status: "approved" })}>Approve</Button>
                      )}
                      {(w.status === "approved" || w.status === "processing") && (
                        <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white text-xs h-7 px-2"
                          onClick={() => actionWithdrawal.mutate({ id: w.id, status: "paid", adminNote: "Payment sent" })}>
                          <CheckCircle className="w-3 h-3 mr-1" />Mark Paid
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="text-red-500 text-xs h-7 px-2"
                        onClick={() => { const note = window.prompt("Rejection reason (shown to partner):"); if (note !== null) actionWithdrawal.mutate({ id: w.id, status: "rejected", adminNote: note }); }}>
                        <XCircle className="w-3 h-3 mr-1" />Reject
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Grouped by partner */}
      {Object.keys(grouped).length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No payout requests yet.</p>}
      {Object.entries(grouped).map(([name, reqs]) => {
        const totalAmt = reqs.reduce((s, r) => s + r.amount, 0);
        const partner = partners.find(p => p.name === name);
        return (
          <div key={name} className="border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[hsl(var(--titan-red))] to-[hsl(var(--titan-blue))] flex items-center justify-center text-white text-xs font-bold">{name.charAt(0)}</div>
                <span className="font-semibold text-sm">{name}</span>
                {partner && <Badge variant="outline" className="text-xs capitalize">{partner.type}</Badge>}
              </div>
              <span className="text-sm font-bold">{fmt$(totalAmt)}</span>
            </div>
            <div className="divide-y">
              {reqs.map(req => {
                const job = jobs.find(j => j.id === req.jobId);
                const method = allMethods.find(m => m.contactId === req.contactId);
                return (
                  <div key={req.id} className="flex items-start justify-between gap-2 px-4 py-3" data-testid={`payout-${req.id}`}>
                    <div>
                      <p className="text-sm font-medium">{req.description || "Payout"}</p>
                      {job && <p className="text-xs text-[hsl(var(--titan-blue))] flex items-center gap-1 mt-0.5"><Briefcase className="w-3 h-3" />{job.jobNumber} · {job.address?.split(",")[0]}</p>}
                      {method && <p className="text-xs text-muted-foreground mt-0.5">{method.method.replace("_"," ")} — {method.handle}</p>}
                      {req.paidAt && <p className="text-xs text-green-600 mt-0.5">Paid {fmtDate(req.paidAt)}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold">{fmt$(req.amount)}</p>
                      <Badge className={`text-xs mt-1 ${STATUS_COLORS[req.status]}`}>{req.status}</Badge>
                      {req.status === "pending" && (
                        <div className="flex gap-1 mt-2">
                          <Button size="sm" variant="outline" className="text-xs h-7 px-2"
                            onClick={() => updatePayout.mutate({ id: req.id, data: { status: "approved" } })}>Approve</Button>
                          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white text-xs h-7 px-2"
                            onClick={() => updatePayout.mutate({ id: req.id, data: { status: "paid", paidAt: new Date().toISOString() } })}>
                            <CheckCircle className="w-3 h-3 mr-1" />Paid
                          </Button>
                        </div>
                      )}
                      {req.status === "approved" && (
                        <div className="flex gap-1 mt-2 flex-wrap">
                          <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white text-xs h-7 px-2"
                            onClick={async () => {
                              try {
                                const r = await apiRequest("POST", "/api/ramp/pay", { payoutRequestId: req.id });
                                const d = await r.json();
                                if (!r.ok) throw new Error(d.error);
                                queryClient.invalidateQueries({ queryKey: ["/api/payout-requests"] });
                                alert("Submitted to Ramp! Bill ID: " + d.rampBillId);
                              } catch(e: any) { alert("Ramp error: " + e.message); }
                            }}>
                            ⚡ Pay via Ramp
                          </Button>
                          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white text-xs h-7 px-2"
                            onClick={() => updatePayout.mutate({ id: req.id, data: { status: "paid", paidAt: new Date().toISOString() } })}>
                            <CheckCircle className="w-3 h-3 mr-1" />Mark Paid Manually
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ partners, onLogin }: { partners: Contact[]; onLogin: (c: Contact) => void }) {
  const [partnerLogin, setPartnerLogin] = useState({ contactId: "", pin: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!partnerLogin.contactId) { setError("Please select your name."); return; }
    setLoading(true); setError("");
    try {
      const res = await apiRequest("POST", "/api/portal/login", {
        contactId: Number(partnerLogin.contactId),
        pin: partnerLogin.pin,
      }).then(r => r.json());
      if ((res as any).token) { (window as any).__titanPortalToken__ = (res as any).token; }
      onLogin((res as any).contact);
    } catch {
      setError("Login failed. Check your PIN or contact Titan at 706-922-0154.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto space-y-4 pt-4">
      <div className="text-center space-y-1">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[hsl(var(--titan-red))] to-[hsl(var(--titan-blue))] flex items-center justify-center mx-auto mb-3">
          <ExternalLink className="w-7 h-7 text-white" />
        </div>
        <h2 className="font-bold text-lg">Partner Portal</h2>
        <p className="text-sm text-muted-foreground">Titan Restoration LLC</p>
      </div>

      <Card>
        <CardContent className="pt-5 space-y-3">
          <div>
            <Label className="text-xs">Your Name</Label>
            <Select value={partnerLogin.contactId} onValueChange={v => setPartnerLogin(f => ({ ...f, contactId: v }))}>
              <SelectTrigger className="mt-1" data-testid="select-partner-login"><SelectValue placeholder="Select your name" /></SelectTrigger>
              <SelectContent>{partners.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}{p.company ? ` — ${p.company}` : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Access PIN</Label>
            <Input type="password" className="mt-1" value={partnerLogin.pin}
              onChange={e => setPartnerLogin(f => ({ ...f, pin: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              placeholder="Enter your PIN"
              data-testid="input-partner-pin"
            />
          </div>
          {error && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{error}</p>}
          <Button className="w-full bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
            onClick={handleLogin} disabled={loading} data-testid="button-partner-login">
            {loading ? "Signing in…" : "Sign In"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            No PIN? Call <a href="tel:7069220154" className="text-[hsl(var(--titan-blue))]">706-922-0154</a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Root Component ────────────────────────────────────────────────────────────
// `partnerOnly` renders the public partner-facing experience (login + self-service
// only) with NO admin toggle. Used by the public QR-code route so scanning a code
// never exposes the internal admin payout view.
export default function PartnerPortal({ partnerOnly = false }: { partnerOnly?: boolean }) {
  const [view, setView] = useState<"admin" | "partner">(partnerOnly ? "partner" : "admin");
  const [loggedInPartner, setLoggedInPartner] = useState<Contact | null>(null);

  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: allRequests = [] } = useQuery<PayoutRequest[]>({ queryKey: ["/api/payout-requests"] });
  const { data: allMethods = [] } = useQuery<PayoutMethod[]>({ queryKey: ["/api/payout-methods"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  const partners = contacts.filter(c => c.type === "sub" || c.type === "referral");

  // Public partner-facing view: login gate + self-service only, no admin.
  if (partnerOnly) {
    return (
      <div className="min-h-screen bg-muted/30 py-6 px-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {loggedInPartner ? (
            <>
            <div className="text-center">
              <h1 className="text-xl font-bold flex items-center justify-center gap-2">
                <DollarSign className="w-5 h-5 text-[hsl(var(--titan-blue))]" />Partner Portal
              </h1>
              <p className="text-sm text-muted-foreground">Titan Restoration LLC</p>
            </div>
            {loggedInPartner.isReferralCompany ? (
              <CompanyPortalView
                company={loggedInPartner}
                onLogout={() => { (window as any).__titanPortalToken__ = undefined; setLoggedInPartner(null); }}
              />
            ) : (
              <PartnerView
                loggedInPartner={loggedInPartner}
                onLogout={() => { (window as any).__titanPortalToken__ = undefined; setLoggedInPartner(null); }}
                jobs={jobs}
              />
            )}
            </>
          ) : (
            <LoginScreen partners={partners} onLogin={setLoggedInPartner} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-[hsl(var(--titan-blue))]" />Partner Portal
        </h1>
        <div className="flex gap-2">
          <Button size="sm" variant={view === "admin" ? "default" : "outline"} onClick={() => setView("admin")}
            className={view === "admin" ? "bg-[hsl(var(--titan-blue))] text-white" : ""}>Admin</Button>
          <Button size="sm" variant={view === "partner" ? "default" : "outline"} onClick={() => { setView("partner"); setLoggedInPartner(null); }}
            className={view === "partner" ? "bg-[hsl(var(--titan-red))] text-white" : ""}>Partner Login</Button>
        </div>
      </div>

      {view === "admin" ? (
        <AdminView contacts={contacts} allRequests={allRequests} allMethods={allMethods} jobs={jobs} partners={partners} />
      ) : loggedInPartner ? (
        loggedInPartner.isReferralCompany ? (
          <CompanyPortalView
            company={loggedInPartner}
            onLogout={() => { (window as any).__titanPortalToken__ = undefined; setLoggedInPartner(null); }}
          />
        ) : (
          <PartnerView
            loggedInPartner={loggedInPartner}
            onLogout={() => { (window as any).__titanPortalToken__ = undefined; setLoggedInPartner(null); }}
            jobs={jobs}
          />
        )
      ) : (
        <LoginScreen partners={partners} onLogin={setLoggedInPartner} />
      )}
    </div>
  );
}
