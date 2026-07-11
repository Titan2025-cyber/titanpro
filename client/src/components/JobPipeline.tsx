/**
 * JobPipeline.tsx
 * Shared pipeline stage definitions, StageSelector popover, and DateManager popover.
 * Used by both Jobs.tsx (list/board views) and JobDetail.tsx (Pipeline tab).
 */
import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Clock, Calendar, Wrench, FileText, DollarSign, CheckCircle2,
  ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Job } from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Stage definitions
// ─────────────────────────────────────────────────────────────────────────────
export interface ProgressStage {
  key: string;
  label: string;
  shortLabel: string;
  description: string;
  dateField: string;
  dateLabel: string;
  color: string;
  textColor: string;
  borderColor: string;
  icon: any;
  order: number;
}

export const PROGRESS_STAGES: ProgressStage[] = [
  {
    key: "pending_sale",
    label: "Pending Sale",
    shortLabel: "Pending",
    description: "Lead received — awaiting signed auth or approval to proceed",
    dateField: "salesDate",
    dateLabel: "Sale Date",
    color: "bg-slate-100 dark:bg-slate-800",
    textColor: "text-slate-700 dark:text-slate-300",
    borderColor: "border-slate-300 dark:border-slate-600",
    icon: Clock,
    order: 0,
  },
  {
    key: "pre_production",
    label: "Pre-Production",
    shortLabel: "Pre-Prod",
    description: "Job sold — scheduling, permits, materials, planning underway",
    dateField: "preProductionDate",
    dateLabel: "Pre-Production Start",
    color: "bg-amber-50 dark:bg-amber-950/30",
    textColor: "text-amber-700 dark:text-amber-400",
    borderColor: "border-amber-300 dark:border-amber-700",
    icon: Calendar,
    order: 1,
  },
  {
    key: "wip",
    label: "Work in Progress",
    shortLabel: "WIP",
    description: "Active field work underway — mitigation, drying, or reconstruction",
    dateField: "wipDate",
    dateLabel: "WIP Start Date",
    color: "bg-blue-50 dark:bg-blue-950/30",
    textColor: "text-[hsl(var(--titan-blue))] dark:text-blue-400",
    borderColor: "border-[hsl(var(--titan-blue)/0.4)]",
    icon: Wrench,
    order: 2,
  },
  {
    key: "invoice_pending",
    label: "Invoice Pending",
    shortLabel: "Invoice",
    description: "Work complete — invoice sent, awaiting payment",
    dateField: "invoiceSentDate",
    dateLabel: "Invoice Sent Date",
    color: "bg-purple-50 dark:bg-purple-950/30",
    textColor: "text-purple-700 dark:text-purple-400",
    borderColor: "border-purple-300 dark:border-purple-700",
    icon: FileText,
    order: 3,
  },
  {
    key: "accounts_receivable",
    label: "Accounts Receivable",
    shortLabel: "A/R",
    description: "Invoice overdue or disputed — actively following up",
    dateField: "invoiceSentDate",
    dateLabel: "Invoice Sent Date",
    color: "bg-red-50 dark:bg-red-950/30",
    textColor: "text-[hsl(var(--titan-red))] dark:text-red-400",
    borderColor: "border-[hsl(var(--titan-red)/0.4)]",
    icon: DollarSign,
    order: 4,
  },
  {
    key: "complete",
    label: "Complete",
    shortLabel: "Done",
    description: "Invoice paid and job fully closed",
    dateField: "invoicePaidDate",
    dateLabel: "Payment Received Date",
    color: "bg-green-50 dark:bg-green-950/30",
    textColor: "text-green-700 dark:text-green-400",
    borderColor: "border-green-300 dark:border-green-700",
    icon: CheckCircle2,
    order: 5,
  },
];

export function getStageForJob(job: Job): ProgressStage {
  return PROGRESS_STAGES.find(s => s.key === ((job as any).progressStage || "pending_sale")) || PROGRESS_STAGES[0];
}

export function daysAgo(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

export function formatPipelineDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────
// StageSelector — clickable badge that opens stage picker
// ─────────────────────────────────────────────────────────────────────────────
export function StageSelector({ job }: { job: Job }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const currentStage = getStageForJob(job);

  const updateMutation = useMutation({
    mutationFn: (updates: Partial<Job>) =>
      apiRequest("PATCH", `/api/jobs/${job.id}`, updates).then(r => r.json()),
    onSuccess: (updatedJob: Job) => {
      // Set cache for both numeric and string id (useParams returns string)
      queryClient.setQueryData(["/api/jobs", job.id], updatedJob);
      queryClient.setQueryData(["/api/jobs", String(job.id)], updatedJob);
      // Invalidate the list + any sub-queries so everything re-fetches
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setOpen(false);
    },
    onError: () => toast({ title: "Failed to update stage", variant: "destructive" }),
  });

  const handleStageSelect = (stageKey: string) => {
    const now = new Date().toISOString().slice(0, 10);
    const stage = PROGRESS_STAGES.find(s => s.key === stageKey)!;
    const updates: any = { progressStage: stageKey };

    if (!(job as any)[stage.dateField]) {
      updates[stage.dateField] = now;
    }

    const statusMap: Record<string, string> = {
      pending_sale: "new",
      pre_production: "new",
      wip: "mitigation",
      invoice_pending: "reconstruction",
      accounts_receivable: "reconstruction",
      complete: "complete",
    };
    if (statusMap[stageKey]) updates.status = statusMap[stageKey];

    updateMutation.mutate(updates);
  };

  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on any outside click — no backdrop div needed
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    // Use capture so we see the event before stopPropagation on child elements
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [open]);

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold border transition-colors ${currentStage.color} ${currentStage.textColor} ${currentStage.borderColor} hover:opacity-80`}
        onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}
        data-testid={`stage-badge-${job.id}`}
        type="button"
      >
        <currentStage.icon className="w-3 h-3" />
        {currentStage.shortLabel}
        <ChevronDown className="w-2.5 h-2.5 ml-0.5 opacity-60" />
      </button>
      {open && (
        <div
          style={{ position: "absolute", left: 0, top: "100%", marginTop: 4, zIndex: 9999, minWidth: 288 }}
          className="rounded-lg border bg-popover shadow-lg p-2"
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 mb-2">Move to Stage</p>
          <div className="space-y-1">
            {PROGRESS_STAGES.map(stage => (
              <button
                key={stage.key}
                className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors hover:bg-muted/60 ${stage.key === currentStage.key ? "bg-muted" : ""}`}
                onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
                onClick={e => { e.preventDefault(); e.stopPropagation(); handleStageSelect(stage.key); }}
                data-testid={`stage-option-${stage.key}`}
                type="button"
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${stage.color} ${stage.textColor}`}>
                  <stage.icon className="w-3 h-3" />
                </div>
                <div>
                  <p className="text-sm font-medium leading-tight">{stage.label}</p>
                  <p className="text-xs text-muted-foreground leading-tight mt-0.5">{stage.description}</p>
                </div>
                {stage.key === currentStage.key && (
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 ml-auto mt-1" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DateManager — popover with all 5 milestone date inputs
// ─────────────────────────────────────────────────────────────────────────────
export function DateManager({ job }: { job: Job }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState({
    salesDate: ((job as any).salesDate as string) || "",
    preProductionDate: ((job as any).preProductionDate as string) || "",
    wipDate: ((job as any).wipDate as string) || "",
    invoiceSentDate: ((job as any).invoiceSentDate as string) || "",
    invoicePaidDate: ((job as any).invoicePaidDate as string) || "",
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/jobs/${job.id}`, dates).then(r => r.json()),
    onSuccess: (updatedJob: Job) => {
      queryClient.setQueryData(["/api/jobs", job.id], updatedJob);
      queryClient.setQueryData(["/api/jobs", String(job.id)], updatedJob);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Milestone dates saved" });
      setOpen(false);
    },
  });

  const DATE_FIELDS = [
    { key: "salesDate", label: "Sale Date", stage: PROGRESS_STAGES[0] },
    { key: "preProductionDate", label: "Pre-Production Start", stage: PROGRESS_STAGES[1] },
    { key: "wipDate", label: "WIP Start", stage: PROGRESS_STAGES[2] },
    { key: "invoiceSentDate", label: "Invoice Sent", stage: PROGRESS_STAGES[3] },
    { key: "invoicePaidDate", label: "Payment Received", stage: PROGRESS_STAGES[5] },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}
          data-testid={`dates-button-${job.id}`}
          type="button"
        >
          <Calendar className="w-3 h-3" />Dates
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3" align="start" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-semibold mb-3">Pipeline Milestone Dates</p>
        <div className="space-y-2.5">
          {DATE_FIELDS.map(f => (
            <div key={f.key} className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${f.stage.color} ${f.stage.textColor}`}>
                <f.stage.icon className="w-2.5 h-2.5" />
              </div>
              <Label className="text-xs w-36 shrink-0">{f.label}</Label>
              <Input
                type="date"
                className="h-7 text-xs flex-1"
                value={(dates as any)[f.key]}
                onChange={e => setDates(d => ({ ...d, [f.key]: e.target.value }))}
                data-testid={`date-input-${f.key}-${job.id}`}
              />
            </div>
          ))}
        </div>
        <Button
          className="w-full mt-3 h-8 text-xs bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving…" : "Save Dates"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
