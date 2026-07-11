import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Job, Contact } from "@shared/schema";
import { PROGRESS_STAGES, StageSelector, DateManager, getStageForJob, daysAgo, formatPipelineDate } from "@/components/JobPipeline";
import { LeadSourceSelect, type LeadSource } from "@/pages/LeadAttribution";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const LOSS_ICONS: Record<string, string> = {
  water: "💧", fire: "🔥", mold: "🍄", storm: "⛈️", biohazard: "☣️", reconstruction: "🏗️"
};

const TEAM = ["John", "Mason", "Clint", "Blake", "Blake Foster", "Cody Brantley"];

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

function JobCard({ job, contact, fin }: { job: Job; contact?: Contact; fin?: JobFinancials }) {
  const stage = getStageForJob(job);
  const currentDateStr = (job as any)[stage.dateField] as string | undefined;
  const days = daysAgo(currentDateStr);

  // AR alert: invoice sent > 30 days with no payment
  const isArAlert = stage.key === "invoice_pending" && daysAgo(job.invoiceSentDate as string) !== null && (daysAgo(job.invoiceSentDate as string) ?? 0) > 30;

  const hasFinancials = fin && (fin.estimateTotal > 0 || fin.invoiceTotal > 0 || fin.collected > 0 || fin.totalCosts > 0);

  return (
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
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Board — Kanban-style columns by stage
// ─────────────────────────────────────────────────────────────────────────────
function PipelineBoard({ jobs, contacts, search, locationFilter, finMap, onStageClick }: {
  jobs: Job[]; contacts: Contact[]; search: string; locationFilter: string;
  finMap: Record<number, JobFinancials>;
  onStageClick: (stageKey: string) => void;
}) {
  const [, setBoardLocation] = useLocation();
  const filtered = jobs.filter(j => {
    if (locationFilter !== "all" && (((j as any).location as string) || "Augusta") !== locationFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return j.jobNumber.toLowerCase().includes(q) ||
        (j.address || "").toLowerCase().includes(q) ||
        (j.insuranceCarrier || "").toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4">
      {PROGRESS_STAGES.map(stage => {
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
            {/* Column header — click to open this bucket in a filtered List view */}
            <button
              type="button"
              onClick={() => onStageClick(stage.key)}
              title={`View all ${stage.label} jobs`}
              className={`w-full text-left rounded-t-lg border border-b-0 px-3 py-2.5 ${stage.color} ${stage.borderColor} cursor-pointer transition-colors hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--titan-blue))]`}
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
                    <div key={job.id} className={`${isArAlert ? "border-l-2 border-[hsl(var(--titan-red))]" : ""}`}>
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
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// List View — filterable, sortable flat list
// ─────────────────────────────────────────────────────────────────────────────
function ListView({ jobs, contacts, search, stageFilter, locationFilter, selectedIds, onToggle, onToggleAll, finMap }: {
  jobs: Job[]; contacts: Contact[]; search: string; stageFilter: string; locationFilter: string;
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
    return matchSearch && matchStage && matchLocation;
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
  const [viewMode, setViewMode] = useState<"board" | "list">("list");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<string>("mitigation");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    jobNumber: `TP-${new Date().getFullYear()}-`,
    contactId: "",
    lossType: "water",
    status: "new",
    progressStage: "pending_sale",
    location: "Augusta",
    address: "",
    description: "",
    assignedTech: "",
    insuranceCarrier: "",
    claimNumber: "",
    salesDate: new Date().toISOString().slice(0, 10),
    leadSource: "" as LeadSource | "",
    leadSourceDetail: "",
  });

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

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/jobs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      setOpen(false);
      toast({ title: "Job created" });
    },
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

                <div>
                  <Label>Customer</Label>
                  <Select value={form.contactId} onValueChange={v => setForm(f => ({ ...f, contactId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                    <SelectContent>
                      {customers.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Address</Label>
                    <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Job site address" />
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

                <div>
                  <Label>Assigned Tech</Label>
                  <Select value={form.assignedTech} onValueChange={v => setForm(f => ({ ...f, assignedTech: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select tech" /></SelectTrigger>
                    <SelectContent>
                      {TEAM.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
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
                  <Label>Sale Date</Label>
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
                  disabled={createMutation.isPending}
                  onClick={() => createMutation.mutate({
                    ...form,
                    contactId: form.contactId ? Number(form.contactId) : null,
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
        <PipelineSummary
          jobs={jobs}
          finMap={finMap}
          onStageClick={(stageKey) => { setStageFilter(stageKey); setViewMode("list"); }}
        />
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
          finMap={finMap}
          onStageClick={(stageKey) => { setStageFilter(stageKey); setViewMode("list"); }}
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
                    {["new","mitigation","drying","reconstruction","complete","closed"].map(s => (
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
