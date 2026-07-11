import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, BookOpen, DollarSign, Trash2, Edit2, Copy } from "lucide-react";

const CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "demo", label: "Demolition" },
  { value: "drying", label: "Drying & Dehumidification" },
  { value: "cleaning", label: "Cleaning & Antimicrobial" },
  { value: "reconstruction", label: "Reconstruction" },
  { value: "contents", label: "Contents" },
  { value: "other", label: "Other" },
];

const UNITS = ["SF", "LF", "EA", "HR", "DAY", "LS", "CY", "SY", "CF"];

// Pre-loaded IICRC standard items
const SEED_ITEMS = [
  { category: "drying", subCategory: "Equipment", code: "WTR-EQ-001", description: "Commercial Dehumidifier (LGR) — Daily Rental", unit: "DAY", unitPrice: 85, iicrcRef: "IICRC S500 §9.3" },
  { category: "drying", subCategory: "Equipment", code: "WTR-EQ-002", description: "Air Mover (Axial Fan) — Daily Rental", unit: "DAY", unitPrice: 35, iicrcRef: "IICRC S500 §9.3" },
  { category: "drying", subCategory: "Equipment", code: "WTR-EQ-003", description: "HEPA Air Scrubber — Daily Rental", unit: "DAY", unitPrice: 95, iicrcRef: "IICRC S500 §12.2" },
  { category: "drying", subCategory: "Equipment", code: "WTR-EQ-004", description: "Desiccant Dehumidifier — Daily Rental", unit: "DAY", unitPrice: 145, iicrcRef: "IICRC S500 §9.4" },
  { category: "drying", subCategory: "Monitoring", code: "WTR-MON-001", description: "Moisture Monitoring & Daily Log", unit: "DAY", unitPrice: 45, iicrcRef: "IICRC S500 §10" },
  { category: "demo", subCategory: "Flooring", code: "WTR-DEM-001", description: "Remove Wet Carpet & Pad", unit: "SF", unitPrice: 0.75, iicrcRef: "IICRC S500 §8.2" },
  { category: "demo", subCategory: "Flooring", code: "WTR-DEM-002", description: "Remove Wet Hardwood Flooring", unit: "SF", unitPrice: 1.25, iicrcRef: "IICRC S500 §8.3" },
  { category: "demo", subCategory: "Drywall", code: "WTR-DEM-003", description: "Remove Wet Drywall — Category 3 Cut (24\")", unit: "LF", unitPrice: 2.85, iicrcRef: "IICRC S500 §8.4" },
  { category: "demo", subCategory: "Drywall", code: "WTR-DEM-004", description: "Remove Wet Insulation (Batt)", unit: "SF", unitPrice: 0.55, iicrcRef: "IICRC S500 §8.5" },
  { category: "cleaning", subCategory: "Antimicrobial", code: "WTR-CLN-001", description: "Antimicrobial Treatment Application", unit: "SF", unitPrice: 0.35, iicrcRef: "IICRC S500 §11.3" },
  { category: "cleaning", subCategory: "Antimicrobial", code: "WTR-CLN-002", description: "Mold Remediation — Encapsulation", unit: "SF", unitPrice: 1.85, iicrcRef: "IICRC S520 §8" },
  { category: "cleaning", subCategory: "Cleaning", code: "WTR-CLN-003", description: "Structural Cleaning & Deodorization", unit: "SF", unitPrice: 0.65, iicrcRef: "IICRC S500 §11" },
  { category: "reconstruction", subCategory: "Drywall", code: "REC-DRY-001", description: "Install Drywall 1/2\"", unit: "SF", unitPrice: 2.15, iicrcRef: "" },
  { category: "reconstruction", subCategory: "Flooring", code: "REC-FLR-001", description: "Install LVP Flooring", unit: "SF", unitPrice: 4.50, iicrcRef: "" },
  { category: "reconstruction", subCategory: "Flooring", code: "REC-FLR-002", description: "Install Carpet & Pad", unit: "SF", unitPrice: 3.85, iicrcRef: "" },
  { category: "contents", subCategory: "Pack-Out", code: "CNT-PKO-001", description: "Contents Pack-Out & Inventory", unit: "HR", unitPrice: 65, iicrcRef: "IICRC S520" },
  { category: "contents", subCategory: "Pack-Out", code: "CNT-PKO-002", description: "Contents Storage (per room equivalent)", unit: "DAY", unitPrice: 25, iicrcRef: "" },
  { category: "other", subCategory: "General", code: "GEN-DIS-001", description: "Debris Disposal / Haul Away", unit: "LS", unitPrice: 350, iicrcRef: "" },
  { category: "other", subCategory: "General", code: "GEN-DOC-001", description: "Documentation & Project Management", unit: "HR", unitPrice: 85, iicrcRef: "" },
];

export default function LineItemLibrary() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState({ category: "drying", subCategory: "", code: "", description: "", unit: "SF", unitPrice: "", iicrcRef: "", notes: "" });

  const { data: items = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/line-items"] });

  const saveMutation = useMutation({
    mutationFn: (data: any) => editItem
      ? apiRequest("PATCH", `/api/line-items/${editItem.id}`, data)
      : apiRequest("POST", "/api/line-items", { ...data, isCustom: 1 }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/line-items"] }); setOpen(false); setEditItem(null); toast({ title: editItem ? "Item updated" : "Item added" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/line-items/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/line-items"] }); toast({ title: "Item removed" }); },
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      for (const item of SEED_ITEMS) {
        await apiRequest("POST", "/api/line-items", { ...item, isCustom: 0 });
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/line-items"] }); toast({ title: `${SEED_ITEMS.length} IICRC standard items loaded` }); },
  });

  const filtered = items.filter((item: any) => {
    const matchCat = category === "all" || item.category === category;
    const matchSearch = !search || item.description.toLowerCase().includes(search.toLowerCase()) || item.code.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const catColor: Record<string, string> = {
    demo: "bg-orange-100 text-orange-800", drying: "bg-blue-100 text-blue-800",
    cleaning: "bg-green-100 text-green-800", reconstruction: "bg-purple-100 text-purple-800",
    contents: "bg-yellow-100 text-yellow-800", other: "bg-gray-100 text-gray-700",
  };

  const openNew = () => { setEditItem(null); setForm({ category: "drying", subCategory: "", code: "", description: "", unit: "SF", unitPrice: "", iicrcRef: "", notes: "" }); setOpen(true); };
  const openEdit = (item: any) => { setEditItem(item); setForm({ category: item.category, subCategory: item.subCategory || "", code: item.code, description: item.description, unit: item.unit, unitPrice: String(item.unitPrice), iicrcRef: item.iicrcRef || "", notes: item.notes || "" }); setOpen(true); };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Line Item Library</h1>
          <p className="text-sm text-muted-foreground">IICRC-standard restoration pricing catalog</p>
        </div>
        <div className="flex gap-2">
          {items.length === 0 && (
            <Button variant="outline" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending} data-testid="button-seed-items">
              <BookOpen className="w-4 h-4 mr-2" /> Load IICRC Standards
            </Button>
          )}
          <Button className="bg-primary text-primary-foreground" onClick={openNew} data-testid="button-add-item">
            <Plus className="w-4 h-4 mr-2" /> Add Custom Item
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {CATEGORIES.slice(1).map(cat => {
          const count = items.filter((i: any) => i.category === cat.value).length;
          return (
            <Card key={cat.value} className="cursor-pointer hover:border-primary transition-colors" onClick={() => setCategory(cat.value === category ? "all" : cat.value)}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{cat.label}</p>
                <p className="text-xl font-bold text-foreground">{count}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by description or code..." value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-48" data-testid="select-category"><SelectValue /></SelectTrigger>
          <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {/* Items table */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          {items.length === 0 ? "Click \"Load IICRC Standards\" to populate the library with standard restoration line items." : "No items match your search."}
        </CardContent></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-3 font-medium">Code</th>
                <th className="text-left px-4 py-3 font-medium">Description</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-left px-4 py-3 font-medium">Unit</th>
                <th className="text-right px-4 py-3 font-medium">Unit Price</th>
                <th className="text-left px-4 py-3 font-medium">IICRC Ref</th>
                <th className="px-4 py-3"></th>
              </tr></thead>
              <tbody>
                {filtered.map((item: any) => (
                  <tr key={item.id} className="border-b hover:bg-muted/20" data-testid={`row-item-${item.id}`}>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.code}</td>
                    <td className="px-4 py-3 font-medium">{item.description}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${catColor[item.category] || ""}`}>{item.category}</span></td>
                    <td className="px-4 py-3 text-muted-foreground">{item.unit}</td>
                    <td className="px-4 py-3 text-right font-semibold">${Number(item.unitPrice).toFixed(2)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{item.iicrcRef || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(item)} data-testid={`button-edit-${item.id}`}><Edit2 className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate(item.id)} data-testid={`button-delete-${item.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editItem ? "Edit Line Item" : "Add Custom Line Item"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger data-testid="select-form-category"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.slice(1).map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Code</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. WTR-001" data-testid="input-code" /></div>
            </div>
            <div><Label>Description</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} data-testid="input-description" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Unit</Label>
                <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
                  <SelectTrigger data-testid="select-unit"><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Unit Price ($)</Label><Input type="number" value={form.unitPrice} onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} data-testid="input-unit-price" /></div>
            </div>
            <div><Label>IICRC Reference</Label><Input value={form.iicrcRef} onChange={e => setForm(f => ({ ...f, iicrcRef: e.target.value }))} placeholder="e.g. IICRC S500 §9.3" data-testid="input-iicrc-ref" /></div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} data-testid="input-notes" /></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate({ ...form, unitPrice: Number(form.unitPrice) })} disabled={saveMutation.isPending} data-testid="button-save-item">
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
