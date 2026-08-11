import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Radio, Plus, FileText, MapPin, Camera, Activity, CheckCircle, Clock, AlertTriangle } from "lucide-react";
import { fmtDateShort } from "@/lib/dates";

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  in_flight: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  processing: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  complete: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  cancelled: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

const DAMAGE_LEVELS = ["minor", "moderate", "severe", "total_loss"];
const DAMAGE_COLORS: Record<string, string> = {
  minor: "text-green-600 dark:text-green-400",
  moderate: "text-yellow-600 dark:text-yellow-400",
  severe: "text-orange-600 dark:text-orange-400",
  total_loss: "text-red-600 dark:text-red-400",
};

export default function DroneLiDAR() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState({
    jobId: "",
    pilotName: "",
    flightDate: "",
    status: "scheduled",
    altitudeFt: "",
    areaSqFt: "",
    damageLevel: "",
    roofCondition: "",
    structuralNotes: "",
    lidarPointCloud: "",
    reportUrl: "",
    notes: "",
  });

  const { data: assessments = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/drone-assessments"],
    queryFn: () => apiRequest("/api/drone-assessments").then((r) => r.json()),
  });

  const { data: jobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest("/api/drone-assessments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drone-assessments"] });
      setOpen(false);
      resetForm();
      toast({ title: "Drone assessment created" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) =>
      apiRequest(`/api/drone-assessments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drone-assessments"] });
      toast({ title: "Assessment updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/drone-assessments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drone-assessments"] });
      setSelected(null);
      toast({ title: "Assessment deleted" });
    },
  });

  function resetForm() {
    setForm({ jobId: "", pilotName: "", flightDate: "", status: "scheduled", altitudeFt: "", areaSqFt: "", damageLevel: "", roofCondition: "", structuralNotes: "", lidarPointCloud: "", reportUrl: "", notes: "" });
  }

  function handleCreate() {
    createMutation.mutate({
      jobId: form.jobId ? parseInt(form.jobId) : null,
      pilotName: form.pilotName,
      flightDate: form.flightDate || null,
      status: form.status,
      altitudeFt: form.altitudeFt ? parseInt(form.altitudeFt) : null,
      areaSqFt: form.areaSqFt ? parseFloat(form.areaSqFt) : null,
      damageLevel: form.damageLevel || null,
      roofCondition: form.roofCondition,
      structuralNotes: form.structuralNotes,
      lidarPointCloud: form.lidarPointCloud,
      reportUrl: form.reportUrl,
      notes: form.notes,
    });
  }

  const complete = assessments.filter((a: any) => a.status === "complete").length;
  const severe = assessments.filter((a: any) => ["severe", "total_loss"].includes(a.damageLevel)).length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Radio className="w-5 h-5 text-primary" /> Drone + LiDAR Assessment
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Schedule drone flights, log LiDAR scan data, and generate damage assessment reports per job</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-assessment"><Plus className="w-4 h-4 mr-2" />New Assessment</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New Drone / LiDAR Assessment</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2 max-h-[70vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Linked Job</Label>
                  <Select value={form.jobId} onValueChange={(v) => setForm({ ...form, jobId: v })}>
                    <SelectTrigger data-testid="select-job"><SelectValue placeholder="Select job" /></SelectTrigger>
                    <SelectContent>
                      {jobs.map((j: any) => (
                        <SelectItem key={j.id} value={String(j.id)}>TP-{String(j.id).padStart(4, "0")} — {j.address?.substring(0, 20) || "N/A"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.keys(STATUS_COLORS).map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ").toUpperCase()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Pilot / Operator</Label>
                  <Input data-testid="input-pilot" value={form.pilotName} onChange={(e) => setForm({ ...form, pilotName: e.target.value })} placeholder="Pilot name" />
                </div>
                <div>
                  <Label>Flight Date</Label>
                  <Input data-testid="input-flight-date" type="date" value={form.flightDate} onChange={(e) => setForm({ ...form, flightDate: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Altitude (ft)</Label>
                  <Input data-testid="input-altitude" type="number" value={form.altitudeFt} onChange={(e) => setForm({ ...form, altitudeFt: e.target.value })} placeholder="e.g., 400" />
                </div>
                <div>
                  <Label>Area Scanned (SF)</Label>
                  <Input data-testid="input-area" type="number" value={form.areaSqFt} onChange={(e) => setForm({ ...form, areaSqFt: e.target.value })} placeholder="e.g., 2400" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Damage Level</Label>
                  <Select value={form.damageLevel} onValueChange={(v) => setForm({ ...form, damageLevel: v })}>
                    <SelectTrigger data-testid="select-damage-level"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {DAMAGE_LEVELS.map((d) => <SelectItem key={d} value={d}>{d.replace("_", " ").toUpperCase()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Roof Condition</Label>
                  <Input data-testid="input-roof" value={form.roofCondition} onChange={(e) => setForm({ ...form, roofCondition: e.target.value })} placeholder="e.g., 40% damaged" />
                </div>
              </div>
              <div>
                <Label>LiDAR Point Cloud URL / Reference</Label>
                <Input data-testid="input-lidar" value={form.lidarPointCloud} onChange={(e) => setForm({ ...form, lidarPointCloud: e.target.value })} placeholder="Link to 3D scan data" />
              </div>
              <div>
                <Label>Report URL</Label>
                <Input data-testid="input-report-url" value={form.reportUrl} onChange={(e) => setForm({ ...form, reportUrl: e.target.value })} placeholder="Link to PDF report" />
              </div>
              <div>
                <Label>Structural Notes</Label>
                <Textarea data-testid="input-structural" value={form.structuralNotes} onChange={(e) => setForm({ ...form, structuralNotes: e.target.value })} rows={2} placeholder="Structural observations from flight..." />
              </div>
              <div>
                <Label>Additional Notes</Label>
                <Textarea data-testid="input-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
              </div>
              <Button data-testid="button-create-assessment" className="w-full" onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Assessment"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Flights", value: assessments.length, icon: Radio, color: "text-primary" },
          { label: "Completed", value: complete, icon: CheckCircle, color: "text-green-500" },
          { label: "Scheduled", value: assessments.filter((a: any) => a.status === "scheduled").length, icon: Clock, color: "text-yellow-500" },
          { label: "Severe Damage", value: severe, icon: AlertTriangle, color: "text-red-500" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <kpi.icon className={`w-8 h-8 ${kpi.color}`} />
              <div><p className="text-xs text-muted-foreground">{kpi.label}</p><p className="text-lg font-bold" data-testid={`kpi-${kpi.label.toLowerCase().replace(/ /g, "-")}`}>{kpi.value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Assessments List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading assessments...</div>
      ) : assessments.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Radio className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-30" />
            <p className="font-semibold text-muted-foreground">No drone assessments yet</p>
            <p className="text-sm text-muted-foreground mt-1">Schedule a drone flight to capture aerial damage documentation for any job</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {assessments.map((a: any) => {
            const job = jobs.find((j: any) => j.id === a.jobId);
            return (
              <Card key={a.id} className="cursor-pointer hover:shadow-md transition-shadow" data-testid={`card-assessment-${a.id}`} onClick={() => setSelected(a)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-sm">DR-{String(a.id).padStart(4, "0")}</span>
                        {job && <span className="text-sm text-muted-foreground">→ TP-{String(job.id).padStart(4, "0")}</span>}
                        <Badge className={STATUS_COLORS[a.status] || ""}>{a.status?.replace("_", " ")}</Badge>
                        {a.damageLevel && (
                          <span className={`text-xs font-semibold ${DAMAGE_COLORS[a.damageLevel] || ""}`}>
                            {a.damageLevel.replace("_", " ").toUpperCase()}
                          </span>
                        )}
                      </div>
                      {job && <p className="text-sm mt-1 flex items-center gap-1 text-muted-foreground"><MapPin className="w-3 h-3" />{job.address}</p>}
                      <div className="flex gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                        {a.pilotName && <span><Camera className="w-3 h-3 inline mr-0.5" />{a.pilotName}</span>}
                        {a.flightDate && <span>Flight: {fmtDateShort(a.flightDate)}</span>}
                        {a.areaSqFt && <span><Activity className="w-3 h-3 inline mr-0.5" />{a.areaSqFt.toLocaleString()} SF scanned</span>}
                      </div>
                      {a.structuralNotes && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{a.structuralNotes}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {a.reportUrl && (
                        <a href={a.reportUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="outline" data-testid={`button-report-${a.id}`}><FileText className="w-3 h-3 mr-1" />Report</Button>
                        </a>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail Dialog */}
      {selected && (
        <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>DR-{String(selected.id).padStart(4, "0")} — Assessment Detail</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Status</Label>
                  <Select defaultValue={selected.status} onValueChange={(v) => updateMutation.mutate({ id: selected.id, data: { status: v } })}>
                    <SelectTrigger data-testid="select-update-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.keys(STATUS_COLORS).map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Damage Level</Label>
                  <Select defaultValue={selected.damageLevel || ""} onValueChange={(v) => updateMutation.mutate({ id: selected.id, data: { damageLevel: v } })}>
                    <SelectTrigger data-testid="select-update-damage"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {DAMAGE_LEVELS.map((d) => <SelectItem key={d} value={d}>{d.replace("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Structural Notes</Label>
                <Textarea
                  data-testid="input-update-structural"
                  defaultValue={selected.structuralNotes || ""}
                  rows={3}
                  onBlur={(e) => updateMutation.mutate({ id: selected.id, data: { structuralNotes: e.target.value } })}
                />
              </div>
              <div>
                <Label>LiDAR Point Cloud URL</Label>
                <Input
                  data-testid="input-update-lidar"
                  defaultValue={selected.lidarPointCloud || ""}
                  onBlur={(e) => updateMutation.mutate({ id: selected.id, data: { lidarPointCloud: e.target.value } })}
                  placeholder="Link to 3D scan data"
                />
              </div>
              <div>
                <Label>Report URL</Label>
                <Input
                  data-testid="input-update-report-url"
                  defaultValue={selected.reportUrl || ""}
                  onBlur={(e) => updateMutation.mutate({ id: selected.id, data: { reportUrl: e.target.value } })}
                  placeholder="Link to PDF report"
                />
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm bg-muted/50 rounded-lg p-3">
                <div><p className="text-xs text-muted-foreground">Altitude</p><p className="font-semibold">{selected.altitudeFt ? `${selected.altitudeFt} ft` : "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Area</p><p className="font-semibold">{selected.areaSqFt ? `${selected.areaSqFt.toLocaleString()} SF` : "—"}</p></div>
                <div><p className="text-xs text-muted-foreground">Pilot</p><p className="font-semibold">{selected.pilotName || "—"}</p></div>
              </div>
              <Button variant="destructive" className="w-full" onClick={() => deleteMutation.mutate(selected.id)} data-testid="button-delete-assessment">
                Delete Assessment
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
