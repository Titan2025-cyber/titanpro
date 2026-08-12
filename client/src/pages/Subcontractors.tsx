/**
 * Subcontractors.tsx — Subcontractor Compliance Vault
 * ----------------------------------------------------
 * Landing page (list + dashboard) lives here. Clicking a row opens a
 * detail drawer where you can view/upload documents, edit info, and
 * see auto-linked job history. Everything lives on one page so field
 * admins can add a sub, drop in the COI/WC/W-9 PDFs, and be done.
 */
import { useMemo, useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { fmtDate } from "@/lib/dates";
import {
  Users, Plus, Search, ShieldCheck, ShieldAlert, ShieldX, Upload,
  FileText, Trash2, Download, ExternalLink, Star, Phone, Mail,
  Building2, Calendar, AlertTriangle, CheckCircle, Filter, DollarSign,
} from "lucide-react";

// ── Trades + doc types (mirrors server) ─────────────────────────────────
const TRADES = [
  "General Contractor","Framing","Drywall","Painting","Flooring",
  "Roofing","Plumbing","Electrical","HVAC","Cabinetry","Countertops",
  "Tile","Cleaning","Demolition","Debris Hauling","Content Cleaning",
  "Mold Remediation","Asbestos","Lead","Other",
];

const DOC_TYPES = [
  { value: "coi",           label: "Certificate of Insurance (COI)", core: true },
  { value: "workers_comp",  label: "Workers Comp",                   core: true },
  { value: "w9",            label: "W-9",                            core: true },
  { value: "business_license", label: "Business License",            core: false },
  { value: "contractor_license", label: "Contractor License",        core: false },
  { value: "bond",          label: "Bond",                           core: false },
  { value: "msa",           label: "Subcontract / MSA",              core: false },
  { value: "other",         label: "Other Document",                 core: false },
];

// ── Helpers ─────────────────────────────────────────────────────────────
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

/**
 * Convert a File to a data URL. We keep the base64 pipe as the wire
 * format so we don't have to plumb multipart form-data through the
 * existing Express stack — image_pipeline handles either form.
 */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

const complianceBadge = (overall: string) => {
  if (overall === "compliant")     return { label: "Compliant",     class: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: <ShieldCheck className="w-3 h-3" /> };
  if (overall === "expiring_soon") return { label: "Expiring soon", class: "bg-amber-100 text-amber-800 border-amber-200",       icon: <ShieldAlert className="w-3 h-3" /> };
  if (overall === "expired")       return { label: "Expired",       class: "bg-red-100 text-red-800 border-red-200",             icon: <ShieldX className="w-3 h-3" /> };
  return                                    { label: "Incomplete",   class: "bg-slate-100 text-slate-700 border-slate-200",       icon: <AlertTriangle className="w-3 h-3" /> };
};

export default function Subcontractors() {
  const { toast } = useToast();
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all"|"compliant"|"needs_attention">("all");

  const { data: subs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/subcontractors"],
    queryFn: () => apiRequest("/api/subcontractors").then(r => r.json()),
  });

  const summary = useMemo(() => {
    const s = { total: subs.length, compliant: 0, expiring: 0, expired: 0, incomplete: 0, ytd_spend: 0 };
    for (const x of subs) {
      const o = x?.compliance?.overall;
      if (o === "compliant") s.compliant++;
      else if (o === "expiring_soon") s.expiring++;
      else if (o === "expired") s.expired++;
      else s.incomplete++;
      s.ytd_spend += Number(x.total_paid || 0);
    }
    return s;
  }, [subs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subs.filter(s => {
      if (q) {
        const hay = `${s.business_name} ${s.dba || ""} ${s.trade || ""} ${s.contact_name || ""} ${s.phone || ""} ${s.email || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filter === "compliant" && s.compliance?.overall !== "compliant") return false;
      if (filter === "needs_attention" && s.compliance?.overall === "compliant") return false;
      return true;
    });
  }, [subs, search, filter]);

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-[hsl(var(--titan-blue))]" />
            Subcontractors
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Compliance vault — COI, Workers Comp, W-9, and job history for every sub you use.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/subcontractors/reports/1099?year=${new Date().getFullYear()}`} target="_blank" rel="noreferrer">
              <FileText className="w-4 h-4 mr-1" /> 1099 prep
            </a>
          </Button>
          <Button size="sm" onClick={() => setShowNew(true)} data-testid="btn-new-sub">
            <Plus className="w-4 h-4 mr-1" /> Add subcontractor
          </Button>
        </div>
      </div>

      {/* ── Summary tiles ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryTile label="Total subs" value={String(summary.total)} icon={<Building2 className="w-4 h-4" />} />
        <SummaryTile label="Compliant"  value={String(summary.compliant)} icon={<ShieldCheck className="w-4 h-4" />} tone="green" />
        <SummaryTile label="Expiring"   value={String(summary.expiring)}  icon={<ShieldAlert className="w-4 h-4" />} tone="amber" />
        <SummaryTile label="Expired"    value={String(summary.expired)}   icon={<ShieldX className="w-4 h-4" />}     tone="red" />
        <SummaryTile label="YTD spend"  value={money(summary.ytd_spend)}  icon={<DollarSign className="w-4 h-4" />} />
      </div>

      {/* ── Search + filter ───────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, trade, contact…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
            data-testid="input-sub-search"
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          {(["all","compliant","needs_attention"] as const).map(k => (
            <Button key={k} size="sm" variant={filter===k?"default":"outline"} onClick={()=>setFilter(k)}>
              {k === "all" ? "All" : k === "compliant" ? "Compliant" : "Needs attention"}
            </Button>
          ))}
        </div>
      </div>

      {/* ── List ──────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">
              {subs.length === 0
                ? "No subcontractors yet. Click ‘Add subcontractor’ to get started."
                : "No subs match your search."}
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map(s => <SubRow key={s.id} sub={s} onOpen={() => setDetailId(s.id)} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── New sub dialog ────────────────────────────────────────── */}
      <NewSubDialog open={showNew} onClose={() => setShowNew(false)} />

      {/* ── Detail drawer ─────────────────────────────────────────── */}
      <SubDetailDrawer subId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Summary tile
function SummaryTile({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone?: "green"|"amber"|"red" }) {
  const toneClass =
    tone === "green" ? "text-emerald-600 dark:text-emerald-400" :
    tone === "amber" ? "text-amber-600 dark:text-amber-400" :
    tone === "red"   ? "text-red-600 dark:text-red-400" :
                       "text-foreground";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">{icon}<span>{label}</span></div>
        <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────
// List row
function SubRow({ sub, onOpen }: { sub: any; onOpen: () => void }) {
  const b = complianceBadge(sub.compliance?.overall || "incomplete");
  const docs = sub.compliance?.docs || {};
  return (
    <button
      onClick={onOpen}
      className="w-full text-left p-3 md:p-4 hover:bg-muted/40 transition flex items-center gap-3"
      data-testid={`row-sub-${sub.id}`}
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
        <Building2 className="w-5 h-5 text-slate-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold truncate">{sub.business_name}</span>
          {sub.dba && <span className="text-xs text-muted-foreground">dba {sub.dba}</span>}
          {sub.preferred ? <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> : null}
          <Badge className={`text-[10px] border ${b.class}`}>{b.icon}<span className="ml-1">{b.label}</span></Badge>
          {sub.status && sub.status !== "active" && (
            <Badge variant="outline" className="text-[10px] capitalize">{sub.status}</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
          {sub.trade && <span>{sub.trade}</span>}
          {sub.contact_name && <span>· {sub.contact_name}</span>}
          {sub.phone && <span className="flex items-center gap-0.5"><Phone className="w-3 h-3" /> {sub.phone}</span>}
          {sub.email && <span className="flex items-center gap-0.5"><Mail className="w-3 h-3" /> {sub.email}</span>}
        </div>
        <div className="flex items-center gap-2 mt-1.5 text-[11px]">
          <DocPill label="COI" state={docs.coi} />
          <DocPill label="WC"  state={docs.workers_comp} />
          <DocPill label="W-9" state={docs.w9} />
          {sub.job_count > 0 && (
            <span className="ml-auto text-muted-foreground">
              {sub.job_count} job{sub.job_count === 1 ? "" : "s"} · {money(sub.total_paid || 0)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function DocPill({ label, state }: { label: string; state?: any }) {
  if (state?.exempt) return <Badge variant="outline" className="text-[10px]">{label}: exempt</Badge>;
  if (!state?.present) return <Badge className="text-[10px] bg-red-100 text-red-700 border-red-200 border">{label}: missing</Badge>;
  const days = state.days_left;
  if (days == null) return <Badge className="text-[10px] bg-emerald-100 text-emerald-700 border-emerald-200 border">{label}: on file</Badge>;
  if (days < 0) return <Badge className="text-[10px] bg-red-100 text-red-700 border-red-200 border">{label}: expired</Badge>;
  if (days <= 30) return <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-200 border">{label}: {days}d left</Badge>;
  return <Badge className="text-[10px] bg-emerald-100 text-emerald-700 border-emerald-200 border">{label}: {days}d</Badge>;
}

// ────────────────────────────────────────────────────────────────────────
// New sub dialog
function NewSubDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState<any>({
    business_name: "", dba: "", trade: "", contact_name: "", phone: "", email: "",
    address: "", city: "", state: "", zip: "",
    tax_id: "", tax_id_type: "ein", is_1099_eligible: true,
    wc_exempt: false, wc_exempt_reason: "",
    notes: "",
  });
  const create = useMutation({
    mutationFn: (data: any) => apiRequest("/api/subcontractors", { method: "POST", body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
      toast({ title: "Subcontractor added" });
      onClose();
      setF({ business_name:"", dba:"", trade:"", contact_name:"", phone:"", email:"", address:"", city:"", state:"", zip:"", tax_id:"", tax_id_type:"ein", is_1099_eligible:true, wc_exempt:false, wc_exempt_reason:"", notes:"" });
    },
    onError: (e: any) => toast({ title: "Couldn't add sub", description: String(e?.message || e), variant: "destructive" }),
  });

  const canSave = !!f.business_name.trim();

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add subcontractor</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
          <Field label="Business name *"><Input value={f.business_name} onChange={e=>setF({...f, business_name:e.target.value})} data-testid="input-sub-name" /></Field>
          <Field label="DBA (optional)"><Input value={f.dba} onChange={e=>setF({...f, dba:e.target.value})} /></Field>
          <Field label="Trade">
            <Select value={f.trade || undefined} onValueChange={v => setF({ ...f, trade: v })}>
              <SelectTrigger><SelectValue placeholder="Select trade" /></SelectTrigger>
              <SelectContent>{TRADES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Contact name"><Input value={f.contact_name} onChange={e=>setF({...f, contact_name:e.target.value})} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={e=>setF({...f, phone:e.target.value})} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={e=>setF({...f, email:e.target.value})} /></Field>
          <Field label="Address" span2><Input value={f.address} onChange={e=>setF({...f, address:e.target.value})} /></Field>
          <Field label="City"><Input value={f.city} onChange={e=>setF({...f, city:e.target.value})} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="State"><Input maxLength={2} value={f.state} onChange={e=>setF({...f, state:e.target.value.toUpperCase()})} /></Field>
            <Field label="ZIP"><Input value={f.zip} onChange={e=>setF({...f, zip:e.target.value})} /></Field>
          </div>

          <Field label="Tax ID type">
            <Select value={f.tax_id_type} onValueChange={v => setF({ ...f, tax_id_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ein">EIN</SelectItem>
                <SelectItem value="ssn">SSN</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={`Tax ID (only last 4 stored)`}>
            <Input
              placeholder={f.tax_id_type === "ein" ? "XX-XXXXXXX" : "XXX-XX-XXXX"}
              value={f.tax_id}
              onChange={e => setF({ ...f, tax_id: e.target.value })}
            />
          </Field>

          <div className="md:col-span-2 flex items-center gap-3 flex-wrap py-1">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!f.is_1099_eligible} onCheckedChange={v => setF({ ...f, is_1099_eligible: v })} />
              1099 eligible
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={!!f.wc_exempt} onCheckedChange={v => setF({ ...f, wc_exempt: v })} />
              Workers Comp exempt
            </label>
          </div>
          {f.wc_exempt && (
            <Field label="WC exempt reason" span2>
              <Input placeholder="e.g. Sole proprietor with no employees (GA/SC exemption on file)" value={f.wc_exempt_reason} onChange={e=>setF({...f, wc_exempt_reason:e.target.value})} />
            </Field>
          )}
          <Field label="Notes" span2>
            <Textarea rows={2} value={f.notes} onChange={e=>setF({...f, notes:e.target.value})} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!canSave || create.isPending} onClick={() => create.mutate(f)} data-testid="btn-save-sub">
            {create.isPending ? "Saving…" : "Save subcontractor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, span2, children }: { label: string; span2?: boolean; children: React.ReactNode }) {
  return (
    <div className={span2 ? "md:col-span-2" : ""}>
      <Label className="text-xs mb-1 block">{label}</Label>
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Detail drawer
function SubDetailDrawer({ subId, onClose }: { subId: number | null; onClose: () => void }) {
  const { toast } = useToast();
  const { data: sub, isLoading } = useQuery<any>({
    queryKey: [`/api/subcontractors/${subId}`],
    queryFn: () => apiRequest(`/api/subcontractors/${subId}`).then(r => r.json()),
    enabled: subId != null,
  });

  const patch = useMutation({
    mutationFn: (data: any) => apiRequest(`/api/subcontractors/${subId}`, { method: "PATCH", body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
      queryClient.invalidateQueries({ queryKey: [`/api/subcontractors/${subId}`] });
      toast({ title: "Saved" });
    },
  });

  const del = useMutation({
    mutationFn: () => apiRequest(`/api/subcontractors/${subId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
      toast({ title: "Deleted" });
      onClose();
    },
  });

  return (
    <Sheet open={subId != null} onOpenChange={o => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {isLoading ? <Skeleton className="h-6 w-40" /> : sub?.business_name}
          </SheetTitle>
        </SheetHeader>

        {isLoading || !sub ? (
          <div className="space-y-3 mt-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <Tabs defaultValue="vault" className="mt-4">
            <TabsList className="grid grid-cols-3">
              <TabsTrigger value="vault">Compliance vault</TabsTrigger>
              <TabsTrigger value="info">Info</TabsTrigger>
              <TabsTrigger value="jobs">Job history</TabsTrigger>
            </TabsList>

            {/* ── Vault ─────────────────────────────────────────── */}
            <TabsContent value="vault" className="mt-4 space-y-3">
              <ComplianceHeader sub={sub} />
              <CoreDocsBlock sub={sub} />
              <ExtraDocsBlock sub={sub} />
            </TabsContent>

            {/* ── Info ──────────────────────────────────────────── */}
            <TabsContent value="info" className="mt-4">
              <InfoEditor sub={sub} onSave={data => patch.mutate(data)} onDelete={() => {
                if (confirm(`Delete ${sub.business_name}? This removes all documents too.`)) del.mutate();
              }} />
            </TabsContent>

            {/* ── Jobs ──────────────────────────────────────────── */}
            <TabsContent value="jobs" className="mt-4">
              <JobHistoryPanel sub={sub} />
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ────────────────────────────────────────────────────────────────────────
function ComplianceHeader({ sub }: { sub: any }) {
  const c = sub.compliance || {};
  const b = complianceBadge(c.overall || "incomplete");
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Badge className={`border ${b.class}`}>{b.icon}<span className="ml-1">{b.label}</span></Badge>
            {c.next_expiration && (
              <span className="text-xs text-muted-foreground">
                Next expiration: {fmtDate(c.next_expiration)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <DocPill label="COI" state={c.docs?.coi} />
            <DocPill label="WC"  state={c.docs?.workers_comp} />
            <DocPill label="W-9" state={c.docs?.w9} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Core docs — the 3 that drive compliance
function CoreDocsBlock({ sub }: { sub: any }) {
  const coreTypes = DOC_TYPES.filter(d => d.core);
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Core compliance documents</div>
      {coreTypes.map(t => {
        const docs = (sub.documents || []).filter((d: any) => d.doc_type === t.value);
        return <DocGroup key={t.value} sub={sub} type={t} docs={docs} />;
      })}
    </div>
  );
}

// Bonus docs — collapsed list
function ExtraDocsBlock({ sub }: { sub: any }) {
  const extraTypes = DOC_TYPES.filter(d => !d.core);
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState<string>("business_license");
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Additional documents</div>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Add
        </Button>
      </div>
      {showAdd && (
        <div className="flex items-center gap-2 mb-2">
          <Select value={newType} onValueChange={setNewType}>
            <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{extraTypes.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
          <UploadButton subId={sub.id} docType={newType} onDone={() => setShowAdd(false)} />
        </div>
      )}
      {extraTypes.map(t => {
        const docs = (sub.documents || []).filter((d: any) => d.doc_type === t.value);
        if (!docs.length) return null;
        return <DocGroup key={t.value} sub={sub} type={t} docs={docs} compact />;
      })}
    </div>
  );
}

// ── Doc group per type — shows existing docs + upload/replace UI ────────
function DocGroup({ sub, type, docs, compact }: { sub: any; type: any; docs: any[]; compact?: boolean }) {
  return (
    <Card>
      <CardContent className={`${compact ? "p-2" : "p-3"} space-y-2`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">{type.label}</span>
            {docs.length === 0 && type.core && (
              <Badge className="text-[10px] bg-red-100 text-red-700 border border-red-200">Missing</Badge>
            )}
          </div>
          <UploadButton subId={sub.id} docType={type.value} />
        </div>
        {docs.map(d => <DocRow key={d.id} subId={sub.id} doc={d} type={type} />)}
      </CardContent>
    </Card>
  );
}

// One document row — expiration, insurance policy metadata, download, delete
function DocRow({ subId, doc, type }: { subId: number; doc: any; type: any }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [meta, setMeta] = useState({
    carrier: doc.carrier || "",
    policy_number: doc.policy_number || "",
    effective_date: doc.effective_date || "",
    expiration_date: doc.expiration_date || "",
    gl_each_occurrence: doc.gl_each_occurrence || "",
    gl_aggregate: doc.gl_aggregate || "",
    auto_limit: doc.auto_limit || "",
    umbrella_limit: doc.umbrella_limit || "",
    additional_insured: !!doc.additional_insured,
    waiver_of_subrogation: !!doc.waiver_of_subrogation,
    notes: doc.notes || "",
  });

  const patch = useMutation({
    mutationFn: (data: any) => apiRequest(`/api/subcontractors/${subId}/documents/${doc.id}`, { method: "PATCH", body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
      queryClient.invalidateQueries({ queryKey: [`/api/subcontractors/${subId}`] });
      toast({ title: "Updated" });
      setExpanded(false);
    },
  });
  const del = useMutation({
    mutationFn: () => apiRequest(`/api/subcontractors/${subId}/documents/${doc.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
      queryClient.invalidateQueries({ queryKey: [`/api/subcontractors/${subId}`] });
      toast({ title: "Document removed" });
    },
  });

  const showsInsurance = type.value === "coi" || type.value === "workers_comp";
  const exp = doc.expiration_date ? new Date(doc.expiration_date).getTime() : null;
  const daysLeft = exp != null ? Math.floor((exp - Date.now()) / 86_400_000) : null;
  const expTone = daysLeft == null ? "text-muted-foreground"
    : daysLeft < 0 ? "text-red-600"
    : daysLeft <= 30 ? "text-amber-600" : "text-emerald-600";

  return (
    <div className="border rounded-md p-2 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <FileText className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="font-medium">{doc.file_name || doc.title || type.label}</span>
        {doc.expiration_date && (
          <span className={`text-xs ${expTone}`}>
            <Calendar className="w-3 h-3 inline mr-0.5" />
            Expires {fmtDate(doc.expiration_date)}
            {daysLeft != null && (daysLeft < 0 ? " · expired" : daysLeft <= 60 ? ` · ${daysLeft}d` : "")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {doc.file_url && (
            <Button asChild variant="ghost" size="sm">
              <a href={doc.file_url} target="_blank" rel="noreferrer" title="Open"><ExternalLink className="w-3.5 h-3.5" /></a>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Hide" : "Details"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { if (confirm("Delete this document?")) del.mutate(); }}>
            <Trash2 className="w-3.5 h-3.5 text-red-500" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t grid grid-cols-2 gap-2">
          {showsInsurance && (
            <>
              <Field label="Carrier"><Input value={meta.carrier} onChange={e=>setMeta({...meta, carrier:e.target.value})} /></Field>
              <Field label="Policy #"><Input value={meta.policy_number} onChange={e=>setMeta({...meta, policy_number:e.target.value})} /></Field>
              <Field label="Effective"><Input type="date" value={String(meta.effective_date).slice(0,10)} onChange={e=>setMeta({...meta, effective_date:e.target.value})} /></Field>
              <Field label="Expiration"><Input type="date" value={String(meta.expiration_date).slice(0,10)} onChange={e=>setMeta({...meta, expiration_date:e.target.value})} /></Field>
              {type.value === "coi" && (
                <>
                  <Field label="GL each occurrence"><Input type="number" value={meta.gl_each_occurrence as any} onChange={e=>setMeta({...meta, gl_each_occurrence:e.target.value as any})} /></Field>
                  <Field label="GL aggregate"><Input type="number" value={meta.gl_aggregate as any} onChange={e=>setMeta({...meta, gl_aggregate:e.target.value as any})} /></Field>
                  <Field label="Auto limit"><Input type="number" value={meta.auto_limit as any} onChange={e=>setMeta({...meta, auto_limit:e.target.value as any})} /></Field>
                  <Field label="Umbrella limit"><Input type="number" value={meta.umbrella_limit as any} onChange={e=>setMeta({...meta, umbrella_limit:e.target.value as any})} /></Field>
                  <div className="col-span-2 flex items-center gap-4">
                    <label className="flex items-center gap-2 text-xs">
                      <Switch checked={meta.additional_insured} onCheckedChange={v=>setMeta({...meta, additional_insured:v})} />
                      Titan named as Additional Insured
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <Switch checked={meta.waiver_of_subrogation} onCheckedChange={v=>setMeta({...meta, waiver_of_subrogation:v})} />
                      Waiver of Subrogation
                    </label>
                  </div>
                </>
              )}
            </>
          )}
          <Field label="Notes" span2><Textarea rows={2} value={meta.notes} onChange={e=>setMeta({...meta, notes:e.target.value})} /></Field>
          <div className="col-span-2 flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setExpanded(false)}>Cancel</Button>
            <Button size="sm" onClick={() => patch.mutate(meta)} disabled={patch.isPending}>
              {patch.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Upload button ───────────────────────────────────────────────────────
function UploadButton({ subId, docType, onDone }: { subId: number; docType: string; onDone?: () => void }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const r = await apiRequest(`/api/subcontractors/${subId}/documents`, {
        method: "POST",
        body: JSON.stringify({
          doc_type: docType,
          file_data: dataUrl,
          file_name: file.name,
          file_mime_type: file.type,
          file_size: file.size,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      queryClient.invalidateQueries({ queryKey: ["/api/subcontractors"] });
      queryClient.invalidateQueries({ queryKey: [`/api/subcontractors/${subId}`] });
      toast({ title: `Uploaded ${file.name}` });
      onDone?.();
    } catch (e: any) {
      toast({ title: "Upload failed", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={e => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
        <Upload className="w-3.5 h-3.5 mr-1" /> {busy ? "Uploading…" : "Upload"}
      </Button>
    </>
  );
}

// ── Info editor ─────────────────────────────────────────────────────────
function InfoEditor({ sub, onSave, onDelete }: { sub: any; onSave: (patch: any) => void; onDelete: () => void }) {
  const [f, setF] = useState<any>({
    business_name: sub.business_name || "",
    dba: sub.dba || "",
    trade: sub.trade || "",
    contact_name: sub.contact_name || "",
    phone: sub.phone || "",
    email: sub.email || "",
    address: sub.address || "",
    city: sub.city || "",
    state: sub.state || "",
    zip: sub.zip || "",
    tax_id_type: sub.tax_id_type || "ein",
    tax_id: "",
    is_1099_eligible: !!sub.is_1099_eligible,
    wc_exempt: !!sub.wc_exempt,
    wc_exempt_reason: sub.wc_exempt_reason || "",
    rating: sub.rating || "",
    preferred: !!sub.preferred,
    status: sub.status || "active",
    notes: sub.notes || "",
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Business name"><Input value={f.business_name} onChange={e=>setF({...f, business_name:e.target.value})} /></Field>
        <Field label="DBA"><Input value={f.dba} onChange={e=>setF({...f, dba:e.target.value})} /></Field>
        <Field label="Trade">
          <Select value={f.trade || undefined} onValueChange={v => setF({ ...f, trade: v })}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>{TRADES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={f.status} onValueChange={v => setF({ ...f, status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Contact name"><Input value={f.contact_name} onChange={e=>setF({...f, contact_name:e.target.value})} /></Field>
        <Field label="Phone"><Input value={f.phone} onChange={e=>setF({...f, phone:e.target.value})} /></Field>
        <Field label="Email" span2><Input type="email" value={f.email} onChange={e=>setF({...f, email:e.target.value})} /></Field>
        <Field label="Address" span2><Input value={f.address} onChange={e=>setF({...f, address:e.target.value})} /></Field>
        <Field label="City"><Input value={f.city} onChange={e=>setF({...f, city:e.target.value})} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="State"><Input maxLength={2} value={f.state} onChange={e=>setF({...f, state:e.target.value.toUpperCase()})} /></Field>
          <Field label="ZIP"><Input value={f.zip} onChange={e=>setF({...f, zip:e.target.value})} /></Field>
        </div>

        <Field label="Tax ID type">
          <Select value={f.tax_id_type} onValueChange={v => setF({ ...f, tax_id_type: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ein">EIN</SelectItem>
              <SelectItem value="ssn">SSN</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={`Tax ID (on file: ${sub.tax_id_last4 ? "•••-" + sub.tax_id_last4 : "not set"})`}>
          <Input placeholder="Enter to update" value={f.tax_id} onChange={e=>setF({...f, tax_id:e.target.value})} />
        </Field>

        <div className="col-span-2 flex flex-wrap gap-4 py-1">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={!!f.is_1099_eligible} onCheckedChange={v => setF({ ...f, is_1099_eligible: v })} />
            1099 eligible
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={!!f.wc_exempt} onCheckedChange={v => setF({ ...f, wc_exempt: v })} />
            WC exempt
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={!!f.preferred} onCheckedChange={v => setF({ ...f, preferred: v })} />
            Preferred
          </label>
        </div>
        {f.wc_exempt && (
          <Field label="WC exempt reason" span2>
            <Input value={f.wc_exempt_reason} onChange={e=>setF({...f, wc_exempt_reason:e.target.value})} />
          </Field>
        )}
        <Field label="Rating (1–5)">
          <Input type="number" min={1} max={5} value={f.rating} onChange={e=>setF({...f, rating:e.target.value})} />
        </Field>
        <Field label="Notes" span2>
          <Textarea rows={3} value={f.notes} onChange={e=>setF({...f, notes:e.target.value})} />
        </Field>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete sub
        </Button>
        <Button onClick={() => {
          const payload: any = { ...f };
          if (payload.rating === "") delete payload.rating;
          // Only send tax_id if the user actually typed a new one
          if (!f.tax_id) delete payload.tax_id;
          onSave(payload);
        }}>Save changes</Button>
      </div>
    </div>
  );
}

// ── Job history panel ───────────────────────────────────────────────────
function JobHistoryPanel({ sub }: { sub: any }) {
  const hist = sub.job_history || {};
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <StatBox label="Total paid" value={money(hist.total_paid || 0)} />
        <StatBox label="YTD paid"   value={money(hist.ytd_paid || 0)} />
        <StatBox label="Jobs"       value={String(hist.job_count || 0)} />
      </div>
      {hist.last_job_date && (
        <div className="text-xs text-muted-foreground">Last job: {fmtDate(hist.last_job_date)}</div>
      )}
      <Card>
        <CardContent className="p-0">
          {(hist.recent || []).length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No linked jobs yet. Job costs where the vendor name matches
              this sub will automatically appear here.
            </div>
          ) : (
            <div className="divide-y">
              {hist.recent.map((r: any, i: number) => (
                <a key={i} href={`/jobs/${r.job_id}`} className="flex items-center justify-between p-2 hover:bg-muted/40 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">Job #{r.job_id}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.description}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{money(r.total || 0)}</div>
                    <div className="text-[11px] text-muted-foreground">{fmtDate(r.cost_date)}</div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-md p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}
