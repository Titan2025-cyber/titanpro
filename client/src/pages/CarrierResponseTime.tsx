import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock, TrendingDown, TrendingUp, Award, AlertTriangle, Building2 } from "lucide-react";

function DaysBadge({ days }: { days: number | null }) {
  if (days === null) return <Badge variant="outline" className="text-muted-foreground">No data</Badge>;
  if (days <= 30) return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">{days}d</Badge>;
  if (days <= 60) return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">{days}d</Badge>;
  return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">{days}d</Badge>;
}

function SpeedBar({ days, maxDays }: { days: number | null; maxDays: number }) {
  if (days === null) return <div className="h-2 bg-muted rounded-full" />;
  const pct = Math.min(100, Math.round((days / Math.max(maxDays, 1)) * 100));
  const color = days <= 30 ? "bg-green-500" : days <= 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="h-2 bg-muted rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function CarrierResponseTime() {
  const { data: carriers = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/reports/carrier-response-time"],
    queryFn: () => apiRequest("GET", "/api/reports/carrier-response-time").then(r => r.json()),
  });

  const maxDays = Math.max(...carriers.map((c: any) => c.avgDays ?? 0), 1);
  const sorted = [...carriers].sort((a: any, b: any) => (a.avgDays ?? 999) - (b.avgDays ?? 999));
  const fastest = sorted[0];
  const slowest = sorted[sorted.length - 1];
  const overall = carriers.length > 0
    ? Math.round(carriers.filter((c: any) => c.avgDays !== null).reduce((s: number, c: any) => s + (c.avgDays || 0), 0) / carriers.filter((c: any) => c.avgDays !== null).length)
    : null;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Clock className="w-6 h-6 text-[hsl(var(--titan-blue))]" />
        <div>
          <h1 className="text-xl font-bold">Carrier Response Time</h1>
          <p className="text-sm text-muted-foreground">Average days from invoice to payment by carrier</p>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Avg Overall</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-avg-overall">{overall !== null ? `${overall}d` : "—"}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Fastest Carrier</p>
            <p className="text-sm font-bold mt-1 truncate" data-testid="text-fastest-carrier">{fastest?.carrier || "—"}</p>
            <p className="text-xs text-green-600">{fastest?.avgDays !== null && fastest?.avgDays !== undefined ? `${fastest.avgDays}d avg` : ""}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Slowest Carrier</p>
            <p className="text-sm font-bold mt-1 truncate" data-testid="text-slowest-carrier">{slowest?.carrier || "—"}</p>
            <p className="text-xs text-red-600">{slowest?.avgDays !== null && slowest?.avgDays !== undefined ? `${slowest.avgDays}d avg` : ""}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Carriers Tracked</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-carriers-tracked">{carriers.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Carrier Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4" /> Carrier Payment Speed Rankings
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : carriers.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No carrier payment data yet</p>
              <p className="text-sm mt-1">Data appears once invoices are paid</p>
            </div>
          ) : (
            <div className="divide-y">
              {sorted.map((carrier: any, i: number) => (
                <div key={carrier.carrier} className="p-4 hover:bg-muted/30 transition-colors" data-testid={`row-carrier-${i}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-muted-foreground w-5">{i + 1}.</span>
                      <div>
                        <p className="font-semibold text-sm">{carrier.carrier}</p>
                        <p className="text-xs text-muted-foreground">{carrier.jobs} job{carrier.jobs !== 1 ? "s" : ""} · {carrier.paid} paid</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {i === 0 && carrier.avgDays !== null && (
                        <Award className="w-4 h-4 text-yellow-500" />
                      )}
                      <DaysBadge days={carrier.avgDays} />
                    </div>
                  </div>
                  <SpeedBar days={carrier.avgDays} maxDays={maxDays} />
                  {carrier.avgDays !== null && (
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3 text-green-500" />
                        Best: {carrier.fastest}d
                      </span>
                      <span className="flex items-center gap-1">
                        <TrendingDown className="w-3 h-3 text-red-500" />
                        Worst: {carrier.slowest}d
                      </span>
                      {carrier.adjusters?.length > 0 && (
                        <span>Adjusters: {carrier.adjusters.map((a: any) => a.name).join(", ")}</span>
                      )}
                    </div>
                  )}
                  {carrier.avgDays === null && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-yellow-500" /> No completed payments yet for this carrier
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Response time = days from invoice creation to payment received. Only includes fully paid invoices.
      </p>
    </div>
  );
}
