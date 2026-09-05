import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import {
  Calendar, DollarSign, Users, CheckCircle2, Clock, Lock, Unlock,
  ChevronLeft, ChevronRight, Plus, ExternalLink, Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

// ─────────────────────────────────────────────────────────────────────────────
// Weekly Payouts (Business Development)
//
// Cody: "I need a module that will help my marketing rep track all jobs every
// week — what signed, what didn't, what needs to be paid and how much and to
// who and how they were paid (cash / Zelle / Venmo / Cash App) — with a
// weekly report when finalized. We track referral from Thursday to
// Wednesday every week, payable that Friday following cutoff Wednesday
// night."
//
// This page shows one Thu→Wed cycle at a time:
//   • Header:   period range, payable date, big totals, Finalize button
//   • Body:     one card per referral partner with their jobs & payout rows
//   • Actions:  Add payout, mark paid (with method), unlock finalized week
//
// When a payout is marked paid the backend auto-writes a job_costs row
// (category = business_development) on the referred job so gross margin
// counts the cost of the referral.
// ─────────────────────────────────────────────────────────────────────────────

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "zelle", label: "Zelle" },
  { value: "venmo", label: "Venmo" },
  { value: "cashapp", label: "Cash App" },
  { value: "check", label: "Check" },
  { value: "other", label: "Other" },
];

type WeekPayload = {
  weekPeriodStart: string;
  weekPeriodEnd: string;
  payableOn: string;
  partners: Array<{
    partner: { id: number; name: string; company?: string; phone?: string; email?: string };
    jobs: Array<{
      id: number; jobNumber: string; status: string; createdAt: string; signed: boolean;
      payoutApplied?: number | null; payoutDate?: string | null;
    }>;
    payouts: Array<{
      id: number; amount: number; status: string;
      paymentMethod?: string | null; paymentReference?: string | null;
      paidAt?: string | null; jobId?: number | null;
      weekPeriodStart?: string | null; finalizedAt?: string | null;
      description?: string | null;
    }>;
  }>;
  totals: {
    totalPaid: number; totalPending: number;
    totalSigned: number; totalUnsigned: number; partnerCount: number;
  };
  finalized: { id: number; finalized_at: string; finalized_by?: string } | null;
};

const money = (n: number) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const longDate = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

// Shift the anchor date +/- one week. We anchor on the weekStart Thursday
// so this is always +7 / -7 days.
function shiftWeek(iso: string, delta: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta * 7);
  return d.toISOString().slice(0, 10);
}

export default function WeeklyPayouts() {
  const { toast } = useToast();

  // Anchor date drives which Thu→Wed cycle is shown. Defaults to today so
  // the current in-flight week loads.
  const today = new Date().toISOString().slice(0, 10);
  const [anchor, setAnchor] = useState<string>(today);

  const { data, isLoading } = useQuery<WeekPayload>({
    queryKey: ["/api/referral-payouts/week", anchor],
    queryFn: () => apiRequest("GET", `/api/referral-payouts/week?date=${anchor}`).then(r => r.json()),
  });

  // Add-payout dialog state. We open it from either the partner card header
  // ("Add payout") or a per-job "Add payout" row action.
  const [addFor, setAddFor] = useState<{ contactId: number; jobId?: number; suggested?: number } | null>(null);
  // Mark-paid dialog state — asks for method + reference at time of payment.
  const [payFor, setPayFor] = useState<{ id: number; amount: number; partnerName: string } | null>(null);
  // Confirm before finalizing (locks the week; owner-only).
  const [confirmFinalize, setConfirmFinalize] = useState(false);

  const finalizeMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/referral-payouts/finalize", { date: data?.weekPeriodStart }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/referral-payouts/week"] });
      queryClient.invalidateQueries({ queryKey: ["/api/referral-payouts/weeks"] });
      toast({ title: "Week finalized" });
      setConfirmFinalize(false);
    },
    onError: (err: any) => toast({ title: "Finalize failed", description: String(err?.message || err), variant: "destructive" }),
  });

  const unlockMut = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/referral-payouts/finalize/${data?.weekPeriodStart}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/referral-payouts/week"] });
      queryClient.invalidateQueries({ queryKey: ["/api/referral-payouts/weeks"] });
      toast({ title: "Week unlocked" });
    },
  });

  if (isLoading || !data) {
    return <div className="p-8 text-center text-muted-foreground">Loading weekly payouts…</div>;
  }

  const locked = !!data.finalized;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* ─── Header: period range, payable, totals, Finalize ─── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-[hsl(var(--titan-blue))]" />
            <h1 className="text-xl md:text-2xl font-bold">Weekly Payouts</h1>
            {locked && (
              <Badge className="bg-amber-100 text-amber-800 border border-amber-300 gap-1">
                <Lock className="w-3 h-3" /> Finalized
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Marketing rep view — every referral this week, who's signed, who's paid, and how.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setAnchor(shiftWeek(data.weekPeriodStart, -1))} title="Previous week">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="text-center min-w-[220px]">
            <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
              <Calendar className="w-3 h-3 inline mr-1" />
              Thu {longDate(data.weekPeriodStart).split(",")[1]?.trim()} → Wed {longDate(data.weekPeriodEnd).split(",")[1]?.trim()}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Payable Friday, {longDate(data.payableOn).split(",")[1]?.trim()}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAnchor(shiftWeek(data.weekPeriodStart, 1))} title="Next week">
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAnchor(today)} title="Jump to current week">Today</Button>
        </div>
      </div>

      {/* ─── Totals cards ─── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Partners</div>
            <div className="text-2xl font-bold flex items-center gap-1"><Users className="w-4 h-4 text-muted-foreground" />{data.totals.partnerCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Signed</div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />{data.totals.totalSigned}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Unsigned</div>
            <div className="text-2xl font-bold text-muted-foreground flex items-center gap-1"><Clock className="w-4 h-4" />{data.totals.totalUnsigned}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Pending Payouts</div>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{money(data.totals.totalPending)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Paid This Week</div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{money(data.totals.totalPaid)}</div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Finalize / Unlock strip ─── */}
      <div className="flex items-center justify-between bg-muted/40 rounded-md p-3 border">
        <div className="text-sm">
          {locked ? (
            <>
              <span className="font-semibold">Locked</span> — finalized{" "}
              {shortDate(data.finalized!.finalized_at)}{data.finalized!.finalized_by ? ` by ${data.finalized!.finalized_by}` : ""}.
              Historical snapshot preserved for tax records.
            </>
          ) : (
            <>Cutoff <span className="font-semibold">Wednesday 11:59 PM</span>. Once every payout is recorded, finalize to lock this week's numbers.</>
          )}
        </div>
        {locked ? (
          <Button variant="outline" size="sm" onClick={() => unlockMut.mutate()} disabled={unlockMut.isPending} className="text-amber-700">
            <Unlock className="w-4 h-4 mr-1" /> Unlock week
          </Button>
        ) : (
          <Button
            size="sm"
            className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
            onClick={() => setConfirmFinalize(true)}
            data-testid="button-finalize-week"
          >
            <Lock className="w-4 h-4 mr-1" /> Finalize week
          </Button>
        )}
      </div>

      {/* ─── Per-partner cards ─── */}
      {data.partners.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No referral activity in this week.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.partners.map((row: any) => {
            const partnerPaid = row.payouts.filter((p: any) => String(p.status).toLowerCase() === "paid")
              .reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
            const partnerPending = row.payouts.filter((p: any) => String(p.status).toLowerCase() !== "paid")
              .reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
            return (
              <Card key={row.partner.id} data-testid={`partner-card-${row.partner.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base flex items-center gap-2">
                        {row.partner.name}
                        {row.partner.company && <span className="text-xs font-normal text-muted-foreground">· {row.partner.company}</span>}
                      </CardTitle>
                      <div className="text-xs text-muted-foreground mt-1">
                        {row.jobs.length} referral{row.jobs.length === 1 ? "" : "s"} this week ·{" "}
                        <span className="text-green-600 dark:text-green-400">{row.jobs.filter((j: any) => j.signed).length} signed</span> ·{" "}
                        <span>{row.jobs.filter((j: any) => !j.signed).length} unsigned</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="text-right">
                        <div className="text-[10px] uppercase text-muted-foreground">Pending</div>
                        <div className="font-semibold text-amber-600 dark:text-amber-400">{money(partnerPending)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase text-muted-foreground">Paid</div>
                        <div className="font-semibold text-green-600 dark:text-green-400">{money(partnerPaid)}</div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAddFor({ contactId: row.partner.id })}
                        disabled={locked}
                        data-testid={`btn-add-payout-${row.partner.id}`}
                      >
                        <Plus className="w-4 h-4 mr-1" /> Add payout
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {/* Jobs table */}
                  {row.jobs.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[11px] uppercase font-semibold text-muted-foreground mb-1">Jobs this week</div>
                      <div className="border rounded divide-y">
                        {row.jobs.map((j: any) => {
                          const jobPayouts = row.payouts.filter((p: any) => p.jobId === j.id);
                          const alreadyPaid = jobPayouts.some((p: any) => String(p.status).toLowerCase() === "paid");
                          return (
                            <div key={j.id} className="flex items-center gap-2 p-2 text-sm">
                              <Link href={`/jobs/${j.id}`} className="text-[hsl(var(--titan-blue))] hover:underline font-medium inline-flex items-center gap-1">
                                {j.jobNumber}
                                <ExternalLink className="w-3 h-3" />
                              </Link>
                              <span className="text-xs text-muted-foreground">{shortDate(j.createdAt)}</span>
                              {j.signed
                                ? <Badge className="bg-green-100 text-green-700 border border-green-300 text-[10px]">Signed</Badge>
                                : <Badge variant="outline" className="text-[10px]">Unsigned</Badge>}
                              <span className="text-xs text-muted-foreground capitalize">· {j.status || "lead"}</span>
                              <div className="ml-auto flex items-center gap-2">
                                {jobPayouts.length > 0 && (
                                  <span className="text-xs text-muted-foreground">
                                    {jobPayouts.length} payout{jobPayouts.length === 1 ? "" : "s"}
                                  </span>
                                )}
                                {!alreadyPaid && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setAddFor({ contactId: row.partner.id, jobId: j.id })}
                                    disabled={locked}
                                  >
                                    + Payout
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Payout rows */}
                  {row.payouts.length > 0 && (
                    <div>
                      <div className="text-[11px] uppercase font-semibold text-muted-foreground mb-1">Payouts</div>
                      <div className="border rounded divide-y">
                        {row.payouts.map((p: any) => {
                          const isPaid = String(p.status).toLowerCase() === "paid";
                          return (
                            <div key={p.id} className="flex items-center gap-2 p-2 text-sm">
                              <span className="font-semibold">{money(p.amount)}</span>
                              {isPaid ? (
                                <Badge className="bg-green-100 text-green-700 border border-green-300 text-[10px] capitalize">
                                  Paid{p.paymentMethod ? ` · ${p.paymentMethod}` : ""}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] capitalize">{p.status || "pending"}</Badge>
                              )}
                              {p.paidAt && <span className="text-xs text-muted-foreground">{shortDate(p.paidAt)}</span>}
                              {p.description && <span className="text-xs text-muted-foreground truncate max-w-[240px]">· {p.description}</span>}
                              {p.paymentReference && <span className="text-xs text-muted-foreground">· ref: {p.paymentReference}</span>}
                              {p.jobId && (
                                <Link href={`/jobs/${p.jobId}`} className="text-xs text-[hsl(var(--titan-blue))] hover:underline inline-flex items-center gap-0.5 ml-1">
                                  job <ExternalLink className="w-3 h-3" />
                                </Link>
                              )}
                              <div className="ml-auto flex items-center gap-2">
                                {!isPaid && !locked && (
                                  <Button
                                    size="sm"
                                    className="h-7 px-2 text-xs bg-green-600 hover:bg-green-700 text-white"
                                    onClick={() => setPayFor({ id: p.id, amount: p.amount, partnerName: row.partner.name })}
                                  >
                                    Mark paid
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {row.jobs.length === 0 && row.payouts.length === 0 && (
                    <div className="text-xs text-muted-foreground italic">No activity.</div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ─── Dialogs ─── */}
      {addFor && (
        <AddPayoutDialog
          open={!!addFor}
          onOpenChange={(o) => { if (!o) setAddFor(null); }}
          contactId={addFor.contactId}
          jobId={addFor.jobId}
          weekPeriodStart={data.weekPeriodStart}
        />
      )}
      {payFor && (
        <MarkPaidDialog
          open={!!payFor}
          onOpenChange={(o) => { if (!o) setPayFor(null); }}
          payoutId={payFor.id}
          amount={payFor.amount}
          partnerName={payFor.partnerName}
        />
      )}

      <Dialog open={confirmFinalize} onOpenChange={setConfirmFinalize}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Finalize this week?</DialogTitle>
            <DialogDescription>
              Locks the week of <b>Thu {shortDate(data.weekPeriodStart)}</b> – <b>Wed {shortDate(data.weekPeriodEnd)}</b>{" "}
              and writes a permanent snapshot for tax records. Every payout in this cycle will be marked finalized;
              editing them again requires you to unlock the week.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm bg-muted/50 rounded p-3 space-y-1">
            <div>Partners: <b>{data.totals.partnerCount}</b></div>
            <div>Signed: <b className="text-green-600">{data.totals.totalSigned}</b> · Unsigned: <b>{data.totals.totalUnsigned}</b></div>
            <div>Paid: <b className="text-green-600">{money(data.totals.totalPaid)}</b></div>
            <div>Pending: <b className="text-amber-600">{money(data.totals.totalPending)}</b></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmFinalize(false)}>Cancel</Button>
            <Button
              onClick={() => finalizeMut.mutate()}
              disabled={finalizeMut.isPending}
              className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
            >
              {finalizeMut.isPending ? "Finalizing…" : "Finalize week"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddPayoutDialog — creates a new payout_request in the current cycle.
// ─────────────────────────────────────────────────────────────────────────────
function AddPayoutDialog({
  open, onOpenChange, contactId, jobId, weekPeriodStart,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contactId: number;
  jobId?: number;
  weekPeriodStart: string;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");

  const create = useMutation({
    mutationFn: () => {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter an amount greater than 0");
      return apiRequest("POST", "/api/payout-requests", {
        contactId,
        jobId: jobId || null,
        amount: amt,
        description: description || null,
        status: "pending",
        weekPeriodStart,
      }).then(r => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/referral-payouts/week"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payout-requests"] });
      toast({ title: "Payout added" });
      onOpenChange(false);
    },
    onError: (err: any) => toast({ title: "Save failed", description: String(err?.message || err), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add payout</DialogTitle>
          <DialogDescription>
            Records what's owed. Marking it paid later will auto-write a job cost under Business Development.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-sm">Amount (USD)</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <Input type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" className="pl-6" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
          </div>
          <div>
            <Label className="text-sm">Note (optional)</Label>
            <Input placeholder="e.g. Kickback for smith-1024 loss" className="mt-1" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending} className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white">
            {create.isPending ? "Saving…" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MarkPaidDialog — flips a payout to paid and captures method + reference.
// The PATCH triggers the backend auto-cost write.
// ─────────────────────────────────────────────────────────────────────────────
function MarkPaidDialog({
  open, onOpenChange, payoutId, amount, partnerName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  payoutId: number;
  amount: number;
  partnerName: string;
}) {
  const { toast } = useToast();
  const [method, setMethod] = useState<string>("cash");
  const [reference, setReference] = useState<string>("");

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/payout-requests/${payoutId}`, {
      status: "paid",
      paymentMethod: method,
      paymentReference: reference || null,
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/referral-payouts/week"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payout-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      toast({ title: "Payout marked paid", description: "Job cost auto-written under Business Development." });
      onOpenChange(false);
    },
    onError: (err: any) => toast({ title: "Save failed", description: String(err?.message || err), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark payout paid</DialogTitle>
          <DialogDescription>
            {money(amount)} to <b>{partnerName}</b>. How did the money move?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-sm">Payment method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Reference (optional)</Label>
            <Input placeholder="Zelle confirmation #, check #, Venmo handle" className="mt-1" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} className="bg-green-600 hover:bg-green-700 text-white">
            {save.isPending ? "Saving…" : "Mark paid"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const money2 = money;
