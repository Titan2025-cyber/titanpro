/**
 * WarrantyCallPanel.tsx — Log and view free fix-it calls on a job
 * Shown inside JobDetail on every job that has a referral partner.
 * Also shown on all jobs so any warranty visit can be tracked.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  Wrench, Plus, Trash2, Edit2, Clock, DollarSign,
  User, Calendar, CheckCircle, AlertCircle, ChevronDown, ChevronUp
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { todayLocalISO } from "@/lib/dates";

interface WarrantyCall {
  id: number;
  jobId: number;
  partnerId?: number;
  partnerName?: string;
  issueDescription: string;
  resolution?: string;
  techAssigned?: string;
  visitDate: string;
  laborHours: number;
  laborRate: number;
  materialCost: number;
  totalCost: number;
  chargedToPartner: number;
  internalNote?: string;
  partnerNote?: string;
  notifyPartner: number;
  createdAt: string;
}

interface Contact {
  id: number;
  name: string;
  type: string;
}

const LABOR_RATE_DEFAULT = 65;

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}

interface FormState {
  issueDescription: string;
  resolution: string;
  techAssigned: string;
  visitDate: string;
  laborHours: string;
  laborRate: string;
  materialCost: string;
  internalNote: string;
  partnerNote: string;
  notifyPartner: boolean;
  partnerId: string;
  partnerName: string;
}

const EMPTY_FORM: FormState = {
  issueDescription: "",
  resolution: "",
  techAssigned: "",
  visitDate: todayLocalISO(),
  laborHours: "1",
  laborRate: String(LABOR_RATE_DEFAULT),
  materialCost: "0",
  internalNote: "",
  partnerNote: "",
  notifyPartner: true,
  partnerId: "",
  partnerName: "",
};

export function WarrantyCallPanel({ jobId, referralPartnerId, referralPartnerName }: {
  jobId: number;
  referralPartnerId?: number;
  referralPartnerName?: string;
}) {
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>({
    ...EMPTY_FORM,
    partnerId: referralPartnerId ? String(referralPartnerId) : "",
    partnerName: referralPartnerName || "",
  });

  const { data: calls = [], isLoading } = useQuery<WarrantyCall[]>({
    queryKey: ["/api/warranty-calls", jobId],
    queryFn: () => apiRequest("GET", `/api/warranty-calls?jobId=${jobId}`).then(r => r.json()),
    staleTime: 0,
  });

  const set = (k: keyof FormState, v: any) => setForm(f => ({ ...f, [k]: v }));

  const computedCost = (Number(form.laborHours) || 0) * (Number(form.laborRate) || 65) + (Number(form.materialCost) || 0);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        jobId,
        partnerId: form.partnerId ? Number(form.partnerId) : null,
        partnerName: form.partnerName || null,
        issueDescription: form.issueDescription,
        resolution: form.resolution || null,
        techAssigned: form.techAssigned || null,
        visitDate: form.visitDate,
        laborHours: Number(form.laborHours) || 0,
        laborRate: Number(form.laborRate) || LABOR_RATE_DEFAULT,
        materialCost: Number(form.materialCost) || 0,
        internalNote: form.internalNote || null,
        partnerNote: form.partnerNote || null,
        notifyPartner: form.notifyPartner ? 1 : 0,
        chargedToPartner: 0,
      };
      if (editId) {
        return apiRequest("PATCH", `/api/warranty-calls/${editId}`, payload).then(r => r.json());
      }
      return apiRequest("POST", "/api/warranty-calls", payload).then(r => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/warranty-calls", jobId] });
      toast({ title: editId ? "Warranty call updated" : "Warranty call logged", description: `Cost absorbed: ${fmt(computedCost)} (complimentary to partner)` });
      setFormOpen(false);
      setEditId(null);
      setForm({ ...EMPTY_FORM, partnerId: referralPartnerId ? String(referralPartnerId) : "", partnerName: referralPartnerName || "" });
    },
    onError: (err: any) => toast({ title: "Failed to save", description: err?.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/warranty-calls/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/warranty-calls", jobId] });
      toast({ title: "Warranty call removed" });
    },
  });

  function openEdit(wc: WarrantyCall) {
    setEditId(wc.id);
    setForm({
      issueDescription: wc.issueDescription,
      resolution: wc.resolution || "",
      techAssigned: wc.techAssigned || "",
      visitDate: wc.visitDate,
      laborHours: String(wc.laborHours),
      laborRate: String(wc.laborRate),
      materialCost: String(wc.materialCost),
      internalNote: wc.internalNote || "",
      partnerNote: wc.partnerNote || "",
      notifyPartner: Boolean(wc.notifyPartner),
      partnerId: wc.partnerId ? String(wc.partnerId) : "",
      partnerName: wc.partnerName || "",
    });
    setFormOpen(true);
  }

  const totalCostAbsorbed = calls.reduce((s, c) => s + (c.totalCost || 0), 0);
  const totalLaborHours = calls.reduce((s, c) => s + (c.laborHours || 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      {calls.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800">
            <CardContent className="pt-3 pb-2 px-4">
              <p className="text-xl font-bold text-orange-700 dark:text-orange-400">{calls.length}</p>
              <p className="text-xs text-orange-600 dark:text-orange-500">Warranty Calls</p>
            </CardContent>
          </Card>
          <Card className="border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
            <CardContent className="pt-3 pb-2 px-4">
              <p className="text-xl font-bold text-red-700 dark:text-red-400">{fmt(totalCostAbsorbed)}</p>
              <p className="text-xs text-red-600 dark:text-red-500">Cost Absorbed</p>
            </CardContent>
          </Card>
          <Card className="border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800">
            <CardContent className="pt-3 pb-2 px-4">
              <p className="text-xl font-bold text-green-700 dark:text-green-400">{totalLaborHours.toFixed(1)}h</p>
              <p className="text-xs text-green-600 dark:text-green-500">Labor Hours</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Header + Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Wrench className="w-4 h-4 text-orange-500" />
            Warranty / Free Fix-It Calls
          </h3>
          {referralPartnerName && (
            <p className="text-xs text-muted-foreground mt-0.5">Partner: {referralPartnerName} — all calls complimentary</p>
          )}
        </div>
        <Button size="sm" variant="outline"
          className="border-orange-400 text-orange-700 hover:bg-orange-50"
          onClick={() => { setEditId(null); setForm({ ...EMPTY_FORM, partnerId: referralPartnerId ? String(referralPartnerId) : "", partnerName: referralPartnerName || "" }); setFormOpen(true); }}>
          <Plus className="w-3.5 h-3.5 mr-1" />Log Call
        </Button>
      </div>

      {/* Form */}
      {formOpen && (
        <Card className="border-orange-200 dark:border-orange-800">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm">{editId ? "Edit Warranty Call" : "Log New Warranty Call"}</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {/* Partner row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Partner Name</Label>
                <Input className="mt-1 h-8 text-xs" placeholder="Referral partner name"
                  value={form.partnerName} onChange={e => set("partnerName", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Visit Date *</Label>
                <Input type="date" className="mt-1 h-8 text-xs" value={form.visitDate}
                  onChange={e => set("visitDate", e.target.value)} />
              </div>
            </div>

            {/* Issue */}
            <div>
              <Label className="text-xs">Issue Description *</Label>
              <Textarea className="mt-1 text-sm resize-none" rows={2}
                placeholder="What was wrong? (e.g. Missed moisture pocket behind drywall, customer reported soft spot)"
                value={form.issueDescription} onChange={e => set("issueDescription", e.target.value)} />
            </div>

            {/* Resolution */}
            <div>
              <Label className="text-xs">Resolution / Work Performed</Label>
              <Textarea className="mt-1 text-sm resize-none" rows={2}
                placeholder="What was done to fix it?"
                value={form.resolution} onChange={e => set("resolution", e.target.value)} />
            </div>

            {/* Tech + Cost row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Tech Assigned</Label>
                <Input className="mt-1 h-8 text-xs" placeholder="Tech name"
                  value={form.techAssigned} onChange={e => set("techAssigned", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Labor Hours</Label>
                <Input type="number" className="mt-1 h-8 text-xs" min="0" step="0.5"
                  value={form.laborHours} onChange={e => set("laborHours", e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Labor Rate ($/hr)</Label>
                <Input type="number" className="mt-1 h-8 text-xs" min="0"
                  value={form.laborRate} onChange={e => set("laborRate", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Material Cost ($)</Label>
                <Input type="number" className="mt-1 h-8 text-xs" min="0" step="0.01"
                  value={form.materialCost} onChange={e => set("materialCost", e.target.value)} />
              </div>
            </div>

            {/* Cost preview */}
            <div className="flex items-center gap-3 p-2.5 bg-orange-50 dark:bg-orange-950/20 rounded-lg border border-orange-200 dark:border-orange-800">
              <DollarSign className="w-4 h-4 text-orange-600 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-orange-800 dark:text-orange-300">Total Cost Absorbed: {fmt(computedCost)}</p>
                <p className="text-[10px] text-orange-600 dark:text-orange-500">
                  {form.laborHours}h × ${form.laborRate}/hr + ${form.materialCost} materials — charged to partner: $0.00
                </p>
              </div>
              <Badge className="bg-green-100 text-green-700 text-xs border-green-300">Complimentary</Badge>
            </div>

            {/* Notes */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Internal Note (admin only)</Label>
                <Textarea className="mt-1 text-xs resize-none" rows={2}
                  placeholder="Root cause, liability notes, etc."
                  value={form.internalNote} onChange={e => set("internalNote", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Partner Note (visible to partner)</Label>
                <Textarea className="mt-1 text-xs resize-none" rows={2}
                  placeholder="Message to show the partner about this fix"
                  value={form.partnerNote} onChange={e => set("partnerNote", e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 border-t">
              <div>
                <p className="text-xs font-medium">Log to partner's activity</p>
                <p className="text-xs text-muted-foreground">Partner will see this call in their portal</p>
              </div>
              <Switch checked={form.notifyPartner} onCheckedChange={v => set("notifyPartner", v)} />
            </div>

            <div className="flex gap-2 pt-1">
              <Button size="sm" className="flex-1 bg-orange-600 hover:bg-orange-700 text-white"
                onClick={() => save.mutate()} disabled={save.isPending || !form.issueDescription || !form.visitDate}>
                {save.isPending ? "Saving…" : editId ? "Update Call" : "Log Warranty Call"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setFormOpen(false); setEditId(null); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Call list */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-4">Loading…</p>
      ) : calls.length === 0 && !formOpen ? (
        <div className="text-center py-8 border-2 border-dashed border-orange-200 dark:border-orange-800 rounded-xl">
          <Wrench className="w-8 h-8 mx-auto mb-2 text-orange-300" />
          <p className="text-sm font-medium text-muted-foreground">No warranty calls logged</p>
          <p className="text-xs text-muted-foreground">All fix-it visits are tracked here. Partners see value provided.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {calls.map(wc => (
            <Card key={wc.id} className="border border-border">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="bg-orange-100 text-orange-800 border-orange-300 text-[10px]">
                        <Wrench className="w-3 h-3 mr-1" />Warranty Call
                      </Badge>
                      <Badge className="bg-green-100 text-green-700 border-green-300 text-[10px]">Complimentary</Badge>
                      {wc.partnerName && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <User className="w-3 h-3" />{wc.partnerName}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="w-3 h-3" />{wc.visitDate}
                      </span>
                    </div>
                    <p className="text-sm font-medium mt-1.5 leading-snug">{wc.issueDescription}</p>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                      {wc.techAssigned && <span className="flex items-center gap-1"><User className="w-3 h-3" />{wc.techAssigned}</span>}
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{wc.laborHours}h labor</span>
                      <span className="flex items-center gap-1 font-semibold text-red-600 dark:text-red-400">
                        <DollarSign className="w-3 h-3" />{fmt(wc.totalCost)} absorbed
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => setExpanded(expanded === wc.id ? null : wc.id)}>
                      {expanded === wc.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(wc)}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => { if (confirm("Remove this warranty call?")) remove.mutate(wc.id); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {expanded === wc.id && (
                  <div className="mt-3 pt-3 border-t space-y-2 text-xs">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-muted rounded p-2">
                        <p className="text-muted-foreground">Labor</p>
                        <p className="font-semibold">{wc.laborHours}h × ${wc.laborRate}/hr = {fmt(wc.laborHours * wc.laborRate)}</p>
                      </div>
                      <div className="bg-muted rounded p-2">
                        <p className="text-muted-foreground">Materials</p>
                        <p className="font-semibold">{fmt(wc.materialCost)}</p>
                      </div>
                      <div className="bg-orange-50 dark:bg-orange-950/20 rounded p-2 border border-orange-200">
                        <p className="text-muted-foreground">Total Absorbed</p>
                        <p className="font-bold text-orange-700 dark:text-orange-400">{fmt(wc.totalCost)}</p>
                      </div>
                    </div>
                    {wc.resolution && (
                      <div>
                        <p className="text-muted-foreground font-medium">Resolution</p>
                        <p className="text-foreground mt-0.5">{wc.resolution}</p>
                      </div>
                    )}
                    {wc.partnerNote && (
                      <div className="bg-blue-50 dark:bg-blue-950/20 rounded p-2 border border-blue-200">
                        <p className="text-blue-700 dark:text-blue-400 font-medium flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />Partner Note
                        </p>
                        <p className="text-foreground mt-0.5">{wc.partnerNote}</p>
                      </div>
                    )}
                    {wc.internalNote && (
                      <div className="bg-yellow-50 dark:bg-yellow-950/20 rounded p-2 border border-yellow-200">
                        <p className="text-yellow-700 dark:text-yellow-400 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />Internal Note (admin only)
                        </p>
                        <p className="text-foreground mt-0.5">{wc.internalNote}</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
