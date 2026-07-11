import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useState } from "react";
import { ArrowLeft, Plus, Trash2, Zap, Shield, FileText, Sparkles, AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Estimate, Job } from "@shared/schema";

const IICRC_QUICK_ADD = [
  { description: "Emergency Response/Mobilization", category: "emergency", unit: "LS", unitPrice: 450 },
  { description: "Water Extraction – Category 1", category: "extraction", unit: "SF", unitPrice: 0.35 },
  { description: "Water Extraction – Category 2", category: "extraction", unit: "SF", unitPrice: 0.45 },
  { description: "Water Extraction – Category 3", category: "extraction", unit: "SF", unitPrice: 0.65 },
  { description: "LGR Dehumidifier – Commercial", category: "drying", unit: "days", unitPrice: 85 },
  { description: "Air Mover – Commercial Grade", category: "drying", unit: "days", unitPrice: 25 },
  { description: "Desiccant Dehumidifier", category: "drying", unit: "days", unitPrice: 145 },
  { description: "Antimicrobial Application – Cat 2", category: "treatment", unit: "SF", unitPrice: 0.35 },
  { description: "Antimicrobial Application – Cat 3", category: "treatment", unit: "SF", unitPrice: 0.55 },
  { description: "Structural Drying – Hardwood Floor", category: "drying", unit: "SF", unitPrice: 1.85 },
  { description: "Moisture Mapping/Monitoring", category: "documentation", unit: "visit", unitPrice: 125 },
  { description: "Asbestos Testing / Pre-Demo", category: "testing", unit: "sample", unitPrice: 275 },
  { description: "Contents Pack-Out", category: "contents", unit: "LS", unitPrice: 1200 },
  { description: "Hydroxyl Generator – Odor Removal", category: "odor", unit: "days", unitPrice: 275 },
  { description: "Emergency Board-Up", category: "emergency", unit: "LS", unitPrice: 650 },
  { description: "Temporary Power", category: "emergency", unit: "days", unitPrice: 95 },
  { description: "Roof Tarping", category: "emergency", unit: "SQ", unitPrice: 225 },
  { description: "Smoke/Soot Cleaning – Walls", category: "cleaning", unit: "SF", unitPrice: 1.25 },
  { description: "Mold Remediation – Containment Setup", category: "mold", unit: "LS", unitPrice: 850 },
  { description: "Debris Removal – Dumpster", category: "demo", unit: "load", unitPrice: 450 },
];

interface LineItem { id: number; description: string; category: string; qty: number; unit: string; unitPrice: number; total: number; }

interface ScopeItem {
  description: string;
  category: string;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
  reference?: string;
}

interface ScopeResult {
  items: ScopeItem[];
  subtotal: number;
  total: number;
  detectedScope: {
    lossType: string;
    waterCategory?: number;
    squareFootage: number;
    rooms: number;
    days: number;
    flags: string[];
  };
  message: string;
}

export default function EstimateDetail() {
  const { id } = useParams();
  const { data: estimate, isLoading } = useQuery<Estimate>({ queryKey: ["/api/estimates", id] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const [rebuttal, setRebuttal] = useState("");
  const [rebuttalMeta, setRebuttalMeta] = useState<{ state: string; stateName: string; statutesUsed: { code: string; topic: string; rebuttalHook: string }[] } | null>(null);

  // Scope Estimator state
  const [scopeText, setScopeText] = useState("");
  const [scopeLossType, setScopeLossType] = useState("auto");
  const [scopeSqft, setScopeSqft] = useState("");
  const [scopeRooms, setScopeRooms] = useState("");
  const [scopeResult, setScopeResult] = useState<ScopeResult | null>(null);
  const [selectedScopeItems, setSelectedScopeItems] = useState<Set<number>>(new Set());

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/estimates/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/estimates"] }),
  });

  const rebuttalMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/estimates/${id}/rebuttal`, {}).then(r => r.json()),
    onSuccess: (data: any) => {
      setRebuttal(data.rebuttalText);
      setRebuttalMeta({ state: data.state, stateName: data.stateName, statutesUsed: data.statutesUsed || [] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", id] });
    },
  });

  const scopeMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/estimates/${id}/scope-generate`, {
        scope: scopeText,
        lossType: scopeLossType === "auto" ? undefined : scopeLossType,
        squareFootage: scopeSqft ? Number(scopeSqft) : undefined,
        affectedRooms: scopeRooms ? Number(scopeRooms) : undefined,
      }).then(r => r.json()),
    onSuccess: (data: any) => {
      setScopeResult(data);
      setSelectedScopeItems(new Set(data.items.map((_: ScopeItem, i: number) => i)));
    },
  });

  const applySelectedScopeItems = () => {
    if (!scopeResult) return;
    const newItems: LineItem[] = scopeResult.items
      .filter((_, i) => selectedScopeItems.has(i))
      .map((item, i) => ({
        id: Date.now() + i,
        description: item.description,
        category: item.category,
        qty: item.qty,
        unit: item.unit,
        unitPrice: item.unitPrice,
        total: item.total,
      }));
    saveItems([...lineItems, ...newItems]);
    setScopeResult(null);
    setScopeText("");
    setSelectedScopeItems(new Set());
  };

  const toggleScopeItem = (idx: number) => {
    setSelectedScopeItems(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!estimate) return <div className="p-6 text-destructive">Estimate not found.</div>;

  const lineItems: LineItem[] = JSON.parse(estimate.lineItems || "[]");
  const job = jobs.find(j => j.id === estimate.jobId);

  const saveItems = (items: LineItem[]) => {
    const subtotal = items.reduce((s, i) => s + i.total, 0);
    updateMutation.mutate({ lineItems: JSON.stringify(items), subtotal, total: subtotal });
  };

  const addItem = (template?: Partial<LineItem>) => {
    const newItem: LineItem = {
      id: Date.now(), description: template?.description || "", category: template?.category || "general",
      qty: 1, unit: template?.unit || "EA", unitPrice: template?.unitPrice || 0, total: template?.unitPrice || 0,
    };
    saveItems([...lineItems, newItem]);
  };

  const updateItem = (idx: number, field: keyof LineItem, val: any) => {
    const items = lineItems.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [field]: field === "qty" || field === "unitPrice" ? Number(val) : val };
      updated.total = updated.qty * updated.unitPrice;
      return updated;
    });
    saveItems(items);
  };

  const removeItem = (idx: number) => saveItems(lineItems.filter((_, i) => i !== idx));

  const displayRebuttal = rebuttal || estimate.rebuttalText || "";

  const lossTypeLabel = (lt: string) =>
    lt.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  const waterCatColor = (cat?: number) => {
    if (!cat) return "";
    if (cat === 1) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    if (cat === 2) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/estimates"><Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Estimates</Button></Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{estimate.title}</h1>
          <p className="text-sm text-muted-foreground">{job?.jobNumber} · {estimate.status}</p>
        </div>
        <Select value={estimate.status} onValueChange={v => updateMutation.mutate({ status: v })}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["draft","sent","approved","rejected"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="lineitems">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="lineitems">Line Items</TabsTrigger>
          <TabsTrigger value="scope" className="flex items-center gap-1">
            <Sparkles className="w-3 h-3" />AI Scope Engine
          </TabsTrigger>
          <TabsTrigger value="quickadd">IICRC Quick Add</TabsTrigger>
          <TabsTrigger value="negotiation">Negotiation Tool</TabsTrigger>
        </TabsList>

        {/* ── LINE ITEMS ── */}
        <TabsContent value="lineitems" className="mt-4 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left py-2 pr-3 min-w-[200px]">Description</th>
                  <th className="text-left py-2 px-2 w-24">Category</th>
                  <th className="text-right py-2 px-2 w-20">Qty</th>
                  <th className="text-left py-2 px-2 w-20">Unit</th>
                  <th className="text-right py-2 px-2 w-24">Unit Price</th>
                  <th className="text-right py-2 px-2 w-24">Total</th>
                  <th className="py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item, idx) => (
                  <tr key={item.id} className="border-b hover:bg-muted/30">
                    <td className="py-1.5 pr-3">
                      <Input className="h-7 text-xs" value={item.description} onChange={e => updateItem(idx, "description", e.target.value)} />
                    </td>
                    <td className="py-1.5 px-2">
                      <Input className="h-7 text-xs w-24" value={item.category} onChange={e => updateItem(idx, "category", e.target.value)} />
                    </td>
                    <td className="py-1.5 px-2">
                      <Input className="h-7 text-xs text-right w-16" type="number" value={item.qty} onChange={e => updateItem(idx, "qty", e.target.value)} />
                    </td>
                    <td className="py-1.5 px-2">
                      <Input className="h-7 text-xs w-16" value={item.unit} onChange={e => updateItem(idx, "unit", e.target.value)} />
                    </td>
                    <td className="py-1.5 px-2">
                      <Input className="h-7 text-xs text-right w-20" type="number" step="0.01" value={item.unitPrice} onChange={e => updateItem(idx, "unitPrice", e.target.value)} />
                    </td>
                    <td className="py-1.5 px-2 text-right font-semibold">${item.total.toFixed(2)}</td>
                    <td className="py-1.5">
                      <button onClick={() => removeItem(idx)} className="text-destructive hover:text-destructive/70 p-1"><Trash2 className="w-3 h-3" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} className="py-3 text-right font-bold">Total:</td>
                  <td className="py-3 px-2 text-right font-bold text-lg text-[hsl(var(--titan-blue))]">${(estimate.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <Button variant="outline" size="sm" onClick={() => addItem()}>
            <Plus className="w-4 h-4 mr-1" />Add Line Item
          </Button>
        </TabsContent>

        {/* ── AI SCOPE ENGINE ── */}
        <TabsContent value="scope" className="mt-4 space-y-4">
          {/* Input card */}
          <Card className="border-[hsl(var(--titan-blue)/0.35)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
                AI Scope-to-Estimate Engine
                <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0 text-[hsl(var(--titan-blue))] border-[hsl(var(--titan-blue)/0.4)]">IICRC + Xactimate Pricing</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              <p className="text-xs text-muted-foreground">
                Describe the loss in plain language. The engine auto-detects loss type, water category, quantities, and materials — then generates IICRC S500/S520/S770-referenced line items with current Xactimate Augusta GA regional pricing.
              </p>

              <div>
                <Label className="text-xs mb-1.5 block font-medium">
                  Scope Description <span className="text-muted-foreground font-normal">(required)</span>
                </Label>
                <Textarea
                  data-testid="input-scope-text"
                  className="min-h-[140px] text-sm"
                  placeholder={`Example: "Category 2 water loss in kitchen and hallway, approx 600 sq ft. Vinyl flooring and drywall wet. 4 rooms affected. Started 3 days ago. No visible mold but humidity is high. Need full mitigation and flooring demo."`}
                  value={scopeText}
                  onChange={e => setScopeText(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs mb-1.5 block font-medium">Loss Type Override</Label>
                  <Select value={scopeLossType} onValueChange={setScopeLossType}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-scope-loss-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto-detect</SelectItem>
                      <SelectItem value="water">Water</SelectItem>
                      <SelectItem value="fire">Fire / Smoke</SelectItem>
                      <SelectItem value="mold">Mold</SelectItem>
                      <SelectItem value="storm">Storm</SelectItem>
                      <SelectItem value="reconstruction">Reconstruction</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block font-medium">
                    Square Footage <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    data-testid="input-scope-sqft"
                    className="h-8 text-xs"
                    type="number"
                    placeholder="e.g. 600"
                    value={scopeSqft}
                    onChange={e => setScopeSqft(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block font-medium">
                    Affected Rooms <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    data-testid="input-scope-rooms"
                    className="h-8 text-xs"
                    type="number"
                    placeholder="e.g. 4"
                    value={scopeRooms}
                    onChange={e => setScopeRooms(e.target.value)}
                  />
                </div>
              </div>

              <Button
                className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
                onClick={() => scopeMutation.mutate()}
                disabled={scopeMutation.isPending || !scopeText.trim()}
                data-testid="button-generate-scope"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {scopeMutation.isPending ? "Analyzing scope…" : "Generate Estimate"}
              </Button>

              {scopeMutation.isError && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Failed to generate estimate. Please try again.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Results */}
          {scopeResult && (
            <>
              {/* Detected scope summary */}
              <Card className="border-[hsl(var(--titan-blue)/0.2)] bg-[hsl(var(--titan-blue)/0.04)]">
                <CardContent className="pt-4 pb-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-bold text-sm text-[hsl(var(--titan-blue))]">
                      {lossTypeLabel(scopeResult.detectedScope.lossType)} Loss
                    </span>
                    {scopeResult.detectedScope.waterCategory && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${waterCatColor(scopeResult.detectedScope.waterCategory)}`}>
                        Category {scopeResult.detectedScope.waterCategory} Water
                      </span>
                    )}
                    <span className="text-muted-foreground px-2 py-0.5 bg-muted rounded-full">
                      {scopeResult.detectedScope.squareFootage.toLocaleString()} SF
                    </span>
                    <span className="text-muted-foreground px-2 py-0.5 bg-muted rounded-full">
                      {scopeResult.detectedScope.rooms} rooms
                    </span>
                    <span className="text-muted-foreground px-2 py-0.5 bg-muted rounded-full">
                      {scopeResult.detectedScope.days} days
                    </span>
                    <span className="ml-auto font-bold text-base text-[hsl(var(--titan-blue))]">
                      ${scopeResult.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  {/* Risk flags */}
                  {scopeResult.detectedScope.flags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {scopeResult.detectedScope.flags.map((flag, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[hsl(var(--titan-red)/0.1)] text-[hsl(var(--titan-red))] border border-[hsl(var(--titan-red)/0.3)]"
                        >
                          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                          {flag}
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="mt-2.5 text-xs text-muted-foreground italic">{scopeResult.message}</p>
                </CardContent>
              </Card>

              {/* Line items preview table */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      Generated Line Items
                      <span className="font-normal text-muted-foreground">({scopeResult.items.length} items)</span>
                    </CardTitle>
                    <div className="flex items-center gap-3">
                      <button
                        className="text-xs text-[hsl(var(--titan-blue))] hover:underline"
                        onClick={() => setSelectedScopeItems(new Set(scopeResult.items.map((_, i) => i)))}
                      >
                        Select all
                      </button>
                      <span className="text-muted-foreground text-xs">·</span>
                      <button
                        className="text-xs text-muted-foreground hover:underline"
                        onClick={() => setSelectedScopeItems(new Set())}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="py-2 w-8 text-center">✓</th>
                          <th className="text-left py-2 pr-3">Description</th>
                          <th className="text-left py-2 px-2 hidden md:table-cell w-28">IICRC Ref</th>
                          <th className="text-left py-2 px-2 hidden sm:table-cell w-20">Category</th>
                          <th className="text-right py-2 px-2 w-14">Qty</th>
                          <th className="text-left py-2 px-2 w-14">Unit</th>
                          <th className="text-right py-2 px-2 w-20">Unit $</th>
                          <th className="text-right py-2 pl-2 w-24">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scopeResult.items.map((item, idx) => {
                          const selected = selectedScopeItems.has(idx);
                          return (
                            <tr
                              key={idx}
                              className={`border-b cursor-pointer transition-colors ${
                                selected
                                  ? "bg-[hsl(var(--titan-blue)/0.06)] hover:bg-[hsl(var(--titan-blue)/0.1)]"
                                  : "opacity-40 hover:opacity-60"
                              }`}
                              onClick={() => toggleScopeItem(idx)}
                            >
                              <td className="py-1.5 text-center">
                                <div className={`w-4 h-4 rounded border mx-auto flex items-center justify-center transition-colors ${
                                  selected
                                    ? "bg-[hsl(var(--titan-blue))] border-[hsl(var(--titan-blue))]"
                                    : "border-muted-foreground/40"
                                }`}>
                                  {selected && <CheckCircle2 className="w-3 h-3 text-white" />}
                                </div>
                              </td>
                              <td className="py-1.5 pr-3 font-medium leading-snug">{item.description}</td>
                              <td className="py-1.5 px-2 text-muted-foreground hidden md:table-cell">{item.reference || "—"}</td>
                              <td className="py-1.5 px-2 text-muted-foreground hidden sm:table-cell capitalize">{item.category}</td>
                              <td className="py-1.5 px-2 text-right">{item.qty}</td>
                              <td className="py-1.5 px-2">{item.unit}</td>
                              <td className="py-1.5 px-2 text-right">${item.unitPrice.toFixed(2)}</td>
                              <td className="py-1.5 pl-2 text-right font-semibold">${item.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t bg-muted/30">
                          <td colSpan={6} className="py-2 pl-2 text-right text-muted-foreground font-medium">Subtotal:</td>
                          <td colSpan={2} className="py-2 pr-2 text-right font-semibold">
                            ${scopeResult.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                        <tr className="bg-muted/30">
                          <td colSpan={6} className="py-2 pl-2 text-right font-bold">Total (w/ O&P 20%):</td>
                          <td colSpan={2} className="py-2 pr-2 text-right font-bold text-base text-[hsl(var(--titan-blue))]">
                            ${scopeResult.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div className="mt-4 pt-3 border-t flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {selectedScopeItems.size} of {scopeResult.items.length} items selected
                      {selectedScopeItems.size > 0 && (
                        <span className="ml-1 font-semibold text-foreground">
                          — ${
                            scopeResult.items
                              .filter((_, i) => selectedScopeItems.has(i))
                              .reduce((s, item) => s + item.total, 0)
                              .toLocaleString(undefined, { minimumFractionDigits: 2 })
                          }
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setScopeResult(null); setSelectedScopeItems(new Set()); }}
                      >
                        Discard
                      </Button>
                      <Button
                        size="sm"
                        className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
                        onClick={applySelectedScopeItems}
                        disabled={selectedScopeItems.size === 0}
                        data-testid="button-apply-scope"
                      >
                        <ChevronRight className="w-4 h-4 mr-1" />
                        Apply {selectedScopeItems.size} Item{selectedScopeItems.size !== 1 ? "s" : ""} to Estimate
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── IICRC QUICK ADD ── */}
        <TabsContent value="quickadd" className="mt-4">
          <p className="text-sm text-muted-foreground mb-3">IICRC-compliant quick-add items based on industry standards and Xactimate pricing.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {IICRC_QUICK_ADD.map((item, i) => (
              <button
                key={i}
                className="text-left p-3 rounded-lg border hover:border-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue)/0.05)] transition-colors"
                onClick={() => addItem(item)}
              >
                <p className="text-sm font-medium leading-snug">{item.description}</p>
                <p className="text-xs text-muted-foreground mt-0.5">${item.unitPrice} / {item.unit} · {item.category}</p>
              </button>
            ))}
          </div>
        </TabsContent>

        {/* ── NEGOTIATION TOOL ── */}
        <TabsContent value="negotiation" className="mt-4 space-y-4">
          <Card className="border-[hsl(var(--titan-red)/0.3)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="w-4 h-4 text-[hsl(var(--titan-red))]" />
                Auto-Rebuttal Generator
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground mb-3">
                Auto-detects job state (SC/GA) from address, pulls all relevant statutes for the loss type, and generates a formal carrier rebuttal with IICRC justifications. No manual input required.
              </p>
              {job?.address && (
                <p className="text-xs mb-3 bg-muted/50 px-3 py-2 rounded">
                  <span className="text-muted-foreground">Job address: </span>
                  <span className="font-medium">{job.address}</span>
                </p>
              )}
              <Button
                className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
                onClick={() => rebuttalMutation.mutate()}
                disabled={rebuttalMutation.isPending}
                data-testid="button-generate-rebuttal"
              >
                <Zap className="w-4 h-4 mr-2" />
                {rebuttalMutation.isPending ? "Generating…" : "Generate Rebuttal"}
              </Button>
            </CardContent>
          </Card>

          {rebuttalMeta && (
            <Card className="border-[hsl(var(--titan-blue)/0.3)]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
                  Detected State: {rebuttalMeta.stateName}
                  <span className="ml-auto text-xs font-normal text-muted-foreground">{rebuttalMeta.statutesUsed.length} statutes applied</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {rebuttalMeta.statutesUsed.map((s, i) => (
                    <div key={i} className="text-xs border rounded p-2">
                      <p className="font-semibold text-[hsl(var(--titan-blue))]">{s.code}</p>
                      <p className="text-muted-foreground">{s.topic}</p>
                      <p className="mt-0.5 text-foreground/80 italic">{s.rebuttalHook}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {displayRebuttal && (
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Rebuttal Letter</CardTitle>
                <Button variant="outline" size="sm" onClick={() => navigator.clipboard?.writeText(displayRebuttal)}>
                  <FileText className="w-3 h-3 mr-1" />Copy
                </Button>
              </CardHeader>
              <CardContent className="pt-0">
                <Textarea
                  className="font-mono text-xs min-h-[400px]"
                  value={displayRebuttal}
                  onChange={e => setRebuttal(e.target.value)}
                  readOnly={false}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
