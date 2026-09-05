/*
 * DryingPlanCard.tsx — S500 drying reading calendar.
 *
 * Renders the forward-looking daily reading plan for a drying job:
 *   • Baseline day count driven by the job's water category (S500).
 *   • Each day marked completed / today_due / missed / upcoming.
 *   • Missed-day banner surfaces skipped readings so techs (and Cody) can
 *     back-fill before an adjuster asks "where's day 3?"
 *
 * Backed by GET /api/jobs/:id/drying-plan — a pure server-side compute over
 * mitigation_start + drying_records. No writes here; taps deep-link into the
 * existing DryingRecords entry below.
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, CheckCircle2, AlertTriangle, Clock, Droplets } from "lucide-react";

type DayEntry = {
  day: number;
  date: string;
  status: "completed" | "today_due" | "missed" | "upcoming";
  readings: number;
};

type Plan = {
  jobId: number;
  startDate: string | null;
  category: string;
  baselineDays: number;
  days: DayEntry[];
  completedCount: number;
  missedCount: number;
  remainingDays: number;
  targetCompletionDate: string | null;
  nextAction: string;
};

export default function DryingPlanCard({ jobId }: { jobId: number }) {
  const { data, isLoading } = useQuery<Plan>({
    queryKey: [`/api/jobs/${jobId}/drying-plan`],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/jobs/${jobId}/drying-plan`);
      return r.json();
    },
    // Refetch when the tech logs a reading; kept lightweight so it can run
    // on tab focus without hammering the endpoint.
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="h-14 bg-muted/40 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (!data.startDate || data.days.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 text-sm text-muted-foreground">
          {data.nextAction}
        </CardContent>
      </Card>
    );
  }

  const catLabel = data.category.includes("3")
    ? "Cat 3"
    : data.category.includes("2")
      ? "Cat 2"
      : "Cat 1";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
          Drying Plan
          <Badge variant="outline" className="ml-2 text-[10px]">
            IICRC S500 · {catLabel} · {data.baselineDays}-day baseline
          </Badge>
          {data.missedCount > 0 && (
            <Badge className="ml-auto bg-red-600 text-white text-[10px]">
              {data.missedCount} missed
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Summary strip: completed / remaining / target */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <SummaryPill
            icon={<CheckCircle2 className="w-3.5 h-3.5" />}
            label="Completed"
            value={String(data.completedCount)}
            tone="green"
          />
          <SummaryPill
            icon={<Clock className="w-3.5 h-3.5" />}
            label="Remaining"
            value={String(data.remainingDays)}
            tone="blue"
          />
          <SummaryPill
            icon={<Droplets className="w-3.5 h-3.5" />}
            label="Target"
            value={data.targetCompletionDate?.slice(5) || "—"}
            tone="neutral"
          />
        </div>

        {/* Next-action banner */}
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            data.missedCount > 0
              ? "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200"
              : data.days.some(d => d.status === "today_due")
                ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                : "border-green-500/30 bg-green-500/5 text-green-900 dark:text-green-200"
          }`}
        >
          <div className="flex items-start gap-2">
            {data.missedCount > 0 ? (
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span>{data.nextAction}</span>
          </div>
        </div>

        {/* Day-by-day dot strip */}
        <div className="flex flex-wrap gap-1.5">
          {data.days.map(d => (
            <DayDot key={d.day} entry={d} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryPill({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "green" | "blue" | "neutral";
}) {
  const toneCls =
    tone === "green"
      ? "text-green-700 dark:text-green-300"
      : tone === "blue"
        ? "text-[hsl(var(--titan-blue))]"
        : "text-foreground";
  return (
    <div className="rounded-md border bg-muted/20 px-2 py-1.5">
      <div className={`flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide ${toneCls}`}>
        {icon}
        {label}
      </div>
      <div className="text-lg font-semibold leading-tight tabular-nums">{value}</div>
    </div>
  );
}

function DayDot({ entry }: { entry: DayEntry }) {
  const cls =
    entry.status === "completed"
      ? "bg-green-600 text-white border-green-700"
      : entry.status === "today_due"
        ? "bg-amber-400 text-amber-950 border-amber-600 animate-pulse"
        : entry.status === "missed"
          ? "bg-red-600 text-white border-red-700"
          : "bg-muted/30 text-muted-foreground border-muted";
  const title = `Day ${entry.day} · ${entry.date} · ${entry.status.replace("_", " ")}${entry.readings ? ` · ${entry.readings} reading${entry.readings > 1 ? "s" : ""}` : ""}`;
  return (
    <div
      title={title}
      className={`h-7 min-w-[2rem] px-1.5 rounded-md border text-[11px] font-semibold flex items-center justify-center ${cls}`}
      data-testid={`drying-day-${entry.day}`}
    >
      D{entry.day}
    </div>
  );
}
