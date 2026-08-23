import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, Trash2, Zap, Shield, FileText, Sparkles, AlertTriangle, CheckCircle2, ChevronRight, Copy, GripVertical, ChevronUp, ChevronDown, StickyNote, Wrench, Package, HardHat, Save, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Estimate, Job, Contact } from "@shared/schema";
import { SendAndSavePanel } from "@/components/SendAndSavePanel";
import { generateEstimatePDF } from "@/lib/pdfEngine";

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

// Line items are stored as JSON on the estimate row, so we can add
// optional fields (notes, kind) without a schema migration. Older estimates
// that were saved before these fields existed still load fine — the
// undefined props simply mean "no notes, generic kind".
interface LineItem {
  id: number;
  description: string;
  category: string;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
  notes?: string;                                              // optional per-line detail
  kind?: "labor" | "material" | "equipment" | "other";         // classifies the row for reports
}

// Common construction/restoration units — kept in one place so every row
// dropdown stays consistent. Techs can still type a custom unit if their
// scope demands one ("tape", "section", etc).
const COMMON_UNITS = [
  "EA", "LS", "HR", "DAY", "WK",
  "SF", "SY", "LF", "CF", "CY",
  "SQ", "LB", "GAL", "BX", "ROLL",
  "visit", "sample", "load", "trip",
];

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
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const [rebuttal, setRebuttal] = useState("");
  const [rebuttalMeta, setRebuttalMeta] = useState<{ state: string; stateName: string; statutesUsed: { code: string; topic: string; rebuttalHook: string }[] } | null>(null);

  // Scope Estimator state
  const [scopeText, setScopeText] = useState("");
  const [scopeLossType, setScopeLossType] = useState("auto");
  const [scopeSqft, setScopeSqft] = useState("");
  const [scopeRooms, setScopeRooms] = useState("");
  const [scopeResult, setScopeResult] = useState<ScopeResult | null>(null);
  const [selectedScopeItems, setSelectedScopeItems] = useState<Set<number>>(new Set());

  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  // Owner/admin/general_manager can delete an entire estimate; sales can
  // still edit line items but can't nuke another rep's work.
  const canDelete = !!user && (["owner", "admin", "general_manager"] as string[]).includes(user.role);

  // Save-status pill — flashes "Saved" briefly after each successful PATCH
  // so users can trust that their debounced edits actually landed. Declared
  // early so the updateMutation.onSuccess closure below can call it.
  const [justSavedAt, setJustSavedAt] = useState<number>(0);

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/estimates/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      // Job screen Estimates tab reads from /api/jobs/:id/estimates —
      // refresh it too so a saved line-item change shows up under the job.
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      // Financial Summary on the Job → Activity tab reads from
      // /api/jobs/financials which sums estimate totals. Refresh it
      // whenever the estimate changes so the card updates immediately.
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      // Flash the "Saved" pill so users can see their debounced typing
      // actually persisted. Timestamp — the pill auto-hides via reactive
      // computation, no timeout wiring required.
      setJustSavedAt(Date.now());
    },
    // Surface save failures instead of silently swallowing them — previously
    // a 403 or network error looked identical to a successful save.
    onError: (e: any) => toast({
      title: "Save failed",
      description: e?.message || "Estimate did not save. Check your role and try again.",
      variant: "destructive",
    }),
  });

  // Full-estimate delete. Confirms first, then navigates back to the parent
  // Estimates list on success.
  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/estimates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      toast({ title: "Estimate deleted" });
      setLocation("/estimates");
    },
    onError: (e: any) => toast({
      title: "Delete failed",
      description: e?.message || "Estimate could not be deleted.",
      variant: "destructive",
    }),
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
    if (newItems.length === 0) {
      toast({ title: "No items selected", description: "Pick at least one scope item to add.", variant: "destructive" });
      return;
    }
    // Structural change — save immediately, not debounced. Otherwise the
    // Scope Engine "Add" click looked like it did nothing when the user
    // navigated away before the 500 ms debounced PATCH fired.
    saveItems([...lineItems, ...newItems], true);
    toast({ title: `${newItems.length} item${newItems.length === 1 ? "" : "s"} added to estimate` });
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

  // ── Line items: LOCAL-STATE-FIRST editing ──
  //
  // Previously, every keystroke in a line-item input called saveItems(),
  // which fired a PATCH and (on success) invalidated the /api/estimates
  // query — which re-rendered the whole table from server data mid-type.
  // Users experienced typing lag and "lost" characters when server
  // responses arrived out of order.
  //
  // Now: line items live in local state. Edits mutate local state
  // synchronously (input feels instant) and a 500ms debounced save syncs
  // to the server in the background. We only overwrite local state from
  // the server payload when (a) the estimate id changes, or (b) we're
  // NOT currently in the middle of editing (no pending save).
  const [localItems, setLocalItems] = useState<LineItem[] | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef(false);

  // Track which rows have their notes accordion expanded. Multiple rows can
  // be open at once so a user can write notes on several items in a row.
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<number>>(new Set());
  const toggleNote = (id: number) => setExpandedNoteIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Debounced-save scaffolding for top-level estimate fields (notes, title).
  // Declared before the early-return so React hook order stays stable across
  // renders whether or not the estimate has finished loading.
  const fieldSaveTimersRef = useRef<Record<string, number | null>>({});
  const [draftFields, setDraftFields] = useState<Record<string, string>>({});

  // Hydrate/refresh from server. Runs when the estimate id changes or
  // when a server refetch delivers new data AND no save is currently in
  // flight (so we don't clobber the user's in-progress typing).
  useEffect(() => {
    if (!estimate) return;
    if (pendingSaveRef.current) return;
    try {
      const parsed: LineItem[] = JSON.parse(estimate.lineItems || "[]");
      setLocalItems(parsed);
    } catch {
      setLocalItems([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, estimate?.lineItems]);

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!estimate) return <div className="p-6 text-destructive">Estimate not found.</div>;

  const lineItems: LineItem[] = localItems ?? JSON.parse(estimate.lineItems || "[]");
  const job = jobs.find(j => j.id === estimate.jobId);

  // Debounced save. Immediate=true skips the timer and PATCHes now — used
  // for structural changes (add/remove row) that should hit the server
  // right away so the totals and item ids don't drift. We preserve the
  // existing tax value so line-item edits don't blow it away.
  const saveItems = (items: LineItem[], immediate = false) => {
    setLocalItems(items);
    pendingSaveRef.current = true;
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const doSave = () => {
      const subtotal = items.reduce((s, i) => s + i.total, 0);
      const tax = Number(estimate.tax) || 0;
      updateMutation.mutate(
        { lineItems: JSON.stringify(items), subtotal, tax, total: subtotal + tax },
        {
          onSettled: () => { pendingSaveRef.current = false; },
        },
      );
    };
    if (immediate) {
      doSave();
    } else {
      saveTimerRef.current = window.setTimeout(doSave, 500);
    }
  };

  // Debounced save of a single top-level estimate field (notes, title, etc).
  // Uses the same timer strategy as saveItems so users can type freely into
  // the notes textarea without a PATCH on every keystroke.
  const saveField = (field: "notes" | "title", value: string, delayMs = 600) => {
    setDraftFields(prev => ({ ...prev, [field]: value }));
    const existing = fieldSaveTimersRef.current[field];
    if (existing != null) window.clearTimeout(existing);
    pendingSaveRef.current = true;
    fieldSaveTimersRef.current[field] = window.setTimeout(() => {
      updateMutation.mutate(
        { [field]: value },
        { onSettled: () => { pendingSaveRef.current = false; } },
      );
    }, delayMs);
  };

  const addItem = (template?: Partial<LineItem>) => {
    const newItem: LineItem = {
      id: Date.now(),
      description: template?.description || "",
      category: template?.category || "general",
      qty: template?.qty ?? 1,
      unit: template?.unit || "EA",
      unitPrice: template?.unitPrice || 0,
      total: (template?.qty ?? 1) * (template?.unitPrice || 0),
      notes: template?.notes,
      kind: template?.kind,
    };
    // Structural change — save immediately.
    saveItems([...lineItems, newItem], true);
    // Auto-expand the new row's notes if the caller seeded a note (rare
    // but keeps the UX consistent when templates carry details).
    if (template?.notes) setExpandedNoteIds(prev => new Set(prev).add(newItem.id));
  };

  // Auto-learn: whenever a line item is saved with a real description AND a
  // real unit price, upsert it into the shared org-wide Quick Add library so
  // future estimates can one-tap it. Server dedupes by normalized description
  // and silently no-ops for empty/$0 rows, so we can fire on every keystroke
  // debounce cycle without worrying about pollution. Errors are silent —
  // the library is a nice-to-have and shouldn't block estimate saves.
  const learnItem = (it: Partial<LineItem>) => {
    const desc = String(it.description || "").trim();
    const price = Number(it.unitPrice) || 0;
    if (!desc || price <= 0) return;
    fetch("/api/quick-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        description: desc,
        unitPrice: price,
        unit: it.unit || "EA",
        category: it.category || "general",
        kind: it.kind || null,
      }),
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/quick-add"] }))
      .catch(() => {});
  };

  const updateItem = (idx: number, field: keyof LineItem, val: any) => {
    const items = lineItems.map((it, i) => {
      if (i !== idx) return it;
      const numeric = field === "qty" || field === "unitPrice";
      const nextVal = numeric ? (val === "" ? 0 : Number(val)) : val;
      const updated: LineItem = { ...it, [field]: nextVal };
      updated.total = updated.qty * updated.unitPrice;
      return updated;
    });
    // Keystroke change — debounce the save.
    saveItems(items, false);
  };

  // Structural change — save immediately. On remove, no learning needed.
  const removeItem = (idx: number) => saveItems(lineItems.filter((_, i) => i !== idx), true);

  // Whenever local items settle (debounce completed), teach any "complete"
  // rows to the Quick Add library. This runs after every state settle, so
  // duplicating a row and editing the copy also learns the copy — without
  // us having to sprinkle learnItem calls through every code path.
  useEffect(() => {
    if (pendingSaveRef.current) return; // wait for saves to flush
    for (const it of lineItems) learnItem(it);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(lineItems.map(i => `${i.description}|${i.unitPrice}|${i.unit}|${i.category}|${i.kind}`))]);

  // Duplicate a row — handy when building a repeated set of items with only
  // the description or qty changing between them (three sizes of the same
  // dehu, five identical door replacements, etc). New id so React keys stay
  // unique and the debounced save doesn't collapse the two rows together.
  const duplicateItem = (idx: number) => {
    const src = lineItems[idx];
    if (!src) return;
    const copy: LineItem = { ...src, id: Date.now() + idx + 1 };
    const next = [...lineItems.slice(0, idx + 1), copy, ...lineItems.slice(idx + 1)];
    saveItems(next, true);
  };

  // Move a row up/down. Reordering is a structural change, save immediately.
  const moveItem = (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= lineItems.length) return;
    const next = [...lineItems];
    [next[idx], next[target]] = [next[target], next[idx]];
    saveItems(next, true);
  };

  const displayRebuttal = rebuttal || estimate.rebuttalText || "";

  // Compute a save-status label. isPending covers the in-flight PATCH;
  // justSavedAt >0 within the last 1.5s means a recent success — we let the
  // toast/pill briefly reflect that so the user knows their edits landed.
  const saveStatus: "saving" | "saved" | "idle" =
    updateMutation.isPending || pendingSaveRef.current
      ? "saving"
      : justSavedAt > 0 && Date.now() - justSavedAt < 1500
      ? "saved"
      : "idle";

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
        {canDelete && (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/40 hover:bg-destructive/10"
            onClick={() => {
              if (window.confirm(`Delete estimate "${estimate.title}"? This cannot be undone.`)) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
            data-testid="button-delete-estimate"
          >
            <Trash2 className="w-4 h-4 mr-1" />
            {deleteMutation.isPending ? "Deleting…" : "Delete"}
          </Button>
        )}
      </div>

      {/* ── Send + save actions ───────────────────────────────────────────────
          Download PDF, save a copy to the job file, or email it to the
          customer with the PDF attached. Server picks Gmail (if any employee
          is connected) or SMTP. See SendAndSavePanel. */}
      {(() => {
        const contact = contacts.find((c: any) => c.id === (job as any)?.contactId);
        const jobAddress =
          (job as any)?.address ||
          [(job as any)?.streetAddress, (job as any)?.city, (job as any)?.state, (job as any)?.zip]
            .filter(Boolean)
            .join(", ");
        const estNumber = estimate.title || `Estimate #${estimate.id}`;
        return (
          <SendAndSavePanel
            jobId={estimate.jobId}
            docType="estimate"
            title={`Estimate — ${estNumber}`}
            defaultTo={(contact as any)?.email || ""}
            defaultSubject={`Your estimate from Titan Restoration — ${estNumber}`}
            defaultBody={
              `Hi ${contact?.name || "there"},\n\n` +
              `Attached is your estimate for the work at ${jobAddress || "your property"}. ` +
              `Please review and reply here with any questions or approval.\n\n` +
              `Thanks,\nTitan Restoration`
            }
            buildPdf={() =>
              generateEstimatePDF({
                estimateNumber: estNumber,
                status: estimate.status || "draft",
                jobNumber: job?.jobNumber,
                createdAt: (estimate as any).createdAt || undefined,
                billTo: {
                  name: (contact as any)?.name,
                  phone: (contact as any)?.phone || undefined,
                  email: (contact as any)?.email || undefined,
                  address: jobAddress || (contact as any)?.address || undefined,
                },
                lineItems: lineItems.map(it => ({
                  description: it.description || "Item",
                  quantity: Number(it.quantity) || 1,
                  unitPrice: Number(it.unitPrice) || 0,
                  total: Number(it.total) || 0,
                  unit: (it as any).unit || undefined,
                  category: (it as any).category || undefined,
                  notes: (it as any).notes || undefined,
                })),
                subtotal: Number((estimate as any).subtotal) || lineItems.reduce((s, i) => s + (Number(i.total) || 0), 0),
                tax: Number((estimate as any).tax) || 0,
                total:
                  Number((estimate as any).total) ||
                  lineItems.reduce((s, i) => s + (Number(i.total) || 0), 0),
                notes: (estimate as any).notes || undefined,
              })
            }
          />
        );
      })()}

      <Tabs defaultValue="lineitems">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="lineitems">Line Items</TabsTrigger>
          <TabsTrigger value="scope" className="flex items-center gap-1">
            <Sparkles className="w-3 h-3" />AI Scope Engine
          </TabsTrigger>
          <TabsTrigger value="quickadd">Quick Add</TabsTrigger>
          <TabsTrigger value="negotiation">Negotiation Tool</TabsTrigger>
        </TabsList>

        {/* ── LINE ITEMS ── */}
        <TabsContent value="lineitems" className="mt-4 space-y-3">
          {/* Toolbar: quick-add starter templates + save-status pill.
              Techs can seed a labor / material / equipment row without
              hunting for the right template in IICRC Quick Add. */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2">
            <span className="text-xs text-muted-foreground pl-1">Add:</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => addItem({ kind: "labor", category: "labor", unit: "HR", description: "" })}
              data-testid="button-add-labor"
            >
              <HardHat className="w-3 h-3 mr-1" />Labor
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => addItem({ kind: "material", category: "material", unit: "EA", description: "" })}
              data-testid="button-add-material"
            >
              <Package className="w-3 h-3 mr-1" />Material
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => addItem({ kind: "equipment", category: "equipment", unit: "DAY", description: "" })}
              data-testid="button-add-equipment"
            >
              <Wrench className="w-3 h-3 mr-1" />Equipment
            </Button>
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs"
              onClick={() => addItem()}
              data-testid="button-add-blank"
            >
              <Plus className="w-3 h-3 mr-1" />Blank Line
            </Button>
            <div className="ml-auto flex items-center gap-2 text-xs">
              {saveStatus === "saving" && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />Saving…
                </span>
              )}
              {saveStatus === "saved" && (
                <span className="flex items-center gap-1 text-green-600 dark:text-green-500">
                  <Save className="w-3 h-3" />Saved
                </span>
              )}
            </div>
          </div>

          {/* Row-based line items list. We moved off <table> because tables
              can't cleanly host a per-row expandable notes area — the
              expanded content had to span all columns which broke the
              alignment on mobile. Each item is now a self-contained card
              row that stacks on narrow screens. */}
          {lineItems.length === 0 ? (
            <div className="text-center py-10 border rounded-lg bg-muted/20 text-muted-foreground text-sm">
              No line items yet. Use the buttons above to add one, or pull from
              the AI Scope Engine or IICRC Quick Add tabs.
            </div>
          ) : (
            <>
              {/* Column header — hidden on mobile since the row is stacked there. */}
              <div className="hidden md:grid grid-cols-[24px_1fr_120px_80px_90px_110px_130px_100px] gap-2 px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                <div></div>
                <div>Description</div>
                <div>Category</div>
                <div className="text-right">Qty</div>
                <div>Unit</div>
                <div className="text-right">Unit Price</div>
                <div className="text-right">Total</div>
                <div className="text-right">Actions</div>
              </div>

              <div className="space-y-1.5">
                {lineItems.map((item, idx) => {
                  const noteOpen = expandedNoteIds.has(item.id);
                  const hasNote = !!(item.notes && item.notes.trim());
                  return (
                    <div
                      key={item.id}
                      className="rounded-lg border bg-card hover:border-[hsl(var(--titan-blue)/0.4)] transition-colors"
                      data-testid={`row-line-item-${idx}`}
                    >
                      <div className="grid grid-cols-1 md:grid-cols-[24px_1fr_120px_80px_90px_110px_130px_100px] gap-2 p-2 items-center">
                        {/* Reorder handle column — visible up/down buttons
                            avoid needing a full drag-and-drop library. */}
                        <div className="flex md:flex-col items-center justify-center text-muted-foreground gap-0.5 md:gap-0">
                          <button
                            className="p-0.5 hover:text-foreground disabled:opacity-30"
                            onClick={() => moveItem(idx, -1)}
                            disabled={idx === 0}
                            title="Move up"
                            aria-label="Move up"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            className="p-0.5 hover:text-foreground disabled:opacity-30"
                            onClick={() => moveItem(idx, 1)}
                            disabled={idx === lineItems.length - 1}
                            title="Move down"
                            aria-label="Move down"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Description — primary field, gets the most room. */}
                        <div>
                          <Label className="text-[10px] text-muted-foreground md:hidden">Description</Label>
                          <Input
                            className="h-8 text-sm"
                            value={item.description}
                            onChange={e => updateItem(idx, "description", e.target.value)}
                            placeholder="Describe the work, materials, or equipment…"
                            data-testid={`input-description-${idx}`}
                          />
                        </div>

                        {/* Category — free text; techs use their own vocabulary. */}
                        <div>
                          <Label className="text-[10px] text-muted-foreground md:hidden">Category</Label>
                          <Input
                            className="h-8 text-xs"
                            value={item.category}
                            onChange={e => updateItem(idx, "category", e.target.value)}
                            placeholder="e.g. water"
                            data-testid={`input-category-${idx}`}
                          />
                        </div>

                        {/* Qty — numeric, right-aligned. */}
                        <div>
                          <Label className="text-[10px] text-muted-foreground md:hidden">Qty</Label>
                          <Input
                            className="h-8 text-sm text-right tabular-nums"
                            type="number"
                            step="0.01"
                            min="0"
                            value={item.qty}
                            onChange={e => updateItem(idx, "qty", e.target.value)}
                            onFocus={e => e.target.select()}
                            data-testid={`input-qty-${idx}`}
                          />
                        </div>

                        {/* Unit — combobox-style: common units in a dropdown,
                            but the input still accepts custom values. We use
                            a native datalist for zero-JS combobox behavior. */}
                        <div>
                          <Label className="text-[10px] text-muted-foreground md:hidden">Unit</Label>
                          <Input
                            className="h-8 text-xs uppercase"
                            list="line-item-units"
                            value={item.unit}
                            onChange={e => updateItem(idx, "unit", e.target.value)}
                            placeholder="EA"
                            data-testid={`input-unit-${idx}`}
                          />
                        </div>

                        {/* Unit price — numeric. */}
                        <div>
                          <Label className="text-[10px] text-muted-foreground md:hidden">Unit Price</Label>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                            <Input
                              className="h-8 text-sm text-right tabular-nums pl-5"
                              type="number"
                              step="0.01"
                              min="0"
                              value={item.unitPrice}
                              onChange={e => updateItem(idx, "unitPrice", e.target.value)}
                              onFocus={e => e.target.select()}
                              data-testid={`input-unitprice-${idx}`}
                            />
                          </div>
                        </div>

                        {/* Line total — computed, read-only. */}
                        <div className="text-right font-semibold tabular-nums text-sm md:pr-1" data-testid={`text-line-total-${idx}`}>
                          <Label className="text-[10px] text-muted-foreground md:hidden">Total</Label>
                          ${item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>

                        {/* Row actions: notes toggle, duplicate, delete. */}
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            className={`p-1.5 rounded hover:bg-muted transition-colors ${
                              noteOpen || hasNote ? "text-[hsl(var(--titan-blue))]" : "text-muted-foreground"
                            }`}
                            onClick={() => toggleNote(item.id)}
                            title={hasNote ? "Edit notes" : "Add notes"}
                            aria-label="Toggle notes"
                            data-testid={`button-note-${idx}`}
                          >
                            <StickyNote className="w-3.5 h-3.5" />
                          </button>
                          <button
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => duplicateItem(idx)}
                            title="Duplicate row"
                            aria-label="Duplicate row"
                            data-testid={`button-duplicate-${idx}`}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            className="p-1.5 rounded hover:bg-destructive/10 text-destructive transition-colors"
                            onClick={() => {
                              if (window.confirm("Delete this line item?")) removeItem(idx);
                            }}
                            title="Delete row"
                            aria-label="Delete row"
                            data-testid={`button-delete-${idx}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Expandable per-row notes area. Persisted on the
                          line item so it exports with the estimate to PDF. */}
                      {noteOpen && (
                        <div className="border-t bg-muted/20 px-3 py-2">
                          <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Line notes</Label>
                          <Textarea
                            className="text-xs mt-1 min-h-[60px]"
                            value={item.notes || ""}
                            onChange={e => updateItem(idx, "notes", e.target.value)}
                            placeholder="Optional detail: scope caveats, IICRC reference, sub-tasks, room list, materials list…"
                            data-testid={`input-notes-${idx}`}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Shared datalist for the Unit combobox on every row. */}
              <datalist id="line-item-units">
                {COMMON_UNITS.map(u => <option key={u} value={u} />)}
              </datalist>
            </>
          )}

          {/* Totals block — subtotal / tax / total. Tax is editable so users
              can dial in a jurisdiction rate; total = subtotal + tax. */}
          {lineItems.length > 0 && (
            <div className="flex flex-col md:flex-row md:justify-end gap-3 pt-2">
              <div className="w-full md:w-80 space-y-1.5 border rounded-lg p-3 bg-card">
                {(() => {
                  const subtotal = lineItems.reduce((s, i) => s + i.total, 0);
                  const tax = Number(estimate.tax) || 0;
                  const taxRatePct = subtotal > 0 ? ((tax / subtotal) * 100) : 0;
                  return (
                    <>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span className="tabular-nums font-medium" data-testid="text-subtotal">
                          ${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm gap-2">
                        <span className="text-muted-foreground flex items-center gap-1">
                          Tax
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            className="h-6 w-14 text-xs px-1.5 text-right"
                            value={Number.isFinite(taxRatePct) ? taxRatePct.toFixed(2) : "0.00"}
                            onChange={e => {
                              const pct = Number(e.target.value) || 0;
                              const newTax = subtotal * (pct / 100);
                              updateMutation.mutate({ tax: newTax, total: subtotal + newTax, subtotal });
                            }}
                            data-testid="input-tax-rate"
                          />
                          <span className="text-xs">%</span>
                        </span>
                        <span className="tabular-nums text-muted-foreground" data-testid="text-tax">
                          ${tax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t">
                        <span className="font-bold">Total</span>
                        <span className="font-bold text-lg tabular-nums text-[hsl(var(--titan-blue))]" data-testid="text-total">
                          ${(subtotal + tax).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Estimate-level notes — shows up on the exported PDF above the
              signature block. Different from per-line notes. Debounced so
              typing doesn't fire a PATCH per keystroke. */}
          <div className="pt-2">
            <Label className="text-xs">Estimate notes <span className="text-muted-foreground font-normal">(shown on PDF export)</span></Label>
            <Textarea
              className="text-sm mt-1 min-h-[70px]"
              value={draftFields.notes ?? estimate.notes ?? ""}
              onChange={e => saveField("notes", e.target.value)}
              placeholder="Payment terms, exclusions, assumptions, warranty language, etc."
              data-testid="input-estimate-notes"
            />
          </div>
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

        {/* ── IICRC QUICK ADD (built-in) + LEARNED library ── */}
        <TabsContent value="quickadd" className="mt-4 space-y-6">
          <QuickAddPanel onPick={(t) => addItem(t)} />
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

// ── Quick Add panel ──────────────────────────────────────────────────────────
// Two-tier picker: the built-in IICRC catalog (always shown) plus the shared
// org-wide learned library that grows every time a tech saves a manual line
// item on any estimate. Filtered by a single search box.
type QuickAddLearned = {
  id: number;
  description: string;
  category: string;
  kind: string | null;
  unit: string;
  unitPrice: number;
  useCount: number;
  lastUsedAt: string | null;
};

function QuickAddPanel({ onPick }: { onPick: (t: Partial<LineItem>) => void }) {
  const [q, setQ] = useState("");
  const { data: learned = [], isLoading } = useQuery<QuickAddLearned[]>({
    queryKey: ["/api/quick-add"],
  });

  const norm = (s: string) => s.toLowerCase().trim();
  const query = norm(q);

  // Merge on normalized description so learned rows override built-in pricing
  // (org's real pricing wins over the seeded defaults).
  const learnedIndex = new Set(learned.map(l => norm(l.description)));
  const iicrcVisible = IICRC_QUICK_ADD.filter(i =>
    !learnedIndex.has(norm(i.description)) &&
    (!query || i.description.toLowerCase().includes(query) || i.category.toLowerCase().includes(query)),
  );
  const learnedVisible = learned.filter(l =>
    !query || l.description.toLowerCase().includes(query) || (l.category || "").toLowerCase().includes(query),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search Quick Add… (description or category)"
          className="max-w-md"
          data-testid="input-quickadd-search"
        />
        <p className="text-xs text-muted-foreground">
          {learnedVisible.length} learned · {iicrcVisible.length} built-in
        </p>
      </div>

      {/* Learned first — these are YOUR items, always more relevant. */}
      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-semibold">Your learned items</h3>
          <p className="text-xs text-muted-foreground">Grows automatically. New line items you build get added here for the whole team.</p>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : learnedVisible.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {query
              ? "No learned items match that search yet."
              : "Nothing here yet. When you manually add a line item with a description and price, it'll show up here so anyone on the team can one-tap it on the next estimate."}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {learnedVisible.map(item => (
              <button
                key={item.id}
                className="text-left p-3 rounded-lg border border-[hsl(var(--titan-blue)/0.3)] hover:border-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue)/0.05)] transition-colors"
                onClick={() => onPick({
                  description: item.description,
                  category: item.category || "general",
                  unit: item.unit || "EA",
                  unitPrice: item.unitPrice,
                  kind: (item.kind as any) || undefined,
                })}
                data-testid={`button-quickadd-learned-${item.id}`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-snug">{item.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      ${item.unitPrice.toFixed(2)} / {item.unit} · {item.category || "general"}
                    </p>
                  </div>
                  {item.useCount > 1 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                      used {item.useCount}×
                    </Badge>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Built-in seed catalog. Kept for jobs where the org hasn't estimated
          this kind of work yet. */}
      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-semibold">IICRC + Xactimate reference</h3>
          <p className="text-xs text-muted-foreground">Built-in starter catalog. Prices are ballpark — edit after adding.</p>
        </div>
        {iicrcVisible.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">All built-in items are already in your learned library.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {iicrcVisible.map((item, i) => (
              <button
                key={i}
                className="text-left p-3 rounded-lg border hover:border-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue)/0.05)] transition-colors"
                onClick={() => onPick(item)}
              >
                <p className="text-sm font-medium leading-snug">{item.description}</p>
                <p className="text-xs text-muted-foreground mt-0.5">${item.unitPrice} / {item.unit} · {item.category}</p>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
