import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Handshake, Copy, Mail, Clock, TrendingUp, CheckCircle2 } from "lucide-react";

function fmtCurrency(v: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v || 0);
}

const DORMANT_DAYS = 60;

export default function ReferralNurture() {
  const { toast } = useToast();
  const [recapPartner, setRecapPartner] = useState<any>(null);
  const [recapText, setRecapText] = useState("");

  const { data: roi = [] } = useQuery<any[]>({ queryKey: ["/api/reports/partner-roi"] });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });
  const { data: payouts = [] } = useQuery<any[]>({ queryKey: ["/api/payout-requests"] });
  const { data: nurtureLog = [] } = useQuery<any[]>({ queryKey: ["/api/referral-nurture"] });

  const logMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/referral-nurture", payload),
    onSuccess: (_d, payload: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/referral-nurture"] });
      toast({ title: payload.kind === "dormant_reminder" ? "Reminder logged" : "Recap logged as sent" });
    },
  });

  const now = Date.now();
  const period = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });

  // Latest activity date per partner (jobs referred or payouts).
  const lastActivity = (partnerId: number): number | null => {
    const dates: number[] = [];
    for (const j of jobs as any[]) {
      if (j.referralPartnerId === partnerId && j.createdAt) dates.push(new Date(j.createdAt).getTime());
    }
    for (const p of payouts as any[]) {
      if (p.contactId === partnerId) {
        const d = p.paidAt || p.createdAt;
        if (d) dates.push(new Date(d).getTime());
      }
    }
    if (dates.length === 0) return null;
    return Math.max(...dates);
  };

  const partners = (roi as any[]).map((r: any) => {
    const last = lastActivity(r.partnerId);
    const daysSince = last == null ? null : Math.floor((now - last) / 86400000);
    const dormant = last == null || (daysSince != null && daysSince >= DORMANT_DAYS);
    const logs = (nurtureLog as any[]).filter((l: any) => l.contactId === r.partnerId);
    return { ...r, last, daysSince, dormant, logs };
  });

  const totalRevenue = partners.reduce((s, p) => s + (p.totalRevenue || 0), 0);
  const totalPaid = partners.reduce((s, p) => s + (p.totalPaid || 0), 0);
  const dormantCount = partners.filter((p) => p.dormant && p.jobsReferred > 0).length;

  const buildRecap = (p: any): string => {
    return `Subject: Your ${period} referral recap — Titan Restoration LLC

Hi ${p.partner},

Thank you for being a trusted referral partner. Here's a quick look at the business we've exchanged:

• Jobs referred: ${p.jobsReferred}
• Revenue generated: ${fmtCurrency(p.totalRevenue)}
• Payouts earned: ${fmtCurrency(p.totalPaid)}

We truly appreciate your partnership and are ready to take great care of any client you send our way. Crews are standing by across the Augusta / Aiken area.

If you have anyone who needs restoration help, just reply or call 706-922-0154.

Gratefully,
Cody Brantley
Titan Restoration LLC
706-922-0154
titanrestorationllc.com`;
  };

  const openRecap = (p: any) => { setRecapPartner(p); setRecapText(buildRecap(p)); };

  const copyRecap = async () => {
    try { await navigator.clipboard.writeText(recapText); toast({ title: "Recap copied", description: "Draft copied — no email was sent." }); }
    catch (_) { toast({ title: "Copy failed", variant: "destructive" }); }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <span className="tp-page-eyebrow">Partnerships</span>
        <h1 className="text-2xl font-bold tracking-tight tp-gradient-text">Referral Nurture</h1>
        <p className="text-sm text-muted-foreground">Keep referral partners warm with monthly recaps and dormant-partner reminders.</p>
      </div>
      <hr className="tp-rule" />

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Active Partners</p><p className="text-xl font-bold" data-testid="stat-partners">{partners.filter(p => p.jobsReferred > 0).length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Revenue Driven</p><p className="text-xl font-bold text-green-600" data-testid="stat-revenue">{fmtCurrency(totalRevenue)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Payouts Earned</p><p className="text-xl font-bold" data-testid="stat-payouts">{fmtCurrency(totalPaid)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Dormant ({DORMANT_DAYS}d+)</p><p className="text-xl font-bold text-amber-600" data-testid="stat-dormant">{dormantCount}</p></CardContent></Card>
      </div>

      {/* Dormant partners */}
      {dormantCount > 0 && (
        <Card className="border-amber-300">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500" />Dormant Partners — Re-engage</CardTitle>
            <p className="text-xs text-muted-foreground">No referred jobs or payouts in {DORMANT_DAYS}+ days.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {partners.filter(p => p.dormant && p.jobsReferred > 0).map((p) => (
              <div key={p.partnerId} className="flex items-center justify-between bg-muted/20 rounded px-3 py-2" data-testid={`dormant-${p.partnerId}`}>
                <div>
                  <p className="text-sm font-medium">{p.partner}</p>
                  <p className="text-xs text-muted-foreground">{p.daysSince == null ? "No recorded activity" : `${p.daysSince} days since last activity`} · {p.jobsReferred} jobs lifetime</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => logMutation.mutate({ contactId: p.partnerId, kind: "dormant_reminder", period })} disabled={logMutation.isPending} data-testid={`button-remind-${p.partnerId}`}>
                  <Mail className="w-3.5 h-3.5 mr-1" />Send reminder
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Partner ranking */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[hsl(var(--titan-blue))]" />Partners by Revenue Driven</CardTitle></CardHeader>
        <CardContent>
          {partners.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No referral partners yet. Add contacts with type "referral" and attribute jobs to them.</p>
          ) : (
            <div className="divide-y">
              {partners.map((p) => {
                const lastLog = p.logs[0];
                return (
                  <div key={p.partnerId} className="py-3 flex items-center justify-between gap-3 flex-wrap" data-testid={`partner-${p.partnerId}`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{p.partner}</span>
                        {p.company && <span className="text-xs text-muted-foreground">{p.company}</span>}
                        {p.dormant && p.jobsReferred > 0 && <Badge variant="outline" className="text-xs border-amber-300 text-amber-600">Dormant</Badge>}
                        {lastLog && <Badge variant="outline" className="text-xs border-green-300 text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{lastLog.kind === "dormant_reminder" ? "Reminded" : "Recap sent"}</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{p.jobsReferred} jobs · {fmtCurrency(p.totalRevenue)} revenue · {fmtCurrency(p.totalPaid)} paid</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openRecap(p)} data-testid={`button-recap-${p.partnerId}`}>
                      <Mail className="w-3.5 h-3.5 mr-1" />Generate recap
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recap dialog */}
      <Dialog open={!!recapPartner} onOpenChange={(o) => !o && setRecapPartner(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Monthly Recap — {recapPartner?.partner}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Textarea value={recapText} onChange={(e) => setRecapText(e.target.value)} className="min-h-[280px] text-xs font-mono" data-testid="input-recap" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={copyRecap} data-testid="button-copy-recap"><Copy className="w-4 h-4 mr-2" />Copy</Button>
              <Button onClick={() => { logMutation.mutate({ contactId: recapPartner.partnerId, kind: "monthly_recap", period }); setRecapPartner(null); }} disabled={logMutation.isPending} data-testid="button-log-recap">
                Log as sent
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
