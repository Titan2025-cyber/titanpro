// MarketingToday.tsx
//
// Landing tab for the Marketing Hub. Designed to be the first thing the
// marketing rep sees when they open the app in the morning.
//
// Layout:
//   1. KPI strip — this-week revenue-tied metrics
//   2. Action Queue — the 4 highest-signal to-dos surfaced from other tabs:
//        • Review requests ready to send (rep clicks send — never auto-sent)
//        • Storm-triggered content drafts awaiting rep approval
//        • Dormant referral partners (60+ days since last touch)
//        • Untagged leads (missing lead source — hurts attribution accuracy)
//   3. Deep-links into the other tabs for the full workflow
//
// Design principle: this tab is READ + APPROVE. It never fires an outbound
// message on its own. The rep has final say on every "customer touch".

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Star,
  Percent,
  Handshake,
  CloudLightning,
  Send,
  AlertCircle,
  ArrowUpRight,
  Clock,
  MessageSquare,
} from "lucide-react";

const fmtCurrency = (v: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v || 0);

const daysBetween = (isoOrNull: string | null | undefined): number | null => {
  if (!isoOrNull) return null;
  const then = new Date(isoOrNull).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
};

export default function MarketingToday() {
  // ── Data feeds ─────────────────────────────────────────────────────────
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });
  const { data: contacts = [] } = useQuery<any[]>({ queryKey: ["/api/contacts"] });
  const { data: reviewRequests = [] } = useQuery<any[]>({ queryKey: ["/api/review-requests"] });
  const { data: reviewFeedback = [] } = useQuery<any[]>({ queryKey: ["/api/review-feedback"] });
  const { data: stormEvents = [] } = useQuery<any[]>({ queryKey: ["/api/storm-events"] });
  const { data: nurtureLog = [] } = useQuery<any[]>({ queryKey: ["/api/referral-nurture"] });

  // ── Derived: KPI strip ─────────────────────────────────────────────────
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const jobsSoldThisWeek = (jobs as any[]).filter((j) => {
    if (!j.wonAt && !j.signedWorkAuthAt) return false;
    const t = new Date(j.wonAt || j.signedWorkAuthAt).getTime();
    return t >= weekAgo && t <= now;
  });

  const revenueThisWeek = jobsSoldThisWeek.reduce(
    (s, j) => s + (Number(j.totalContract) || Number(j.estimateTotal) || 0),
    0,
  );

  const reviewsSentThisWeek = (reviewRequests as any[]).filter(
    (r) => r.sentAt && new Date(r.sentAt).getTime() >= weekAgo,
  ).length;

  const positiveFeedbackThisWeek = (reviewFeedback as any[]).filter(
    (f) => f.rating >= 4 && new Date(f.createdAt).getTime() >= weekAgo,
  ).length;
  const negativeFeedbackThisWeek = (reviewFeedback as any[]).filter(
    (f) => f.rating <= 3 && new Date(f.createdAt).getTime() >= weekAgo,
  ).length;

  const closedThisWeek = (jobs as any[]).filter((j) => {
    if (j.status !== "complete" && j.status !== "closed") return false;
    if (!j.closedAt && !j.completedAt) return false;
    return new Date(j.closedAt || j.completedAt).getTime() >= weekAgo;
  });
  const conversionThisWeek =
    closedThisWeek.length > 0
      ? Math.round((jobsSoldThisWeek.length / Math.max(closedThisWeek.length, 1)) * 100)
      : 0;

  // ── Derived: Action Queue ──────────────────────────────────────────────

  // 1. Reviews ready to send — completed jobs not yet requested.
  //    Cody's constraint: NEVER auto-send. Rep must approve each one.
  //    Also filter out jobs the rep has explicitly opted-out of (opted_out
  //    flag on the job) so problem customers stay silent.
  const sentJobIds = new Set(
    (reviewRequests as any[]).map((r) => r.jobId).filter(Boolean),
  );
  const reviewsToSend = (jobs as any[])
    .filter(
      (j) =>
        j.status === "complete" &&
        !sentJobIds.has(j.id) &&
        !j.reviewOptOut, // rep-set opt-out flag
    )
    .slice(0, 5);

  // 2. Dormant referral partners — 60+ days since last touch.
  const referralPartners = (contacts as any[]).filter((c) => c.type === "referral");
  const lastTouchByPartner = new Map<number, string>();
  (nurtureLog as any[]).forEach((n) => {
    const prev = lastTouchByPartner.get(n.contactId);
    if (!prev || new Date(n.touchedAt) > new Date(prev)) {
      lastTouchByPartner.set(n.contactId, n.touchedAt);
    }
  });
  const dormantPartners = referralPartners
    .map((p) => {
      const lastTouch = lastTouchByPartner.get(p.id) || p.updatedAt || p.createdAt;
      const days = daysBetween(lastTouch);
      return { partner: p, days };
    })
    .filter((x) => x.days !== null && x.days >= 60)
    .sort((a, b) => (b.days || 0) - (a.days || 0))
    .slice(0, 5);

  // 3. Untagged leads — jobs missing lead source, hurts attribution.
  const untaggedJobs = (jobs as any[])
    .filter((j) => !j.leadSource || j.leadSource === "unknown")
    .slice(0, 5);

  // 4. Recent storm events — content opportunity.
  const recentStorms = (stormEvents as any[])
    .filter((s) => {
      const t = new Date(s.eventTime || s.createdAt).getTime();
      return t >= now - 3 * 24 * 60 * 60 * 1000;
    })
    .slice(0, 3);

  const kpis = [
    {
      label: "Jobs sold this week",
      icon: Star,
      value: jobsSoldThisWeek.length,
      sub: fmtCurrency(revenueThisWeek),
      testid: "kpi-sold",
    },
    {
      label: "Conversion this week",
      icon: Percent,
      value: `${conversionThisWeek}%`,
      sub: `${jobsSoldThisWeek.length} of ${closedThisWeek.length} closed`,
      testid: "kpi-conversion",
    },
    {
      label: "Reviews sent this week",
      icon: MessageSquare,
      value: reviewsSentThisWeek,
      sub: `${positiveFeedbackThisWeek}★ / ${negativeFeedbackThisWeek}⚠ back`,
      testid: "kpi-reviews",
    },
    {
      label: "Active partners",
      icon: Handshake,
      value: referralPartners.length,
      sub: `${dormantPartners.length} dormant 60d+`,
      testid: "kpi-partners",
    },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <Card key={k.testid} data-testid={k.testid}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <k.icon className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{k.label}</span>
              </div>
              <div className="text-2xl font-bold">{k.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{k.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Action Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Reviews ready to send — MANUAL APPROVAL ONLY */}
        <Card data-testid="queue-reviews">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="w-4 h-4" />
                Reviews ready to send
              </CardTitle>
              <Link href="/reviews">
                <Button variant="ghost" size="sm" data-testid="link-reviews-hub">
                  Open <ArrowUpRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {reviewsToSend.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No completed jobs pending. New requests appear here for your approval.
              </p>
            ) : (
              <>
                <div className="mb-2 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded px-2 py-1.5">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    Rep approval required. Nothing is sent automatically. Skip any
                    customer where a review request would backfire.
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {reviewsToSend.map((j) => (
                    <li
                      key={j.id}
                      className="flex items-center justify-between text-sm py-1"
                      data-testid={`review-item-${j.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{j.customerName || "—"}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {j.address || j.division || "Job #" + j.id}
                        </div>
                      </div>
                      <Link href={`/reviews?job=${j.id}`}>
                        <Button size="sm" variant="outline" data-testid={`review-review-${j.id}`}>
                          Review
                        </Button>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        {/* Dormant partners */}
        <Card data-testid="queue-partners">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Partners needing a touch
              </CardTitle>
              <Link href="/marketing-hub?tab=referrals">
                <Button variant="ghost" size="sm" data-testid="link-partners">
                  Open <ArrowUpRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {dormantPartners.length === 0 ? (
              <p className="text-sm text-muted-foreground">All partners have had a recent touch.</p>
            ) : (
              <ul className="space-y-1.5">
                {dormantPartners.map(({ partner, days }) => (
                  <li
                    key={partner.id}
                    className="flex items-center justify-between text-sm py-1"
                    data-testid={`partner-item-${partner.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{partner.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {partner.company || partner.email || partner.phone}
                      </div>
                    </div>
                    <Badge variant="outline" className="ml-2 shrink-0">
                      {days}d
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Storm content opportunities */}
        <Card data-testid="queue-storms">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CloudLightning className="w-4 h-4" />
                Storm content opportunities
              </CardTitle>
              <Link href="/marketing-hub?tab=content">
                <Button variant="ghost" size="sm" data-testid="link-storm-content">
                  Compose <ArrowUpRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentStorms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No storm events in the last 72 hours.</p>
            ) : (
              <ul className="space-y-1.5">
                {recentStorms.map((s) => (
                  <li
                    key={s.id}
                    className="text-sm py-1"
                    data-testid={`storm-item-${s.id}`}
                  >
                    <div className="font-medium">
                      {s.eventType || "Storm"} — {s.county || s.zip || "CSRA"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.severity || "reported"} • {new Date(s.eventTime || s.createdAt).toLocaleDateString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Untagged leads — attribution hygiene */}
        <Card data-testid="queue-untagged">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Untagged leads
              </CardTitle>
              <Link href="/marketing-hub?tab=insights">
                <Button variant="ghost" size="sm" data-testid="link-attribution">
                  Attribute <ArrowUpRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {untaggedJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every job has a lead source. Nice.</p>
            ) : (
              <ul className="space-y-1.5">
                {untaggedJobs.map((j) => (
                  <li
                    key={j.id}
                    className="flex items-center justify-between text-sm py-1"
                    data-testid={`untagged-item-${j.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{j.customerName || "—"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {j.address || "Job #" + j.id} • {j.status}
                      </div>
                    </div>
                    <Link href={`/jobs/${j.id}`}>
                      <Button size="sm" variant="outline" data-testid={`untagged-tag-${j.id}`}>
                        Tag
                      </Button>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
