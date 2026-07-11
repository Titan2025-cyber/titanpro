import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { TrendingUp, Clock, DollarSign, BarChart2, Target, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter } from "recharts";

function median(arr: number[]) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export default function PredictiveModel() {
  const [selectedLossType, setSelectedLossType] = useState<string>("all");
  const [selectedCarrier, setSelectedCarrier] = useState<string>("all");

  const { data: jobs = [], isLoading: jobsLoading } = useQuery({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("/api/jobs").then(r => r.json()) });
  const { data: invoices = [] } = useQuery({ queryKey: ["/api/invoices"], queryFn: () => apiRequest("/api/invoices").then(r => r.json()) });
  const { data: costs = [] } = useQuery({ queryKey: ["/api/job-costs"], queryFn: () => apiRequest("/api/job-costs").then(r => r.json()) });
  const { data: payments = [] } = useQuery({ queryKey: ["/api/payments"], queryFn: () => apiRequest("/api/payments").then(r => r.json()) });

  const completedJobs = jobs.filter((j: any) => j.status === "complete" && j.job_complete && j.created_at);

  // Calculate job-level stats
  const jobStats = completedJobs.map((j: any) => {
    const jobInv = invoices.filter((i: any) => i.job_id === j.id);
    const jobCosts = costs.filter((c: any) => c.job_id === j.id);
    const jobPmts = payments.filter((p: any) => jobInv.some((i: any) => i.id === p.invoice_id) && p.type === "received");
    const totalInvoiced = jobInv.reduce((s: number, i: any) => s + (i.total || 0), 0);
    const totalCosts = jobCosts.reduce((s: number, c: any) => s + (c.total || 0), 0);
    const collected = jobPmts.reduce((s: number, p: any) => s + (p.amount || 0), 0);
    const durationDays = Math.max(1, Math.round((new Date(j.job_complete).getTime() - new Date(j.created_at).getTime()) / 86400000));
    const margin = totalInvoiced > 0 ? Math.round(((totalInvoiced - totalCosts) / totalInvoiced) * 100) : 0;
    return { ...j, totalInvoiced, totalCosts, collected, durationDays, margin };
  });

  const lossTypes = ["all", ...Array.from(new Set(completedJobs.map((j: any) => j.loss_type).filter(Boolean)))];
  const carriers = ["all", ...Array.from(new Set(completedJobs.map((j: any) => j.insurance_carrier).filter(Boolean)))];

  const filtered = jobStats.filter((j: any) =>
    (selectedLossType === "all" || j.loss_type === selectedLossType) &&
    (selectedCarrier === "all" || j.insurance_carrier === selectedCarrier)
  );

  // By loss type aggregation
  const byLossType: Record<string, any[]> = {};
  for (const j of jobStats) {
    if (!j.loss_type) continue;
    if (!byLossType[j.loss_type]) byLossType[j.loss_type] = [];
    byLossType[j.loss_type].push(j);
  }

  const lossTypeData = Object.entries(byLossType).map(([lt, jbs]) => ({
    name: lt,
    avgDuration: Math.round(jbs.reduce((s, j) => s + j.durationDays, 0) / jbs.length),
    avgRevenue: Math.round(jbs.reduce((s, j) => s + j.totalInvoiced, 0) / jbs.length),
    avgMargin: Math.round(jbs.reduce((s, j) => s + j.margin, 0) / jbs.length),
    count: jbs.length,
  }));

  // Prediction for selected filters
  const durations = filtered.map(j => j.durationDays).filter(d => d > 0);
  const revenues = filtered.map(j => j.totalInvoiced).filter(r => r > 0);
  const margins = filtered.map(j => j.margin);

  const predicted = {
    duration: durations.length ? Math.round(median(durations)) : null,
    durationRange: durations.length ? [Math.min(...durations), Math.max(...durations)] : null,
    revenue: revenues.length ? Math.round(median(revenues)) : null,
    revenueRange: revenues.length ? [Math.min(...revenues), Math.max(...revenues)] : null,
    margin: margins.length ? Math.round(median(margins)) : null,
    confidence: filtered.length >= 5 ? "High" : filtered.length >= 2 ? "Medium" : "Low",
    sampleSize: filtered.length,
  };

  // Scatter data (duration vs revenue)
  const scatterData = filtered.slice(0, 50).map(j => ({ x: j.durationDays, y: Math.round(j.totalInvoiced), name: j.job_number }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <TrendingUp className="h-6 w-6 text-blue-500" />
          Predictive Job Duration &amp; Cost Model
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          ML-style median regression on completed jobs — predicts duration and revenue by loss type and carrier
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Loss Type</label>
          <Select value={selectedLossType} onValueChange={setSelectedLossType}>
            <SelectTrigger className="w-40" data-testid="select-loss-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {lossTypes.map(lt => <SelectItem key={lt} value={lt}>{lt === "all" ? "All Types" : lt}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Insurance Carrier</label>
          <Select value={selectedCarrier} onValueChange={setSelectedCarrier}>
            <SelectTrigger className="w-48" data-testid="select-carrier"><SelectValue /></SelectTrigger>
            <SelectContent>
              {carriers.map(c => <SelectItem key={c} value={c}>{c === "all" ? "All Carriers" : c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Prediction Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Predicted Duration</span>
            </div>
            {predicted.duration !== null ? (
              <>
                <p className="text-2xl font-bold">{predicted.duration} days</p>
                <p className="text-xs text-muted-foreground mt-1">Range: {predicted.durationRange![0]}–{predicted.durationRange![1]} days</p>
              </>
            ) : <p className="text-muted-foreground text-sm">Insufficient data</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Predicted Revenue</span>
            </div>
            {predicted.revenue !== null ? (
              <>
                <p className="text-2xl font-bold">${predicted.revenue.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">Range: ${predicted.revenueRange![0].toLocaleString()}–${predicted.revenueRange![1].toLocaleString()}</p>
              </>
            ) : <p className="text-muted-foreground text-sm">Insufficient data</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-4 w-4 text-purple-500" />
              <span className="text-xs text-muted-foreground">Avg Margin</span>
            </div>
            {predicted.margin !== null ? (
              <p className="text-2xl font-bold">{predicted.margin}%</p>
            ) : <p className="text-muted-foreground text-sm">Insufficient data</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <BarChart2 className="h-4 w-4 text-orange-500" />
              <span className="text-xs text-muted-foreground">Model Confidence</span>
            </div>
            <p className="text-2xl font-bold">{predicted.confidence}</p>
            <p className="text-xs text-muted-foreground mt-1">Based on {predicted.sampleSize} jobs</p>
            {predicted.sampleSize < 5 && (
              <div className="flex items-center gap-1 mt-1">
                <AlertTriangle className="h-3 w-3 text-yellow-500" />
                <span className="text-xs text-yellow-600">Need 5+ jobs for high confidence</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Avg Duration by Loss Type (days)</CardTitle></CardHeader>
          <CardContent>
            {lossTypeData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No completed job data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={lossTypeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => [`${v} days`, "Avg Duration"]} />
                  <Bar dataKey="avgDuration" fill="hsl(215, 74%, 49%)" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Avg Revenue by Loss Type ($)</CardTitle></CardHeader>
          <CardContent>
            {lossTypeData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No completed job data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={lossTypeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: any) => [`$${v.toLocaleString()}`, "Avg Revenue"]} />
                  <Bar dataKey="avgRevenue" fill="hsl(0, 76%, 49%)" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Job-Level Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Completed Job Data — {selectedLossType === "all" ? "All Types" : selectedLossType} ({filtered.length} jobs)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No completed jobs match the selected filters</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left py-2 pr-4">Job</th>
                    <th className="text-left py-2 pr-4">Loss Type</th>
                    <th className="text-right py-2 pr-4">Duration</th>
                    <th className="text-right py-2 pr-4">Revenue</th>
                    <th className="text-right py-2 pr-4">Costs</th>
                    <th className="text-right py-2">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 20).map((j: any) => (
                    <tr key={j.id} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-job-${j.id}`}>
                      <td className="py-2 pr-4 font-medium">{j.job_number}</td>
                      <td className="py-2 pr-4"><Badge variant="outline" className="text-xs">{j.loss_type}</Badge></td>
                      <td className="py-2 pr-4 text-right">{j.durationDays}d</td>
                      <td className="py-2 pr-4 text-right">${j.totalInvoiced.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right">${j.totalCosts.toLocaleString()}</td>
                      <td className="py-2 text-right">
                        <span className={j.margin >= 30 ? "text-green-600 font-semibold" : j.margin >= 15 ? "text-blue-600" : "text-red-500"}>{j.margin}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
