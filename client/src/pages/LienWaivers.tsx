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
import { FileCheck, Plus, Download, CheckCircle, Clock, AlertTriangle } from "lucide-react";

const WAIVER_TYPES: Record<string, { label: string; description: string }> = {
  conditional_progress: { label: "Conditional Progress", description: "Waives lien rights for progress payment, contingent on payment clearing" },
  unconditional_progress: { label: "Unconditional Progress", description: "Waives lien rights for progress payment unconditionally" },
  conditional_final: { label: "Conditional Final", description: "Waives all lien rights upon final payment clearing" },
  unconditional_final: { label: "Unconditional Final", description: "Waives all lien rights unconditionally — use only after payment confirmed" },
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  signed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  filed: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
};

const GA_STATUTE = "O.C.G.A. § 44-14-366 — Georgia Materialman's and Mechanic's Lien Law";
const SC_STATUTE = "S.C. Code § 29-5-10 — South Carolina Mechanics' and Materialmen's Lien Act";

export default function LienWaivers() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState({ jobId: "", waiverType: "conditional_progress", state: "GA", throughDate: "", amount: "", signerName: "", signerTitle: "", notes: "" });

  const { data: waivers = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/lien-waivers"], queryFn: () => apiRequest("/api/lien-waivers").then(r => r.json()) });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("/api/jobs").then(r => r.json()) });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/lien-waivers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/lien-waivers"] }); setOpen(false); resetForm(); toast({ title: "Lien waiver created" }); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest(`/api/lien-waivers/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/lien-waivers"] }); toast({ title: "Waiver updated" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/lien-waivers/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/lien-waivers"] }); setSelected(null); toast({ title: "Waiver deleted" }); },
  });

  function resetForm() { setForm({ jobId: "", waiverType: "conditional_progress", state: "GA", throughDate: "", amount: "", signerName: "", signerTitle: "", notes: "" }); }

  function generateWaiver(w: any) {
    const job = jobs.find((j: any) => j.id === w.job_id);
    const statute = w.state === "SC" ? SC_STATUTE : GA_STATUTE;
    const wType = WAIVER_TYPES[w.waiver_type];
    const lines = [
      `LIEN WAIVER — ${wType?.label?.toUpperCase()}`,
      `State of ${w.state === "SC" ? "South Carolina" : "Georgia"}`,
      "Titan Restoration LLC",
      "Augusta, GA | 706-922-0154 | titanrestorationllc.com",
      "=".repeat(60),
      "",
      `Job: TP-${String(w.job_id).padStart(4, "0")}${job ? ` — ${job.address}` : ""}`,
      `Waiver Type: ${wType?.label}`,
      `Through Date: ${w.through_date || "N/A"}`,
      `Amount: $${(w.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      "",
      "WAIVER LANGUAGE",
      "─".repeat(60),
      `The undersigned, upon receipt of the sum stated above, hereby waives and releases any and all lien or claim of lien on the above-referenced property for labor, services, or materials furnished through the Through Date stated above.`,
      "",
      wType?.description,
      "",
      "APPLICABLE STATUTE",
      statute,
      "",
      "SIGNATURE",
      `Signer: ${w.signer_name || "_______________________"}`,
      `Title: ${w.signer_title || "_______________________"}`,
      `Date Signed: ${w.signed_at ? new Date(w.signed_at).toLocaleDateString() : "_______________________"}`,
      "",
      w.notes ? `Notes: ${w.notes}` : "",
      "",
      `Generated: ${new Date().toLocaleString()}`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lien-waiver-TP${String(w.job_id).padStart(4, "0")}-${w.waiver_type}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Waiver document downloaded" });
  }

  const draft = waivers.filter((w: any) => w.status === "draft").length;
  const signed = waivers.filter((w: any) => w.status === "signed").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-primary" /> Lien Waiver Manager
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Georgia & South Carolina statutory lien waivers — generate, track, and collect per job</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="button-new-waiver"><Plus className="w-4 h-4 mr-2" />New Waiver</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New Lien Waiver</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Job</Label>
                  <Select value={form.jobId} onValueChange={v => setForm({ ...form, jobId: v })}>
                    <SelectTrigger data-testid="select-job"><SelectValue placeholder="Select job" /></SelectTrigger>
                    <SelectContent>{jobs.map((j: any) => <SelectItem key={j.id} value={String(j.id)}>TP-{String(j.id).padStart(4, "0")} — {j.address?.substring(0, 18) || "N/A"}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>State</Label>
                  <Select value={form.state} onValueChange={v => setForm({ ...form, state: v })}>
                    <SelectTrigger data-testid="select-state"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="GA">Georgia</SelectItem><SelectItem value="SC">South Carolina</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Waiver Type</Label>
                <Select value={form.waiverType} onValueChange={v => setForm({ ...form, waiverType: v })}>
                  <SelectTrigger data-testid="select-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(WAIVER_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">{WAIVER_TYPES[form.waiverType]?.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Through Date</Label><Input data-testid="input-through-date" type="date" value={form.throughDate} onChange={e => setForm({ ...form, throughDate: e.target.value })} /></div>
                <div><Label>Amount ($)</Label><Input data-testid="input-amount" type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Signer Name</Label><Input data-testid="input-signer-name" value={form.signerName} onChange={e => setForm({ ...form, signerName: e.target.value })} /></div>
                <div><Label>Signer Title</Label><Input data-testid="input-signer-title" value={form.signerTitle} onChange={e => setForm({ ...form, signerTitle: e.target.value })} /></div>
              </div>
              <div><Label>Notes</Label><Textarea data-testid="input-notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
              <Button className="w-full" data-testid="button-create-waiver" onClick={() => createMutation.mutate({ jobId: parseInt(form.jobId), waiverType: form.waiverType, state: form.state, throughDate: form.throughDate || null, amount: form.amount ? parseFloat(form.amount) : null, signerName: form.signerName, signerTitle: form.signerTitle, notes: form.notes })} disabled={!form.jobId || createMutation.isPending}>Create Waiver</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Waivers", value: waivers.length, icon: FileCheck, color: "text-primary" },
          { label: "Awaiting Signature", value: draft, icon: Clock, color: "text-yellow-500" },
          { label: "Signed", value: signed, icon: CheckCircle, color: "text-green-500" },
        ].map(kpi => (
          <Card key={kpi.label}><CardContent className="p-4 flex items-center gap-3"><kpi.icon className={`w-8 h-8 ${kpi.color}`} /><div><p className="text-xs text-muted-foreground">{kpi.label}</p><p className="text-lg font-bold">{kpi.value}</p></div></CardContent></Card>
        ))}
      </div>

      <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
        <CardContent className="p-4 text-xs text-amber-800 dark:text-amber-400 space-y-1">
          <p className="font-semibold">⚖️ Applicable State Statutes</p>
          <p><b>Georgia:</b> {GA_STATUTE} — Unconditional waivers must be recorded within 60 days of last furnishing date.</p>
          <p><b>South Carolina:</b> {SC_STATUTE} — Lien must be filed within 90 days of last furnishing. Waivers must reference specific project and payment amount to be enforceable.</p>
        </CardContent>
      </Card>

      {isLoading ? <p className="text-center py-8 text-muted-foreground">Loading...</p> : waivers.length === 0 ? (
        <Card><CardContent className="py-16 text-center"><FileCheck className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-30" /><p className="text-muted-foreground">No lien waivers yet. Create one for any reconstruction job to protect your payment rights.</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {waivers.map((w: any) => {
            const job = jobs.find((j: any) => j.id === w.job_id);
            return (
              <Card key={w.id} data-testid={`waiver-${w.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold">LW-{String(w.id).padStart(4, "0")}</span>
                        {job && <span className="text-sm text-muted-foreground">TP-{String(job.id).padStart(4, "0")} — {job.address?.substring(0, 25)}</span>}
                        <Badge className={STATUS_COLORS[w.status] || ""}>{w.status}</Badge>
                        <Badge variant="outline">{w.state}</Badge>
                      </div>
                      <p className="text-sm font-medium mt-1">{WAIVER_TYPES[w.waiver_type]?.label}</p>
                      <div className="flex gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                        {w.amount && <span>${(w.amount).toLocaleString()}</span>}
                        {w.through_date && <span>Through: {new Date(w.through_date).toLocaleDateString()}</span>}
                        {w.signer_name && <span>Signer: {w.signer_name}</span>}
                      </div>
                    </div>
                    <div className="flex gap-2 items-center shrink-0">
                      <Select defaultValue={w.status} onValueChange={v => updateMutation.mutate({ id: w.id, data: { status: v } })}>
                        <SelectTrigger className="h-8 text-xs w-28" data-testid={`select-status-${w.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{["draft", "sent", "signed", "filed"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" onClick={() => generateWaiver(w)} data-testid={`button-download-${w.id}`}><Download className="w-3 h-3 mr-1" />Generate</Button>
                      <Button size="sm" variant="ghost" className="text-red-500" onClick={() => deleteMutation.mutate(w.id)}>×</Button>
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
