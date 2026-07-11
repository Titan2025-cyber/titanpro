import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  Package, Wrench, CheckCircle2, AlertTriangle, Plus, Trash2,
  ArrowRightCircle, ArrowLeftCircle, History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Types
interface Equipment {
  id: number;
  name: string;
  category: string;
  model: string;
  serialNumber: string;
  dailyRate: number;
  status: "available" | "deployed" | "maintenance";
  currentJobId?: number | null;
  currentJobNumber?: string | null;
  notes?: string | null;
}

interface Job {
  id: number;
  jobNumber: string;
  address?: string;
}

interface EquipmentDeployment {
  id: number;
  equipmentId: number;
  equipmentName: string;
  jobId: number;
  jobNumber: string;
  deployedAt: string;
  returnedAt?: string | null;
  daysOut?: number | null;
  billedAmount?: number | null;
  notes?: string | null;
}

// Constants
const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "dehumidifier", label: "Dehumidifier" },
  { value: "air_mover", label: "Air Mover" },
  { value: "air_scrubber", label: "Air Scrubber" },
  { value: "hepa", label: "HEPA" },
  { value: "moisture_meter", label: "Moisture Meter" },
  { value: "other", label: "Other" },
];

const CATEGORY_OPTIONS = CATEGORIES.filter((c) => c.value !== "all");

const SEED_NAMES = [
  "LGR Dehumidifier", "Dri-Eaz Dehumidifier", "Air Mover",
  "HEPA Air Scrubber", "Moisture Meter", "Thermal Hygrometer", "Extraction Unit",
];

// Helpers
function statusBadge(status: string) {
  if (status === "available")
    return <Badge className="bg-green-100 text-green-800 border-green-200 border">Available</Badge>;
  if (status === "deployed")
    return <Badge className="bg-orange-100 text-orange-800 border-orange-200 border">Deployed</Badge>;
  return <Badge className="bg-red-100 text-[hsl(var(--titan-red))] border-red-200 border">Maintenance</Badge>;
}

function calcDaysOut(deployedAt: string, returnedAt?: string | null): number {
  const start = new Date(deployedAt).getTime();
  const end = returnedAt ? new Date(returnedAt).getTime() : Date.now();
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

function fmt(n: number | null | undefined) {
  return (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Add Equipment Dialog
function AddEquipmentDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", category: "", model: "", serialNumber: "", dailyRate: "", notes: "",
  });

  const create = useMutation({
    mutationFn: (data: object) => apiRequest("POST", "/api/equipment", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Equipment added" });
      setOpen(false);
      setForm({ name: "", category: "", model: "", serialNumber: "", dailyRate: "", notes: "" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    create.mutate({
      name: form.name, category: form.category, model: form.model,
      serialNumber: form.serialNumber, dailyRate: parseFloat(form.dailyRate) || 0, notes: form.notes,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue)/0.85)] text-white" data-testid="add-equipment-btn">
          <Plus className="w-4 h-4 mr-2" /> Add Equipment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Equipment</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 pt-2">
          <div>
            <Label htmlFor="eq-name">Name</Label>
            <Input id="eq-name" data-testid="eq-name-input" placeholder={SEED_NAMES[0]}
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <Label htmlFor="eq-category">Category</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })} required>
              <SelectTrigger id="eq-category" data-testid="eq-category-select">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="eq-model">Model</Label>
              <Input id="eq-model" data-testid="eq-model-input" value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="eq-serial">Serial #</Label>
              <Input id="eq-serial" data-testid="eq-serial-input" value={form.serialNumber}
                onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
            </div>
          </div>
          <div>
            <Label htmlFor="eq-rate">Daily Rate ($)</Label>
            <Input id="eq-rate" data-testid="eq-rate-input" type="number" min="0" step="0.01"
              placeholder="0.00" value={form.dailyRate}
              onChange={(e) => setForm({ ...form, dailyRate: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="eq-notes">Notes</Label>
            <Textarea id="eq-notes" data-testid="eq-notes-input" rows={2} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" data-testid="eq-submit-btn" disabled={create.isPending}
              className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue)/0.85)] text-white">
              {create.isPending ? "Saving…" : "Add Equipment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Deploy Dialog
function DeployDialog({ equipment, jobs }: { equipment: Equipment; jobs: Job[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState("");
  const [deployedAt, setDeployedAt] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");

  const deploy = useMutation({
    mutationFn: (data: object) =>
      apiRequest("POST", `/api/equipment/${equipment.id}/deploy`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment-deployments"] });
      toast({ title: `${equipment.name} deployed` });
      setOpen(false);
      setJobId("");
      setNotes("");
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!jobId) return;
    deploy.mutate({ jobId: parseInt(jobId), deployedAt, notes });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"
          className="border-orange-300 text-orange-700 hover:bg-orange-50"
          data-testid={`deploy-btn-${equipment.id}`}>
          <ArrowRightCircle className="w-3.5 h-3.5 mr-1" /> Deploy
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Deploy {equipment.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 pt-2">
          <div>
            <Label htmlFor="deploy-job">Job</Label>
            <Select value={jobId} onValueChange={setJobId} required>
              <SelectTrigger id="deploy-job" data-testid="deploy-job-select">
                <SelectValue placeholder="Select job" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={String(j.id)}>
                    {j.jobNumber}{j.address ? ` — ${j.address}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="deploy-date">Deployed Date</Label>
            <Input id="deploy-date" data-testid="deploy-date-input" type="date"
              value={deployedAt} onChange={(e) => setDeployedAt(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="deploy-notes">Notes</Label>
            <Textarea id="deploy-notes" data-testid="deploy-notes-input" rows={2}
              value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" data-testid="deploy-submit-btn"
              disabled={deploy.isPending || !jobId}
              className="bg-orange-500 hover:bg-orange-600 text-white">
              {deploy.isPending ? "Deploying…" : "Deploy"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Equipment Card
function EquipmentCard({ equipment, jobs }: { equipment: Equipment; jobs: Job[] }) {
  const { toast } = useToast();

  const returnEquip = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/equipment/${equipment.id}/return`, {
        returnedAt: new Date().toISOString(),
      }),
    onSuccess: async (res) => {
      const data = await res.json().catch(() => null);
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment-deployments"] });
      const daysOut = data?.daysOut ?? "—";
      const billed = data?.billedAmount != null ? fmt(data.billedAmount) : "—";
      toast({
        title: `${equipment.name} returned`,
        description: `${daysOut} days out · billed ${billed}`,
      });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteEquip = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/equipment/${equipment.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment"] });
      toast({ title: "Equipment deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card className="border hover:shadow-md transition-shadow" data-testid={`equipment-card-${equipment.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{equipment.name}</span>
              {statusBadge(equipment.status)}
            </div>
            <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
              {equipment.model && <div>Model: {equipment.model}</div>}
              {equipment.serialNumber && <div>S/N: {equipment.serialNumber}</div>}
              <div className="font-medium text-foreground">{fmt(equipment.dailyRate)}/day</div>
              {equipment.status === "deployed" && equipment.currentJobNumber && (
                <div className="flex items-center gap-1 text-orange-700">
                  <ArrowRightCircle className="w-3 h-3" /> Job: {equipment.currentJobNumber}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            {equipment.status === "available" && (
              <DeployDialog equipment={equipment} jobs={jobs} />
            )}
            {equipment.status === "deployed" && (
              <Button size="sm" variant="outline"
                className="border-green-300 text-green-700 hover:bg-green-50"
                onClick={() => returnEquip.mutate()} disabled={returnEquip.isPending}
                data-testid={`return-btn-${equipment.id}`}>
                <ArrowLeftCircle className="w-3.5 h-3.5 mr-1" />
                {returnEquip.isPending ? "Returning…" : "Return"}
              </Button>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost"
                  className="text-destructive hover:bg-red-50 hover:text-destructive"
                  data-testid={`delete-equipment-btn-${equipment.id}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {equipment.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove the equipment and its history.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => deleteEquip.mutate()}
                    data-testid={`confirm-delete-equipment-${equipment.id}`}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Deployment History
function DeploymentHistory() {
  const { data: deployments = [], isLoading } = useQuery<EquipmentDeployment[]>({
    queryKey: ["/api/equipment-deployments"],
  });

  if (isLoading)
    return <div className="p-6 text-muted-foreground text-sm">Loading…</div>;

  if (deployments.length === 0)
    return (
      <div className="py-12 text-center text-muted-foreground text-sm" data-testid="empty-history">
        No deployment history yet.
      </div>
    );

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table data-testid="deployment-history-table">
        <TableHeader>
          <TableRow>
            <TableHead>Equipment</TableHead>
            <TableHead>Job #</TableHead>
            <TableHead>Deployed</TableHead>
            <TableHead>Returned</TableHead>
            <TableHead className="text-right">Days Out</TableHead>
            <TableHead className="text-right">Billed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deployments.map((d) => {
            const daysOut = d.daysOut ?? (d.deployedAt ? calcDaysOut(d.deployedAt, d.returnedAt) : "—");
            const billed = d.billedAmount != null ? fmt(d.billedAmount) : "—";
            return (
              <TableRow key={d.id} data-testid={`deployment-row-${d.id}`}>
                <TableCell className="font-medium">{d.equipmentName}</TableCell>
                <TableCell>{d.jobNumber}</TableCell>
                <TableCell>{d.deployedAt ? new Date(d.deployedAt).toLocaleDateString() : "—"}</TableCell>
                <TableCell>
                  {d.returnedAt
                    ? new Date(d.returnedAt).toLocaleDateString()
                    : <Badge className="bg-orange-100 text-orange-800 border-orange-200 border text-xs">Active</Badge>}
                </TableCell>
                <TableCell className="text-right">{daysOut}</TableCell>
                <TableCell className="text-right">{billed}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// Main Page
export default function Equipment() {
  const [categoryFilter, setCategoryFilter] = useState("all");

  const { data: allEquipment = [], isLoading } = useQuery<Equipment[]>({
    queryKey: ["/api/equipment"],
  });

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
  });

  const total = allEquipment.length;
  const deployed = allEquipment.filter((e) => e.status === "deployed").length;
  const available = allEquipment.filter((e) => e.status === "available").length;
  const maintenance = allEquipment.filter((e) => e.status === "maintenance").length;

  const filtered =
    categoryFilter === "all"
      ? allEquipment
      : allEquipment.filter((e) => e.category === categoryFilter);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wrench className="w-6 h-6 text-[hsl(var(--titan-blue))]" />
            Equipment
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Track, deploy, and return restoration equipment
          </p>
        </div>
        <AddEquipmentDialog />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card data-testid="stat-total">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50">
              <Package className="w-5 h-5 text-[hsl(var(--titan-blue))]" />
            </div>
            <div>
              <div className="text-2xl font-bold">{total}</div>
              <div className="text-xs text-muted-foreground">Total Equipment</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-deployed">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-50">
              <ArrowRightCircle className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{deployed}</div>
              <div className="text-xs text-muted-foreground">Deployed</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-available">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-50">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{available}</div>
              <div className="text-xs text-muted-foreground">Available</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="stat-maintenance">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-50">
              <AlertTriangle className="w-5 h-5 text-[hsl(var(--titan-red))]" />
            </div>
            <div>
              <div className="text-2xl font-bold">{maintenance}</div>
              <div className="text-xs text-muted-foreground">In Maintenance</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="equipment">
        <TabsList data-testid="main-tabs">
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
          <TabsTrigger value="history">
            <History className="w-3.5 h-3.5 mr-1" /> Deployment History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="equipment" className="mt-4">
          {/* Category Filter Buttons */}
          <div className="flex flex-wrap gap-2 mb-4" data-testid="category-filter">
            {CATEGORIES.map((cat) => (
              <Button
                key={cat.value}
                variant={categoryFilter === cat.value ? "default" : "outline"}
                size="sm"
                onClick={() => setCategoryFilter(cat.value)}
                data-testid={`category-tab-${cat.value}`}
                className={
                  categoryFilter === cat.value
                    ? "bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue)/0.85)] text-white"
                    : ""
                }
              >
                {cat.label}
              </Button>
            ))}
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-28 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground" data-testid="empty-equipment">
              <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <div className="text-sm">No equipment in this category.</div>
              <div className="text-xs mt-1">Add equipment using the button above.</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="equipment-grid">
              {filtered.map((eq) => (
                <EquipmentCard key={eq.id} equipment={eq} jobs={jobs} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <DeploymentHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
}
