import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { AlertTriangle, Plus, CheckCircle, FileText, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const DEVIATION_TYPES = [
  { value: "equipment_reduction", label: "Equipment Reduction" },
  { value: "drying_time", label: "Shortened Drying Time" },
  { value: "material_scope", label: "Material Scope Reduction" },
  { value: "category_downgrade", label: "Category Downgrade (Cat 2→1, etc.)" },
  { value: "class_dispute", label: "Loss Class Dispute" },
  { value: "moisture_target", label: "Moisture Target Dispute" },
  { value: "containment", label: "Containment Requirements" },
  { value: "ppe_protocol", label: "PPE / Safety Protocol" },
  { value: "other", label: "Other Deviation" },
];

const IICRC_REFS: Record<string, string> = {
  equipment_reduction: "IICRC S500 §12.3: Equipment placement per psychrometric calculation — cannot be arbitrarily reduced",
  drying_time: "IICRC S500 §14.1: Drying must continue until structural materials reach dry standard WME",
  material_scope: "IICRC S500 §11.2: All affected materials must be addressed per loss category",
  category_downgrade: "IICRC S500 §7: Category/Class determined by source and contamination level at time of inspection",
  class_dispute: "IICRC S500 §8: Loss class (1-4) determined by amount and type of material affected",
  moisture_target: "IICRC S500 §14: WME ≤16% wood, ≤12% drywall; deviations must be documented",
  containment: "IICRC S520 §8: Containment required for Category 2/3 and mold losses",
  ppe_protocol: "IICRC S500 §6: PPE requirements based on contamination category",
  other: "IICRC S500: General standard compliance required for all restoration work",
};

export default function IICRCDeviationLog() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    job_id: "", deviation_type: "", description: "", iicrc_section: "",
    justification: "", approved_by: "", requires_reinspection: false,
  });

  const { data: deviations = [], isLoading } = useQuery({
    queryKey: ["/api/iicrc-deviations"],
    queryFn: () => apiRequest("/api/iicrc-deviations").then(r => r.json()),
  });
  const { data: jobs = [] } = useQuery({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("/api/jobs").then(r => r.json()) });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/iicrc-deviations", { method: "POST", body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/iicrc-deviations"] });
      setShowForm(false);
      setForm({ job_id: "", deviation_type: "", description: "", iicrc_section: "", justification: "", approved_by: "", requires_reinspection: false });
      toast({ title: "Deviation logged successfully" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest(`/api/iicrc-deviations/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/iicrc-deviations"] }),
  });

  const getJob = (jobId: number) => jobs.find((j: any) => j.id === jobId);

  const handleSubmit = () => {
    if (!form.job_id || !form.deviation_type || !form.description) {
      toast({ title: "Fill required fields", variant: "destructive" });
      return;
    }
    const iicrcRef = IICRC_REFS[form.deviation_type] || "";
    createMutation.mutate({
      ...form,
      job_id: Number(form.job_id),
      iicrc_section: form.iicrc_section || iicrcRef,
      status: "pending",
      created_at: new Date().toISOString(),
    });
  };

  const statusColor = (s: string) => ({
    pending: "bg-yellow-100 text-yellow-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    resolved: "bg-blue-100 text-blue-700",
  }[s] || "bg-gray-100 text-gray-700");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-orange-500" />
            IICRC S500/S520 Deviation Log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Document and justify any deviations from IICRC standards — required for carrier disputes
          </p>
        </div>
        <Button onClick={() => setShowForm(true)} className="bg-red-600 hover:bg-red-700 text-white" data-testid="button-log-deviation">
          <Plus className="h-4 w-4 mr-2" /> Log Deviation
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {["pending", "approved", "rejected", "resolved"].map(status => (
          <Card key={status}>
            <CardContent className="pt-3 pb-3">
              <p className="text-xs text-muted-foreground capitalize">{status}</p>
              <p className="text-xl font-bold">{deviations.filter((d: any) => d.status === status).length}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* IICRC Standard Reference */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold text-blue-800 flex items-center gap-2"><FileText className="h-4 w-4" />IICRC Quick Reference</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Object.entries(IICRC_REFS).slice(0, 6).map(([key, val]) => (
            <p key={key} className="text-xs text-blue-700">{val}</p>
          ))}
        </CardContent>
      </Card>

      {/* Deviation List */}
      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded animate-pulse" />)}</div>
      ) : deviations.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
          <p className="font-semibold">No deviations logged</p>
          <p className="text-sm text-muted-foreground">All work is proceeding per IICRC standards</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {deviations.map((dev: any) => {
            const job = getJob(dev.job_id);
            return (
              <Card key={dev.id} className="border-l-4 border-l-orange-400" data-testid={`card-deviation-${dev.id}`}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <span className="font-bold text-sm">{job?.job_number || `Job #${dev.job_id}`}</span>
                        <Badge className={`text-xs ${statusColor(dev.status)}`}>{dev.status}</Badge>
                        <Badge variant="outline" className="text-xs">{DEVIATION_TYPES.find(d => d.value === dev.deviation_type)?.label || dev.deviation_type}</Badge>
                        {dev.requires_reinspection && <Badge className="text-xs bg-red-100 text-red-700">Re-inspection Required</Badge>}
                      </div>
                      {job && <p className="text-xs text-muted-foreground">{job.address}</p>}
                      <p className="text-sm text-foreground mt-1">{dev.description}</p>
                      {dev.iicrc_section && <p className="text-xs text-blue-600 mt-1 italic">{dev.iicrc_section}</p>}
                      {dev.justification && (
                        <div className="mt-2 p-2 bg-slate-50 rounded text-xs">
                          <span className="font-medium">Justification: </span>{dev.justification}
                        </div>
                      )}
                      {dev.approved_by && <p className="text-xs text-muted-foreground mt-1">Approved by: {dev.approved_by}</p>}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {dev.status === "pending" && (
                        <>
                          <Button size="sm" variant="outline" className="text-xs text-green-700 border-green-300" onClick={() => updateMutation.mutate({ id: dev.id, status: "approved" })} data-testid={`button-approve-${dev.id}`}>Approve</Button>
                          <Button size="sm" variant="outline" className="text-xs text-red-700 border-red-300" onClick={() => updateMutation.mutate({ id: dev.id, status: "rejected" })} data-testid={`button-reject-${dev.id}`}>Reject</Button>
                        </>
                      )}
                      {dev.status === "approved" && (
                        <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: dev.id, status: "resolved" })} data-testid={`button-resolve-${dev.id}`}>Mark Resolved</Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* New Deviation Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Log IICRC Deviation</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Job *</label>
              <Select value={form.job_id} onValueChange={v => setForm(f => ({ ...f, job_id: v }))}>
                <SelectTrigger data-testid="select-job"><SelectValue placeholder="Select job..." /></SelectTrigger>
                <SelectContent>{jobs.map((j: any) => <SelectItem key={j.id} value={String(j.id)}>{j.job_number} — {j.address?.slice(0,35)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Deviation Type *</label>
              <Select value={form.deviation_type} onValueChange={v => setForm(f => ({ ...f, deviation_type: v }))}>
                <SelectTrigger data-testid="select-type"><SelectValue placeholder="Select type..." /></SelectTrigger>
                <SelectContent>{DEVIATION_TYPES.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
              </Select>
              {form.deviation_type && <p className="text-xs text-blue-600 mt-1 italic">{IICRC_REFS[form.deviation_type]}</p>}
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Description of Deviation *</label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What standard is being deviated from and why?" className="text-sm h-20" data-testid="textarea-description" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Justification</label>
              <Textarea value={form.justification} onChange={e => setForm(f => ({ ...f, justification: e.target.value }))} placeholder="Client request, structural limitation, carrier direction, etc." className="text-sm h-16" data-testid="textarea-justification" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Approved By</label>
              <Input value={form.approved_by} onChange={e => setForm(f => ({ ...f, approved_by: e.target.value }))} placeholder="Supervisor / owner name" data-testid="input-approved-by" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="reinspect" checked={form.requires_reinspection} onChange={e => setForm(f => ({ ...f, requires_reinspection: e.target.checked }))} data-testid="checkbox-reinspection" />
              <label htmlFor="reinspect" className="text-sm">Requires re-inspection</label>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSubmit} disabled={createMutation.isPending} className="flex-1 bg-red-600 hover:bg-red-700 text-white" data-testid="button-submit">
                {createMutation.isPending ? "Logging..." : "Log Deviation"}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)} data-testid="button-cancel">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
