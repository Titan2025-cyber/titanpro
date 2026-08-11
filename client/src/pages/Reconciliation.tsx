import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtDateShort } from "@/lib/dates";
import {
  Scale, CheckCircle2, AlertTriangle, CreditCard, BookMarked,
  ArrowRight, Link2, DollarSign, HelpCircle,
} from "lucide-react";

const money = (n: number) =>
  "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const FLAG_LABELS: Record<string, { label: string; className: string }> = {
  stripe_paid_invoice_open: { label: "Stripe paid · invoice still open", className: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  fully_paid_not_marked: { label: "Fully paid · not marked paid", className: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  paid_not_in_qb: { label: "Paid · not recorded in QuickBooks", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  paid_not_synced_to_qb: { label: "Paid · never synced to QuickBooks", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  partial_payment: { label: "Partial payment", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  stripe_amount_mismatch: { label: "Stripe amount ≠ recorded", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
};

interface ReconRow {
  invoiceId: number;
  invoiceNumber: string;
  contactName: string | null;
  status: string;
  total: number;
  paidAmount: number;
  balance: number;
  stripePaid: boolean;
  stripeAmount: number;
  qbSynced: boolean;
  qbStatus: string | null;
  qbPaid: boolean;
  qbLink: string | null;
  flags: string[];
  reconciled: boolean;
}

export default function Reconciliation() {
  const [filter, setFilter] = useState<"all" | "attention">("attention");

  const { data, isLoading } = useQuery<{ summary: any; rows: ReconRow[]; orphanPayments: any[] }>({
    queryKey: ["/api/reconciliation"],
    queryFn: () => apiRequest("/api/reconciliation").then((r) => r.json()),
  });

  const summary = data?.summary;
  const rows = data?.rows ?? [];
  const orphans = data?.orphanPayments ?? [];
  const shown = filter === "attention" ? rows.filter((r) => !r.reconciled) : rows;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Scale className="w-5 h-5 text-[hsl(var(--titan-blue))]" /> Payment Reconciliation
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Matches money across Stripe, your invoices, and QuickBooks — and flags where they disagree.
        </p>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-xl font-bold" data-testid="stat-reconciled">{summary?.reconciled ?? 0}</p>
              <p className="text-xs text-muted-foreground">Reconciled</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-xl font-bold" data-testid="stat-attention">{summary?.needsAttention ?? 0}</p>
              <p className="text-xs text-muted-foreground">Need attention</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xl font-bold" data-testid="stat-open-balance">{money(summary?.openBalance ?? 0)}</p>
              <p className="text-xs text-muted-foreground">Open balance</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-xl font-bold" data-testid="stat-stripe-collected">{money(summary?.stripeCollected ?? 0)}</p>
              <p className="text-xs text-muted-foreground">Collected via Stripe</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter toggle */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant={filter === "attention" ? "default" : "outline"} onClick={() => setFilter("attention")} data-testid="button-filter-attention">
          Needs attention ({rows.filter((r) => !r.reconciled).length})
        </Button>
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")} data-testid="button-filter-all">
          All invoices ({rows.length})
        </Button>
      </div>

      {/* Reconciliation matrix */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Invoice · Stripe · QuickBooks</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : shown.length === 0 ? (
            <div className="text-center py-10">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-medium">{filter === "attention" ? "Everything reconciles" : "No invoices yet"}</p>
              <p className="text-xs text-muted-foreground">
                {filter === "attention" ? "No mismatches between Stripe, invoices, and QuickBooks." : "Send an invoice to see it here."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-3 font-medium">Invoice</th>
                    <th className="py-2 px-3 font-medium">Total</th>
                    <th className="py-2 px-3 font-medium">Collected</th>
                    <th className="py-2 px-3 font-medium">Stripe</th>
                    <th className="py-2 px-3 font-medium">QuickBooks</th>
                    <th className="py-2 pl-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.invoiceId} className="border-b last:border-0 align-top" data-testid={`recon-row-${r.invoiceId}`}>
                      <td className="py-3 pr-3">
                        <p className="font-semibold">{r.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground">{r.contactName || "—"}</p>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">{money(r.total)}</td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {money(r.paidAmount)}
                        {r.balance > 0.01 && <p className="text-xs text-red-500">{money(r.balance)} due</p>}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {r.stripePaid ? (
                          <Badge variant="outline" className="gap-1 text-purple-600 border-purple-200">
                            <CreditCard className="w-3 h-3" /> {money(r.stripeAmount)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {r.qbSynced ? (
                          <span className="inline-flex items-center gap-1">
                            <Badge variant="outline" className="gap-1 text-blue-600 border-blue-200">
                              <BookMarked className="w-3 h-3" /> {r.qbStatus || "synced"}
                            </Badge>
                            {r.qbLink && (
                              <a href={r.qbLink} target="_blank" rel="noreferrer" className="text-blue-500" data-testid={`link-qb-${r.invoiceId}`}>
                                <Link2 className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">not synced</span>
                        )}
                      </td>
                      <td className="py-3 pl-3">
                        {r.reconciled ? (
                          <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-200" data-testid={`badge-reconciled-${r.invoiceId}`}>
                            <CheckCircle2 className="w-3 h-3" /> Reconciled
                          </Badge>
                        ) : (
                          <div className="flex flex-col gap-1">
                            {r.flags.map((f) => (
                              <Badge key={f} className={`gap-1 ${FLAG_LABELS[f]?.className || ""}`} data-testid={`flag-${f}-${r.invoiceId}`}>
                                <AlertTriangle className="w-3 h-3" /> {FLAG_LABELS[f]?.label || f}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Orphan payments */}
      {orphans.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-amber-500" /> Unmatched Payments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Payments recorded with no matching sent invoice — review and attach them.
            </p>
            <div className="space-y-2">
              {orphans.map((p) => (
                <div key={p.paymentId} className="flex items-center justify-between gap-3 border rounded-md p-3 flex-wrap" data-testid={`orphan-row-${p.paymentId}`}>
                  <div className="flex items-center gap-2 text-sm">
                    <ArrowRight className="w-4 h-4 text-amber-500" />
                    <span className="font-semibold">{money(p.amount)}</span>
                    <span className="text-muted-foreground">via {p.method || "—"}</span>
                    {p.reference && <span className="text-xs text-muted-foreground">· {p.reference}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {p.contactName || "Unknown"} · {p.paidAt ? fmtDateShort(p.paidAt) : ""}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
