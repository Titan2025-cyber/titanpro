import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Plus, DollarSign, Eye, FileText, Pencil, Download, Trash2, BookOpen, RefreshCw, Link2, CheckCircle, Send, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { generateInvoicePDF, downloadPDF } from "@/lib/pdfEngine";
import { SendAndSavePanel } from "@/components/SendAndSavePanel";
import type { Invoice, Job, Contact } from "@shared/schema";
import { fmtDate, fmtDateShort } from "@/lib/dates";

type LineItemRow = { description: string; quantity: string; unitPrice: string };
const blankRow = (): LineItemRow => ({ description: "", quantity: "1", unitPrice: "" });
const DEFAULT_TAX_RATE = 0; // no sales tax on restoration labor by default

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600", sent: "bg-blue-100 text-blue-800",
  paid: "bg-green-100 text-green-800", overdue: "bg-red-100 text-red-800",
};

// Format a due date into a clean human-readable string (e.g. "Jun 27, 2026").
// Falls back gracefully for missing or unparseable values.
function fmtDate(value?: string | null): string {
  if (!value) return "No due date";
  const parsed = Date.parse(value);
  if (isNaN(parsed)) return value;
  return fmtDate(parsed, { month: "short", day: "numeric", year: "numeric" });
}

export default function Invoices() {
  // Pre-fill jobId and phase from ?jobId= and ?phase= query params so the
  // "New Invoice" button on the Job page can deep-link into this dialog
  // with the right job and phase already selected (matches Estimates.tsx).
  const initialParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const _prefillJobId = initialParams.get("jobId") || "";
  const _prefillPhase = initialParams.get("phase") || "mitigation";
  // Deep-link support: /invoices?edit=<id> auto-opens the edit dialog for
  // that invoice once the invoices list has loaded. Used by the Invoices
  // card on JobDetail so the tech can jump straight into editing without
  // scrolling through the full AR list to find the row.
  const _prefillEditId = initialParams.get("edit") || "";

  const [open, setOpen] = useState(!!_prefillJobId); // auto-open when deep-linked from a job
  const [payOpen, setPayOpen] = useState<number | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ status: "", adjustment: "", adjustmentReason: "", notes: "", dueDate: "", taxRate: "0" });
  const [editItems, setEditItems] = useState<LineItemRow[]>([]);
  const [form, setForm] = useState({
    jobId: _prefillJobId,
    contactId: "",
    invoiceNumber: `INV-${new Date().getFullYear()}-`,
    dueDate: "",
    taxRate: String(DEFAULT_TAX_RATE),
    phase: _prefillPhase,
  });
  const [items, setItems] = useState<LineItemRow[]>([blankRow()]);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("check");
  const [sendViaQb, setSendViaQb] = useState(true); // auto-send new invoices through QuickBooks

  // Derived totals for the New Invoice form
  const parsedItems = items.map(it => {
    const qty = Number(it.quantity) || 0;
    const price = Number(it.unitPrice) || 0;
    return { description: it.description.trim(), quantity: qty, unitPrice: price, total: Math.round(qty * price * 100) / 100 };
  });
  const formSubtotal = Math.round(parsedItems.reduce((s, it) => s + it.total, 0) * 100) / 100;
  const formTaxRate = Number(form.taxRate) || 0;
  const formTax = Math.round(formSubtotal * (formTaxRate / 100) * 100) / 100;
  const formTotal = Math.round((formSubtotal + formTax) * 100) / 100;
  const canCreate = !!form.jobId && parsedItems.some(it => it.description && it.total > 0);

  function resetForm() {
    setForm({ jobId: "", contactId: "", invoiceNumber: `INV-${new Date().getFullYear()}-`, dueDate: "", taxRate: String(DEFAULT_TAX_RATE), phase: "mitigation" });
    setItems([blankRow()]);
  }

  // handleDownloadPDF is now inlined inside SendAndSavePanel's buildPdf so that
  // download / save-to-file / email all pull from the same PDF payload. Kept a
  // slim shim so the outer invoice-list card can still expose a one-click
  // download without opening the view dialog.
  function handleDownloadPDF(inv: Invoice) {
    const job = jobs.find(j => j.id === inv.jobId);
    const contact = contacts.find(c => c.id === inv.contactId);
    let li: any[] = [];
    try { li = JSON.parse(inv.lineItems || "[]"); } catch { li = []; }
    const normalized = li.map((it: any) => {
      const qty = Number(it.quantity ?? it.qty ?? 1);
      const price = Number(it.unitPrice ?? it.price ?? it.rate ?? it.amount ?? 0);
      return {
        description: it.description ?? it.name ?? it.desc ?? "Item",
        quantity: qty,
        unitPrice: price,
        total: Number(it.total ?? qty * price),
      };
    });
    const uri = generateInvoicePDF({
      invoiceNumber: inv.invoiceNumber,
      status: inv.status,
      jobNumber: job?.jobNumber,
      dueDate: inv.dueDate || undefined,
      paidAt: inv.paidAt || undefined,
      createdAt: (inv as any).createdAt || undefined,
      billTo: {
        name: contact?.name,
        phone: contact?.phone || undefined,
        email: (contact as any)?.email || undefined,
        address: (contact as any)?.address || undefined,
      },
      lineItems: normalized,
      subtotal: inv.subtotal || 0,
      tax: inv.tax || 0,
      total: inv.total || 0,
      originalTotal: (inv as any).originalTotal != null ? Number((inv as any).originalTotal) : undefined,
      adjustment: Number((inv as any).adjustment) || 0,
      adjustmentReason: (inv as any).adjustmentReason || undefined,
      notes: inv.notes || undefined,
    });
    downloadPDF(uri, `${inv.invoiceNumber}.pdf`);
  }
  // Silence "unused" lint until we surface the shortcut button.
  void handleDownloadPDF;

  const { toast } = useToast();
  const { user } = useAuth();
  const { data: invoices = [], isLoading } = useQuery<Invoice[]>({ queryKey: ["/api/invoices"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  // Once jobs are loaded, if we were deep-linked with a jobId, auto-fill the
  // customer from the job’s contact so the user isn’t asked to pick it again.
  useEffect(() => {
    if (!_prefillJobId || !jobs.length || form.contactId) return;
    const job = jobs.find(j => j.id === Number(_prefillJobId));
    if (job?.contactId) setForm(f => ({ ...f, contactId: String(job.contactId) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, _prefillJobId]);
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });

  // Create invoice. When "send through QuickBooks" is on, the create-and-send
  // endpoint creates the invoice, syncs it to QuickBooks, and emails it to the
  // customer from QuickBooks — all in one step, with graceful fallbacks.
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = sendViaQb ? "/api/qb/create-and-send" : "/api/invoices";
      const body = sendViaQb ? { ...data, sendToCustomer: true } : data;
      return apiRequest("POST", url, body).then(r => r.json());
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/qb/invoice-status"] });
      setOpen(false); resetForm();
      if (!sendViaQb) {
        toast({ title: "Invoice created", description: "Saved as a draft in Titan." });
      } else if (res?.sent) {
        toast({ title: "Invoice created & sent", description: `Synced to QuickBooks and emailed to ${res.sentTo}.` });
      } else if (res?.synced) {
        toast({ title: "Invoice created & synced", description: res.warnings?.[0] || "Pushed to QuickBooks. Add a customer email to auto-send." });
      } else {
        toast({ title: "Invoice created", description: res?.warnings?.[0] || "Saved in Titan. Connect QuickBooks to sync and send.", variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Couldn't create invoice", description: "Please try again.", variant: "destructive" }),
  });

  const updateInvoice = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/invoices/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/invoices"] }); setEditId(null); },
    // Surface save failures instead of the previous silent no-op.
    onError: (e: any) => toast({
      title: "Couldn't update invoice",
      description: e?.message || "Please try again.",
      variant: "destructive",
    }),
  });

  // Owner/admin/general_manager can permanently delete an invoice (and any
  // linked payments). Sales/tech/office see no delete button.
  const canDeleteInvoice = !!user && (["owner", "admin", "general_manager"] as string[]).includes(user.role);
  const deleteInvoice = useMutation({
    mutationFn: (invId: number) => apiRequest("DELETE", `/api/invoices/${invId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({ title: "Invoice deleted" });
    },
    onError: (e: any) => toast({
      title: "Delete failed",
      description: e?.message || "Invoice could not be deleted.",
      variant: "destructive",
    }),
  });

  // Track whether we've already auto-opened the edit dialog for the
  // ?edit=<id> deep-link so we don't re-open it every time the invoices
  // query re-fetches. React StrictMode also double-invokes effects in dev.
  const [autoEditHandled, setAutoEditHandled] = useState(false);

  function openEdit(inv: Invoice) {
    // Derive the effective tax rate from stored subtotal/tax so edits preserve it.
    const sub = Number(inv.subtotal) || 0;
    const tx = Number(inv.tax) || 0;
    const rate = sub > 0 ? Math.round((tx / sub) * 10000) / 100 : 0;
    setEditForm({
      status: inv.status || "",
      adjustment: String((inv as any).adjustment || ""),
      adjustmentReason: (inv as any).adjustmentReason || "",
      notes: inv.notes || "",
      dueDate: inv.dueDate || "",
      taxRate: String(rate),
    });
    // Load existing line items into an editable set.
    let li: any[] = [];
    try { li = JSON.parse(inv.lineItems || "[]"); } catch { li = []; }
    const rows: LineItemRow[] = li.map((it: any) => ({
      description: String(it.description ?? it.name ?? it.desc ?? ""),
      quantity: String(it.quantity ?? it.qty ?? 1),
      unitPrice: String(it.unitPrice ?? it.price ?? it.rate ?? it.amount ?? 0),
    }));
    setEditItems(rows.length ? rows : [blankRow()]);
    setEditId(inv.id);
  }

  // ?edit=<id> deep-link → auto-open the invoice editor once data is ready.
  // Runs once per mount (autoEditHandled guard) so navigating away and back
  // to /invoices won't re-open the dialog unexpectedly, and query refetches
  // don't retrigger it either.
  useEffect(() => {
    if (autoEditHandled) return;
    if (!_prefillEditId || !invoices.length) return;
    const targetId = Number(_prefillEditId);
    if (!Number.isFinite(targetId)) { setAutoEditHandled(true); return; }
    const inv = invoices.find(i => i.id === targetId);
    if (inv) {
      openEdit(inv);
    } else {
      toast({
        title: "Invoice not found",
        description: `Could not find invoice #${targetId}.`,
        variant: "destructive",
      });
    }
    setAutoEditHandled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, _prefillEditId]);

  const recordPayment = useMutation({
    mutationFn: ({ invId, amount, method }: { invId: number; amount: number; method: string }) =>
      Promise.all([
        apiRequest("POST", "/api/payments", { invoiceId: invId, amount, method, type: "received", contactId: invoices.find(i => i.id === invId)?.contactId }),
        apiRequest("PATCH", `/api/invoices/${invId}`, { status: "paid", paidAt: new Date().toISOString() }),
      ]),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/invoices"] }); queryClient.invalidateQueries({ queryKey: ["/api/payments"] }); setPayOpen(null); },
  });

  // ── QuickBooks: sync invoice, share pay link, receive payment ──
  const { data: qbStatus = {} } = useQuery<Record<string, any>>({
    queryKey: ["/api/qb/invoice-status"],
    queryFn: () => apiRequest("GET", "/api/qb/invoice-status").then(r => r.json()),
  });

  const qbSync = useMutation({
    mutationFn: (invId: number) => apiRequest("POST", "/api/qb/sync-invoice", { invoiceId: invId }).then(r => r.json()),
    onSuccess: (data: any) => {
      if (data?.error) return toast({ title: "QuickBooks sync failed", description: data.error, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/qb/invoice-status"] });
      toast({ title: "Synced to QuickBooks", description: "Invoice pushed to QuickBooks as Accounts Receivable." });
    },
    onError: () => toast({ title: "QuickBooks not connected", description: "Connect QuickBooks in Settings \u2192 Integrations first.", variant: "destructive" }),
  });

  const qbReceive = useMutation({
    mutationFn: (invId: number) => apiRequest("POST", "/api/qb/receive-payment", { invoiceId: invId }).then(r => r.json()),
    onSuccess: (data: any) => {
      if (data?.error) return toast({ title: "Couldn't check QuickBooks", description: data.error, variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/qb/invoice-status"] });
      toast({ title: data.paid ? "Payment received" : "No payment yet", description: data.message });
    },
    onError: () => toast({ title: "Couldn't reach QuickBooks", variant: "destructive" }),
  });

  const copyPayLink = (link?: string) => {
    if (!link) return toast({ title: "No payment link", description: "Sync the invoice to QuickBooks first.", variant: "destructive" });
    navigator.clipboard?.writeText(link).then(
      () => toast({ title: "Payment link copied", description: "Share it with your customer to pay via QuickBooks." }),
      () => toast({ title: "Payment link", description: link }),
    );
  };

  const customers = contacts.filter(c => c.type === "customer");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Invoices</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white">
              <Plus className="w-4 h-4 mr-2" />New Invoice
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New Invoice</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Job</Label>
                <Select value={form.jobId} onValueChange={v => {
                  const job = jobs.find(j => j.id === Number(v));
                  setForm(f => ({ ...f, jobId: v, contactId: job?.contactId ? String(job.contactId) : f.contactId }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Select job" /></SelectTrigger>
                  <SelectContent>{jobs.map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Customer</Label>
                <Select value={form.contactId} onValueChange={v => setForm(f => ({ ...f, contactId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>{customers.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Invoice #</Label><Input value={form.invoiceNumber} onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))} /></div>
              <div>
                <Label>Phase</Label>
                <Select value={form.phase} onValueChange={v => setForm(f => ({ ...f, phase: v }))}>
                  <SelectTrigger data-testid="select-invoice-phase"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mitigation">Mitigation</SelectItem>
                    <SelectItem value="reconstruction">Reconstruction</SelectItem>
                    <SelectItem value="invoice_pending">Invoice pending</SelectItem>
                    <SelectItem value="complete">Complete</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  The Job page shows each phase's invoices separately — pick the phase this invoice belongs to.
                </p>
              </div>

              {/* Line items */}
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">Line Items</p>
                  <Button type="button" size="sm" variant="outline" data-testid="button-add-line-item"
                    onClick={() => setItems(rows => [...rows, blankRow()])}>
                    <Plus className="w-3 h-3 mr-1" />Add item
                  </Button>
                </div>
                <div className="grid grid-cols-[1fr_54px_78px_78px_28px] gap-2 text-[10px] font-semibold text-muted-foreground px-1">
                  <span>DESCRIPTION</span><span className="text-right">QTY</span><span className="text-right">UNIT $</span><span className="text-right">AMOUNT</span><span></span>
                </div>
                {items.map((row, idx) => {
                  const lineTotal = (Number(row.quantity) || 0) * (Number(row.unitPrice) || 0);
                  return (
                    <div key={idx} className="grid grid-cols-[1fr_54px_78px_78px_28px] gap-2 items-center" data-testid={`line-item-row-${idx}`}>
                      <Input className="h-8" placeholder="e.g. Water extraction & drying" value={row.description}
                        data-testid={`input-item-desc-${idx}`}
                        onChange={e => setItems(rows => rows.map((r, i) => i === idx ? { ...r, description: e.target.value } : r))} />
                      <Input className="h-8 text-right" type="number" min="0" value={row.quantity}
                        data-testid={`input-item-qty-${idx}`}
                        onChange={e => setItems(rows => rows.map((r, i) => i === idx ? { ...r, quantity: e.target.value } : r))} />
                      <Input className="h-8 text-right" type="number" min="0" placeholder="0" value={row.unitPrice}
                        data-testid={`input-item-price-${idx}`}
                        onChange={e => setItems(rows => rows.map((r, i) => i === idx ? { ...r, unitPrice: e.target.value } : r))} />
                      <span className="text-xs text-right tabular-nums">${lineTotal.toLocaleString()}</span>
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7"
                        data-testid={`button-remove-item-${idx}`}
                        disabled={items.length === 1}
                        onClick={() => setItems(rows => rows.filter((_, i) => i !== idx))}>
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><Label>Tax rate (%)</Label><Input type="number" min="0" step="0.01" value={form.taxRate} onChange={e => setForm(f => ({ ...f, taxRate: e.target.value }))} /></div>
                <div><Label>Due Date</Label><Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} /></div>
              </div>

              {/* Totals preview */}
              <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
                <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span data-testid="text-form-subtotal">${formSubtotal.toLocaleString()}</span></div>
                <div className="flex justify-between text-muted-foreground"><span>Tax ({formTaxRate}%)</span><span>${formTax.toLocaleString()}</span></div>
                <div className="flex justify-between font-bold text-base"><span>Total</span><span className="text-green-600" data-testid="text-form-total">${formTotal.toLocaleString()}</span></div>
              </div>

              {/* Send through QuickBooks toggle */}
              {(() => {
                const selected = contacts.find(c => c.id === Number(form.contactId));
                const custEmail = (selected as any)?.email as string | undefined;
                return (
                  <div className="rounded-md border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-start gap-2">
                        <BookOpen className="w-4 h-4 mt-0.5 text-[hsl(var(--titan-blue))] flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold leading-tight">Send through QuickBooks</p>
                          <p className="text-xs text-muted-foreground">Sync to QuickBooks and email the invoice to the customer.</p>
                        </div>
                      </div>
                      <Switch checked={sendViaQb} onCheckedChange={setSendViaQb} data-testid="switch-send-qb" />
                    </div>
                    {sendViaQb && (
                      <div className="flex items-center gap-1.5 text-xs pl-6" data-testid="text-qb-send-target">
                        <Mail className="w-3 h-3 text-muted-foreground" />
                        {custEmail
                          ? <span className="text-muted-foreground">Will email to <span className="font-medium text-foreground">{custEmail}</span></span>
                          : <span className="text-orange-600">No email on file for this customer — it'll sync to QuickBooks but won't auto-send.</span>}
                      </div>
                    )}
                  </div>
                );
              })()}

              <Button
                className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
                data-testid="button-create-invoice"
                disabled={!canCreate || createMutation.isPending}
                onClick={() => createMutation.mutate({
                  jobId: Number(form.jobId),
                  contactId: form.contactId ? Number(form.contactId) : null,
                  invoiceNumber: form.invoiceNumber,
                  dueDate: form.dueDate || null,
                  lineItems: JSON.stringify(parsedItems.filter(it => it.description && it.total > 0)),
                  subtotal: formSubtotal,
                  tax: formTax,
                  total: formTotal,
                  phase: form.phase || "mitigation",
                })}
              >{createMutation.isPending
                  ? (sendViaQb ? "Creating & sending…" : "Creating…")
                  : (sendViaQb ? <><Send className="w-4 h-4 mr-2" />Create & Send Invoice</> : "Create Invoice")}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : (
        <div className="space-y-2">
          {invoices.map(inv => {
            const job = jobs.find(j => j.id === inv.jobId);
            const contact = contacts.find(c => c.id === inv.contactId);
            const qb = qbStatus[inv.id];
            return (
              <Card key={inv.id} data-testid={`invoice-card-${inv.id}`}>
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    {/* Invoice identity + amount */}
                    <div className="flex items-start justify-between gap-3 sm:block">
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate">{inv.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          {contact?.name || "—"} · {job?.jobNumber || "—"} · {inv.dueDate ? `Due ${fmtDate(inv.dueDate)}` : "No due date"}
                        </p>
                      </div>
                      {/* Amount + status show inline with title on mobile, hidden here on desktop */}
                      <div className="flex items-center gap-2 shrink-0 sm:hidden">
                        <p className="font-bold text-lg text-green-600 tabular-nums">${(inv.total || 0).toLocaleString()}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[inv.status]}`}>{inv.status}</span>
                      </div>
                    </div>

                    {/* Amount + status + actions */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Amount + status only shown here on desktop */}
                      <p className="hidden sm:block font-bold text-lg text-green-600 tabular-nums">${(inv.total || 0).toLocaleString()}</p>
                      <span className={`hidden sm:inline text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_COLORS[inv.status]}`}>{inv.status}</span>
                      <Button size="sm" variant="outline" data-testid={`button-view-invoice-${inv.id}`} onClick={() => setViewId(inv.id)}>
                        <Eye className="w-3 h-3 mr-1" />View
                      </Button>
                      <Button size="sm" variant="outline" data-testid={`button-edit-invoice-${inv.id}`} onClick={() => openEdit(inv)}>
                        <Pencil className="w-3 h-3 mr-1" />Edit
                      </Button>
                      {canDeleteInvoice && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive border-destructive/40 hover:bg-destructive/10"
                          data-testid={`button-delete-invoice-${inv.id}`}
                          disabled={deleteInvoice.isPending}
                          onClick={() => {
                            if (window.confirm(`Delete invoice ${inv.invoiceNumber || `#${inv.id}`}? Any linked payments will also be removed.`)) {
                              deleteInvoice.mutate(inv.id);
                            }
                          }}
                        >
                          <Trash2 className="w-3 h-3 mr-1" />Delete
                        </Button>
                      )}
                      {inv.status !== "paid" && (
                        <Button size="sm" variant="outline" onClick={() => { setPayOpen(inv.id); setPayAmount(String(inv.total || "")); }}>
                          <DollarSign className="w-3 h-3 mr-1" />Record Payment
                        </Button>
                      )}
                      {/* QuickBooks payment flow */}
                      {!qb?.synced ? (
                        <Button size="sm" variant="outline" data-testid={`button-qb-sync-${inv.id}`}
                          disabled={qbSync.isPending}
                          onClick={() => qbSync.mutate(inv.id)}>
                          <BookOpen className="w-3 h-3 mr-1" />{qbSync.isPending ? "Syncing\u2026" : "Sync to QuickBooks"}
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" data-testid={`button-qb-paylink-${inv.id}`}
                            onClick={() => copyPayLink(qb.qbLink)}>
                            <Link2 className="w-3 h-3 mr-1" />Copy pay link
                          </Button>
                          {inv.status !== "paid" && (
                            <Button size="sm" variant="outline" data-testid={`button-qb-receive-${inv.id}`}
                              disabled={qbReceive.isPending}
                              onClick={() => qbReceive.mutate(inv.id)}>
                              <RefreshCw className={`w-3 h-3 mr-1 ${qbReceive.isPending ? "animate-spin" : ""}`} />Receive from QuickBooks
                            </Button>
                          )}
                          {qb.paidInQb && (
                            <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium" data-testid={`text-qb-paid-${inv.id}`}>
                              <CheckCircle className="w-3.5 h-3.5" />Paid via QuickBooks
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {invoices.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No invoices yet.</p>}
        </div>
      )}

      {/* View invoice dialog */}
      <Dialog open={viewId !== null} onOpenChange={() => setViewId(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {(() => {
            const inv = invoices.find(i => i.id === viewId);
            if (!inv) return null;
            const job = jobs.find(j => j.id === inv.jobId);
            const contact = contacts.find(c => c.id === inv.contactId);
            let items: any[] = [];
            try { items = JSON.parse(inv.lineItems || "[]"); } catch { items = []; }
            const subtotal = inv.subtotal || 0;
            const tax = inv.tax || 0;
            const total = inv.total || 0;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />{inv.invoiceNumber}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[inv.status]}`}>{inv.status}</span>
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 text-sm" data-testid="invoice-view">
                  {/* Company header */}
                  <div className="border-b pb-3">
                    <p className="font-bold">Titan Restoration LLC</p>
                    <p className="text-xs text-muted-foreground">Recover · Restore · Rebuild · 706-922-0154</p>
                  </div>

                  {/* Bill-to + meta */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">BILL TO</p>
                      <p className="font-medium">{contact?.name || "—"}</p>
                      {contact?.phone && <p className="text-xs text-muted-foreground">{contact.phone}</p>}
                      {(contact as any)?.address && <p className="text-xs text-muted-foreground">{(contact as any).address}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Job: {job?.jobNumber || "—"}</p>
                      <p className="text-xs text-muted-foreground">Due: {inv.dueDate ? (isNaN(Date.parse(inv.dueDate)) ? inv.dueDate : fmtDateShort(inv.dueDate)) : "—"}</p>
                      {inv.paidAt && <p className="text-xs text-green-600">Paid: {fmtDateShort(inv.paidAt)}</p>}
                    </div>
                  </div>

                  {/* Line items */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1">LINE ITEMS</p>
                    {items.length > 0 ? (
                      <div className="border rounded-md divide-y">
                        {items.map((it, idx) => {
                          const desc = it.description ?? it.name ?? it.desc ?? "Item";
                          const qty = it.quantity ?? it.qty ?? 1;
                          const price = it.unitPrice ?? it.price ?? it.rate ?? it.amount ?? 0;
                          const line = it.total ?? (Number(qty) * Number(price));
                          return (
                            <div key={idx} className="flex justify-between px-3 py-2">
                              <div>
                                <p>{desc}</p>
                                <p className="text-xs text-muted-foreground">{qty} × ${Number(price).toLocaleString()}</p>
                              </div>
                              <p className="font-medium">${Number(line).toLocaleString()}</p>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic border rounded-md px-3 py-3">No itemized line items on this invoice. Total is a flat amount.</p>
                    )}
                  </div>

                  {/* Totals */}
                  {(() => {
                    const adj = Number((inv as any).adjustment) || 0;
                    const orig = (inv as any).originalTotal != null ? Number((inv as any).originalTotal) : total;
                    return (
                      <div className="border-t pt-3 space-y-1">
                        <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>${subtotal.toLocaleString()}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>Tax</span><span>${tax.toLocaleString()}</span></div>
                        {adj > 0 && (
                          <>
                            <div className="flex justify-between text-muted-foreground"><span>Original invoiced</span><span>${orig.toLocaleString()}</span></div>
                            <div className="flex justify-between text-red-600">
                              <span>Insurance reduction{(inv as any).adjustmentReason ? ` — ${(inv as any).adjustmentReason}` : ""}</span>
                              <span>−${adj.toLocaleString()}</span>
                            </div>
                          </>
                        )}
                        <div className="flex justify-between font-bold text-base"><span>{adj > 0 ? "Net due" : "Total"}</span><span className="text-green-600">${total.toLocaleString()}</span></div>
                      </div>
                    );
                  })()}

                  {inv.notes && (
                    <div className="border-t pt-3">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">NOTES</p>
                      <p className="text-xs whitespace-pre-wrap">{inv.notes}</p>
                    </div>
                  )}

                  {/* Send + save panel replaces the standalone Download button.
                      Same PDF payload used by handleDownloadPDF is passed to
                      SendAndSavePanel so download / save / email all use
                      identical output. */}
                  {(() => {
                    const job = jobs.find(j => j.id === inv.jobId);
                    const contact = contacts.find(c => c.id === inv.contactId);
                    let li: any[] = [];
                    try { li = JSON.parse(inv.lineItems || "[]"); } catch { li = []; }
                    const normalized = li.map((it: any) => {
                      const qty = Number(it.quantity ?? it.qty ?? 1);
                      const price = Number(it.unitPrice ?? it.price ?? it.rate ?? it.amount ?? 0);
                      return {
                        description: it.description ?? it.name ?? it.desc ?? "Item",
                        quantity: qty,
                        unitPrice: price,
                        total: Number(it.total ?? qty * price),
                      };
                    });
                    return (
                      <SendAndSavePanel
                        jobId={inv.jobId}
                        docType="invoice"
                        title={`Invoice — ${inv.invoiceNumber}`}
                        defaultTo={(contact as any)?.email || ""}
                        defaultSubject={`Your invoice from Titan Restoration — ${inv.invoiceNumber}`}
                        defaultBody={
                          `Hi ${contact?.name || "there"},\n\n` +
                          `Attached is your invoice (${inv.invoiceNumber}). ` +
                          `Please review and reply here with any questions or to pay by card.\n\n` +
                          `Thanks,\nTitan Restoration`
                        }
                        buildPdf={() =>
                          generateInvoicePDF({
                            invoiceNumber: inv.invoiceNumber,
                            status: inv.status,
                            jobNumber: job?.jobNumber,
                            dueDate: inv.dueDate || undefined,
                            paidAt: inv.paidAt || undefined,
                            createdAt: (inv as any).createdAt || undefined,
                            billTo: {
                              name: contact?.name,
                              phone: contact?.phone || undefined,
                              email: (contact as any)?.email || undefined,
                              address: (contact as any)?.address || undefined,
                            },
                            lineItems: normalized,
                            subtotal: inv.subtotal || 0,
                            tax: inv.tax || 0,
                            total: inv.total || 0,
                            originalTotal:
                              (inv as any).originalTotal != null ? Number((inv as any).originalTotal) : undefined,
                            adjustment: Number((inv as any).adjustment) || 0,
                            adjustmentReason: (inv as any).adjustmentReason || undefined,
                            notes: inv.notes || undefined,
                          })
                        }
                      />
                    );
                  })()}

                  <div className="flex gap-2 pt-2">
                    {inv.status !== "paid" && (
                      <Button size="sm" className="flex-1" onClick={() => { setPayOpen(inv.id); setPayAmount(String(inv.total || "")); setViewId(null); }}>
                        <DollarSign className="w-3 h-3 mr-1" />Record Payment
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => setViewId(null)}>Close</Button>
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Edit invoice / settlement dialog */}
      <Dialog open={editId !== null} onOpenChange={() => setEditId(null)}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          {(() => {
            const inv = invoices.find(i => i.id === editId);
            if (!inv) return null;
            // Recompute totals live from the edited line items.
            const editParsed = editItems.map(it => {
              const qty = Number(it.quantity) || 0;
              const price = Number(it.unitPrice) || 0;
              return { description: it.description.trim(), quantity: qty, unitPrice: price, total: Math.round(qty * price * 100) / 100 };
            });
            const editSubtotal = Math.round(editParsed.reduce((s, it) => s + it.total, 0) * 100) / 100;
            const editTaxRate = Number(editForm.taxRate) || 0;
            const editTax = Math.round(editSubtotal * (editTaxRate / 100) * 100) / 100;
            const editGross = Math.round((editSubtotal + editTax) * 100) / 100;
            const adjNum = Number(editForm.adjustment) || 0;
            // Settlement reduction applies against the (edited) gross total.
            const baseline = editGross;
            const net = Math.max(0, baseline - adjNum);
            const tooBig = adjNum > baseline;
            return (
              <>
                <DialogHeader><DialogTitle>Edit Invoice — {inv.invoiceNumber}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Status</Label>
                    <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="sent">Sent</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="overdue">Overdue</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Editable line items */}
                  <div className="rounded-md border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold">Line Items</p>
                      <Button type="button" size="sm" variant="outline" data-testid="button-edit-add-line-item"
                        onClick={() => setEditItems(rows => [...rows, blankRow()])}>
                        <Plus className="w-3 h-3 mr-1" />Add item
                      </Button>
                    </div>
                    <div className="grid grid-cols-[1fr_54px_84px_84px_28px] gap-2 text-[10px] font-semibold text-muted-foreground px-1">
                      <span>DESCRIPTION</span><span className="text-right">QTY</span><span className="text-right">UNIT $</span><span className="text-right">AMOUNT</span><span></span>
                    </div>
                    {editItems.map((row, idx) => {
                      const lineTotal = (Number(row.quantity) || 0) * (Number(row.unitPrice) || 0);
                      return (
                        <div key={idx} className="grid grid-cols-[1fr_54px_84px_84px_28px] gap-2 items-center" data-testid={`edit-line-item-row-${idx}`}>
                          <Input className="h-8" placeholder="e.g. Water extraction & drying" value={row.description}
                            data-testid={`edit-input-item-desc-${idx}`}
                            onChange={e => setEditItems(rows => rows.map((r, i) => i === idx ? { ...r, description: e.target.value } : r))} />
                          <Input className="h-8 text-right" type="number" min="0" value={row.quantity}
                            data-testid={`edit-input-item-qty-${idx}`}
                            onChange={e => setEditItems(rows => rows.map((r, i) => i === idx ? { ...r, quantity: e.target.value } : r))} />
                          <Input className="h-8 text-right" type="number" min="0" step="0.01" placeholder="0" value={row.unitPrice}
                            data-testid={`edit-input-item-price-${idx}`}
                            onChange={e => setEditItems(rows => rows.map((r, i) => i === idx ? { ...r, unitPrice: e.target.value } : r))} />
                          <span className="text-xs text-right tabular-nums">${lineTotal.toLocaleString()}</span>
                          <Button type="button" size="icon" variant="ghost" className="h-7 w-7"
                            data-testid={`edit-button-remove-item-${idx}`}
                            disabled={editItems.length === 1}
                            onClick={() => setEditItems(rows => rows.filter((_, i) => i !== idx))}>
                            <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                          </Button>
                        </div>
                      );
                    })}
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div><Label className="text-xs">Tax rate (%)</Label>
                        <Input type="number" min="0" step="0.01" className="h-8" value={editForm.taxRate}
                          data-testid="edit-input-tax-rate"
                          onChange={e => setEditForm(f => ({ ...f, taxRate: e.target.value }))} /></div>
                    </div>
                    <div className="text-xs space-y-0.5 pt-1 border-t">
                      <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>${editSubtotal.toLocaleString()}</span></div>
                      <div className="flex justify-between text-muted-foreground"><span>Tax</span><span>${editTax.toLocaleString()}</span></div>
                      <div className="flex justify-between font-semibold"><span>Invoice total</span><span>${editGross.toLocaleString()}</span></div>
                    </div>
                  </div>

                  <div className="rounded-md border p-3 bg-muted/30 space-y-2">
                    <p className="text-xs font-semibold">Insurance Settlement Reduction</p>
                    <p className="text-xs text-muted-foreground">Enter the dollar amount the carrier reduced. The net due is recalculated automatically.</p>
                    <div>
                      <Label className="text-xs">Reduction amount ($)</Label>
                      <Input type="number" min="0" value={editForm.adjustment} placeholder="0"
                        data-testid="input-adjustment"
                        onChange={e => setEditForm(f => ({ ...f, adjustment: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Reason</Label>
                      <Input value={editForm.adjustmentReason} placeholder="e.g. Depreciation held back, carrier settlement"
                        data-testid="input-adjustment-reason"
                        onChange={e => setEditForm(f => ({ ...f, adjustmentReason: e.target.value }))} />
                    </div>
                    <div className="text-xs space-y-0.5 pt-1 border-t">
                      <div className="flex justify-between text-muted-foreground"><span>Original invoiced</span><span>${baseline.toLocaleString()}</span></div>
                      <div className="flex justify-between text-red-600"><span>Reduction</span><span>−${adjNum.toLocaleString()}</span></div>
                      <div className="flex justify-between font-bold"><span>Net due</span><span className="text-green-600">${net.toLocaleString()}</span></div>
                    </div>
                    {tooBig && <p className="text-xs text-red-600">Reduction can't exceed the original invoice total.</p>}
                  </div>

                  <div>
                    <Label>Due date</Label>
                    <Input type="date" value={editForm.dueDate?.slice(0,10) || ""}
                      onChange={e => setEditForm(f => ({ ...f, dueDate: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Input value={editForm.notes} placeholder="Internal notes"
                      onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Button className="flex-1" disabled={tooBig || updateInvoice.isPending}
                      data-testid="button-save-invoice"
                      onClick={() => {
                        // Base payload: edited line items + recomputed totals.
                        const data: any = {
                          status: editForm.status,
                          lineItems: JSON.stringify(editParsed.filter(it => it.description || it.total > 0)),
                          subtotal: editSubtotal,
                          tax: editTax,
                          total: editGross,
                          notes: editForm.notes || null,
                          dueDate: editForm.dueDate || null,
                        };
                        // Only apply settlement fields when there's an actual reduction.
                        // (The server recomputes net total from `adjustment` when present,
                        // so we must NOT send adjustment:0 or it would clobber the edited total.)
                        if (adjNum > 0) {
                          data.originalTotal = editGross;
                          data.total = net;
                          data.adjustment = adjNum;
                          data.adjustmentReason = editForm.adjustmentReason || null;
                        } else {
                          // Clear any prior reduction so the edited gross stands.
                          data.adjustment = 0;
                          data.originalTotal = null;
                          data.adjustmentReason = null;
                        }
                        updateInvoice.mutate({ id: inv.id, data });
                      }}>
                      {updateInvoice.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                    <Button variant="outline" className="flex-1" onClick={() => setEditId(null)}>Cancel</Button>
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Payment dialog */}
      <Dialog open={payOpen !== null} onOpenChange={() => setPayOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Amount ($)</Label><Input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} /></div>
            <div>
              <Label>Method</Label>
              <Select value={payMethod} onValueChange={setPayMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["check","ach","credit_card","cash","insurance_check"].map(m => <SelectItem key={m} value={m}>{m.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white"
              disabled={recordPayment.isPending}
              onClick={() => payOpen && recordPayment.mutate({ invId: payOpen, amount: Number(payAmount), method: payMethod })}
            >{recordPayment.isPending ? "Recording…" : "Record Payment"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
