import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { DollarSign, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Payment, Contact, Job } from "@shared/schema";
import { fmtDateShort } from "@/lib/dates";

export default function Payments() {
  const { data: payments = [] } = useQuery<Payment[]>({ queryKey: ["/api/payments"] });
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "received", contactId: "", jobId: "", amount: "", method: "check", notes: "" });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/payments", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/payments"] }); setOpen(false); },
  });

  const received = payments.filter(p => p.type === "received");
  const subPayments = payments.filter(p => p.type === "sub_payment");
  const referralPayouts = payments.filter(p => p.type === "referral_payout");

  const totalReceived = received.reduce((s, p) => s + p.amount, 0);
  const totalPaid = subPayments.reduce((s, p) => s + p.amount, 0) + referralPayouts.reduce((s, p) => s + p.amount, 0);

  const subs = contacts.filter(c => c.type === "sub");
  const referrals = contacts.filter(c => c.type === "referral");

  const PaymentRow = ({ p }: { p: Payment }) => {
    const contact = contacts.find(c => c.id === p.contactId);
    const job = jobs.find(j => j.id === p.jobId);
    return (
      <div className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
        <div>
          <p className="font-medium">{contact?.name || "—"}</p>
          <p className="text-xs text-muted-foreground">{job?.jobNumber || ""} · {p.method} · {p.paidAt ? fmtDateShort(p.paidAt) : ""}</p>
        </div>
        <p className={`font-bold ${p.type === "received" ? "text-green-600" : "text-[hsl(var(--titan-red))]"}`}>
          {p.type === "received" ? "+" : "-"}${p.amount.toLocaleString()}
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Payments</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white">
              <Plus className="w-4 h-4 mr-2" />Record Payment
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="received">Payment Received</SelectItem>
                    <SelectItem value="sub_payment">Sub Payment</SelectItem>
                    <SelectItem value="referral_payout">Referral Payout</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Contact</Label>
                <Select value={form.contactId} onValueChange={v => setForm(f => ({ ...f, contactId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select contact" /></SelectTrigger>
                  <SelectContent>
                    {contacts.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name} ({c.type})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Job (optional)</Label>
                <Select value={form.jobId} onValueChange={v => setForm(f => ({ ...f, jobId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Link to job" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No job</SelectItem>
                    {jobs.map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Amount ($)</Label><Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
                <div>
                  <Label>Method</Label>
                  <Select value={form.method} onValueChange={v => setForm(f => ({ ...f, method: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["check","ach","credit_card","cash","cashapp","venmo","zelle"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional reference" /></div>
              <Button
                className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate({ ...form, contactId: form.contactId ? Number(form.contactId) : null, jobId: form.jobId ? Number(form.jobId) : null, amount: Number(form.amount) })}
              >Record</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Total Received</p>
          <p className="text-xl font-bold text-green-600">${totalReceived.toLocaleString()}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Total Paid Out</p>
          <p className="text-xl font-bold text-[hsl(var(--titan-red))]">${totalPaid.toLocaleString()}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Net</p>
          <p className="text-xl font-bold">${(totalReceived - totalPaid).toLocaleString()}</p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="received">
        <TabsList>
          <TabsTrigger value="received">Received ({received.length})</TabsTrigger>
          <TabsTrigger value="subs">Sub Payments ({subPayments.length})</TabsTrigger>
          <TabsTrigger value="referrals">Referral Payouts ({referralPayouts.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="received" className="mt-3">
          <Card><CardContent className="p-4">
            {received.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No payments received.</p>
              : received.map(p => <PaymentRow key={p.id} p={p} />)}
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="subs" className="mt-3">
          <Card><CardContent className="p-4">
            {subPayments.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No sub payments recorded.</p>
              : subPayments.map(p => <PaymentRow key={p.id} p={p} />)}
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="referrals" className="mt-3">
          <Card><CardContent className="p-4">
            {referralPayouts.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No referral payouts recorded.</p>
              : referralPayouts.map(p => <PaymentRow key={p.id} p={p} />)}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
