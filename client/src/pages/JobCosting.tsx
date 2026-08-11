import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  DollarSign, TrendingUp, TrendingDown, Plus, Trash2, Download,
  BarChart3, Pencil, Check, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fmtDateShort } from "@/lib/dates";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface Job {
  id: number;
  jobNumber: string;
  address?: string;
  status?: string;
}

interface Estimate {
  id: number;
  total: number;
  status?: string;
}

interface JobCost {
  id: number;
  jobId: number;
  category: string;
  description: string;
  vendor?: string | null;
  quantity: number;
  unitCost: number;
  total: number;
  costDate: string;
  enteredBy?: string | null;
  phase?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const COST_CATEGORIES = [
  { value: "labor", label: "Labor" },
  { value: "material", label: "Material" },
  { value: "subcontractor", label: "Subcontractor" },
  { value: "equipment", label: "Equipment" },
  { value: "overhead", label: "Overhead" },
  { value: "other", label: "Other" },
];

const CATEGORY_COLORS: Record<string, string> = {
  labor: "bg-blue-100 text-blue-800 border-blue-200",
  material: "bg-green-100 text-green-800 border-green-200",
  subcontractor: "bg-purple-100 text-purple-800 border-purple-200",
  equipment: "bg-orange-100 text-orange-800 border-orange-200",
  overhead: "bg-gray-100 text-gray-700 border-gray-200",
  other: "bg-yellow-100 text-yellow-800 border-yellow-200",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function fmt(n: number) {
  // Guard against undefined/null/NaN so a single bad value never crashes the
  // whole page render.
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function marginColor(pct: number) {
  if (pct >= 40) return "text-green-700";
  if (pct >= 20) return "text-yellow-600";
  return "text-[hsl(var(--titan-red))]";
}

function marginBadge(pct: number) {
  if (pct >= 40)
    return <Badge className="bg-green-100 text-green-800 border-green-200 border">{pct.toFixed(1)}%</Badge>;
  if (pct >= 20)
    return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 border">{pct.toFixed(1)}%</Badge>;
  return <Badge className="bg-red-100 text-[hsl(var(--titan-red))] border-red-200 border">{pct.toFixed(1)}%</Badge>;
}

function exportCsv(costs: JobCost[], jobNumber: string) {
  const headers = ["Date", "Category", "Description", "Vendor", "Qty", "Unit Cost", "Total", "Entered By"];
  const rows = costs.map((c) => [
    c.costDate ? fmtDateShort(c.costDate) : "",
    c.category,
    `"${(c.description ?? "").replace(/"/g, '""')}"`,
    c.vendor ?? "",
    c.quantity ?? "",
    (c.unitCost ?? 0).toFixed(2),
    (c.total ?? 0).toFixed(2),
    c.enteredBy ?? "",
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `job-costs-${jobNumber}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Cost Form
// ─────────────────────────────────────────────────────────────────────────────
interface AddCostFormProps {
  jobId: number;
  phase?: string;
}

function AddCostForm({ jobId, phase }: AddCostFormProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    category: "",
    description: "",
    vendor: "",
    quantity: "1",
    unitCost: "",
    costDate: new Date().toISOString().split("T")[0],
    enteredBy: "",
  });

  const qty = parseFloat(form.quantity) || 0;
  const unitCost = parseFloat(form.unitCost) || 0;
  const autoTotal = qty * unitCost;

  const addCost = useMutation({
    mutationFn: (data: object) => apiRequest("POST", `/api/jobs/${jobId}/costs`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "costs"] });
      toast({ title: "Cost added" });
      setForm({
        category: "", description: "", vendor: "", quantity: "1",
        unitCost: "", costDate: new Date().toISOString().split("T")[0], enteredBy: "",
      });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    addCost.mutate({
      category: form.category,
      description: form.description,
      vendor: form.vendor,
      quantity: qty,
      unitCost,
      total: autoTotal,
      costDate: form.costDate,
      enteredBy: form.enteredBy,
      phase: phase && phase !== "both" ? phase : "mitigation",
    });
  }

  return (
    <form onSubmit={submit} data-testid="add-cost-form" className="bg-muted/30 border rounded-lg p-4">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
        <Plus className="w-4 h-4 text-[hsl(var(--titan-blue))]" /> Add Cost Entry
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Category */}
        <div>
          <Label htmlFor={`cost-category-${jobId}`} className="text-xs">Category</Label>
          <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })} required>
            <SelectTrigger id={`cost-category-${jobId}`} data-testid="cost-category-select" className="h-8 text-sm">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {COST_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Description */}
        <div className="sm:col-span-1 lg:col-span-1">
          <Label htmlFor={`cost-desc-${jobId}`} className="text-xs">Description</Label>
          <Input id={`cost-desc-${jobId}`} data-testid="cost-description-input"
            className="h-8 text-sm" placeholder="Labor hours, material…"
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
        </div>

        {/* Vendor */}
        <div>
          <Label htmlFor={`cost-vendor-${jobId}`} className="text-xs">Vendor</Label>
          <Input id={`cost-vendor-${jobId}`} data-testid="cost-vendor-input"
            className="h-8 text-sm" placeholder="Optional"
            value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
        </div>

        {/* Date */}
        <div>
          <Label htmlFor={`cost-date-${jobId}`} className="text-xs">Date</Label>
          <Input id={`cost-date-${jobId}`} data-testid="cost-date-input" type="date"
            className="h-8 text-sm" value={form.costDate}
            onChange={(e) => setForm({ ...form, costDate: e.target.value })} required />
        </div>

        {/* Qty */}
        <div>
          <Label htmlFor={`cost-qty-${jobId}`} className="text-xs">Qty</Label>
          <Input id={`cost-qty-${jobId}`} data-testid="cost-qty-input" type="number"
            min="0" step="any" className="h-8 text-sm" placeholder="1"
            value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
        </div>

        {/* Unit Cost */}
        <div>
          <Label htmlFor={`cost-unit-${jobId}`} className="text-xs">Unit Cost ($)</Label>
          <Input id={`cost-unit-${jobId}`} data-testid="cost-unit-input" type="number"
            min="0" step="0.01" className="h-8 text-sm" placeholder="0.00"
            value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} required />
        </div>

        {/* Auto Total */}
        <div>
          <Label className="text-xs">Total (auto)</Label>
          <div className="h-8 flex items-center text-sm font-semibold text-[hsl(var(--titan-blue))]"
            data-testid="cost-auto-total">
            {autoTotal > 0 ? fmt(autoTotal) : "—"}
          </div>
        </div>

        {/* Entered By */}
        <div>
          <Label htmlFor={`cost-by-${jobId}`} className="text-xs">Entered By</Label>
          <Input id={`cost-by-${jobId}`} data-testid="cost-entered-by-input"
            className="h-8 text-sm" placeholder="Name"
            value={form.enteredBy} onChange={(e) => setForm({ ...form, enteredBy: e.target.value })} />
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <Button type="submit" data-testid="add-cost-submit-btn" disabled={addCost.isPending}
          className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue)/0.85)] text-white h-8 px-4 text-sm">
          {addCost.isPending ? "Adding…" : "Add Cost"}
        </Button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Category Breakdown
// ─────────────────────────────────────────────────────────────────────────────
function CategoryBreakdown({ costs }: { costs: JobCost[] }) {
  const breakdown = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of costs) {
      map[c.category] = (map[c.category] ?? 0) + (c.total ?? 0);
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [costs]);

  if (breakdown.length === 0) return null;

  return (
    <div className="border rounded-lg overflow-hidden" data-testid="category-breakdown">
      <div className="px-4 py-2.5 bg-muted/40 border-b">
        <span className="text-sm font-semibold flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4 text-[hsl(var(--titan-blue))]" /> Cost by Category
        </span>
      </div>
      <div className="divide-y">
        {breakdown.map(([cat, total]) => (
          <div key={cat} className="flex items-center justify-between px-4 py-2.5"
            data-testid={`category-row-${cat}`}>
            <Badge className={`${CATEGORY_COLORS[cat] ?? "bg-gray-100 text-gray-700"} border text-xs capitalize`}>
              {cat}
            </Badge>
            <span className="text-sm font-medium">{fmt(total)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 font-semibold text-sm">
          <span>Total</span>
          <span>{fmt(breakdown.reduce((s, [, v]) => s + v, 0))}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Panel (shared between page and embedded component)
// ─────────────────────────────────────────────────────────────────────────────
interface JobCostingPanelProps {
  jobId: number;
  phase?: string;
}

export function JobCostingPanel({ jobId, phase }: JobCostingPanelProps) {
  const { toast } = useToast();

  const { data: allCosts = [], isLoading: costsLoading } = useQuery<JobCost[]>({
    queryKey: ["/api/jobs", String(jobId), "costs"],
  });

  const { data: allEstimates = [] } = useQuery<Estimate[]>({
    queryKey: ["/api/jobs", String(jobId), "estimates"],
  });

  // Phase filtering — null/undefined phase treated as 'mitigation'; 'both' shows all
  const costs = useMemo(
    () => (!phase || phase === "both" ? allCosts : allCosts.filter((c) => ((c.phase as string) || "mitigation") === phase)),
    [allCosts, phase]
  );
  const estimates = useMemo(
    () => (!phase || phase === "both" ? allEstimates : allEstimates.filter((e) => (((e as any).phase as string) || "mitigation") === phase)),
    [allEstimates, phase]
  );

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
  });

  const job = jobs.find((j) => j.id === jobId);

  // Inline edit state — which cost row is being edited + the working draft.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<JobCost>>({});

  const startEdit = (c: JobCost) => {
    setEditingId(c.id);
    setEditDraft({
      category: c.category,
      description: c.description,
      vendor: c.vendor ?? "",
      quantity: c.quantity,
      unitCost: c.unitCost,
      costDate: c.costDate ? String(c.costDate).slice(0, 10) : "",
    });
  };
  const cancelEdit = () => { setEditingId(null); setEditDraft({}); };

  const updateCost = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PATCH", `/api/costs/${id}`, data).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "costs"] });
      cancelEdit();
      toast({ title: "Cost updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  const saveEdit = () => {
    if (editingId == null) return;
    const q = Number(editDraft.quantity) || 0;
    const u = Number(editDraft.unitCost) || 0;
    if (!editDraft.description || !String(editDraft.description).trim()) {
      toast({ title: "Description is required", variant: "destructive" }); return;
    }
    updateCost.mutate({
      id: editingId,
      data: {
        category: editDraft.category || "other",
        description: String(editDraft.description).trim(),
        vendor: editDraft.vendor || null,
        quantity: q,
        unitCost: u,
        costDate: editDraft.costDate || null,
      },
    });
  };

  const deleteCost = useMutation({
    mutationFn: (costId: number) => apiRequest("DELETE", `/api/costs/${costId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(jobId), "costs"] });
      toast({ title: "Cost deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Totals
  const estimateTotal = useMemo(
    () => estimates.reduce((s, e) => s + (e.total ?? 0), 0),
    [estimates]
  );
  const actualTotal = useMemo(
    () => costs.reduce((s, c) => s + (c.total ?? 0), 0),
    [costs]
  );
  const grossMarginDollar = estimateTotal - actualTotal;
  const grossMarginPct = estimateTotal > 0 ? (grossMarginDollar / estimateTotal) * 100 : 0;

  return (
    <div className="space-y-5" data-testid={`job-costing-panel-${jobId}`}>
      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card data-testid="kpi-estimate">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground mb-0.5">Estimate Total</div>
            <div className="text-lg font-bold">{fmt(estimateTotal)}</div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-actual">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground mb-0.5">Actual Costs</div>
            <div className="text-lg font-bold">{fmt(actualTotal)}</div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-margin-dollar">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
              {grossMarginDollar >= 0
                ? <TrendingUp className="w-3 h-3 text-green-600" />
                : <TrendingDown className="w-3 h-3 text-[hsl(var(--titan-red))]" />}
              Gross Margin
            </div>
            <div className={`text-lg font-bold ${grossMarginDollar >= 0 ? "text-green-700" : "text-[hsl(var(--titan-red))]"}`}>
              {fmt(grossMarginDollar)}
            </div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-margin-pct">
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground mb-0.5">Margin %</div>
            <div className={`text-lg font-bold ${marginColor(grossMarginPct)}`}>
              {marginBadge(grossMarginPct)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add Cost Form */}
      <AddCostForm jobId={jobId} phase={phase} />

      {/* Cost Table + Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Table */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Cost Entries</span>
            {costs.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => exportCsv(costs, job?.jobNumber ?? String(jobId))}
                data-testid="export-csv-btn"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </Button>
            )}
          </div>

          {costsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : costs.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm border rounded-lg"
              data-testid="empty-costs">
              <DollarSign className="w-8 h-8 mx-auto mb-1.5 opacity-25" />
              No costs recorded yet. Add the first entry above.
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <Table data-testid="cost-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs w-24">Date</TableHead>
                      <TableHead className="text-xs">Category</TableHead>
                      <TableHead className="text-xs">Description</TableHead>
                      <TableHead className="text-xs hidden sm:table-cell">Vendor</TableHead>
                      <TableHead className="text-xs text-right">Qty</TableHead>
                      <TableHead className="text-xs text-right">Unit $</TableHead>
                      <TableHead className="text-xs text-right">Total</TableHead>
                      <TableHead className="text-xs w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {costs.map((c) => {
                      const isEditing = editingId === c.id;
                      if (isEditing) {
                        const liveTotal = (Number(editDraft.quantity) || 0) * (Number(editDraft.unitCost) || 0);
                        return (
                          <TableRow key={c.id} data-testid={`cost-row-${c.id}`} className="bg-muted/40">
                            <TableCell className="py-1.5">
                              <Input type="date" className="h-7 text-xs w-32"
                                value={editDraft.costDate as string || ""}
                                data-testid={`edit-cost-date-${c.id}`}
                                onChange={(e) => setEditDraft({ ...editDraft, costDate: e.target.value })} />
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Select value={editDraft.category as string} onValueChange={(v) => setEditDraft({ ...editDraft, category: v })}>
                                <SelectTrigger className="h-7 text-xs w-32" data-testid={`edit-cost-category-${c.id}`}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {COST_CATEGORIES.map((cat) => (
                                    <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="py-1.5">
                              <Input className="h-7 text-xs min-w-[160px]"
                                value={editDraft.description as string || ""}
                                data-testid={`edit-cost-description-${c.id}`}
                                onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })} />
                            </TableCell>
                            <TableCell className="py-1.5 hidden sm:table-cell">
                              <Input className="h-7 text-xs w-28"
                                value={editDraft.vendor as string || ""}
                                data-testid={`edit-cost-vendor-${c.id}`}
                                onChange={(e) => setEditDraft({ ...editDraft, vendor: e.target.value })} />
                            </TableCell>
                            <TableCell className="py-1.5 text-right">
                              <Input type="number" step="any" className="h-7 text-xs text-right w-16"
                                value={String(editDraft.quantity ?? "")}
                                data-testid={`edit-cost-qty-${c.id}`}
                                onChange={(e) => setEditDraft({ ...editDraft, quantity: e.target.value as any })} />
                            </TableCell>
                            <TableCell className="py-1.5 text-right">
                              <Input type="number" step="0.01" className="h-7 text-xs text-right w-20"
                                value={String(editDraft.unitCost ?? "")}
                                data-testid={`edit-cost-unit-${c.id}`}
                                onChange={(e) => setEditDraft({ ...editDraft, unitCost: e.target.value as any })} />
                            </TableCell>
                            <TableCell className="text-xs py-1.5 text-right font-medium">{fmt(liveTotal)}</TableCell>
                            <TableCell className="py-1.5">
                              <div className="flex items-center justify-end gap-1">
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-green-600 hover:text-green-700"
                                  onClick={saveEdit} disabled={updateCost.isPending}
                                  data-testid={`save-cost-btn-${c.id}`}>
                                  <Check className="w-4 h-4" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground"
                                  onClick={cancelEdit} data-testid={`cancel-cost-btn-${c.id}`}>
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }
                      return (
                      <TableRow key={c.id} data-testid={`cost-row-${c.id}`}>
                        <TableCell className="text-xs py-2">
                          {c.costDate ? fmtDateShort(c.costDate) : "—"}
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge className={`${CATEGORY_COLORS[c.category] ?? "bg-gray-100 text-gray-700"} border text-xs capitalize`}>
                            {c.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs py-2 max-w-[180px] truncate">{c.description}</TableCell>
                        <TableCell className="text-xs py-2 hidden sm:table-cell text-muted-foreground">
                          {c.vendor ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs py-2 text-right">{c.quantity}</TableCell>
                        <TableCell className="text-xs py-2 text-right">{fmt(c.unitCost)}</TableCell>
                        <TableCell className="text-xs py-2 text-right font-medium">{fmt(c.total)}</TableCell>
                        <TableCell className="py-2">
                          <div className="flex items-center justify-end gap-0.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-[hsl(var(--titan-blue))]"
                            onClick={() => startEdit(c)}
                            data-testid={`edit-cost-btn-${c.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                data-testid={`delete-cost-btn-${c.id}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete cost entry?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  "{c.description}" — {fmt(c.total)} will be permanently removed.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => deleteCost.mutate(c.id)}
                                  data-testid={`confirm-delete-cost-${c.id}`}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {/* Table footer total */}
              <div className="flex justify-end px-4 py-2.5 border-t bg-muted/30 text-sm font-semibold">
                <span className="mr-4 text-muted-foreground">Total</span>
                <span data-testid="costs-grand-total">{fmt(actualTotal)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Category Breakdown */}
        <div>
          <CategoryBreakdown costs={costs} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone Job Costing Page
// ─────────────────────────────────────────────────────────────────────────────
export default function JobCosting() {
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);

  const { data: jobs = [], isLoading: jobsLoading } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
  });

  const selectedJob = jobs.find((j) => j.id === selectedJobId);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-[hsl(var(--titan-blue))]" />
            Job Costing
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Track actual costs and margins per job
          </p>
        </div>

        {/* Job Selector */}
        <div className="flex items-center gap-2 min-w-[260px]">
          <Label htmlFor="job-selector" className="text-sm font-medium shrink-0">Job:</Label>
          <Select
            value={selectedJobId ? String(selectedJobId) : ""}
            onValueChange={(v) => setSelectedJobId(parseInt(v))}
          >
            <SelectTrigger id="job-selector" data-testid="job-selector" className="flex-1">
              <SelectValue placeholder={jobsLoading ? "Loading jobs…" : "Select a job"} />
            </SelectTrigger>
            <SelectContent>
              {jobs.map((j) => (
                <SelectItem key={j.id} value={String(j.id)} data-testid={`job-option-${j.id}`}>
                  {j.jobNumber}{j.address ? ` — ${j.address}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator />

      {/* Content */}
      {!selectedJobId ? (
        <div className="py-20 text-center text-muted-foreground" data-testid="no-job-selected">
          <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-25" />
          <div className="text-base font-medium">Select a job to view cost breakdown</div>
          <div className="text-sm mt-1 opacity-70">
            Choose from the dropdown above to get started
          </div>
        </div>
      ) : (
        <div>
          {selectedJob && (
            <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{selectedJob.jobNumber}</span>
              {selectedJob.address && <span>· {selectedJob.address}</span>}
            </div>
          )}
          <JobCostingPanel jobId={selectedJobId} />
        </div>
      )}
    </div>
  );
}
