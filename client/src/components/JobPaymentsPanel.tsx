import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { DollarSign, Trash2, Receipt } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { fmtDateShort } from "@/lib/dates";
import type { Payment, Invoice } from "@shared/schema";

/**
 * JobPaymentsPanel — every payment received on this job's invoices, plus
 * a rollup of invoiced / collected / outstanding. Read-mostly: we surface
 * a delete affordance for owner/admin so a mis-entered payment can be
 * removed without leaving the job.
 *
 * Payments are joined to invoices two ways:
 *   1. payment.invoiceId matches one of this job's invoices, OR
 *   2. payment.jobId directly equals this job's id (covers payments
 *      recorded without an invoice link — rare but possible).
 * The union is deduplicated by payment.id.
 */

const METHOD_LABELS: Record<string, string> = {
  check: "Check",
  ach: "ACH / Wire",
  credit_card: "Credit Card",
  cash: "Cash",
  cashapp: "Cash App",
  venmo: "Venmo",
  zelle: "Zelle",
  insurance_check: "Insurance Check",
};

function fmtMoney(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function JobPaymentsPanel({ jobId }: { jobId: number }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const canDelete = user?.role === "owner" || user?.role === "admin";

  const { data: allPayments = [], isLoading: payLoading } = useQuery<Payment[]>({
    queryKey: ["/api/payments"],
  });

  const { data: allInvoices = [], isLoading: invLoading } = useQuery<Invoice[]>({
    queryKey: ["/api/invoices"],
  });

  // Invoices on this job. Handles both the standard `jobId` and any older
  // rows that stored it as camelCase / snake_case interchangeably.
  const jobInvoices = useMemo(() => {
    return allInvoices.filter((inv: any) => {
      const jid = inv.jobId ?? inv.job_id;
      return Number(jid) === jobId;
    });
  }, [allInvoices, jobId]);

  const jobInvoiceIds = useMemo(() => new Set(jobInvoices.map(i => i.id)), [jobInvoices]);

  // Payments belonging to this job: either linked to a job invoice, or
  // directly stamped with this jobId.
  const jobPayments = useMemo(() => {
    const seen = new Set<number>();
    const out: Payment[] = [];
    for (const p of allPayments) {
      const pid = (p as any).id as number;
      const matches =
        (p.invoiceId != null && jobInvoiceIds.has(Number(p.invoiceId))) ||
        Number((p as any).jobId) === jobId;
      if (matches && !seen.has(pid)) {
        seen.add(pid);
        out.push(p);
      }
    }
    // Newest first — this is a history view, most recent is most useful.
    return out.sort((a: any, b: any) => {
      const da = new Date(a.paidAt || 0).getTime();
      const db = new Date(b.paidAt || 0).getTime();
      return db - da;
    });
  }, [allPayments, jobInvoiceIds, jobId]);

  // Rollups
  const totals = useMemo(() => {
    const invoiced = jobInvoices.reduce((s, i) => s + Number(i.total || 0), 0);
    const received = jobPayments
      .filter(p => p.type === "received")
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const other = jobPayments
      .filter(p => p.type !== "received")
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    return {
      invoiced,
      received,
      other,
      outstanding: Math.max(0, invoiced - received),
    };
  }, [jobInvoices, jobPayments]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/payments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ar/aging"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-flow"] });
      toast({ title: "Payment removed" });
    },
    onError: (e: any) => toast({
      title: "Delete failed",
      description: String(e?.message || e),
      variant: "destructive",
    }),
  });

  const loading = payLoading || invLoading;

  return (
    <div className="space-y-4">
      {/* Rollup cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Invoiced</p>
            <p className="text-xl font-bold" data-testid="job-payments-invoiced">{fmtMoney(totals.invoiced)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Received</p>
            <p className="text-xl font-bold text-green-600" data-testid="job-payments-received">{fmtMoney(totals.received)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p className={`text-xl font-bold ${totals.outstanding > 0 ? "text-[hsl(var(--titan-red))]" : "text-green-600"}`} data-testid="job-payments-outstanding">
              {fmtMoney(totals.outstanding)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Payments</p>
            <p className="text-xl font-bold" data-testid="job-payments-count">{jobPayments.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Payments list */}
      {loading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading payments…</CardContent></Card>
      ) : jobPayments.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <DollarSign className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="font-medium text-sm">No payments recorded yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Payments appear here as they're recorded on this job's invoices.
              Use the <span className="font-medium">Record Payment</span> button
              on any invoice in the Invoices tab.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border/60">
              {jobPayments.map((p: any) => {
                const inv = jobInvoices.find(i => i.id === Number(p.invoiceId));
                const isReceived = p.type === "received";
                const methodLabel = METHOD_LABELS[p.method] || p.method || "—";
                return (
                  <div key={p.id} className="p-3 flex items-start gap-3" data-testid={`job-payment-row-${p.id}`}>
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isReceived ? "bg-green-500/10 text-green-600" : "bg-[hsl(var(--titan-red)/0.1)] text-[hsl(var(--titan-red))]"}`}>
                      <DollarSign className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">
                          {isReceived ? "+" : "-"}{fmtMoney(Number(p.amount || 0))}
                        </span>
                        <Badge variant="outline" className="text-[10px]">{methodLabel}</Badge>
                        {!isReceived && (
                          <Badge variant="secondary" className="text-[10px] capitalize">
                            {String(p.type).replace(/_/g, " ")}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        {p.paidAt && <span>{fmtDateShort(p.paidAt)}</span>}
                        {inv && (
                          <span className="inline-flex items-center gap-1">
                            <Receipt className="w-3 h-3" />
                            {inv.invoiceNumber || `#${inv.id}`}
                          </span>
                        )}
                        {p.reference && <span>Ref: {p.reference}</span>}
                      </div>
                      {p.notes && (
                        <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{p.notes}</p>
                      )}
                    </div>
                    {canDelete && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="shrink-0 h-8 w-8 p-0"
                            title="Delete this payment"
                            data-testid={`button-delete-payment-${p.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this payment?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {fmtMoney(Number(p.amount || 0))} on {p.paidAt ? fmtDateShort(p.paidAt) : "—"}
                              {inv ? ` for ${inv.invoiceNumber || `#${inv.id}`}` : ""}.
                              This permanently removes the record. If the invoice was marked paid because of this payment, you may need to reopen it separately.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(p.id)}
                              data-testid={`button-confirm-delete-payment-${p.id}`}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
