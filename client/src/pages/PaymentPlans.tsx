/**
 * PaymentPlans.tsx — #5 Self-Pay Payment Plan Module
 * Create installment plans for homeowners; track deposit + payments
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, DollarSign, Calendar, CheckCircle, Clock, AlertTriangle, CreditCard } from "lucide-react";
import type { Job, Contact } from "@shared/schema";

const fmt$ = (n: number) => "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-700" },
  active: { label: "Active", color: "bg-blue-100 text-blue-700" },
  paid: { label: "Paid", color: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-700" },
};

const INSTALLMENT_STATUS: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: "Pending", color: "text-muted-foreground", icon: Clock },
  paid: { label: "Paid", color: "text-green-600", icon: CheckCircle },
  overdue: { label: "Overdue", color: "text-[hsl(var(--titan-red))]", icon: AlertTriangle },
  waived: { label: "Waived", color: "text-muted-foreground", icon: CheckCircle },
};

export default function PaymentPlans() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<any>(null);
  const [form, setForm] = useState({
    jobId: "", contactId: "", totalAmount: "", depositPct: "25",
    installmentCount: "4", frequency: "monthly", notes: "",
  });

  const { data: plans = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/payment-plans"],
    queryFn: () => apiRequest("GET", "/api/payment-plans").then(r => r.json()),
  });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });

  const createMutation = useMutation({
    mutationFn: (d: any) => apiRequest("POST", "/api/payment-plans", d).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payment-plans"] }); setOpen(false); toast({ title: "Payment plan created" }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const markPaidMutation = useMutation({
    mutationFn: (installmentId: number) => apiRequest("PATCH", `/api/payment-plan-installments/${installmentId}`, { status: "paid", paidAt: new Date().toISOString() }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payment-plans"] }); toast({ title: "Installment marked paid" }); },
  });

  const activateMutation = useMutation({
    mutationFn: (planId: number) => apiRequest("PATCH", `/api/payment-plans/${planId}`, { status: "active" }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payment-plans"] }); toast({ title: "Plan activated" }); },
  });

  const totalAmt = parseFloat(form.totalAmount) || 0;
  const depositAmt = totalAmt * (parseFloat(form.depositPct) / 100);
  const remaining = totalAmt - depositAmt;
  const installmentAmt = remaining / (parseInt(form.installmentCount) || 1);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CreditCard className="w-6 h-6 text-[hsl(var(--titan-blue))]" />
          <h1 className="text-xl font-bold">Payment Plans</h1>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white">
              <Plus className="w-4 h-4 mr-2" />New Plan
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Payment Plan</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Job</Label>
                <Select value={form.jobId} onValueChange={v => setForm(f => ({ ...f, jobId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select job" /></SelectTrigger>
                  <SelectContent>{jobs.map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber} — {j.address}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Customer</Label>
                <Select value={form.contactId} onValueChange={v => setForm(f => ({ ...f, contactId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>{contacts.filter(c => c.type === "customer").map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Total Amount</Label>
                <Input type="number" placeholder="0.00" value={form.totalAmount} onChange={e => setForm(f => ({ ...f, totalAmount: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Deposit %</Label>
                  <Select value={form.depositPct} onValueChange={v => setForm(f => ({ ...f, depositPct: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["10","15","20","25","30","33","50"].map(p => <SelectItem key={p} value={p}>{p}%</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Installments</Label>
                  <Select value={form.installmentCount} onValueChange={v => setForm(f => ({ ...f, installmentCount: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["2","3","4","6","8","12"].map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={v => setForm(f => ({ ...f, frequency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Bi-Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Preview */}
              {totalAmt > 0 && (
                <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
                  <p className="font-semibold text-xs text-muted-foreground uppercase">Plan Preview</p>
                  <div className="flex justify-between"><span>Deposit ({form.depositPct}%)</span><span className="font-medium">{fmt$(depositAmt)}</span></div>
                  <div className="flex justify-between"><span>{form.installmentCount}x {form.frequency} payments</span><span className="font-medium">{fmt$(installmentAmt)}/ea</span></div>
                  <div className="flex justify-between font-bold border-t pt-1"><span>Total</span><span>{fmt$(totalAmt)}</span></div>
                </div>
              )}

              <div>
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
              </div>
              <Button
                className="w-full bg-[hsl(var(--titan-blue))] text-white"
                disabled={createMutation.isPending || !form.jobId || !totalAmt}
                onClick={() => createMutation.mutate({ ...form, jobId: Number(form.jobId), contactId: Number(form.contactId), totalAmount: totalAmt, depositPct: parseFloat(form.depositPct), depositAmount: depositAmt, installmentAmount: installmentAmt, installmentCount: parseInt(form.installmentCount), createdAt: new Date().toISOString() })}
              >
                {createMutation.isPending ? "Creating…" : "Create Plan"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-24 bg-muted animate-pulse rounded" />)}</div>
      ) : plans.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground"><CreditCard className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No payment plans yet.</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {plans.map((plan: any) => {
            const job = jobs.find(j => j.id === plan.jobId);
            const contact = contacts.find(c => c.id === plan.contactId);
            const meta = STATUS_META[plan.status] || STATUS_META.draft;
            const paidCount = (plan.installments || []).filter((i: any) => i.status === "paid").length;
            const totalCount = (plan.installments || []).length;
            return (
              <Card key={plan.id} className="border-l-4 border-[hsl(var(--titan-blue))]">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm">{job?.jobNumber || `Job #${plan.jobId}`}</span>
                        <Badge className={`text-xs ${meta.color}`}>{meta.label}</Badge>
                        <span className="text-xs text-muted-foreground">{contact?.name}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 mt-2 text-xs">
                        <div><span className="text-muted-foreground">Total</span><p className="font-semibold">{fmt$(plan.totalAmount)}</p></div>
                        <div><span className="text-muted-foreground">Deposit</span><p className="font-semibold">{fmt$(plan.depositAmount)}</p></div>
                        <div><span className="text-muted-foreground">Paid</span><p className="font-semibold text-green-600">{paidCount}/{totalCount} installs</p></div>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {plan.status === "draft" && (
                        <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => activateMutation.mutate(plan.id)}>Activate</Button>
                      )}
                      <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setSelectedPlan(selectedPlan?.id === plan.id ? null : plan)}>
                        {selectedPlan?.id === plan.id ? "Hide" : "Details"}
                      </Button>
                    </div>
                  </div>

                  {selectedPlan?.id === plan.id && (plan.installments || []).length > 0 && (
                    <div className="mt-3 border-t pt-3 space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Installment Schedule</p>
                      {(plan.installments || []).map((inst: any) => {
                        const s = INSTALLMENT_STATUS[inst.status] || INSTALLMENT_STATUS.pending;
                        const Icon = s.icon;
                        return (
                          <div key={inst.id} className="flex items-center justify-between text-xs py-1">
                            <div className="flex items-center gap-2">
                              <Icon className={`w-3.5 h-3.5 ${s.color}`} />
                              <span className="text-muted-foreground">Due {inst.dueDate}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{fmt$(inst.amount)}</span>
                              {inst.status === "pending" && (
                                <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => markPaidMutation.mutate(inst.id)}>Mark Paid</Button>
                              )}
                              {inst.status !== "pending" && <Badge className={`text-xs ${s.color === "text-green-600" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>{s.label}</Badge>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
