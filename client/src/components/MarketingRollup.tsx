import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import CountUp from "@/components/CountUp";
import { Star, Percent, Target, Handshake, CloudLightning, TrendingUp } from "lucide-react";

const LEAD_SOURCE_LABELS: Record<string, string> = {
  referral: "Referral Partner",
  google: "Google / SEO",
  door_knock: "Door Knock",
  insurance_direct: "Insurance Direct",
  repeat: "Repeat Customer",
  other: "Other",
  unknown: "Untagged",
};

interface Kpi {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  sub?: string;
  empty?: boolean;
  testid: string;
}

export default function MarketingRollup() {
  const { data: requests = [] } = useQuery<any[]>({ queryKey: ["/api/review-requests"] });
  const { data: feedback = [] } = useQuery<any[]>({ queryKey: ["/api/review-feedback"] });
  const { data: attribution = [] } = useQuery<any[]>({
    queryKey: ["/api/reports/lead-attribution"],
    queryFn: () => apiRequest("GET", "/api/reports/lead-attribution").then((r) => r.json()),
  });
  const { data: leadCosts = [] } = useQuery<any[]>({
    queryKey: ["/api/lead-source-costs"],
    queryFn: () => apiRequest("GET", "/api/lead-source-costs").then((r) => r.json()),
  });
  const { data: partnerRoi = [] } = useQuery<any[]>({ queryKey: ["/api/reports/partner-roi"] });
  const { data: stormEvents = [] } = useQuery<any[]>({ queryKey: ["/api/storm-events"] });

  const now = new Date();
  const thisMonth = (d?: string) => {
    if (!d) return false;
    const dt = new Date(d);
    return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
  };

  // Reviews this month
  const reviewedThisMonth = (requests as any[]).filter((r: any) => r.status === "reviewed" && thisMonth(r.sentAt)).length;
  const ratings = (feedback as any[]).map((f: any) => f.rating).filter((n: number) => n > 0);
  const avgRating = ratings.length ? ratings.reduce((s: number, n: number) => s + n, 0) / ratings.length : 0;

  // Review conversion
  const sentCount = (requests as any[]).filter((r: any) => r.status !== "pending").length;
  const reviewedCount = (requests as any[]).filter((r: any) => r.status === "reviewed").length;
  const convPct = sentCount > 0 ? Math.round((reviewedCount / sentCount) * 100) : 0;

  // Top lead source
  const tagged = (attribution as any[]).filter((s: any) => s.source !== "unknown");
  const topSource = [...tagged].sort((a: any, b: any) => (b.totalRevenue ?? 0) - (a.totalRevenue ?? 0))[0];

  // Referral revenue
  const referralRevenue = (partnerRoi as any[]).reduce((s: number, p: any) => s + (p.totalRevenue ?? 0), 0);

  // Active storm events
  const activeStorms = (stormEvents as any[]).filter((e: any) => e.status === "active").length;

  // Blended marketing ROI
  const totalRevenue = (attribution as any[]).reduce((s: number, x: any) => s + (x.totalRevenue ?? 0), 0);
  const totalSpend = (leadCosts as any[]).reduce((s: number, c: any) => s + (c.monthlyCost ?? 0), 0);
  const blendedRoi = totalSpend > 0 ? totalRevenue / totalSpend : null;

  const kpis: Kpi[] = [
    { label: "Reviews this month", icon: Star, value: reviewedThisMonth, sub: avgRating > 0 ? `${avgRating.toFixed(1)}★ avg` : "No ratings yet", testid: "kpi-reviews" },
    { label: "Review conversion", icon: Percent, value: convPct, suffix: "%", sub: `${reviewedCount}/${sentCount} sent`, testid: "kpi-conversion" },
    { label: "Top lead source", icon: Target, value: topSource?.totalRevenue ?? 0, prefix: "$", sub: topSource ? (LEAD_SOURCE_LABELS[topSource.source] ?? topSource.source) : "—", empty: !topSource, testid: "kpi-topsource" },
    { label: "Referral revenue", icon: Handshake, value: referralRevenue, prefix: "$", sub: `${(partnerRoi as any[]).length} partners`, testid: "kpi-referral" },
    { label: "Active storm events", icon: CloudLightning, value: activeStorms, sub: `${(stormEvents as any[]).length} tracked`, testid: "kpi-storms" },
    { label: "Blended ROI", icon: TrendingUp, value: blendedRoi ?? 0, suffix: "×", decimals: 1, sub: totalSpend > 0 ? `$${Math.round(totalSpend).toLocaleString()} spend` : "Add spend", empty: blendedRoi == null, testid: "kpi-roi" },
  ];

  return (
    <div className="relative overflow-hidden px-6 pt-6 pb-4 border-b bg-background">
      <div className="tp-watermark" style={{ inset: 0, backgroundImage: "url(/titan-logo.png)", backgroundPosition: "right -40px top -20px", backgroundSize: "220px" }} />
      <div className="relative z-[1]">
        <div className="flex items-center gap-2 mb-1">
          <span className="tp-page-eyebrow">Marketing Command</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">Titan Restoration LLC · Augusta GA · live marketing performance</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {kpis.map((k) => {
            const Icon = k.icon;
            return (
              <div key={k.label} className="titan-card-lit rounded-lg bg-card/60 backdrop-blur px-3 py-3" data-testid={k.testid}>
                <div className="flex items-center gap-1.5 text-[0.68rem] uppercase tracking-wide text-muted-foreground mb-1">
                  <Icon className="w-3.5 h-3.5 text-[hsl(var(--titan-blue))]" />
                  {k.label}
                </div>
                <div className="text-xl font-bold tp-gradient-text">
                  {k.empty ? "—" : <CountUp value={k.value} prefix={k.prefix} suffix={k.suffix} decimals={k.decimals ?? 0} />}
                </div>
                {k.sub && <p className="text-[0.68rem] text-muted-foreground mt-0.5 truncate">{k.sub}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
