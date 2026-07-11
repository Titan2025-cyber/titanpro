import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Gavel, AlertTriangle, Clock, CheckCircle2, Send } from "lucide-react";

const STATUTES = {
  SC: { name: "SC Code § 38-59-20", days: 45, interest: "1.5%/month", description: "SC prompt payment: carrier must pay within 45 days of proof of loss. Interest accrues at 1.5%/month after deadline." },
  GA: { name: "GA Code § 33-24-14 / O.C.G.A. § 33-4-6", days: 15, interest: "50% penalty + attorney fees", description: "GA bad faith statute: 15 days from proof of loss. Bad faith failure triggers 50% penalty plus reasonable attorney fees." },
};

export default function StatuteDemandLetter() {
  const { data: invoices = [] } = useQuery<any[]>({ queryKey: ["/api/invoices"], queryFn: () => apiRequest("GET", "/api/invoices").then(r => r.json()) });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("GET", "/api/jobs").then(r => r.json()) });
  const [selectedInvoice, setSelectedInvoice] = useState("");
  const [state, setState] = useState<"SC"|"GA">("SC");

  const today = new Date();
  const overdueInvoices = (invoices as any[]).filter((inv: any) => {
    if (inv.status === "paid") return false;
    const created = new Date(inv.createdAt);
    const daysDiff = Math.floor((today.getTime() - created.getTime()) / 86400000);
    return daysDiff > STATUTES[state].days;
  });

  const invoice = (invoices as any[]).find((inv:any) => String(inv.id) === selectedInvoice);
  const job = invoice ? (jobs as any[]).find(j => j.id === invoice.jobId) : null;
  const statute = STATUTES[state];

  const daysOverdue = invoice ? Math.max(0, Math.floor((today.getTime() - new Date(invoice.createdAt).getTime()) / 86400000) - statute.days) : 0;
  const interest = invoice ? (Number(invoice.total) * 0.015 * Math.ceil(daysOverdue / 30)).toFixed(2) : "0";

  const letterText = invoice && job ? `
${today.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}

RE: DEMAND FOR PAYMENT — Statutory Notice Under ${statute.name}
Job Address: ${job.address}
Invoice #: ${invoice.id} — Amount Due: $${Number(invoice.total).toLocaleString()}
Insurance Carrier: ${job.insuranceCarrier || "N/A"}

This letter serves as formal demand for payment of the above-referenced invoice, which is now ${daysOverdue} day(s) past the statutory deadline established under ${statute.name}.

${statute.description}

Outstanding Balance: $${Number(invoice.total).toLocaleString()}
Accrued Interest/Penalties: $${interest}
TOTAL DUE: $${(Number(invoice.total) + Number(interest)).toLocaleString()}

Titan Restoration LLC demands payment in full within ten (10) calendar days of this notice. Failure to remit payment within this period may result in filing of a formal complaint with the ${state === "SC" ? "South Carolina Department of Insurance" : "Georgia Insurance Commissioner"} and referral to legal counsel.

Titan Restoration LLC
706-922-0154 | cody@titanrestorationllc.com
Augusta, GA
`.trim() : "";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-red))] flex items-center justify-center">
          <Gavel className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Statute Demand Letter Generator</h1>
          <p className="text-sm text-muted-foreground">Auto-generates demand letters when invoices age past SC/GA statutory deadlines</p>
        </div>
      </div>

      {overdueInvoices.length > 0 && (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950/20">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-red-600 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{overdueInvoices.length} Invoice(s) Past Statutory Deadline</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {overdueInvoices.map((inv: any, i: number) => {
              const daysSince = Math.floor((today.getTime() - new Date(inv.createdAt).getTime()) / 86400000);
              return (
                <div key={i} className="flex items-center justify-between bg-white dark:bg-background p-2 rounded border border-red-200 text-sm">
                  <span>Invoice #{inv.id} — ${Number(inv.total).toLocaleString()}</span>
                  <Badge variant="outline" className="text-xs border-red-300 text-red-600">{daysSince}d old</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">State</CardTitle></CardHeader>
          <CardContent className="flex gap-2">
            {(["SC","GA"] as const).map(s => (
              <Button key={s} size="sm" variant={state === s ? "default" : "outline"} onClick={() => setState(s)} className={state === s ? "bg-[hsl(var(--titan-red))] text-white" : ""}>{s}</Button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Applicable Statute</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xs font-semibold">{statute.name}</p>
            <p className="text-xs text-muted-foreground mt-1">{statute.description}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Select Invoice</CardTitle></CardHeader>
        <CardContent>
          <Select value={selectedInvoice} onValueChange={setSelectedInvoice}>
            <SelectTrigger><SelectValue placeholder="Choose invoice…" /></SelectTrigger>
            <SelectContent>
              {(invoices as any[]).filter((inv:any) => inv.status !== "paid").map((inv:any) => (
                <SelectItem key={inv.id} value={String(inv.id)}>Invoice #{inv.id} — ${Number(inv.total).toLocaleString()} ({inv.status})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {letterText && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><FileText className="w-4 h-4" />Generated Demand Letter</span>
              <div className="flex gap-2">
                <Badge variant="outline" className="text-xs">{daysOverdue}d overdue</Badge>
                <Badge variant="outline" className="text-xs text-red-600 border-red-300">Interest: ${interest}</Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="text-xs font-mono bg-muted/30 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">{letterText}</pre>
            <div className="flex gap-2">
              <Button size="sm" className="bg-[hsl(var(--titan-red))] text-white hover:opacity-90 text-xs"><Send className="w-3 h-3 mr-1" />Send by Certified Mail</Button>
              <Button size="sm" variant="outline" className="text-xs">Send Email</Button>
              <Button size="sm" variant="outline" className="text-xs">Copy Letter</Button>
              <Button size="sm" variant="outline" className="text-xs">Download PDF</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
