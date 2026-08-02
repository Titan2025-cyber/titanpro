import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Droplets, AlertTriangle, Clock, Activity } from "lucide-react";

// Parse the moistureReadings JSON string safely.
function parseReadings(raw: any): Array<{ location?: string; material?: string; reading?: number; target?: number }> {
  if (!raw) return [];
  try {
    const j = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

// Aggregate a set of drying records for one job into a live prediction.
// - currentWME: mean of highest-reading rooms across the most recent record
// - trend: change vs. two records ago (indicates rate)
// - daysIn: date span between earliest and latest record
// - projected dry date: linear extrapolation from trend
function analyzeJob(records: any[]): {
  currentWME: number | null;
  targetWME: number;
  daysIn: number;
  isStalled: boolean;
  predictedDry: string;
  latestDate: string | null;
  roomsAtOrAbove: number;
} {
  if (records.length === 0) return { currentWME: null, targetWME: 15, daysIn: 0, isStalled: false, predictedDry: "\u2014", latestDate: null, roomsAtOrAbove: 0 };
  const sorted = [...records].sort((a, b) =>
    (a.readingDate + (a.readingTime || "")).localeCompare(b.readingDate + (b.readingTime || ""))
  );
  const latest = sorted[sorted.length - 1];
  const earliest = sorted[0];
  const latestReadings = parseReadings(latest.moistureReadings);
  // Skip records with no room-level readings
  if (latestReadings.length === 0) return { currentWME: null, targetWME: 15, daysIn: 0, isStalled: false, predictedDry: "\u2014", latestDate: latest.readingDate, roomsAtOrAbove: 0 };
  const currentWME = latestReadings.reduce((s, r) => s + Number(r.reading || 0), 0) / latestReadings.length;
  const targetWME = latestReadings[0]?.target || 15;
  const roomsAtOrAbove = latestReadings.filter(r => Number(r.reading || 0) > targetWME).length;

  const dLatest = new Date(latest.readingDate);
  const dEarliest = new Date(earliest.readingDate);
  const daysIn = Math.max(1, Math.floor((dLatest.getTime() - dEarliest.getTime()) / (86400 * 1000)) + 1);

  // Trend: compare mean of latest to mean 2 records back (if available).
  let trendPerDay = 0;
  if (sorted.length >= 2) {
    const prev = sorted[Math.max(0, sorted.length - 2)];
    const prevReadings = parseReadings(prev.moistureReadings);
    if (prevReadings.length > 0) {
      const prevMean = prevReadings.reduce((s, r) => s + Number(r.reading || 0), 0) / prevReadings.length;
      const prevDate = new Date(prev.readingDate);
      const dayGap = Math.max(1, Math.floor((dLatest.getTime() - prevDate.getTime()) / (86400 * 1000)));
      trendPerDay = (prevMean - currentWME) / dayGap;
    }
  }
  // Stalled: 4+ days in AND rooms still wet AND trend < 0.5%/day
  const isStalled = daysIn >= 4 && roomsAtOrAbove > 0 && trendPerDay < 0.5;
  // Predict dry date: linear if trend > 0, else "no drying trend"
  let predictedDry = "no drying trend";
  if (currentWME <= targetWME) predictedDry = "Dry now";
  else if (trendPerDay > 0.1) {
    const daysToDry = Math.ceil((currentWME - targetWME) / trendPerDay);
    const dry = new Date();
    dry.setDate(dry.getDate() + daysToDry);
    predictedDry = dry.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  return {
    currentWME: Number(currentWME.toFixed(1)),
    targetWME,
    daysIn,
    isStalled,
    predictedDry,
    latestDate: latest.readingDate,
    roomsAtOrAbove,
  };
}

export default function PredictiveDrying() {
  const { data: records = [] } = useQuery<any[]>({
    queryKey: ["/api/drying-records"],
    queryFn: () => apiRequest("GET", "/api/drying-records").then(r => r.json())
  });
  const { data: jobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("GET", "/api/jobs").then(r => r.json())
  });

  const activeJobs = (jobs as any[]).filter(j => ["mitigation", "drying"].includes(j.status));

  // Group records by job
  const byJob = new Map<number, any[]>();
  for (const r of records as any[]) {
    const arr = byJob.get(Number(r.jobId)) || [];
    arr.push(r);
    byJob.set(Number(r.jobId), arr);
  }

  const predictions = activeJobs.map((j: any) => {
    const jobRecords = byJob.get(Number(j.id)) || [];
    const a = analyzeJob(jobRecords);
    return { job: j, ...a, hasReadings: jobRecords.length > 0 };
  });

  const alerts = predictions.filter(p => p.isStalled);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-blue))] flex items-center justify-center">
          <Droplets className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Predictive Drying Intelligence</h1>
          <p className="text-sm text-muted-foreground">Real-time dry-date projections from your logged psychrometric readings</p>
        </div>
      </div>

      {alerts.length > 0 && (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-4 h-4" />{alerts.length} Job(s) Stalled \u2014 no drying trend
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.map((a, i) => (
              <div key={i} className="flex items-center justify-between text-sm bg-white dark:bg-background rounded p-2 border border-red-200">
                <span className="font-medium">{a.job.jobNumber || `TP-${String(a.job.id).padStart(4, "0")}`} \u2014 {a.job.address?.split(",")[0]}</span>
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
          if (!p.hasReadings || p.currentWME == null) {
            return (
              <Card key={i} className="border-dashed">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    {p.job.jobNumber || `TP-${String(p.job.id).padStart(4, "0")}`}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground space-y-2">
                  <p className="truncate">{p.job.address}</p>
                  <p>No drying readings logged yet.</p>
                </CardContent>
              </Card>
            );
          }
          const pct = Math.max(0, Math.min(100, 100 - ((p.currentWME - p.targetWME) / (50 - p.targetWME)) * 100));
          return (
            <Card key={i} className={p.isStalled ? "border-red-200" : p.currentWME <= p.targetWME ? "border-green-200" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>{p.job.jobNumber || `TP-${String(p.job.id).padStart(4, "0")}`}</span>
                  <Badge variant="outline" className={`text-xs ${p.currentWME <= p.targetWME ? "border-green-300 text-green-600" : p.isStalled ? "border-red-300 text-red-600" : "border-amber-300 text-amber-600"}`}>
                    {p.currentWME <= p.targetWME ? "\u2713 Dry" : p.isStalled ? "\u26A0 Stalled" : "Drying"}
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
                <div className="text-[10px] text-muted-foreground">{p.roomsAtOrAbove} room{p.roomsAtOrAbove === 1 ? "" : "s"} still wet \u2022 last logged {p.latestDate}</div>
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
