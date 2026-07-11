import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, TrendingUp, TrendingDown, Star, AlertTriangle, CheckCircle } from "lucide-react";

const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function ReferralProfitability() {
  const { data: referrals = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/reports/referral-profitability"],
    queryFn: () => apiRequest("/api/reports/referral-profitability").then(r => r.json()),
  });

  const topPerformer = referrals.find((r: any) => r.qualityScore >= 75);
  const lowPerformers = referrals.filter((r: any) => r.qualityScore < 50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Referral Source Profitability</h1>
        <p className="text-sm text-muted-foreground">Beyond volume — true margin per referral source accounting for collection speed, disputes, and supplement approvals</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-[hsl(var(--titan-blue))]">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Referral Partners</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-total-partners">{referrals.length}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Top Rated</p>
            <p className="text-2xl font-bold mt-1 text-green-600" data-testid="text-top-rated">{referrals.filter(r => r.qualityScore >= 75).length}</p>
            <p className="text-xs text-muted-foreground">≥75 quality score</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Needs Review</p>
            <p className="text-2xl font-bold mt-1 text-red-500" data-testid="text-needs-review">{lowPerformers.length}</p>
            <p className="text-xs text-muted-foreground">&lt;50 quality score</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-[hsl(var(--titan-red))]">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Invoiced</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-total-invoiced">{fmt(referrals.reduce((s: number, r: any) => s + r.totalInvoiced, 0))}</p>
            <p className="text-xs text-muted-foreground">from referral jobs</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : referrals.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No referral partner data</p>
          <p className="text-sm text-muted-foreground mt-1">Add contacts with type "referral" and assign jobs to them via lead source tracking to see profitability intelligence</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {referrals.map((ref: any) => (
            <Card key={ref.id} className={`border-l-4 ${ref.qualityScore >= 75 ? "border-l-green-500" : ref.qualityScore >= 50 ? "border-l-yellow-500" : "border-l-red-500"}`} data-testid={`card-referral-${ref.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold">{ref.name}</p>
                      {ref.company && <span className="text-sm text-muted-foreground">{ref.company}</span>}
                      {ref.referralRate && <Badge variant="outline" className="text-xs">{ref.referralRate}% referral rate</Badge>}
                    </div>

                    {/* Score bar */}
                    <div className="mt-3 space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Quality Score</span>
                        <span className={`font-bold ${ref.qualityScore >= 75 ? "text-green-600" : ref.qualityScore >= 50 ? "text-yellow-600" : "text-red-500"}`}>{ref.qualityScore}/100</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${ref.qualityScore >= 75 ? "bg-green-500" : ref.qualityScore >= 50 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${ref.qualityScore}%` }} />
                      </div>
                    </div>

                    {/* Metrics grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                      <div className="bg-muted/40 rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">Jobs</p>
                        <p className="font-bold text-sm">{ref.jobCount}</p>
                      </div>
                      <div className="bg-muted/40 rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">Total Invoiced</p>
                        <p className="font-bold text-sm">{fmt(ref.totalInvoiced)}</p>
                      </div>
                      <div className="bg-muted/40 rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">Collection Rate</p>
                        <p className={`font-bold text-sm ${ref.collectionRate >= 80 ? "text-green-600" : ref.collectionRate >= 50 ? "" : "text-red-500"}`}>{ref.collectionRate}%</p>
                      </div>
                      <div className="bg-muted/40 rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">Avg Days to Pay</p>
                        <p className={`font-bold text-sm ${ref.avgDaysToPay == null ? "" : ref.avgDaysToPay > 60 ? "text-red-500" : ref.avgDaysToPay > 30 ? "text-yellow-600" : "text-green-600"}`}>{ref.avgDaysToPay != null ? `${ref.avgDaysToPay}d` : "N/A"}</p>
                      </div>
                      <div className="bg-muted/40 rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">Dispute Rate</p>
                        <p className={`font-bold text-sm ${ref.disputeRate > 30 ? "text-red-500" : ref.disputeRate > 0 ? "text-yellow-600" : "text-green-600"}`}>{ref.disputeRate}%</p>
                      </div>
                      <div className="bg-muted/40 rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">Supp Approval</p>
                        <p className={`font-bold text-sm ${ref.supplementApprovalRate >= 70 ? "text-green-600" : ref.supplementApprovalRate > 0 ? "" : "text-muted-foreground"}`}>{ref.supplementApprovalRate > 0 ? `${ref.supplementApprovalRate}%` : "N/A"}</p>
                      </div>
                    </div>

                    {/* Recommendation */}
                    <div className={`mt-3 p-2 rounded text-xs flex items-start gap-2 ${ref.qualityScore >= 75 ? "bg-green-50 dark:bg-green-900/10 text-green-800 dark:text-green-400" : ref.qualityScore >= 50 ? "bg-yellow-50 dark:bg-yellow-900/10 text-yellow-800 dark:text-yellow-400" : "bg-red-50 dark:bg-red-900/10 text-red-800 dark:text-red-400"}`}>
                      {ref.qualityScore >= 75 ? <CheckCircle className="w-3 h-3 shrink-0 mt-0.5" /> : ref.qualityScore >= 50 ? <TrendingUp className="w-3 h-3 shrink-0 mt-0.5" /> : <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />}
                      {ref.recommendation}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm ${ref.qualityScore >= 75 ? "bg-green-500" : ref.qualityScore >= 50 ? "bg-yellow-500" : "bg-red-500"}`}>
                      {ref.qualityScore}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">score</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
