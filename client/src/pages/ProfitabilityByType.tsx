import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, DollarSign, Clock, BarChart3 } from "lucide-react";

const LOSS_ICONS: Record<string, string> = {
  water: "💧", fire: "🔥", mold: "🍄", storm: "⛈️",
  biohazard: "☣️", reconstruction: "🏗️", unknown: "❓",
};

function MarginBadge({ pct }: { pct: number }) {
  if (pct >= 60) return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">{pct}%</Badge>;
  if (pct >= 40) return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">{pct}%</Badge>;
  return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">{pct}%</Badge>;
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-2 bg-muted rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ProfitabilityByType() {
  const { data: rows = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/reports/profitability-by-type"],
    queryFn: () => apiRequest("GET", "/api/reports/profitability-by-type").then(r => r.json()),
  });

  const maxInvoiced = Math.max(...rows.map((r: any) => r.totalInvoiced || 0), 1);
  const totalInvoiced = rows.reduce((s: number, r: any) => s + (r.totalInvoiced || 0), 0);
  const totalCollected = rows.reduce((s: number, r: any) => s + (r.totalCollected || 0), 0);
  const totalJobs = rows.reduce((s: number, r: any) => s + (r.jobs || 0), 0);
  const bestMargin = rows.reduce((best: any, r: any) => (!best || r.grossMargin > best.grossMargin) ? r : best, null);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="w-6 h-6 text-[hsl(var(--titan-blue))]" />
        <div>
          <h1 className="text-xl font-bold">Profitability by Loss Type</h1>
          <p className="text-sm text-muted-foreground">Margin, collection rate, and cycle time per loss category</p>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total Invoiced</p>
            <p className="text-xl font-bold mt-1 text-[hsl(var(--titan-blue))]" data-testid="text-total-invoiced">
              ${totalInvoiced.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total Collected</p>
            <p className="text-xl font-bold mt-1 text-green-600" data-testid="text-total-collected">
              ${totalCollected.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total Jobs</p>
            <p className="text-xl font-bold mt-1" data-testid="text-total-jobs">{totalJobs}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Best Margin</p>
            <p className="text-sm font-bold mt-1 capitalize" data-testid="text-best-margin">
              {bestMargin ? `${LOSS_ICONS[bestMargin.lossType] || "📋"} ${bestMargin.lossType}` : "—"}
            </p>
            {bestMargin && <p className="text-xs text-green-600">{bestMargin.grossMargin}% margin</p>}
          </CardContent>
        </Card>
      </div>

      {/* By Type Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Loss Type Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No profitability data yet</p>
              <p className="text-sm mt-1">Data appears once jobs have invoices and costs</p>
            </div>
          ) : (
            <div className="divide-y">
              {rows.map((row: any) => (
                <div key={row.lossType} className="p-4 hover:bg-muted/30 transition-colors" data-testid={`row-type-${row.lossType}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{LOSS_ICONS[row.lossType] || "📋"}</span>
                      <div>
                        <p className="font-semibold text-sm capitalize">{row.lossType}</p>
                        <p className="text-xs text-muted-foreground">{row.jobs} job{row.jobs !== 1 ? "s" : ""}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <MarginBadge pct={row.grossMargin} />
                    </div>
                  </div>

                  <Bar value={row.totalInvoiced} max={maxInvoiced} color="bg-[hsl(var(--titan-blue))]" />

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Invoiced</p>
                      <p className="text-sm font-semibold">${row.totalInvoiced.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Collected</p>
                      <p className="text-sm font-semibold text-green-600">${row.totalCollected.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Avg Job Value</p>
                      <p className="text-sm font-semibold">${row.avgJobValue.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Avg Cycle
                      </p>
                      <p className="text-sm font-semibold">
                        {row.avgCycleDays !== null ? `${row.avgCycleDays}d` : "—"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Collection rate: <strong className="text-foreground">{row.collectionRate}%</strong></span>
                    <span>Job costs: <strong className="text-foreground">${row.totalCosts.toLocaleString()}</strong></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
