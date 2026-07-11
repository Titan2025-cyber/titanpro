import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { TrendingUp, Target, ClipboardList, CheckCircle2, AlertCircle, CalendarRange } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────
interface Job {
  id: number;
  jobNumber: string;
  lossType: string;
  status: string;
  progressStage?: string | null;
  salesDate?: string | null;
  leadSource?: string | null;
  createdAt?: string | null;
}

// A job is "sold" (converted) if it has a sales date OR it has moved past the
// "pending_sale" progress stage.
function isSold(j: Job): boolean {
  const hasSalesDate = !!(j.salesDate && String(j.salesDate).trim());
  const stage = j.progressStage || "pending_sale";
  const advanced = stage !== "pending_sale";
  return hasSalesDate || advanced;
}

const LEAD_SOURCE_LABELS: Record<string, string> = {
  referral: "Referral",
  google: "Google",
  door_knock: "Door Knock",
  insurance_direct: "Insurance Direct",
  repeat: "Repeat",
  other: "Other",
};

function pct(sold: number, taken: number): number {
  return taken > 0 ? Math.round((sold / taken) * 1000) / 10 : 0;
}

function rateColor(rate: number): string {
  if (rate >= 60) return "text-green-600";
  if (rate >= 40) return "text-amber-600";
  return "text-red-600";
}

// Parse a job's "taken in" date for monthly bucketing (createdAt preferred).
function takenMonth(j: Job): string | null {
  const raw = j.createdAt || j.salesDate;
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
}

// A job's "taken in" date used for date-range filtering (createdAt preferred,
// falls back to salesDate). Returns a Date or null if unparseable.
function takenDate(j: Job): Date | null {
  const raw = j.createdAt || j.salesDate;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type Preset = "all" | "30d" | "90d" | "ytd" | "custom";

export default function ConversionRate() {
  const { data: jobs = [], isLoading } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  const [preset, setPreset] = useState<Preset>("all");
  const [start, setStart] = useState<string>("");
  const [end, setEnd] = useState<string>("");

  function applyPreset(p: Preset) {
    setPreset(p);
    const today = new Date();
    if (p === "all") { setStart(""); setEnd(""); }
    else if (p === "30d") {
      const s = new Date(today); s.setDate(s.getDate() - 30);
      setStart(toISODate(s)); setEnd(toISODate(today));
    } else if (p === "90d") {
      const s = new Date(today); s.setDate(s.getDate() - 90);
      setStart(toISODate(s)); setEnd(toISODate(today));
    } else if (p === "ytd") {
      setStart(`${today.getFullYear()}-01-01`); setEnd(toISODate(today));
    }
    // custom: leave whatever is in the inputs
  }

  // Filter jobs to the selected date range before any calculation.
  const filteredJobs = useMemo(() => {
    if (!start && !end) return jobs;
    const startMs = start ? new Date(start + "T00:00:00").getTime() : -Infinity;
    const endMs = end ? new Date(end + "T23:59:59").getTime() : Infinity;
    return jobs.filter(j => {
      const d = takenDate(j);
      if (!d) return false;
      const t = d.getTime();
      return t >= startMs && t <= endMs;
    });
  }, [jobs, start, end]);

  const rangeLabel = (!start && !end)
    ? "All time"
    : `${start || "earliest"} → ${end || "today"}`;

  const stats = useMemo(() => {
    const jobs = filteredJobs;
    const takenIn = jobs.length;
    const sold = jobs.filter(isSold).length;
    const overallRate = pct(sold, takenIn);

    // By lead source
    const bySourceMap = new Map<string, { taken: number; sold: number }>();
    for (const j of jobs) {
      const src = j.leadSource || "other";
      const row = bySourceMap.get(src) || { taken: 0, sold: 0 };
      row.taken += 1;
      if (isSold(j)) row.sold += 1;
      bySourceMap.set(src, row);
    }
    const bySource = Array.from(bySourceMap.entries())
      .map(([source, v]) => ({
        source,
        label: LEAD_SOURCE_LABELS[source] || source,
        ...v,
        rate: pct(v.sold, v.taken),
      }))
      .sort((a, b) => b.taken - a.taken);

    // By loss type
    const byTypeMap = new Map<string, { taken: number; sold: number }>();
    for (const j of jobs) {
      const t = (j.lossType || "other").toLowerCase();
      const row = byTypeMap.get(t) || { taken: 0, sold: 0 };
      row.taken += 1;
      if (isSold(j)) row.sold += 1;
      byTypeMap.set(t, row);
    }
    const byType = Array.from(byTypeMap.entries())
      .map(([type, v]) => ({ type, ...v, rate: pct(v.sold, v.taken) }))
      .sort((a, b) => b.taken - a.taken);

    // Monthly trend
    const byMonthMap = new Map<string, { taken: number; sold: number }>();
    for (const j of jobs) {
      const ym = takenMonth(j);
      if (!ym) continue;
      const row = byMonthMap.get(ym) || { taken: 0, sold: 0 };
      row.taken += 1;
      if (isSold(j)) row.sold += 1;
      byMonthMap.set(ym, row);
    }
    const trend = Array.from(byMonthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([ym, v]) => ({
        month: monthLabel(ym),
        "Taken In": v.taken,
        Sold: v.sold,
        Rate: pct(v.sold, v.taken),
      }));

    return { takenIn, sold, overallRate, bySource, byType, trend };
  }, [filteredJobs]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const PRESETS: { value: Preset; label: string }[] = [
    { value: "all", label: "All time" },
    { value: "30d", label: "Last 30 days" },
    { value: "90d", label: "Last 90 days" },
    { value: "ytd", label: "Year to date" },
    { value: "custom", label: "Custom" },
  ];

  return (
    <div className="space-y-6" data-testid="conversion-rate-page">
      {/* Date-range filter */}
      <Card data-testid="date-range-filter">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <CalendarRange className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
            <span className="text-sm font-medium mr-1">Date range</span>
            {PRESETS.map(p => (
              <Button
                key={p.value}
                type="button"
                size="sm"
                variant={preset === p.value ? "default" : "outline"}
                className={preset === p.value ? "bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue))]/90" : ""}
                data-testid={`preset-${p.value}`}
                onClick={() => applyPreset(p.value)}
              >
                {p.label}
              </Button>
            ))}
            <Badge variant="secondary" className="ml-auto" data-testid="badge-range">{rangeLabel}</Badge>
          </div>
          {preset === "custom" && (
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Start</label>
                <Input type="date" value={start} max={end || undefined} className="w-44"
                  data-testid="input-start" onChange={e => setStart(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">End</label>
                <Input type="date" value={end} min={start || undefined} className="w-44"
                  data-testid="input-end" onChange={e => setEnd(e.target.value)} />
              </div>
              {(start || end) && (
                <Button type="button" size="sm" variant="ghost" data-testid="button-clear-range"
                  onClick={() => { setStart(""); setEnd(""); }}>Clear</Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card data-testid="kpi-taken-in">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2"><ClipboardList className="w-5 h-5 text-blue-700" /></div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Jobs Taken In</p>
              <p className="text-2xl font-bold" data-testid="text-taken-in">{stats.takenIn}</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-sold">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-green-100 p-2"><CheckCircle2 className="w-5 h-5 text-green-700" /></div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Jobs Sold</p>
              <p className="text-2xl font-bold" data-testid="text-sold">{stats.sold}</p>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-rate">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-lg bg-[hsl(var(--titan-blue))]/10 p-2"><Target className="w-5 h-5 text-[hsl(var(--titan-blue))]" /></div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Conversion Rate</p>
              <p className={`text-2xl font-bold ${rateColor(stats.overallRate)}`} data-testid="text-rate">{stats.overallRate}%</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <AlertCircle className="w-3 h-3" /> A job counts as “sold” when it has a sales date or has advanced past the Pending Sale stage.
      </p>

      {/* Monthly trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[hsl(var(--titan-blue))]" /> Monthly Trend — Taken In vs Sold
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats.trend.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No dated jobs to chart yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={stats.trend} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="month" fontSize={12} />
                <YAxis yAxisId="left" fontSize={12} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" fontSize={12} unit="%" domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="Taken In" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="left" dataKey="Sold" fill="#1E5AB4" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="Rate" name="Conversion %" stroke="#CC0000" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Breakdown tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By Lead Source</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Taken In</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.bySource.map(r => (
                  <TableRow key={r.source} data-testid={`row-source-${r.source}`}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-right">{r.taken}</TableCell>
                    <TableCell className="text-right">{r.sold}</TableCell>
                    <TableCell className={`text-right font-semibold ${rateColor(r.rate)}`}>{r.rate}%</TableCell>
                  </TableRow>
                ))}
                {stats.bySource.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No jobs yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By Loss Type</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loss Type</TableHead>
                  <TableHead className="text-right">Taken In</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.byType.map(r => (
                  <TableRow key={r.type} data-testid={`row-type-${r.type}`}>
                    <TableCell className="font-medium capitalize">{r.type}</TableCell>
                    <TableCell className="text-right">{r.taken}</TableCell>
                    <TableCell className="text-right">{r.sold}</TableCell>
                    <TableCell className={`text-right font-semibold ${rateColor(r.rate)}`}>{r.rate}%</TableCell>
                  </TableRow>
                ))}
                {stats.byType.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No jobs yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
