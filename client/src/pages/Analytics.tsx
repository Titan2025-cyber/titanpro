/**
 * Analytics — best-in-class operational metrics dashboard.
 *
 * A single tab with the seven metrics I recommended:
 *   1. Cycle time (median + p90 by phase)
 *   2. Estimate → settled variance (with per-carrier breakdown)
 *   3. Supplement win rate (per carrier)
 *   4. Tech productivity leaderboard
 *   5. Aging AR (0/30/60/90+ buckets)
 *   6. Lead conversion funnel (by source)
 *   7. Job margin distribution (histogram)
 *
 * Everything reads from GET /api/analytics/overview?days=N. The server
 * computes in a single request so this page stays snappy even as data
 * grows. Time window is user-selectable (30 / 60 / 90 / 180 / 365).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, Legend } from "recharts";
import { TrendingUp, TrendingDown, DollarSign, Clock, Users, Target, Percent, Activity } from "lucide-react";

type Overview = any; // Server payload — see server/routes_analytics.ts.

const fmtUSD = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const fmtPct = (n: number, digits = 1) =>
  `${(n || 0).toFixed(digits)}%`;
const fmtDays = (n: number) => `${(n || 0).toFixed(1)}d`;

export default function Analytics() {
  const [days, setDays] = useState("90");

  const { data, isLoading } = useQuery<Overview>({
    queryKey: ["/api/analytics/overview", days],
    queryFn: async () => {
      const r = await fetch(`/api/analytics/overview?days=${days}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load analytics");
      return r.json();
    },
    // Refresh once a minute — cheap query and users leave the tab open.
    refetchInterval: 60_000,
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="text-muted-foreground">Best-in-class operational metrics for Titan Pro.</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="60">Last 60 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="180">Last 180 days</SelectItem>
            <SelectItem value="365">Last 365 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading || !data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <>
          {/* ── Top KPI row ─────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={<Clock className="h-4 w-4" />}
              label="Mitigation cycle time"
              primary={fmtDays(data.cycleTime.mitigation.median)}
              secondary={`p90 ${fmtDays(data.cycleTime.mitigation.p90)} · n=${data.cycleTime.mitigation.n}`}
            />
            <KpiCard
              icon={<Clock className="h-4 w-4" />}
              label="Reconstruction cycle time"
              primary={fmtDays(data.cycleTime.reconstruction.median)}
              secondary={`p90 ${fmtDays(data.cycleTime.reconstruction.p90)} · n=${data.cycleTime.reconstruction.n}`}
            />
            <KpiCard
              icon={<Percent className="h-4 w-4" />}
              label="Estimate → settled variance"
              primary={fmtPct(data.variance.overall.variancePct)}
              secondary={`${fmtUSD(data.variance.overall.settledTotal)} settled on ${fmtUSD(data.variance.overall.estimateTotal)}`}
              positive={data.variance.overall.variancePct >= 0}
            />
            <KpiCard
              icon={<Target className="h-4 w-4" />}
              label="Supplement win rate"
              primary={fmtPct(data.supplements.overall.approvalRate)}
              secondary={`${fmtUSD(data.supplements.overall.approvedTotal)} of ${fmtUSD(data.supplements.overall.requestedTotal)} approved`}
            />
            <KpiCard
              icon={<DollarSign className="h-4 w-4" />}
              label="Outstanding AR"
              primary={fmtUSD(data.agingAR.buckets.totalOutstanding)}
              secondary={`>90d: ${fmtUSD(data.agingAR.buckets.d90plus)}`}
              positive={data.agingAR.buckets.d90plus === 0}
            />
            <KpiCard
              icon={<Users className="h-4 w-4" />}
              label="Lead → job conversion"
              primary={fmtPct(data.conversion.rate)}
              secondary={`${data.conversion.converted} of ${data.conversion.leads} leads`}
            />
            <KpiCard
              icon={<Activity className="h-4 w-4" />}
              label="Median job margin"
              primary={fmtPct(data.margin.median)}
              secondary={`p10 ${fmtPct(data.margin.p10)} · p90 ${fmtPct(data.margin.p90)} · n=${data.margin.count}`}
              positive={data.margin.median >= 20}
            />
            <KpiCard
              icon={<TrendingUp className="h-4 w-4" />}
              label="Supplement $ recovered"
              primary={fmtPct(data.supplements.overall.winRateAmount)}
              secondary={`${fmtUSD(data.supplements.overall.approvedTotal)} recovered`}
            />
          </div>

          {/* ── Aging AR ────────────────────────────────────────── */}
          <Card>
            <CardHeader><CardTitle>Aging AR</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <AgingCell label="0–30 days" value={data.agingAR.buckets.d0_30} tone="green" />
                <AgingCell label="31–60 days" value={data.agingAR.buckets.d31_60} tone="yellow" />
                <AgingCell label="61–90 days" value={data.agingAR.buckets.d61_90} tone="orange" />
                <AgingCell label="90+ days" value={data.agingAR.buckets.d90plus} tone="red" />
              </div>
            </CardContent>
          </Card>

          {/* ── Estimate variance by carrier ───────────────────── */}
          <Card>
            <CardHeader><CardTitle>Estimate → settled variance by carrier</CardTitle></CardHeader>
            <CardContent>
              {data.variance.byCarrier.length === 0 ? (
                <p className="text-sm text-muted-foreground">No settled supplements in this window.</p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.variance.byCarrier}>
                      <XAxis dataKey="carrier" tick={{ fontSize: 12 }} />
                      <YAxis tickFormatter={(v: number) => `${v.toFixed(0)}%`} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                      <Bar dataKey="variancePct">
                        {data.variance.byCarrier.map((c: any, i: number) => (
                          <Cell key={i} fill={c.variancePct >= 0 ? "hsl(142, 76%, 36%)" : "hsl(0, 84%, 60%)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Supplement win rate ────────────────────────────── */}
          <Card>
            <CardHeader><CardTitle>Supplement win rate by carrier</CardTitle></CardHeader>
            <CardContent>
              {data.supplements.byCarrier.length === 0 ? (
                <p className="text-sm text-muted-foreground">No supplements filed in this window.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left border-b">
                      <tr>
                        <th className="p-2">Carrier</th>
                        <th className="p-2 text-right">Filed</th>
                        <th className="p-2 text-right">Approval rate</th>
                        <th className="p-2 text-right">Requested</th>
                        <th className="p-2 text-right">Approved</th>
                        <th className="p-2 text-right">$ recovered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.supplements.byCarrier.map((c: any) => (
                        <tr key={c.carrier} className="border-b">
                          <td className="p-2 font-medium">{c.carrier}</td>
                          <td className="p-2 text-right">{c.count}</td>
                          <td className="p-2 text-right">{fmtPct(c.approvalRate)}</td>
                          <td className="p-2 text-right">{fmtUSD(c.requested)}</td>
                          <td className="p-2 text-right">{fmtUSD(c.approved)}</td>
                          <td className="p-2 text-right">{fmtPct(c.winRateAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Tech productivity ──────────────────────────────── */}
          <Card>
            <CardHeader><CardTitle>Tech productivity leaderboard</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left border-b">
                    <tr>
                      <th className="p-2">Employee</th>
                      <th className="p-2">Role</th>
                      <th className="p-2 text-right">Photos</th>
                      <th className="p-2 text-right">Notes</th>
                      <th className="p-2 text-right">Jobs closed</th>
                      <th className="p-2 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.techProductivity.map((t: any) => (
                      <tr key={t.id} className="border-b">
                        <td className="p-2 font-medium">{t.name}</td>
                        <td className="p-2"><Badge variant="outline">{t.role}</Badge></td>
                        <td className="p-2 text-right">{t.photos}</td>
                        <td className="p-2 text-right">{t.notes}</td>
                        <td className="p-2 text-right">{t.jobsClosed}</td>
                        <td className="p-2 text-right font-semibold">{t.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Score = photos + notes×2 + jobs closed×5.
              </p>
            </CardContent>
          </Card>

          {/* ── Lead conversion by source ──────────────────────── */}
          <Card>
            <CardHeader><CardTitle>Lead conversion by source</CardTitle></CardHeader>
            <CardContent>
              {data.conversion.bySource.length === 0 ? (
                <p className="text-sm text-muted-foreground">No leads in this window.</p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.conversion.bySource}>
                      <XAxis dataKey="source" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="leads" fill="hsl(217, 91%, 60%)" name="Leads" />
                      <Bar dataKey="converted" fill="hsl(142, 76%, 36%)" name="Converted" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Job margin distribution ────────────────────────── */}
          <Card>
            <CardHeader><CardTitle>Job margin distribution</CardTitle></CardHeader>
            <CardContent>
              {data.margin.count === 0 ? (
                <p className="text-sm text-muted-foreground">No closed jobs in this window.</p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.margin.distribution}>
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="hsl(262, 83%, 58%)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ── UI atoms ─────────────────────────────────────────────────────────
function KpiCard({ icon, label, primary, secondary, positive }: {
  icon: React.ReactNode;
  label: string;
  primary: string;
  secondary?: string;
  positive?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${positive === false ? "text-red-600" : positive === true ? "text-emerald-600" : ""}`}>
          {primary}
        </div>
        {secondary && <p className="text-xs text-muted-foreground mt-1">{secondary}</p>}
      </CardContent>
    </Card>
  );
}

function AgingCell({ label, value, tone }: { label: string; value: number; tone: "green" | "yellow" | "orange" | "red" }) {
  const toneClass = {
    green: "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20",
    yellow: "border-amber-200 bg-amber-50 dark:bg-amber-950/20",
    orange: "border-orange-200 bg-orange-50 dark:bg-orange-950/20",
    red: "border-red-200 bg-red-50 dark:bg-red-950/20",
  }[tone];
  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{fmtUSD(value)}</div>
    </div>
  );
}
