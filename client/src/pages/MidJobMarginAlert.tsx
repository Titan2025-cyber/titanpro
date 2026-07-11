import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrendingDown, AlertTriangle, CheckCircle2, DollarSign, Target, Bell } from "lucide-react";

export default function MidJobMarginAlert() {
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("GET", "/api/jobs").then(r => r.json()) });
  const { data: invoices = [] } = useQuery<any[]>({ queryKey: ["/api/invoices"], queryFn: () => apiRequest("GET", "/api/invoices").then(r => r.json()) });
  const { data: costs = [] } = useQuery<any[]>({ queryKey: ["/api/job-costs"], queryFn: () => apiRequest("GET", "/api/job-costs").then(r => r.json()) });
  const [marginThreshold, setMarginThreshold] = useState("35");

  const activeJobs = (jobs as any[]).filter(j => !["complete","closed"].includes(j.status));

  const jobsWithMargin = activeJobs.map((j: any) => {
    const inv = (invoices as any[]).filter(i => i.jobId === j.id);
    const revenue = inv.reduce((s: number, i: any) => s + Number(i.total || 0), 0);
    const jobCosts = (costs as any[]).filter(c => c.jobId === j.id).reduce((s: number, c: any) => s + Number(c.total || 0), 0);
    const margin = revenue > 0 ? Math.round(((revenue - jobCosts) / revenue) * 100) : null;
    const threshold = parseInt(marginThreshold) || 35;
    return { job: j, revenue, jobCosts, margin, belowThreshold: margin !== null && margin < threshold, threshold };
  });

  const alerts = jobsWithMargin.filter(j => j.belowThreshold);
  const healthy = jobsWithMargin.filter(j => !j.belowThreshold && j.margin !== null);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-red))] flex items-center justify-center">
          <TrendingDown className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Mid-Job Margin Alert</h1>
          <p className="text-sm text-muted-foreground">Real-time margin tracking with auto-alert before jobs close under threshold</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Target className="w-4 h-4" />Alert Threshold</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-3">
          <span className="text-sm">Alert when gross margin drops below</span>
          <Input value={marginThreshold} onChange={e => setMarginThreshold(e.target.value)} className="w-20 text-center" />
          <span className="text-sm">%</span>
        </CardContent>
      </Card>

      {alerts.length > 0 && (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950/20">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-red-600"><AlertTriangle className="w-4 h-4" />{alerts.length} Job(s) Below Margin Threshold</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {alerts.map((a, i) => (
              <div key={i} className="bg-white dark:bg-background rounded-lg p-3 border border-red-200 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="font-medium text-sm">TP-{String(a.job.id).padStart(4,"0")} — {a.job.address?.split(",")[0]}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs border-red-300 text-red-600">
                      {a.margin !== null ? `${a.margin}% margin` : "No revenue yet"}
                    </Badge>
                    <Badge variant="outline" className="text-xs capitalize">{a.job.status}</Badge>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-center">
                  <div className="p-1.5 rounded bg-muted/30"><p className="font-semibold">${a.revenue.toLocaleString()}</p><p className="text-muted-foreground">Revenue</p></div>
                  <div className="p-1.5 rounded bg-muted/30"><p className="font-semibold">${a.jobCosts.toLocaleString()}</p><p className="text-muted-foreground">Costs</p></div>
                  <div className="p-1.5 rounded bg-red-100 dark:bg-red-950/30"><p className="font-semibold text-red-600">${(a.revenue - a.jobCosts).toLocaleString()}</p><p className="text-muted-foreground">Gross Profit</p></div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="text-xs h-7 border-red-300 text-red-600">File Supplement</Button>
                  <Button size="sm" variant="outline" className="text-xs h-7">Schedule Adj Call</Button>
                  <Button size="sm" variant="outline" className="text-xs h-7"><Bell className="w-3 h-3 mr-1" />Alert Owner</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-500" />Healthy Jobs</h2>
        {healthy.map((j, i) => (
          <div key={i} className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
            <span className="text-sm font-medium">TP-{String(j.job.id).padStart(4,"0")} — {j.job.address?.split(",")[0]}</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs border-green-300 text-green-600">{j.margin}% margin</Badge>
              <Badge variant="outline" className="text-xs capitalize">{j.job.status}</Badge>
            </div>
          </div>
        ))}
        {healthy.length === 0 && alerts.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">No active jobs with margin data yet.</p>
        )}
      </div>
    </div>
  );
}
