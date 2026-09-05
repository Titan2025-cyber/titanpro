import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DollarSign } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Payment } from "@shared/schema";

/**
 * RecordPaymentDialog — reusable modal for logging a payment against an
 * invoice. Handles partial payments correctly: only marks the invoice as
 * paid when the total received meets or exceeds the invoice total.
 *
 * Callers pass the invoice they're paying against and (optionally) an open/
 * setOpen pair so the trigger can live wherever the caller wants it. When
 * no contactId is provided we use the invoice's own contact.
 */

const METHODS: { value: string; label: string }[] = [
  { value: "check",       label: "Check" },
  { value: "ach",         label: "ACH / Wire" },
  { value: "credit_card", label: "Credit Card" },
  { value: "cash",        label: "Cash" },
  { value: "cashapp",     label: "Cash App" },
  { value: "venmo",       label: "Venmo" },
  { value: "zelle",       label: "Zelle" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: {
    id: number;
    invoiceNumber?: string | null;
    total?: number | null;
    contactId?: number | null;
    jobId?: number | null;
  };
  /** Called after the payment is saved so caller can refresh other views. */
  onRecorded?: () => void;
}

export default function RecordPaymentDialog({ open, onOpenChange, invoice, onRecorded }: Props) {
  const { toast } = useToast();

  // Existing payments against this invoice — used to compute the running
  // balance so the dialog defaults the amount to what's still owed.
  const { data: allPayments = [] } = useQuery<Payment[]>({
    queryKey: ["/api/payments"],
    enabled: open, // don't fetch until the dialog opens
  });

  const paidSoFar = useMemo(() => {
    return allPayments
      .filter((p: any) => p.invoiceId === invoice.id && p.type === "received")
      .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
  }, [allPayments, invoice.id]);

  const invoiceTotal = Number(invoice.total || 0);
  const remainingBefore = Math.max(0, invoiceTotal - paidSoFar);

  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState<string>("check");
  const [paidAt, setPaidAt] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // Re-seed the amount to the remaining balance every time the dialog opens
  // or the invoice/paid-so-far changes.
  useEffect(() => {
    if (open) {
      setAmount(remainingBefore > 0 ? remainingBefore.toFixed(2) : invoiceTotal.toFixed(2));
      setMethod("check");
      setPaidAt(new Date().toISOString().slice(0, 10));
      setReference("");
      setNotes("");
    }
  }, [open, remainingBefore, invoiceTotal]);

  const amountNum = Number(amount || 0);
  const remainingAfter = Math.max(0, remainingBefore - amountNum);
  const willBePaid = amountNum > 0 && remainingAfter <= 0.005; // penny-safe

  const record = useMutation({
    mutationFn: async () => {
      // Compose the payment record. Include date/reference/notes so A/R
      // reconciliation has something to match against later.
      const paymentBody: any = {
        type: "received",
        invoiceId: invoice.id,
        contactId: invoice.contactId ?? null,
        jobId: invoice.jobId ?? null,
        amount: amountNum,
        method,
        paidAt: new Date(paidAt).toISOString(),
        reference: reference || null,
        notes: notes || null,
      };

      // Create the payment first, then move the invoice status only if the
      // balance is fully covered. Partial payments leave the invoice as-is
      // so it stays visible in A/R aging until it's actually paid off.
      await apiRequest("POST", "/api/payments", paymentBody);
      if (willBePaid) {
        await apiRequest("PATCH", `/api/invoices/${invoice.id}`, {
          status: "paid",
          paidAt: new Date(paidAt).toISOString(),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      // Refresh the Job Overview "Financial Summary" Received/Outstanding tiles.
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      // A/R aging + cash-flow surfaces recompute off invoices/payments.
      queryClient.invalidateQueries({ queryKey: ["/api/ar/aging"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-flow"] });
      toast({
        title: willBePaid ? "Payment recorded, invoice paid" : "Payment recorded",
        description: `$${amountNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} on ${invoice.invoiceNumber || `#${invoice.id}`}${!willBePaid ? ` · $${remainingAfter.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} still owed` : ""}`,
      });
      onOpenChange(false);
      onRecorded?.();
    },
    onError: (e: any) => {
      toast({
        title: "Couldn't record payment",
        description: String(e?.message || e),
        variant: "destructive",
      });
    },
  });

  const disabled = record.isPending || amountNum <= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            Record Payment · {invoice.invoiceNumber || `#${invoice.id}`}
          </DialogTitle>
        </DialogHeader>

        {/* Invoice balance snapshot */}
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Invoice total</span>
            <span className="font-medium">${invoiceTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-muted-foreground">Paid so far</span>
            <span className="font-medium">${paidSoFar.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between mt-1 pt-1 border-t border-border/60">
            <span className="text-muted-foreground">Remaining</span>
            <span className={`font-semibold ${remainingBefore > 0 ? "text-[hsl(var(--titan-red))]" : "text-green-600"}`}>
              ${remainingBefore.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pay-amount">Amount ($)</Label>
              <Input
                id="pay-amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                data-testid="input-payment-amount"
              />
            </div>
            <div>
              <Label htmlFor="pay-date">Date received</Label>
              <Input
                id="pay-date"
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                data-testid="input-payment-date"
              />
            </div>
          </div>

          <div>
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger data-testid="select-payment-method"><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="pay-ref">Reference (optional)</Label>
            <Input
              id="pay-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Check #, transaction ID, etc."
              data-testid="input-payment-reference"
            />
          </div>

          <div>
            <Label htmlFor="pay-notes">Notes (optional)</Label>
            <Textarea
              id="pay-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any context worth saving with this payment"
              data-testid="input-payment-notes"
            />
          </div>

          {amountNum > 0 && (
            <div className={`text-xs px-3 py-2 rounded-md border ${willBePaid ? "bg-green-500/10 border-green-500/40 text-green-700 dark:text-green-400" : "bg-yellow-500/10 border-yellow-500/40 text-yellow-800 dark:text-yellow-400"}`}>
              {willBePaid
                ? "Applying this payment will mark the invoice as paid."
                : `Partial payment — $${remainingAfter.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} will remain owed after this.`}
            </div>
          )}

          {amountNum > remainingBefore && remainingBefore > 0 && (
            <div className="text-xs px-3 py-2 rounded-md border bg-orange-500/10 border-orange-500/40 text-orange-800 dark:text-orange-400">
              Heads up: this is more than the remaining balance. Recording it anyway will still mark the invoice paid — the extra will show as an overpayment in reports.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
            disabled={disabled}
            onClick={() => record.mutate()}
            data-testid="button-record-payment"
          >
            {record.isPending ? "Recording…" : "Record Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
