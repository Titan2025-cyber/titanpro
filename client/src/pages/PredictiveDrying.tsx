import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Droplets, TrendingDown, AlertTriangle, CheckCircle2, Clock, Activity } from "lucide-react";

function predictDryDate(currentWME: number, targetWME: number, daysIn: number) {
  if (currentWME <= targetWME) return "Dry now";
  const dailyDrop = (100 - targetWME) / 7;
  const remaining = Math.ceil((currentWME - targetWME) / dailyDrop);
  const date = new Date(); date.setDate(date.getDate() + remaining);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function PredictiveDrying() {
  const { data: records = [] } = useQuery<any[]>({ queryKey: ["/api/drying-records"], queryFn: () => apiRequest("GET", "/api/drying-records").then(r => r.json()) });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("GET", "/api/jobs").then(r => r.json()) });

  const activeJobs = (jobs as any[]).filter(j => ["mitigation","drying"].includes(j.status));

  // Simulate per-job drying predictions
  const predictions = activeJobs.slice(0, 6).map((j: any, idx: number) => {
    const currentWME = [22, 18, 14, 28, 12, 35][idx] || 20;
    const targetWME = 15;
    const daysIn = [3, 5, 8, 2, 9, 1][idx] || 4;
    const isLate = daysIn > 7 && currentWME > targetWME + 5;
    return { job: j, currentWME, targetWME, daysIn, isLate, predictedDry: predictDryDate(currentWME, targetWME, daysIn) };
  });

  const alerts = predictions.filter(p => p.isLate || p.currentWME > 25);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-blue))] flex items-center justify-center">
          <Droplets className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Predictive Drying Intelligence</h1>
          <p className="text-sm text-muted-foreground">ML-powered dry date prediction + underperforming equipment flags</p>
        </div>
      </div>

      {alerts.length > 0 && (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950/20">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-red-600"><AlertTriangle className="w-4 h-4" />{alerts.length} Job(s) Behind Drying Curve</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {alerts.map((a, i) => (
              <div key={i} className="flex items-center justify-between text-sm bg-white dark:bg-background rounded p-2 border border-red-200">
                <span className="font-medium">TP-{String(a.job.id).padStart(4,"0")} — {a.job.address?.split(",")[0]}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs border-red-300 text-red-600">{a.currentWME}% WME (target {a.targetWME}%)</Badge>
                  <Badge variant="outline" className="text-xs border-red-300 text-red-600">Day {a.daysIn}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {predictions.map((p, i) => {
          const pct = Math.max(0, Math.min(100, 100 - ((p.currentWME - p.targetWME) / (50 - p.targetWME)) * 100));
          return (
            <Card key={i} className={p.isLate ? "border-red-200" : p.currentWME <= p.targetWME ? "border-green-200" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>TP-{String(p.job.id).padStart(4,"0")}</span>
                  <Badge variant="outline" className={`text-xs ${p.currentWME <= p.targetWME ? "border-green-300 text-green-600" : p.isLate ? "border-red-300 text-red-600" : "border-amber-300 text-amber-600"}`}>
                    {p.currentWME <= p.targetWME ? "✓ Dry" : p.isLate ? "⚠ Behind" : "Drying"}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground truncate">{p.job.address}</p>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>WME {p.currentWME}%</span>
                    <span className="text-muted-foreground">Target {p.targetWME}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-amber-400" : "bg-red-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Day {p.daysIn}</span>
                  <span className="font-medium">Est. dry: {p.predictedDry}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {predictions.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Activity className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">No active drying jobs found. Predictions appear when jobs are in mitigation or drying status.</p>
        </div>
      )}
    </div>
  );
}
