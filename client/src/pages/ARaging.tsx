import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Clock, CheckCircle, DollarSign, Send } from "lucide-react";

function fmt(n: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n); }

const BUCKET_META: Record<string, { label: string; color: string; icon: any; border: string }> = {
  "0-30": { label: "Current (0–30 days)", color: "text-green-600", icon: CheckCircle, border: "border-l-green-500" },
  "31-60": { label: "31–60 Days", color: "text-yellow-600", icon: Clock, border: "border-l-yellow-400" },
  "61-90": { label: "61–90 Days", color: "text-orange-600", icon: AlertTriangle, border: "border-l-orange-500" },
  "90+": { label: "90+ Days (Critical)", color: "text-red-600", icon: AlertTriangle, border: "border-l-red-600" },
};

export default function ARaging() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/reports/ar-aging"] });

  const sendReminder = useMutation({
    mutationFn: async (inv: any) => {
      // Log a reminder note on the invoice
      await apiRequest("PATCH", `/api/invoices/${inv.id}`, { notes: `Reminder sent ${new Date().toLocaleDateString()} — ${inv.daysOverdue} days overdue` });
      return inv;
    },
    onSuccess: (inv: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reports/ar-aging"] });
      toast({ title: `Reminder logged for ${inv.invoiceNumber}`, description: `${inv.daysOverdue} days overdue — ${inv.carrier || "Direct"}` });
    },
  });

  if (isLoading) return <div className="p-6"><div className="h-64 bg-muted rounded animate-pulse" /></div>;

  const buckets = data?.buckets || {};
  const totalOutstanding = data?.totalOutstanding || 0;
  const bucketTotals = Object.fromEntries(
    Object.entries(buckets).map(([k, v]: any) => [k, v.reduce((s: number, inv: any) => s + (inv.total || 0), 0)])
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Accounts Receivable Aging</h1>
        <p className="text-sm text-muted-foreground">Unpaid invoices bucketed by days outstanding</p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-primary">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Outstanding</p>
            <p className="text-xl font-bold text-foreground">{fmt(totalOutstanding)}</p>
          </CardContent>
        </Card>
        {Object.entries(BUCKET_META).map(([key, meta]) => {
          const Icon = meta.icon;
          return (
            <Card key={key} className={`border-l-4 ${meta.border}`}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{key} Days</p>
                <p className={`text-xl font-bold ${meta.color}`}>{fmt(bucketTotals[key] || 0)}</p>
                <p className="text-xs text-muted-foreground">{(buckets[key] || []).length} invoices</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Bucket tables */}
      {Object.entries(BUCKET_META).map(([key, meta]) => {
        const items: any[] = buckets[key] || [];
        if (items.length === 0) return null;
        const Icon = meta.icon;
        return (
          <Card key={key} className={`border-l-4 ${meta.border}`}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-sm flex items-center gap-2 ${meta.color}`}>
                <Icon className="w-4 h-4" /> {meta.label} — {fmt(bucketTotals[key] || 0)}
              </CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-2 font-medium">Invoice #</th>
                  <th className="text-left px-4 py-2 font-medium">Contact</th>
                  <th className="text-left px-4 py-2 font-medium">Job #</th>
                  <th className="text-left px-4 py-2 font-medium">Carrier</th>
                  <th className="text-right px-4 py-2 font-medium">Amount</th>
                  <th className="text-right px-4 py-2 font-medium">Days Out</th>
                  <th className="px-4 py-2"></th>
                </tr></thead>
                <tbody>
                  {items.map((inv: any) => (
                    <tr key={inv.id} className="border-b hover:bg-muted/20" data-testid={`row-ar-${inv.id}`}>
                      <td className="px-4 py-3 font-medium">{inv.invoiceNumber}</td>
                      <td className="px-4 py-3 text-muted-foreground">{inv.contactName || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{inv.jobNumber || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{inv.carrier || "Direct"}</td>
                      <td className="px-4 py-3 text-right font-semibold">{fmt(inv.total)}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${meta.color}`}>{inv.daysOverdue}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="outline" onClick={() => sendReminder.mutate(inv)} disabled={sendReminder.isPending} data-testid={`button-remind-${inv.id}`}>
                          <Send className="w-3.5 h-3.5 mr-1" /> Remind
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}

      {totalOutstanding === 0 && (
        <Card><CardContent className="py-12 text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
          <p className="text-foreground font-medium">All invoices are paid.</p>
          <p className="text-sm text-muted-foreground">No outstanding A/R — great work!</p>
        </CardContent></Card>
      )}
    </div>
  );
}
