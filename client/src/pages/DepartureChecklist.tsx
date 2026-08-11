import { useState } from "react";
import { UserSelect } from "@/components/UserSelect";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ClipboardCheck, CheckCircle, AlertTriangle, Plus, Trash2, Pencil } from "lucide-react";
import { fmtDateShort } from "@/lib/dates";


const CHECKLIST_TEMPLATES: Record<string, { label: string; required: boolean }[]> = {
  water: [
    { label: "Moisture readings logged for all affected rooms", required: true },
    { label: "All air movers photographed in place with serial #", required: true },
    { label: "All dehumidifiers photographed in place with serial #", required: true },
    { label: "Psychrometric data recorded (temp, RH, GPP)", required: true },
    { label: "Photo of each affected wall (all 4 sides per room)", required: true },
    { label: "Equipment log updated with placement details", required: true },
    { label: "Homeowner briefed on drying process", required: false },
    { label: "Antimicrobial treatment applied and documented", required: false },
    { label: "Category / Class of water loss documented", required: true },
    { label: "Containment barriers in place if Cat 2/3", required: false },
    { label: "Drying log started in system", required: true },
  ],
  fire: [
    { label: "Full room-by-room soot/char photo documentation", required: true },
    { label: "HVAC system photographed and noted for cleaning", required: true },
    { label: "Structural concerns documented in notes", required: true },
    { label: "Contents inventory started (packout items listed)", required: false },
    { label: "Odor level assessment documented", required: true },
    { label: "Photo of all windows/doors for board-up verification", required: true },
    { label: "Safety hazards (exposed wiring, collapse risk) noted", required: true },
    { label: "Homeowner personal items secured or noted", required: false },
  ],
  mold: [
    { label: "Containment barriers fully installed and photographed", required: true },
    { label: "Negative air machine running and documented", required: true },
    { label: "Pre-remediation air sample taken and labeled", required: true },
    { label: "Affected area square footage documented", required: true },
    { label: "PPE worn and documented for crew", required: true },
    { label: "Mold species and growth pattern photographed", required: true },
    { label: "Source of moisture identified and noted", required: true },
    { label: "Chain-of-custody for samples recorded", required: true },
  ],
  storm: [
    { label: "Emergency tarp/board-up photos taken", required: true },
    { label: "Roof damage photographed from multiple angles", required: true },
    { label: "Structural damage assessment documented", required: true },
    { label: "Debris removal work documented", required: false },
    { label: "Interior water intrusion points documented", required: true },
    { label: "Safety hazards marked and noted", required: true },
    { label: "Homeowner signed Work Authorization", required: true },
  ],
  general: [
    { label: "All work areas photographed before and after", required: true },
    { label: "Work Authorization signed by homeowner", required: true },
    { label: "All tools and equipment accounted for", required: true },
    { label: "Job site left clean and secure", required: false },
    { label: "Notes updated in job file", required: true },
  ],
};

function EditDepartureChecklistDialog({ checklist, jobs, onDone }: { checklist: any; jobs: any[]; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [employeeName, setEmployeeName] = useState(checklist.employee_name ?? "");
  const parsedItems: { label: string; required: boolean; checked: boolean }[] = (() => {
    try { return JSON.parse(checklist.items || "[]"); } catch { return []; }
  })();
  const [editItems, setEditItems] = useState(parsedItems);

  const m = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/departure-checklists/${checklist.id}`, data),
    onSuccess: () => {
      toast({ title: "Checklist updated" });
      onDone();
      setOpen(false);
    },
    onError: (e: any) => toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" }),
  });

  function toggleEditItem(index: number) {
    setEditItems(prev => prev.map((item, i) => i === index ? { ...item, checked: !item.checked } : item));
  }

  const requiredDone = editItems.filter(i => i.required && i.checked).length;
  const requiredTotal = editItems.filter(i => i.required).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-edit-departure-checklists-${checklist.id}`}>
          <Pencil className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Departure Checklist</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Tech Name</Label>
            <UserSelect
              value={employeeName}
              onChange={setEmployeeName}
              roles={["tech"]}
              placeholder="Select tech..."
              testId={`select-employee-${checklist.id}`}
            />
          </div>
          {editItems.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {editItems.map((item, i) => (
                <div key={i} className="flex items-start gap-3 p-2 rounded border border-border">
                  <Checkbox id={`edit-item-${checklist.id}-${i}`} checked={item.checked} onCheckedChange={() => toggleEditItem(i)} className="mt-0.5" data-testid={`input-item-${checklist.id}-${i}`} />
                  <label htmlFor={`edit-item-${checklist.id}-${i}`} className="text-sm cursor-pointer flex-1">
                    {item.label}{item.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                </div>
              ))}
            </div>
          )}
          <Button
            className="w-full"
            disabled={m.isPending}
            data-testid={`button-save-departure-checklists-${checklist.id}`}
            onClick={() => m.mutate({
              employeeName,
              items: editItems,
              allRequiredComplete: requiredDone === requiredTotal,
            })}
          >
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDepartureChecklistBtn({ id, label, onDone }: { id: number; label: string; onDone: () => void }) {
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/departure-checklists/${id}`),
    onSuccess: () => { toast({ title: "Deleted" }); onDone(); },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-delete-departure-checklists-${id}`}>
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
          <AlertDialogAction onClick={() => m.mutate()} data-testid={`button-confirm-delete-departure-checklists-${id}`}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function DepartureChecklist() {
  const { toast } = useToast();
  const [selectedJob, setSelectedJob] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [items, setItems] = useState<{ label: string; required: boolean; checked: boolean }[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("/api/jobs").then(r => r.json()) });
  const { data: allChecklists = [] } = useQuery<any[]>({ queryKey: ["/api/departure-checklists"], queryFn: () => apiRequest("/api/departure-checklists").then(r => r.json()) });

  const saveMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/departure-checklists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/departure-checklists"] });
      toast({ title: "Departure checklist saved" });
      setSubmitted(true);
      setSelectedJob(""); setSelectedEmployee(""); setItems([]);
      setTimeout(() => setSubmitted(false), 3000);
    },
  });

  function loadJob(jobId: string) {
    setSelectedJob(jobId);
    const job = jobs.find((j: any) => String(j.id) === jobId);
    const lt = (job?.lossType || "general").toLowerCase();
    const template = CHECKLIST_TEMPLATES[lt] || CHECKLIST_TEMPLATES.general;
    setItems(template.map(t => ({ ...t, checked: false })));
  }

  function toggleItem(index: number) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, checked: !item.checked } : item));
  }

  const allRequired = items.filter(i => i.required);
  const requiredDone = allRequired.filter(i => i.checked).length;
  const canSubmit = selectedJob && selectedEmployee && requiredDone === allRequired.length;

  const recentChecklists = allChecklists.slice(0, 10);

  function invalidateChecklists() {
    queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/departure-checklists"] });
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-primary" /> Pre-Departure Job Checklist
        </h1>
        <p className="text-sm text-muted-foreground mt-1">IICRC-based prompts before a tech leaves any job — prevents missed documentation and supplement rejections</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Checklist Builder */}
        <Card>
          <CardHeader><CardTitle className="text-base">Complete Checklist</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Select Job</Label>
              <Select value={selectedJob} onValueChange={loadJob}>
                <SelectTrigger data-testid="select-job"><SelectValue placeholder="Choose job..." /></SelectTrigger>
                <SelectContent>{jobs.map((j: any) => <SelectItem key={j.id} value={String(j.id)}>TP-{String(j.id).padStart(4, "0")} — {j.address?.substring(0, 22) || "N/A"} ({j.lossType})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tech Name</Label>
              <UserSelect
                value={selectedEmployee}
                onChange={setSelectedEmployee}
                roles={["tech"]}
                placeholder="Select tech..."
                testId="select-employee"
              />
            </div>

            {items.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Checklist Items</p>
                  <span className="text-xs text-muted-foreground">{requiredDone}/{allRequired.length} required</span>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {items.map((item, i) => (
                    <div key={i} className={`flex items-start gap-3 p-2 rounded border ${item.checked ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20" : item.required ? "border-border bg-muted/30" : "border-border"}`} data-testid={`checklist-item-${i}`}>
                      <Checkbox id={`item-${i}`} checked={item.checked} onCheckedChange={() => toggleItem(i)} className="mt-0.5" />
                      <label htmlFor={`item-${i}`} className="text-sm cursor-pointer flex-1">
                        {item.label}
                        {item.required && <span className="text-red-500 ml-1">*</span>}
                      </label>
                    </div>
                  ))}
                </div>

                {!canSubmit && allRequired.length > 0 && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Complete all required items (*) before submitting
                  </p>
                )}

                {submitted ? (
                  <div className="flex items-center justify-center gap-2 py-2 text-green-600">
                    <CheckCircle className="w-5 h-5" /><span className="font-semibold">Checklist saved!</span>
                  </div>
                ) : (
                  <Button className="w-full" disabled={!canSubmit || saveMutation.isPending} data-testid="button-submit-checklist"
                    onClick={() => saveMutation.mutate({ jobId: parseInt(selectedJob), employeeName: selectedEmployee, lossType: jobs.find((j: any) => String(j.id) === selectedJob)?.lossType, items, completedAt: new Date().toISOString() })}>
                    <ClipboardCheck className="w-4 h-4 mr-2" />Submit & Clear to Leave
                  </Button>
                )}
              </>
            )}

            {!selectedJob && (
              <div className="text-center py-6 text-muted-foreground">
                <ClipboardCheck className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Select a job to load the appropriate checklist</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Completions */}
        <Card>
          <CardHeader><CardTitle className="text-base">Recent Completions</CardTitle></CardHeader>
          <CardContent>
            {recentChecklists.length === 0 ? (
              <p className="text-center py-8 text-muted-foreground text-sm">No completed checklists yet.</p>
            ) : (
              <div className="space-y-2">
                {recentChecklists.map((c: any) => {
                  const job = jobs.find((j: any) => j.id === c.job_id);
                  const parsedItems = (() => { try { return JSON.parse(c.items || "[]"); } catch { return []; } })();
                  const checked = parsedItems.filter((i: any) => i.checked).length;
                  return (
                    <div key={c.id} className="p-3 rounded border border-border" data-testid={`completed-checklist-${c.id}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{c.employee_name}</span>
                            {job && <Badge variant="outline" className="text-xs">TP-{String(job.id).padStart(4, "0")}</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground">{c.loss_type} · {checked}/{parsedItems.length} items</p>
                        </div>
                        <div className="text-right">
                          {c.all_required_complete ? (
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">Complete</Badge>
                          ) : (
                            <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs">Partial</Badge>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">{c.created_at ? fmtDateShort(c.created_at) : ""}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <EditDepartureChecklistDialog checklist={c} jobs={jobs} onDone={invalidateChecklists} />
                          <DeleteDepartureChecklistBtn id={c.id} label={c.employee_name} onDone={invalidateChecklists} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
