import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  RefreshCw, TrendingUp, Info, Award, DollarSign,
  Clock, CheckCircle2, XCircle, ChevronDown, ChevronUp, GitMerge
} from "lucide-react";
import { CarrierMergeDialog } from "@/components/CarrierMergeDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface CarrierScore {
  carrier: string;
  grade: "A" | "B" | "C" | "D" | "F";
  score: number; // 0–100
  totalJobs: number;
  totalRevenue: number;
  avgDaysToPay: number;
  supplementApprovalRate: number; // 0–100
  disputes: number;
  deniedSupplements: number;
}

type SortKey = "grade" | "revenue" | "jobs";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const GRADE_CONFIG: Record<CarrierScore["grade"], { bg: string; text: string; ring: string; label: string }> = {
  A: { bg: "bg-green-100",  text: "text-green-700",   ring: "ring-green-400",  label: "Excellent" },
  B: { bg: "bg-blue-100",   text: "text-[hsl(var(--titan-blue))]", ring: "ring-blue-400",   label: "Good" },
  C: { bg: "bg-yellow-100", text: "text-yellow-700",  ring: "ring-yellow-400", label: "Average" },
  D: { bg: "bg-orange-100", text: "text-orange-700",  ring: "ring-orange-400", label: "Below Avg" },
  F: { bg: "bg-red-100",    text: "text-[hsl(var(--titan-red))]", ring: "ring-red-400",    label: "Poor" },
};

const GRADE_PROGRESS_COLOR: Record<CarrierScore["grade"], string> = {
  A: "bg-green-500",
  B: "bg-[hsl(var(--titan-blue))]",
  C: "bg-yellow-500",
  D: "bg-orange-500",
  F: "bg-[hsl(var(--titan-red))]",
};

function payDayColor(days: number) {
  if (days <= 30) return "text-green-700";
  if (days <= 60) return "text-yellow-700";
  return "text-[hsl(var(--titan-red))]";
}

function sortCarriers(carriers: CarrierScore[], key: SortKey): CarrierScore[] {
  const GRADE_ORDER = { A: 0, B: 1, C: 2, D: 3, F: 4 };
  return [...carriers].sort((a, b) => {
    if (key === "grade")   return GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade];
    if (key === "revenue") return b.totalRevenue - a.totalRevenue;
    if (key === "jobs")    return b.totalJobs - a.totalJobs;
    return 0;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Grade Formula Info Card
// ─────────────────────────────────────────────────────────────────────────────
function GradeInfoCard() {
  return (
    <Card className="border-[hsl(var(--titan-blue)/0.3)] bg-blue-50/40" data-testid="grade-info-card">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-8 h-8 rounded-full bg-[hsl(var(--titan-blue))] flex items-center justify-center">
            <Info className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-sm mb-2">How Grades Work</h3>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
              {(["A", "B", "C", "D", "F"] as CarrierScore["grade"][]).map(g => {
                const cfg = GRADE_CONFIG[g];
                const descriptions: Record<CarrierScore["grade"], string> = {
                  A: "Fast pay (≤30 days) + high supplement approval (≥80%)",
                  B: "Pay ≤45 days, supplement approval ≥60%",
                  C: "Pay ≤60 days, supplement approval ≥40%",
                  D: "Slow pay or low supplement approval",
                  F: "Slow pay (>60 days) + routinely denies supplements",
                };
                return (
                  <div key={g} className={`rounded-lg p-2.5 ${cfg.bg} border border-current/10`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`text-lg font-black ${cfg.text}`}>{g}</span>
                      <span className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug">{descriptions[g]}</p>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Score formula: <span className="font-medium">40% payment speed + 40% supplement approval rate + 20% dispute ratio</span>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Carrier Card
// ─────────────────────────────────────────────────────────────────────────────
function CarrierCard({ carrier }: { carrier: CarrierScore }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = GRADE_CONFIG[carrier.grade];
  const progressColor = GRADE_PROGRESS_COLOR[carrier.grade];

  const stats = [
    {
      label: "Total Jobs",
      value: carrier.totalJobs.toString(),
      icon: Award,
      color: "text-foreground",
    },
    {
      label: "Total Revenue",
      value: fmt(carrier.totalRevenue),
      icon: DollarSign,
      color: "text-green-700",
    },
    {
      label: "Avg Days to Pay",
      value: `${carrier.avgDaysToPay}d`,
      icon: Clock,
      color: payDayColor(carrier.avgDaysToPay),
    },
    {
      label: "Supp Approval",
      value: `${carrier.supplementApprovalRate.toFixed(0)}%`,
      icon: CheckCircle2,
      color: carrier.supplementApprovalRate >= 60 ? "text-green-700" : carrier.supplementApprovalRate >= 40 ? "text-yellow-700" : "text-[hsl(var(--titan-red))]",
    },
    {
      label: "Disputes / Denied",
      value: `${carrier.disputes} / ${carrier.deniedSupplements}`,
      icon: XCircle,
      color: (carrier.disputes + carrier.deniedSupplements) > 3 ? "text-[hsl(var(--titan-red))]" : "text-muted-foreground",
    },
  ];

  return (
    <Card
      className={`border transition-shadow hover:shadow-md ${
        carrier.grade === "A" ? "border-green-300" :
        carrier.grade === "B" ? "border-blue-300" :
        carrier.grade === "F" ? "border-[hsl(var(--titan-red)/0.4)]" :
        "border-border"
      }`}
      data-testid={`carrier-card-${carrier.carrier.replace(/\s+/g, "-").toLowerCase()}`}
    >
      <CardContent className="p-4">
        {/* Header row */}
        <div className="flex items-start gap-3">
          {/* Grade circle */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`shrink-0 w-14 h-14 rounded-full ring-2 ${cfg.ring} ${cfg.bg} flex flex-col items-center justify-center cursor-default`}
                  data-testid={`grade-circle-${carrier.carrier.replace(/\s+/g, "-").toLowerCase()}`}
                  aria-label={`Grade ${carrier.grade}: ${cfg.label}`}
                >
                  <span className={`text-2xl font-black leading-none ${cfg.text}`}>{carrier.grade}</span>
                  <span className={`text-[9px] font-semibold ${cfg.text} opacity-80`}>{cfg.label}</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <p className="font-semibold mb-1">Grade {carrier.grade} — {cfg.label}</p>
                <p className="text-xs">Score: {carrier.score}/100</p>
                <p className="text-xs mt-1 text-muted-foreground">
                  Formula: 40% pay speed + 40% supplement approval + 20% dispute ratio
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Name + score */}
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base leading-tight">{carrier.carrier}</h3>
            <div className="flex items-center gap-2 mt-1">
              <Progress
                value={carrier.score}
                className="h-2 flex-1"
                data-testid={`score-bar-${carrier.carrier.replace(/\s+/g, "-").toLowerCase()}`}
              />
              <span className={`text-xs font-semibold ${cfg.text} shrink-0`}>{carrier.score}/100</span>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mt-4">
          {stats.map(stat => {
            const StatIcon = stat.icon;
            return (
              <div
                key={stat.label}
                className="bg-muted/40 rounded-lg p-2 text-center"
                data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, "-")}-${carrier.carrier.replace(/\s+/g, "-").toLowerCase()}`}
              >
                <StatIcon className={`w-3.5 h-3.5 mx-auto mb-1 ${stat.color}`} />
                <p className={`font-bold text-sm ${stat.color}`}>{stat.value}</p>
                <p className="text-xs text-muted-foreground leading-tight">{stat.label}</p>
              </div>
            );
          })}
        </div>

        {/* Expandable grade explanation */}
        <button
          className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          onClick={() => setExpanded(e => !e)}
          data-testid={`button-expand-${carrier.carrier.replace(/\s+/g, "-").toLowerCase()}`}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? "Hide details" : "Why this grade?"}
        </button>

        {expanded && (
          <div className="mt-2 rounded-lg bg-muted/30 p-3 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Payment speed score</span>
              <span className={`font-semibold ${payDayColor(carrier.avgDaysToPay)}`}>
                {carrier.avgDaysToPay <= 30 ? "Excellent" : carrier.avgDaysToPay <= 45 ? "Good" : carrier.avgDaysToPay <= 60 ? "Average" : "Poor"}
                {" "}({carrier.avgDaysToPay}d avg)
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Supplement approval rate</span>
              <span className={`font-semibold ${carrier.supplementApprovalRate >= 60 ? "text-green-700" : "text-orange-700"}`}>
                {carrier.supplementApprovalRate.toFixed(0)}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Disputes + denied</span>
              <span className={`font-semibold ${(carrier.disputes + carrier.deniedSupplements) > 3 ? "text-[hsl(var(--titan-red))]" : "text-muted-foreground"}`}>
                {carrier.disputes + carrier.deniedSupplements} total
              </span>
            </div>
            <div className="flex items-center justify-between border-t pt-1.5 mt-1">
              <span className="font-medium">Composite score</span>
              <span className={`font-bold text-sm ${cfg.text}`}>{carrier.score} / 100 → Grade {carrier.grade}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty State
// ─────────────────────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="text-center py-16 text-muted-foreground" data-testid="carrier-scorecard-empty">
      <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-25" />
      <p className="text-base font-semibold">No carrier data yet</p>
      <p className="text-sm mt-1 max-w-xs mx-auto">
        Add jobs with insurance carriers to see scores, grade breakdowns, and payment trends.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function CarrierScorecard() {
  const [sortBy, setSortBy] = useState<SortKey>("grade");
  const [mergeOpen, setMergeOpen] = useState(false);

  const { data: rawCarriers = [], isLoading, refetch, isFetching } = useQuery<any[]>({
    queryKey: ["/api/carrier-scorecard"],
  });

  // Normalize API response to match CarrierScore type
  const carriers: CarrierScore[] = rawCarriers.map((c: any) => ({
    carrier: c.carrier ?? "",
    grade: c.grade ?? "D",
    score: c.score ?? 50,
    totalJobs: c.totalJobs ?? 0,
    totalRevenue: c.totalRevenue ?? 0,
    avgDaysToPay: c.avgDaysToPay ?? 0,
    supplementApprovalRate: c.suppApprovalRate ?? c.supplementApprovalRate ?? 0,
    disputes: c.disputes ?? 0,
    deniedSupplements: c.deniedSupplements ?? 0,
  }));

  const sorted = sortCarriers(carriers, sortBy);

  const overallGrade = carriers.length > 0
    ? (["A", "B", "C", "D", "F"] as CarrierScore["grade"][]).find(g =>
        carriers.filter(c => c.grade === g).length > carriers.length / 2
      ) ?? carriers.sort((a, b) => b.score - a.score)[0]?.grade
    : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Carrier Scorecard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Track which insurers pay fast, approve supplements, and which ones fight you
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={sortBy} onValueChange={v => setSortBy(v as SortKey)}>
            <SelectTrigger className="w-40 h-8 text-xs" data-testid="select-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="grade">Sort by Grade</SelectItem>
              <SelectItem value="revenue">Sort by Revenue</SelectItem>
              <SelectItem value="jobs">Sort by Jobs</SelectItem>
            </SelectContent>
          </Select>
          {/* Fix scorecard rows split by typos ("Statefarm" vs "State Farm"). */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => setMergeOpen(true)}
            data-testid="button-open-merge"
          >
            <GitMerge className="w-3.5 h-3.5" />
            Merge duplicates
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-scorecard"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <CarrierMergeDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        carriers={carriers.map((c) => ({ name: c.carrier, totalJobs: c.totalJobs }))}
        onDone={() => refetch()}
      />

      {/* Grade formula info card */}
      <GradeInfoCard />

      {/* Quick summary badges — only if data */}
      {carriers.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap" data-testid="grade-summary-badges">
          {(["A", "B", "C", "D", "F"] as CarrierScore["grade"][]).map(g => {
            const count = carriers.filter(c => c.grade === g).length;
            if (count === 0) return null;
            const cfg = GRADE_CONFIG[g];
            return (
              <Badge
                key={g}
                className={`${cfg.bg} ${cfg.text} border-current/20 border text-xs font-semibold px-2 py-0.5`}
                data-testid={`grade-badge-${g}`}
              >
                {count} Grade {g}
              </Badge>
            );
          })}
          <span className="text-xs text-muted-foreground ml-1">
            across {carriers.length} carrier{carriers.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="carrier-scorecard-grid">
          {sorted.map(c => (
            <CarrierCard key={c.carrier} carrier={c} />
          ))}
        </div>
      )}
    </div>
  );
}
