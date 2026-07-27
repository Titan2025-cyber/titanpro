import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Package, Plus, Trash2, AlertTriangle, PackagePlus, SlidersHorizontal,
  ArrowRightCircle, History, Search, ClipboardList, Mail, Download, Pencil,
  FileUp, Sparkles, Loader2, X as XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────
interface Consumable {
  id: number;
  name: string;
  sku?: string | null;
  category: string;
  unit: string;
  onHand: number;
  reorderPoint: number;
  unitCost: number;
  vendor?: string | null;
  location?: string | null;
  notes?: string | null;
  isActive: boolean;
  lowStock: boolean;
  createdAt: string;
}
interface ConsumableTxn {
  id: number;
  consumableId: number;
  type: string;
  quantity: number;
  unitCost: number;
  jobId?: number | null;
  source?: string | null;
  reference?: string | null;
  enteredBy?: string | null;
  balanceAfter?: number | null;
  createdAt: string;
}
interface Job {
  id: number;
  jobNumber: string;
  address?: string;
}
interface ReorderGroup {
  vendor: string;
  estTotal: number;
  items: Array<Consumable & { suggestedQty: number; estCost: number }>;
}
interface ReorderReport {
  count: number;
  estGrandTotal: number;
  groups: ReorderGroup[];
  items: Array<Consumable & { suggestedQty: number; estCost: number }>;
}

const money = (n?: number) =>
  (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

const errMsg = (e: unknown) => {
  const raw = e instanceof Error ? e.message : String(e);
  const m = raw.match(/^\d+:\s*(.*)$/);
  if (m) {
    try { const j = JSON.parse(m[1]); if (j?.error) return j.error; } catch { /* noop */ }
    return m[1];
  }
  return raw;
};

const TXN_LABEL: Record<string, string> = {
  restock: "Restock", usage: "Used on job", adjustment: "Adjustment",
};

// ── Component ────────────────────────────────────────────────────────────────
export default function Consumables() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);

  const { data: items = [], isLoading } = useQuery<Consumable[]>({
    queryKey: ["/api/consumables"],
  });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => i.category && set.add(i.category));
    return ["all", ...Array.from(set).sort()];
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (category !== "all" && i.category !== category) return false;
      if (lowOnly && !i.lowStock) return false;
      if (q && !(`${i.name} ${i.sku ?? ""} ${i.vendor ?? ""} ${i.location ?? ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [items, search, category, lowOnly]);

  const lowCount = items.filter((i) => i.lowStock).length;
  const totalValue = items.reduce((s, i) => s + (i.onHand || 0) * (i.unitCost || 0), 0);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/consumables"] });
  };

  return (
    <div className="p-6 space-y-4" data-testid="page-consumables">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-sm text-muted-foreground">Active items</div>
          <div className="text-2xl font-bold" data-testid="text-item-count">{items.length}</div>
        </CardContent></Card>
        <Card className={lowCount ? "border-red-400" : ""}><CardContent className="p-4">
          <div className="text-sm text-muted-foreground">Low / at reorder point</div>
          <div className={`text-2xl font-bold ${lowCount ? "text-red-600" : ""}`} data-testid="text-low-count">{lowCount}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-sm text-muted-foreground">On-hand value</div>
          <div className="text-2xl font-bold" data-testid="text-total-value">{money(totalValue)}</div>
        </CardContent></Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search name, SKU, vendor, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-consumables"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[170px]" data-testid="select-category"><SelectValue /></SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c === "all" ? "All categories" : c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={lowOnly ? "default" : "outline"}
          onClick={() => setLowOnly((v) => !v)}
          data-testid="button-toggle-low"
        >
          <AlertTriangle className="w-4 h-4 mr-1.5" /> Low stock{lowCount ? ` (${lowCount})` : ""}
        </Button>
        <ReorderListDialog />
        <ImportInvoiceDialog existing={items} onDone={invalidate} />
        <AddConsumableDialog jobs={jobs} onDone={invalidate} />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reorder pt</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground" data-testid="text-empty">
                  No consumables match. Add your first item to start tracking stock.
                </TableCell></TableRow>
              )}
              {filtered.map((c) => (
                <TableRow key={c.id} data-testid={`row-consumable-${c.id}`} className={c.lowStock ? "bg-red-50/60" : ""}>
                  <TableCell>
                    <div className="font-medium flex items-center gap-1.5">
                      {c.lowStock && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                      {c.name}
                    </div>
                    {c.sku && <div className="text-xs text-muted-foreground">SKU {c.sku}</div>}
                    {c.location && <div className="text-xs text-muted-foreground">📍 {c.location}</div>}
                  </TableCell>
                  <TableCell><Badge variant="secondary">{c.category}</Badge></TableCell>
                  <TableCell className="text-right">
                    <span className={c.lowStock ? "text-red-600 font-semibold" : ""} data-testid={`text-onhand-${c.id}`}>
                      {c.onHand} {c.unit}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{c.reorderPoint}</TableCell>
                  <TableCell className="text-right">{money(c.unitCost)}</TableCell>
                  <TableCell className="text-muted-foreground">{c.vendor || "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <RestockDialog item={c} onDone={invalidate} />
                      <UseOnJobDialog item={c} jobs={jobs} onDone={invalidate} />
                      <AdjustDialog item={c} onDone={invalidate} />
                      <HistoryDialog item={c} />
                      <EditConsumableDialog item={c} onDone={invalidate} />
                      <DeleteConsumable item={c} onDone={invalidate} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Add / Edit form ──────────────────────────────────────────────────────────
function ConsumableFields({ v, set }: { v: any; set: (k: string, val: any) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <Label>Name *</Label>
        <Input value={v.name} onChange={(e) => set("name", e.target.value)} data-testid="input-name" />
      </div>
      <div><Label>SKU</Label><Input value={v.sku} onChange={(e) => set("sku", e.target.value)} data-testid="input-sku" /></div>
      <div><Label>Category</Label><Input value={v.category} onChange={(e) => set("category", e.target.value)} placeholder="general" data-testid="input-category-field" /></div>
      <div><Label>Unit</Label><Input value={v.unit} onChange={(e) => set("unit", e.target.value)} placeholder="each" data-testid="input-unit" /></div>
      <div><Label>Unit cost ($)</Label><Input type="number" step="0.01" value={v.unitCost} onChange={(e) => set("unitCost", e.target.value)} data-testid="input-unitcost" /></div>
      <div><Label>Reorder point</Label><Input type="number" value={v.reorderPoint} onChange={(e) => set("reorderPoint", e.target.value)} data-testid="input-reorderpoint" /></div>
      <div><Label>Vendor</Label><Input value={v.vendor} onChange={(e) => set("vendor", e.target.value)} data-testid="input-vendor" /></div>
      <div className="col-span-2"><Label>Location</Label><Input value={v.location} onChange={(e) => set("location", e.target.value)} placeholder="Warehouse shelf, truck 2…" data-testid="input-location" /></div>
      <div className="col-span-2"><Label>Notes</Label><Textarea value={v.notes} onChange={(e) => set("notes", e.target.value)} data-testid="input-notes" /></div>
    </div>
  );
}

function AddConsumableDialog({ onDone }: { jobs: Job[]; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const blank = { name: "", sku: "", category: "general", unit: "each", unitCost: "", reorderPoint: "", vendor: "", location: "", notes: "", onHand: "" };
  const [v, setV] = useState<any>(blank);
  const set = (k: string, val: any) => setV((p: any) => ({ ...p, [k]: val }));

  const m = useMutation({
    mutationFn: () => apiRequest("POST", "/api/consumables", {
      name: v.name.trim(), sku: v.sku || null, category: v.category || "general",
      unit: v.unit || "each", unitCost: Number(v.unitCost) || 0,
      reorderPoint: Number(v.reorderPoint) || 0, vendor: v.vendor || null,
      location: v.location || null, notes: v.notes || null, onHand: Number(v.onHand) || 0,
    }),
    onSuccess: () => { toast({ title: "Item added" }); setV(blank); setOpen(false); onDone(); },
    onError: (e) => toast({ title: "Could not add item", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button data-testid="button-add-consumable"><Plus className="w-4 h-4 mr-1.5" /> Add item</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add consumable</DialogTitle></DialogHeader>
        <ConsumableFields v={v} set={set} />
        <div><Label>Starting on-hand qty</Label><Input type="number" value={v.onHand} onChange={(e) => set("onHand", e.target.value)} data-testid="input-onhand" /></div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!v.name.trim() || m.isPending} data-testid="button-save-consumable">
            {m.isPending ? "Saving…" : "Add item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditConsumableDialog({ item, onDone }: { item: Consumable; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<any>({
    name: item.name, sku: item.sku ?? "", category: item.category, unit: item.unit,
    unitCost: item.unitCost, reorderPoint: item.reorderPoint, vendor: item.vendor ?? "",
    location: item.location ?? "", notes: item.notes ?? "",
  });
  const set = (k: string, val: any) => setV((p: any) => ({ ...p, [k]: val }));
  const m = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/consumables/${item.id}`, {
      name: v.name.trim(), sku: v.sku || null, category: v.category || "general",
      unit: v.unit || "each", unitCost: Number(v.unitCost) || 0,
      reorderPoint: Number(v.reorderPoint) || 0, vendor: v.vendor || null,
      location: v.location || null, notes: v.notes || null,
    }),
    onSuccess: () => { toast({ title: "Item updated" }); setOpen(false); onDone(); },
    onError: (e) => toast({ title: "Could not update", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Edit details" data-testid={`button-edit-${item.id}`}><Pencil className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Edit {item.name}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">Editing details only. Use Restock / Adjust / Use to change on-hand quantity.</p>
        <ConsumableFields v={v} set={set} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!v.name.trim() || m.isPending} data-testid={`button-save-edit-${item.id}`}>
            {m.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Stock actions ────────────────────────────────────────────────────────────
function RestockDialog({ item, onDone }: { item: Consumable; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState(String(item.unitCost ?? ""));
  const [ref, setRef] = useState("");
  const m = useMutation({
    mutationFn: () => apiRequest("POST", `/api/consumables/${item.id}/restock`, {
      quantity: Number(qty), unitCost: cost === "" ? undefined : Number(cost), reference: ref || undefined,
    }),
    onSuccess: () => { toast({ title: `Restocked ${item.name}` }); setQty(""); setRef(""); setOpen(false); onDone(); },
    onError: (e) => toast({ title: "Restock failed", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Restock" data-testid={`button-restock-${item.id}`}><PackagePlus className="w-4 h-4 text-green-600" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Restock {item.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">On hand: {item.onHand} {item.unit}</div>
          <div><Label>Quantity added *</Label><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} data-testid={`input-restock-qty-${item.id}`} /></div>
          <div><Label>Unit cost (optional)</Label><Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} data-testid={`input-restock-cost-${item.id}`} /></div>
          <div><Label>Reference / PO (optional)</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} data-testid={`input-restock-ref-${item.id}`} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!(Number(qty) > 0) || m.isPending} data-testid={`button-confirm-restock-${item.id}`}>Restock</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ item, onDone }: { item: Consumable; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [ref, setRef] = useState("");
  const m = useMutation({
    mutationFn: () => apiRequest("POST", `/api/consumables/${item.id}/adjust`, {
      quantity: Number(delta), reference: ref || undefined,
    }),
    onSuccess: () => { toast({ title: `Adjusted ${item.name}` }); setDelta(""); setRef(""); setOpen(false); onDone(); },
    onError: (e) => toast({ title: "Adjustment failed", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Adjust (correction / shrinkage)" data-testid={`button-adjust-${item.id}`}><SlidersHorizontal className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Adjust {item.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">On hand: {item.onHand} {item.unit}. Use a negative number to subtract.</div>
          <div><Label>Adjustment (+/-) *</Label><Input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="-2 or 5" data-testid={`input-adjust-qty-${item.id}`} /></div>
          <div><Label>Reason</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Damage, count correction…" data-testid={`input-adjust-ref-${item.id}`} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!delta || Number.isNaN(Number(delta)) || m.isPending} data-testid={`button-confirm-adjust-${item.id}`}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UseOnJobDialog({ item, jobs, onDone }: { item: Consumable; jobs: Job[]; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("");
  const [jobId, setJobId] = useState("");
  const m = useMutation({
    mutationFn: () => apiRequest("POST", `/api/consumables/${item.id}/use`, {
      quantity: Number(qty), jobId: Number(jobId),
    }),
    onSuccess: () => { toast({ title: `Logged to job`, description: `${qty} ${item.unit} of ${item.name} added to job costs.` }); setQty(""); setJobId(""); setOpen(false); onDone(); },
    onError: (e) => toast({ title: "Could not log usage", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Use on a job" data-testid={`button-use-${item.id}`}><ArrowRightCircle className="w-4 h-4 text-[hsl(var(--titan-blue))]" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Use {item.name} on a job</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">On hand: {item.onHand} {item.unit} · {money(item.unitCost)}/unit</div>
          <div><Label>Job *</Label>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger data-testid={`select-job-${item.id}`}><SelectValue placeholder="Select a job" /></SelectTrigger>
              <SelectContent>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber}{j.address ? ` — ${j.address}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Quantity used *</Label><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} data-testid={`input-use-qty-${item.id}`} /></div>
          {Number(qty) > 0 && <div className="text-sm">Job cost: <strong>{money(Number(qty) * (item.unitCost || 0))}</strong></div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => m.mutate()} disabled={!(Number(qty) > 0) || !jobId || m.isPending} data-testid={`button-confirm-use-${item.id}`}>Log usage</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ item }: { item: Consumable }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<Consumable & { transactions: ConsumableTxn[] }>({
    queryKey: ["/api/consumables", item.id],
    enabled: open,
  });
  const txns = data?.transactions ?? [];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" title="History" data-testid={`button-history-${item.id}`}><History className="w-4 h-4" /></Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{item.name} — stock history</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Type</TableHead>
              <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Balance</TableHead>
              <TableHead>Reference</TableHead><TableHead>By</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && txns.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No transactions yet.</TableCell></TableRow>}
              {txns.map((t) => (
                <TableRow key={t.id} data-testid={`row-txn-${t.id}`}>
                  <TableCell className="whitespace-nowrap">{(t.createdAt || "").slice(0, 10)}</TableCell>
                  <TableCell><Badge variant={t.type === "usage" ? "outline" : "secondary"}>{TXN_LABEL[t.type] || t.type}</Badge></TableCell>
                  <TableCell className={`text-right ${t.quantity < 0 ? "text-red-600" : "text-green-700"}`}>{t.quantity > 0 ? "+" : ""}{t.quantity}</TableCell>
                  <TableCell className="text-right">{t.balanceAfter ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{t.reference || (t.jobId ? `Job #${t.jobId}` : "—")}</TableCell>
                  <TableCell className="text-muted-foreground">{t.enteredBy || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConsumable({ item, onDone }: { item: Consumable; onDone: () => void }) {
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/consumables/${item.id}`),
    onSuccess: () => { toast({ title: `${item.name} removed` }); onDone(); },
    onError: (e) => toast({ title: "Could not remove", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Deactivate" data-testid={`button-delete-${item.id}`}><Trash2 className="w-4 h-4 text-red-500" /></Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {item.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This deactivates the item and hides it from the list. Its transaction history is preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => m.mutate()} data-testid={`button-confirm-delete-${item.id}`}>Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Reorder list ─────────────────────────────────────────────────────────────
function ReorderListDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery<ReorderReport>({
    queryKey: ["/api/consumables/low-stock"],
    enabled: open,
  });
  const notify = useMutation({
    mutationFn: () => apiRequest("POST", "/api/consumables/low-stock/notify", {}),
    onSuccess: (r: any) => {
      if (r?.sent) toast({ title: "Reorder list sent", description: `${r.count} item(s) emailed/texted to ops.` });
      else toast({ title: "Nothing sent", description: r?.reason === "no_low_stock" ? "All items above reorder point." : "No recipients configured in Notification settings.", variant: r?.reason === "no_low_stock" ? "default" : "destructive" });
    },
    onError: (e) => toast({ title: "Send failed", description: errMsg(e), variant: "destructive" }),
  });
  const downloadTxt = () => {
    window.open("/api/consumables/reorder-list.txt", "_blank");
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-reorder-list"><ClipboardList className="w-4 h-4 mr-1.5" /> Reorder list</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Low-stock reorder list</DialogTitle></DialogHeader>
        {isLoading && <div className="py-6 text-center text-muted-foreground">Loading…</div>}
        {!isLoading && data && (
          <>
            {data.count === 0 ? (
              <div className="py-6 text-center text-muted-foreground" data-testid="text-reorder-empty">All consumables are above their reorder points. Nothing to reorder.</div>
            ) : (
              <div className="max-h-[55vh] overflow-auto space-y-4">
                <div className="text-sm">{data.count} item(s) at or below reorder point · est. total <strong>{money(data.estGrandTotal)}</strong></div>
                {data.groups.map((g) => (
                  <div key={g.vendor}>
                    <div className="font-semibold text-sm mb-1">{g.vendor} <span className="font-normal text-muted-foreground">— est {money(g.estTotal)}</span></div>
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Item</TableHead><TableHead className="text-right">On hand</TableHead>
                        <TableHead className="text-right">Reorder qty</TableHead><TableHead className="text-right">Est. cost</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {g.items.map((it) => (
                          <TableRow key={it.id}>
                            <TableCell>{it.name}{it.sku ? <span className="text-xs text-muted-foreground"> [{it.sku}]</span> : null}</TableCell>
                            <TableCell className="text-right text-red-600">{it.onHand} {it.unit}</TableCell>
                            <TableCell className="text-right">{it.suggestedQty} {it.unit}</TableCell>
                            <TableCell className="text-right">{money(it.estCost)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={downloadTxt} data-testid="button-download-reorder"><Download className="w-4 h-4 mr-1.5" /> Download .txt</Button>
              <Button onClick={() => notify.mutate()} disabled={data.count === 0 || notify.isPending} data-testid="button-send-reorder">
                <Mail className="w-4 h-4 mr-1.5" /> {notify.isPending ? "Sending…" : "Email/Text ops"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Import from invoice (PDF) ────────────────────────────────────────────────
interface ParsedLine {
  name: string;
  sku: string | null;
  quantity: number;
  unitCost: number | null;
  unit: string | null;
  category: string | null;
  consumableId: number | null;
}

function ImportInvoiceDialog({ existing, onDone }: { existing: Consumable[]; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"upload" | "review">("upload");
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [vendor, setVendor] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<ParsedLine[]>([]);
  const [aiOff, setAiOff] = useState(false);

  const reset = () => {
    setStage("upload"); setReading(false); setFileName(""); setVendor("");
    setReference(""); setLines([]); setAiOff(false);
  };

  const readFile = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(new Error("Could not read file"));
      r.readAsDataURL(file);
    });

  const onFile = async (file?: File | null) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: "PDF only", description: "Please upload a PDF invoice.", variant: "destructive" });
      return;
    }
    setFileName(file.name);
    setReading(true);
    try {
      const dataUrl = await readFile(file);
      const resp: any = await apiRequest("POST", "/api/consumables/parse-invoice", {
        pdfBase64: dataUrl, filename: file.name,
      });
      setVendor(resp.vendor || "");
      setReference(resp.reference || file.name);
      setLines(Array.isArray(resp.lines) ? resp.lines : []);
      if (resp.llmAvailable === false) {
        setAiOff(true);
        toast({ title: "AI reader off here", description: "Add the line items manually below, then import. Auto-read works on your live Railway site." });
      } else if (!resp.lines?.length) {
        toast({ title: "No line items found", description: "Add rows manually or try a clearer PDF.", variant: "destructive" });
      } else {
        toast({ title: `Read ${resp.lines.length} line item(s)`, description: "Review and edit before importing." });
      }
      setStage("review");
    } catch (e) {
      toast({ title: "Could not read invoice", description: errMsg(e), variant: "destructive" });
    } finally {
      setReading(false);
    }
  };

  const setLine = (i: number, k: keyof ParsedLine, v: any) =>
    setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const addRow = () =>
    setLines((p) => [...p, { name: "", sku: null, quantity: 1, unitCost: 0, unit: "each", category: "general", consumableId: null }]);
  const removeRow = (i: number) => setLines((p) => p.filter((_, idx) => idx !== i));

  const validLines = lines.filter((l) => l.name.trim() && Number(l.quantity) > 0);
  const estTotal = validLines.reduce((s, l) => s + Number(l.quantity) * (Number(l.unitCost) || 0), 0);

  const importMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/consumables/import-receipt", {
      vendor: vendor || null,
      reference: reference || fileName || "PDF Receipt",
      lines: validLines.map((l) => ({
        consumableId: l.consumableId || undefined,
        name: l.name.trim(),
        sku: l.sku || undefined,
        quantity: Number(l.quantity),
        unitCost: l.unitCost == null ? undefined : Number(l.unitCost),
        unit: l.unit || "each",
        category: l.category || "general",
      })),
    }),
    onSuccess: (r: any) => {
      const created = (r.results || []).filter((x: any) => x.status === "created").length;
      const restocked = (r.results || []).filter((x: any) => x.status === "restocked").length;
      toast({ title: "Invoice imported", description: `${restocked} item(s) restocked, ${created} new item(s) added.` });
      reset(); setOpen(false); onDone();
    },
    onError: (e) => toast({ title: "Import failed", description: errMsg(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-import-invoice"><FileUp className="w-4 h-4 mr-1.5" /> Import invoice</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[hsl(var(--titan-blue))]" /> Import from invoice (PDF)
          </DialogTitle>
        </DialogHeader>

        {stage === "upload" && (
          <div className="py-4">
            <label
              className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-10 cursor-pointer hover:bg-muted/50 transition-colors"
              data-testid="dropzone-invoice"
            >
              {reading ? (
                <><Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--titan-blue))] mb-2" />
                  <div className="text-sm text-muted-foreground">Reading {fileName}…</div></>
              ) : (
                <><FileUp className="w-8 h-8 text-muted-foreground mb-2" />
                  <div className="font-medium">Upload a supplier invoice PDF</div>
                  <div className="text-sm text-muted-foreground mt-1">The system reads it and drafts the stock update for your review.</div></>
              )}
              <input
                type="file" accept="application/pdf,.pdf" className="hidden"
                disabled={reading}
                onChange={(e) => onFile(e.target.files?.[0])}
                data-testid="input-invoice-file"
              />
            </label>
          </div>
        )}

        {stage === "review" && (
          <div className="space-y-3">
            {aiOff && (
              <div className="text-sm rounded-md bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
                AI auto-read isn't enabled in this preview. Add rows manually below — on your live Railway site the invoice is read automatically.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Vendor</Label><Input value={vendor} onChange={(e) => setVendor(e.target.value)} data-testid="input-invoice-vendor" /></div>
              <div><Label>Reference / Invoice #</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} data-testid="input-invoice-reference" /></div>
            </div>

            <div className="max-h-[45vh] overflow-auto border rounded-md">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="w-[120px]">SKU</TableHead>
                  <TableHead className="w-[90px] text-right">Qty</TableHead>
                  <TableHead className="w-[110px] text-right">Unit cost</TableHead>
                  <TableHead className="w-[130px]">Matches</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {lines.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground" data-testid="text-no-lines">No line items yet. Add a row to enter them manually.</TableCell></TableRow>
                  )}
                  {lines.map((l, i) => {
                    const match = l.consumableId ? existing.find((e) => e.id === l.consumableId) : null;
                    return (
                      <TableRow key={i} data-testid={`row-parsed-${i}`}>
                        <TableCell><Input value={l.name} onChange={(e) => setLine(i, "name", e.target.value)} data-testid={`input-parsed-name-${i}`} /></TableCell>
                        <TableCell><Input value={l.sku ?? ""} onChange={(e) => setLine(i, "sku", e.target.value || null)} data-testid={`input-parsed-sku-${i}`} /></TableCell>
                        <TableCell><Input type="number" className="text-right" value={l.quantity} onChange={(e) => setLine(i, "quantity", Number(e.target.value))} data-testid={`input-parsed-qty-${i}`} /></TableCell>
                        <TableCell><Input type="number" step="0.01" className="text-right" value={l.unitCost ?? 0} onChange={(e) => setLine(i, "unitCost", Number(e.target.value))} data-testid={`input-parsed-cost-${i}`} /></TableCell>
                        <TableCell>
                          {match
                            ? <Badge variant="secondary" title={match.name}>Restock</Badge>
                            : <Badge variant="outline">New item</Badge>}
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" onClick={() => removeRow(i)} data-testid={`button-remove-parsed-${i}`}><XIcon className="w-4 h-4" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" onClick={addRow} data-testid="button-add-parsed-row"><Plus className="w-4 h-4 mr-1.5" /> Add row</Button>
              <div className="text-sm text-muted-foreground">{validLines.length} item(s) · est. total <strong>{money(estTotal)}</strong></div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setStage("upload"); setLines([]); }} data-testid="button-invoice-back">Back</Button>
              <Button onClick={() => importMut.mutate()} disabled={validLines.length === 0 || importMut.isPending} data-testid="button-confirm-import">
                {importMut.isPending ? "Importing…" : `Import & update stock (${validLines.length})`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
