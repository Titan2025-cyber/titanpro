import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, TrendingUp, DollarSign, Star } from "lucide-react";

function fmt(n: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n); }

function score(data: any): { grade: string; color: string; bg: string } {
  const roi = data.roi || 0;
  const jobs = data.jobsReferred || 0;
  const s = Math.min(100, (roi > 0 ? Math.min(50, roi / 10) : 0) + (jobs * 5));
  if (s >= 80) return { grade: "A", color: "text-green-700", bg: "bg-green-100" };
  if (s >= 60) return { grade: "B", color: "text-blue-700", bg: "bg-blue-100" };
  if (s >= 40) return { grade: "C", color: "text-yellow-700", bg: "bg-yellow-100" };
  if (s >= 20) return { grade: "D", color: "text-orange-700", bg: "bg-orange-100" };
  return { grade: "F", color: "text-red-700", bg: "bg-red-100" };
}

export default function PartnerScorecard() {
  const { data: partners = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/reports/partner-roi"] });

  const totalRevenue = (partners as any[]).reduce((s: number, p: any) => s + (p.totalRevenue || 0), 0);
  const totalPaid = (partners as any[]).reduce((s: number, p: any) => s + (p.totalPaid || 0), 0);
  const totalJobs = (partners as any[]).reduce((s: number, p: any) => s + (p.jobsReferred || 0), 0);

  if (isLoading) return <div className="p-6"><div className="h-64 bg-muted rounded animate-pulse" /></div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Referral Partner Scorecard</h1>
        <p className="text-sm text-muted-foreground">Revenue, payout, ROI, and performance grade per partner</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Partner Revenue</p><p className="text-xl font-bold">{fmt(totalRevenue)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Payouts</p><p className="text-xl font-bold text-red-600">{fmt(totalPaid)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Jobs Referred</p><p className="text-xl font-bold">{totalJobs}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Active Partners</p><p className="text-xl font-bold">{(partners as any[]).length}</p></CardContent></Card>
      </div>

      {(partners as any[]).length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No referral partners yet. Add contacts with type "referral" to start tracking.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(partners as any[]).map((p: any) => {
            const s = score(p);
            const roiStr = p.roi !== null && p.roi !== undefined ? `${p.roi.toFixed(1)}x` : "—";
            return (
              <Card key={p.partner} data-testid={`card-partner-${p.partner}`}>
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-foreground">{p.partner}</p>
                      {p.company && <p className="text-xs text-muted-foreground">{p.company}</p>}
                      {p.referralRate && <p className="text-xs text-muted-foreground">{p.referralRate}% referral rate</p>}
                    </div>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${s.bg} ${s.color}`}>{s.grade}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/40 rounded p-2">
                      <p className="text-xs text-muted-foreground">Revenue</p>
                      <p className="font-semibold text-sm">{fmt(p.totalRevenue || 0)}</p>
                    </div>
                    <div className="bg-muted/40 rounded p-2">
                      <p className="text-xs text-muted-foreground">Paid Out</p>
                      <p className="font-semibold text-sm text-red-600">{fmt(p.totalPaid || 0)}</p>
                    </div>
                    <div className="bg-muted/40 rounded p-2">
                      <p className="text-xs text-muted-foreground">Jobs Referred</p>
                      <p className="font-semibold text-sm">{p.jobsReferred || 0}</p>
                    </div>
                    <div className="bg-muted/40 rounded p-2">
                      <p className="text-xs text-muted-foreground">ROI</p>
                      <p className={`font-semibold text-sm ${(p.roi || 0) > 5 ? "text-green-600" : "text-foreground"}`}>{roiStr}</p>
                    </div>
                  </div>

                  {p.totalPending > 0 && (
                    <div className="bg-yellow-50 dark:bg-yellow-950 rounded px-3 py-2">
                      <p className="text-xs font-medium text-yellow-800 dark:text-yellow-200">Pending payout: {fmt(p.totalPending)}</p>
                    </div>
                  )}

                  {p.jobs && p.jobs.length > 0 && (
                    <div className="border-t pt-3">
                      <p className="text-xs text-muted-foreground mb-1">Recent jobs</p>
                      {p.jobs.slice(0, 3).map((j: any) => (
                        <p key={j.jobNumber} className="text-xs text-muted-foreground">{j.jobNumber} · {j.address}</p>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
