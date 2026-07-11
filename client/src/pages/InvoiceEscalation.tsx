import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Scale, AlertCircle, FileText, Mail, Clock, DollarSign, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SC_RATE = 0.065; // SC statutory interest 6.5% per year (SC Code § 34-31-20)
const GA_RATE = 0.07;  // GA statutory interest 7% per year (GA Code § 7-4-2)
const DAYS_BEFORE_INTEREST = 30; // 30 days past due

const SC_STATUTES = [
  { code: "SC § 34-31-20", desc: "Legal rate of interest: 6.5% per annum on unpaid insurance proceeds" },
  { code: "SC § 38-59-20", desc: "Carrier must acknowledge claim within 10 days of receipt" },
  { code: "SC § 38-59-40", desc: "Bad faith denial — 25% penalty on claim amount + attorney fees" },
  { code: "SC § 38-77-180", desc: "Unfair claim settlement — prohibited practices" },
];
const GA_STATUTES = [
  { code: "GA § 7-4-2", desc: "Legal rate of interest: 7% per annum on unpaid amounts" },
  { code: "GA § 33-4-6", desc: "Bad faith: up to 50% of claim + attorney fees after 60 days" },
  { code: "GA § 33-6-31", desc: "Unfair claims settlement — liability clear, failure to pay" },
  { code: "GA § 13-6-11", desc: "Attorney fees: bad faith, stubborn litigiousness" },
];

function calcInterest(amount: number, dueDateStr: string, state: "SC" | "GA") {
  if (!dueDateStr || amount <= 0) return 0;
  const due = new Date(dueDateStr);
  const now = new Date();
  const daysPastDue = Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86400000) - DAYS_BEFORE_INTEREST);
  if (daysPastDue <= 0) return 0;
  const rate = state === "SC" ? SC_RATE : GA_RATE;
  return Math.round(amount * rate * (daysPastDue / 365) * 100) / 100;
}

export default function InvoiceEscalation() {
  const { toast } = useToast();
  const [expandedJob, setExpandedJob] = useState<number | null>(null);
  const [stateFilter, setStateFilter] = useState<"all" | "SC" | "GA">("all");
  const [minDays, setMinDays] = useState(30);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["/api/invoices"],
    queryFn: () => apiRequest("/api/invoices").then(r => r.json()),
  });
  const { data: payments = [] } = useQuery({
    queryKey: ["/api/payments"],
    queryFn: () => apiRequest("/api/payments").then(r => r.json()),
  });
  const { data: jobs = [] } = useQuery({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then(r => r.json()),
  });

  // Find unpaid or partially paid invoices past due date
  const escalations = invoices.map((inv: any) => {
    const job = jobs.find((j: any) => j.id === inv.job_id);
    if (!job) return null;
    const collected = payments
      .filter((p: any) => p.invoice_id === inv.id && p.type === "received" && !p.credit_memo)
      .reduce((s: number, p: any) => s + (p.amount || 0), 0);
    const balance = (inv.total || 0) - collected;
    if (balance <= 0) return null;

    const dueDate = inv.due_date || inv.created_at;
    const now = new Date();
    const due = new Date(dueDate);
    const daysPastDue = Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86400000));
    if (daysPastDue < minDays) return null;

    // Determine state from address
    const addr = (job.address || "").toLowerCase();
    const state: "SC" | "GA" = addr.includes(" sc") || addr.includes(",sc") || addr.includes("south carolina") ? "SC" : "GA";
    if (stateFilter !== "all" && state !== stateFilter) return null;

    const interest = calcInterest(balance, dueDate, state);
    const rate = state === "SC" ? SC_RATE : GA_RATE;
    const statutes = state === "SC" ? SC_STATUTES : GA_STATUTES;

    return { inv, job, collected, balance, daysPastDue, state, interest, rate, statutes, dueDate };
  }).filter(Boolean);

  const totalBalance = escalations.reduce((s: number, e: any) => s + e.balance, 0);
  const totalInterest = escalations.reduce((s: number, e: any) => s + e.interest, 0);

  const generateDemandLetter = (esc: any) => {
    const { inv, job, balance, interest, state, statutes, daysPastDue } = esc;
    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const totalDue = balance + interest;
    const primary = statutes[0];
    const badFaith = statutes.find((s: any) => s.desc.includes("Bad faith") || s.desc.includes("bad faith"));

    const letter = `TITAN RESTORATION LLC
706-922-0154 | cody@titanrestorationllc.com
Augusta, GA

${today}

RE: DEMAND FOR PAYMENT — Invoice #${inv.invoice_number || inv.id}
Job: ${job.job_number} | ${job.address}
${job.insurance_carrier ? `Insurance Carrier: ${job.insurance_carrier}` : ""}
${job.claim_number ? `Claim #: ${job.claim_number}` : ""}

TO WHOM IT MAY CONCERN:

This letter serves as formal demand for payment of the outstanding balance of $${balance.toLocaleString("en-US", { minimumFractionDigits: 2 })} on the above-referenced invoice, which is now ${daysPastDue} days past due.

AMOUNT DUE:
  Principal Balance:     $${balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
  Statutory Interest (${(esc.rate * 100).toFixed(1)}% — ${primary.code}): $${interest.toLocaleString("en-US", { minimumFractionDigits: 2 })}
  TOTAL DUE:             $${totalDue.toLocaleString("en-US", { minimumFractionDigits: 2 })}

APPLICABLE ${state} STATUTES:
${statutes.map((s: any) => `  • ${s.code}: ${s.desc}`).join("\n")}

${badFaith ? `PLEASE BE ADVISED: Under ${badFaith.code}, failure to pay a valid claim may constitute bad faith, exposing the carrier to additional penalties and attorney's fees.\n\n` : ""}Demand is hereby made for full payment of $${totalDue.toLocaleString("en-US", { minimumFractionDigits: 2 })} within TEN (10) calendar days of receipt of this letter. Failure to remit payment may result in referral to legal counsel and/or filing a complaint with the ${state === "SC" ? "South Carolina Department of Insurance" : "Georgia Office of Insurance and Safety Fire Commissioner"}.

Sincerely,

Cody Brantley
Owner, Titan Restoration LLC
706-922-0154`;

    // Copy to clipboard
    navigator.clipboard.writeText(letter).then(() => {
      toast({ title: "Demand letter copied to clipboard", description: "Paste into your email or Word document." });
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Scale className="h-6 w-6 text-red-500" />
            Invoice Escalation — Statutory Interest
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            SC (6.5%) &amp; GA (7%) statutory interest auto-calculated on past-due invoices
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(["all", "SC", "GA"] as const).map(s => (
            <Button
              key={s}
              size="sm"
              variant={stateFilter === s ? "default" : "outline"}
              onClick={() => setStateFilter(s)}
              data-testid={`button-filter-${s}`}
            >{s === "all" ? "All States" : s}</Button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <div>
                <p className="text-sm text-muted-foreground">Invoices Past Due</p>
                <p className="text-xl font-bold text-red-600">{escalations.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <DollarSign className="h-5 w-5 text-orange-500" />
              <div>
                <p className="text-sm text-muted-foreground">Total Outstanding</p>
                <p className="text-xl font-bold">${totalBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-sm text-muted-foreground">Interest Accrued</p>
                <p className="text-xl font-bold text-blue-600">${totalInterest.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Statute Reference */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[{ state: "SC", statutes: SC_STATUTES, rate: "6.5%" }, { state: "GA", statutes: GA_STATUTES, rate: "7%" }].map(({ state, statutes, rate }) => (
          <Card key={state} className="bg-slate-50 border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Scale className="h-4 w-4" />{state} Statutory Framework — {rate}/yr
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {statutes.map((s: any) => (
                <p key={s.code} className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{s.code}:</span> {s.desc}
                </p>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Escalation List */}
      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}</div>
      ) : escalations.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No past-due invoices found past {minDays} days.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {escalations.map((esc: any, idx: number) => {
            const isExpanded = expandedJob === esc.inv.id;
            const totalDue = esc.balance + esc.interest;
            return (
              <Card key={esc.inv.id} className="border-l-4 border-l-red-400" data-testid={`card-escalation-${esc.inv.id}`}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <span className="font-bold">{esc.job.job_number}</span>
                        <Badge className="text-xs bg-red-100 text-red-700">{esc.daysPastDue} days past due</Badge>
                        <Badge variant="outline" className="text-xs">{esc.state}</Badge>
                        {esc.interest > 0 && <Badge className="text-xs bg-blue-100 text-blue-700">+${esc.interest.toFixed(2)} interest</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{esc.job.address}</p>
                      {esc.job.insurance_carrier && <p className="text-xs text-muted-foreground">Carrier: {esc.job.insurance_carrier}</p>}
                      <div className="flex items-center gap-4 mt-2 text-sm">
                        <span>Balance: <strong>${esc.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></span>
                        <span>+Interest: <strong className="text-blue-600">${esc.interest.toFixed(2)}</strong></span>
                        <span>Total: <strong className="text-red-600">${totalDue.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <Button size="sm" className="text-xs bg-red-600 hover:bg-red-700 text-white" onClick={() => generateDemandLetter(esc)} data-testid={`button-demand-${esc.inv.id}`}>
                        <FileText className="h-3 w-3 mr-1" /> Demand Letter
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs" onClick={() => setExpandedJob(isExpanded ? null : esc.inv.id)} data-testid={`button-expand-${esc.inv.id}`}>
                        {isExpanded ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                        Statutes
                      </Button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t space-y-1">
                      {esc.statutes.map((s: any) => (
                        <p key={s.code} className="text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">{s.code}:</span> {s.desc}
                        </p>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
