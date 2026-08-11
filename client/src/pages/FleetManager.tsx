import { useState } from "react";
import { UserSelect } from "@/components/UserSelect";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Truck, Plus, Wrench, AlertTriangle, CheckCircle2,
  DollarSign, Calendar, Gauge, Edit2, Trash2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtDateShort } from "@/lib/dates";

interface Vehicle {
  id: number; name: string; make: string; model: string; year: number;
  vin: string; licensePlate: string; color: string; status: string;
  assignedTo: string; currentMileage: number; notes: string;
  lastService?: string; upcomingCount?: number; overdueCount?: number; totalMaintenanceCost?: number;
}

interface MaintenanceLog {
  id: number; vehicleId: number; type: string; description: string;
  performedBy: string; mileageAtService: number; cost: number;
  invoiceNumber: string; serviceDate: string; nextServiceMileage: number;
  nextServiceDate: string; status: string; notes: string;
}

const SERVICE_TYPES = [
  { value: "oil_change", label: "Oil Change" },
  { value: "tire_rotation", label: "Tire Rotation" },
  { value: "brake_service", label: "Brake Service" },
  { value: "inspection", label: "State Inspection" },
  { value: "transmission", label: "Transmission Service" },
  { value: "ac_service", label: "A/C Service" },
  { value: "battery", label: "Battery Replacement" },
  { value: "repair", label: "Repair" },
  { value: "other", label: "Other" },
];

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  in_shop: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  retired: "bg-gray-100 text-gray-500 dark:bg-gray-800",
};

function VehicleCard({ vehicle, onAddService, onEdit }: { vehicle: Vehicle; onAddService: (v: Vehicle) => void; onEdit: (v: Vehicle) => void }) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-blue-600" />
              <h3 className="font-bold">{vehicle.name}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[vehicle.status]}`}>{vehicle.status.replace("_", " ")}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")}
              {vehicle.color && ` · ${vehicle.color}`}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onEdit(vehicle)}><Edit2 className="w-3.5 h-3.5" /></Button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          {vehicle.licensePlate && <span>🔖 {vehicle.licensePlate}</span>}
          {vehicle.assignedTo && <span>👤 {vehicle.assignedTo}</span>}
          <span className="flex items-center gap-1"><Gauge className="w-3 h-3" />{vehicle.currentMileage?.toLocaleString()} mi</span>
          {vehicle.lastService && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />Last: {fmtDateShort(vehicle.lastService)}</span>}
        </div>

        <div className="flex items-center gap-3 pt-1">
          {(vehicle.overdueCount || 0) > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
              <AlertTriangle className="w-3.5 h-3.5" />{vehicle.overdueCount} overdue
            </span>
          )}
          {(vehicle.upcomingCount || 0) > 0 && !(vehicle.overdueCount) && (
            <span className="flex items-center gap-1 text-xs text-yellow-600 font-medium">
              <Calendar className="w-3.5 h-3.5" />{vehicle.upcomingCount} upcoming
            </span>
          )}
          {!vehicle.overdueCount && !vehicle.upcomingCount && (
            <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="w-3.5 h-3.5" />Up to date</span>
          )}
          <span className="text-xs text-muted-foreground ml-auto">${(vehicle.totalMaintenanceCost || 0).toLocaleString()} total cost</span>
        </div>

        <Button size="sm" onClick={() => onAddService(vehicle)} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs">
          <Wrench className="w-3.5 h-3.5 mr-1.5" />Log Service / Repair
        </Button>
      </CardContent>
    </Card>
  );
}

export default function FleetManager() {
  const { toast } = useToast();
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null);
  const [serviceTarget, setServiceTarget] = useState<Vehicle | null>(null);
  const [filterVehicleId, setFilterVehicleId] = useState("all");

  const emptyVehicle = { name: "", make: "", model: "", year: new Date().getFullYear(), vin: "", licensePlate: "", color: "", status: "active", assignedTo: "", currentMileage: 0, notes: "" };
  const emptyService = { vehicleId: "", type: "oil_change", description: "", performedBy: "", mileageAtService: "", cost: "", invoiceNumber: "", serviceDate: new Date().toISOString().split("T")[0], nextServiceMileage: "", nextServiceDate: "", status: "completed", notes: "" };

  const [vForm, setVForm] = useState<any>(emptyVehicle);
  const [sForm, setSForm] = useState<any>(emptyService);

  const { data: fleet = [], isLoading: fleetLoading } = useQuery<Vehicle[]>({
    queryKey: ["/api/vehicles/fleet-summary"],
    queryFn: () => apiRequest("/api/vehicles/fleet-summary").then(r => r.json()),
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<MaintenanceLog[]>({
    queryKey: ["/api/vehicle-maintenance", filterVehicleId],
    queryFn: () => {
      const params = filterVehicleId !== "all" ? `?vehicleId=${filterVehicleId}` : "";
      return apiRequest(`/api/vehicle-maintenance${params}`).then(r => r.json());
    },
  });

  const createVehicle = useMutation({
    mutationFn: (data: any) => apiRequest("/api/vehicles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/vehicles/fleet-summary"] }); setVehicleOpen(false); setVForm(emptyVehicle); toast({ title: "Vehicle Added" }); },
  });

  const updateVehicle = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/vehicles/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/vehicles/fleet-summary"] }); setVehicleOpen(false); setEditVehicle(null); toast({ title: "Vehicle Updated" }); },
  });

  const deleteVehicle = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/vehicles/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/vehicles/fleet-summary"] }),
  });

  const logService = useMutation({
    mutationFn: (data: any) => apiRequest("/api/vehicle-maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-maintenance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/fleet-summary"] });
      setServiceOpen(false);
      setSForm(emptyService);
      toast({ title: "Service Logged" });
    },
  });

  const openAddService = (v: Vehicle) => {
    setServiceTarget(v);
    setSForm({ ...emptyService, vehicleId: String(v.id), mileageAtService: v.currentMileage });
    setServiceOpen(true);
  };

  const openEditVehicle = (v: Vehicle) => {
    setEditVehicle(v);
    setVForm({ name: v.name, make: v.make, model: v.model, year: v.year, vin: v.vin, licensePlate: v.licensePlate, color: v.color, status: v.status, assignedTo: v.assignedTo, currentMileage: v.currentMileage, notes: v.notes });
    setVehicleOpen(true);
  };

  const totalFleetCost = fleet.reduce((s, v) => s + (v.totalMaintenanceCost || 0), 0);
  const overdueTotal = fleet.reduce((s, v) => s + (v.overdueCount || 0), 0);
  const activeCount = fleet.filter(v => v.status === "active").length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Truck className="w-7 h-7 text-blue-600" />
          <div>
            <h1 className="text-xl font-bold">Fleet Manager</h1>
            <p className="text-sm text-muted-foreground">Vehicle maintenance tracking, service history, and upcoming repair alerts</p>
          </div>
        </div>
        <Button onClick={() => { setEditVehicle(null); setVForm(emptyVehicle); setVehicleOpen(true); }} className="bg-red-600 hover:bg-red-700 text-white" data-testid="button-add-vehicle">
          <Plus className="w-4 h-4 mr-2" />Add Vehicle
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Active Vehicles</p><p className="text-2xl font-bold text-blue-600">{activeCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Overdue Service</p><p className="text-2xl font-bold text-red-600">{overdueTotal}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Service Logs</p><p className="text-2xl font-bold">{logs.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Fleet Cost</p><p className="text-2xl font-bold text-green-600">${totalFleetCost.toLocaleString()}</p></CardContent></Card>
      </div>

      {overdueTotal > 0 && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-400 font-medium">{overdueTotal} vehicle service(s) are past due. Log service or schedule an appointment to stay compliant.</p>
        </div>
      )}

      <Tabs defaultValue="fleet">
        <TabsList><TabsTrigger value="fleet">Fleet Overview</TabsTrigger><TabsTrigger value="history">Service History</TabsTrigger></TabsList>

        <TabsContent value="fleet" className="pt-4">
          {fleetLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
            </div>
          ) : fleet.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Truck className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="font-medium">No vehicles added yet.</p>
              <p className="text-sm">Click "Add Vehicle" to start tracking your fleet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {fleet.map(v => <VehicleCard key={v.id} vehicle={v} onAddService={openAddService} onEdit={openEditVehicle} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="pt-4">
          <div className="mb-4">
            <Select value={filterVehicleId} onValueChange={setFilterVehicleId}>
              <SelectTrigger className="w-64" data-testid="select-filter-vehicle"><SelectValue placeholder="All vehicles" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Vehicles</SelectItem>
                {fleet.map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Card>
            <CardContent className="p-0">
              {logs.length === 0 ? (
                <p className="text-center text-muted-foreground p-8">No service logs yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b bg-muted/40">
                      <th className="text-left px-4 py-2.5">Vehicle</th>
                      <th className="text-left px-4 py-2.5">Type</th>
                      <th className="text-left px-4 py-2.5">Description</th>
                      <th className="text-left px-4 py-2.5">Date</th>
                      <th className="text-right px-4 py-2.5">Mileage</th>
                      <th className="text-right px-4 py-2.5">Cost</th>
                      <th className="text-left px-4 py-2.5">Next Due</th>
                    </tr></thead>
                    <tbody>
                      {logs.map(log => {
                        const vehicle = fleet.find(v => v.id === log.vehicleId);
                        const stype = SERVICE_TYPES.find(s => s.value === log.type);
                        return (
                          <tr key={log.id} data-testid={`service-log-${log.id}`} className="border-b last:border-0 hover:bg-muted/20">
                            <td className="px-4 py-3 font-medium">{vehicle?.name || `Vehicle #${log.vehicleId}`}</td>
                            <td className="px-4 py-3">
                              <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                {stype?.label || log.type}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{log.description}</td>
                            <td className="px-4 py-3">{fmtDateShort(log.serviceDate)}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs">{log.mileageAtService?.toLocaleString() || "—"}</td>
                            <td className="px-4 py-3 text-right text-green-700 dark:text-green-400 font-medium">${(log.cost || 0).toLocaleString()}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {log.nextServiceDate ? fmtDateShort(log.nextServiceDate) : "—"}
                              {log.nextServiceMileage ? ` / ${log.nextServiceMileage.toLocaleString()} mi` : ""}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add/Edit Vehicle Dialog */}
      <Dialog open={vehicleOpen} onOpenChange={v => { setVehicleOpen(v); if (!v) setEditVehicle(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editVehicle ? "Edit Vehicle" : "Add Vehicle"}</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div><Label>Vehicle Name / Nickname</Label><Input data-testid="input-vehicle-name" value={vForm.name} onChange={e => setVForm((f: any) => ({ ...f, name: e.target.value }))} placeholder='F-250 #1, "Big Blue", Van 3...' /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>Year</Label><Input type="number" value={vForm.year} onChange={e => setVForm((f: any) => ({ ...f, year: parseInt(e.target.value) }))} /></div>
              <div><Label>Make</Label><Input value={vForm.make} onChange={e => setVForm((f: any) => ({ ...f, make: e.target.value }))} placeholder="Ford" /></div>
              <div><Label>Model</Label><Input value={vForm.model} onChange={e => setVForm((f: any) => ({ ...f, model: e.target.value }))} placeholder="F-250" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>License Plate</Label><Input value={vForm.licensePlate} onChange={e => setVForm((f: any) => ({ ...f, licensePlate: e.target.value }))} /></div>
              <div><Label>Color</Label><Input value={vForm.color} onChange={e => setVForm((f: any) => ({ ...f, color: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Assigned To</Label><UserSelect value={vForm.assignedTo} onChange={v => setVForm((f: any) => ({ ...f, assignedTo: v }))} placeholder="Select driver" allowUnassigned testId="select-fleet-assigned" /></div>
              <div><Label>Current Mileage</Label><Input type="number" value={vForm.currentMileage} onChange={e => setVForm((f: any) => ({ ...f, currentMileage: parseInt(e.target.value) }))} /></div>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={vForm.status} onValueChange={v => setVForm((f: any) => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="in_shop">In Shop</SelectItem>
                  <SelectItem value="retired">Retired</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>VIN (optional)</Label><Input value={vForm.vin} onChange={e => setVForm((f: any) => ({ ...f, vin: e.target.value }))} /></div>
            <div><Label>Notes</Label><Textarea value={vForm.notes} onChange={e => setVForm((f: any) => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div className="flex gap-2">
              {editVehicle && (
                <Button variant="outline" className="text-red-600 border-red-200" onClick={() => { deleteVehicle.mutate(editVehicle.id); setVehicleOpen(false); }}>
                  <Trash2 className="w-3.5 h-3.5 mr-1" />Delete
                </Button>
              )}
              <Button onClick={() => editVehicle ? updateVehicle.mutate({ id: editVehicle.id, data: vForm }) : createVehicle.mutate(vForm)} disabled={!vForm.name || createVehicle.isPending || updateVehicle.isPending} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white">
                {editVehicle ? "Save Changes" : "Add Vehicle"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Log Service Dialog */}
      <Dialog open={serviceOpen} onOpenChange={setServiceOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Service — {serviceTarget?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <Label>Service Type</Label>
              <Select value={sForm.type} onValueChange={v => setSForm((f: any) => ({ ...f, type: v }))}>
                <SelectTrigger data-testid="select-service-type"><SelectValue /></SelectTrigger>
                <SelectContent>{SERVICE_TYPES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Description</Label><Input data-testid="input-service-desc" value={sForm.description} onChange={e => setSForm((f: any) => ({ ...f, description: e.target.value }))} placeholder="e.g. Oil change + filter, rotate all 4 tires" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Service Date</Label><Input type="date" value={sForm.serviceDate} onChange={e => setSForm((f: any) => ({ ...f, serviceDate: e.target.value }))} /></div>
              <div><Label>Mileage at Service</Label><Input type="number" value={sForm.mileageAtService} onChange={e => setSForm((f: any) => ({ ...f, mileageAtService: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Cost ($)</Label><Input type="number" value={sForm.cost} onChange={e => setSForm((f: any) => ({ ...f, cost: e.target.value }))} /></div>
              <div><Label>Performed By</Label><Input value={sForm.performedBy} onChange={e => setSForm((f: any) => ({ ...f, performedBy: e.target.value }))} placeholder="Shop name or tech" /></div>
            </div>
            <div><Label>Invoice Number (optional)</Label><Input value={sForm.invoiceNumber} onChange={e => setSForm((f: any) => ({ ...f, invoiceNumber: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Next Service Date</Label><Input type="date" value={sForm.nextServiceDate} onChange={e => setSForm((f: any) => ({ ...f, nextServiceDate: e.target.value }))} /></div>
              <div><Label>Next Service Mileage</Label><Input type="number" value={sForm.nextServiceMileage} onChange={e => setSForm((f: any) => ({ ...f, nextServiceMileage: e.target.value }))} /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={sForm.notes} onChange={e => setSForm((f: any) => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <Button onClick={() => logService.mutate({ ...sForm, vehicleId: parseInt(sForm.vehicleId), mileageAtService: parseInt(sForm.mileageAtService) || null, cost: parseFloat(sForm.cost) || 0, nextServiceMileage: parseInt(sForm.nextServiceMileage) || null })} disabled={!sForm.description || logService.isPending} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
              <Wrench className="w-4 h-4 mr-2" />Log Service
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
