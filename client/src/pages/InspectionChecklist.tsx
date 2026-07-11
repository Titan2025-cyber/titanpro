import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Plus, ClipboardCheck, Droplets, AlertTriangle, CheckCircle } from "lucide-react";

const DEFAULT_CHECKLIST = [
  "Photograph all affected areas before work begins",
  "Document pre-existing damage",
  "Verify water source is shut off",
  "Check for Category 2/3 contamination",
  "Assess structural integrity",
  "Identify affected materials (drywall, flooring, insulation)",
  "Establish drying scope and equipment plan",
  "Review access for equipment placement",
  "Notify insurance carrier of scope",
  "Confirm homeowner signature on Work Authorization",
];

export default function InspectionChecklist() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<string>("");
  const [form, setForm] = useState({
    inspectedBy: "",
    inspectionDate: new Date().toISOString().split("T")[0],
    moistureReadings: [] as any[],
    preExistingDamage: [] as any[],
    checklistItems: DEFAULT_CHECKLIST.map(item => ({ item, checked: false, notes: "" })),
    generalNotes: "",
  });
  const [newReading, setNewReading] = useState({ location: "", reading: "", unit: "%" });
  const [newDamage, setNewDamage] = useState({ area: "", description: "" });

  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });
  const { data: allInspections = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs/0/inspections"],
    queryFn: async () => {
      const results: any[] = [];
      for (const job of (jobs as any[])) {
        const res = await apiRequest("GET", `/api/jobs/${job.id}/inspections`);
        const data = await res.json();
        results.push(...data.map((i: any) => ({ ...i, jobNumber: job.jobNumber, jobAddress: job.address })));
      }
      return results;
    },
    enabled: (jobs as any[]).length > 0,
  });

  const saveMutation = useMutation({
    mutationFn: (d: any) => apiRequest("POST", `/api/jobs/${selectedJob}/inspections`, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/0/inspections"] });
      setOpen(false);
      toast({ title: "Pre-job inspection saved" });
    },
  });

  const toggleItem = (idx: number) => {
    setForm(f => ({ ...f, checklistItems: f.checklistItems.map((ci, i) => i === idx ? { ...ci, checked: !ci.checked } : ci) }));
  };

  const checkedCount = form.checklistItems.filter(ci => ci.checked).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Pre-Job Inspections</h1>
          <p className="text-sm text-muted-foreground">Timestamped site inspections with moisture baseline readings</p>
        </div>
        <Button className="bg-primary text-primary-foreground" onClick={() => setOpen(true)} data-testid="button-new-inspection">
          <Plus className="w-4 h-4 mr-2" /> New Inspection
        </Button>
      </div>

      {(allInspections as any[]).length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No inspections yet. Complete a pre-job inspection before starting work on any job.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {(allInspections as any[]).map((insp: any) => {
            const items = JSON.parse(insp.checklistItems || "[]");
            const readings = JSON.parse(insp.moistureReadings || "[]");
            const checked = items.filter((ci: any) => ci.checked).length;
            return (
              <Card key={insp.id} data-testid={`card-inspection-${insp.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{insp.jobNumber}</p>
                        <Badge variant={insp.status === "complete" ? "default" : "secondary"}>{insp.status}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{insp.jobAddress}</p>
                      <p className="text-xs text-muted-foreground mt-1">Inspected by {insp.inspectedBy} · {insp.inspectionDate}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{checked}/{items.length} items checked</p>
                      {readings.length > 0 && <p className="text-xs text-muted-foreground">{readings.length} moisture readings</p>}
                    </div>
                  </div>
                  {insp.generalNotes && <p className="text-sm text-muted-foreground mt-2 border-t pt-2">{insp.generalNotes}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Pre-Job Inspection</DialogTitle></DialogHeader>
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Job</Label>
                <Select value={selectedJob} onValueChange={setSelectedJob}>
                  <SelectTrigger data-testid="select-insp-job"><SelectValue placeholder="Select job" /></SelectTrigger>
                  <SelectContent>{(jobs as any[]).map((j: any) => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber} — {j.address}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Inspector</Label><Input value={form.inspectedBy} onChange={e => setForm(f => ({ ...f, inspectedBy: e.target.value }))} data-testid="input-inspector" /></div>
            </div>
            <div><Label>Inspection Date</Label><Input type="date" value={form.inspectionDate} onChange={e => setForm(f => ({ ...f, inspectionDate: e.target.value }))} /></div>

            {/* Checklist */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="flex items-center gap-2"><ClipboardCheck className="w-4 h-4" /> Site Checklist</Label>
                <span className="text-xs text-muted-foreground">{checkedCount}/{form.checklistItems.length}</span>
              </div>
              <div className="space-y-2 border rounded-md p-3 max-h-48 overflow-y-auto">
                {form.checklistItems.map((ci, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <Checkbox checked={ci.checked} onCheckedChange={() => toggleItem(idx)} id={`ci-${idx}`} data-testid={`check-item-${idx}`} />
                    <label htmlFor={`ci-${idx}`} className={`text-sm cursor-pointer ${ci.checked ? "line-through text-muted-foreground" : ""}`}>{ci.item}</label>
                  </div>
                ))}
              </div>
            </div>

            {/* Moisture Readings */}
            <div>
              <Label className="flex items-center gap-2 mb-2"><Droplets className="w-4 h-4" /> Moisture Baseline Readings</Label>
              <div className="space-y-2">
                {form.moistureReadings.map((r, i) => (
                  <div key={i} className="flex justify-between text-sm bg-blue-50 dark:bg-blue-950 rounded px-3 py-2">
                    <span>{r.location}</span><span className="font-semibold">{r.reading}{r.unit}</span>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input placeholder="Location" value={newReading.location} onChange={e => setNewReading(r => ({ ...r, location: e.target.value }))} className="flex-1" />
                  <Input placeholder="Reading" value={newReading.reading} onChange={e => setNewReading(r => ({ ...r, reading: e.target.value }))} className="w-24" />
                  <Select value={newReading.unit} onValueChange={v => setNewReading(r => ({ ...r, unit: v }))}>
                    <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="%">%</SelectItem><SelectItem value="WME">WME</SelectItem><SelectItem value="GPP">GPP</SelectItem></SelectContent>
                  </Select>
                  <Button variant="outline" onClick={() => { if (newReading.location && newReading.reading) { setForm(f => ({ ...f, moistureReadings: [...f.moistureReadings, { ...newReading }] })); setNewReading({ location: "", reading: "", unit: "%" }); } }}>Add</Button>
                </div>
              </div>
            </div>

            {/* Pre-existing Damage */}
            <div>
              <Label className="flex items-center gap-2 mb-2"><AlertTriangle className="w-4 h-4" /> Pre-Existing Damage</Label>
              <div className="space-y-2">
                {form.preExistingDamage.map((d, i) => (
                  <div key={i} className="text-sm bg-yellow-50 dark:bg-yellow-950 rounded px-3 py-2"><span className="font-medium">{d.area}:</span> {d.description}</div>
                ))}
                <div className="flex gap-2">
                  <Input placeholder="Area" value={newDamage.area} onChange={e => setNewDamage(d => ({ ...d, area: e.target.value }))} className="w-32" />
                  <Input placeholder="Description" value={newDamage.description} onChange={e => setNewDamage(d => ({ ...d, description: e.target.value }))} className="flex-1" />
                  <Button variant="outline" onClick={() => { if (newDamage.area && newDamage.description) { setForm(f => ({ ...f, preExistingDamage: [...f.preExistingDamage, { ...newDamage }] })); setNewDamage({ area: "", description: "" }); } }}>Add</Button>
                </div>
              </div>
            </div>

            <div><Label>General Notes</Label><Textarea value={form.generalNotes} onChange={e => setForm(f => ({ ...f, generalNotes: e.target.value }))} rows={2} /></div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate({ ...form, moistureReadings: JSON.stringify(form.moistureReadings), preExistingDamage: JSON.stringify(form.preExistingDamage), checklistItems: JSON.stringify(form.checklistItems), status: checkedCount === form.checklistItems.length ? "complete" : "draft" })} disabled={saveMutation.isPending || !selectedJob || !form.inspectedBy} data-testid="button-save-inspection">
                {saveMutation.isPending ? "Saving..." : "Save Inspection"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
