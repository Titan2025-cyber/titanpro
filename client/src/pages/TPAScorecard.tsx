import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { Plus, AlertTriangle, CheckCircle, Minus, ShieldCheck, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function TPAScorecard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [showMetric, setShowMetric] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", carrier: "", thresholdResponseHrs: "2", thresholdCycleDays: "30", thresholdCsatMin: "4.0", thresholdDocPct: "95" });
  const [metricForm, setMetricForm] = useState({ jobId: "", responseHrs: "", cycleDays: "", csatScore: "", docComplete: false, disputed: false, notes: "" });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", carrier: "", thresholdResponseHrs: "2", thresholdCycleDays: "30", thresholdCsatMin: "4.0", thresholdDocPct: "95" });

  const { data: scorecard = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/reports/tpa-scorecard"], queryFn: () => apiRequest("/api/reports/tpa-scorecard").then(r => r.json()) });
  const { data: programs = [] } = useQuery<any[]>({ queryKey: ["/api/tpa-programs"], queryFn: () => apiRequest("/api/tpa-programs").then(r => r.json()) });

  const addProgram = useMutation({
    mutationFn: (data: any) => apiRequest("/api/tpa-programs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/tpa-programs"] }); qc.invalidateQueries({ queryKey: ["/api/reports/tpa-scorecard"] }); setShowAdd(false); },
  });
  const deleteProgram = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/tpa-programs/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/tpa-programs"] }); qc.invalidateQueries({ queryKey: ["/api/reports/tpa-scorecard"] }); },
  });
  const updateProgram = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest(`/api/tpa-programs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/tpa-programs"] });
      qc.invalidateQueries({ queryKey: ["/api/reports/tpa-scorecard"] });
      setEditingId(null);
      toast({ title: "TPA Program updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const addMetric = useMutation({
    mutationFn: ({ programId, data }: any) => apiRequest(`/api/tpa-programs/${programId}/metrics`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/reports/tpa-scorecard"] }); setShowMetric(null); },
  });

  const openEdit = (prog: any) => {
    setEditForm({
      name: prog.name || "", carrier: prog.carrier || "",
      thresholdResponseHrs: prog.thresholds?.responseHrs != null ? String(prog.thresholds.responseHrs) : "2",
      thresholdCycleDays: prog.thresholds?.cycleDays != null ? String(prog.thresholds.cycleDays) : "30",
      thresholdCsatMin: prog.thresholds?.csatMin != null ? String(prog.thresholds.csatMin) : "4.0",
      thresholdDocPct: prog.thresholds?.docPct != null ? String(prog.thresholds.docPct) : "95",
    });
    setEditingId(prog.id);
  };

  const trafficColor = (light: string) => light === "green" ? "text-green-500" : light === "yellow" ? "text-yellow-500" : "text-red-500";
  const TrafficIcon = ({ light }: { light: string }) => light === "green" ? <CheckCircle className="w-5 h-5 text-green-500" /> : light === "yellow" ? <Minus className="w-5 h-5 text-yellow-500" /> : <AlertTriangle className="w-5 h-5 text-red-500" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">TPA Program Scorecard</h1>
          <p className="text-sm text-muted-foreground">Real-time performance against program thresholds — stay on every preferred vendor list</p>
        </div>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white" data-testid="button-add-program"><Plus className="w-4 h-4 mr-2" />Add TPA Program</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add TPA Program</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Program name (e.g. Contractor Connection)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-program-name" />
              <Input placeholder="Carrier / TPA company" value={form.carrier} onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))} data-testid="input-carrier" />
              <div className="grid grid-cols-2 gap-2">
                <div><p className="text-xs text-muted-foreground mb-1">Max Response (hrs)</p><Input type="number" value={form.thresholdResponseHrs} onChange={e => setForm(f => ({ ...f, thresholdResponseHrs: e.target.value }))} /></div>
                <div><p className="text-xs text-muted-foreground mb-1">Max Cycle (days)</p><Input type="number" value={form.thresholdCycleDays} onChange={e => setForm(f => ({ ...f, thresholdCycleDays: e.target.value }))} /></div>
                <div><p className="text-xs text-muted-foreground mb-1">Min CSAT (0–5)</p><Input type="number" step="0.1" value={form.thresholdCsatMin} onChange={e => setForm(f => ({ ...f, thresholdCsatMin: e.target.value }))} /></div>
                <div><p className="text-xs text-muted-foreground mb-1">Min Doc % complete</p><Input type="number" value={form.thresholdDocPct} onChange={e => setForm(f => ({ ...f, thresholdDocPct: e.target.value }))} /></div>
              </div>
              <Button className="w-full bg-[hsl(var(--titan-blue))] text-white" onClick={() => addProgram.mutate({ name: form.name, carrier: form.carrier, thresholdResponseHrs: Number(form.thresholdResponseHrs), thresholdCycleDays: Number(form.thresholdCycleDays), thresholdCsatMin: Number(form.thresholdCsatMin), thresholdDocPct: Number(form.thresholdDocPct) })} disabled={!form.name} data-testid="button-save-program">Save Program</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : scorecard.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No TPA programs configured</p>
            <p className="text-sm text-muted-foreground mt-1">Add your TPA programs (Contractor Connection, Alacrity, USAA, etc.) to start tracking performance</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {scorecard.map((prog: any) => (
            <Card key={prog.id} className={`border-l-4 ${prog.trafficLight === "green" ? "border-l-green-500" : prog.trafficLight === "yellow" ? "border-l-yellow-500" : "border-l-red-500"}`} data-testid={`card-tpa-${prog.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2"><TrafficIcon light={prog.trafficLight} />{prog.name}</CardTitle>
                    {prog.carrier && <p className="text-xs text-muted-foreground mt-0.5">{prog.carrier}</p>}
                  </div>
                  <div className="text-right">
                    <span className={`text-2xl font-bold ${trafficColor(prog.trafficLight)}`}>{prog.score ?? "—"}%</span>
                    <p className="text-xs text-muted-foreground">{prog.jobCount} jobs</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {prog.score == null ? (
                  <p className="text-xs text-muted-foreground italic">No metrics recorded yet</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Response Time", value: prog.metrics?.avgResponseHrs != null ? `${prog.metrics.avgResponseHrs}hr avg` : "—", ok: prog.checks?.responseOk, threshold: `≤${prog.thresholds?.responseHrs}hr` },
                      { label: "Cycle Time", value: prog.metrics?.avgCycleDays != null ? `${prog.metrics.avgCycleDays}d avg` : "—", ok: prog.checks?.cycleOk, threshold: `≤${prog.thresholds?.cycleDays}d` },
                      { label: "CSAT Score", value: prog.metrics?.avgCsat != null ? `${prog.metrics.avgCsat}/5` : "—", ok: prog.checks?.csatOk, threshold: `≥${prog.thresholds?.csatMin}` },
                      { label: "Doc Complete", value: prog.metrics?.docPct != null ? `${prog.metrics.docPct}%` : "—", ok: prog.checks?.docOk, threshold: `≥${prog.thresholds?.docPct}%` },
                    ].map((m, i) => (
                      <div key={i} className="bg-muted/40 rounded p-2">
                        <p className="text-xs text-muted-foreground">{m.label} <span className="text-xs opacity-60">(thresh: {m.threshold})</span></p>
                        <div className="flex items-center gap-1 mt-0.5">
                          {m.ok ? <CheckCircle className="w-3 h-3 text-green-500" /> : <AlertTriangle className="w-3 h-3 text-red-500" />}
                          <span className={`text-sm font-medium ${m.ok ? "text-green-600" : "text-red-500"}`}>{m.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <Dialog open={showMetric === prog.id} onOpenChange={v => setShowMetric(v ? prog.id : null)}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="flex-1" data-testid={`button-add-metric-${prog.id}`}><Plus className="w-3 h-3 mr-1" />Add Job Metric</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Log Job Metric — {prog.name}</DialogTitle></DialogHeader>
                      <div className="space-y-3">
                        <Input placeholder="Job ID" value={metricForm.jobId} onChange={e => setMetricForm(f => ({ ...f, jobId: e.target.value }))} />
                        <div className="grid grid-cols-2 gap-2">
                          <div><p className="text-xs text-muted-foreground mb-1">Response Time (hrs)</p><Input type="number" step="0.5" value={metricForm.responseHrs} onChange={e => setMetricForm(f => ({ ...f, responseHrs: e.target.value }))} /></div>
                          <div><p className="text-xs text-muted-foreground mb-1">Cycle Days</p><Input type="number" value={metricForm.cycleDays} onChange={e => setMetricForm(f => ({ ...f, cycleDays: e.target.value }))} /></div>
                          <div><p className="text-xs text-muted-foreground mb-1">CSAT Score (1–5)</p><Input type="number" step="0.5" min="1" max="5" value={metricForm.csatScore} onChange={e => setMetricForm(f => ({ ...f, csatScore: e.target.value }))} /></div>
                        </div>
                        <div className="flex gap-4 text-sm">
                          <label className="flex items-center gap-2"><input type="checkbox" checked={metricForm.docComplete} onChange={e => setMetricForm(f => ({ ...f, docComplete: e.target.checked }))} />Documentation complete</label>
                          <label className="flex items-center gap-2"><input type="checkbox" checked={metricForm.disputed} onChange={e => setMetricForm(f => ({ ...f, disputed: e.target.checked }))} />Disputed</label>
                        </div>
                        <Input placeholder="Notes (optional)" value={metricForm.notes} onChange={e => setMetricForm(f => ({ ...f, notes: e.target.value }))} />
                        <Button className="w-full bg-[hsl(var(--titan-blue))] text-white" onClick={() => addMetric.mutate({ programId: prog.id, data: { jobId: Number(metricForm.jobId), responseHrs: Number(metricForm.responseHrs) || undefined, cycleDays: Number(metricForm.cycleDays) || undefined, csatScore: Number(metricForm.csatScore) || undefined, docComplete: metricForm.docComplete, disputed: metricForm.disputed, notes: metricForm.notes } })} disabled={!metricForm.jobId}>Save Metric</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                  <Button variant="outline" size="sm" onClick={() => openEdit(prog)} data-testid={`button-edit-tpa-programs-${prog.id}`}><Pencil className="w-3 h-3" /></Button>
                  <Button variant="outline" size="sm" onClick={() => deleteProgram.mutate(prog.id)} className="text-red-500 hover:text-red-700" data-testid={`button-delete-tpa-${prog.id}`}>Delete</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editingId !== null} onOpenChange={v => { if (!v) setEditingId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit TPA Program</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Program name (e.g. Contractor Connection)" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} data-testid={`input-name-${editingId}`} />
            <Input placeholder="Carrier / TPA company" value={editForm.carrier} onChange={e => setEditForm(f => ({ ...f, carrier: e.target.value }))} data-testid={`input-carrier-${editingId}`} />
            <div className="grid grid-cols-2 gap-2">
              <div><p className="text-xs text-muted-foreground mb-1">Max Response (hrs)</p><Input type="number" value={editForm.thresholdResponseHrs} onChange={e => setEditForm(f => ({ ...f, thresholdResponseHrs: e.target.value }))} data-testid={`input-thresholdResponseHrs-${editingId}`} /></div>
              <div><p className="text-xs text-muted-foreground mb-1">Max Cycle (days)</p><Input type="number" value={editForm.thresholdCycleDays} onChange={e => setEditForm(f => ({ ...f, thresholdCycleDays: e.target.value }))} data-testid={`input-thresholdCycleDays-${editingId}`} /></div>
              <div><p className="text-xs text-muted-foreground mb-1">Min CSAT (0–5)</p><Input type="number" step="0.1" value={editForm.thresholdCsatMin} onChange={e => setEditForm(f => ({ ...f, thresholdCsatMin: e.target.value }))} data-testid={`input-thresholdCsatMin-${editingId}`} /></div>
              <div><p className="text-xs text-muted-foreground mb-1">Min Doc % complete</p><Input type="number" value={editForm.thresholdDocPct} onChange={e => setEditForm(f => ({ ...f, thresholdDocPct: e.target.value }))} data-testid={`input-thresholdDocPct-${editingId}`} /></div>
            </div>
            <Button
              className="w-full bg-[hsl(var(--titan-blue))] text-white"
              onClick={() => editingId !== null && updateProgram.mutate({ id: editingId, data: { name: editForm.name, carrier: editForm.carrier, thresholdResponseHrs: Number(editForm.thresholdResponseHrs), thresholdCycleDays: Number(editForm.thresholdCycleDays), thresholdCsatMin: Number(editForm.thresholdCsatMin), thresholdDocPct: Number(editForm.thresholdDocPct) } })}
              disabled={!editForm.name || updateProgram.isPending}
              data-testid={`button-save-tpa-programs-${editingId}`}
            >
              {updateProgram.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
