import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Clock, PlayCircle, Droplets, PenLine, Camera, Briefcase,
  ArrowRight, CheckCircle2, RefreshCw, AlertTriangle, DollarSign, Receipt, FileWarning,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";

/**
 * "My Today" — role-scoped landing view for every signed-in user.
 *
 * Owners still land on the full Dashboard (which shows cross-company
 * Attention Today, KPIs, and revenue). Everyone else lands here: a small,
 * phone-friendly list of what THEY personally need to touch today.
 *
 * Buckets from GET /api/my/today:
 *  - clockStatus       (in/out + big Clock-in button when out)
 *  - myActiveJobs      (jobs assigned to me, not complete/closed)
 *  - dryingReadsDue    (my drying jobs with no drying_records for today)
 *  - signaturesPending (docs I sent that are still unsigned)
 *  - photoTasks        (my active jobs with <3 photos in current phase)
 *
 * Mobile-first: single-column stack, 44px+ tap targets, primary Clock action
 * dominant at the top. Desktop widens to a 2-column grid at md+.
 */

type ActiveJob = {
  id: number;
  jobNumber: string;
  address?: string | null;
  status: string;
  lossType?: string | null;
  insuranceCarrier?: string | null;
};
type DryingDue = { jobId: number; jobNumber: string; address?: string | null; day: number };
type SigPending = { id: number; jobId: number; jobNumber?: string | null; title: string; docType: string; createdAt: string };
type PhotoTask = { jobId: number; jobNumber: string; address?: string | null; phase: string; count: number };
type ClockStatus =
  | { open: true; since: string; jobId?: number | null; jobNumber?: string | null; address?: string | null }
  | { open: false };

type ClaimAgingRow = {
  jobId: number;
  jobNumber: string;
  address?: string | null;
  carrier?: string | null;
  daysStale: number;
  reason: string;
  action: string;
  amount?: number;
  invoiceId?: number;
  invoiceNumber?: string;
  estimateId?: number;
  title?: string;
  adjusterName?: string | null;
};
type ClaimsAging = {
  dryOutNoInvoice: ClaimAgingRow[];
  invoicesUnpaid: ClaimAgingRow[];
  estimatesWaiting: ClaimAgingRow[];
  totals: { unpaidAR: number; waitingApproval: number; itemCount: number };
};

type MyToday = {
  generatedAt: string;
  me: { id: number; name: string; role: string };
  myActiveJobs: ActiveJob[];
  dryingReadsDue: DryingDue[];
  signaturesPending: SigPending[];
  photoTasks: PhotoTask[];
  clockStatus: ClockStatus;
  claimsAging?: ClaimsAging | null;
};

function elapsed(sinceIso: string): string {
  const ms = Date.now() - new Date(sinceIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function MyToday() {
  const { user } = useAuth();
  const [data, setData] = useState<MyToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setError(null);
    try {
      // Use apiRequest so the Authorization header is attached from
      // window.__titanToken__ (set by AuthProvider). Raw fetch with a wrong
      // localStorage key was causing spurious 401s on the daily to-do card.
      const res = await apiRequest("/api/my/today");
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      const msg = String(e?.message || "Failed to load");
      // 401 = session expired/invalid. Bounce to login instead of a dead-end
      // "Try again" that will keep failing.
      if (/^401[:\s]/.test(msg) || msg.includes("(401)")) {
        try {
          const s = (window as any).localStorage;
          if (s) s.removeItem("titan_pro_staff_token");
        } catch { /* ignore */ }
        (window as any).__titanToken__ = undefined;
        window.location.href = "/login?reason=session_expired";
        return;
      }
      setError(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load(true);
    // Auto-refresh every 60s so the clock timer and drying-due list stay live.
    const t = setInterval(() => { load(false); }, 60000);
    return () => clearInterval(t);
  }, []);

  const firstName = useMemo(
    () => (data?.me?.name || user?.name || "").split(" ")[0] || "there",
    [data, user],
  );

  const totalCount = data
    ? data.myActiveJobs.length + data.dryingReadsDue.length + data.signaturesPending.length + data.photoTasks.length
    : 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-5 sm:px-6 sm:py-8 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              {greeting()}, {firstName}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
              {data && totalCount > 0 && (
                <> · <span className="font-medium text-foreground">{totalCount} item{totalCount === 1 ? "" : "s"} on your plate</span></>
              )}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setRefreshing(true); load(false); }}
            disabled={refreshing || loading}
            className="text-muted-foreground"
            data-testid="button-refresh-today"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Loading / error */}
        {loading && !data && (
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <Card key={i}><CardContent className="p-4"><div className="h-14 bg-muted/40 rounded animate-pulse" /></CardContent></Card>
            ))}
          </div>
        )}
        {error && !data && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 text-sm text-destructive">
              {error}. <button className="underline" onClick={() => load(true)}>Try again</button>
            </CardContent>
          </Card>
        )}

        {data && (
          <>
            {/* Clock — always at the top, thumb-reach on mobile. */}
            <ClockCard status={data.clockStatus} />

            {/* Claims aging — owner/admin/office only. Full-width so the
                dollar totals get the attention they deserve. */}
            {data.claimsAging && data.claimsAging.totals.itemCount > 0 && (
              <ClaimsAgingCard aging={data.claimsAging} />
            )}

            {/* Everything else — single column on mobile, 2 columns md+. */}
            <div className="grid gap-4 md:grid-cols-2">
              <ActiveJobsCard jobs={data.myActiveJobs} />
              <DryingCard items={data.dryingReadsDue} />
              <SignaturesCard items={data.signaturesPending} />
              <PhotosCard items={data.photoTasks} />
            </div>

            {/* "All clear" fallback if truly nothing to do. */}
            {totalCount === 0 && data.clockStatus.open === false && (
              <Card className="border-emerald-500/40 bg-emerald-500/5">
                <CardContent className="p-5 flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <div className="text-sm">
                    <div className="font-medium">All clear.</div>
                    <div className="text-muted-foreground">No open jobs assigned to you and nothing pending. Enjoy the quiet.</div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Escape hatch to the full dashboard for anyone who wants it. */}
            <div className="pt-2 text-center">
              <Link href="/dashboard">
                <a className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                  Open full dashboard <ArrowRight className="w-3 h-3" />
                </a>
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Cards ─────────────────────────────────────────────────────────────── */

function ClockCard({ status }: { status: ClockStatus }) {
  if (status.open) {
    return (
      <Card className="border-[hsl(var(--titan-blue))]/30 bg-[hsl(var(--titan-blue))]/[0.04]">
        <CardContent className="p-4 sm:p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-full bg-[hsl(var(--titan-blue))]/15 p-2.5 shrink-0">
              <Clock className="w-5 h-5 text-[hsl(var(--titan-blue))]" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold">You're clocked in</div>
              <div className="text-xs text-muted-foreground truncate">
                <span className="tabular-nums font-medium text-foreground">{elapsed(status.since)}</span>
                {status.jobNumber && <> · {status.jobNumber}</>}
                {status.address && <> · {status.address}</>}
              </div>
            </div>
          </div>
          <Link href="/time-clock">
            <a>
              <Button variant="outline" size="sm" className="shrink-0 min-h-[40px]" data-testid="button-clock-out">
                Clock out
              </Button>
            </a>
          </Link>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-[hsl(var(--titan-red))]/30">
      <CardContent className="p-4 sm:p-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-full bg-[hsl(var(--titan-red))]/10 p-2.5 shrink-0">
            <PlayCircle className="w-5 h-5 text-[hsl(var(--titan-red))]" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">Not clocked in</div>
            <div className="text-xs text-muted-foreground">Start your day — captures GPS at clock-in.</div>
          </div>
        </div>
        <Link href="/time-clock">
          <a>
            <Button
              size="sm"
              className="shrink-0 min-h-[40px] bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
              data-testid="button-clock-in"
            >
              Clock in
            </Button>
          </a>
        </Link>
      </CardContent>
    </Card>
  );
}

function SectionCard({ title, icon: Icon, count, empty, children, viewAllHref, viewAllLabel }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  empty: string;
  children?: React.ReactNode;
  viewAllHref?: string;
  viewAllLabel?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold">{title}</span>
          </div>
          {count > 0 && <Badge variant="secondary" className="tabular-nums">{count}</Badge>}
        </div>
        {count === 0 ? (
          <div className="text-xs text-muted-foreground py-1">{empty}</div>
        ) : (
          <>
            <div className="divide-y divide-border/60 -mx-1">
              {children}
            </div>
            {viewAllHref && (
              <Link href={viewAllHref}>
                <a className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                  {viewAllLabel || "View all"} <ArrowRight className="w-3 h-3" />
                </a>
              </Link>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ActiveJobsCard({ jobs }: { jobs: ActiveJob[] }) {
  return (
    <SectionCard
      title="Your active jobs"
      icon={Briefcase}
      count={jobs.length}
      empty="No jobs assigned to you right now."
      viewAllHref="/jobs"
      viewAllLabel="Open Jobs"
    >
      {jobs.slice(0, 5).map(j => (
        <Link key={j.id} href={`/jobs/${j.id}`}>
          <a className="flex items-center justify-between gap-2 py-2.5 px-1 rounded hover:bg-muted/40 min-h-[44px]">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{j.jobNumber}</div>
              <div className="text-xs text-muted-foreground truncate">
                {j.address || "No address"}
                {j.lossType && <> · {j.lossType}</>}
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] capitalize shrink-0">{j.status}</Badge>
          </a>
        </Link>
      ))}
    </SectionCard>
  );
}

function DryingCard({ items }: { items: DryingDue[] }) {
  return (
    <SectionCard
      title="Drying reads due today"
      icon={Droplets}
      count={items.length}
      empty="All your drying jobs are up to date."
    >
      {items.map(d => (
        <Link key={d.jobId} href={`/jobs/${d.jobId}?tab=drying`}>
          <a className="flex items-center justify-between gap-2 py-2.5 px-1 rounded hover:bg-muted/40 min-h-[44px]">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{d.jobNumber}</div>
              <div className="text-xs text-muted-foreground truncate">{d.address || "No address"}</div>
            </div>
            <Badge variant="outline" className="text-[10px] shrink-0 tabular-nums">Day {d.day}</Badge>
          </a>
        </Link>
      ))}
    </SectionCard>
  );
}

function SignaturesCard({ items }: { items: SigPending[] }) {
  return (
    <SectionCard
      title="Signatures pending"
      icon={PenLine}
      count={items.length}
      empty="No unsigned documents you've sent."
    >
      {items.map(s => (
        <Link key={s.id} href={`/jobs/${s.jobId}?tab=documents`}>
          <a className="flex items-center justify-between gap-2 py-2.5 px-1 rounded hover:bg-muted/40 min-h-[44px]">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{s.title}</div>
              <div className="text-xs text-muted-foreground truncate">
                {s.jobNumber || "Unknown job"} · {s.docType.replace(/_/g, " ")}
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </a>
        </Link>
      ))}
    </SectionCard>
  );
}

function PhotosCard({ items }: { items: PhotoTask[] }) {
  return (
    <SectionCard
      title="Photo documentation needed"
      icon={Camera}
      count={items.length}
      empty="Photo coverage looks good on your active jobs."
    >
      {items.map(p => (
        <Link key={p.jobId} href={`/jobs/${p.jobId}?tab=photos`}>
          <a className="flex items-center justify-between gap-2 py-2.5 px-1 rounded hover:bg-muted/40 min-h-[44px]">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{p.jobNumber}</div>
              <div className="text-xs text-muted-foreground truncate">
                {p.address || "No address"} · {p.phase}
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] shrink-0 tabular-nums">{p.count} / 3+</Badge>
          </a>
        </Link>
      ))}
    </SectionCard>
  );
}

/**
 * Claims aging — the single most valuable card on MyToday for owners.
 * Surfaces every stalled bit of the claim-to-cash pipeline so nothing
 * silently sits in "waiting on somebody" limbo for a month.
 *
 * Three buckets:
 *  1. Dry-out complete ≥ 1d, no invoice sent → send the invoice.
 *  2. Invoice sent ≥ 30d, still unpaid → follow up (carrier / customer).
 *  3. Estimate sent ≥ 7d, no adjuster movement → nudge the adjuster.
 *
 * Every row is one-tap: it deep-links straight to the exact tab on the
 * job so the owner can act without hunting.
 */
function ClaimsAgingCard({ aging }: { aging: ClaimsAging }) {
  const fmtUsd = (n: number) =>
    n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;
  const staleTone = (days: number, thresholds: [number, number]) =>
    days >= thresholds[1] ? "text-red-600 dark:text-red-400"
    : days >= thresholds[0] ? "text-amber-600 dark:text-amber-400"
    : "text-muted-foreground";

  return (
    <Card className="border-amber-500/40 bg-gradient-to-br from-amber-500/5 to-red-500/5">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <div>
              <div className="text-sm font-semibold">Claims aging</div>
              <div className="text-[11px] text-muted-foreground">
                {aging.totals.itemCount} item{aging.totals.itemCount === 1 ? "" : "s"} need attention
              </div>
            </div>
          </div>
          <div className="text-right">
            {aging.totals.unpaidAR > 0 && (
              <div className="text-sm font-bold text-red-600 dark:text-red-400 tabular-nums">
                {fmtUsd(aging.totals.unpaidAR)} unpaid
              </div>
            )}
            {aging.totals.waitingApproval > 0 && (
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {fmtUsd(aging.totals.waitingApproval)} awaiting approval
              </div>
            )}
          </div>
        </div>

        {/* Dry-out done, no invoice */}
        {aging.dryOutNoInvoice.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <FileWarning className="w-3.5 h-3.5 text-amber-600" />
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Ready to invoice ({aging.dryOutNoInvoice.length})
              </div>
            </div>
            <div className="space-y-1">
              {aging.dryOutNoInvoice.slice(0, 4).map(r => (
                <Link key={`inv-${r.jobId}`} href={`/jobs/${r.jobId}?tab=invoices`}>
                  <a className="flex items-center justify-between gap-2 py-2 px-2 rounded hover:bg-background/60 min-h-[44px]">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{r.jobNumber}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {r.address || "No address"}
                        {r.carrier ? ` · ${r.carrier}` : ""}
                      </div>
                    </div>
                    <div className={`text-[11px] font-medium shrink-0 tabular-nums ${staleTone(r.daysStale, [3, 7])}`}>
                      {r.daysStale}d dry
                    </div>
                  </a>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Unpaid invoices */}
        {aging.invoicesUnpaid.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Receipt className="w-3.5 h-3.5 text-red-600" />
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Unpaid invoices ({aging.invoicesUnpaid.length})
              </div>
            </div>
            <div className="space-y-1">
              {aging.invoicesUnpaid.slice(0, 4).map(r => (
                <Link key={`iu-${r.invoiceId}`} href={`/jobs/${r.jobId}?tab=invoices`}>
                  <a className="flex items-center justify-between gap-2 py-2 px-2 rounded hover:bg-background/60 min-h-[44px]">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {r.invoiceNumber || r.jobNumber}
                        <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">
                          {r.jobNumber}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {r.carrier || "No carrier"} · {fmtUsd(r.amount || 0)}
                      </div>
                    </div>
                    <div className={`text-[11px] font-medium shrink-0 tabular-nums ${staleTone(r.daysStale, [45, 60])}`}>
                      {r.daysStale}d
                    </div>
                  </a>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Estimates awaiting adjuster */}
        {aging.estimatesWaiting.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <DollarSign className="w-3.5 h-3.5 text-amber-600" />
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Awaiting adjuster ({aging.estimatesWaiting.length})
              </div>
            </div>
            <div className="space-y-1">
              {aging.estimatesWaiting.slice(0, 4).map(r => (
                <Link key={`ew-${r.estimateId}`} href={`/jobs/${r.jobId}?tab=estimates`}>
                  <a className="flex items-center justify-between gap-2 py-2 px-2 rounded hover:bg-background/60 min-h-[44px]">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{r.jobNumber}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {r.title || "Estimate"} · {fmtUsd(r.amount || 0)}
                        {r.adjusterName ? ` · ${r.adjusterName}` : ""}
                      </div>
                    </div>
                    <div className={`text-[11px] font-medium shrink-0 tabular-nums ${staleTone(r.daysStale, [10, 21])}`}>
                      {r.daysStale}d
                    </div>
                  </a>
                </Link>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
