import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { Plus, Wrench, AlertTriangle, CheckCircle, TrendingUp, Package } from "lucide-react";

const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function EquipmentLifecycle() {
  const qc = useQueryClient();
  const [showMaint, setShowMaint] = useState<number | null>(null);
  const [maintForm, setMaintForm] = useState({ maintenanceType: "filter_replace", performedBy: "", cost: "", runtimeHoursAtService: "", notes: "", nextServiceDue: "" });

  const { data: roiData = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/reports/equipment-roi"], queryFn: () => apiRequest("/api/reports/equipment-roi").then(r => r.json()) });
  const { data: maintLogs = [] } = useQuery<any[]>({ queryKey: ["/api/equipment-maintenance"], queryFn: () => apiRequest("/api/equipment-maintenance").then(r => r.json()) });

  const addMaint = useMutation({
    mutationFn: (d: any) => apiRequest("/api/equipment-maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/equipment-maintenance"] }); qc.invalidateQueries({ queryKey: ["/api/reports/equipment-roi"] }); setShowMaint(null); },
  });

  const alertUnits = roiData.filter(e => e.serviceAlert === "overdue" || e.serviceAlert === "due_soon");
  const totalRevenue = roiData.reduce((s: number, e: any) => s + (e.revenueGenerated || 0), 0);
  const totalCost = roiData.reduce((s: number, e: any) => s + (e.totalCost || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Equipment Lifecycle & ROI</h1>
        <p className="text-sm text-muted-foreground">Per-unit revenue, maintenance costs, predictive service alerts, and fleet optimization</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-[hsl(var(--titan-blue))]">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Fleet Units</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-fleet-count">{roiData.length}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Revenue Generated</p>
            <p className="text-2xl font-bold mt-1 text-green-600" data-testid="text-total-revenue">{fmt(totalRevenue)}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Service Alerts</p>
            <p className="text-2xl font-bold mt-1 text-red-500" data-testid="text-service-alerts">{alertUnits.length}</p>
            <p className="text-xs text-muted-foreground">units need service</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-[hsl(var(--titan-red))]">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Cost Basis</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-total-cost">{fmt(totalCost)}</p>
          </CardContent>
        </Card>
      </div>

      {alertUnits.length > 0 && (
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-5 h-5 text-orange-500" /><span className="font-semibold text-orange-700 dark:text-orange-400">Service Alerts</span></div>
          <div className="space-y-1">
            {alertUnits.map(e => (
              <p key={e.id} className="text-sm text-orange-700 dark:text-orange-400">• {e.name} — {e.serviceAlert === "overdue" ? "⚠️ SERVICE OVERDUE" : "Service due soon"} ({e.runtimeHours}hr / {e.serviceIntervalHrs}hr interval)</p>
            ))}
          </div>
        </div>
      )}

      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : roiData.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No equipment in fleet</p>
          <p className="text-sm text-muted-foreground mt-1">Add equipment in the Equipment module to track lifecycle, ROI, and maintenance</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {roiData.map((e: any) => (
            <Card key={e.id} className={`border-l-4 ${e.serviceAlert === "overdue" ? "border-l-red-500" : e.serviceAlert === "due_soon" ? "border-l-orange-500" : e.roi > 0 ? "border-l-green-500" : "border-l-muted"}`} data-testid={`card-equipment-${e.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold">{e.name}</p>
                      <Badge variant="outline" className="text-xs">{e.category}</Badge>
                      <Badge variant={e.status === "available" ? "secondary" : e.status === "deployed" ? "outline" : "destructive"} className="text-xs">{e.status}</Badge>
                      {e.serviceAlert && <Badge variant={e.serviceAlert === "overdue" ? "destructive" : "outline"} className="text-xs">{e.serviceAlert === "overdue" ? "⚠️ Service Overdue" : "Service Due Soon"}</Badge>}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
                      <div className="bg-muted/40 rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">Revenue</p>
                        <p className="font-bold text-sm text-green-600">{fmt(e.revenueGenerated || 0)}</p>
                      </div>
                      <div className="bg-muted/40 rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">Total Cost</p>
                        <p className="font-bold text-sm">{fmt(e.totalCost || 0)}</p>
                      </div>
                      <div className="bg-muted/40 rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">ROI</p>
                        <p className={`font-bold text-sm ${e.roi == null ? "" : e.roi > 0 ? "text-green-600" : "text-red-500"}`}>{e.roi != null ? `${e.roi}%` : "N/A"}</p>
                      </div>
                      <div className="bg-muted/40 rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">Utilization</p>
                        <p className={`font-bold text-sm ${e.utilizationRate < 20 ? "text-red-500" : e.utilizationRate > 60 ? "text-green-600" : ""}`}>{e.utilizationRate}%</p>
                      </div>
                      <div className="bg-muted/40 rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">Runtime Hrs</p>
                        <p className="font-bold text-sm">{e.runtimeHours || 0}</p>
                      </div>
                    </div>

                    {e.recommendation && (
                      <div className="mt-2 p-2 rounded text-xs bg-yellow-50 dark:bg-yellow-900/10 text-yellow-800 dark:text-yellow-400 flex items-start gap-1">
                        <TrendingUp className="w-3 h-3 shrink-0 mt-0.5" />{e.recommendation}
                      </div>
                    )}
                  </div>

                  <Dialog open={showMaint === e.id} onOpenChange={v => setShowMaint(v ? e.id : null)}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="shrink-0" data-testid={`button-maint-${e.id}`}><Wrench className="w-3 h-3 mr-1" />Log Service</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Log Maintenance — {e.name}</DialogTitle></DialogHeader>
                      <div className="space-y-3">
                        <Select value={maintForm.maintenanceType} onValueChange={v => setMaintForm(f => ({ ...f, maintenanceType: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="filter_replace">Filter Replacement</SelectItem>
                            <SelectItem value="inspection">Inspection</SelectItem>
                            <SelectItem value="repair">Repair</SelectItem>
                            <SelectItem value="calibration">Calibration</SelectItem>
                            <SelectItem value="service">Full Service</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input placeholder="Performed by" value={maintForm.performedBy} onChange={ev => setMaintForm(f => ({ ...f, performedBy: ev.target.value }))} />
                        <div className="grid grid-cols-2 gap-2">
                          <div><p className="text-xs text-muted-foreground mb-1">Cost ($)</p><Input type="number" value={maintForm.cost} onChange={ev => setMaintForm(f => ({ ...f, cost: ev.target.value }))} /></div>
                          <div><p className="text-xs text-muted-foreground mb-1">Runtime hrs at service</p><Input type="number" value={maintForm.runtimeHoursAtService} onChange={ev => setMaintForm(f => ({ ...f, runtimeHoursAtService: ev.target.value }))} /></div>
                        </div>
                        <Input placeholder="Notes" value={maintForm.notes} onChange={ev => setMaintForm(f => ({ ...f, notes: ev.target.value }))} />
                        <div><p className="text-xs text-muted-foreground mb-1">Next service due date</p><Input type="date" value={maintForm.nextServiceDue} onChange={ev => setMaintForm(f => ({ ...f, nextServiceDue: ev.target.value }))} /></div>
                        <Button className="w-full bg-[hsl(var(--titan-blue))] text-white" onClick={() => addMaint.mutate({ equipmentId: e.id, maintenanceType: maintForm.maintenanceType, performedBy: maintForm.performedBy || undefined, cost: Number(maintForm.cost) || 0, runtimeHoursAtService: maintForm.runtimeHoursAtService ? Number(maintForm.runtimeHoursAtService) : undefined, notes: maintForm.notes || undefined, nextServiceDue: maintForm.nextServiceDue || undefined })}>Save Service Log</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
