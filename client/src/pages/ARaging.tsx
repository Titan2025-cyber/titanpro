import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Clock, CheckCircle, DollarSign, Send, ExternalLink } from "lucide-react";

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
  // Which aging bucket is selected. null = show all buckets.
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);

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

      {/* Summary KPIs — click a bucket to filter the jobs below */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <button
          type="button"
          onClick={() => setSelectedBucket(null)}
          className="text-left focus:outline-none"
          data-testid="ar-bucket-all"
        >
          <Card className={`border-l-4 border-l-primary transition-all hover:shadow-md cursor-pointer ${selectedBucket === null ? "ring-2 ring-primary" : ""}`}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Outstanding</p>
              <p className="text-xl font-bold text-foreground">{fmt(totalOutstanding)}</p>
              <p className="text-xs text-muted-foreground">{Object.values(buckets).reduce((s: number, v: any) => s + (v?.length || 0), 0)} invoices · All buckets</p>
            </CardContent>
          </Card>
        </button>
        {Object.entries(BUCKET_META).map(([key, meta]) => {
          const count = (buckets[key] || []).length;
          const isSelected = selectedBucket === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedBucket(isSelected ? null : key)}
              className="text-left focus:outline-none"
              data-testid={`ar-bucket-${key}`}
            >
              <Card className={`border-l-4 ${meta.border} transition-all hover:shadow-md cursor-pointer ${isSelected ? "ring-2 ring-primary" : ""} ${selectedBucket && !isSelected ? "opacity-60" : ""}`}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{key} Days</p>
                  <p className={`text-xl font-bold ${meta.color}`}>{fmt(bucketTotals[key] || 0)}</p>
                  <p className="text-xs text-muted-foreground">{count} {count === 1 ? "invoice" : "invoices"}</p>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>

      {/* Active filter indicator */}
      {selectedBucket && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Showing</span>
          <Badge variant="outline" className={BUCKET_META[selectedBucket].color}>{BUCKET_META[selectedBucket].label}</Badge>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedBucket(null)} data-testid="button-clear-ar-filter">Show all buckets</Button>
        </div>
      )}

      {/* Bucket tables — filtered to the selected bucket when one is active */}
      {selectedBucket && (buckets[selectedBucket] || []).length === 0 && (
        <Card><CardContent className="py-12 text-center">
          <CheckCircle className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-foreground font-medium">No invoices in {BUCKET_META[selectedBucket].label}</p>
          <p className="text-sm text-muted-foreground">Nothing to work in this bucket right now.</p>
        </CardContent></Card>
      )}
      {Object.entries(BUCKET_META)
        .filter(([key]) => !selectedBucket || key === selectedBucket)
        .map(([key, meta]) => {
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
                      <td className="px-4 py-3">
                        {inv.jobId ? (
                          <Link href={`/jobs/${inv.jobId}`} className="inline-flex items-center gap-1 text-[hsl(var(--titan-blue))] hover:underline font-medium" data-testid={`link-job-${inv.id}`}>
                            {inv.jobNumber || "Open job"}<ExternalLink className="w-3 h-3" />
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{inv.jobNumber || "—"}</span>
                        )}
                      </td>
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
