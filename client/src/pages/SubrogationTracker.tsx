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
import { Plus, FileText, DollarSign, Clock, CheckCircle, AlertTriangle, Download, Gavel } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  identified: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  filed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  in_negotiation: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  recovered: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  closed: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
};

const PARTY_TYPES = ["homeowner", "carrier", "contractor", "manufacturer", "municipality", "other"];

export default function SubrogationTracker() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<any>(null);
  const [form, setForm] = useState({
    jobId: "",
    responsibleParty: "",
    partyType: "contractor",
    claimAmount: "",
    recoveredAmount: "",
    status: "identified",
    notes: "",
    filedDate: "",
    expectedRecoveryDate: "",
  });

  const { data: cases = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/subrogation"],
    queryFn: () => apiRequest("/api/subrogation").then((r) => r.json()),
  });

  const { data: jobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest("/api/subrogation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subrogation"] });
      setOpen(false);
      resetForm();
      toast({ title: "Subrogation case created" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) =>
      apiRequest(`/api/subrogation/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subrogation"] });
      setSelectedCase(null);
      toast({ title: "Case updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/api/subrogation/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subrogation"] });
      setSelectedCase(null);
      toast({ title: "Case removed" });
    },
  });

  function resetForm() {
    setForm({ jobId: "", responsibleParty: "", partyType: "contractor", claimAmount: "", recoveredAmount: "", status: "identified", notes: "", filedDate: "", expectedRecoveryDate: "" });
  }

  function handleCreate() {
    createMutation.mutate({
      jobId: form.jobId ? parseInt(form.jobId) : null,
      responsibleParty: form.responsibleParty,
      partyType: form.partyType,
      claimAmount: form.claimAmount ? parseFloat(form.claimAmount) : null,
      recoveredAmount: form.recoveredAmount ? parseFloat(form.recoveredAmount) : null,
      status: form.status,
      notes: form.notes,
      filedDate: form.filedDate || null,
      expectedRecoveryDate: form.expectedRecoveryDate || null,
    });
  }

  function generatePackage(c: any) {
    const job = jobs.find((j: any) => j.id === c.jobId);
    const lines = [
      "SUBROGATION DOCUMENTATION PACKAGE",
      "Titan Restoration LLC",
      "706-922-0154 | titanrestorationllc.com",
      "=".repeat(50),
      "",
      `Case ID: SR-${String(c.id).padStart(4, "0")}`,
      `Job: ${job ? `TP-${String(job.id).padStart(4, "0")} — ${job.address || "N/A"}` : "No linked job"}`,
      `Loss Type: ${job?.lossType || "N/A"}`,
      `Status: ${c.status?.toUpperCase()}`,
      `Filed: ${c.filedDate || "Not filed"}`,
      "",
      "RESPONSIBLE PARTY",
      `Name: ${c.responsibleParty}`,
      `Type: ${c.partyType}`,
      "",
      "FINANCIAL SUMMARY",
      `Claim Amount: $${(c.claimAmount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      `Recovered: $${(c.recoveredAmount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      `Outstanding: $${((c.claimAmount || 0) - (c.recoveredAmount || 0)).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
      "",
      "NOTES / LEGAL BASIS",
      c.notes || "None provided",
      "",
      "APPLICABLE STANDARDS",
      "• IICRC S500 — Standard for Professional Water Damage Restoration",
      "• SC Code § 38-59-20 — Unfair Claim Settlement Practices Act",
      "• GA Code § 33-6-34 — Unfair Claims Settlement Practices",
      "",
      `Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `subrogation-SR${String(c.id).padStart(4, "0")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Package downloaded" });
  }

  const totalClaim = cases.reduce((s: number, c: any) => s + (c.claimAmount || 0), 0);
  const totalRecovered = cases.reduce((s: number, c: any) => s + (c.recoveredAmount || 0), 0);
  const openCases = cases.filter((c: any) => !["recovered", "closed"].includes(c.status));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Gavel className="w-5 h-5 text-primary" /> Subrogation Tracker
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Track third-party liability claims and generate documentation packages</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-case"><Plus className="w-4 h-4 mr-2" />New Case</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New Subrogation Case</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
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
                  <Label>Responsible Party</Label>
                  <Input data-testid="input-party" value={form.responsibleParty} onChange={(e) => setForm({ ...form, responsibleParty: e.target.value })} placeholder="Party name" />
                </div>
                <div>
                  <Label>Party Type</Label>
                  <Select value={form.partyType} onValueChange={(v) => setForm({ ...form, partyType: v })}>
                    <SelectTrigger data-testid="select-party-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PARTY_TYPES.map((t) => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Claim Amount ($)</Label>
                  <Input data-testid="input-claim-amount" type="number" value={form.claimAmount} onChange={(e) => setForm({ ...form, claimAmount: e.target.value })} placeholder="0.00" />
                </div>
                <div>
                  <Label>Recovered Amount ($)</Label>
                  <Input data-testid="input-recovered-amount" type="number" value={form.recoveredAmount} onChange={(e) => setForm({ ...form, recoveredAmount: e.target.value })} placeholder="0.00" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Filed Date</Label>
                  <Input data-testid="input-filed-date" type="date" value={form.filedDate} onChange={(e) => setForm({ ...form, filedDate: e.target.value })} />
                </div>
                <div>
                  <Label>Expected Recovery</Label>
                  <Input data-testid="input-expected-recovery" type="date" value={form.expectedRecoveryDate} onChange={(e) => setForm({ ...form, expectedRecoveryDate: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Notes / Legal Basis</Label>
                <Textarea data-testid="input-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Describe liability basis, evidence, statutes..." />
              </div>
              <Button data-testid="button-create-case" className="w-full" onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Case"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Cases", value: cases.length, icon: FileText, color: "text-primary" },
          { label: "Open Cases", value: openCases.length, icon: Clock, color: "text-yellow-500" },
          { label: "Total Claimed", value: `$${totalClaim.toLocaleString("en-US", { minimumFractionDigits: 0 })}`, icon: DollarSign, color: "text-blue-500" },
          { label: "Total Recovered", value: `$${totalRecovered.toLocaleString("en-US", { minimumFractionDigits: 0 })}`, icon: CheckCircle, color: "text-green-500" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <kpi.icon className={`w-8 h-8 ${kpi.color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-lg font-bold" data-testid={`kpi-${kpi.label.toLowerCase().replace(/ /g, "-")}`}>{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Cases List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading cases...</div>
      ) : cases.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Gavel className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-muted-foreground">No subrogation cases yet. Create one when a third party is responsible for damages.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {cases.map((c: any) => {
            const job = jobs.find((j: any) => j.id === c.jobId);
            const outstanding = (c.claimAmount || 0) - (c.recoveredAmount || 0);
            return (
              <Card key={c.id} className="cursor-pointer hover:shadow-md transition-shadow" data-testid={`card-subrogation-${c.id}`} onClick={() => setSelectedCase(c)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-sm">SR-{String(c.id).padStart(4, "0")}</span>
                        {job && <span className="text-sm text-muted-foreground">→ TP-{String(job.id).padStart(4, "0")}</span>}
                        <Badge className={STATUS_COLORS[c.status] || ""}>{c.status?.replace("_", " ")}</Badge>
                        <Badge variant="outline">{c.partyType}</Badge>
                      </div>
                      <p className="font-semibold mt-1">{c.responsibleParty || "Unknown Party"}</p>
                      {job && <p className="text-xs text-muted-foreground mt-0.5">{job.address} · {job.lossType}</p>}
                      {c.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{c.notes}</p>}
                    </div>
                    <div className="text-right space-y-1 shrink-0">
                      <p className="text-sm font-bold">${(c.claimAmount || 0).toLocaleString()}</p>
                      <p className="text-xs text-green-600 dark:text-green-400">Rec: ${(c.recoveredAmount || 0).toLocaleString()}</p>
                      {outstanding > 0 && <p className="text-xs text-red-500">Out: ${outstanding.toLocaleString()}</p>}
                    </div>
                    <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); generatePackage(c); }} data-testid={`button-download-${c.id}`}>
                      <Download className="w-3 h-3 mr-1" /> Package
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail Dialog */}
      {selectedCase && (
        <Dialog open={!!selectedCase} onOpenChange={() => setSelectedCase(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>SR-{String(selectedCase.id).padStart(4, "0")} — {selectedCase.responsibleParty}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Status</Label>
                  <Select defaultValue={selectedCase.status} onValueChange={(v) => updateMutation.mutate({ id: selectedCase.id, data: { status: v } })}>
                    <SelectTrigger data-testid="select-update-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.keys(STATUS_COLORS).map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ").toUpperCase()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Recovered Amount ($)</Label>
                  <Input
                    data-testid="input-update-recovered"
                    type="number"
                    defaultValue={selectedCase.recoveredAmount || ""}
                    onBlur={(e) => updateMutation.mutate({ id: selectedCase.id, data: { recoveredAmount: parseFloat(e.target.value) || 0 } })}
                  />
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea
                  data-testid="input-update-notes"
                  defaultValue={selectedCase.notes || ""}
                  rows={4}
                  onBlur={(e) => updateMutation.mutate({ id: selectedCase.id, data: { notes: e.target.value } })}
                />
              </div>
              <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
                <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wide mb-2">Applicable Statutes</p>
                <p className="text-xs flex items-start gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-yellow-500" /> <span><b>SC § 38-59-20</b> — Unfair Claim Settlement Practices Act (30-day acknowledgment requirement)</span></p>
                <p className="text-xs flex items-start gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-yellow-500" /> <span><b>GA § 33-6-34</b> — Unfair Claims Settlement Practices (15-day investigation duty)</span></p>
                <p className="text-xs flex items-start gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-yellow-500" /> <span><b>IICRC S500</b> — Standard documentation supports subrogation recovery</span></p>
              </div>
              <div className="flex gap-2">
                <Button className="flex-1" variant="outline" onClick={() => generatePackage(selectedCase)} data-testid="button-gen-package">
                  <Download className="w-4 h-4 mr-2" /> Generate Package
                </Button>
                <Button variant="destructive" onClick={() => deleteMutation.mutate(selectedCase.id)} data-testid="button-delete-case">Delete</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
