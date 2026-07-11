import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Tag, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LeadSource =
  | "referral"
  | "google"
  | "door_knock"
  | "insurance_direct"
  | "repeat"
  | "other";

interface LeadSourceRow {
  source: LeadSource;
  jobCount: number;
  totalRevenue: number;
}

interface LeadAttributionReport {
  sources: LeadSourceRow[];
  totalJobs: number;
  totalRevenue: number;
  untaggedCount: number;
}

interface Job {
  id: number;
  jobNumber: string;
  address: string;
  customerName?: string;
  leadSource?: LeadSource | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  referral: "Referral Partner",
  google: "Google / SEO",
  door_knock: "Door Knock / Canvass",
  insurance_direct: "Insurance Direct",
  repeat: "Repeat Customer",
  other: "Other",
};

const LEAD_SOURCE_COLORS: Record<LeadSource, string> = {
  referral: "hsl(var(--titan-blue))",
  google: "#4285F4",
  door_knock: "#F59E0B",
  insurance_direct: "#10B981",
  repeat: "hsl(var(--titan-red))",
  other: "#94A3B8",
};

const ALL_LEAD_SOURCES: LeadSource[] = [
  "referral",
  "google",
  "door_knock",
  "insurance_direct",
  "repeat",
  "other",
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// ─── Exported reusable LeadSourceSelect ──────────────────────────────────────

interface LeadSourceSelectProps {
  value: LeadSource | "" | undefined;
  onChange: (value: LeadSource) => void;
  placeholder?: string;
}

export function LeadSourceSelect({
  value,
  onChange,
  placeholder = "Select lead source",
}: LeadSourceSelectProps) {
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v as LeadSource)}>
      <SelectTrigger data-testid="lead-source-select">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {ALL_LEAD_SOURCES.map((src) => (
          <SelectItem key={src} value={src}>
            {LEAD_SOURCE_LABELS[src]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Source Bar Row ───────────────────────────────────────────────────────────

interface SourceBarProps {
  row: LeadSourceRow;
  totalRevenue: number;
}

function SourceBar({ row, totalRevenue }: SourceBarProps) {
  const pct = totalRevenue > 0 ? (row.totalRevenue / totalRevenue) * 100 : 0;
  const color = LEAD_SOURCE_COLORS[row.source] ?? "#94A3B8";

  return (
    <div className="py-3 border-b last:border-b-0">
      <div className="flex items-center justify-between mb-1.5 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block h-3 w-3 rounded-full shrink-0"
            style={{ background: color }}
          />
          <span className="font-medium text-sm truncate">
            {LEAD_SOURCE_LABELS[row.source]}
          </span>
        </div>
        <div className="flex items-center gap-4 shrink-0 text-sm">
          <span className="text-muted-foreground">{row.jobCount} jobs</span>
          <span className="font-semibold w-24 text-right">
            {formatCurrency(row.totalRevenue)}
          </span>
          <span className="text-muted-foreground w-12 text-right">
            {pct.toFixed(1)}%
          </span>
        </div>
      </div>
      {/* Horizontal bar */}
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
          data-testid={`source-bar-${row.source}`}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}

// ─── Tag Now Popover ──────────────────────────────────────────────────────────

function TagNowPopover({ job }: { job: Job }) {
  const [open, setOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<LeadSource | "">("");
  const queryClient = useQueryClient();

  const patchMutation = useMutation({
    mutationFn: (leadSource: LeadSource) =>
      apiRequest("PATCH", `/api/jobs/${job.id}`, { leadSource }).then((r) =>
        r.json()
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/lead-attribution"] });
      setOpen(false);
      setSelectedSource("");
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          data-testid={`tag-now-btn-${job.id}`}
        >
          <Tag className="h-3 w-3" />
          Tag Now
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="end">
        <p className="text-sm font-medium mb-2">Set lead source</p>
        <LeadSourceSelect
          value={selectedSource}
          onChange={(v) => setSelectedSource(v)}
          placeholder="Choose source…"
        />
        <Button
          className="mt-2 w-full h-8 text-sm"
          disabled={!selectedSource || patchMutation.isPending}
          onClick={() => {
            if (selectedSource) patchMutation.mutate(selectedSource);
          }}
          data-testid={`tag-confirm-btn-${job.id}`}
        >
          {patchMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LeadAttribution() {
  const { data: rawReport, isLoading: reportLoading, isError: reportError } =
    useQuery<any>({
      queryKey: ["/api/reports/lead-attribution"],
      queryFn: () =>
        apiRequest("GET", "/api/reports/lead-attribution").then((r) => r.json()),
    });

  // Normalize: API returns array, component expects {sources, totalJobs, totalRevenue, untaggedCount}
  const report: LeadAttributionReport | undefined = rawReport
    ? Array.isArray(rawReport)
      ? {
          sources: rawReport.map((s: any) => ({
            source: s.source as any,
            jobCount: s.jobCount ?? 0,
            totalRevenue: s.totalRevenue ?? 0,
            paidRevenue: s.paidRevenue ?? 0,
            jobs: s.jobs ?? [],
          })),
          totalJobs: rawReport.reduce((s: number, r: any) => s + (r.jobCount ?? 0), 0),
          totalRevenue: rawReport.reduce((s: number, r: any) => s + (r.totalRevenue ?? 0), 0),
          untaggedCount: rawReport.find((r: any) => r.source === 'unknown')?.jobCount ?? 0,
        }
      : rawReport
    : undefined;

  const { data: allJobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("GET", "/api/jobs").then((r) => r.json()),
  });

  const untaggedJobs = allJobs.filter((j) => !j.leadSource);

  const coveragePct =
    report && report.totalJobs > 0
      ? (((report.totalJobs - report.untaggedCount) / report.totalJobs) * 100).toFixed(1)
      : "0";

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Lead Attribution</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Where your jobs come from
        </p>
      </div>

      {/* Summary strip */}
      {!reportLoading && report && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Jobs Tracked</p>
              <p className="text-2xl font-bold mt-1">{report.totalJobs}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Untagged Jobs</p>
              <p className="text-2xl font-bold mt-1 text-yellow-600">
                {report.untaggedCount}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Attribution Coverage</p>
              <p className="text-2xl font-bold mt-1 text-green-600">
                {coveragePct}%
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Loading skeleton */}
      {reportLoading && (
        <Card className="animate-pulse">
          <CardContent className="p-6 space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-4 w-1/3 rounded bg-muted" />
                <div className="h-2 w-full rounded bg-muted" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {reportError && (
        <Card className="border-destructive">
          <CardContent className="p-6 text-center text-sm text-destructive">
            Failed to load attribution data.
          </CardContent>
        </Card>
      )}

      {/* Source bars */}
      {!reportLoading && report && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revenue by Lead Source</CardTitle>
          </CardHeader>
          <CardContent>
            {report.sources.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No attributed jobs yet. Tag jobs with a lead source to see data here.
              </p>
            ) : (
              report.sources.map((row) => (
                <SourceBar
                  key={row.source}
                  row={row}
                  totalRevenue={report.totalRevenue}
                />
              ))
            )}
          </CardContent>
        </Card>
      )}

      {/* Untagged jobs */}
      {untaggedJobs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-yellow-500" />
              <CardTitle className="text-base">
                Untagged Jobs ({untaggedJobs.length})
              </CardTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              These jobs have no lead source set. Tag them to improve attribution accuracy.
            </p>
          </CardHeader>
          <CardContent>
            <div className="divide-y rounded-md border overflow-hidden">
              {untaggedJobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between px-3 py-2.5 text-sm hover:bg-muted/50"
                  data-testid={`untagged-job-${job.id}`}
                >
                  <div className="min-w-0">
                    <span className="font-medium">{job.jobNumber}</span>
                    {job.customerName && (
                      <span className="ml-2 text-muted-foreground">
                        {job.customerName}
                      </span>
                    )}
                    <p className="text-xs text-muted-foreground truncate">
                      {job.address}
                    </p>
                  </div>
                  <TagNowPopover job={job} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
