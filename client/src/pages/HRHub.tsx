import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import HubShell from "@/components/HubShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Users, BookOpen, GraduationCap, AlertTriangle, Bot, ShieldCheck,
  Plus, Trash2, Loader2, FileText, Copy, ClipboardCheck, Star, Sparkles,
  CalendarClock, Check, X, Clock,
} from "lucide-react";

// ── helpers ────────────────────────────────────────────────────────────────
const j = (r: Response) => r.json();
function useHR<T = any>(key: string, path: string) {
  return useQuery<T>({ queryKey: [path], queryFn: () => apiRequest("GET", path).then(j) });
}
function inval(path: string) { queryClient.invalidateQueries({ queryKey: [path] }); }
const STATES = ["SC", "GA"];
const EMP_TYPES = [
  { v: "full_time", l: "Full-time" }, { v: "part_time", l: "Part-time" },
  { v: "seasonal", l: "Seasonal" }, { v: "contractor", l: "Contractor" },
];
const STATUSES = [
  { v: "active", l: "Active" }, { v: "on_leave", l: "On Leave" }, { v: "terminated", l: "Terminated" },
];
function fmt(d?: string) { return d ? new Date(d).toLocaleDateString() : "—"; }

// ═════════════════════════════════════════════════════════════════════════
// 1. EMPLOYEES
// ═════════════════════════════════════════════════════════════════════════
function EmployeesTab() {
  const { toast } = useToast();
  const { data: emps = [], isLoading } = useHR<any[]>("emps", "/api/hr/employees");
  const [open, setOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const blank = {
    firstName: "", lastName: "", email: "", phone: "", jobTitle: "", department: "",
    employmentType: "full_time", status: "active", workState: "SC", hireDate: "",
    payType: "hourly", payRate: 0, emergencyContact: "", emergencyPhone: "", notes: "",
    i9OnFile: false, w4OnFile: false, everifyDone: false,
  };
  const [form, setForm] = useState<any>(blank);

  const create = useMutation({
    mutationFn: () => apiRequest("POST", "/api/hr/employees", form).then(j),
    onSuccess: () => { inval("/api/hr/employees"); inval("/api/hr/compliance-snapshot"); setOpen(false); setForm(blank); toast({ title: "Employee added" }); },
    onError: (e: any) => toast({ title: "Error", description: String(e?.message || e), variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/hr/employees/${id}`).then(j),
    onSuccess: () => { inval("/api/hr/employees"); inval("/api/hr/compliance-snapshot"); toast({ title: "Employee removed" }); },
  });

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Employees</h2>
          <p className="text-sm text-muted-foreground">{emps.length} on record · work state drives applicable law (SC vs GA)</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-employee"><Plus className="w-4 h-4 mr-1" /> Add Employee</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Employee</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>First name</Label><Input data-testid="input-first-name" value={form.firstName} onChange={e => set("firstName", e.target.value)} /></div>
              <div><Label>Last name</Label><Input data-testid="input-last-name" value={form.lastName} onChange={e => set("lastName", e.target.value)} /></div>
              <div><Label>Email</Label><Input value={form.email} onChange={e => set("email", e.target.value)} /></div>
              <div><Label>Phone</Label><Input value={form.phone} onChange={e => set("phone", e.target.value)} /></div>
              <div><Label>Job title</Label><Input value={form.jobTitle} onChange={e => set("jobTitle", e.target.value)} /></div>
              <div><Label>Department</Label><Input value={form.department} onChange={e => set("department", e.target.value)} /></div>
              <div><Label>Work state</Label>
                <Select value={form.workState} onValueChange={v => set("workState", v)}>
                  <SelectTrigger data-testid="select-work-state"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Employment type</Label>
                <Select value={form.employmentType} onValueChange={v => set("employmentType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{EMP_TYPES.map(t => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={v => set("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map(t => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Hire date</Label><Input type="date" value={form.hireDate} onChange={e => set("hireDate", e.target.value)} /></div>
              <div><Label>Pay type</Label>
                <Select value={form.payType} onValueChange={v => set("payType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="hourly">Hourly</SelectItem><SelectItem value="salary">Salary</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Pay rate</Label><Input type="number" value={form.payRate} onChange={e => set("payRate", parseFloat(e.target.value) || 0)} /></div>
              <div><Label>Emergency contact</Label><Input value={form.emergencyContact} onChange={e => set("emergencyContact", e.target.value)} /></div>
              <div><Label>Emergency phone</Label><Input value={form.emergencyPhone} onChange={e => set("emergencyPhone", e.target.value)} /></div>
              <div className="col-span-2"><Label>Notes</Label><Textarea value={form.notes} onChange={e => set("notes", e.target.value)} /></div>
              <div className="col-span-2 flex gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.i9OnFile} onChange={e => set("i9OnFile", e.target.checked)} /> I-9 on file</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.w4OnFile} onChange={e => set("w4OnFile", e.target.checked)} /> W-4 on file</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.everifyDone} onChange={e => set("everifyDone", e.target.checked)} /> E-Verify done</label>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={create.isPending || !form.firstName || !form.lastName} data-testid="button-save-employee">
                {create.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? <div className="text-muted-foreground text-sm">Loading…</div> : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr>
              <th className="text-left p-2">Name</th><th className="text-left p-2">Title</th>
              <th className="text-left p-2">State</th><th className="text-left p-2">Type</th>
              <th className="text-left p-2">Status</th><th className="text-left p-2">Compliance</th><th className="p-2"></th>
            </tr></thead>
            <tbody>
              {emps.map((e: any) => (
                <tr key={e.id} className="border-t hover:bg-muted/30" data-testid={`row-employee-${e.id}`}>
                  <td className="p-2"><button className="text-[hsl(var(--titan-blue))] hover:underline" onClick={() => setDetailId(e.id)}>{e.firstName} {e.lastName}</button></td>
                  <td className="p-2">{e.jobTitle || "—"}</td>
                  <td className="p-2"><Badge variant="outline">{e.workState}</Badge></td>
                  <td className="p-2">{EMP_TYPES.find(t => t.v === e.employmentType)?.l || e.employmentType}</td>
                  <td className="p-2"><Badge variant={e.status === "active" ? "default" : e.status === "terminated" ? "destructive" : "secondary"}>{e.status}</Badge></td>
                  <td className="p-2 text-xs space-x-1">
                    {!e.i9OnFile && <Badge variant="destructive">No I-9</Badge>}
                    {!e.everifyDone && <Badge variant="destructive">No E-Verify</Badge>}
                    {e.i9OnFile && e.everifyDone && <Badge variant="secondary">OK</Badge>}
                  </td>
                  <td className="p-2 text-right"><Button size="icon" variant="ghost" onClick={() => del.mutate(e.id)} data-testid={`button-delete-employee-${e.id}`}><Trash2 className="w-4 h-4" /></Button></td>
                </tr>
              ))}
              {!emps.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No employees yet. Add your first team member.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {detailId != null && <EmployeeDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function EmployeeDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { data } = useHR<any>("emp", `/api/hr/employees/${id}`);
  if (!data) return null;
  const e = data.employee || data;
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{e.firstName} {e.lastName}</DialogTitle></DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-muted-foreground">Title:</span> {e.jobTitle || "—"}</div>
            <div><span className="text-muted-foreground">Department:</span> {e.department || "—"}</div>
            <div><span className="text-muted-foreground">Work state:</span> {e.workState}</div>
            <div><span className="text-muted-foreground">Status:</span> {e.status}</div>
            <div><span className="text-muted-foreground">Hire date:</span> {fmt(e.hireDate)}</div>
            <div><span className="text-muted-foreground">Pay:</span> {e.payType} ${e.payRate}</div>
            <div><span className="text-muted-foreground">Email:</span> {e.email || "—"}</div>
            <div><span className="text-muted-foreground">Phone:</span> {e.phone || "—"}</div>
          </div>
          {["documents", "writeups", "reviews", "trainings"].map(k => (
            <div key={k}>
              <h4 className="font-semibold capitalize mb-1">{k}</h4>
              {(data[k]?.length ?? 0) === 0
                ? <p className="text-muted-foreground text-xs">None</p>
                : <ul className="text-xs list-disc pl-5">{data[k].map((x: any) => <li key={x.id}>{x.title || x.subject || x.period || x.trainingName || x.type}</li>)}</ul>}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 2. HANDBOOK
// ═════════════════════════════════════════════════════════════════════════
function HandbookTab() {
  const { toast } = useToast();
  const { data: books = [], isLoading } = useHR<any[]>("hb", "/api/hr/handbook");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ version: "1.0", title: "Employee Handbook", body: "", status: "draft", effectiveDate: "" });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const create = useMutation({
    mutationFn: () => apiRequest("POST", "/api/hr/handbook", form).then(j),
    onSuccess: () => { inval("/api/hr/handbook"); setOpen(false); toast({ title: "Handbook saved" }); },
  });
  const publish = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/hr/handbook/${id}`, { status: "published" }).then(j),
    onSuccess: () => { inval("/api/hr/handbook"); toast({ title: "Published" }); },
  });
  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/hr/handbook/${id}`).then(j),
    onSuccess: () => { inval("/api/hr/handbook"); toast({ title: "Deleted" }); },
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold">Handbook & Policies</h2><p className="text-sm text-muted-foreground">Version your handbook, publish it, and assign it for acknowledgment.</p></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="button-add-handbook"><Plus className="w-4 h-4 mr-1" /> New Version</Button></DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New Handbook Version</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Version</Label><Input value={form.version} onChange={e => set("version", e.target.value)} /></div>
                <div className="col-span-2"><Label>Title</Label><Input value={form.title} onChange={e => set("title", e.target.value)} /></div>
              </div>
              <div><Label>Effective date</Label><Input type="date" value={form.effectiveDate} onChange={e => set("effectiveDate", e.target.value)} /></div>
              <div><Label>Body (markdown)</Label><Textarea rows={12} value={form.body} onChange={e => set("body", e.target.value)} placeholder="Paste or generate handbook content. Tip: use the AI Assistant tab to draft a full SC/GA-compliant handbook, then paste it here." /></div>
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending || !form.body} data-testid="button-save-handbook">{create.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading ? <div className="text-sm text-muted-foreground">Loading…</div> : (
        <div className="grid gap-3">
          {books.map((b: any) => (
            <Card key={b.id} data-testid={`card-handbook-${b.id}`}>
              <CardHeader className="pb-2"><div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><BookOpen className="w-4 h-4" /> {b.title} <span className="text-xs text-muted-foreground">v{b.version}</span></CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant={b.status === "published" ? "default" : "secondary"}>{b.status}</Badge>
                  {b.status !== "published" && <Button size="sm" variant="outline" onClick={() => publish.mutate(b.id)}>Publish</Button>}
                  <Button size="icon" variant="ghost" onClick={() => del.mutate(b.id)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div></CardHeader>
              <CardContent><p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-4">{b.body}</p>
                <p className="text-xs mt-2 text-muted-foreground">Effective {fmt(b.effectiveDate)}</p></CardContent>
            </Card>
          ))}
          {!books.length && <p className="text-center text-muted-foreground py-8">No handbook versions yet.</p>}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 3. TRAININGS
// ═════════════════════════════════════════════════════════════════════════
function TrainingsTab() {
  const { toast } = useToast();
  const { data: trainings = [], isLoading } = useHR<any[]>("tr", "/api/hr/trainings");
  const { data: assignments = [] } = useHR<any[]>("ta", "/api/hr/training-assignments");
  const { data: emps = [] } = useHR<any[]>("emps", "/api/hr/employees");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", category: "safety", description: "", recurrenceMonths: 12, required: true });
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const create = useMutation({
    mutationFn: () => apiRequest("POST", "/api/hr/trainings", form).then(j),
    onSuccess: () => { inval("/api/hr/trainings"); setOpen(false); toast({ title: "Training added" }); },
  });
  const del = useMutation({ mutationFn: (id: number) => apiRequest("DELETE", `/api/hr/trainings/${id}`).then(j), onSuccess: () => { inval("/api/hr/trainings"); } });
  const assign = useMutation({
    mutationFn: (v: { trainingId: number; employeeId: number }) => apiRequest("POST", "/api/hr/training-assignments", v).then(j),
    onSuccess: () => { inval("/api/hr/training-assignments"); toast({ title: "Assigned" }); },
  });
  const complete = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/hr/training-assignments/${id}`, { status: "completed", completedOn: new Date().toISOString().slice(0, 10) }).then(j),
    onSuccess: () => { inval("/api/hr/training-assignments"); toast({ title: "Marked complete" }); },
  });

  const [assignTr, setAssignTr] = useState<number | "">("");
  const [assignEmp, setAssignEmp] = useState<number | "">("");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div><h2 className="text-lg font-semibold">Trainings & Certifications</h2><p className="text-sm text-muted-foreground">IICRC, OSHA, safety & onboarding. Recurring trainings auto-compute next expiry on completion.</p></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="button-add-training"><Plus className="w-4 h-4 mr-1" /> Add Training</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Training</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={e => set("name", e.target.value)} /></div>
              <div><Label>Category</Label>
                <Select value={form.category} onValueChange={v => set("category", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["safety", "iicrc", "osha", "compliance", "onboarding", "other"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={e => set("description", e.target.value)} /></div>
              <div><Label>Recurrence (months, 0 = one-time)</Label><Input type="number" value={form.recurrenceMonths} onChange={e => set("recurrenceMonths", parseInt(e.target.value) || 0)} /></div>
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending || !form.name}>{create.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {trainings.map((t: any) => (
          <Card key={t.id}><CardHeader className="pb-2"><div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><GraduationCap className="w-4 h-4" /> {t.name}</CardTitle>
            <Button size="icon" variant="ghost" onClick={() => del.mutate(t.id)}><Trash2 className="w-4 h-4" /></Button>
          </div></CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1">
            <div><Badge variant="outline">{t.category}</Badge> {t.recurrenceMonths ? `· recurs every ${t.recurrenceMonths}mo` : "· one-time"} {t.required ? "· required" : ""}</div>
            <p>{t.description}</p>
          </CardContent></Card>
        ))}
        {!trainings.length && !isLoading && <p className="text-muted-foreground col-span-2 text-center py-4">No trainings yet.</p>}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Assign Training</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div><Label>Training</Label>
            <Select value={assignTr === "" ? undefined : String(assignTr)} onValueChange={v => setAssignTr(Number(v))}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Select training" /></SelectTrigger>
              <SelectContent>{trainings.map((t: any) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Employee</Label>
            <Select value={assignEmp === "" ? undefined : String(assignEmp)} onValueChange={v => setAssignEmp(Number(v))}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Select employee" /></SelectTrigger>
              <SelectContent>{emps.map((e: any) => <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button disabled={assignTr === "" || assignEmp === "" || assign.isPending} onClick={() => assign.mutate({ trainingId: Number(assignTr), employeeId: Number(assignEmp) })}>Assign</Button>
        </CardContent>
      </Card>

      <div>
        <h3 className="font-semibold mb-2">Assignments</h3>
        <div className="border rounded-lg overflow-hidden"><table className="w-full text-sm">
          <thead className="bg-muted/50"><tr><th className="text-left p-2">Training</th><th className="text-left p-2">Employee</th><th className="text-left p-2">Status</th><th className="text-left p-2">Completed</th><th className="text-left p-2">Expires</th><th className="p-2"></th></tr></thead>
          <tbody>
            {assignments.map((a: any) => {
              const t = trainings.find((x: any) => x.id === a.trainingId);
              const e = emps.find((x: any) => x.id === a.employeeId);
              const expired = a.expiresOn && new Date(a.expiresOn) < new Date();
              return (<tr key={a.id} className="border-t">
                <td className="p-2">{t?.name || a.trainingId}</td>
                <td className="p-2">{e ? `${e.firstName} ${e.lastName}` : a.employeeId}</td>
                <td className="p-2"><Badge variant={a.status === "completed" ? "default" : "secondary"}>{a.status}</Badge></td>
                <td className="p-2">{fmt(a.completedOn)}</td>
                <td className="p-2">{a.expiresOn ? <span className={expired ? "text-destructive font-medium" : ""}>{fmt(a.expiresOn)}{expired ? " (expired)" : ""}</span> : "—"}</td>
                <td className="p-2 text-right">{a.status !== "completed" && <Button size="sm" variant="outline" onClick={() => complete.mutate(a.id)}>Complete</Button>}</td>
              </tr>);
            })}
            {!assignments.length && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No assignments yet.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 4. WRITE-UPS & REVIEWS
// ═════════════════════════════════════════════════════════════════════════
function DisciplineTab() {
  const { toast } = useToast();
  const { data: writeups = [] } = useHR<any[]>("wu", "/api/hr/writeups");
  const { data: reviews = [] } = useHR<any[]>("rv", "/api/hr/reviews");
  const { data: emps = [] } = useHR<any[]>("emps", "/api/hr/employees");
  const empName = (idv: number) => { const e = emps.find((x: any) => x.id === idv); return e ? `${e.firstName} ${e.lastName}` : `#${idv}`; };

  const [wuOpen, setWuOpen] = useState(false);
  const [rvOpen, setRvOpen] = useState(false);
  const [wu, setWu] = useState<any>({ employeeId: "", type: "verbal", severity: "minor", incidentDate: "", subject: "", body: "", correctiveAction: "" });
  const [rv, setRv] = useState<any>({ employeeId: "", period: "", reviewDate: "", overallRating: "meets", strengths: "", areasForGrowth: "", goals: "", status: "draft" });

  const createWu = useMutation({ mutationFn: () => apiRequest("POST", "/api/hr/writeups", { ...wu, employeeId: Number(wu.employeeId) }).then(j), onSuccess: () => { inval("/api/hr/writeups"); setWuOpen(false); toast({ title: "Write-up saved" }); } });
  const delWu = useMutation({ mutationFn: (id: number) => apiRequest("DELETE", `/api/hr/writeups/${id}`).then(j), onSuccess: () => inval("/api/hr/writeups") });
  const createRv = useMutation({ mutationFn: () => apiRequest("POST", "/api/hr/reviews", { ...rv, employeeId: Number(rv.employeeId) }).then(j), onSuccess: () => { inval("/api/hr/reviews"); setRvOpen(false); toast({ title: "Review saved" }); } });
  const delRv = useMutation({ mutationFn: (id: number) => apiRequest("DELETE", `/api/hr/reviews/${id}`).then(j), onSuccess: () => inval("/api/hr/reviews") });

  return (
    <div className="p-6 space-y-8">
      {/* Write-ups */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div><h2 className="text-lg font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Write-ups & Discipline</h2><p className="text-sm text-muted-foreground">Behavior-based, defensible documentation. High-liability types show a legal-review note.</p></div>
          <Dialog open={wuOpen} onOpenChange={setWuOpen}>
            <DialogTrigger asChild><Button data-testid="button-add-writeup"><Plus className="w-4 h-4 mr-1" /> New Write-up</Button></DialogTrigger>
            <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
              <DialogHeader><DialogTitle>New Write-up</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Employee</Label>
                  <Select value={wu.employeeId === "" ? undefined : String(wu.employeeId)} onValueChange={v => setWu({ ...wu, employeeId: Number(v) })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{emps.map((e: any) => <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Type</Label>
                    <Select value={wu.type} onValueChange={v => setWu({ ...wu, type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{["verbal", "written", "final_warning", "pip", "termination"].map(t => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Incident date</Label><Input type="date" value={wu.incidentDate} onChange={e => setWu({ ...wu, incidentDate: e.target.value })} /></div>
                </div>
                <div><Label>Subject</Label><Input value={wu.subject} onChange={e => setWu({ ...wu, subject: e.target.value })} /></div>
                <div><Label>Details</Label><Textarea rows={5} value={wu.body} onChange={e => setWu({ ...wu, body: e.target.value })} /></div>
                <div><Label>Corrective action</Label><Textarea rows={2} value={wu.correctiveAction} onChange={e => setWu({ ...wu, correctiveAction: e.target.value })} /></div>
              </div>
              <DialogFooter><Button onClick={() => createWu.mutate()} disabled={createWu.isPending || !wu.employeeId}>{createWu.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <div className="border rounded-lg overflow-hidden"><table className="w-full text-sm">
          <thead className="bg-muted/50"><tr><th className="text-left p-2">Employee</th><th className="text-left p-2">Type</th><th className="text-left p-2">Subject</th><th className="text-left p-2">Date</th><th className="p-2"></th></tr></thead>
          <tbody>
            {writeups.map((w: any) => (<tr key={w.id} className="border-t">
              <td className="p-2">{empName(w.employeeId)}</td>
              <td className="p-2"><Badge variant={["final_warning", "termination", "pip"].includes(w.type) ? "destructive" : "secondary"}>{w.type.replace("_", " ")}</Badge></td>
              <td className="p-2">{w.subject}</td><td className="p-2">{fmt(w.incidentDate)}</td>
              <td className="p-2 text-right"><Button size="icon" variant="ghost" onClick={() => delWu.mutate(w.id)}><Trash2 className="w-4 h-4" /></Button></td>
            </tr>))}
            {!writeups.length && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No write-ups.</td></tr>}
          </tbody>
        </table></div>
      </div>

      {/* Reviews */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Star className="w-4 h-4" /> Performance Reviews</h2>
          <Dialog open={rvOpen} onOpenChange={setRvOpen}>
            <DialogTrigger asChild><Button data-testid="button-add-review"><Plus className="w-4 h-4 mr-1" /> New Review</Button></DialogTrigger>
            <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
              <DialogHeader><DialogTitle>New Performance Review</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Employee</Label>
                  <Select value={rv.employeeId === "" ? undefined : String(rv.employeeId)} onValueChange={v => setRv({ ...rv, employeeId: Number(v) })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{emps.map((e: any) => <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Period</Label><Input value={rv.period} onChange={e => setRv({ ...rv, period: e.target.value })} placeholder="2026 Annual" /></div>
                  <div><Label>Review date</Label><Input type="date" value={rv.reviewDate} onChange={e => setRv({ ...rv, reviewDate: e.target.value })} /></div>
                </div>
                <div><Label>Overall rating</Label>
                  <Select value={rv.overallRating} onValueChange={v => setRv({ ...rv, overallRating: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["exceeds", "meets", "needs_improvement", "unsatisfactory"].map(r => <SelectItem key={r} value={r}>{r.replace("_", " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Strengths</Label><Textarea value={rv.strengths} onChange={e => setRv({ ...rv, strengths: e.target.value })} /></div>
                <div><Label>Areas for growth</Label><Textarea value={rv.areasForGrowth} onChange={e => setRv({ ...rv, areasForGrowth: e.target.value })} /></div>
                <div><Label>Goals</Label><Textarea value={rv.goals} onChange={e => setRv({ ...rv, goals: e.target.value })} /></div>
              </div>
              <DialogFooter><Button onClick={() => createRv.mutate()} disabled={createRv.isPending || !rv.employeeId}>{createRv.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <div className="border rounded-lg overflow-hidden"><table className="w-full text-sm">
          <thead className="bg-muted/50"><tr><th className="text-left p-2">Employee</th><th className="text-left p-2">Period</th><th className="text-left p-2">Rating</th><th className="text-left p-2">Status</th><th className="p-2"></th></tr></thead>
          <tbody>
            {reviews.map((r: any) => (<tr key={r.id} className="border-t">
              <td className="p-2">{empName(r.employeeId)}</td><td className="p-2">{r.period}</td>
              <td className="p-2"><Badge variant="outline">{r.overallRating?.replace("_", " ")}</Badge></td>
              <td className="p-2">{r.status}</td>
              <td className="p-2 text-right"><Button size="icon" variant="ghost" onClick={() => delRv.mutate(r.id)}><Trash2 className="w-4 h-4" /></Button></td>
            </tr>))}
            {!reviews.length && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No reviews.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 5. PTO & TIME-OFF
// ═════════════════════════════════════════════════════════════════════════
const TO_CATS = [
  { v: "pto", l: "PTO / Vacation" }, { v: "sick", l: "Sick" }, { v: "unpaid", l: "Unpaid" },
  { v: "bereavement", l: "Bereavement" }, { v: "jury_duty", l: "Jury Duty" },
  { v: "holiday", l: "Holiday" }, { v: "other", l: "Other" },
];
const catLabel = (v: string) => TO_CATS.find(c => c.v === v)?.l || v;
const hrsToDays = (h: number) => `${(h / 8).toFixed(h % 8 === 0 ? 0 : 1)}d`;

function TimeOffTab() {
  const { toast } = useToast();
  const year = new Date().getFullYear();
  const { data: requests = [] } = useHR<any[]>("to", "/api/hr/timeoff");
  const { data: balances = [] } = useHR<any[]>("tob", `/api/hr/timeoff-balances?year=${year}`);
  const { data: emps = [] } = useHR<any[]>("emps", "/api/hr/employees");
  const [open, setOpen] = useState(false);
  const [allocOpen, setAllocOpen] = useState(false);

  const blank = { employeeId: "", category: "pto", startDate: "", endDate: "", hours: "", reason: "" };
  const [form, setForm] = useState<any>(blank);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () => apiRequest("POST", "/api/hr/timeoff", {
      ...form, employeeId: Number(form.employeeId), hours: form.hours ? Number(form.hours) : undefined,
    }).then(j),
    onSuccess: () => { inval("/api/hr/timeoff"); inval(`/api/hr/timeoff-balances?year=${year}`); setOpen(false); setForm(blank); toast({ title: "Request submitted" }); },
    onError: (e: any) => toast({ title: "Error", description: String(e?.message || e), variant: "destructive" }),
  });
  const decide = useMutation({
    mutationFn: (v: { id: number; status: string }) => apiRequest("PATCH", `/api/hr/timeoff/${v.id}`, { status: v.status }).then(j),
    onSuccess: () => { inval("/api/hr/timeoff"); inval(`/api/hr/timeoff-balances?year=${year}`); toast({ title: "Updated" }); },
  });
  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/hr/timeoff/${id}`).then(j),
    onSuccess: () => { inval("/api/hr/timeoff"); inval(`/api/hr/timeoff-balances?year=${year}`); },
  });

  // allotment editor
  const [alloc, setAlloc] = useState<any>({ employeeId: "", category: "pto", allottedHours: "" });
  const saveAlloc = useMutation({
    mutationFn: () => apiRequest("POST", "/api/hr/timeoff-balances", { ...alloc, employeeId: Number(alloc.employeeId), allottedHours: Number(alloc.allottedHours) || 0, year }).then(j),
    onSuccess: () => { inval(`/api/hr/timeoff-balances?year=${year}`); setAllocOpen(false); setAlloc({ employeeId: "", category: "pto", allottedHours: "" }); toast({ title: "Allotment saved" }); },
  });

  const pending = requests.filter((r: any) => r.status === "pending");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><CalendarClock className="w-4 h-4" /> PTO & Time-Off</h2>
          <p className="text-sm text-muted-foreground">Request, approve, and track paid time off. Balances reflect approved usage against each employee's {year} allotment. (SC & GA have no state-mandated PTO — this tracks your company policy.)</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={allocOpen} onOpenChange={setAllocOpen}>
            <DialogTrigger asChild><Button variant="outline" data-testid="button-set-allotment">Set Allotment</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Set Annual Allotment ({year})</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Employee</Label>
                  <Select value={alloc.employeeId === "" ? undefined : String(alloc.employeeId)} onValueChange={v => setAlloc({ ...alloc, employeeId: Number(v) })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{emps.map((e: any) => <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Category</Label>
                  <Select value={alloc.category} onValueChange={v => setAlloc({ ...alloc, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="pto">PTO / Vacation</SelectItem><SelectItem value="sick">Sick</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>Annual hours (e.g. 80 = 10 days)</Label><Input type="number" value={alloc.allottedHours} onChange={e => setAlloc({ ...alloc, allottedHours: e.target.value })} /></div>
              </div>
              <DialogFooter><Button onClick={() => saveAlloc.mutate()} disabled={saveAlloc.isPending || !alloc.employeeId} data-testid="button-save-allotment">{saveAlloc.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button data-testid="button-add-timeoff"><Plus className="w-4 h-4 mr-1" /> New Request</Button></DialogTrigger>
            <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
              <DialogHeader><DialogTitle>New Time-Off Request</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Employee</Label>
                  <Select value={form.employeeId === "" ? undefined : String(form.employeeId)} onValueChange={v => set("employeeId", Number(v))}>
                    <SelectTrigger data-testid="select-timeoff-employee"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{emps.map((e: any) => <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Type</Label>
                  <Select value={form.category} onValueChange={v => set("category", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TO_CATS.map(c => <SelectItem key={c.v} value={c.v}>{c.l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Start date</Label><Input type="date" data-testid="input-timeoff-start" value={form.startDate} onChange={e => set("startDate", e.target.value)} /></div>
                  <div><Label>End date</Label><Input type="date" data-testid="input-timeoff-end" value={form.endDate} onChange={e => set("endDate", e.target.value)} /></div>
                </div>
                <div><Label>Hours (leave blank to auto-calc from business days × 8h)</Label><Input type="number" value={form.hours} onChange={e => set("hours", e.target.value)} placeholder="auto" /></div>
                <div><Label>Reason (optional)</Label><Textarea value={form.reason} onChange={e => set("reason", e.target.value)} /></div>
              </div>
              <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending || !form.employeeId || !form.startDate || !form.endDate} data-testid="button-save-timeoff">{create.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Submit</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Pending approvals */}
      {pending.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4 text-amber-600" /> Pending Approval ({pending.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {pending.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between border rounded-md p-2 text-sm" data-testid={`pending-timeoff-${r.id}`}>
                <div><span className="font-medium">{r.firstName} {r.lastName}</span> · {catLabel(r.category)} · {fmt(r.startDate)}–{fmt(r.endDate)} · <span className="text-muted-foreground">{r.hours}h ({hrsToDays(r.hours)})</span>{r.reason ? <span className="text-muted-foreground"> · {r.reason}</span> : ""}</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="text-green-700" onClick={() => decide.mutate({ id: r.id, status: "approved" })} data-testid={`button-approve-${r.id}`}><Check className="w-4 h-4 mr-1" /> Approve</Button>
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => decide.mutate({ id: r.id, status: "denied" })} data-testid={`button-deny-${r.id}`}><X className="w-4 h-4 mr-1" /> Deny</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Balances */}
      <div>
        <h3 className="font-semibold mb-2">Balances — {year}</h3>
        <div className="border rounded-lg overflow-hidden"><table className="w-full text-sm">
          <thead className="bg-muted/50"><tr><th className="text-left p-2">Employee</th><th className="text-left p-2">Type</th><th className="text-right p-2">Allotted</th><th className="text-right p-2">Used</th><th className="text-right p-2">Pending</th><th className="text-right p-2">Remaining</th></tr></thead>
          <tbody>
            {balances.flatMap((b: any) => b.categories.filter((c: any) => c.allottedHours > 0 || c.usedHours > 0 || c.pendingHours > 0).map((c: any) => (
              <tr key={`${b.employeeId}-${c.category}`} className="border-t">
                <td className="p-2">{b.name}</td>
                <td className="p-2">{catLabel(c.category)}</td>
                <td className="p-2 text-right">{c.allottedHours ? `${c.allottedHours}h` : "—"}</td>
                <td className="p-2 text-right">{c.usedHours}h</td>
                <td className="p-2 text-right text-amber-600">{c.pendingHours ? `${c.pendingHours}h` : "—"}</td>
                <td className={`p-2 text-right font-medium ${c.remainingHours < 0 ? "text-destructive" : ""}`}>{c.allottedHours ? `${c.remainingHours}h (${hrsToDays(c.remainingHours)})` : "—"}</td>
              </tr>
            )))}
            {balances.every((b: any) => b.categories.every((c: any) => !c.allottedHours && !c.usedHours && !c.pendingHours)) && (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No allotments or usage yet. Use "Set Allotment" to define annual PTO per employee.</td></tr>
            )}
          </tbody>
        </table></div>
      </div>

      {/* All requests */}
      <div>
        <h3 className="font-semibold mb-2">All Requests</h3>
        <div className="border rounded-lg overflow-hidden"><table className="w-full text-sm">
          <thead className="bg-muted/50"><tr><th className="text-left p-2">Employee</th><th className="text-left p-2">Type</th><th className="text-left p-2">Dates</th><th className="text-right p-2">Hours</th><th className="text-left p-2">Status</th><th className="p-2"></th></tr></thead>
          <tbody>
            {requests.map((r: any) => (
              <tr key={r.id} className="border-t" data-testid={`row-timeoff-${r.id}`}>
                <td className="p-2">{r.firstName} {r.lastName}</td>
                <td className="p-2">{catLabel(r.category)}</td>
                <td className="p-2">{fmt(r.startDate)} – {fmt(r.endDate)}</td>
                <td className="p-2 text-right">{r.hours}h ({hrsToDays(r.hours)})</td>
                <td className="p-2"><Badge variant={r.status === "approved" ? "default" : r.status === "denied" ? "destructive" : r.status === "cancelled" ? "outline" : "secondary"}>{r.status}</Badge></td>
                <td className="p-2 text-right"><Button size="icon" variant="ghost" onClick={() => del.mutate(r.id)} data-testid={`button-delete-timeoff-${r.id}`}><Trash2 className="w-4 h-4" /></Button></td>
              </tr>
            ))}
            {!requests.length && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No time-off requests yet.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 6. AI HR ASSISTANT
// ═════════════════════════════════════════════════════════════════════════
const DRAFT_TYPES = [
  "Employee Handbook", "Offer Letter", "Termination Letter", "Written Warning",
  "Performance Improvement Plan (PIP)", "Anti-Harassment Policy", "PTO / Leave Policy",
  "Job Description", "Onboarding Checklist", "Safety Policy",
];

function AIAssistantTab() {
  const { toast } = useToast();
  const [mode, setMode] = useState<"assistant" | "draft">("assistant");
  const [question, setQuestion] = useState("");
  const [topic, setTopic] = useState(DRAFT_TYPES[0]);
  const [workState, setWorkState] = useState<string>("");
  const [result, setResult] = useState<any>(null);

  const run = useMutation({
    mutationFn: () => apiRequest("POST", "/api/hr/ai", {
      mode, question, topic: mode === "draft" ? topic : undefined, workState: workState || undefined,
    }).then(j),
    onSuccess: (d) => setResult(d),
    onError: (e: any) => toast({ title: "Error", description: String(e?.message || e), variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2"><Bot className="w-5 h-5 text-[hsl(var(--titan-blue))]" /> AI HR Assistant</h2>
        <p className="text-sm text-muted-foreground max-w-3xl">Grounded on a curated, dated knowledge base of South Carolina, Georgia, and federal employment law. It cites the specific statute and source for every legal claim, applies the stricter rule for multi-state staff, and never invents law. High-liability documents (termination, discipline, leave, discrimination) include a legal-review note.</p>
      </div>

      <div className="flex gap-2">
        <Button variant={mode === "assistant" ? "default" : "outline"} onClick={() => { setMode("assistant"); setResult(null); }}>Ask a Question</Button>
        <Button variant={mode === "draft" ? "default" : "outline"} onClick={() => { setMode("draft"); setResult(null); }}>Draft a Document</Button>
      </div>

      <Card><CardContent className="pt-4 space-y-3">
        {mode === "draft" && (
          <div><Label>Document type</Label>
            <Select value={topic} onValueChange={setTopic}>
              <SelectTrigger data-testid="select-draft-type"><SelectValue /></SelectTrigger>
              <SelectContent>{DRAFT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div><Label>{mode === "draft" ? "Details / context (optional)" : "Your question"}</Label>
          <Textarea rows={4} data-testid="textarea-hr-question" value={question} onChange={e => setQuestion(e.target.value)}
            placeholder={mode === "draft" ? "e.g. Full-time technician in SC, effective date, any specifics…" : "e.g. What's the deadline to issue a terminated employee's final paycheck in South Carolina?"} />
        </div>
        <div className="flex items-end gap-3">
          <div><Label>Focus state (optional)</Label>
            <Select value={workState || "both"} onValueChange={v => setWorkState(v === "both" ? "" : v)}>
              <SelectTrigger className="w-40" data-testid="select-focus-state"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="both">Both SC & GA</SelectItem><SelectItem value="SC">South Carolina</SelectItem><SelectItem value="GA">Georgia</SelectItem></SelectContent>
            </Select>
          </div>
          <Button onClick={() => run.mutate()} disabled={run.isPending || (mode === "assistant" && !question)} data-testid="button-run-hr-ai">
            {run.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />} {mode === "draft" ? "Generate" : "Ask"}
          </Button>
        </div>
      </CardContent></Card>

      {result && (
        <Card data-testid="card-hr-ai-result">
          <CardHeader className="pb-2"><div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4" /> Result</CardTitle>
            <div className="flex items-center gap-2">
              {result.highRisk && <Badge variant="destructive">High-liability · legal-review note added</Badge>}
              {result.simulated && <Badge variant="secondary">Rules mode (no AI key)</Badge>}
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(result.answer); toast({ title: "Copied" }); }}><Copy className="w-4 h-4 mr-1" /> Copy</Button>
            </div>
          </div></CardHeader>
          <CardContent>
            <div className="whitespace-pre-wrap text-sm border rounded-md p-4 bg-muted/30 max-h-[500px] overflow-y-auto" data-testid="text-hr-ai-answer">{result.answer}</div>
            {result.sourcesUsed?.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-muted-foreground mb-1">Sources referenced ({result.sourcesUsed.length}):</p>
                <ul className="text-xs space-y-0.5">
                  {result.sourcesUsed.slice(0, 12).map((s: any, i: number) => (
                    <li key={i}><Badge variant="outline" className="mr-1">{s.jurisdiction}</Badge>{s.title} — <span className="text-muted-foreground">{s.citation}</span> {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="text-[hsl(var(--titan-blue))] hover:underline">source</a>}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 6. COMPLIANCE SNAPSHOT
// ═════════════════════════════════════════════════════════════════════════
function ComplianceTab() {
  const { data, isLoading } = useHR<any>("cs", "/api/hr/compliance-snapshot");
  const { data: kb = [] } = useHR<any[]>("kb", "/api/hr/law-kb");
  if (isLoading || !data) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  const ico = (lvl: string) => lvl === "warn" ? "text-amber-600" : lvl === "ok" ? "text-green-600" : "text-blue-600";
  return (
    <div className="p-6 space-y-6">
      <div><h2 className="text-lg font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Compliance Snapshot</h2>
        <p className="text-sm text-muted-foreground">Headcount-driven flags for SC, GA & federal thresholds. As of {fmt(data.asOf)}.</p></div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[["Active", data.total], ["SC", data.sc], ["GA", data.ga], ["Missing I-9", data.missingI9], ["Missing E-Verify", data.missingEverify]].map(([l, v]) => (
          <Card key={l as string}><CardContent className="pt-4 text-center"><div className="text-2xl font-bold">{v as number}</div><div className="text-xs text-muted-foreground">{l as string}</div></CardContent></Card>
        ))}
      </div>
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Flags</CardTitle></CardHeader>
        <CardContent><ul className="space-y-2 text-sm">
          {data.flags.map((f: any, i: number) => (<li key={i} className="flex items-start gap-2"><ClipboardCheck className={`w-4 h-4 mt-0.5 ${ico(f.level)}`} /><span>{f.text}</span></li>))}
        </ul></CardContent>
      </Card>
      <div>
        <h3 className="font-semibold mb-2">Knowledge Base ({kb.length} dated entries)</h3>
        <div className="grid md:grid-cols-2 gap-2">
          {kb.map((k: any) => (
            <Card key={k.id}><CardContent className="pt-3 text-xs space-y-1">
              <div className="flex items-center gap-2"><Badge variant="outline">{k.jurisdiction}</Badge><span className="font-medium">{k.title}</span></div>
              <p className="text-muted-foreground">{k.summary}</p>
              <p className="text-muted-foreground">{k.citation} · verified {fmt(k.asOfDate)} {k.sourceUrl && <a href={k.sourceUrl} target="_blank" rel="noreferrer" className="text-[hsl(var(--titan-blue))] hover:underline">source</a>}</p>
            </CardContent></Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
export default function HRHub() {
  return (
    <HubShell
      title="HR Management"
      description="Employee records, handbook, trainings, discipline & reviews, plus an AI HR assistant grounded on SC, GA & federal employment law."
      icon={Users}
      tabs={[
        { value: "employees", label: "Employees", icon: Users, component: EmployeesTab },
        { value: "handbook", label: "Handbook", icon: BookOpen, component: HandbookTab },
        { value: "trainings", label: "Trainings", icon: GraduationCap, component: TrainingsTab },
        { value: "discipline", label: "Write-ups & Reviews", icon: AlertTriangle, component: DisciplineTab },
        { value: "timeoff", label: "PTO & Time-Off", icon: CalendarClock, component: TimeOffTab },
        { value: "ai", label: "AI HR Assistant", icon: Bot, component: AIAssistantTab },
        { value: "compliance", label: "Compliance", icon: ShieldCheck, component: ComplianceTab },
      ]}
    />
  );
}
