import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Plus, Wrench, AlertTriangle, CheckCircle, TrendingUp, Package, Trash2, Pencil } from "lucide-react";

const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const MAINT_TYPES = [
  { value: "filter_replace", label: "Filter Replacement" },
  { value: "inspection", label: "Inspection" },
  { value: "repair", label: "Repair" },
  { value: "calibration", label: "Calibration" },
  { value: "service", label: "Full Service" },
];

function EditMaintenanceDialog({ log, onDone }: { log: any; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    maintenanceType: log.maintenance_type ?? log.maintenanceType ?? "filter_replace",
    performedBy: log.performed_by ?? log.performedBy ?? "",
    cost: log.cost != null ? String(log.cost) : "",
    runtimeHoursAtService: log.runtime_hours_at_service != null ? String(log.runtime_hours_at_service) : (log.runtimeHoursAtService != null ? String(log.runtimeHoursAtService) : ""),
    notes: log.notes ?? "",
    nextServiceDue: (log.next_service_due ?? log.nextServiceDue ?? "").slice(0, 10),
    status: log.status ?? "",
  });

  const m = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/equipment-maintenance/${log.id}`, data),
    onSuccess: () => { toast({ title: "Saved" }); onDone(); setOpen(false); },
    onError: (e: any) => toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-edit-equipment-maintenance-${log.id}`}>
          <Pencil className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Maintenance Log</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Select value={form.maintenanceType} onValueChange={v => setForm(f => ({ ...f, maintenanceType: v }))}>
            <SelectTrigger data-testid={`select-maintenance-type-${log.id}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {MAINT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Performed by" value={form.performedBy} onChange={ev => setForm(f => ({ ...f, performedBy: ev.target.value }))} data-testid={`input-performedBy-${log.id}`} />
          <div className="grid grid-cols-2 gap-2">
            <div><p className="text-xs text-muted-foreground mb-1">Cost ($)</p><Input type="number" value={form.cost} onChange={ev => setForm(f => ({ ...f, cost: ev.target.value }))} data-testid={`input-cost-${log.id}`} /></div>
            <div><p className="text-xs text-muted-foreground mb-1">Runtime hrs at service</p><Input type="number" value={form.runtimeHoursAtService} onChange={ev => setForm(f => ({ ...f, runtimeHoursAtService: ev.target.value }))} data-testid={`input-runtimeHoursAtService-${log.id}`} /></div>
          </div>
          <Input placeholder="Notes" value={form.notes} onChange={ev => setForm(f => ({ ...f, notes: ev.target.value }))} data-testid={`input-notes-${log.id}`} />
          <div><p className="text-xs text-muted-foreground mb-1">Next service due date</p><Input type="date" value={form.nextServiceDue} onChange={ev => setForm(f => ({ ...f, nextServiceDue: ev.target.value }))} data-testid={`input-nextServiceDue-${log.id}`} /></div>
          <Input placeholder="Status" value={form.status} onChange={ev => setForm(f => ({ ...f, status: ev.target.value }))} data-testid={`input-status-${log.id}`} />
          <Button
            className="w-full bg-[hsl(var(--titan-blue))] text-white"
            disabled={m.isPending}
            data-testid={`button-save-equipment-maintenance-${log.id}`}
            onClick={() => m.mutate({
              maintenanceType: form.maintenanceType,
              performedBy: form.performedBy || undefined,
              cost: Number(form.cost) || 0,
              runtimeHoursAtService: form.runtimeHoursAtService ? Number(form.runtimeHoursAtService) : undefined,
              notes: form.notes || undefined,
              nextServiceDue: form.nextServiceDue || undefined,
              status: form.status || undefined,
            })}
          >
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteMaintenanceBtn({ id, label, onDone }: { id: number; label: string; onDone: () => void }) {
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/equipment-maintenance/${id}`),
    onSuccess: () => { toast({ title: "Deleted" }); onDone(); },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-delete-equipment-maintenance-${id}`}>
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this record?</AlertDialogTitle>
          <AlertDialogDescription>
            {label ? `"${label}" ` : ""}This permanently removes the record and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => m.mutate()} data-testid={`button-confirm-delete-equipment-maintenance-${id}`}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

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

                {maintLogs.filter((l: any) => (l.equipment_id ?? l.equipmentId) === e.id).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Maintenance Log</p>
                    {maintLogs.filter((l: any) => (l.equipment_id ?? l.equipmentId) === e.id).map((l: any) => (
                      <div key={l.id} className="flex items-center justify-between text-xs py-1" data-testid={`row-maintenance-${l.id}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs">{(l.maintenance_type ?? l.maintenanceType ?? "").replace(/_/g, " ")}</Badge>
                          {l.performed_by && <span className="text-muted-foreground">by {l.performed_by}</span>}
                          {l.cost != null && <span className="font-medium">{fmt(l.cost)}</span>}
                          {l.notes && <span className="text-muted-foreground">{l.notes}</span>}
                        </div>
                        <div className="flex items-center gap-1">
                          <EditMaintenanceDialog log={l} onDone={() => { qc.invalidateQueries({ queryKey: ["/api/equipment-maintenance"] }); qc.invalidateQueries({ queryKey: ["/api/reports/equipment-roi"] }); }} />
                          <DeleteMaintenanceBtn id={l.id} label={(l.maintenance_type ?? l.maintenanceType ?? "").replace(/_/g, " ")} onDone={() => { qc.invalidateQueries({ queryKey: ["/api/equipment-maintenance"] }); qc.invalidateQueries({ queryKey: ["/api/reports/equipment-roi"] }); }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
