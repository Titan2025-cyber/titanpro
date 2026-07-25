/**
 * SafetyChecklist.tsx — #10 Pre-Job OSHA Safety Checklist
 * Techs complete before entering a loss site; photo evidence; admin alerts on fail
 */
import { useState } from "react";
import { UserSelect } from "@/components/UserSelect";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, ShieldAlert, Plus, CheckCircle, XCircle, AlertTriangle, User, Trash2, Pencil } from "lucide-react";
import type { Job } from "@shared/schema";


interface CheckItem { key: string; label: string; description: string; failCritical?: boolean }
const CHECKS: CheckItem[] = [
  { key: "ppeVerified", label: "PPE Verified", description: "All required PPE on-site and in good condition (gloves, respirator, goggles, Tyvek)" },
  { key: "electricalHazard", label: "Electrical Hazard", description: "Identify any electrical hazard — wet panels, exposed wiring, flooded outlets", failCritical: true },
  { key: "airQualityCheck", label: "Air Quality Check", description: "Visible mold, odor, or air quality concerns identified" },
  { key: "moldFlag", label: "Mold Present", description: "Active mold growth observed — trigger mold protocol", failCritical: true },
  { key: "asbestosFlag", label: "Asbestos Risk", description: "Building pre-1980 or suspect ACM materials — do not disturb, escalate", failCritical: true },
  { key: "confinedSpaceFlag", label: "Confined Space", description: "Crawlspace, attic, or enclosed area — confined space protocol required", failCritical: true },
  { key: "slipHazard", label: "Slip/Trip Hazard", description: "Wet floors, debris, or unstable surfaces present" },
  { key: "biohazardFlag", label: "Biohazard Present", description: "Sewage, blood, or other biohazard material — PPE upgrade required", failCritical: true },
];

function EditSafetyChecklistDialog({ checklist, jobs, onDone }: { checklist: any; jobs: Job[]; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({
    jobId: String(checklist.jobId ?? ""),
    techName: checklist.techName ?? "",
    checklistDate: checklist.checklistDate ?? new Date().toISOString().slice(0, 10),
    ppeVerified: !!checklist.ppeVerified, electricalHazard: !!checklist.electricalHazard,
    airQualityCheck: !!checklist.airQualityCheck, moldFlag: !!checklist.moldFlag,
    asbestosFlag: !!checklist.asbestosFlag, confinedSpaceFlag: !!checklist.confinedSpaceFlag,
    slipHazard: !!checklist.slipHazard, biohazardFlag: !!checklist.biohazardFlag,
    electricalNotes: checklist.electricalNotes ?? "", notes: checklist.notes ?? "",
  });

  const criticalFlags = CHECKS.filter(c => c.failCritical && form[c.key]);
  const overallPass = criticalFlags.length === 0 && form.ppeVerified;

  const m = useMutation({
    mutationFn: (d: any) => apiRequest("PATCH", `/api/safety-checklists/${checklist.id}`, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety-checklists"] });
      toast({ title: "Safety checklist updated" });
      setOpen(false);
      onDone();
    },
    onError: (e: any) => toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-edit-safety-checklists-${checklist.id}`}>
          <Pencil className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Safety Checklist</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Job</Label>
              <Select value={form.jobId} onValueChange={v => setForm(f => ({ ...f, jobId: v }))}>
                <SelectTrigger data-testid={`select-job-${checklist.id}`}><SelectValue placeholder="Select job" /></SelectTrigger>
                <SelectContent>{jobs.map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tech</Label>
              <UserSelect
                value={form.techName}
                onChange={v => setForm(f => ({ ...f, techName: v }))}
                roles={["tech"]}
                placeholder="Select tech"
                testId={`select-safety-tech-${checklist.id}`}
              />
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Site Conditions</p>
            {CHECKS.map(item => (
              <div key={item.key} className={`flex items-start gap-3 p-3 rounded-lg border ${form[item.key] && item.failCritical ? "border-[hsl(var(--titan-red))] bg-red-50 dark:bg-red-900/10" : "border-border"}`}>
                <button
                  type="button"
                  data-testid={`input-${item.key}-${checklist.id}`}
                  className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center shrink-0 border-2 transition-colors ${form[item.key] ? (item.failCritical ? "bg-[hsl(var(--titan-red))] border-[hsl(var(--titan-red))]" : "bg-[hsl(var(--titan-blue))] border-[hsl(var(--titan-blue))]") : "border-muted-foreground"}`}
                  onClick={() => setForm(f => ({ ...f, [item.key]: !f[item.key] }))}
                >
                  {form[item.key] && <CheckCircle className="w-3 h-3 text-white" />}
                </button>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{item.label}</span>
                    {item.failCritical && <Badge className="text-xs bg-orange-100 text-orange-700">Critical</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                </div>
              </div>
            ))}
          </div>

          {criticalFlags.length > 0 && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/10 border border-[hsl(var(--titan-red))] rounded-lg">
              <AlertTriangle className="w-4 h-4 text-[hsl(var(--titan-red))] shrink-0" />
              <p className="text-xs text-[hsl(var(--titan-red))] font-medium">
                ⚠️ {criticalFlags.length} critical hazard(s) flagged — admin will be alerted. Document and escalate before proceeding.
              </p>
            </div>
          )}

          <div>
            <Label>Additional Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Any other site conditions or observations..." data-testid={`input-notes-${checklist.id}`} />
          </div>

          <div className={`p-3 rounded-lg text-sm font-semibold flex items-center gap-2 ${overallPass ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            {overallPass ? <CheckCircle className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            Overall: {overallPass ? "PASS — Safe to proceed" : criticalFlags.length > 0 ? "FAIL — Critical hazards present" : "FAIL — PPE not verified"}
          </div>

          <Button
            className="w-full bg-[hsl(var(--titan-blue))] text-white"
            disabled={m.isPending || !form.jobId || !form.techName}
            data-testid={`button-save-safety-checklists-${checklist.id}`}
            onClick={() => m.mutate({
              ...form,
              jobId: Number(form.jobId),
              overallPass,
            })}
          >
            {m.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSafetyChecklistBtn({ id, label, onDone }: { id: number; label: string; onDone: () => void }) {
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/safety-checklists/${id}`),
    onSuccess: () => { toast({ title: "Deleted" }); onDone(); },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-delete-safety-checklists-${id}`}>
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
          <AlertDialogAction onClick={() => m.mutate()} data-testid={`button-confirm-delete-safety-checklists-${id}`}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function SafetyChecklist() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({
    jobId: "", techName: "", checklistDate: new Date().toISOString().slice(0, 10),
    ppeVerified: false, electricalHazard: false, airQualityCheck: false, moldFlag: false,
    asbestosFlag: false, confinedSpaceFlag: false, slipHazard: false, biohazardFlag: false,
    electricalNotes: "", notes: "",
  });

  const { data: checklists = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/safety-checklists"],
    queryFn: () => apiRequest("GET", "/api/safety-checklists").then(r => r.json()),
  });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  const createMutation = useMutation({
    mutationFn: (d: any) => apiRequest("POST", "/api/safety-checklists", d).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety-checklists"] });
      setOpen(false);
      toast({ title: "Safety checklist submitted" });
    },
  });

  const criticalFlags = CHECKS.filter(c => c.failCritical && form[c.key]);
  const overallPass = criticalFlags.length === 0 && form.ppeVerified;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-[hsl(var(--titan-blue))]" />
          <h1 className="text-xl font-bold">Pre-Job Safety Checklists</h1>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white">
              <Plus className="w-4 h-4 mr-2" />New Checklist
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Pre-Job Safety Checklist</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Job</Label>
                  <Select value={form.jobId} onValueChange={v => setForm(f => ({ ...f, jobId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select job" /></SelectTrigger>
                    <SelectContent>{jobs.map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tech</Label>
                  <UserSelect
                    value={form.techName}
                    onChange={v => setForm(f => ({ ...f, techName: v }))}
                    roles={["tech"]}
                    placeholder="Select tech"
                    testId="select-safety-tech"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Site Conditions</p>
                {CHECKS.map(item => (
                  <div key={item.key} className={`flex items-start gap-3 p-3 rounded-lg border ${form[item.key] && item.failCritical ? "border-[hsl(var(--titan-red))] bg-red-50 dark:bg-red-900/10" : "border-border"}`}>
                    <button
                      type="button"
                      className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center shrink-0 border-2 transition-colors ${form[item.key] ? (item.failCritical ? "bg-[hsl(var(--titan-red))] border-[hsl(var(--titan-red))]" : "bg-[hsl(var(--titan-blue))] border-[hsl(var(--titan-blue))]") : "border-muted-foreground"}`}
                      onClick={() => setForm(f => ({ ...f, [item.key]: !f[item.key] }))}
                    >
                      {form[item.key] && <CheckCircle className="w-3 h-3 text-white" />}
                    </button>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{item.label}</span>
                        {item.failCritical && <Badge className="text-xs bg-orange-100 text-orange-700">Critical</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>

              {criticalFlags.length > 0 && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/10 border border-[hsl(var(--titan-red))] rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-[hsl(var(--titan-red))] shrink-0" />
                  <p className="text-xs text-[hsl(var(--titan-red))] font-medium">
                    ⚠️ {criticalFlags.length} critical hazard(s) flagged — admin will be alerted. Document and escalate before proceeding.
                  </p>
                </div>
              )}

              <div>
                <Label>Additional Notes</Label>
                <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Any other site conditions or observations..." />
              </div>

              <div className={`p-3 rounded-lg text-sm font-semibold flex items-center gap-2 ${overallPass ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                {overallPass ? <CheckCircle className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                Overall: {overallPass ? "PASS — Safe to proceed" : criticalFlags.length > 0 ? "FAIL — Critical hazards present" : "FAIL — PPE not verified"}
              </div>

              <Button
                className="w-full bg-[hsl(var(--titan-blue))] text-white"
                disabled={createMutation.isPending || !form.jobId || !form.techName}
                onClick={() => createMutation.mutate({
                  ...form,
                  jobId: Number(form.jobId),
                  overallPass,
                  photoUrls: "[]",
                  createdAt: new Date().toISOString(),
                })}
              >
                {createMutation.isPending ? "Submitting…" : "Submit Checklist"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Checklists", value: checklists.length, color: "text-foreground" },
          { label: "Passed", value: checklists.filter((c: any) => c.overallPass).length, color: "text-green-600" },
          { label: "Failed / Flagged", value: checklists.filter((c: any) => !c.overallPass).length, color: "text-[hsl(var(--titan-red))]" },
        ].map(stat => (
          <Card key={stat.label}><CardContent className="p-4 text-center"><p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p><p className="text-xs text-muted-foreground">{stat.label}</p></CardContent></Card>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded" />)}</div>
      ) : checklists.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground"><ShieldCheck className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No safety checklists yet.</p></CardContent></Card>
      ) : (
        <div className="space-y-2">
          {checklists.map((cl: any) => {
            const job = jobs.find(j => j.id === cl.jobId);
            const flags = CHECKS.filter(c => cl[c.key] && c.failCritical);
            return (
              <Card key={cl.id} className={`border-l-4 ${cl.overallPass ? "border-green-500" : "border-[hsl(var(--titan-red))]"}`}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      {cl.overallPass ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0" /> : <ShieldAlert className="w-4 h-4 text-[hsl(var(--titan-red))] shrink-0" />}
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{job?.jobNumber || `Job #${cl.jobId}`}</span>
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><User className="w-3 h-3" />{cl.techName}</span>
                          <span className="text-xs text-muted-foreground">{cl.checklistDate}</span>
                        </div>
                        {flags.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {flags.map(f => <Badge key={f.key} className="text-xs bg-red-100 text-red-700">{f.label}</Badge>)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge className={`text-xs ${cl.overallPass ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {cl.overallPass ? "PASS" : "FAIL"}
                      </Badge>
                      <EditSafetyChecklistDialog checklist={cl} jobs={jobs} onDone={() => queryClient.invalidateQueries({ queryKey: ["/api/safety-checklists"] })} />
                      <DeleteSafetyChecklistBtn id={cl.id} label={cl.techName} onDone={() => queryClient.invalidateQueries({ queryKey: ["/api/safety-checklists"] })} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
