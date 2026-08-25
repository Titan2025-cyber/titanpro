import { useQuery, useMutation } from "@tanstack/react-query";
import { UserSelect } from "@/components/UserSelect";
import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import {
  Plus, Search, MapPin, User, ChevronRight, Calendar,
  CheckCircle2, Clock, AlertCircle, DollarSign, FileText,
  Wrench, TrendingUp, LayoutGrid, List, ChevronDown, CheckSquare, Square, ChevronUp,
  TrendingDown, Receipt, CreditCard, KeyRound, Droplets, Hammer
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ExternalLink, Copy, Eye } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Job, Contact } from "@shared/schema";
import { PROGRESS_STAGES, StageSelector, DateManager, getStageForJob, daysAgo, formatPipelineDate } from "@/components/JobPipeline";
import { LeadSourceSelect, type LeadSource } from "@/pages/LeadAttribution";
import { todayLocalISO } from "@/lib/dates";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const LOSS_ICONS: Record<string, string> = {
  water: "💧", fire: "🔥", mold: "🍄", storm: "⛈️", biohazard: "☣️", reconstruction: "🏗️"
};


// ─────────────────────────────────────────────────────────────────────────────
// Financial summary type
// ─────────────────────────────────────────────────────────────────────────────
interface PhaseFinancials {
  estimateTotal: number;
  invoiceTotal: number;
  collected: number;
  creditMemos: number;
  totalCosts: number;
  grossProfit: number;
  settledAmount: number;
  grossMarginPct: number;
  outstanding: number;
}

interface JobFinancials {
  estimateTotal: number;
  invoiceTotal: number;
  collected: number;
  creditMemos: number;
  totalCosts: number;
  grossProfit: number;
  settledAmount: number;
  grossMarginPct: number;
  outstanding: number;
  byPhase?: { mitigation?: PhaseFinancials; reconstruction?: PhaseFinancials };
}

function fmt(n: number) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Compact currency for tight tiles (e.g. $22.9k).
function fmtCompact(n: number) {
  if (Math.abs(n) >= 1000) {
    const k = n / 1000;
    return "$" + (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + "k";
  }
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// "Value" of a phase = its estimate total, falling back to its invoice total
// when no estimate exists (mirrors the whole-job value logic used on cards).
function phaseValue(f: PhaseFinancials | undefined): number {
  if (!f) return 0;
  return f.estimateTotal > 0 ? f.estimateTotal : f.invoiceTotal;
}

// Does the given job qualify as a specific phase for the phase filter?
// Preference order:
//   1. job.division field, if set to 'mitigation' or 'reconstruction'
//   2. If division is 'both' or unset, fall back to financials — job matches
//      the phase iff that phase has any estimate/invoice value AND the other
//      phase does not.
//   3. Legacy jobs with no division and no per-phase financials are treated
//      as mitigation (that's the schema default and mirrors how single-phase
//      jobs get shown elsewhere in the app).
function jobMatchesPhase(job: Job, fin: JobFinancials | undefined, phase: "mitigation" | "reconstruction"): boolean {
  const div = String((job as any).division || "").toLowerCase();
  if (div === "mitigation" || div === "reconstruction") return div === phase;
  // Division unset or 'both' — use financials as evidence of scope.
  const mit = fin?.byPhase?.mitigation;
  const rec = fin?.byPhase?.reconstruction;
  const hasMit = !!mit && (mit.estimateTotal > 0 || mit.invoiceTotal > 0);
  const hasRec = !!rec && (rec.estimateTotal > 0 || rec.invoiceTotal > 0);
  if (hasMit && !hasRec) return phase === "mitigation";
  if (hasRec && !hasMit) return phase === "reconstruction";
  if (hasMit && hasRec) return true; // 'both' — shown under either filter
  // No data — legacy mit default.
  return phase === "mitigation";
}

// Returns { mitigation, reconstruction, total } value for a single job.
function jobPhaseValues(f: JobFinancials | undefined): { mitigation: number; reconstruction: number; total: number } {
  if (!f) return { mitigation: 0, reconstruction: 0, total: 0 };
  const mitigation = phaseValue(f.byPhase?.mitigation);
  const reconstruction = phaseValue(f.byPhase?.reconstruction);
  // Fallback: if no per-phase data at all, attribute whole-job value to mitigation.
  if (!f.byPhase || (mitigation === 0 && reconstruction === 0)) {
    const whole = f.estimateTotal > 0 ? f.estimateTotal : f.invoiceTotal;
    return { mitigation: whole, reconstruction: 0, total: whole };
  }
  return { mitigation, reconstruction, total: mitigation + reconstruction };
}

// ─────────────────────────────────────────────────────────────────────────────
// Job Card
// ─────────────────────────────────────────────────────────────────────────────
// Clickable "Portal active" badge. Jumps to the job's Activity tab and scrolls
// to the Customer Portal Access card. Rendered inside a job Link, so it stops
// propagation and navigates itself instead of nesting anchors.
function PortalActiveBadge({ jobId }: { jobId: number }) {
  const [, setLocation] = useLocation();
  const go = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLocation(`/jobs/${jobId}?portal=1`);
  };
  return (
    <Badge
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") go(e as any); }}
      title="Open portal setup"
      className="text-xs bg-green-100 text-green-800 border border-green-200 gap-1 cursor-pointer hover:bg-green-200 transition-colors"
      data-testid={`badge-portal-active-${jobId}`}
    >
      <KeyRound className="w-2.5 h-2.5" />Portal active
    </Badge>
  );
}

// Right-click menu for job cards. Wrap any job-card element in this and
// get Open / Open in new tab / Open portal / Copy link. This exists because
// wouter's <Link> renders a real <a href>, so native right-click DOES work,
// but users often don't discover that when the card looks like a plain div.
// The custom menu makes the affordance obvious and adds Copy link.
function JobContextMenu({ job, children }: { job: Job; children: React.ReactNode }) {
  // App uses hash-based routing (see <Router hook={useHashLocationNoQuery}
  // hrefs={p => "#" + p}> in App.tsx). wouter's navigate() takes the raw
  // path, but window.open() needs the FULL fragment URL including "#",
  // otherwise a new tab lands on "/jobs/123" which isn't a real route and
  // shows a white screen.
  const path = `/jobs/${job.id}`;
  const hashUrl = `#${path}`;
  const hashUrlPortal = `#${path}?portal=1`;
  // For "Copy link" we want the fully-qualified URL so it works when pasted
  // into a Slack or email off-device. window is guarded for SSR safety.
  const absUrl = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}${hashUrl}` : hashUrl;
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Handlers use Radix's onSelect (not onClick) and call preventDefault so
  // the menu closes WITHOUT bubbling a click into the wrapped <a>/<Link>.
  // Otherwise "Open in new tab" would spawn the new tab AND navigate the
  // current tab because the Link click fires as part of the same gesture.
  const openHere = () => navigate(path);
  // window.open('_blank') from a scripted handler forces foreground in
  // Chromium. Simulating a Ctrl/Cmd-click on a real <a target="_blank">
  // preserves the browser's native background-tab convention so the user
  // stays on the current view and can visit the new tab when ready.
  const openInBackgroundTab = (u: string) => {
    const a = document.createElement("a");
    a.href = u;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    // Dispatch a MouseEvent with ctrl+meta so Chrome/Safari/Firefox all
    // interpret it as "open in background tab" per their platform norms.
    const evt = new MouseEvent("click", {
      bubbles: false,
      cancelable: true,
      view: window,
      ctrlKey: true,   // Windows/Linux: background tab
      metaKey: true,   // macOS: background tab
      shiftKey: false,
    });
    a.dispatchEvent(evt);
  };
  const openNewTab = () => openInBackgroundTab(hashUrl);
  const openPortal = () => openInBackgroundTab(hashUrlPortal);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(absUrl);
      toast({ title: "Link copied", description: absUrl });
    } catch {
      toast({ title: "Copy failed", description: "Clipboard permission denied.", variant: "destructive" });
    }
  };
  // Wrap each action so Radix always gets its preventDefault and the parent
  // Link never sees a click. Kept as a factory to stay concise.
  const wrap = (fn: () => void) => (e: Event) => { e.preventDefault(); fn(); };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={wrap(openHere)} data-testid={`ctxmenu-open-${job.id}`}>
          <Eye className="w-4 h-4 mr-2" />Open job
        </ContextMenuItem>
        <ContextMenuItem onSelect={wrap(openNewTab)} data-testid={`ctxmenu-open-newtab-${job.id}`}>
          <ExternalLink className="w-4 h-4 mr-2" />Open in new tab
        </ContextMenuItem>
        <ContextMenuItem onSelect={wrap(openPortal)} data-testid={`ctxmenu-open-portal-${job.id}`}>
          <KeyRound className="w-4 h-4 mr-2" />Open portal setup (new tab)
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={wrap(copyLink)} data-testid={`ctxmenu-copy-link-${job.id}`}>
          <Copy className="w-4 h-4 mr-2" />Copy link
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function JobCard({ job, contact, fin }: { job: Job; contact?: Contact; fin?: JobFinancials }) {
  const stage = getStageForJob(job);
  const currentDateStr = (job as any)[stage.dateField] as string | undefined;
  const days = daysAgo(currentDateStr);

  // AR alert: invoice sent > 30 days with no payment
  const isArAlert = stage.key === "invoice_pending" && daysAgo(job.invoiceSentDate as string) !== null && (daysAgo(job.invoiceSentDate as string) ?? 0) > 30;

  const hasFinancials = fin && (fin.estimateTotal > 0 || fin.invoiceTotal > 0 || fin.collected > 0 || fin.totalCosts > 0);

  return (
    <JobContextMenu job={job}>
    <Card
      className={`hover:shadow-md transition-all border-l-4 ${stage.borderColor} ${isArAlert ? "ring-1 ring-[hsl(var(--titan-red)/0.4)]" : ""}`}
      data-testid={`job-card-${job.id}`}
    >
      <Link href={`/jobs/${job.id}`}>
        <CardContent className="p-3 pb-1 cursor-pointer">
          <div className="flex items-start gap-2.5">
            <span className="text-xl mt-0.5 shrink-0">{LOSS_ICONS[job.lossType] || "📋"}</span>

            <div className="flex-1 min-w-0">
              {/* Header row */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm">{job.jobNumber}</span>
                {isArAlert && (
                  <Badge className="text-xs bg-red-100 text-[hsl(var(--titan-red))] border border-red-200 gap-1">
                    <AlertCircle className="w-2.5 h-2.5" />30+ Days
                  </Badge>
                )}
                {contact?.portalPin && (
                  <PortalActiveBadge jobId={job.id} />
                )}
                <span className="text-xs text-muted-foreground capitalize">{job.lossType}</span>
              </div>

              {/* Address */}
              {job.address && (
                <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate">{job.address}</span>
                </div>
              )}

              {/* Meta */}
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                {job.assignedTech && (
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" />{job.assignedTech}
                  </span>
                )}
                {job.insuranceCarrier && <span>{job.insuranceCarrier}</span>}
              </div>

              {/* Stage date */}
              {currentDateStr && (
                <div className={`flex items-center gap-1 mt-1.5 text-xs ${stage.textColor}`}>
                  <stage.icon className="w-3 h-3" />
                  <span>{stage.dateLabel}: {formatPipelineDate(currentDateStr)}</span>
                  {days !== null && days > 0 && (
                    <span className="text-muted-foreground">· {days}d ago</span>
                  )}
                </div>
              )}

              {/* Financial grid */}
              {hasFinancials && (
                <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 border-t pt-2 text-xs">
                  <div data-testid={`fin-estimate-${job.id}`}>
                    <span className="text-muted-foreground block leading-none mb-0.5">Estimate</span>
                    <span className="font-semibold text-foreground">{fmt(fin!.estimateTotal)}</span>
                  </div>
                  <div data-testid={`fin-settled-${job.id}`}>
                    <span className="text-muted-foreground block leading-none mb-0.5">Settled</span>
                    <span className="font-semibold text-foreground">{fmt(fin!.settledAmount)}</span>
                  </div>
                  <div data-testid={`fin-invoice-${job.id}`}>
                    <span className="text-muted-foreground block leading-none mb-0.5">Invoiced</span>
                    <span className="font-semibold text-foreground">{fmt(fin!.invoiceTotal)}</span>
                  </div>
                  <div data-testid={`fin-collected-${job.id}`}>
                    <span className="text-muted-foreground block leading-none mb-0.5">Collected</span>
                    <span className="font-semibold text-green-600 dark:text-green-400">{fmt(fin!.collected)}</span>
                  </div>
                  <div data-testid={`fin-costs-${job.id}`}>
                    <span className="text-muted-foreground block leading-none mb-0.5">Job Costs</span>
                    <span className="font-semibold text-orange-600 dark:text-orange-400">{fmt(fin!.totalCosts)}</span>
                  </div>
                  <div data-testid={`fin-gp-${job.id}`}>
                    <span className="text-muted-foreground block leading-none mb-0.5">Gross Profit</span>
                    <span className={`font-semibold ${
                      fin!.grossProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-[hsl(var(--titan-red))]"
                    }`}>{fmt(fin!.grossProfit)}</span>
                  </div>
                  {fin!.creditMemos > 0 && (
                    <div className="col-span-2" data-testid={`fin-credits-${job.id}`}>
                      <span className="text-muted-foreground block leading-none mb-0.5">Credit Memos</span>
                      <span className="font-semibold text-[hsl(var(--titan-red))]">{fmt(fin!.creditMemos)}</span>
                    </div>
                  )}
                  {fin!.outstanding > 0 && (
                    <div data-testid={`fin-ar-${job.id}`}>
                      <span className="text-muted-foreground block leading-none mb-0.5">A/R</span>
                      <span className="font-semibold text-amber-600 dark:text-amber-400">{fmt(fin!.outstanding)}</span>
                    </div>
                  )}
                  {fin!.collected > 0 && fin!.grossMarginPct !== 0 && (
                    <div data-testid={`fin-margin-${job.id}`}>
                      <span className="text-muted-foreground block leading-none mb-0.5">Margin</span>
                      <span className={`font-semibold ${
                        fin!.grossMarginPct >= 30 ? "text-green-600 dark:text-green-400" :
                        fin!.grossMarginPct >= 0 ? "text-amber-600 dark:text-amber-400" :
                        "text-[hsl(var(--titan-red))]"
                      }`}>{fin!.grossMarginPct.toFixed(1)}%</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
          </div>
        </CardContent>
      </Link>
      {/* Stage controls OUTSIDE the Link so clicks don't navigate */}
      <div className="flex items-center gap-2 px-3 pb-2 flex-wrap">
        <StageSelector job={job} />
        <DateManager job={job} />
        {contact && (
          <span className="text-xs text-muted-foreground ml-auto">{contact.name}</span>
        )}
      </div>
    </Card>
    </JobContextMenu>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Board — Kanban-style columns by stage
// ─────────────────────────────────────────────────────────────────────────────
function PipelineBoard({ jobs, contacts, search, locationFilter, phaseFilter, finMap, selectedStage, onStageSelect }: {
  jobs: Job[]; contacts: Contact[]; search: string; locationFilter: string;
  phaseFilter: "all" | "mitigation" | "reconstruction";
  finMap: Record<number, JobFinancials>;
  selectedStage: string | null;
  onStageSelect: (stageKey: string | null) => void;
}) {
  const [, setBoardLocation] = useLocation();
  const filtered = jobs.filter(j => {
    if (locationFilter !== "all" && (((j as any).location as string) || "Augusta") !== locationFilter) return false;
    if (phaseFilter !== "all" && !jobMatchesPhase(j, finMap[j.id], phaseFilter)) return false;
    if (search) {
      const q = search.toLowerCase();
      return j.jobNumber.toLowerCase().includes(q) ||
        (j.address || "").toLowerCase().includes(q) ||
        (j.insuranceCarrier || "").toLowerCase().includes(q);
    }
    return true;
  });

  const visibleStages = selectedStage
    ? PROGRESS_STAGES.filter(s => s.key === selectedStage)
    : PROGRESS_STAGES;

  return (
    <div>
    {/* Active bucket filter indicator */}
    {selectedStage && (
      <div className="flex items-center gap-2 text-sm mb-3">
        <span className="text-muted-foreground">Showing</span>
        <Badge variant="outline">{PROGRESS_STAGES.find(s => s.key === selectedStage)?.label}</Badge>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onStageSelect(null)} data-testid="button-clear-board-filter">Show all buckets</Button>
      </div>
    )}
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4">
      {visibleStages.map(stage => {
        const stageJobs = filtered.filter(j => (j.progressStage || "pending_sale") === stage.key);
        const phaseTotals = stageJobs.reduce((acc, j) => {
          const v = jobPhaseValues(finMap[j.id]);
          acc.mitigation += v.mitigation;
          acc.reconstruction += v.reconstruction;
          acc.total += v.total;
          return acc;
        }, { mitigation: 0, reconstruction: 0, total: 0 });
        // Per-location (market/branch) breakdown for this bucket.
        const locTotals = stageJobs.reduce((acc, j) => {
          const loc = ((j as any).location as string) === "Columbia" ? "Columbia" : "Augusta";
          const v = jobPhaseValues(finMap[j.id]);
          acc[loc].count += 1;
          acc[loc].total += v.total;
          return acc;
        }, { Augusta: { count: 0, total: 0 }, Columbia: { count: 0, total: 0 } });

        return (
          <div key={stage.key} className="shrink-0 w-72">
            {/* Column header — click to filter the board to just this bucket (click again to show all) */}
            <button
              type="button"
              onClick={() => onStageSelect(selectedStage === stage.key ? null : stage.key)}
              title={selectedStage === stage.key ? "Show all buckets" : `Focus on ${stage.label} jobs`}
              className={`w-full text-left rounded-t-lg border border-b-0 px-3 py-2.5 ${stage.color} ${stage.borderColor} cursor-pointer transition-colors hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--titan-blue))] ${selectedStage === stage.key ? "ring-2 ring-[hsl(var(--titan-blue))]" : ""}`}
              data-testid={`bucket-header-${stage.key}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <stage.icon className={`w-4 h-4 ${stage.textColor}`} />
                  <span className={`text-sm font-semibold ${stage.textColor}`}>{stage.label}</span>
                </div>
                <Badge variant="outline" className={`text-xs ${stage.textColor} ${stage.borderColor}`}>
                  {stageJobs.length}
                </Badge>
              </div>
              {/* Total value of all jobs in this bucket */}
              <div className="flex items-center justify-between mt-1">
                <span className={`text-xs flex items-center gap-1 ${stage.textColor}`}>
                  <DollarSign className="w-3 h-3" />Total value
                </span>
                <span className={`text-sm font-bold ${stage.textColor}`} data-testid={`bucket-total-${stage.key}`}>
                  {fmt(phaseTotals.total)}
                </span>
              </div>
              {/* Phase breakdown: mitigation vs reconstruction */}
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`flex-1 flex items-center justify-between gap-1 rounded px-1.5 py-0.5 text-xs bg-background/50 border ${stage.borderColor}`}>
                  <span className="flex items-center gap-1 text-muted-foreground"><Droplets className="w-3 h-3" />Mit</span>
                  <span className="font-semibold text-foreground" data-testid={`bucket-mit-${stage.key}`}>{fmt(phaseTotals.mitigation)}</span>
                </span>
                <span className={`flex-1 flex items-center justify-between gap-1 rounded px-1.5 py-0.5 text-xs bg-background/50 border ${stage.borderColor}`}>
                  <span className="flex items-center gap-1 text-muted-foreground"><Hammer className="w-3 h-3" />Recon</span>
                  <span className="font-semibold text-foreground" data-testid={`bucket-recon-${stage.key}`}>{fmt(phaseTotals.reconstruction)}</span>
                </span>
              </div>
              {/* Location breakdown: Augusta vs Columbia */}
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`flex-1 flex items-center justify-between gap-1 rounded px-1.5 py-0.5 text-xs bg-background/50 border ${stage.borderColor}`}>
                  <span className="flex items-center gap-1 text-muted-foreground"><MapPin className="w-3 h-3" />Augusta ({locTotals.Augusta.count})</span>
                  <span className="font-semibold text-foreground" data-testid={`bucket-loc-augusta-${stage.key}`}>{fmt(locTotals.Augusta.total)}</span>
                </span>
                <span className={`flex-1 flex items-center justify-between gap-1 rounded px-1.5 py-0.5 text-xs bg-background/50 border ${stage.borderColor}`}>
                  <span className="flex items-center gap-1 text-muted-foreground"><MapPin className="w-3 h-3" />Columbia ({locTotals.Columbia.count})</span>
                  <span className="font-semibold text-foreground" data-testid={`bucket-loc-columbia-${stage.key}`}>{fmt(locTotals.Columbia.total)}</span>
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-tight">{stage.description}</p>
            </button>

            {/* Job cards */}
            <div className={`border border-t-0 rounded-b-lg ${stage.borderColor} divide-y min-h-[80px] bg-background/60`}>
              {stageJobs.length === 0 ? (
                <div className="flex items-center justify-center py-6 text-xs text-muted-foreground/60">
                  No jobs
                </div>
              ) : (
                stageJobs.map(job => {
                  const contact = contacts.find(c => c.id === job.contactId);
                  const s = getStageForJob(job);
                  const dateStr = (job as any)[s.dateField] as string | undefined;
                  const days = daysAgo(dateStr);
                  const isArAlert = stage.key === "invoice_pending" && (daysAgo(job.invoiceSentDate as string) ?? 0) > 30;

                  return (
                    <JobContextMenu key={job.id} job={job}>
                    <div className={`${isArAlert ? "border-l-2 border-[hsl(var(--titan-red))]" : ""}`}>
                      <Link href={`/jobs/${job.id}`}>
                        <div
                          className="p-3 pb-1 hover:bg-muted/40 transition-colors cursor-pointer"
                          data-testid={`pipeline-job-${job.id}`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-base">{LOSS_ICONS[job.lossType] || "📋"}</span>
                            <span className="font-semibold text-sm">{job.jobNumber}</span>
                            {contact?.portalPin && (
                              <span
                                role="link"
                                tabIndex={0}
                                title="Open portal setup"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setBoardLocation(`/jobs/${job.id}?portal=1`); }}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setBoardLocation(`/jobs/${job.id}?portal=1`); } }}
                                className="inline-flex cursor-pointer hover:text-green-700"
                                data-testid={`badge-portal-active-${job.id}`}
                              >
                                <KeyRound className="w-3.5 h-3.5 text-green-600" />
                              </span>
                            )}
                            {isArAlert && <AlertCircle className="w-3.5 h-3.5 text-[hsl(var(--titan-red))] ml-auto" />}
                          </div>
                          {contact && <p className="text-xs font-medium text-foreground truncate">{contact.name}</p>}
                          {job.address && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{job.address}</p>
                          )}
                          <span
                            className={`inline-flex items-center gap-0.5 mt-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${((job as any).location === "Columbia") ? "bg-[hsl(var(--titan-blue))]/10 text-[hsl(var(--titan-blue))]" : "bg-[hsl(var(--titan-red))]/10 text-[hsl(var(--titan-red))]"}`}
                            data-testid={`job-location-${job.id}`}
                          >
                            <MapPin className="w-2.5 h-2.5" />{(job as any).location || "Augusta"}
                          </span>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            {job.assignedTech && (
                              <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                                <User className="w-2.5 h-2.5" />{job.assignedTech}
                              </span>
                            )}
                            {dateStr && days !== null && (
                              <span className={`text-xs ml-auto ${days > 30 ? "text-[hsl(var(--titan-red))]" : "text-muted-foreground"}`}>
                                {days}d
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                      {/* Stage controls OUTSIDE the Link so clicks don't navigate */}
                      <div className="flex items-center gap-1 px-3 pb-2">
                        <StageSelector job={job} />
                        <DateManager job={job} />
                      </div>
                    </div>
                    </JobContextMenu>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// List View — filterable, sortable flat list
// ─────────────────────────────────────────────────────────────────────────────
function ListView({ jobs, contacts, search, stageFilter, locationFilter, phaseFilter, selectedIds, onToggle, onToggleAll, finMap }: {
  jobs: Job[]; contacts: Contact[]; search: string; stageFilter: string; locationFilter: string;
  phaseFilter: "all" | "mitigation" | "reconstruction";
  selectedIds: Set<number>; onToggle: (id: number) => void; onToggleAll: (ids: number[]) => void;
  finMap: Record<number, JobFinancials>;
}) {
  const filtered = jobs.filter(j => {
    const q = search.toLowerCase();
    const matchSearch = !q || j.jobNumber.toLowerCase().includes(q) ||
      (j.address || "").toLowerCase().includes(q) ||
      (j.insuranceCarrier || "").toLowerCase().includes(q);
    const matchStage = stageFilter === "all" || (j.progressStage || "pending_sale") === stageFilter;
    const matchLocation = locationFilter === "all" || (((j as any).location as string) || "Augusta") === locationFilter;
    const matchPhase = phaseFilter === "all" || jobMatchesPhase(j, finMap[j.id], phaseFilter);
    return matchSearch && matchStage && matchLocation && matchPhase;
  });

  const filteredIds = filtered.map(j => j.id);
  const allSelected = filteredIds.length > 0 && filteredIds.every(id => selectedIds.has(id));

  return (
    <div className="space-y-2">
      {filtered.length > 0 && (
        <div className="flex items-center gap-2 px-1 pb-1">
          <Checkbox
            id="select-all"
            checked={allSelected}
            onCheckedChange={() => onToggleAll(filteredIds)}
            data-testid="checkbox-select-all"
          />
          <label htmlFor="select-all" className="text-xs text-muted-foreground cursor-pointer select-none">
            Select all ({filteredIds.length})
          </label>
        </div>
      )}
      {filtered.map(job => {
        const contact = contacts.find(c => c.id === job.contactId);
        const fin = finMap[job.id];
        return (
          <div key={job.id} className="flex items-start gap-2">
            <div className="pt-3 pl-1">
              <Checkbox
                checked={selectedIds.has(job.id)}
                onCheckedChange={() => onToggle(job.id)}
                data-testid={`checkbox-job-${job.id}`}
              />
            </div>
            <div className="flex-1">
              <JobCard job={job} contact={contact} fin={fin} />
            </div>
          </div>
        );
      })}
      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <TrendingUp className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No jobs found.</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Summary Bar
// ─────────────────────────────────────────────────────────────────────────────
function PipelineSummary({ jobs, finMap, onStageClick }: {
  jobs: Job[];
  finMap: Record<number, JobFinancials>;
  onStageClick: (stageKey: string) => void;
}) {
  const counts = PROGRESS_STAGES.reduce((acc, s) => {
    acc[s.key] = jobs.filter(j => (j.progressStage || "pending_sale") === s.key).length;
    return acc;
  }, {} as Record<string, number>);
  const values = PROGRESS_STAGES.reduce((acc, s) => {
    acc[s.key] = jobs
      .filter(j => (j.progressStage || "pending_sale") === s.key)
      .reduce((t, j) => {
        const v = jobPhaseValues(finMap[j.id]);
        t.mitigation += v.mitigation;
        t.reconstruction += v.reconstruction;
        t.total += v.total;
        return t;
      }, { mitigation: 0, reconstruction: 0, total: 0 });
    return acc;
  }, {} as Record<string, { mitigation: number; reconstruction: number; total: number }>);

  const arJobs = jobs.filter(j =>
    (j.progressStage || "pending_sale") === "invoice_pending" &&
    (daysAgo(j.invoiceSentDate as string) ?? 0) > 30
  );

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {PROGRESS_STAGES.map(stage => (
        <button
          type="button"
          key={stage.key}
          onClick={() => onStageClick(stage.key)}
          title={`View all ${stage.label} jobs`}
          className={`rounded-lg border p-2.5 text-center ${stage.color} ${stage.borderColor} cursor-pointer transition-colors hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--titan-blue))]`}
          data-testid={`summary-bucket-${stage.key}`}
        >
          <stage.icon className={`w-4 h-4 mx-auto mb-1 ${stage.textColor}`} />
          <p className={`text-lg font-bold ${stage.textColor}`}>{counts[stage.key]}</p>
          <p className={`text-xs font-medium leading-tight ${stage.textColor}`}>{stage.shortLabel}</p>
          <p className={`text-xs font-semibold mt-0.5 ${stage.textColor}`} data-testid={`summary-total-${stage.key}`}>{fmt(values[stage.key].total)}</p>
          <div className={`flex items-center justify-center gap-1 mt-0.5 text-[10px] leading-none ${stage.textColor} opacity-80`}>
            <span className="flex items-center gap-0.5" data-testid={`summary-mit-${stage.key}`}><Droplets className="w-2.5 h-2.5" />{fmtCompact(values[stage.key].mitigation)}</span>
            <span className="opacity-50">·</span>
            <span className="flex items-center gap-0.5" data-testid={`summary-recon-${stage.key}`}><Hammer className="w-2.5 h-2.5" />{fmtCompact(values[stage.key].reconstruction)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
export default function Jobs() {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  // Phase filter for both Board + List views. 'all' = show everything,
  // 'mitigation' = only jobs whose scope is mit-only, 'reconstruction' =
  // only jobs whose scope is recon-only. Uses the job.division field first,
  // falling back to whichever phase has estimate/invoice value in finMap.
  const [phaseFilter, setPhaseFilter] = useState<"all" | "mitigation" | "reconstruction">("all");
  const [viewMode, setViewMode] = useState<"board" | "list">("list");
  // Which bucket the Board view is focused on. null = show all columns.
  const [boardStage, setBoardStage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>("mitigation");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    jobNumber: `TP-${new Date().getFullYear()}-`,
    contactId: "",
    lossType: "water",
    status: "new",
    progressStage: "pending_sale",
    // Job scope drives which phases the workspace exposes. 'mitigation' =
    // mit-only job (no recon tab/phase toggle), 'reconstruction' = recon-only
    // job (no mit tab), 'both' = full water-loss with a mit -> recon handoff.
    // Default 'mitigation' because that's where most Titan jobs start.
    division: "mitigation" as "mitigation" | "reconstruction" | "both",
    location: "Augusta",
    address: "",
    description: "",
    assignedTech: "",
    insuranceCarrier: "",
    claimNumber: "",
    salesDate: todayLocalISO(),
    leadSource: "" as LeadSource | "",
    leadSourceDetail: "",
    // Property details — auto-prefilled from OpenStreetMap when the address
    // matches a known building, editable at any time.
    yearBuilt: "" as string | number,
    squareFeet: "" as string | number,
  });
  // Property-lookup state — refs track whether the operator has manually
  // typed a value so a later address change doesn't wipe out their entry.
  const [propLookup, setPropLookup] = useState<{ status: "idle" | "loading" | "done" | "empty" | "error"; note: string }>({ status: "idle", note: "" });
  const yearEditedRef = useRef(false);
  const sqftEditedRef = useRef(false);

  // "existing" → pick from the customer dropdown. "new" → type customer
  // details here and we'll create the contact on submit.
  const [customerMode, setCustomerMode] = useState<"existing" | "new">("new");
  const [newCustomer, setNewCustomer] = useState({ name: "", email: "", phone: "", address: "" });

  // Debounced property lookup: fires 900ms after the operator stops typing.
  // Fills yearBuilt + squareFeet only if the operator hasn't manually edited
  // those fields.
  useEffect(() => {
    const raw = form.address.trim();
    if (raw.length < 6) {
      setPropLookup({ status: "idle", note: "" });
      return;
    }
    setPropLookup({ status: "loading", note: "Looking up public property records…" });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/property-lookup?address=${encodeURIComponent(raw)}`, { signal: controller.signal });
        if (!resp.ok) throw new Error(String(resp.status));
        const data = await resp.json();
        setForm(f => ({
          ...f,
          yearBuilt: yearEditedRef.current ? f.yearBuilt : (data.yearBuilt ?? ""),
          squareFeet: sqftEditedRef.current ? f.squareFeet : (data.squareFeet ?? ""),
        }));
        const filled = (data.yearBuilt || data.squareFeet);
        setPropLookup({ status: filled ? "done" : "empty", note: data.note || "" });
      } catch (_e) {
        if (!controller.signal.aborted) setPropLookup({ status: "error", note: "Lookup unavailable — enter year built manually." });
      }
    }, 900);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [form.address]);

  function resetForm() {
    setForm({
      jobNumber: `TP-${new Date().getFullYear()}-`,
      contactId: "",
      lossType: "water",
      status: "new",
      progressStage: "pending_sale",
      division: "mitigation",
      location: "Augusta",
      address: "",
      description: "",
      assignedTech: "",
      insuranceCarrier: "",
      claimNumber: "",
      salesDate: todayLocalISO(),
      leadSource: "",
      leadSourceDetail: "",
      yearBuilt: "",
      squareFeet: "",
    });
    setNewCustomer({ name: "", email: "", phone: "", address: "" });
    setPropLookup({ status: "idle", note: "" });
    yearEditedRef.current = false;
    sqftEditedRef.current = false;
    setCustomerMode("new");
  }

  const { data: jobs = [], isLoading } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: financialsRaw = {} } = useQuery<Record<string, JobFinancials>>({
    queryKey: ["/api/jobs/financials"],
    queryFn: () => apiRequest("GET", "/api/jobs/financials").then(r => r.json()),
  });
  // Normalize keys to numbers
  const finMap: Record<number, JobFinancials> = Object.fromEntries(
    Object.entries(financialsRaw).map(([k, v]) => [Number(k), v])
  );
  const { toast } = useToast();

  // Job creation flow supports two paths:
  //   1. Existing customer → POST /api/jobs with contactId.
  //   2. New customer → POST /api/contacts first, then POST /api/jobs with the
  //      returned contactId. This is the flow when the operator picks the
  //      "New Customer" toggle in the New Job dialog.
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      // Normalize integer-typed form fields — the form initializes yearBuilt
      // and squareFeet to "" (so the <Input> stays controlled), but SQLite
      // will reject an empty string on an integer column. Same for contactId
      // when the operator picked "existing" but didn't choose a customer.
      const toIntOrNull = (v: any) => {
        if (v === "" || v === null || v === undefined) return null;
        const n = Number(v);
        return Number.isFinite(n) ? Math.trunc(n) : null;
      };
      // Strip empty strings on optional fields and coerce ints/nulls so the
      // server never sees a blank where it expects a number.
      const normalized = {
        ...data,
        contactId: toIntOrNull(data.contactId),
        yearBuilt: toIntOrNull(data.yearBuilt),
        squareFeet: toIntOrNull(data.squareFeet),
        leadSource: data.leadSource || null,
        leadSourceDetail: data.leadSourceDetail || null,
      };
      let contactId: number | null = normalized.contactId ?? null;
      if (customerMode === "new") {
        const trimmed = newCustomer.name.trim();
        if (!trimmed) throw new Error("Customer name required");
        // Reuse the job address for the customer address when the customer
        // address is blank — saves a redundant typing step.
        const contactAddress = newCustomer.address.trim() || (data.address || "").trim();
        const contactRes = await apiRequest("POST", "/api/contacts", {
          name: trimmed,
          type: "customer",
          email: newCustomer.email.trim() || null,
          phone: newCustomer.phone.trim() || null,
          address: contactAddress || null,
        });
        const contact = await contactRes.json();
        contactId = contact?.id ?? null;
      }
      const jobRes = await apiRequest("POST", "/api/jobs", { ...normalized, contactId });
      return jobRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setOpen(false);
      resetForm();
      toast({ title: "Job created" });
    },
    onError: (e: any) => toast({
      title: "Could not create job",
      description: e?.message || "Please check the form and try again.",
      variant: "destructive",
    }),
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ ids, status }: { ids: number[]; status: string }) => {
      await Promise.all(ids.map(id => apiRequest("PATCH", `/api/jobs/${id}`, { status })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setSelectedIds(new Set());
      toast({ title: `${selectedIds.size} job${selectedIds.size !== 1 ? "s" : ""} updated to ${bulkStatus}` });
    },
    onError: () => toast({ title: "Error", description: "Bulk update failed", variant: "destructive" }),
  });

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(jobIds: number[]) {
    if (jobIds.every(id => selectedIds.has(id))) {
      setSelectedIds(prev => { const n = new Set(prev); jobIds.forEach(id => n.delete(id)); return n; });
    } else {
      setSelectedIds(prev => { const n = new Set(prev); jobIds.forEach(id => n.add(id)); return n; });
    }
  }

  const customers = contacts.filter(c => c.type === "customer");

  const arAlertCount = jobs.filter(j =>
    (j.progressStage || "pending_sale") === "invoice_pending" &&
    (daysAgo(j.invoiceSentDate as string) ?? 0) > 30
  ).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Jobs</h1>
          {arAlertCount > 0 && (
            <Badge className="bg-[hsl(var(--titan-red))] text-white text-xs gap-1">
              <AlertCircle className="w-3 h-3" />{arAlertCount} A/R Alert{arAlertCount > 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex border rounded-lg overflow-hidden">
            <button
              className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${viewMode === "list" ? "bg-[hsl(var(--titan-blue))] text-white" : "hover:bg-muted"}`}
              onClick={() => setViewMode("list")}
              data-testid="view-list"
            >
              <List className="w-3.5 h-3.5" />List
            </button>
            <button
              className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${viewMode === "board" ? "bg-[hsl(var(--titan-blue))] text-white" : "hover:bg-muted"}`}
              onClick={() => setViewMode("board")}
              data-testid="view-board"
            >
              <LayoutGrid className="w-3.5 h-3.5" />Board
            </button>
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white" data-testid="button-new-job">
                <Plus className="w-4 h-4 mr-2" />New Job
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>New Job</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Job Number</Label>
                    <Input value={form.jobNumber} onChange={e => setForm(f => ({ ...f, jobNumber: e.target.value }))} data-testid="input-job-number" />
                  </div>
                  <div>
                    <Label>Loss Type</Label>
                    <Select value={form.lossType} onValueChange={v => setForm(f => ({ ...f, lossType: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["water", "fire", "mold", "storm", "biohazard", "reconstruction"].map(t => (
                          <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Job scope — picks which phases the job workspace will show.
                   Mit-only jobs won't get a Reconstruction phase toggle inside
                   the job file; recon-only jobs won't get Mitigation or the
                   Dry Report tab; Both is the classic mit -> recon handoff. */}
                <div>
                  <Label>Job Scope</Label>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    {([
                      { key: "mitigation", label: "Mitigation only", desc: "Dry-out / cleanup" },
                      { key: "reconstruction", label: "Reconstruction only", desc: "Rebuild / repairs" },
                      { key: "both", label: "Both", desc: "Full loss" },
                    ] as const).map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, division: opt.key }))}
                        className={`text-left rounded border px-3 py-2 transition-colors ${
                          form.division === opt.key
                            ? "bg-[hsl(var(--titan-blue))] text-white border-[hsl(var(--titan-blue))]"
                            : "hover:bg-muted border-border"
                        }`}
                        data-testid={`button-scope-${opt.key}`}
                      >
                        <div className="text-sm font-medium">{opt.label}</div>
                        <div className={`text-[11px] ${form.division === opt.key ? "text-white/80" : "text-muted-foreground"}`}>{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label>Progress Stage</Label>
                  <Select value={form.progressStage} onValueChange={v => setForm(f => ({ ...f, progressStage: v }))}>
                    <SelectTrigger data-testid="select-progress-stage"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PROGRESS_STAGES.map(s => (
                        <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Customer picker — either pick an existing contact or type a
                   new one right here. When "New" is active, we auto-create the
                   contact on submit and link it to the job in one round trip. */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>Customer</Label>
                    <div className="flex border rounded overflow-hidden text-[11px]">
                      <button
                        type="button"
                        className={`px-2 py-0.5 ${customerMode === "new" ? "bg-[hsl(var(--titan-blue))] text-white" : "hover:bg-muted"}`}
                        onClick={() => setCustomerMode("new")}
                        data-testid="button-customer-mode-new"
                      >New</button>
                      <button
                        type="button"
                        className={`px-2 py-0.5 ${customerMode === "existing" ? "bg-[hsl(var(--titan-blue))] text-white" : "hover:bg-muted"}`}
                        onClick={() => setCustomerMode("existing")}
                        data-testid="button-customer-mode-existing"
                      >Existing</button>
                    </div>
                  </div>
                  {customerMode === "existing" ? (
                    <Select value={form.contactId} onValueChange={v => setForm(f => ({ ...f, contactId: v }))}>
                      <SelectTrigger data-testid="select-customer"><SelectValue placeholder="Select customer" /></SelectTrigger>
                      <SelectContent>
                        {customers.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="space-y-2 rounded-md border border-dashed p-2">
                      <Input
                        value={newCustomer.name}
                        onChange={e => setNewCustomer(c => ({ ...c, name: e.target.value }))}
                        placeholder="Customer name *"
                        data-testid="input-new-customer-name"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          value={newCustomer.phone}
                          onChange={e => setNewCustomer(c => ({ ...c, phone: e.target.value }))}
                          placeholder="Phone"
                          data-testid="input-new-customer-phone"
                        />
                        <Input
                          value={newCustomer.email}
                          onChange={e => setNewCustomer(c => ({ ...c, email: e.target.value }))}
                          placeholder="Email"
                          data-testid="input-new-customer-email"
                        />
                      </div>
                      <Input
                        value={newCustomer.address}
                        onChange={e => setNewCustomer(c => ({ ...c, address: e.target.value }))}
                        placeholder="Customer address (defaults to job address)"
                        data-testid="input-new-customer-address"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        This contact will be created and linked to the job on save.
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Address</Label>
                    <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Job site address" />
                    {propLookup.status !== "idle" && (
                      <p className={`text-[11px] mt-1 ${
                        propLookup.status === "loading" ? "text-muted-foreground" :
                        propLookup.status === "done" ? "text-green-700 dark:text-green-400" :
                        propLookup.status === "error" ? "text-amber-700 dark:text-amber-400" :
                        propLookup.status === "empty" ? "text-amber-700 dark:text-amber-400" :
                        "text-muted-foreground"
                      }`}>
                        {propLookup.status === "loading" && "⏳ "}
                        {propLookup.status === "done" && "✓ "}
                        {propLookup.status === "empty" && "⚠ "}
                        {propLookup.status === "error" && "⚠ "}
                        {propLookup.note || (propLookup.status === "empty" ? "No public year-built record on file for this address. Please enter Year Built manually below." : "")}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label>Location</Label>
                    <Select value={form.location} onValueChange={v => setForm(f => ({ ...f, location: v }))}>
                      <SelectTrigger data-testid="select-job-location"><SelectValue placeholder="Select market" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Augusta">Augusta</SelectItem>
                        <SelectItem value="Columbia">Columbia</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Property record fields — auto-prefilled from OpenStreetMap.
                    Year Built drives EPA RRP lead-safe (pre-1978). Editable. */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Year Built</Label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1700}
                      max={new Date().getFullYear() + 1}
                      placeholder="e.g. 1965"
                      value={form.yearBuilt as any}
                      onChange={e => {
                        yearEditedRef.current = true;
                        setForm(f => ({ ...f, yearBuilt: e.target.value }));
                      }}
                      data-testid="input-year-built"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">Pre-1978 triggers EPA RRP lead review.</p>
                  </div>
                  <div>
                    <Label>Square Feet</Label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      placeholder="e.g. 1800"
                      value={form.squareFeet as any}
                      onChange={e => {
                        sqftEditedRef.current = true;
                        setForm(f => ({ ...f, squareFeet: e.target.value }));
                      }}
                      data-testid="input-square-feet"
                    />
                  </div>
                </div>

                <div>
                  <Label>Assigned Tech</Label>
                  <UserSelect
                    value={form.assignedTech}
                    onChange={v => setForm(f => ({ ...f, assignedTech: v }))}
                    roles={["tech"]}
                    placeholder="Select tech"
                    allowUnassigned
                    testId="select-job-assigned-tech"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Insurance Carrier</Label>
                    <Input value={form.insuranceCarrier} onChange={e => setForm(f => ({ ...f, insuranceCarrier: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Claim #</Label>
                    <Input value={form.claimNumber} onChange={e => setForm(f => ({ ...f, claimNumber: e.target.value }))} />
                  </div>
                </div>

                <div>
                  <Label>Date Received</Label>
                  <Input type="date" value={form.salesDate} onChange={e => setForm(f => ({ ...f, salesDate: e.target.value }))} />
                </div>

                <div>
                  <Label>Lead Source</Label>
                  <LeadSourceSelect value={form.leadSource} onChange={v => setForm(f => ({ ...f, leadSource: v }))} />
                </div>

                <div>
                  <Label>Lead Source Detail</Label>
                  <Input value={form.leadSourceDetail} onChange={e => setForm(f => ({ ...f, leadSourceDetail: e.target.value }))} placeholder="e.g. Partner name, campaign, or referrer" />
                </div>

                <div>
                  <Label>Description</Label>
                  <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description" />
                </div>

                <Button
                  className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
                  disabled={
                    createMutation.isPending ||
                    (customerMode === "new" && !newCustomer.name.trim()) ||
                    (customerMode === "existing" && !form.contactId)
                  }
                  onClick={() => createMutation.mutate({
                    ...form,
                    contactId: customerMode === "existing" && form.contactId ? Number(form.contactId) : null,
                    // Coerce numeric strings to real numbers (or null when blank).
                    yearBuilt: form.yearBuilt === "" || form.yearBuilt == null ? null : Number(form.yearBuilt) || null,
                    squareFeet: form.squareFeet === "" || form.squareFeet == null ? null : Number(form.squareFeet) || null,
                    createdAt: new Date().toISOString(),
                  })}
                  data-testid="button-create-job"
                >
                  {createMutation.isPending ? "Creating…" : "Create Job"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Pipeline summary */}
      {!isLoading && (
        <div className="titan-card-lit rounded-xl p-3">
          <PipelineSummary
            jobs={jobs}
            finMap={finMap}
            onStageClick={(stageKey) => { setBoardStage(stageKey); setViewMode("board"); }}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search jobs…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className="w-40" data-testid="select-location-filter">
            <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /><SelectValue /></span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            <SelectItem value="Augusta">Augusta</SelectItem>
            <SelectItem value="Columbia">Columbia</SelectItem>
          </SelectContent>
        </Select>
        {/* Phase filter — lets you focus on Mitigation-only or Reconstruction-
            only jobs in either view. Applied in ListView + PipelineBoard. */}
        <Select value={phaseFilter} onValueChange={v => setPhaseFilter(v as any)}>
          <SelectTrigger className="w-44" data-testid="select-phase-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Phases</SelectItem>
            <SelectItem value="mitigation">
              <span className="flex items-center gap-1.5"><Droplets className="w-3.5 h-3.5" />Mitigation only</span>
            </SelectItem>
            <SelectItem value="reconstruction">
              <span className="flex items-center gap-1.5"><Hammer className="w-3.5 h-3.5" />Reconstruction only</span>
            </SelectItem>
          </SelectContent>
        </Select>
        {viewMode === "list" && (
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-48" data-testid="select-stage-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stages</SelectItem>
              {PROGRESS_STAGES.map(s => (
                <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : viewMode === "board" ? (
        <PipelineBoard
          jobs={jobs}
          contacts={contacts}
          search={search}
          locationFilter={locationFilter}
          phaseFilter={phaseFilter}
          finMap={finMap}
          selectedStage={boardStage}
          onStageSelect={setBoardStage}
        />
      ) : (
        <>
          {/* Bulk Action Toolbar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 p-3 bg-[hsl(var(--titan-blue)/0.08)] dark:bg-[hsl(var(--titan-blue)/0.15)] border border-[hsl(var(--titan-blue)/0.3)] rounded-lg">
              <CheckSquare className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
              <span className="text-sm font-medium">{selectedIds.size} job{selectedIds.size !== 1 ? "s" : ""} selected</span>
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-muted-foreground">Move to:</span>
                <Select value={bulkStatus} onValueChange={setBulkStatus}>
                  <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-bulk-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["new","mitigation","drying","reconstruction","complete"].map(s => (
                      <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-8 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white text-xs"
                  onClick={() => bulkUpdateMutation.mutate({ ids: Array.from(selectedIds), status: bulkStatus })}
                  disabled={bulkUpdateMutation.isPending}
                  data-testid="button-bulk-apply"
                >
                  {bulkUpdateMutation.isPending ? "Updating..." : "Apply"}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSelectedIds(new Set())} data-testid="button-bulk-clear">
                  Clear
                </Button>
              </div>
            </div>
          )}
          <ListView
            jobs={jobs}
            contacts={contacts}
            search={search}
            stageFilter={stageFilter}
            locationFilter={locationFilter}
            phaseFilter={phaseFilter}
            selectedIds={selectedIds}
            onToggle={toggleSelect}
            onToggleAll={toggleSelectAll}
            finMap={finMap}
          />
        </>
      )}
    </div>
  );
}
