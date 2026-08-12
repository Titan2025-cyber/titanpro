/**
 * JobAnalytics — per-job analytics card for the JobDetail page.
 *
 * Sits directly under Financial Summary. Reads from
 * GET /api/jobs/:id/analytics and shows the metrics that matter for
 * this specific job: cycle time, estimate variance, supplement win
 * rate, AR aging, margin, activity, and a carrier benchmark against
 * historical peers.
 *
 * Kept intentionally compact — the goal is a single glanceable card,
 * not another dashboard tab.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Clock, Percent, Target, DollarSign, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";

type JobAnalytics = {
  jobId: number;
  timeline: {
    createdAt: string | null;
    closedAt: string | null;
    daysOpen: number;
    daysToFirstInvoice: number | null;
    daysSinceTouch: number | null;
    lastNoteAt: string | null;
    lastPhotoAt: string | null;
  };
  variance: { estimateTotal: number; settledTotal: number; variancePct: number };
  supplements: {
    filed: number;
    approvedCount: number;
    approvalRate: number;
    requested: number;
    approved: number;
    winRateAmount: number;
  };
  agingAR: {
    buckets: { d0_30: number; d31_60: number; d61_90: number; d90plus: number; totalOutstanding: number };
    oldestDays: number;
    invoiceCount: number;
  };
  margin: { collected: number; costs: number; grossProfit: number; marginPct: number };
  activity: { photos: number; notes: number };
  carrierBenchmark: null | {
    carrier: string;
    peers: number;
    medianVariancePct: number | null;
    medianCycleDays: number | null;
  };
};

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const pct = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : `${n.toFixed(digits)}%`;
const days = (n: number | null | undefined) =>
  n == null ? "—" : `${n}d`;

export function JobAnalytics({ jobId }: { jobId: number }) {
  const { data, isLoading } = useQuery<JobAnalytics>({
    queryKey: [`/api/jobs/${jobId}/analytics`],
    queryFn: async () => {
      const r = await fetch(`/api/jobs/${jobId}/analytics`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load job analytics");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  return (
    <Card data-testid="card-job-analytics">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
          Job Analytics
          {data?.carrierBenchmark && (
            <Badge variant="outline" className="ml-1 text-[10px] font-medium">
              vs. {data.carrierBenchmark.carrier} ({data.carrierBenchmark.peers} peer jobs)
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading || !data ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
              <Metric
                icon={<Clock className="w-3.5 h-3.5" />}
                label="Days open"
                value={days(data.timeline.daysOpen)}
                sub={data.timeline.closedAt ? "closed" : "still open"}
              />
              <Metric
                icon={<Clock className="w-3.5 h-3.5" />}
                label="Cycle to invoice"
                value={days(data.timeline.daysToFirstInvoice)}
                sub={data.timeline.daysToFirstInvoice == null ? "no invoice yet" : "created → first invoice"}
                benchmark={data.carrierBenchmark?.medianCycleDays != null
                  ? `carrier median ${days(data.carrierBenchmark.medianCycleDays)}`
                  : undefined}
                positive={data.timeline.daysToFirstInvoice != null && data.carrierBenchmark?.medianCycleDays != null
                  ? data.timeline.daysToFirstInvoice <= data.carrierBenchmark.medianCycleDays
                  : undefined}
              />
              <Metric
                icon={<AlertTriangle className="w-3.5 h-3.5" />}
                label="Days since touch"
                value={days(data.timeline.daysSinceTouch)}
                sub={data.timeline.daysSinceTouch == null
                  ? "no photos/notes"
                  : "last photo or note"}
                positive={data.timeline.daysSinceTouch == null ? undefined : data.timeline.daysSinceTouch <= 7}
              />
              <Metric
                icon={<Percent className="w-3.5 h-3.5" />}
                label="Estimate variance"
                value={data.variance.estimateTotal > 0 ? pct(data.variance.variancePct) : "—"}
                sub={data.variance.estimateTotal > 0
                  ? `${money(data.variance.settledTotal)} vs ${money(data.variance.estimateTotal)}`
                  : "no estimate + settled yet"}
                benchmark={data.carrierBenchmark?.medianVariancePct != null
                  ? `carrier median ${pct(data.carrierBenchmark.medianVariancePct)}`
                  : undefined}
                positive={data.variance.estimateTotal > 0 ? data.variance.variancePct >= 0 : undefined}
              />
              <Metric
                icon={<Target className="w-3.5 h-3.5" />}
                label="Supplement win rate"
                value={data.supplements.filed > 0 ? pct(data.supplements.approvalRate) : "—"}
                sub={data.supplements.filed === 0
                  ? "no supplements filed"
                  : `${data.supplements.approvedCount}/${data.supplements.filed} approved · ${money(data.supplements.approved)}`}
                positive={data.supplements.filed > 0 ? data.supplements.approvalRate >= 50 : undefined}
              />
              <Metric
                icon={<DollarSign className="w-3.5 h-3.5" />}
                label="Outstanding AR"
                value={money(data.agingAR.buckets.totalOutstanding)}
                sub={data.agingAR.oldestDays > 0
                  ? `oldest ${days(data.agingAR.oldestDays)} · ${data.agingAR.invoiceCount} invoice${data.agingAR.invoiceCount === 1 ? "" : "s"}`
                  : "nothing outstanding"}
                positive={data.agingAR.buckets.d90plus === 0}
              />
              <Metric
                icon={data.margin.marginPct >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                label="Job margin"
                value={data.margin.collected > 0 ? pct(data.margin.marginPct) : "—"}
                sub={data.margin.collected > 0
                  ? `${money(data.margin.grossProfit)} profit on ${money(data.margin.collected)} collected`
                  : "nothing collected yet"}
                positive={data.margin.collected > 0 ? data.margin.marginPct >= 20 : undefined}
              />
              <Metric
                icon={<Activity className="w-3.5 h-3.5" />}
                label="Activity"
                value={`${data.activity.photos + data.activity.notes}`}
                sub={`${data.activity.photos} photo${data.activity.photos === 1 ? "" : "s"} · ${data.activity.notes} note${data.activity.notes === 1 ? "" : "s"}`}
              />
            </div>

            {/* Aging AR mini-bucket breakdown (only when there's AR to show) */}
            {data.agingAR.buckets.totalOutstanding > 0 && (
              <div className="mt-4 pt-3 border-t">
                <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Aging AR
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <AgingCell label="0–30d" value={data.agingAR.buckets.d0_30} tone="green" />
                  <AgingCell label="31–60d" value={data.agingAR.buckets.d31_60} tone="yellow" />
                  <AgingCell label="61–90d" value={data.agingAR.buckets.d61_90} tone="orange" />
                  <AgingCell label="90+ d" value={data.agingAR.buckets.d90plus} tone="red" />
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ icon, label, value, sub, benchmark, positive }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  benchmark?: string;
  positive?: boolean;
}) {
  const valueClass =
    positive === true ? "text-green-600 dark:text-green-400"
    : positive === false ? "text-red-600 dark:text-red-400"
    : "text-foreground";
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-lg font-bold ${valueClass}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      {benchmark && <div className="text-[11px] text-muted-foreground/80 italic mt-0.5">{benchmark}</div>}
    </div>
  );
}

function AgingCell({ label, value, tone }: { label: string; value: number; tone: "green" | "yellow" | "orange" | "red" }) {
  const toneClass = {
    green:  "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20",
    yellow: "border-amber-200 bg-amber-50 dark:bg-amber-950/20",
    orange: "border-orange-200 bg-orange-50 dark:bg-orange-950/20",
    red:    "border-red-200 bg-red-50 dark:bg-red-950/20",
  }[tone];
  return (
    <div className={`rounded-md border p-2 ${toneClass}`}>
      <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{money(value)}</div>
    </div>
  );
}
