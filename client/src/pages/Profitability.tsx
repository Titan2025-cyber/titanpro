import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, DollarSign, Users, Building2, AlertTriangle } from "lucide-react";

function formatCurrency(n: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n); }
function marginColor(m: number) { if (m >= 50) return "text-green-600"; if (m >= 30) return "text-yellow-600"; return "text-red-600"; }
function marginBg(m: number) { if (m >= 50) return "bg-green-500"; if (m >= 30) return "bg-yellow-400"; return "bg-red-500"; }

export default function Profitability() {
  const { data: jobs = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/reports/profitability"] });

  const totalInvoiced = jobs.reduce((s: number, j: any) => s + j.totalInvoiced, 0);
  const totalCollected = jobs.reduce((s: number, j: any) => s + j.totalCollected, 0);
  const totalCosts = jobs.reduce((s: number, j: any) => s + j.totalCosts, 0);
  const overallMargin = totalInvoiced > 0 ? ((totalInvoiced - totalCosts) / totalInvoiced * 100) : 0;

  // Group by tech
  const byTech: Record<string, any> = {};
  jobs.forEach((j: any) => {
    const t = j.assignedTech || "Unassigned";
    if (!byTech[t]) byTech[t] = { jobs: 0, invoiced: 0, costs: 0 };
    byTech[t].jobs++; byTech[t].invoiced += j.totalInvoiced; byTech[t].costs += j.totalCosts;
  });

  // Group by carrier
  const byCarrier: Record<string, any> = {};
  jobs.forEach((j: any) => {
    const c = j.insuranceCarrier || "Direct/Unknown";
    if (!byCarrier[c]) byCarrier[c] = { jobs: 0, invoiced: 0, costs: 0 };
    byCarrier[c].jobs++; byCarrier[c].invoiced += j.totalInvoiced; byCarrier[c].costs += j.totalCosts;
  });

  // Group by loss type
  const byLossType: Record<string, any> = {};
  jobs.forEach((j: any) => {
    const l = j.lossType || "other";
    if (!byLossType[l]) byLossType[l] = { jobs: 0, invoiced: 0, costs: 0 };
    byLossType[l].jobs++; byLossType[l].invoiced += j.totalInvoiced; byLossType[l].costs += j.totalCosts;
  });

  const calcMargin = (inv: number, cost: number) => inv > 0 ? ((inv - cost) / inv * 100) : 0;

  if (isLoading) return <div className="p-6"><div className="h-64 bg-muted rounded animate-pulse" /></div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Job Profitability</h1>
        <p className="text-sm text-muted-foreground">Gross margin by job, technician, carrier, and loss type</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Invoiced</p>
          <p className="text-xl font-bold text-foreground">{formatCurrency(totalInvoiced)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Collected</p>
          <p className="text-xl font-bold text-green-600">{formatCurrency(totalCollected)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Costs</p>
          <p className="text-xl font-bold text-red-600">{formatCurrency(totalCosts)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Overall Gross Margin</p>
          <p className={`text-xl font-bold ${marginColor(overallMargin)}`}>{overallMargin.toFixed(1)}%</p>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* By Tech */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" /> By Technician</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(byTech).sort(([,a]: any, [,b]: any) => b.invoiced - a.invoiced).map(([tech, d]: any) => {
              const m = calcMargin(d.invoiced, d.costs);
              return (
                <div key={tech} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{tech}</span>
                    <span className={`font-semibold ${marginColor(m)}`}>{m.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${marginBg(m)}`} style={{ width: `${Math.min(m, 100)}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">{d.jobs} jobs · {formatCurrency(d.invoiced)} invoiced</p>
                </div>
              );
            })}
            {Object.keys(byTech).length === 0 && <p className="text-sm text-muted-foreground">No data yet</p>}
          </CardContent>
        </Card>

        {/* By Carrier */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Building2 className="w-4 h-4" /> By Carrier</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(byCarrier).sort(([,a]: any, [,b]: any) => b.invoiced - a.invoiced).map(([carrier, d]: any) => {
              const m = calcMargin(d.invoiced, d.costs);
              return (
                <div key={carrier} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{carrier}</span>
                    <span className={`font-semibold ${marginColor(m)}`}>{m.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${marginBg(m)}`} style={{ width: `${Math.min(m, 100)}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">{d.jobs} jobs · {formatCurrency(d.invoiced)}</p>
                </div>
              );
            })}
            {Object.keys(byCarrier).length === 0 && <p className="text-sm text-muted-foreground">No data yet</p>}
          </CardContent>
        </Card>

        {/* By Loss Type */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4" /> By Loss Type</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(byLossType).sort(([,a]: any, [,b]: any) => b.invoiced - a.invoiced).map(([loss, d]: any) => {
              const m = calcMargin(d.invoiced, d.costs);
              return (
                <div key={loss} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium capitalize">{loss}</span>
                    <span className={`font-semibold ${marginColor(m)}`}>{m.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${marginBg(m)}`} style={{ width: `${Math.min(m, 100)}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">{d.jobs} jobs · {formatCurrency(d.invoiced)}</p>
                </div>
              );
            })}
            {Object.keys(byLossType).length === 0 && <p className="text-sm text-muted-foreground">No data yet</p>}
          </CardContent>
        </Card>
      </div>

      {/* Per-Job Table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Per-Job Breakdown</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/40">
              <th className="text-left px-4 py-3 font-medium">Job</th>
              <th className="text-left px-4 py-3 font-medium">Loss Type</th>
              <th className="text-left px-4 py-3 font-medium">Tech</th>
              <th className="text-left px-4 py-3 font-medium">Carrier</th>
              <th className="text-right px-4 py-3 font-medium">Invoiced</th>
              <th className="text-right px-4 py-3 font-medium">Costs</th>
              <th className="text-right px-4 py-3 font-medium">Margin</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
            </tr></thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No job data yet. Add job costs to see margin analysis.</td></tr>
              ) : jobs.map((j: any) => (
                <tr key={j.jobId} className="border-b hover:bg-muted/20" data-testid={`row-job-${j.jobId}`}>
                  <td className="px-4 py-3 font-medium">{j.jobNumber}</td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{j.lossType}</td>
                  <td className="px-4 py-3 text-muted-foreground">{j.assignedTech || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{j.insuranceCarrier || "—"}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(j.totalInvoiced)}</td>
                  <td className="px-4 py-3 text-right text-red-600">{formatCurrency(j.totalCosts)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-semibold ${marginColor(j.grossMargin ?? 0)}`}>{(j.grossMargin ?? 0).toFixed(1)}%</span>
                  </td>
                  <td className="px-4 py-3"><Badge variant="outline" className="capitalize">{j.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
