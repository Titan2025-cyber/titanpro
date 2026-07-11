import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Clock, MapPin, User, TrendingDown } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  mitigation: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  drying: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  reconstruction: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
};

const LOSS_ICONS: Record<string, string> = {
  water: "💧", fire: "🔥", mold: "🍄", storm: "⛈️", biohazard: "☣️", reconstruction: "🏗️",
};

function AgeBadge({ days }: { days: number }) {
  if (days >= 30) return (
    <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 font-bold">
      <AlertTriangle className="w-3 h-3 mr-1" />{days}d stuck
    </Badge>
  );
  if (days >= 14) return (
    <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
      {days}d stuck
    </Badge>
  );
  return (
    <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">
      {days}d stuck
    </Badge>
  );
}

export default function JobAgeAlerts() {
  const [threshold, setThreshold] = useState<number>(7);
  const [inputVal, setInputVal] = useState<string>("7");

  const { data: alerts = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/job-age-alerts", threshold],
    queryFn: () => apiRequest("GET", `/api/job-age-alerts?days=${threshold}`).then(r => r.json()),
  });

  const critical = alerts.filter((a: any) => (a.stuckDays || 0) >= 30).length;
  const warning = alerts.filter((a: any) => (a.stuckDays || 0) >= 14 && (a.stuckDays || 0) < 30).length;
  const watch = alerts.filter((a: any) => (a.stuckDays || 0) < 14).length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingDown className="w-6 h-6 text-[hsl(var(--titan-red))]" />
          <div>
            <h1 className="text-xl font-bold">Job Age Alerts</h1>
            <p className="text-sm text-muted-foreground">Jobs stuck in the same stage too long</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Flag after</Label>
          <Input
            type="number"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            className="h-8 w-16 text-center"
            min={1}
            max={365}
            data-testid="input-threshold"
          />
          <Label className="text-xs text-muted-foreground">days</Label>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => { const n = Number(inputVal); if (n > 0) { setThreshold(n); refetch(); } }}
            data-testid="button-apply-threshold"
          >
            Apply
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Critical (30+ days)</p>
            <p className="text-2xl font-bold mt-1 text-red-600" data-testid="text-critical-count">{critical}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Warning (14–29 days)</p>
            <p className="text-2xl font-bold mt-1 text-orange-600" data-testid="text-warning-count">{warning}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Watch ({threshold}–13 days)</p>
            <p className="text-2xl font-bold mt-1 text-yellow-600" data-testid="text-watch-count">{watch}</p>
          </CardContent>
        </Card>
      </div>

      {/* Alert List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Stale Jobs — {alerts.length} flagged (stuck {threshold}+ days)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : alerts.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No stale jobs</p>
              <p className="text-sm mt-1">All active jobs have had recent stage activity</p>
            </div>
          ) : (
            <div className="divide-y">
              {alerts.map((alert: any) => (
                <Link key={alert.id} href={`/jobs/${alert.id}`}>
                  <div className="p-4 hover:bg-muted/30 transition-colors cursor-pointer" data-testid={`row-alert-${alert.id}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{LOSS_ICONS[alert.loss_type] || "📋"}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-sm">{alert.job_number || `#${alert.id}`}</p>
                            <Badge className={STATUS_COLORS[alert.status] || "bg-muted text-muted-foreground"}>
                              {alert.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3" /> {alert.address || "No address"}
                          </p>
                          {alert.assigned_tech && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <User className="w-3 h-3" /> {alert.assigned_tech}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <AgeBadge days={alert.stuckDays} />
                        {alert.insurance_carrier && (
                          <p className="text-xs text-muted-foreground mt-1">{alert.insurance_carrier}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        "Stuck days" = time since the most recent stage milestone date. Click any job to open it.
      </p>
    </div>
  );
}
