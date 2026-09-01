import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Upload, Trash2, Edit2, Download, AlertTriangle, TrendingUp } from "lucide-react";

// ── CSV helpers ─────────────────────────────────────────────────────────────
// Very small CSV parser that handles quoted fields and embedded commas. This
// avoids adding a runtime dep for a feature only the admin will touch, and
// keeps the CSV format transparent — export/import round-trips cleanly.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\r") { /* skip */ }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim().length));
}

// Map a header row to a { category, code, description, unit, unitPrice, notes }
// key set. We match forgivingly so techs can hand us a CSV without exact
// column names.
function normaliseHeader(h: string): string {
  const s = h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["cat", "category"].includes(s)) return "category";
  if (["code", "itemcode", "sku"].includes(s)) return "code";
  if (["desc", "description", "item", "name"].includes(s)) return "description";
  if (["unit", "uom"].includes(s)) return "unit";
  if (["price", "unitprice", "cost", "rate"].includes(s)) return "unitPrice";
  if (["notes", "note", "comment", "comments"].includes(s)) return "notes";
  return s;
}

const UNITS = ["EA", "SF", "LF", "HR", "DAY", "LS", "CY", "SY", "CF", "GAL"];

type Item = {
  id: number; category: string; code: string; description: string;
  unit: string; unitPrice: number; notes?: string;
};

export default function LineItemLibrary() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string>("__all__");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustMode, setAdjustMode] = useState<"flat" | "percent">("flat");
  const [adjustValue, setAdjustValue] = useState("0.15");
  const [adjustScope, setAdjustScope] = useState<string>("__all__"); // "__all__" or a category name
  const [addOpen, setAddOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [csvPreview, setCsvPreview] = useState<any[] | null>(null);
  const [csvMode, setCsvMode] = useState<"replace" | "append">("replace");
  const [renameCat, setRenameCat] = useState<{ from: string; to: string } | null>(null);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<{ id?: number; category: string; code: string; description: string; unit: string; unitPrice: string; notes: string }>({
    category: "General", code: "", description: "", unit: "EA", unitPrice: "", notes: "",
  });

  const { data: items = [], isLoading } = useQuery<Item[]>({ queryKey: ["/api/line-items"] });
  const { data: categories = [] } = useQuery<string[]>({ queryKey: ["/api/line-items/categories"] });

  const categoriesToShow = useMemo(() => {
    // Union of server-known categories and any pending ones the user just added
    const set = new Set<string>(categories);
    return Array.from(set).sort();
  }, [categories]);

  const filtered = useMemo(() => {
    return items.filter(it => {
      if (activeCat !== "__all__" && it.category !== activeCat) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      return it.description.toLowerCase().includes(s) || (it.code || "").toLowerCase().includes(s);
    });
  }, [items, search, activeCat]);

  const saveMutation = useMutation({
    mutationFn: (data: any) => data.id
      ? apiRequest("PATCH", `/api/line-items/${data.id}`, data)
      : apiRequest("POST", "/api/line-items", { ...data, isCustom: 1 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/line-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/line-items/categories"] });
      setAddOpen(false);
      toast({ title: form.id ? "Item updated" : "Item added" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/line-items/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/line-items"] }); },
  });

  const bulkMutation = useMutation({
    mutationFn: (payload: { items: any[]; mode: "replace" | "append" }) =>
      apiRequest("POST", `/api/line-items/bulk-${payload.mode}`, { items: payload.items }),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/line-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/line-items/categories"] });
      setUploadOpen(false); setCsvPreview(null);
      toast({ title: `Price list ${csvMode === "replace" ? "replaced" : "updated"}`, description: `${r.count} items now in the library.` });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e?.message || "See console", variant: "destructive" }),
  });

  const adjustMutation = useMutation({
    mutationFn: (p: { addFlat?: number; multiplyBy?: number; category?: string | null }) =>
      apiRequest("POST", "/api/line-items/bulk-adjust", p),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/line-items"] });
      setAdjustOpen(false);
      const parts: string[] = [];
      if (r.multiplyBy && r.multiplyBy !== 1) parts.push(`× ${r.multiplyBy}`);
      if (r.addFlat) parts.push(`${r.addFlat > 0 ? "+" : ""}$${r.addFlat.toFixed(2)}`);
      toast({ title: "Prices adjusted", description: `${r.updated} items updated (${parts.join(", ") || "no change"})${r.category ? ` in ${r.category}` : ""}.` });
    },
    onError: (e: any) => toast({ title: "Adjust failed", description: e?.message || "See console", variant: "destructive" }),
  });

  const renameCatMutation = useMutation({
    mutationFn: (p: { from: string; to: string }) =>
      apiRequest("PATCH", `/api/line-items/categories/${encodeURIComponent(p.from)}`, { newName: p.to }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/line-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/line-items/categories"] });
      setRenameCat(null);
      toast({ title: "Category renamed" });
    },
  });

  const deleteCatMutation = useMutation({
    mutationFn: (name: string) => apiRequest("DELETE", `/api/line-items/categories/${encodeURIComponent(name)}`),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/line-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/line-items/categories"] });
      setActiveCat("__all__");
      toast({ title: "Category deleted", description: `${r.deleted} items removed.` });
    },
  });

  const openAdd = (item?: Item) => {
    if (item) setForm({ id: item.id, category: item.category, code: item.code || "", description: item.description, unit: item.unit, unitPrice: String(item.unitPrice), notes: item.notes || "" });
    else setForm({ category: activeCat === "__all__" ? (categoriesToShow[0] || "General") : activeCat, code: "", description: "", unit: "EA", unitPrice: "", notes: "" });
    setAddOpen(true);
  };

  // Inline price/description edit — debounced via a per-row uncontrolled input
  // pattern would be nicer but this is admin-only so a straight blur-to-save
  // keeps the code short.
  const inlineSave = (item: Item, patch: Partial<Item>) => {
    saveMutation.mutate({ ...item, ...patch, unitPrice: Number(patch.unitPrice ?? item.unitPrice) });
  };

  const handleFile = async (f: File) => {
    const text = await f.text();
    const rows = parseCSV(text);
    if (rows.length < 2) { toast({ title: "CSV is empty or has no header row", variant: "destructive" }); return; }
    const header = rows[0].map(normaliseHeader);
    const idx = (name: string) => header.indexOf(name);
    const cCat = idx("category"), cCode = idx("code"), cDesc = idx("description"),
          cUnit = idx("unit"), cPrice = idx("unitPrice"), cNotes = idx("notes");
    if (cDesc < 0) { toast({ title: "CSV missing a 'description' column", variant: "destructive" }); return; }
    const parsed: any[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const desc = (r[cDesc] || "").trim();
      if (!desc) continue;
      parsed.push({
        category: cCat >= 0 ? (r[cCat] || "General").trim() : "General",
        code: cCode >= 0 ? (r[cCode] || "").trim() : "",
        description: desc,
        unit: cUnit >= 0 ? (r[cUnit] || "EA").trim() : "EA",
        unitPrice: cPrice >= 0 ? (Number(r[cPrice]) || 0) : 0,
        notes: cNotes >= 0 ? (r[cNotes] || "").trim() : "",
      });
    }
    setCsvPreview(parsed);
  };

  const downloadTemplate = () => {
    const header = "category,code,description,unit,unitPrice,notes\n";
    const sample = 'General,GEN-001,"Emergency Mobilization",LS,450,"After-hours dispatch"\nCat 1,C1-001,"Water Extraction — Clean Water",SF,0.45,\nFire,FIRE-001,"Emergency Board-Up",LS,650,"Includes labor and materials"\n';
    const blob = new Blob([header + sample], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "titanpro-pricelist-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const exportCurrent = () => {
    const header = "category,code,description,unit,unitPrice,notes\n";
    const escape = (s: any) => {
      const v = String(s ?? "");
      return /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    };
    const body = items.map(it =>
      [it.category, it.code, it.description, it.unit, it.unitPrice, it.notes || ""].map(escape).join(",")
    ).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `titanpro-pricelist-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Price List Manager</h1>
          <p className="text-sm text-muted-foreground">Upload category-tagged CSVs, edit any field, add categories on the fly.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={downloadTemplate} data-testid="button-download-template">
            <Download className="w-4 h-4 mr-2" /> CSV Template
          </Button>
          <Button variant="outline" onClick={exportCurrent} disabled={!items.length} data-testid="button-export">
            <Download className="w-4 h-4 mr-2" /> Export Current
          </Button>
          <Button variant="outline" onClick={() => setUploadOpen(true)} data-testid="button-upload">
            <Upload className="w-4 h-4 mr-2" /> Upload CSV
          </Button>
          <Button variant="outline" onClick={() => { setAdjustScope(activeCat); setAdjustOpen(true); }} disabled={!items.length} data-testid="button-adjust-prices">
            <TrendingUp className="w-4 h-4 mr-2" /> Adjust Prices
          </Button>
          <Button variant="outline" onClick={() => { setNewCatName(""); setNewCatOpen(true); }} data-testid="button-add-category">
            <Plus className="w-4 h-4 mr-2" /> New Category
          </Button>
          <Button className="bg-primary text-primary-foreground" onClick={() => openAdd()} data-testid="button-add-item">
            <Plus className="w-4 h-4 mr-2" /> Add Item
          </Button>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => setActiveCat("__all__")}
          className={`px-3 py-1.5 rounded-md text-sm border ${activeCat === "__all__" ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted"}`}
          data-testid="tab-all"
        >
          All ({items.length})
        </button>
        {categoriesToShow.map(cat => {
          const count = items.filter(i => i.category === cat).length;
          return (
            <div key={cat} className="flex items-center">
              <button
                onClick={() => setActiveCat(cat)}
                className={`px-3 py-1.5 rounded-l-md text-sm border ${activeCat === cat ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted"}`}
                data-testid={`tab-${cat}`}
              >
                {cat} ({count})
              </button>
              <button
                onClick={() => setRenameCat({ from: cat, to: cat })}
                className={`px-2 py-1.5 rounded-r-md text-xs border-y border-r ${activeCat === cat ? "bg-primary/80 text-primary-foreground border-primary" : "bg-card hover:bg-muted"}`}
                title="Rename or delete this category"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search by description or code…" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search" />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          {items.length === 0
            ? <>The price list is empty. Click <strong>Upload CSV</strong> to load your General / Cat 1 / Cat 2 / Cat 3 / Fire pricing, or <strong>Add Item</strong> to build one by hand.</>
            : "No items match this filter."}
        </CardContent></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 font-medium w-24">Category</th>
                <th className="text-left px-3 py-2 font-medium w-28">Code</th>
                <th className="text-left px-3 py-2 font-medium">Description</th>
                <th className="text-left px-3 py-2 font-medium w-20">Unit</th>
                <th className="text-right px-3 py-2 font-medium w-28">Unit Price</th>
                <th className="text-left px-3 py-2 font-medium">Notes</th>
                <th className="w-24"></th>
              </tr></thead>
              <tbody>
                {filtered.map(it => (
                  <tr key={it.id} className="border-b hover:bg-muted/20" data-testid={`row-item-${it.id}`}>
                    <td className="px-3 py-2 text-xs">
                      <span className="px-2 py-0.5 rounded bg-primary/10 text-primary">{it.category}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{it.code || "—"}</td>
                    <td className="px-3 py-2">
                      <input
                        className="w-full bg-transparent hover:bg-muted/40 focus:bg-background rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary"
                        defaultValue={it.description}
                        onBlur={e => { if (e.target.value !== it.description) inlineSave(it, { description: e.target.value }); }}
                        data-testid={`inline-desc-${it.id}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className="bg-transparent hover:bg-muted/40 focus:bg-background rounded px-1 py-0.5 outline-none"
                        defaultValue={it.unit}
                        onChange={e => inlineSave(it, { unit: e.target.value })}
                      >
                        {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                        {!UNITS.includes(it.unit) && <option value={it.unit}>{it.unit}</option>}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number" step="0.01"
                        className="w-24 text-right bg-transparent hover:bg-muted/40 focus:bg-background rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary"
                        defaultValue={it.unitPrice}
                        onBlur={e => { const n = Number(e.target.value); if (n !== it.unitPrice) inlineSave(it, { unitPrice: n }); }}
                        data-testid={`inline-price-${it.id}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <input
                        className="w-full bg-transparent hover:bg-muted/40 focus:bg-background rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary"
                        defaultValue={it.notes || ""}
                        onBlur={e => { if ((e.target.value || "") !== (it.notes || "")) inlineSave(it, { notes: e.target.value }); }}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => openAdd(it)} data-testid={`button-edit-${it.id}`}><Edit2 className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm(`Delete "${it.description}"?`)) deleteMutation.mutate(it.id); }} data-testid={`button-delete-${it.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{form.id ? "Edit Line Item" : "Add Line Item"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger data-testid="select-form-category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categoriesToShow.length ? categoriesToShow.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>) : <SelectItem value="General">General</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Code</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="Optional" data-testid="input-code" /></div>
            </div>
            <div><Label>Description *</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} data-testid="input-description" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Unit</Label>
                <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
                  <SelectTrigger data-testid="select-unit"><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Unit Price ($)</Label><Input type="number" step="0.01" value={form.unitPrice} onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} data-testid="input-unit-price" /></div>
            </div>
            <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button
                onClick={() => saveMutation.mutate({ ...form, unitPrice: Number(form.unitPrice) || 0 })}
                disabled={!form.description || saveMutation.isPending}
                data-testid="button-save-item"
              >{saveMutation.isPending ? "Saving…" : "Save"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload CSV dialog */}
      <Dialog open={uploadOpen} onOpenChange={(o) => { setUploadOpen(o); if (!o) setCsvPreview(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Upload Price List CSV</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Expected columns: <code className="text-xs bg-muted px-1 rounded">category, code, description, unit, unitPrice, notes</code>.
              Only <em>description</em> is required. Categories are free-form — new ones are created on upload.
            </p>
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              <Button variant="outline" onClick={() => fileRef.current?.click()} data-testid="button-choose-csv">
                <Upload className="w-4 h-4 mr-2" /> Choose CSV File
              </Button>
              <Button variant="outline" onClick={downloadTemplate}><Download className="w-4 h-4 mr-2" /> Template</Button>
            </div>
            {csvPreview && (
              <>
                <div className="flex items-center gap-3 p-3 rounded bg-muted/40">
                  <div className="flex-1 text-sm">
                    <strong>{csvPreview.length}</strong> rows parsed across <strong>{new Set(csvPreview.map(r => r.category)).size}</strong> categories.
                  </div>
                  <Select value={csvMode} onValueChange={(v) => setCsvMode(v as any)}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="replace">Replace ALL</SelectItem>
                      <SelectItem value="append">Append</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {csvMode === "replace" && (
                  <div className="flex items-start gap-2 p-3 rounded border border-amber-300 bg-amber-50 text-amber-900 text-sm">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>This will <strong>delete every existing line item</strong> ({items.length} total) and replace them with the {csvPreview.length} rows above. Existing estimates and invoices keep their line items; only the reusable library is replaced.</div>
                  </div>
                )}
                <div className="max-h-64 overflow-auto border rounded">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 sticky top-0"><tr>
                      <th className="text-left px-2 py-1">Category</th>
                      <th className="text-left px-2 py-1">Code</th>
                      <th className="text-left px-2 py-1">Description</th>
                      <th className="text-left px-2 py-1">Unit</th>
                      <th className="text-right px-2 py-1">Price</th>
                    </tr></thead>
                    <tbody>
                      {csvPreview.slice(0, 100).map((r, i) => (
                        <tr key={i} className="border-b">
                          <td className="px-2 py-1">{r.category}</td>
                          <td className="px-2 py-1 font-mono">{r.code}</td>
                          <td className="px-2 py-1">{r.description}</td>
                          <td className="px-2 py-1">{r.unit}</td>
                          <td className="px-2 py-1 text-right">${Number(r.unitPrice).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {csvPreview.length > 100 && <div className="p-2 text-center text-xs text-muted-foreground">…and {csvPreview.length - 100} more rows.</div>}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setCsvPreview(null)}>Cancel</Button>
                  <Button
                    onClick={() => {
                      if (csvMode === "replace" && !confirm(`Delete all ${items.length} existing items and replace with ${csvPreview.length}?`)) return;
                      bulkMutation.mutate({ items: csvPreview, mode: csvMode });
                    }}
                    disabled={bulkMutation.isPending}
                    data-testid="button-confirm-upload"
                    className={csvMode === "replace" ? "bg-destructive text-destructive-foreground" : ""}
                  >{bulkMutation.isPending ? "Uploading…" : (csvMode === "replace" ? "Replace ALL items" : "Append items")}</Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename / delete category dialog */}
      <Dialog open={!!renameCat} onOpenChange={(o) => { if (!o) setRenameCat(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Rename or delete "{renameCat?.from}"</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>New name</Label>
              <Input value={renameCat?.to || ""} onChange={e => setRenameCat(rc => rc ? { ...rc, to: e.target.value } : rc)} />
            </div>
            <div className="flex justify-between pt-2">
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => { if (renameCat && confirm(`Delete category "${renameCat.from}" and all ${items.filter(i => i.category === renameCat.from).length} of its items?`)) deleteCatMutation.mutate(renameCat.from); }}
              ><Trash2 className="w-4 h-4 mr-2" /> Delete category</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setRenameCat(null)}>Cancel</Button>
                <Button
                  onClick={() => { if (renameCat && renameCat.to.trim() && renameCat.to !== renameCat.from) renameCatMutation.mutate({ from: renameCat.from, to: renameCat.to.trim() }); }}
                  disabled={!renameCat?.to.trim() || renameCat?.to === renameCat?.from}
                >Rename</Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add category dialog */}
      <Dialog open={newCatOpen} onOpenChange={setNewCatOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Category</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Category name</Label>
              <Input autoFocus value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="e.g. Cat 4, Reconstruction, Mold" />
              <p className="text-xs text-muted-foreground mt-1">Categories don't need to exist independently — they become visible once at least one item uses them. Click Save to create a placeholder item.</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setNewCatOpen(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  const name = newCatName.trim();
                  if (!name) return;
                  // Seed a single placeholder line so the category appears in
                  // the picker immediately. The admin can rename or delete it.
                  saveMutation.mutate({ category: name, code: "", description: "New item — edit me", unit: "EA", unitPrice: 0, notes: "", isCustom: 1 });
                  setNewCatOpen(false);
                  setActiveCat(name);
                }}
                disabled={!newCatName.trim()}
              >Create category</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Adjust Prices dialog — bulk +/- flat or percent, scoped to All or one category */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Adjust Prices</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Scope</Label>
              <Select value={adjustScope} onValueChange={setAdjustScope}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All categories ({items.length} items)</SelectItem>
                  {categoriesToShow.map((c: string) => {
                    const n = items.filter(i => i.category === c).length;
                    return <SelectItem key={c} value={c}>{c} ({n} items)</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Adjustment type</Label>
              <Select value={adjustMode} onValueChange={(v: any) => setAdjustMode(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Flat dollar amount (e.g. +0.15)</SelectItem>
                  <SelectItem value="percent">Percent (e.g. 10 for +10%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{adjustMode === "flat" ? "Amount ($)" : "Percent (%)"}</Label>
              <Input
                type="number"
                step={adjustMode === "flat" ? "0.01" : "0.1"}
                value={adjustValue}
                onChange={e => setAdjustValue(e.target.value)}
                placeholder={adjustMode === "flat" ? "0.15 or -0.25" : "10 or -5"}
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-1">
                {adjustMode === "flat"
                  ? "Adds this dollar amount to every unit price. Use a negative number to subtract. Prices are clamped at $0."
                  : "Multiplies every unit price. 10 = mark up 10%. -5 = mark down 5%."}
              </p>
            </div>
            <div className="rounded-md bg-warning/10 border border-warning/30 p-3 text-xs flex gap-2">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <div>This rewrites the stored unit prices. Export a snapshot first if you might need to revert.</div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  const n = Number(adjustValue);
                  if (!Number.isFinite(n) || n === 0) { toast({ title: "Enter a non-zero value", variant: "destructive" }); return; }
                  const scope = adjustScope === "__all__" ? null : adjustScope;
                  const count = items.filter(i => !scope || i.category === scope).length;
                  const label = adjustMode === "flat" ? `${n > 0 ? "+" : ""}$${n.toFixed(2)}` : `${n > 0 ? "+" : ""}${n}%`;
                  if (!confirm(`Apply ${label} to ${count} item${count === 1 ? "" : "s"}${scope ? ` in ${scope}` : ""}?`)) return;
                  if (adjustMode === "flat") adjustMutation.mutate({ addFlat: n, category: scope });
                  else adjustMutation.mutate({ multiplyBy: 1 + n / 100, category: scope });
                }}
                disabled={adjustMutation.isPending}
              >{adjustMutation.isPending ? "Adjusting…" : "Apply"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
