import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Lock, FileText, HandshakeIcon, DollarSign, TrendingUp, TrendingDown, Wallet, X, Download, Printer } from "lucide-react";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
}

// Short human label for a week-start (Monday) ISO date: "Jun 30 – Jul 6"
function weekLabel(weekStart: string): string {
  const start = new Date(weekStart + "T00:00:00");
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const opt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString("en-US", opt)} – ${end.toLocaleDateString("en-US", opt)}`;
}

// Human label for a month-start (YYYY-MM-01) date: "July 2026"
function monthLabel(monthStart: string): string {
  const d = new Date(monthStart + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Compact axis label for a period start (chart X-axis).
function axisLabel(periodStart: string, groupBy: "week" | "month"): string {
  const d = new Date(periodStart + "T00:00:00");
  if (groupBy === "month") return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface DivisionSlice {
  collected: number;
  cost: number;
  net: number;
}

interface PeriodRow {
  periodStart: string;
  billed: number;
  settled: number;
  collected: number;
  creditMemos: number;
  cost: number;
  byDivision?: {
    mitigation: DivisionSlice;
    reconstruction: DivisionSlice;
    unassigned: DivisionSlice;
  };
}

interface DivisionRow {
  division: string;
  collected: number;
  cost: number;
  net: number;
  marginPct: number;
  profitable: boolean;
}

interface ReportResponse {
  groupBy: "week" | "month";
  from: string | null;
  to: string | null;
  division: DivisionFilter;
  periods: PeriodRow[];
  totals: { billed: number; settled: number; collected: number; creditMemos: number; cost: number };
  divisions: DivisionRow[];
}

type DivisionFilter = "all" | "mitigation" | "reconstruction";

// Local YYYY-MM-DD (no UTC shift).
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Quick date-range presets for filtering. Each returns { from, to } as YYYY-MM-DD ("" = open bound).
type PresetKey = "mtd" | "30d" | "90d" | "ytd" | "lastMonth";
function presetRange(key: PresetKey): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case "mtd":
      return { from: ymd(new Date(y, m, 1)), to: ymd(now) };
    case "lastMonth":
      return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case "30d": {
      const s = new Date(now); s.setDate(now.getDate() - 29);
      return { from: ymd(s), to: ymd(now) };
    }
    case "90d": {
      const s = new Date(now); s.setDate(now.getDate() - 89);
      return { from: ymd(s), to: ymd(now) };
    }
    case "ytd":
      return { from: ymd(new Date(y, 0, 1)), to: ymd(now) };
  }
}
const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "mtd", label: "This month" },
  { key: "lastMonth", label: "Last month" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "ytd", label: "Year to date" },
];

const DIVISION_META: Record<string, { label: string; color: string; bg: string }> = {
  mitigation: { label: "Mitigation", color: "#1E5AB4", bg: "rgba(30,90,180,0.08)" },
  reconstruction: { label: "Reconstruction", color: "#CC0000", bg: "rgba(204,0,0,0.07)" },
  unassigned: { label: "Unassigned", color: "#6b7280", bg: "rgba(107,114,128,0.08)" },
};

export default function WeeklyBilling() {
  const { user } = useAuth();
  const [groupBy, setGroupBy] = useState<"week" | "month">("week");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [division, setDivision] = useState<DivisionFilter>("all");

  const { data, isLoading, error } = useQuery<ReportResponse>({
    queryKey: ["/api/reports/weekly-billing", groupBy, from, to, division],
    queryFn: async () => {
      const params = new URLSearchParams({ groupBy });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (division !== "all") params.set("division", division);
      const r = await apiRequest("GET", `/api/reports/weekly-billing?${params.toString()}`);
      return r.json();
    },
  });

  const hasFilter = from !== "" || to !== "";
  const clearFilter = () => { setFrom(""); setTo(""); };
  const applyPreset = (key: PresetKey) => { const r = presetRange(key); setFrom(r.from); setTo(r.to); };
  // Which preset (if any) matches the current from/to, so its chip can render active.
  const activePreset = useMemo<PresetKey | null>(() => {
    if (!from && !to) return null;
    for (const p of PRESETS) { const r = presetRange(p.key); if (r.from === from && r.to === to) return p.key; }
    return null;
  }, [from, to]);

  const periods = useMemo(() => data?.periods || [], [data]);
  const totals = data?.totals || { billed: 0, settled: 0, collected: 0, creditMemos: 0, cost: 0 };
  const net = (totals.collected || 0) - (totals.cost || 0);
  const divisions = useMemo(() => data?.divisions || [], [data]);
  const [exporting, setExporting] = useState(false);

  // Chart data — chronological (oldest → newest); when no date filter, show the most recent 12 periods.
  // When division = "all", also emit per-division net-profit trend lines (Mitigation Net, Reconstruction Net).
  const chartData = useMemo(() => {
    const asc = [...periods].sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1));
    const trimmed = hasFilter ? asc : asc.slice(-12);
    let running = 0;
    return trimmed.map((p) => {
      running += (p.collected || 0) - (p.cost || 0);
      const row: Record<string, number | string> = {
        label: axisLabel(p.periodStart, groupBy),
        "Brought In": Math.round(p.collected),
        Cost: Math.round(p.cost),
        "Cumulative Profit": Math.round(running),
      };
      if (division === "all" && p.byDivision) {
        row["Mitigation Net"] = Math.round(p.byDivision.mitigation.net);
        row["Reconstruction Net"] = Math.round(p.byDivision.reconstruction.net);
      }
      return row;
    });
  }, [periods, groupBy, hasFilter, division]);

  const showDivisionTrend = division === "all";
  const divisionLabel = division === "all" ? "All divisions" : (DIVISION_META[division]?.label ?? division);

  const collectionRate = totals.billed > 0 ? Math.round((totals.collected / totals.billed) * 100) : 0;
  const periodNoun = groupBy === "month" ? "month" : "week";
  const periodNounCap = groupBy === "month" ? "Monthly" : "Weekly";
  const labelFor = (p: PeriodRow) => (groupBy === "month" ? monthLabel(p.periodStart) : weekLabel(p.periodStart));

  // Export the current view (respecting filters) to a branded PDF. jsPDF is heavy
  // (~600KB) so the generator + download helper are lazy-loaded on click.
  const handleExportPDF = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const [{ generateDivisionReportPDF }, { downloadPDF }] = await Promise.all([
        import("@/lib/divisionReportPdf"),
        import("@/lib/pdfEngine"),
      ]);
      const rangeLabel = hasFilter ? `${from || "start"} \u2192 ${to || "today"}` : "All time";
      const dataUri = generateDivisionReportPDF({
        generatedAt: new Date().toISOString(),
        groupBy,
        divisionFilter: divisionLabel,
        rangeLabel,
        totals: {
          billed: totals.billed,
          settled: totals.settled,
          collected: totals.collected,
          cost: totals.cost,
          net,
        },
        collectionRate,
        divisions: divisions.map((d) => ({
          division: d.division,
          label: DIVISION_META[d.division]?.label ?? d.division,
          collected: d.collected,
          cost: d.cost,
          net: d.net,
          marginPct: d.marginPct,
          profitable: d.profitable,
        })),
        periods: periods.map((p) => ({
          label: labelFor(p),
          billed: p.billed,
          settled: p.settled,
          collected: p.collected,
          cost: p.cost,
          creditMemos: p.creditMemos,
        })),
      });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadPDF(dataUri, `Titan_Division_Profitability_${stamp}.pdf`);
    } catch (err) {
      console.error("Failed to export division report PDF", err);
    } finally {
      setExporting(false);
    }
  };

  // Client-side guard — this module is owner-only. The server also enforces it.
  if (user && user.role !== "owner") {
    return (
      <div className="p-6">
        <Card className="max-w-md mx-auto mt-12 border-l-4 border-l-red-600">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <Lock className="w-5 h-5" /> Owner Access Only
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              The Weekly Billing report is restricted to the business owner. If you need this data,
              contact Cody.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Card className="max-w-md mx-auto mt-12 border-l-4 border-l-red-600">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <Lock className="w-5 h-5" /> Access Restricted
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This report could not be loaded. It is available to the business owner only.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="page-weekly-billing">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-[hsl(var(--titan-blue))]" />
            Weekly Billing
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            What you billed out vs. what you settled for, and total collected — {periodNoun} by {periodNoun}.
          </p>
        </div>
        <Badge className="bg-red-100 text-red-800 border border-red-200 flex items-center gap-1">
          <Lock className="w-3 h-3" /> Owner Only
        </Badge>
      </div>

      {/* Controls: group-by toggle + date range filter */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-wrap items-end gap-5">
            {/* Group-by toggle */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">View</Label>
              <div className="inline-flex rounded-md border overflow-hidden" data-testid="toggle-groupby">
                <button
                  type="button"
                  onClick={() => setGroupBy("week")}
                  className={`px-4 py-1.5 text-sm font-medium transition-colors ${groupBy === "week" ? "bg-[hsl(var(--titan-blue))] text-white" : "bg-transparent hover:bg-muted"}`}
                  data-testid="btn-view-week"
                >
                  Weekly
                </button>
                <button
                  type="button"
                  onClick={() => setGroupBy("month")}
                  className={`px-4 py-1.5 text-sm font-medium transition-colors border-l ${groupBy === "month" ? "bg-[hsl(var(--titan-blue))] text-white" : "bg-transparent hover:bg-muted"}`}
                  data-testid="btn-view-month"
                >
                  Monthly
                </button>
              </div>
            </div>

            {/* Division filter */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Division</Label>
              <div className="inline-flex rounded-md border overflow-hidden" data-testid="toggle-division">
                {(["all", "mitigation", "reconstruction"] as DivisionFilter[]).map((d, i) => {
                  const active = division === d;
                  const activeColor = d === "mitigation" ? "#1E5AB4" : d === "reconstruction" ? "#CC0000" : "hsl(var(--titan-blue))";
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDivision(d)}
                      className={`px-4 py-1.5 text-sm font-medium transition-colors ${i > 0 ? "border-l" : ""} ${active ? "text-white" : "bg-transparent hover:bg-muted"}`}
                      style={active ? { backgroundColor: activeColor } : undefined}
                      data-testid={`btn-division-${d}`}
                    >
                      {d === "all" ? "All" : d === "mitigation" ? "Mitigation" : "Reconstruction"}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date range */}
            <div className="space-y-1.5">
              <Label htmlFor="wb-from" className="text-xs text-muted-foreground">From</Label>
              <Input
                id="wb-from"
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="w-[10.5rem]"
                data-testid="input-from"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wb-to" className="text-xs text-muted-foreground">To</Label>
              <Input
                id="wb-to"
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="w-[10.5rem]"
                data-testid="input-to"
              />
            </div>

            {hasFilter && (
              <Button variant="ghost" size="sm" onClick={clearFilter} className="text-muted-foreground" data-testid="btn-clear-filter">
                <X className="w-4 h-4 mr-1" /> Clear
              </Button>
            )}

            <div className="ml-auto text-xs text-muted-foreground self-end" data-testid="filter-status">
              {divisionLabel}
              {" · "}
              {hasFilter
                ? `Filtered${from ? ` from ${from}` : ""}${to ? ` to ${to}` : ""}`
                : `all ${periodNoun}s`}
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 bg-muted rounded animate-pulse" />)}
          </div>
          <div className="h-72 bg-muted rounded animate-pulse" />
        </div>
      ) : (
        <>
          {/* KPI cards — totals for the current view/filter */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card data-testid="kpi-billed">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <FileText className="w-4 h-4" /> Total Billed
                </div>
                <div className="text-2xl font-bold">{division === "all" ? fmt(totals.billed) : "—"}</div>
                {division !== "all" && <div className="text-[11px] text-muted-foreground mt-0.5">not tracked by division</div>}
              </CardContent>
            </Card>
            <Card data-testid="kpi-settled">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <HandshakeIcon className="w-4 h-4" /> Total Settled
                </div>
                <div className="text-2xl font-bold text-[hsl(var(--titan-blue))]">{division === "all" ? fmt(totals.settled) : "—"}</div>
                {division !== "all" && <div className="text-[11px] text-muted-foreground mt-0.5">not tracked by division</div>}
              </CardContent>
            </Card>
            <Card data-testid="kpi-collected">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <DollarSign className="w-4 h-4" /> Total Collected
                </div>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">{fmt(totals.collected)}</div>
              </CardContent>
            </Card>
            <Card data-testid="kpi-rate">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <TrendingUp className="w-4 h-4" /> Collection Rate
                </div>
                <div className="text-2xl font-bold">{division === "all" ? `${collectionRate}%` : "—"}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{division === "all" ? "collected ÷ billed" : "not tracked by division"}</div>
              </CardContent>
            </Card>
          </div>

          {/* Cost vs Brought In — profitability row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card data-testid="kpi-broughtin" className="border-l-4 border-l-green-600">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <DollarSign className="w-4 h-4" /> Total Brought In
                </div>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">{fmt(totals.collected)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">payments collected</div>
              </CardContent>
            </Card>
            <Card data-testid="kpi-cost" className="border-l-4 border-l-orange-500">
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <TrendingDown className="w-4 h-4" /> Total Cost
                </div>
                <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{fmt(totals.cost)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">job costs incurred</div>
              </CardContent>
            </Card>
            <Card data-testid="kpi-net" className={`border-l-4 ${net >= 0 ? "border-l-green-600" : "border-l-red-600"}`}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Wallet className="w-4 h-4" /> Net (Brought In − Cost)
                </div>
                <div className={`text-2xl font-bold ${net >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{fmt(net)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {totals.collected > 0 ? `${Math.round((net / totals.collected) * 100)}% margin` : "margin —"}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Chart — Total Cost vs Total Brought In */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {divisionLabel} · Cost vs. Brought In, with cumulative profit{showDivisionTrend ? " and per-division net trend" : ""} — {hasFilter ? `${periodNoun}s in range` : `last 12 ${periodNoun}s`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
                  No billing activity in this range.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Brought In" fill="#16a34a" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Cost" fill="#f97316" radius={[4, 4, 0, 0]} />
                    <Line
                      type="monotone"
                      dataKey="Cumulative Profit"
                      stroke="#1E5AB4"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: "#1E5AB4" }}
                      activeDot={{ r: 5 }}
                    />
                    {showDivisionTrend && (
                      <Line
                        type="monotone"
                        dataKey="Mitigation Net"
                        stroke="#1E5AB4"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        dot={{ r: 2.5, fill: "#1E5AB4" }}
                        activeDot={{ r: 4 }}
                      />
                    )}
                    {showDivisionTrend && (
                      <Line
                        type="monotone"
                        dataKey="Reconstruction Net"
                        stroke="#CC0000"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        dot={{ r: 2.5, fill: "#CC0000" }}
                        activeDot={{ r: 4 }}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Division profitability — Mitigation vs. Reconstruction */}
          <Card data-testid="division-profitability">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-sm">
                  Division Profitability — Mitigation vs. Reconstruction
                </CardTitle>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-muted-foreground" data-testid="division-range-label">
                    {hasFilter
                      ? `${from || "start"} → ${to || "today"}`
                      : "All time"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportPDF}
                    disabled={exporting}
                    className="h-8 gap-1.5 text-xs"
                    data-testid="btn-export-division-pdf"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {exporting ? "Preparing…" : "Export PDF"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const p = new URLSearchParams({ report: "weekly-billing", print: "1", groupBy });
                      if (from) p.set("from", from);
                      if (to) p.set("to", to);
                      window.location.hash = `#/reports?${p.toString()}`;
                    }}
                    className="h-8 gap-1.5 text-xs"
                    data-testid="btn-print-friendly"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print Friendly
                  </Button>
                </div>
              </div>
              {/* Quick date-range presets — filter the cards (and the whole view) to a common window */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2" data-testid="division-date-presets">
                {PRESETS.map((p) => {
                  const active = activePreset === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => applyPreset(p.key)}
                      className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${active ? "bg-[hsl(var(--titan-blue))] text-white border-[hsl(var(--titan-blue))]" : "bg-transparent hover:bg-muted text-muted-foreground border-border"}`}
                      data-testid={`preset-${p.key}`}
                    >
                      {p.label}
                    </button>
                  );
                })}
                {hasFilter && (
                  <button
                    type="button"
                    onClick={clearFilter}
                    className="px-2.5 py-1 text-[11px] rounded-full text-muted-foreground hover:bg-muted flex items-center gap-1"
                    data-testid="preset-clear"
                  >
                    <X className="w-3 h-3" /> Clear
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {divisions.every((d) => d.collected === 0 && d.cost === 0) ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No division activity yet. Tag jobs with a division on the job page, then log costs and payments to see what's profitable.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {divisions.map((d) => {
                    const meta = DIVISION_META[d.division] || DIVISION_META.unassigned;
                    const positive = d.net >= 0;
                    return (
                      <div
                        key={d.division}
                        data-testid={`division-card-${d.division}`}
                        className="rounded-lg border p-4"
                        style={{ borderLeft: `4px solid ${meta.color}`, background: meta.bg }}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-semibold text-sm" style={{ color: meta.color }}>{meta.label}</span>
                          {d.collected === 0 && d.cost === 0 ? (
                            <Badge className="bg-gray-100 text-gray-600 border border-gray-200 text-[11px]">No activity</Badge>
                          ) : positive ? (
                            <Badge className="bg-green-100 text-green-800 border border-green-200 text-[11px] flex items-center gap-1">
                              <TrendingUp className="w-3 h-3" /> Profitable
                            </Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-800 border border-red-200 text-[11px] flex items-center gap-1">
                              <TrendingDown className="w-3 h-3" /> Losing money
                            </Badge>
                          )}
                        </div>
                        <div className="space-y-1.5 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Brought In</span>
                            <span className="font-medium text-green-600 dark:text-green-400">{fmt(d.collected)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Cost</span>
                            <span className="font-medium text-orange-600 dark:text-orange-400">{fmt(d.cost)}</span>
                          </div>
                          <div className="flex justify-between pt-1.5 border-t">
                            <span className="text-muted-foreground">Net</span>
                            <span className={`font-bold ${positive ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} data-testid={`division-net-${d.division}`}>{fmt(d.net)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Margin</span>
                            <span className={`font-medium ${positive ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{d.collected > 0 ? `${d.marginPct}%` : "—"}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground mt-4 pt-3 border-t">
                Each job carries a division tag (set it on the job page). Jobs tagged “Both” split their Brought In and Cost 50/50 across Mitigation and Reconstruction. Net = Brought In − Cost.
              </p>
            </CardContent>
          </Card>

          {/* Breakdown table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{periodNounCap} Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {periods.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No {periodNoun}s to show for this range.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-left">
                        <th className="py-2 pr-4 font-medium">{groupBy === "month" ? "Month" : "Week"}</th>
                        <th className="py-2 px-4 font-medium text-right">Billed</th>
                        <th className="py-2 px-4 font-medium text-right">Settled</th>
                        <th className="py-2 px-4 font-medium text-right">Brought In</th>
                        <th className="py-2 px-4 font-medium text-right">Cost</th>
                        <th className="py-2 px-4 font-medium text-right">Net</th>
                        <th className="py-2 pl-4 font-medium text-right">Credit Memos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periods.map((p) => (
                        <tr key={p.periodStart} className="border-b last:border-0 hover:bg-muted/40" data-testid={`period-row-${p.periodStart}`}>
                          <td className="py-2.5 pr-4 font-medium whitespace-nowrap">{labelFor(p)}</td>
                          <td className="py-2.5 px-4 text-right">{fmt(p.billed)}</td>
                          <td className="py-2.5 px-4 text-right text-[hsl(var(--titan-blue))]">{fmt(p.settled)}</td>
                          <td className="py-2.5 px-4 text-right font-semibold text-green-600 dark:text-green-400">{fmt(p.collected)}</td>
                          <td className="py-2.5 px-4 text-right text-orange-600 dark:text-orange-400">{p.cost ? fmt(p.cost) : "—"}</td>
                          <td className={`py-2.5 px-4 text-right font-medium ${(p.collected - p.cost) >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{fmt(p.collected - p.cost)}</td>
                          <td className="py-2.5 pl-4 text-right text-red-600 dark:text-red-400">{p.creditMemos ? fmt(p.creditMemos) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 font-bold">
                        <td className="py-3 pr-4">Total</td>
                        <td className="py-3 px-4 text-right">{fmt(totals.billed)}</td>
                        <td className="py-3 px-4 text-right text-[hsl(var(--titan-blue))]">{fmt(totals.settled)}</td>
                        <td className="py-3 px-4 text-right text-green-600 dark:text-green-400">{fmt(totals.collected)}</td>
                        <td className="py-3 px-4 text-right text-orange-600 dark:text-orange-400">{totals.cost ? fmt(totals.cost) : "—"}</td>
                        <td className={`py-3 px-4 text-right ${net >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{fmt(net)}</td>
                        <td className="py-3 pl-4 text-right text-red-600 dark:text-red-400">{totals.creditMemos ? fmt(totals.creditMemos) : "—"}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground mt-4 pt-3 border-t">
                {groupBy === "month" ? "Months run calendar month." : "Weeks run Monday–Sunday."} Billed = invoice totals by invoice date.
                Settled = approved/partial supplement amounts by response date. Brought In = payments received (excludes credit memos) by payment date.
                Cost = job costs by cost date. Net = Brought In − Cost.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
