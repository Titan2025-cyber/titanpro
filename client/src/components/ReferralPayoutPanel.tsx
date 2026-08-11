import { useMemo, useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HandCoins, CheckCircle2, Lightbulb, Lock, Users, Banknote, Clock } from "lucide-react";
import type { Job, Estimate, Invoice, Contact, Payment } from "@shared/schema";
import { fmtDate } from "@/lib/dates";

// ── Payout amounts (Titan referral program) ──────────────────────────────────
// $100  — inspection only (referred, inspected, not yet sold)
// $500  — job sold, job value up to $4,000
// $1,000 — job sold, job value $5,000+
const PAYOUT_OPTIONS = [
  { value: 100, label: "$100", sub: "Inspection only" },
  { value: 500, label: "$500", sub: "Sold job up to $4,000" },
  { value: 1000, label: "$1,000", sub: "Sold job $5,000+" },
] as const;

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "ach", label: "ACH / Bank transfer" },
  { value: "venmo", label: "Venmo / Zelle" },
  { value: "other", label: "Other" },
] as const;

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtDate = (s: string) => fmtDate(s, { month: "short", day: "numeric", year: "numeric" });

// Roles allowed to select/apply/pay a payout. Everyone else sees read-only.
const CAN_SELECT_ROLES = ["owner", "admin", "sales"];

// ── Recommendation logic ──────────────────────────────────────────────────────
// Job value is the best documented dollar figure for the job: the highest of the
// approved/sent estimate totals and invoice totals across all phases.
function jobValue(estimates: Estimate[], invoices: Invoice[]): number {
  const estVals = estimates
    .filter(e => ["approved", "sent"].includes((e.status as string) || ""))
    .map(e => e.total || 0);
  const invVals = invoices.map(i => i.total || 0);
  return Math.max(0, ...estVals, ...invVals);
}

// A job is "sold" once it has a sales date or has moved past the initial "new" stage.
function isSold(job: Job): boolean {
  if (job.salesDate) return true;
  return !!job.status && job.status !== "new";
}

export function recommendPayout(
  job: Job,
  estimates: Estimate[],
  invoices: Invoice[],
): { amount: number; reason: string; value: number; sold: boolean } {
  const sold = isSold(job);
  const value = jobValue(estimates, invoices);

  if (!sold) {
    return { amount: 100, reason: "Referred lead — inspection only, job not sold yet.", value, sold };
  }
  if (value >= 5000) {
    return { amount: 1000, reason: `Job sold at ${fmt(value)} (\u2265 $5,000).`, value, sold };
  }
  if (value > 0) {
    return { amount: 500, reason: `Job sold at ${fmt(value)} (up to $4,000).`, value, sold };
  }
  return { amount: 500, reason: "Job sold but no estimate/invoice value recorded yet — defaulting to $500.", value, sold };
}

export function ReferralPayoutPanel({
  job,
  estimates,
  invoices,
  partnerName,
}: {
  job: Job;
  estimates: Estimate[];
  invoices: Invoice[];
  partnerName?: string;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const canSelect = !!user && CAN_SELECT_ROLES.includes(user.role);

  // Resolve partner contact via referralPartnerId, falling back to provided name.
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const partner = useMemo(
    () => contacts.find(c => c.id === job.referralPartnerId),
    [contacts, job.referralPartnerId],
  );
  const displayPartner = partner?.name || partnerName || "Unassigned partner";

  // Payment history for THIS job's referral payouts.
  const { data: allPayments = [] } = useQuery<Payment[]>({ queryKey: ["/api/payments"] });
  const jobPayouts = useMemo(
    () => allPayments
      .filter(p => p.jobId === job.id && p.type === "referral_payout")
      .sort((a, b) => (b.paidAt || "").localeCompare(a.paidAt || "")),
    [allPayments, job.id],
  );
  const totalPaid = jobPayouts.reduce((s, p) => s + (p.amount || 0), 0);

  const rec = useMemo(() => recommendPayout(job, estimates, invoices), [job, estimates, invoices]);

  const applied = job.partnerPayoutApplied ?? null; // amount owed / approved for this job

  // ── Selection state (the owed/approved amount) ──────────────────────────────
  const [selected, setSelected] = useState<string>(String(applied ?? rec.amount));
  const [custom, setCustom] = useState<string>("");
  useEffect(() => { setSelected(String(applied ?? rec.amount)); }, [applied, rec.amount, job.id]);
  const isCustom = selected === "custom";
  const chosenAmount = isCustom ? Number(custom || 0) : Number(selected);

  // ── Payment recording state ─────────────────────────────────────────────────
  const outstanding = Math.max(0, (applied ?? 0) - totalPaid);
  const [payAmount, setPayAmount] = useState<string>("");
  const [payMethod, setPayMethod] = useState<string>("cash");
  const [payRef, setPayRef] = useState<string>("");
  const [payNotes, setPayNotes] = useState<string>("");
  useEffect(() => { setPayAmount(outstanding > 0 ? String(outstanding) : ""); }, [outstanding, job.id]);

  const setPayoutMutation = useMutation({
    mutationFn: (amount: number) =>
      apiRequest("PATCH", `/api/jobs/${job.id}`, { partnerPayoutApplied: amount }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(job.id)] });
      toast({ title: "Payout amount set", description: `${fmt(chosenAmount)} owed to ${displayPartner}.` });
    },
    onError: () => toast({ title: "Error", description: "Could not save the payout amount.", variant: "destructive" }),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: (amount: number) =>
      apiRequest("POST", "/api/payments", {
        jobId: job.id,
        contactId: partner?.id ?? job.referralPartnerId ?? null,
        type: "referral_payout",
        amount,
        method: payMethod,
        reference: payRef || null,
        notes: payNotes || null,
        paidAt: new Date().toISOString(),
      }).then(r => r.json()),
    onSuccess: async () => {
      // Stamp the job's payout date so pipeline/reports reflect it was paid.
      await apiRequest("PATCH", `/api/jobs/${job.id}`, { partnerPayoutDate: new Date().toISOString() });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", String(job.id)] });
      queryClient.invalidateQueries({ queryKey: ["/api/payout-requests"] });
      setPayRef(""); setPayNotes("");
      toast({ title: "Payment recorded", description: `${fmt(recordedAmount)} paid to ${displayPartner}.` });
    },
    onError: () => toast({ title: "Error", description: "Could not record the payment.", variant: "destructive" }),
  });
  const recordedAmount = Number(payAmount || 0);

  const status: "unpaid" | "partial" | "paid" =
    applied == null ? "unpaid"
      : totalPaid <= 0 ? "unpaid"
        : totalPaid >= applied ? "paid" : "partial";

  return (
    <div className="space-y-4">
      {/* Partner header + status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <HandCoins className="w-4 h-4 text-[hsl(var(--titan-red))]" />
              Referral Payout
            </CardTitle>
            {status === "paid" ? (
              <Badge className="bg-green-100 text-green-700 border border-green-300 dark:bg-green-950/30 dark:text-green-400" data-testid="badge-payout-status">
                <CheckCircle2 className="w-3 h-3 mr-1 inline-block" />Paid
              </Badge>
            ) : status === "partial" ? (
              <Badge className="bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-950/30 dark:text-amber-400" data-testid="badge-payout-status">
                <Clock className="w-3 h-3 mr-1 inline-block" />Partially paid
              </Badge>
            ) : applied != null ? (
              <Badge className="bg-amber-100 text-amber-700 border border-amber-300 dark:bg-amber-950/30 dark:text-amber-400" data-testid="badge-payout-status">
                <Clock className="w-3 h-3 mr-1 inline-block" />Owed, unpaid
              </Badge>
            ) : (
              <Badge variant="outline" data-testid="badge-payout-status">Not set</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <Users className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Partner:</span>
            <span className="font-medium" data-testid="text-referral-partner">{displayPartner}</span>
          </div>
          {applied != null && (
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div className="rounded-md border p-2 text-center">
                <p className="text-[11px] text-muted-foreground">Owed</p>
                <p className="text-sm font-semibold" data-testid="text-payout-owed">{fmt(applied)}</p>
              </div>
              <div className="rounded-md border p-2 text-center">
                <p className="text-[11px] text-muted-foreground">Paid</p>
                <p className="text-sm font-semibold text-green-600 dark:text-green-400" data-testid="text-payout-paid">{fmt(totalPaid)}</p>
              </div>
              <div className="rounded-md border p-2 text-center">
                <p className="text-[11px] text-muted-foreground">Remaining</p>
                <p className="text-sm font-semibold" data-testid="text-payout-remaining">{fmt(outstanding)}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recommendation */}
      <Card className="border-[hsl(var(--titan-blue))]/40 bg-[hsl(var(--titan-blue))]/5">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-[hsl(var(--titan-blue))]/15 flex items-center justify-center shrink-0">
              <Lightbulb className="w-4.5 h-4.5 text-[hsl(var(--titan-blue))]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium">Recommended payout</p>
                <Badge className="bg-[hsl(var(--titan-blue))] text-white" data-testid="badge-recommended-payout">{fmt(rec.amount)}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1" data-testid="text-recommendation-reason">{rec.reason}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                <span>Status: <span className="font-medium capitalize text-foreground">{rec.sold ? "Sold" : "Not sold"}</span></span>
                {rec.value > 0 && <span>Job value: <span className="font-medium text-foreground">{fmt(rec.value)}</span></span>}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 1: Set the owed amount */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">1. Payout amount owed</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {!canSelect && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
              <Lock className="w-3.5 h-3.5" />
              Only sales reps, admins, and owners can set or pay referral payouts.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {PAYOUT_OPTIONS.map(opt => {
              const isSel = !isCustom && chosenAmount === opt.value;
              const isRec = rec.amount === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!canSelect}
                  onClick={() => setSelected(String(opt.value))}
                  data-testid={`button-payout-${opt.value}`}
                  className={`text-left rounded-lg border p-3 transition-all ${
                    isSel
                      ? "border-[hsl(var(--titan-red))] bg-[hsl(var(--titan-red))]/5 ring-1 ring-[hsl(var(--titan-red))]"
                      : "border-border hover:border-[hsl(var(--titan-red))]/40"
                  } ${!canSelect ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-base font-semibold">{opt.label}</span>
                    {isRec && <Badge className="bg-[hsl(var(--titan-blue))]/15 text-[hsl(var(--titan-blue))] text-[10px] px-1.5 py-0">Rec</Badge>}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{opt.sub}</p>
                </button>
              );
            })}
          </div>

          {canSelect && (
            <div className="flex items-end gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="custom-payout-toggle"
                  checked={isCustom}
                  onChange={e => setSelected(e.target.checked ? "custom" : String(rec.amount))}
                  data-testid="checkbox-custom-payout"
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor="custom-payout-toggle" className="text-sm cursor-pointer">Custom amount</Label>
              </div>
              {isCustom && (
                <div className="w-40">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input type="number" min={0} step={50} value={custom} onChange={e => setCustom(e.target.value)} placeholder="0" className="pl-6" data-testid="input-custom-payout" />
                  </div>
                </div>
              )}
            </div>
          )}

          {canSelect && (
            <Button
              onClick={() => setPayoutMutation.mutate(chosenAmount)}
              disabled={setPayoutMutation.isPending || !(chosenAmount > 0)}
              className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red))]/90"
              data-testid="button-apply-payout"
            >
              {setPayoutMutation.isPending ? "Saving\u2026" : applied != null ? `Update owed to ${fmt(chosenAmount)}` : `Set owed amount ${fmt(chosenAmount)}`}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Record a payment (cash, check, etc.) */}
      {canSelect && applied != null && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Banknote className="w-4 h-4 text-green-600" />
              2. Record a payment
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            {outstanding <= 0 ? (
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/20 rounded-md px-3 py-2">
                <CheckCircle2 className="w-4 h-4" />
                This payout is fully paid. You can still record an additional payment below if needed.
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{fmt(outstanding)} remaining to pay {displayPartner} for this job.</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Amount</Label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input type="number" min={0} step={50} value={payAmount} onChange={e => setPayAmount(e.target.value)} className="pl-6" data-testid="input-payment-amount" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Method</Label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger className="mt-1" data-testid="select-payment-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Reference (check #, confirmation, etc.)</Label>
              <Input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Optional" className="mt-1" data-testid="input-payment-reference" />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea value={payNotes} onChange={e => setPayNotes(e.target.value)} placeholder="Optional — e.g. paid cash on site" className="mt-1" rows={2} data-testid="input-payment-notes" />
            </div>
            <Button
              onClick={() => recordPaymentMutation.mutate(recordedAmount)}
              disabled={recordPaymentMutation.isPending || !(recordedAmount > 0)}
              className="bg-green-600 hover:bg-green-700 text-white"
              data-testid="button-record-payment"
            >
              {recordPaymentMutation.isPending ? "Recording\u2026" : `Record ${fmt(recordedAmount)} payment`}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Payment history for this job */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Payment history</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {jobPayouts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No payments recorded for this referral yet.</p>
          ) : (
            <div className="space-y-2">
              {jobPayouts.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border p-3" data-testid={`row-payment-${p.id}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{fmt(p.amount || 0)}</span>
                      <Badge variant="outline" className="text-[10px] capitalize">{p.method || "—"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p.paidAt ? fmtDate(p.paidAt) : "—"}
                      {p.reference ? ` · Ref: ${p.reference}` : ""}
                    </p>
                    {p.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.notes}</p>}
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
