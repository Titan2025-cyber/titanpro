import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { Plus, CheckCircle, AlertTriangle, ClipboardList, ShieldCheck } from "lucide-react";

const STANDARD_OPTIONS = [
  { value: "S500", label: "S500 — Water Damage Restoration" },
  { value: "S520", label: "S520 — Mold Remediation" },
  { value: "S700", label: "S700 — Fire & Smoke (2025)" },
];

const CATEGORY_OPTIONS: Record<string, { value: string; label: string }[]> = {
  S500: [
    { value: "cat1_water", label: "Category 1 — Clean Water" },
    { value: "cat2_water", label: "Category 2 — Gray Water" },
    { value: "cat3_water", label: "Category 3 — Black Water (use Cat 2 protocol)" },
  ],
  S520: [{ value: "mold", label: "Mold Remediation (any class)" }],
  S700: [{ value: "fire_smoke", label: "Fire & Smoke Restoration" }],
};

export default function IICRCCompliance() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [newForm, setNewForm] = useState({ jobId: "", standard: "S500", lossCategory: "cat1_water", techName: "", preBuiltVintage: false });

  const { data: checklists = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/compliance-checklists"], queryFn: () => apiRequest("/api/compliance-checklists").then(r => r.json()) });

  const createChecklist = useMutation({
    mutationFn: (d: any) => apiRequest("/api/compliance-checklists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }).then(r => r.json()),
    onSuccess: (data) => { qc.invalidateQueries({ queryKey: ["/api/compliance-checklists"] }); setShowNew(false); setActiveId(data.id); },
  });
  const updateChecklist = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest(`/api/compliance-checklists/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/compliance-checklists"] }),
  });

  const { data: checklistItems } = useQuery<any>({
    queryKey: ["/api/iicrc-checklist-items", activeId],
    queryFn: () => {
      const cl = checklists.find((c: any) => c.id === activeId);
      if (!cl) return { items: [] };
      return apiRequest(`/api/iicrc-checklist-items?standard=${cl.standard}&lossCategory=${cl.loss_category}`).then(r => r.json());
    },
    enabled: activeId !== null && checklists.length > 0,
  });

  const activeChecklist = checklists.find((c: any) => c.id === activeId);
  const completedItems = activeChecklist ? JSON.parse(activeChecklist.completed_items || "[]") : [];
  const flaggedItems = activeChecklist ? JSON.parse(activeChecklist.flagged_items || "[]") : [];

  const toggleItem = (itemId: string, flag = false) => {
    if (!activeChecklist) return;
    const isCompleted = completedItems.includes(itemId);
    const newCompleted = isCompleted ? completedItems.filter((i: string) => i !== itemId) : [...completedItems, itemId];
    const isFlagged = flaggedItems.includes(itemId);
    const newFlagged = isFlagged ? flaggedItems.filter((i: string) => i !== itemId) : flag ? [...flaggedItems, itemId] : flaggedItems;
    const total = checklistItems?.items?.length || 1;
    const pct = newCompleted.length / total;
    const overallStatus = pct === 1 ? "compliant" : pct >= 0.5 ? "in_progress" : "incomplete";
    updateChecklist.mutate({ id: activeId, data: { completedItems: newCompleted, flaggedItems: newFlagged, overallStatus } });
  };

  const statusColor = (s: string) => s === "compliant" ? "text-green-600" : s === "in_progress" ? "text-yellow-600" : s === "non_compliant" ? "text-red-600" : "text-muted-foreground";
  const statusBadge = (s: string) => s === "compliant" ? "secondary" : s === "in_progress" ? "outline" : "destructive";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">IICRC Compliance Engine</h1>
          <p className="text-sm text-muted-foreground">S500 · S520 · S700 (2025) · S900 dynamic compliance checklists</p>
        </div>
        <Dialog open={showNew} onOpenChange={setShowNew}>
          <DialogTrigger asChild>
            <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white" data-testid="button-new-checklist"><Plus className="w-4 h-4 mr-2" />New Checklist</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Start IICRC Compliance Checklist</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Job ID" value={newForm.jobId} onChange={e => setNewForm(f => ({ ...f, jobId: e.target.value }))} data-testid="input-job-id" />
              <Input placeholder="Technician name" value={newForm.techName} onChange={e => setNewForm(f => ({ ...f, techName: e.target.value }))} data-testid="input-tech-name" />
              <Select value={newForm.standard} onValueChange={v => setNewForm(f => ({ ...f, standard: v, lossCategory: CATEGORY_OPTIONS[v][0].value }))}>
                <SelectTrigger data-testid="select-standard"><SelectValue /></SelectTrigger>
                <SelectContent>{STANDARD_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={newForm.lossCategory} onValueChange={v => setNewForm(f => ({ ...f, lossCategory: v }))}>
                <SelectTrigger data-testid="select-category"><SelectValue /></SelectTrigger>
                <SelectContent>{(CATEGORY_OPTIONS[newForm.standard] || []).map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={newForm.preBuiltVintage} onChange={e => setNewForm(f => ({ ...f, preBuiltVintage: e.target.checked }))} />
                Pre-1978 building (triggers lead/asbestos documentation)
              </label>
              <Button className="w-full bg-[hsl(var(--titan-blue))] text-white" onClick={() => createChecklist.mutate({ jobId: Number(newForm.jobId), standard: newForm.standard, lossCategory: newForm.lossCategory, techName: newForm.techName || undefined, preBuiltVintage: newForm.preBuiltVintage })} disabled={!newForm.jobId} data-testid="button-create-checklist">Create Checklist</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className={`grid gap-6 ${activeId ? "lg:grid-cols-3" : ""}`}>
        {/* Checklist list */}
        <div className={activeId ? "lg:col-span-1" : ""}>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : checklists.length === 0 ? (
            <Card><CardContent className="p-8 text-center">
              <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">No compliance checklists</p>
              <p className="text-sm text-muted-foreground mt-1">Start a checklist for any active job to ensure IICRC compliance and prevent claim disputes</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {checklists.map((cl: any) => {
                const completed = JSON.parse(cl.completed_items || "[]").length;
                return (
                  <Card key={cl.id} className={`cursor-pointer transition-all hover:shadow-md ${activeId === cl.id ? "ring-2 ring-[hsl(var(--titan-blue))]" : ""}`} onClick={() => setActiveId(cl.id === activeId ? null : cl.id)} data-testid={`card-checklist-${cl.id}`}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-sm">{cl.standard} — {cl.loss_category.replace(/_/g, " ")}</p>
                          <p className="text-xs text-muted-foreground">Job #{cl.job_id}{cl.tech_name ? ` · ${cl.tech_name}` : ""}</p>
                        </div>
                        <Badge variant={statusBadge(cl.overall_status) as any} className="text-xs">{cl.overall_status.replace(/_/g, " ")}</Badge>
                      </div>
                      <div className="mt-2">
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${cl.overall_status === "compliant" ? "bg-green-500" : "bg-[hsl(var(--titan-blue))]"}`} style={{ width: `${completed > 0 ? "50" : "0"}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{completed} items completed · {cl.pre_built_vintage ? "⚠️ Pre-1978" : ""}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Active checklist detail */}
        {activeId && activeChecklist && (
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
                    {activeChecklist.standard} Checklist — Job #{activeChecklist.job_id}
                  </CardTitle>
                  <Badge variant={statusBadge(activeChecklist.overall_status) as any}>{activeChecklist.overall_status.replace(/_/g, " ")}</Badge>
                </div>
                {activeChecklist.pre_built_vintage === 1 && (
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-2 text-xs text-yellow-800 dark:text-yellow-400 flex items-center gap-2 mt-2">
                    <AlertTriangle className="w-3 h-3" />
                    Pre-1978 building: Lead-safe documentation and asbestos survey may be required per EPA RRP Rule
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                {checklistItems?.items?.map((item: any) => {
                  const isCompleted = completedItems.includes(item.id);
                  const isFlagged = flaggedItems.includes(item.id);
                  return (
                    <div key={item.id} className={`flex items-start gap-3 p-3 rounded-lg border transition-all ${isCompleted ? "bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800" : isFlagged ? "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800" : "bg-muted/20 border-border"}`} data-testid={`item-${item.id}`}>
                      <button onClick={() => toggleItem(item.id)} className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${isCompleted ? "bg-green-500 border-green-500" : "border-muted-foreground"}`}>
                        {isCompleted && <CheckCircle className="w-3 h-3 text-white" />}
                      </button>
                      <div className="flex-1">
                        <p className={`text-sm ${isCompleted ? "line-through text-muted-foreground" : ""}`}>{item.item}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.standard}{item.required ? " · Required" : " · Recommended"}</p>
                      </div>
                      {!isCompleted && (
                        <button onClick={() => toggleItem(item.id, true)} className="text-xs text-red-500 hover:text-red-700 shrink-0">⚑ Flag</button>
                      )}
                      {isFlagged && <Badge variant="destructive" className="text-xs shrink-0">Flagged</Badge>}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
