import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wrench, TrendingUp, Clock, AlertCircle } from "lucide-react";

function fmt(n: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n); }

export default function EquipmentROI() {
  const { data: equipment = [], isLoading: eqLoading } = useQuery<any[]>({ queryKey: ["/api/equipment"] });
  const { data: deployments = [], isLoading: depLoading } = useQuery<any[]>({ queryKey: ["/api/equipment-deployments"] });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });

  const isLoading = eqLoading || depLoading;

  // Compute per-equipment utilization metrics
  const equipmentMetrics = equipment.map((eq: any) => {
    const deps = deployments.filter((d: any) => d.equipmentId === eq.id);
    const completedDeps = deps.filter((d: any) => d.returnedAt);
    const activeDeps = deps.filter((d: any) => !d.returnedAt);
    
    const totalDays = completedDeps.reduce((sum: number, d: any) => {
      const start = new Date(d.deployedAt);
      const end = new Date(d.returnedAt);
      return sum + Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    }, 0);

    const totalRevenue = completedDeps.reduce((sum: number, d: any) => sum + (d.dailyRate || eq.dailyRate || 0) * Math.max(1, Math.ceil((new Date(d.returnedAt).getTime() - new Date(d.deployedAt).getTime()) / (1000 * 60 * 60 * 24))), 0);
    const activeDays = activeDeps.reduce((sum: number, d: any) => {
      const start = new Date(d.deployedAt);
      return sum + Math.max(1, Math.ceil((new Date().getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    }, 0);

    const purchaseCost = eq.purchaseCost || 0;
    const roi = purchaseCost > 0 ? ((totalRevenue / purchaseCost) * 100) : null;
    const utilRate = completedDeps.length > 0 ? Math.min(100, Math.round((totalDays / Math.max(1, Math.ceil((new Date().getTime() - new Date(eq.createdAt).getTime()) / (1000 * 60 * 60 * 24)))) * 100)) : 0;

    return { ...eq, totalDays, totalRevenue, activeDays, roi, utilRate, deployCount: deps.length, activeCount: activeDeps.length };
  }).sort((a: any, b: any) => b.totalRevenue - a.totalRevenue);

  const totalRevenue = equipmentMetrics.reduce((s: number, e: any) => s + e.totalRevenue, 0);
  const activeCount = equipmentMetrics.filter((e: any) => e.activeCount > 0).length;
  const idleCount = equipmentMetrics.filter((e: any) => e.activeCount === 0).length;
  const avgROI = equipmentMetrics.filter((e: any) => e.roi !== null).reduce((s: number, e: any, _: any, arr: any[]) => s + e.roi / arr.length, 0);

  if (isLoading) return <div className="p-6"><div className="h-64 bg-muted rounded animate-pulse" /></div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Equipment Utilization & ROI</h1>
        <p className="text-sm text-muted-foreground">Billable days, revenue per unit, and return on investment</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Equipment Revenue</p>
          <p className="text-xl font-bold text-foreground">{fmt(totalRevenue)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Currently Deployed</p>
          <p className="text-xl font-bold text-primary">{activeCount}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Currently Idle</p>
          <p className={`text-xl font-bold ${idleCount > 2 ? "text-yellow-600" : "text-foreground"}`}>{idleCount}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Avg ROI</p>
          <p className="text-xl font-bold text-green-600">{avgROI > 0 ? `${avgROI.toFixed(0)}%` : "—"}</p>
        </CardContent></Card>
      </div>

      {equipmentMetrics.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No equipment records yet. Add equipment in the Equipment module to track utilization.</CardContent></Card>
      ) : (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Per-Unit Performance</CardTitle></CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-3 font-medium">Equipment</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Deployments</th>
                <th className="text-right px-4 py-3 font-medium">Total Days</th>
                <th className="text-right px-4 py-3 font-medium">Revenue</th>
                <th className="text-right px-4 py-3 font-medium">ROI</th>
                <th className="text-right px-4 py-3 font-medium">Util %</th>
              </tr></thead>
              <tbody>
                {equipmentMetrics.map((eq: any) => (
                  <tr key={eq.id} className="border-b hover:bg-muted/20" data-testid={`row-eq-${eq.id}`}>
                    <td className="px-4 py-3 font-medium">{eq.name}</td>
                    <td className="px-4 py-3 text-muted-foreground capitalize">{eq.category || eq.type || "—"}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={eq.activeCount > 0 ? "default" : eq.status === "maintenance" ? "destructive" : "secondary"} className="text-xs">
                        {eq.activeCount > 0 ? `Deployed (${eq.activeDays}d)` : eq.status || "Available"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">{eq.deployCount}</td>
                    <td className="px-4 py-3 text-right">{eq.totalDays}</td>
                    <td className="px-4 py-3 text-right font-semibold">{fmt(eq.totalRevenue)}</td>
                    <td className="px-4 py-3 text-right">
                      {eq.roi !== null ? <span className={eq.roi >= 100 ? "text-green-600 font-semibold" : "text-yellow-600"}>{eq.roi.toFixed(0)}%</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 bg-muted rounded-full h-1.5">
                          <div className="h-1.5 rounded-full bg-primary" style={{ width: `${eq.utilRate}%` }} />
                        </div>
                        <span className="text-xs w-8">{eq.utilRate}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Idle alert */}
      {idleCount > 3 && (
        <Card className="border-yellow-400 bg-yellow-50 dark:bg-yellow-950">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">{idleCount} units currently idle</p>
              <p className="text-xs text-yellow-700 dark:text-yellow-300">Consider reassigning idle equipment to active jobs or contacting neighboring contractors for rental opportunities.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
