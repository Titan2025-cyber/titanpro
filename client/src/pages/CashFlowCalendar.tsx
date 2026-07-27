/**
 * CashFlowCalendar.tsx — #3 13-Week Rolling Cash Flow Calendar
 * Maps expected invoice payment dates vs scheduled costs
 */
import { useState, Fragment } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CalendarDays, ChevronRight, ChevronDown, ExternalLink } from "lucide-react";

const fmt$ = (n: number) => "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

// Expandable line-item detail for one week bucket. `detail` is delivered inline
// with the week row (from /api/cash-flow/13-week), so no extra fetch is needed —
// we just render the inflow invoices and scheduled costs with links to open jobs.
function WeekDetail({ detail, weekStart, weekEnd }: { detail: { inflow: any[]; costs: any[] }; weekStart: string; weekEnd: string }) {
  const inflow = detail?.inflow || [];
  const costs = detail?.costs || [];
  if (inflow.length === 0 && costs.length === 0) {
    return <p className="text-sm text-muted-foreground">No expected inflow or scheduled costs in this week.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-muted-foreground">Details for {weekStart} – {weekEnd}</p>
      <div className="grid md:grid-cols-2 gap-x-8 gap-y-4">
        {inflow.length > 0 && (
          <div>
            <p className="text-xs font-semibold mb-1 pb-1 border-b text-green-700 dark:text-green-400">Expected Inflow — open invoices ({inflow.length})</p>
            <div className="divide-y divide-border/50">
              {inflow.map((r) => (
                <div key={`in-${r.id}`} className="flex items-center justify-between py-1 text-sm" data-testid={`cf-inflow-${r.id}`}>
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{r.invoiceNumber || `Invoice #${r.id}`}</span>
                    <span className="text-muted-foreground">{r.contactName || "—"}</span>
                    {r.jobId && <Link href={`/jobs/${r.jobId}`} className="inline-flex items-center gap-0.5 text-[hsl(var(--titan-blue))] hover:underline" data-testid={`cf-inflow-link-${r.id}`}>{r.jobNumber || "job"}<ExternalLink className="w-3 h-3" /></Link>}
                  </span>
                  <span className="font-semibold text-green-600 dark:text-green-400">{fmt$(r.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {costs.length > 0 && (
          <div>
            <p className="text-xs font-semibold mb-1 pb-1 border-b text-orange-700 dark:text-orange-400">Scheduled Costs ({costs.length})</p>
            <div className="divide-y divide-border/50">
              {costs.map((r) => (
                <div key={`co-${r.type}-${r.id}`} className="flex items-center justify-between py-1 text-sm" data-testid={`cf-cost-${r.type}-${r.id}`}>
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs capitalize">{r.type}</Badge>
                    <span className="text-muted-foreground">{r.label}</span>
                    {r.jobId && <Link href={`/jobs/${r.jobId}`} className="inline-flex items-center gap-0.5 text-[hsl(var(--titan-blue))] hover:underline">{r.jobNumber || "job"}<ExternalLink className="w-3 h-3" /></Link>}
                  </span>
                  <span className="font-semibold text-orange-600 dark:text-orange-400">{fmt$(r.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CashFlowCalendar() {
  const { data: cf = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/cash-flow/13-week"],
    queryFn: () => apiRequest("GET", "/api/cash-flow/13-week").then(r => r.json()),
  });
  // Which week row is expanded to show its line-item detail. null = none.
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);

  const totalInflow = cf.reduce((s, w) => s + (w.expectedInflow || 0), 0);
  const totalOutflow = cf.reduce((s, w) => s + (w.scheduledCosts || 0), 0);
  const netPosition = totalInflow - totalOutflow;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <CalendarDays className="w-6 h-6 text-[hsl(var(--titan-blue))]" />
        <h1 className="text-xl font-bold">13-Week Cash Flow</h1>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Expected Inflow</p>
            <p className="text-xl font-bold text-green-600">{fmt$(totalInflow)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Scheduled Costs</p>
            <p className="text-xl font-bold text-orange-600">{fmt$(totalOutflow)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Net 13-Week Position</p>
            <p className={`text-xl font-bold ${netPosition >= 0 ? "text-green-600" : "text-[hsl(var(--titan-red))]"}`}>
              {netPosition >= 0 ? "+" : "-"}{fmt$(netPosition)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Week-by-week table */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-muted animate-pulse rounded" />)}</div>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Weekly Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-2 py-2 w-6"></th>
                    <th className="text-left px-4 py-2">Week</th>
                    <th className="text-right px-4 py-2">Expected In</th>
                    <th className="text-right px-4 py-2">Scheduled Out</th>
                    <th className="text-right px-4 py-2">Net</th>
                    <th className="text-right px-4 py-2">Open Invoices</th>
                    <th className="px-4 py-2">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {cf.map((week: any, i: number) => {
                    const net = (week.expectedInflow || 0) - (week.scheduledCosts || 0);
                    const isNeg = net < 0;
                    const isOpen = expandedWeek === i;
                    return (
                      <Fragment key={i}>
                      <tr
                        className="border-b hover:bg-muted/20 transition-colors cursor-pointer"
                        data-testid={`cf-week-row-${i}`}
                        onClick={() => setExpandedWeek(isOpen ? null : i)}
                        title={isOpen ? "Hide details" : "Click to review what's in this week"}
                      >
                        <td className="px-2 py-2.5 text-muted-foreground">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium">Week {i + 1}</div>
                          <div className="text-xs text-muted-foreground">{week.weekStart} – {week.weekEnd}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-green-600 font-medium">{fmt$(week.expectedInflow || 0)}</td>
                        <td className="px-4 py-2.5 text-right text-orange-600 font-medium">{fmt$(week.scheduledCosts || 0)}</td>
                        <td className={`px-4 py-2.5 text-right font-bold ${isNeg ? "text-[hsl(var(--titan-red))]" : "text-green-600"}`}>
                          {isNeg ? "-" : "+"}{fmt$(net)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{week.openInvoiceCount || 0}</td>
                        <td className="px-4 py-2.5">
                          {isNeg ? (
                            <Badge className="bg-red-100 text-red-700 text-xs gap-1"><AlertTriangle className="w-2.5 h-2.5" />Deficit</Badge>
                          ) : net < 2000 ? (
                            <Badge className="bg-yellow-100 text-yellow-700 text-xs">Low</Badge>
                          ) : (
                            <Badge className="bg-green-100 text-green-700 text-xs">Good</Badge>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b bg-muted/20">
                          <td colSpan={7} className="px-4 py-3">
                            <WeekDetail detail={week.detail} weekStart={week.weekStart} weekEnd={week.weekEnd} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Expected inflow = open invoices projected by carrier average pay times. Scheduled costs = payout requests + equipment deployments.
      </p>
    </div>
  );
}
