import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, DollarSign, Clock, AlertTriangle, CheckCircle, BarChart3 } from "lucide-react";

function MarginBadge({ margin }: { margin: number }) {
  if (margin >= 40) return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Healthy {margin.toFixed(0)}%</Badge>;
  if (margin >= 20) return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">Watch {margin.toFixed(0)}%</Badge>;
  return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Thin {margin.toFixed(0)}%</Badge>;
}

export default function JobCostLive() {
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("/api/jobs").then(r => r.json()) });
  const { data: invoices = [] } = useQuery<any[]>({ queryKey: ["/api/invoices"], queryFn: () => apiRequest("/api/invoices").then(r => r.json()) });
  const { data: jobCosts = [] } = useQuery<any[]>({ queryKey: ["/api/job-costs"], queryFn: () => apiRequest("/api/job-costs").then(r => r.json()) });
  const { data: laborData = [] } = useQuery<any[]>({ queryKey: ["/api/reports/labor-by-job"], queryFn: () => apiRequest("/api/reports/labor-by-job").then(r => r.json()) });
  const { data: payouts = [] } = useQuery<any[]>({ queryKey: ["/api/payout-requests"], queryFn: () => apiRequest("/api/payout-requests").then(r => r.json()) });

  // Build per-job cost snapshot
  const jobRows = jobs.map((job: any) => {
    const jobInvoices = invoices.filter((i: any) => i.jobId === job.id);
    const revenue = jobInvoices.reduce((s: number, i: any) => s + (i.totalAmount || 0), 0);

    const costs = jobCosts.filter((c: any) => c.jobId === job.id);
    const directCosts = costs.reduce((s: number, c: any) => s + (c.amount || 0), 0);

    const laborRow = laborData.find((l: any) => l.job_id === job.id);
    const laborMinutes = laborRow?.total_minutes || 0;
    const laborCost = (laborMinutes / 60) * 35; // $35/hr blended rate

    const jobPayouts = payouts.filter((p: any) => p.jobId === job.id);
    const payoutCost = jobPayouts.reduce((s: number, p: any) => s + (p.amount || 0), 0);

    const totalCost = directCosts + laborCost + payoutCost;
    const grossProfit = revenue - totalCost;
    const margin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    return { job, revenue, directCosts, laborCost, payoutCost, totalCost, grossProfit, margin, laborMinutes };
  }).sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = jobRows.reduce((s, r) => s + r.revenue, 0);
  const totalCosts = jobRows.reduce((s, r) => s + r.totalCost, 0);
  const totalGP = totalRevenue - totalCosts;
  const overallMargin = totalRevenue > 0 ? (totalGP / totalRevenue) * 100 : 0;
  const thinJobs = jobRows.filter(r => r.revenue > 0 && r.margin < 20).length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-primary" /> Real-Time Job Cost Tracker
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Live margin per job — revenue vs. labor, direct costs, and subcontractor payouts</p>
      </div>

      {/* Portfolio KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Revenue", value: `$${totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 0 })}`, icon: DollarSign, color: "text-primary" },
          { label: "Total Costs", value: `$${totalCosts.toLocaleString("en-US", { minimumFractionDigits: 0 })}`, icon: BarChart3, color: "text-blue-500" },
          { label: "Gross Profit", value: `$${totalGP.toLocaleString("en-US", { minimumFractionDigits: 0 })}`, icon: CheckCircle, color: totalGP >= 0 ? "text-green-500" : "text-red-500" },
          { label: "Thin Margin Jobs", value: thinJobs, icon: AlertTriangle, color: thinJobs > 0 ? "text-red-500" : "text-green-500" },
        ].map(kpi => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <kpi.icon className={`w-8 h-8 ${kpi.color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-lg font-bold" data-testid={`kpi-${kpi.label.toLowerCase().replace(/ /g, "-")}`}>{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Overall Margin Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Portfolio Gross Margin</span>
            <span className="text-sm font-bold">{overallMargin.toFixed(1)}%</span>
          </div>
          <Progress value={Math.max(0, Math.min(100, overallMargin))} className="h-3" />
          <p className="text-xs text-muted-foreground mt-1">Target: ≥40% gross margin per job. Below 20% = margin alert.</p>
        </CardContent>
      </Card>

      {/* Per-Job Rows */}
      {jobRows.length === 0 ? (
        <Card><CardContent className="py-16 text-center">
          <TrendingUp className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-30" />
          <p className="text-muted-foreground">No jobs found. Job cost data will populate as jobs, invoices, and costs are recorded.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {jobRows.map(({ job, revenue, directCosts, laborCost, payoutCost, totalCost, grossProfit, margin, laborMinutes }) => (
            <Card key={job.id} data-testid={`job-cost-row-${job.id}`} className={margin < 20 && revenue > 0 ? "border-red-200 dark:border-red-800" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-sm">TP-{String(job.id).padStart(4, "0")}</span>
                      <span className="text-sm text-muted-foreground">{job.address?.substring(0, 30)}</span>
                      <Badge variant="outline">{job.lossType || "N/A"}</Badge>
                      {revenue > 0 && <MarginBadge margin={margin} />}
                    </div>

                    {/* Cost breakdown bars */}
                    <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground mb-1">Direct Costs</p>
                        <p className="font-semibold">${directCosts.toLocaleString("en-US", { minimumFractionDigits: 0 })}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-1">Labor ({Math.round(laborMinutes / 60)}h @ $35)</p>
                        <p className="font-semibold">${laborCost.toLocaleString("en-US", { minimumFractionDigits: 0 })}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-1">Payouts</p>
                        <p className="font-semibold">${payoutCost.toLocaleString("en-US", { minimumFractionDigits: 0 })}</p>
                      </div>
                    </div>

                    {revenue > 0 && (
                      <div className="mt-2">
                        <Progress value={Math.max(0, Math.min(100, (totalCost / revenue) * 100))} className="h-1.5" />
                        <p className="text-xs text-muted-foreground mt-0.5">Cost ratio: {revenue > 0 ? ((totalCost / revenue) * 100).toFixed(0) : 0}%</p>
                      </div>
                    )}
                  </div>

                  <div className="text-right shrink-0 space-y-1">
                    <p className="text-sm text-muted-foreground">Revenue</p>
                    <p className="text-lg font-bold">${revenue.toLocaleString("en-US", { minimumFractionDigits: 0 })}</p>
                    <p className="text-xs text-muted-foreground">Total Cost: ${totalCost.toLocaleString("en-US", { minimumFractionDigits: 0 })}</p>
                    <p className={`text-sm font-bold ${grossProfit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                      GP: ${grossProfit.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
