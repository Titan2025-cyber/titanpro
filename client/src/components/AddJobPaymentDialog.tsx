import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * AddJobPaymentDialog — record a payment against a job without linking it
 * to a specific invoice. Covers the "cash walked in the door" case:
 * deposits, retainers, direct-pay checks that arrive before an invoice
 * is issued, or that need to sit as unapplied cash.
 *
 * For payment-against-invoice, use RecordPaymentDialog — this one is
 * intentionally simpler: no balance math, no auto-mark-paid logic.
 */

const METHODS = [
  { value: "check", label: "Check" },
  { value: "ach", label: "ACH / Wire" },
  { value: "credit_card", label: "Credit Card" },
  { value: "cash", label: "Cash" },
  { value: "cashapp", label: "Cash App" },
  { value: "venmo", label: "Venmo" },
  { value: "zelle", label: "Zelle" },
  { value: "insurance_check", label: "Insurance Check" },
];

export default function AddJobPaymentDialog({
  open,
  onOpenChange,
  jobId,
  contactId,
  defaultPhase,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: number;
  contactId?: number | null;
  /** Currently-viewed phase, so the note carries useful context. */
  defaultPhase?: "mitigation" | "reconstruction" | "all";
  onRecorded?: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("check");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const amountNum = Number(amount);
  const valid = amountNum > 0 && !!paidAt;

  const create = useMutation({
    mutationFn: async () => {
      const body: any = {
        type: "received",
        jobId,
        invoiceId: null,
        contactId: contactId ?? null,
        amount: amountNum,
        method,
        paidAt: new Date(paidAt).toISOString(),
        reference: reference || null,
        notes: notes || null,
      };
      const res = await apiRequest("POST", "/api/payments", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/aging"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-flow"] });
      toast({
        title: "Payment recorded",
        description: `$${amountNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} logged to this job (unapplied — not tied to an invoice).`,
      });
      onRecorded?.();
      // Reset for next entry.
      setAmount(""); setReference(""); setNotes("");
      onOpenChange(false);
    },
    onError: (e: any) => toast({
      title: "Could not record payment",
      description: String(e?.message || e),
      variant: "destructive",
    }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment (no invoice)</DialogTitle>
          <DialogDescription>
            Log a payment received for this job without linking it to a specific
            invoice — deposits, retainers, or direct-pay checks. If the money
            is meant for an invoice, use the Record Payment button on that
            invoice instead so the balance math is right.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="add-pay-amount">Amount ($)</Label>
            <Input
              id="add-pay-amount"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              data-testid="input-add-payment-amount"
            />
          </div>

          <div>
            <Label htmlFor="add-pay-date">Date received</Label>
            <Input
              id="add-pay-date"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              data-testid="input-add-payment-date"
            />
          </div>

          <div>
            <Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger data-testid="select-add-payment-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="add-pay-ref">Reference # (optional)</Label>
            <Input
              id="add-pay-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Check #, confirmation code, etc."
              data-testid="input-add-payment-reference"
            />
          </div>

          <div>
            <Label htmlFor="add-pay-notes">Notes (optional)</Label>
            <Textarea
              id="add-pay-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                defaultPhase && defaultPhase !== "all"
                  ? `e.g. Deposit for ${defaultPhase}`
                  : "e.g. Homeowner deposit, retainer, insurance draft…"
              }
              rows={2}
              data-testid="input-add-payment-notes"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!valid || create.isPending}
            data-testid="button-submit-add-payment"
          >
            {create.isPending ? "Recording…" : "Record Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
