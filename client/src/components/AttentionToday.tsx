import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle, DollarSign, PenLine, Droplets, Clock, TimerReset, MessageSquare, ArrowRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * "Attention Today" — cross-company owner triage widget.
 *
 * Six buckets fetched from GET /api/dashboard/attention:
 *  - Overdue invoices (past due date, still open)
 *  - Signature requests pending >24h
 *  - Drying jobs past IICRC 3-day benchmark without completion
 *  - Stalled jobs (no drying activity in >5 days, still open)
 *  - Long clock-ins (>10h without a clock-out)
 *  - Supplements pending >7 days
 *
 * We show the count as a badge and the top 5 offending rows inline
 * with deep-links so the owner can act in one click. Self-hides when
 * everything is clear. Owner/admin only via the endpoint's role gate.
 */

type Bucket<T = any> = { count: number; items: T[] };
type Attention = {
  generatedAt: string;
  buckets: {
    overdueInvoices: Bucket;
    unsignedRequests: Bucket;
    dryingPastBenchmark: Bucket;
    stalledJobs: Bucket;
    longClockIns: Bucket;
    stalePendingSupplements: Bucket;
  };
};

function daysSince(iso?: string | null) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 3600 * 1000)));
}

function hoursSince(iso?: string | null) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / (3600 * 1000)));
}

export default function AttentionToday() {
  const [data, setData] = useState<Attention | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dashboard/attention", { credentials: "include" });
        if (!res.ok) { setLoaded(true); return; }
        const json = await res.json();
        if (!cancelled) { setData(json); setLoaded(true); }
      } catch {
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!loaded || !data) return null;

  const b = data.buckets;
  const totalIssues =
    b.overdueInvoices.count + b.unsignedRequests.count + b.dryingPastBenchmark.count +
    b.stalledJobs.count + b.longClockIns.count + b.stalePendingSupplements.count;

  if (totalIssues === 0) return null; // "All clear" — don't waste screen space.

  const bucketCards = [
    {
      key: "overdue",
      title: "Overdue invoices",
      icon: DollarSign,
      count: b.overdueInvoices.count,
      viewAllHref: "/invoices?filter=overdue",
      renderItem: (i: any) => (
        <Link key={i.id} href={`/invoices?highlight=${i.id}`}>
          <a className="flex items-center justify-between gap-2 py-1 text-xs hover:bg-muted/40 rounded px-1">
            <span className="truncate font-medium">Invoice {i.invoiceNumber}</span>
            <span className="text-muted-foreground tabular-nums">
              {daysSince(i.dueDate)}d late · ${Number(i.total || 0).toFixed(0)}
            </span>
          </a>
        </Link>
      ),
    },
    {
      key: "signatures",
      title: "Signatures pending >24h",
      icon: PenLine,
      count: b.unsignedRequests.count,
      viewAllHref: "/jobs",
      renderItem: (i: any) => (
        <Link key={i.id} href={`/jobs/${i.jobId}`}>
          <a className="flex items-center justify-between gap-2 py-1 text-xs hover:bg-muted/40 rounded px-1">
            <span className="truncate font-medium">{i.title}</span>
            <span className="text-muted-foreground tabular-nums">
              {daysSince(i.createdAt)}d · {i.recipientName || i.recipientEmail}
            </span>
          </a>
        </Link>
      ),
    },
    {
      key: "drying",
      title: "Drying past 3-day benchmark",
      icon: Droplets,
      count: b.dryingPastBenchmark.count,
      viewAllHref: "/jobs",
      renderItem: (i: any) => (
        <Link key={i.jobId} href={`/jobs/${i.jobId}`}>
          <a className="flex items-center justify-between gap-2 py-1 text-xs hover:bg-muted/40 rounded px-1">
            <span className="truncate font-medium">{i.jobNumber} · {i.address || "no address"}</span>
            <span className="text-muted-foreground tabular-nums">Day {i.days}</span>
          </a>
        </Link>
      ),
    },
    {
      key: "stalled",
      title: "Stalled jobs (5d+ no activity)",
      icon: TimerReset,
      count: b.stalledJobs.count,
      viewAllHref: "/jobs",
      renderItem: (i: any) => (
        <Link key={i.jobId} href={`/jobs/${i.jobId}`}>
          <a className="flex items-center justify-between gap-2 py-1 text-xs hover:bg-muted/40 rounded px-1">
            <span className="truncate font-medium">{i.jobNumber} · {i.status}</span>
            <span className="text-muted-foreground tabular-nums">{daysSince(i.lastActivity)}d idle</span>
          </a>
        </Link>
      ),
    },
    {
      key: "clockins",
      title: "Long clock-ins (>10h)",
      icon: Clock,
      count: b.longClockIns.count,
      viewAllHref: "/time-clock",
      renderItem: (i: any) => (
        <div key={i.id} className="flex items-center justify-between gap-2 py-1 text-xs px-1">
          <span className="truncate font-medium">{i.employeeName}</span>
          <span className="text-muted-foreground tabular-nums">{hoursSince(i.clockInAt)}h in</span>
        </div>
      ),
    },
    {
      key: "supplements",
      title: "Supplements pending >7d",
      icon: MessageSquare,
      count: b.stalePendingSupplements.count,
      viewAllHref: "/jobs",
      renderItem: (i: any) => (
        <Link key={i.id} href={`/jobs/${i.jobId}`}>
          <a className="flex items-center justify-between gap-2 py-1 text-xs hover:bg-muted/40 rounded px-1">
            <span className="truncate font-medium">{i.title}</span>
            <span className="text-muted-foreground tabular-nums">
              {daysSince(i.submittedAt)}d · {i.carrier || "no carrier"}
            </span>
          </a>
        </Link>
      ),
    },
  ].filter(c => c.count > 0);

  return (
    <Card className="border-amber-500/40 bg-amber-500/[0.02]">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/15 p-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-foreground">Attention today</h3>
              <p className="text-xs text-muted-foreground">
                {totalIssues} item{totalIssues === 1 ? "" : "s"} across {bucketCards.length} area{bucketCards.length === 1 ? "" : "s"} need your eyes.
              </p>
            </div>
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            Updated {new Date(data.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {bucketCards.map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.key} className="rounded-md border border-border/60 bg-card p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{c.title}</span>
                  </div>
                  <Badge variant="secondary" className="tabular-nums">{c.count}</Badge>
                </div>
                <div className="mt-2 space-y-0.5">
                  {(data.buckets as any)[
                    c.key === "overdue" ? "overdueInvoices" :
                    c.key === "signatures" ? "unsignedRequests" :
                    c.key === "drying" ? "dryingPastBenchmark" :
                    c.key === "stalled" ? "stalledJobs" :
                    c.key === "clockins" ? "longClockIns" :
                    "stalePendingSupplements"
                  ].items.map((it: any) => c.renderItem(it))}
                </div>
                {c.count > 5 && (
                  <Link href={c.viewAllHref}>
                    <a className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                      View all {c.count} <ArrowRight className="w-3 h-3" />
                    </a>
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
