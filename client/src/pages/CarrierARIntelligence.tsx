import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { AlertTriangle, CheckCircle, Clock, DollarSign, TrendingUp, TrendingDown, Plus, RefreshCw, Trash2, Pencil } from "lucide-react";

const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtK = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : fmt(n);

const AR_EVENT_TYPES = [
  { value: "invoice_sent", label: "Invoice Sent" },
  { value: "follow_up_30", label: "30-Day Follow Up" },
  { value: "follow_up_60", label: "60-Day Follow Up" },
  { value: "follow_up_90", label: "90-Day Follow Up" },
  { value: "paid", label: "Payment Received" },
  { value: "disputed", label: "Disputed" },
  { value: "denied", label: "Denied" },
];

function EditCarrierArDialog({ event, onDone }: { event: any; onDone: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    jobId: String(event.job_id ?? event.jobId ?? ""),
    carrier: event.carrier ?? "",
    eventType: event.event_type ?? event.eventType ?? "invoice_sent",
    amount: event.amount != null ? String(event.amount) : "",
    daysOutstanding: event.days_outstanding != null ? String(event.days_outstanding) : (event.daysOutstanding != null ? String(event.daysOutstanding) : ""),
    notes: event.notes ?? "",
  });

  const m = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/carrier-ar/${event.id}`, data),
    onSuccess: () => { toast({ title: "Saved" }); onDone(); setOpen(false); },
    onError: (e: any) => toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-edit-carrier-ar-${event.id}`}>
          <Pencil className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Carrier AR Event</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Job ID" value={form.jobId} onChange={e => setForm(f => ({ ...f, jobId: e.target.value }))} data-testid={`input-job-id-${event.id}`} />
          <Input placeholder="Carrier name" value={form.carrier} onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))} data-testid={`input-carrier-${event.id}`} />
          <Select value={form.eventType} onValueChange={v => setForm(f => ({ ...f, eventType: v }))}>
            <SelectTrigger data-testid={`select-event-type-${event.id}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {AR_EVENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Amount" type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} data-testid={`input-amount-${event.id}`} />
          <Input placeholder="Days outstanding" type="number" value={form.daysOutstanding} onChange={e => setForm(f => ({ ...f, daysOutstanding: e.target.value }))} data-testid={`input-days-${event.id}`} />
          <Input placeholder="Notes (optional)" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} data-testid={`input-notes-${event.id}`} />
          <Button
            className="w-full bg-[hsl(var(--titan-blue))] text-white"
            onClick={() => m.mutate({
              jobId: Number(form.jobId),
              carrier: form.carrier,
              eventType: form.eventType,
              amount: Number(form.amount) || undefined,
              daysOutstanding: Number(form.daysOutstanding) || undefined,
              notes: form.notes || undefined,
            })}
            disabled={!form.jobId || !form.carrier || m.isPending}
            data-testid={`button-save-carrier-ar-${event.id}`}
          >
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteCarrierArBtn({ id, label, onDone }: { id: number; label: string; onDone: () => void }) {
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/carrier-ar/${id}`),
    onSuccess: () => { toast({ title: "Deleted" }); onDone(); },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" data-testid={`button-delete-carrier-ar-${id}`}>
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this record?</AlertDialogTitle>
          <AlertDialogDescription>
            {label ? `"${label}" ` : ""}This permanently removes the record and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => m.mutate()} data-testid={`button-confirm-delete-carrier-ar-${id}`}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function CarrierARIntelligence() {
  const qc = useQueryClient();
  const [showLog, setShowLog] = useState(false);
  const [logForm, setLogForm] = useState({ jobId: "", carrier: "", eventType: "invoice_sent", amount: "", daysOutstanding: "", notes: "" });

  const { data: aging = [], isLoading: agingLoading } = useQuery<any[]>({ queryKey: ["/api/reports/carrier-ar-aging"], queryFn: () => apiRequest("/api/reports/carrier-ar-aging").then(r => r.json()) });
  const { data: scorecard = [], isLoading: scoreLoading } = useQuery<any[]>({ queryKey: ["/api/reports/carrier-scorecard-detail"], queryFn: () => apiRequest("/api/reports/carrier-scorecard-detail").then(r => r.json()) });
  const { data: events = [] } = useQuery<any[]>({ queryKey: ["/api/carrier-ar"], queryFn: () => apiRequest("/api/carrier-ar").then(r => r.json()) });

  const logEvent = useMutation({
    mutationFn: (data: any) => apiRequest("/api/carrier-ar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/carrier-ar"] }); qc.invalidateQueries({ queryKey: ["/api/reports/carrier-ar-aging"] }); setShowLog(false); },
  });

  const totalAR = aging.reduce((s: number, c: any) => s + (c.total || 0), 0);
  const overdue90 = aging.reduce((s: number, c: any) => s + (c.bucket90 || 0), 0);
  const slowestCarrier = scorecard.length > 0 ? scorecard.filter(c => c.avgDaysToPay != null).sort((a: any, b: any) => (b.avgDaysToPay || 0) - (a.avgDaysToPay || 0))[0] : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Carrier AR Intelligence</h1>
          <p className="text-sm text-muted-foreground">Payment speed, dispute rates, and AR aging by carrier</p>
        </div>
        <Dialog open={showLog} onOpenChange={setShowLog}>
          <DialogTrigger asChild>
            <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white" data-testid="button-log-event"><Plus className="w-4 h-4 mr-2" />Log AR Event</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Log Carrier AR Event</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Job ID" value={logForm.jobId} onChange={e => setLogForm(f => ({ ...f, jobId: e.target.value }))} data-testid="input-job-id" />
              <Input placeholder="Carrier name" value={logForm.carrier} onChange={e => setLogForm(f => ({ ...f, carrier: e.target.value }))} data-testid="input-carrier" />
              <Select value={logForm.eventType} onValueChange={v => setLogForm(f => ({ ...f, eventType: v }))}>
                <SelectTrigger data-testid="select-event-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="invoice_sent">Invoice Sent</SelectItem>
                  <SelectItem value="follow_up_30">30-Day Follow Up</SelectItem>
                  <SelectItem value="follow_up_60">60-Day Follow Up</SelectItem>
                  <SelectItem value="follow_up_90">90-Day Follow Up</SelectItem>
                  <SelectItem value="paid">Payment Received</SelectItem>
                  <SelectItem value="disputed">Disputed</SelectItem>
                  <SelectItem value="denied">Denied</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Amount" type="number" value={logForm.amount} onChange={e => setLogForm(f => ({ ...f, amount: e.target.value }))} data-testid="input-amount" />
              <Input placeholder="Days outstanding" type="number" value={logForm.daysOutstanding} onChange={e => setLogForm(f => ({ ...f, daysOutstanding: e.target.value }))} data-testid="input-days" />
              <Input placeholder="Notes (optional)" value={logForm.notes} onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))} data-testid="input-notes" />
              <Button className="w-full bg-[hsl(var(--titan-blue))] text-white" onClick={() => logEvent.mutate({ jobId: Number(logForm.jobId), carrier: logForm.carrier, eventType: logForm.eventType, amount: Number(logForm.amount) || undefined, daysOutstanding: Number(logForm.daysOutstanding) || undefined, notes: logForm.notes || undefined })} disabled={!logForm.jobId || !logForm.carrier} data-testid="button-save-event">Save Event</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-[hsl(var(--titan-blue))]">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Open A/R</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-total-ar">{fmtK(totalAR)}</p>
            <p className="text-xs text-muted-foreground">{aging.length} carriers</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">90+ Days Overdue</p>
            <p className="text-2xl font-bold mt-1 text-red-500" data-testid="text-overdue">{fmtK(overdue90)}</p>
            <p className="text-xs text-muted-foreground">Requires escalation</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Slowest Carrier</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-slowest">{slowestCarrier?.avgDaysToPay ? `${slowestCarrier.avgDaysToPay}d` : "N/A"}</p>
            <p className="text-xs text-muted-foreground truncate">{slowestCarrier?.carrier || "—"}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-[hsl(var(--titan-red))]">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">AR Events Logged</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-events">{events.length}</p>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>
      </div>

      {/* AR Aging Table */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4 text-[hsl(var(--titan-blue))]" />AR Aging by Carrier</CardTitle></CardHeader>
        <CardContent className="p-0">
          {agingLoading ? <p className="p-4 text-sm text-muted-foreground">Loading...</p> : aging.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No open invoices — all A/R collected</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2">Carrier</th>
                  <th className="text-right px-4 py-2">0–30d</th>
                  <th className="text-right px-4 py-2">31–60d</th>
                  <th className="text-right px-4 py-2">61–90d</th>
                  <th className="text-right px-4 py-2 text-red-500">90+ days</th>
                  <th className="text-right px-4 py-2">Total</th>
                  <th className="text-right px-4 py-2">Avg Days</th>
                </tr></thead>
                <tbody>
                  {aging.map((c: any, i: number) => (
                    <tr key={i} className="border-b hover:bg-muted/30 transition-colors" data-testid={`row-carrier-${i}`}>
                      <td className="px-4 py-3 font-medium">{c.carrier}</td>
                      <td className="px-4 py-3 text-right text-green-600">{fmtK(c.bucket0 || 0)}</td>
                      <td className="px-4 py-3 text-right text-yellow-600">{fmtK(c.bucket30 || 0)}</td>
                      <td className="px-4 py-3 text-right text-orange-600">{fmtK(c.bucket60 || 0)}</td>
                      <td className="px-4 py-3 text-right text-red-600 font-semibold">{fmtK(c.bucket90 || 0)}</td>
                      <td className="px-4 py-3 text-right font-semibold">{fmtK(c.total || 0)}</td>
                      <td className="px-4 py-3 text-right">
                        {c.avgDays != null ? <Badge variant={c.avgDays > 60 ? "destructive" : c.avgDays > 30 ? "outline" : "secondary"}>{c.avgDays}d</Badge> : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Carrier Scorecard */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[hsl(var(--titan-red))]" />Carrier Performance Scorecard</CardTitle></CardHeader>
        <CardContent className="p-0">
          {scoreLoading ? <p className="p-4 text-sm text-muted-foreground">Loading...</p> : scorecard.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No carrier data yet — add jobs with insurance carriers to build scorecard</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2">Carrier</th>
                  <th className="text-right px-4 py-2">Jobs</th>
                  <th className="text-right px-4 py-2">Invoiced</th>
                  <th className="text-right px-4 py-2">Collection %</th>
                  <th className="text-right px-4 py-2">Avg Days Pay</th>
                  <th className="text-right px-4 py-2">Dispute Rate</th>
                  <th className="text-right px-4 py-2">Supp Approval</th>
                </tr></thead>
                <tbody>
                  {scorecard.map((c: any, i: number) => (
                    <tr key={i} className="border-b hover:bg-muted/30 transition-colors" data-testid={`row-scorecard-${i}`}>
                      <td className="px-4 py-3 font-medium">{c.carrier}</td>
                      <td className="px-4 py-3 text-right">{c.jobCount}</td>
                      <td className="px-4 py-3 text-right">{fmtK(c.totalInvoiced || 0)}</td>
                      <td className="px-4 py-3 text-right">
                        <Badge variant={c.collectionRate >= 80 ? "secondary" : c.collectionRate >= 50 ? "outline" : "destructive"}>{c.collectionRate}%</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">{c.avgDaysToPay != null ? `${c.avgDaysToPay}d` : "—"}</td>
                      <td className="px-4 py-3 text-right">
                        {c.disputeRate > 0 ? <span className="text-red-500 font-medium">{c.disputeRate}%</span> : <span className="text-green-600">0%</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {c.supplementApprovalRate > 0 ? <span className="text-green-600">{c.supplementApprovalRate}%</span> : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Events */}
      {events.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Recent AR Events</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {events.slice(0, 10).map((e: any) => (
              <div key={e.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm" data-testid={`row-event-${e.id}`}>
                <div>
                  <span className="font-medium">{e.carrier}</span>
                  <span className="text-muted-foreground mx-2">·</span>
                  <Badge variant="outline" className="text-xs">{e.event_type.replace(/_/g, " ")}</Badge>
                  {e.notes && <span className="text-muted-foreground ml-2 text-xs">{e.notes}</span>}
                </div>
                <div className="flex items-center gap-1 text-right text-xs text-muted-foreground">
                  {e.amount ? <span className="font-medium text-foreground mr-2">{fmt(e.amount)}</span> : null}
                  {e.days_outstanding ? <span className="mr-2">{e.days_outstanding}d outstanding</span> : null}
                  <EditCarrierArDialog event={e} onDone={() => qc.invalidateQueries({ queryKey: ["/api/carrier-ar"] })} />
                  <DeleteCarrierArBtn id={e.id} label={e.carrier} onDone={() => qc.invalidateQueries({ queryKey: ["/api/carrier-ar"] })} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
