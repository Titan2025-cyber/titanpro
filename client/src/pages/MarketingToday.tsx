// MarketingToday.tsx
//
// Landing tab for the Marketing Hub. Rebuilt in Push 5 with four rep-workflow
// improvements over the initial Push 4 version:
//
//   1. Highest-leverage action card at the top — the single best thing to do
//      right now, computed from a weighted score across every queue.
//   2. Rich context per row — partner tier + 90d referrals + YTD revenue;
//      review-queue red/green flags for problem-customer safety.
//   3. One-tap actions per row — Call, Text, Log touch on partner rows;
//      dialer / SMS pre-populated so the rep never leaves the queue.
//   4. Deep-link tap-throughs preserved so nothing gets more than one click
//      from a decision to a full workflow.
//
// Design principle: this tab is READ + APPROVE + LIGHTWEIGHT-ACTION. It never
// fires an outbound customer message on its own. Send buttons live on the
// Review Engine only, and the rep still clicks per row there.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
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
  Phone,
  MessageCircle,
  CheckCircle2,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

// ── Formatters ─────────────────────────────────────────────────────────────
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

// Normalize phone for tel: / sms: — strip everything but digits, prefix +1
const telHref = (raw?: string | null) => {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  return `tel:${digits.length === 10 ? "+1" + digits : "+" + digits}`;
};
const smsHref = (raw?: string | null, body?: string) => {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const num = digits.length === 10 ? "+1" + digits : "+" + digits;
  const q = body ? `?&body=${encodeURIComponent(body)}` : "";
  return `sms:${num}${q}`;
};

// Partner tier bands based on 90-day revenue attribution
type PartnerTier = "diamond" | "gold" | "silver" | "bronze" | "cold";
function tierFor(revenue90d: number, referrals90d: number): PartnerTier {
  if (revenue90d >= 30000 || referrals90d >= 6) return "diamond";
  if (revenue90d >= 15000 || referrals90d >= 3) return "gold";
  if (revenue90d >= 5000 || referrals90d >= 1) return "silver";
  if (revenue90d > 0) return "bronze";
  return "cold";
}
const TIER_LABEL: Record<PartnerTier, string> = {
  diamond: "Diamond",
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
  cold: "Cold",
};
const TIER_STYLE: Record<PartnerTier, string> = {
  diamond: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-700",
  gold: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700",
  silver: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600",
  bronze: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/40 dark:text-orange-200 dark:border-orange-700",
  cold: "bg-muted text-muted-foreground border-border",
};

// Review-queue signal detection — computes red/green flags off jobs data
type ReviewSignal = "red" | "green" | "neutral";
function reviewSignalFor(job: any, warrantyByJob: Map<number, number>): { signal: ReviewSignal; reason: string } {
  const warranty = warrantyByJob.get(job.id) || 0;
  const invoicePaid = !!job.invoicePaidDate;
  const invoiceSent = !!job.invoiceSentDate;
  const daysSinceSent = invoiceSent ? daysBetween(job.invoiceSentDate) : null;
  const note = ((job.internalNote || "") + " " + (job.description || "")).toLowerCase();
  const NEG_WORDS = ["complaint", "unhappy", "dispute", "refund", "problem", "issue", "angry", "upset", "wrong", "damaged", "broke", "leak returned"];
  const hasNegNote = NEG_WORDS.some((w) => note.includes(w));

  // Red flags — do NOT surface for review send
  if (warranty > 0) return { signal: "red", reason: `${warranty} warranty call${warranty > 1 ? "s" : ""}` };
  if (hasNegNote) return { signal: "red", reason: "Negative note on file" };
  if (invoiceSent && !invoicePaid && daysSinceSent !== null && daysSinceSent > 30) {
    return { signal: "red", reason: `Invoice ${daysSinceSent}d unpaid` };
  }

  // Green flags — safe / likely-happy customer
  if (invoicePaid) return { signal: "green", reason: "Paid in full" };

  return { signal: "neutral", reason: "" };
}

export default function MarketingToday() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ── Data feeds ─────────────────────────────────────────────────────────
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });
  const { data: contacts = [] } = useQuery<any[]>({ queryKey: ["/api/contacts"] });
  const { data: reviewRequests = [] } = useQuery<any[]>({ queryKey: ["/api/review-requests"] });
  const { data: reviewFeedback = [] } = useQuery<any[]>({ queryKey: ["/api/review-feedback"] });
  const { data: stormEvents = [] } = useQuery<any[]>({ queryKey: ["/api/storm-events"] });
  const { data: nurtureLog = [] } = useQuery<any[]>({ queryKey: ["/api/referral-nurture"] });
  const { data: partnerRoi = [] } = useQuery<any[]>({ queryKey: ["/api/reports/partner-roi"] });
  const { data: warrantyCalls = [] } = useQuery<any[]>({
    queryKey: ["/api/warranty-calls"],
    queryFn: () => apiRequest("GET", "/api/warranty-calls").then((r) => r.json()).catch(() => []),
  });

  // ── Nurture logging mutation ───────────────────────────────────────────
  const logTouchMutation = useMutation({
    mutationFn: (payload: { contactId: number; kind: string }) =>
      apiRequest("POST", "/api/referral-nurture", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/referral-nurture"] });
      toast({ title: "Touch logged", description: "Cadence updated." });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't log touch", description: e.message, variant: "destructive" });
    },
  });

  // ── Derived: KPI strip ─────────────────────────────────────────────────
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

  const jobsSoldThisWeek = (jobs as any[]).filter((j) => {
    if (!j.wonAt && !j.signedWorkAuthAt && !j.salesDate) return false;
    const t = new Date(j.wonAt || j.signedWorkAuthAt || j.salesDate).getTime();
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

  // ── Warranty index (for review-signal detection) ───────────────────────
  const warrantyByJob = new Map<number, number>();
  (warrantyCalls as any[]).forEach((w: any) => {
    if (!w.jobId) return;
    warrantyByJob.set(w.jobId, (warrantyByJob.get(w.jobId) || 0) + 1);
  });

  // ── Partner enrichment: 90d referrals + YTD revenue + tier ─────────────
  const roiByPartner = new Map<number, any>();
  (partnerRoi as any[]).forEach((r: any) => roiByPartner.set(r.partnerId, r));

  const enrichPartner = (partner: any) => {
    const roi = roiByPartner.get(partner.id) || {};
    const partnerJobs = (jobs as any[]).filter(
      (j) =>
        j.referralPartnerId === partner.id ||
        (j.leadSource === "referral" &&
          j.leadSourceDetail &&
          partner.name &&
          j.leadSourceDetail.toLowerCase().includes(partner.name.toLowerCase())),
    );
    const jobs90d = partnerJobs.filter((j) => {
      const t = new Date(j.createdAt || j.salesDate || 0).getTime();
      return t >= ninetyDaysAgo;
    });
    const revenue90d = jobs90d.reduce(
      (s, j) => s + (Number(j.totalContract) || Number(j.estimateTotal) || 0),
      0,
    );
    const ytdRevenue = Number(roi.totalRevenue) || 0;
    const tier = tierFor(revenue90d, jobs90d.length);
    return { revenue90d, referrals90d: jobs90d.length, ytdRevenue, tier };
  };

  // ── Derived: Action Queues ──────────────────────────────────────────────

  // 1. Reviews ready to send — completed jobs not opted-out, with signal flags.
  const sentJobIds = new Set(
    (reviewRequests as any[]).map((r) => r.jobId).filter(Boolean),
  );
  const reviewsToSend = (jobs as any[])
    .filter(
      (j) =>
        j.status === "complete" &&
        !sentJobIds.has(j.id) &&
        !j.reviewOptOut,
    )
    .map((j) => ({ job: j, ...reviewSignalFor(j, warrantyByJob) }))
    // Rank: green flags first (safe sends), then neutral, red last (rep should scrutinize)
    .sort((a, b) => {
      const order = { green: 0, neutral: 1, red: 2 } as const;
      return order[a.signal] - order[b.signal];
    })
    .slice(0, 6);

  // 2. Dormant referral partners — 60+ days since last touch, enriched.
  const referralPartners = (contacts as any[]).filter((c) => c.type === "referral");
  const lastTouchByPartner = new Map<number, string>();
  (nurtureLog as any[]).forEach((n) => {
    const prev = lastTouchByPartner.get(n.contactId);
    if (!prev || new Date(n.sentAt || n.touchedAt || n.createdAt) > new Date(prev)) {
      lastTouchByPartner.set(n.contactId, n.sentAt || n.touchedAt || n.createdAt);
    }
  });
  const dormantPartners = referralPartners
    .map((p) => {
      const lastTouch = lastTouchByPartner.get(p.id) || p.updatedAt || p.createdAt;
      const days = daysBetween(lastTouch);
      const enriched = enrichPartner(p);
      return { partner: p, days, ...enriched };
    })
    .filter((x) => x.days !== null && x.days >= 60)
    // Rank by "leverage" — tier weight × days silent
    .sort((a, b) => {
      const tierWeight: Record<PartnerTier, number> = { diamond: 100, gold: 50, silver: 20, bronze: 5, cold: 1 };
      return tierWeight[b.tier] * (b.days || 0) - tierWeight[a.tier] * (a.days || 0);
    })
    .slice(0, 6);

  // 3. Untagged leads — jobs missing lead source, hurts attribution.
  const untaggedJobs = (jobs as any[])
    .filter((j) => !j.leadSource || j.leadSource === "unknown")
    .sort((a, b) => (Number(b.totalContract) || 0) - (Number(a.totalContract) || 0))
    .slice(0, 5);

  // 4. Recent storm events — content opportunity.
  const recentStorms = (stormEvents as any[])
    .filter((s) => {
      const t = new Date(s.eventTime || s.createdAt).getTime();
      return t >= now - 3 * 24 * 60 * 60 * 1000;
    })
    .slice(0, 3);

  // ── Highest-leverage action — the single #1 recommendation ─────────────
  type Rec = { headline: string; sub: string; cta: string; href: string; icon: any };
  let topRec: Rec | null = null;

  // Priority 1: Diamond/Gold partner who's dormant
  const bigDormant = dormantPartners.find((p) => p.tier === "diamond" || p.tier === "gold");
  if (bigDormant) {
    topRec = {
      headline: `Call ${bigDormant.partner.name}`,
      sub: `${TIER_LABEL[bigDormant.tier]} partner · ${bigDormant.referrals90d} referrals worth ${fmtCurrency(bigDormant.revenue90d)} in the last 90 days · silent for ${bigDormant.days} days`,
      cta: "Open partner",
      href: "/marketing-hub?tab=referrals",
      icon: Handshake,
    };
  }

  // Priority 2: Untagged high-value job — hurts attribution investment decisions
  if (!topRec) {
    const bigUntagged = untaggedJobs.find((j) => Number(j.totalContract) >= 20000);
    if (bigUntagged) {
      const contact = (contacts as any[]).find((c) => c.id === bigUntagged.contactId);
      topRec = {
        headline: `Tag the lead source for ${contact?.name || bigUntagged.jobNumber}`,
        sub: `${fmtCurrency(Number(bigUntagged.totalContract) || 0)} job · source is unknown — you can't invest in what you can't measure`,
        cta: "Open job",
        href: `/jobs/${bigUntagged.id}`,
        icon: AlertCircle,
      };
    }
  }

  // Priority 3: Recent storm with no content posted
  if (!topRec && recentStorms.length > 0) {
    topRec = {
      headline: "Publish storm content now",
      sub: `${recentStorms.length} recent storm event${recentStorms.length > 1 ? "s" : ""} in the CSRA — first-mover on Facebook wins the neighborhood`,
      cta: "Compose",
      href: "/marketing-hub?tab=content",
      icon: CloudLightning,
    };
  }

  // Priority 4: 3+ green-flag reviews ready to send
  const greenReviews = reviewsToSend.filter((r) => r.signal === "green").length;
  if (!topRec && greenReviews >= 3) {
    topRec = {
      headline: `Send ${greenReviews} review requests`,
      sub: `${greenReviews} completed jobs marked as safe (paid in full, no complaints) are waiting — batch-approve saves 5 minutes`,
      cta: "Review queue",
      href: "/marketing-hub?tab=reviews",
      icon: Send,
    };
  }

  // Priority 5: any dormant partner
  if (!topRec && dormantPartners.length > 0) {
    const p = dormantPartners[0];
    topRec = {
      headline: `Touch base with ${p.partner.name}`,
      sub: `${p.days} days since last touch · ${p.referrals90d} referrals in the last 90 days`,
      cta: "Log a touch",
      href: "/marketing-hub?tab=referrals",
      icon: Clock,
    };
  }

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
      {/* Highest-leverage action — top of screen, one recommendation */}
      {topRec && (
        <Card
          className="border-primary/40 bg-gradient-to-br from-primary/5 to-primary/10"
          data-testid="top-rec-card"
        >
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <div className="shrink-0 mt-0.5 rounded-full bg-primary/15 p-2.5">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-primary uppercase tracking-wide mb-1">
                  Highest-leverage action right now
                </div>
                <div className="text-lg font-semibold text-foreground">{topRec.headline}</div>
                <div className="text-sm text-muted-foreground mt-1">{topRec.sub}</div>
              </div>
              <Link href={topRec.href}>
                <Button size="sm" data-testid="button-top-rec">
                  {topRec.cta}
                  <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <Card key={k.testid} data-testid={k.testid}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <k.icon className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground truncate">{k.label}</span>
              </div>
              <div className="text-2xl font-bold">{k.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{k.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Action Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Reviews ready to send — with red/green flags */}
        <Card data-testid="queue-reviews">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="w-4 h-4" />
                Reviews ready to send
              </CardTitle>
              <Link href="/marketing-hub?tab=reviews">
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
                    Rep approval required. Never auto-sent. Green rows are safe. Red rows
                    have warning signals — scrutinize before sending.
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {reviewsToSend.map(({ job, signal, reason }) => (
                    <li
                      key={job.id}
                      className="flex items-center justify-between text-sm py-1 gap-2"
                      data-testid={`review-item-${job.id}`}
                    >
                      <div className="shrink-0" title={reason || (signal === "green" ? "Safe to send" : "No signal")}>
                        {signal === "red" && <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400" />}
                        {signal === "green" && <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                        {signal === "neutral" && <span className="inline-block w-4 h-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">
                          {job.customerName || job.jobNumber || "Job #" + job.id}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {job.address || job.division || "—"}
                          {reason && (
                            <span className={signal === "red" ? "text-red-600 dark:text-red-400 ml-1" : signal === "green" ? "text-emerald-600 dark:text-emerald-400 ml-1" : ""}>
                              · {reason}
                            </span>
                          )}
                        </div>
                      </div>
                      <Link href={`/marketing-hub?tab=reviews`}>
                        <Button size="sm" variant="outline" data-testid={`review-review-${job.id}`}>
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

        {/* Dormant partners — tier badges + one-tap actions */}
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
              <ul className="space-y-2">
                {dormantPartners.map(({ partner, days, referrals90d, revenue90d, ytdRevenue, tier }) => {
                  const tel = telHref(partner.phone);
                  const sms = smsHref(
                    partner.phone,
                    `Hey ${partner.name?.split(" ")[0] || ""}, been a minute — how's everything on your end? Free for coffee this week?`,
                  );
                  return (
                    <li
                      key={partner.id}
                      className="border-b last:border-0 pb-2 last:pb-0"
                      data-testid={`partner-item-${partner.id}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm truncate">{partner.name}</span>
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 h-4 border ${TIER_STYLE[tier]}`}
                            >
                              {TIER_LABEL[tier]}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {partner.company || partner.email || "—"}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            <span className="font-medium text-foreground">{referrals90d}</span> ref / 90d
                            {" · "}
                            <span className="font-medium text-foreground">{fmtCurrency(revenue90d)}</span> 90d
                            {ytdRevenue > 0 && (
                              <>
                                {" · "}
                                <span className="font-medium text-foreground">{fmtCurrency(ytdRevenue)}</span> YTD
                              </>
                            )}
                            {" · "}
                            <span className="text-amber-700 dark:text-amber-400">{days}d silent</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1.5 mt-1.5">
                        {tel ? (
                          <a href={tel} className="flex-1">
                            <Button size="sm" variant="outline" className="w-full h-7 text-xs" data-testid={`partner-call-${partner.id}`}>
                              <Phone className="w-3 h-3 mr-1" /> Call
                            </Button>
                          </a>
                        ) : null}
                        {sms ? (
                          <a href={sms} className="flex-1">
                            <Button size="sm" variant="outline" className="w-full h-7 text-xs" data-testid={`partner-sms-${partner.id}`}>
                              <MessageCircle className="w-3 h-3 mr-1" /> Text
                            </Button>
                          </a>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="flex-1 h-7 text-xs"
                          onClick={() =>
                            logTouchMutation.mutate({ contactId: partner.id, kind: "quick_touch" })
                          }
                          disabled={logTouchMutation.isPending}
                          data-testid={`partner-log-${partner.id}`}
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Logged
                        </Button>
                      </div>
                    </li>
                  );
                })}
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
                  <li key={s.id} className="text-sm py-1" data-testid={`storm-item-${s.id}`}>
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

        {/* Untagged leads — ranked by $ value */}
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
                {untaggedJobs.map((j) => {
                  const contact = (contacts as any[]).find((c) => c.id === j.contactId);
                  const value = Number(j.totalContract) || Number(j.estimateTotal) || 0;
                  return (
                    <li
                      key={j.id}
                      className="flex items-center justify-between text-sm py-1 gap-2"
                      data-testid={`untagged-item-${j.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">
                          {contact?.name || j.jobNumber || "Job #" + j.id}
                          {value > 0 && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {fmtCurrency(value)}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {j.address || "—"} • {j.status}
                        </div>
                      </div>
                      <Link href={`/jobs/${j.id}`}>
                        <Button size="sm" variant="outline" data-testid={`untagged-tag-${j.id}`}>
                          Tag
                        </Button>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
