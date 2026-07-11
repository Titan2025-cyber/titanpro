import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trophy, DollarSign, Users, Heart, TrendingUp } from "lucide-react";

export default function PartnerValueDashboard() {
  const { data: contacts = [] } = useQuery<any[]>({ queryKey: ["/api/contacts"], queryFn: () => apiRequest("GET", "/api/contacts").then(r => r.json()) });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("GET", "/api/jobs").then(r => r.json()) });
  const { data: payouts = [] } = useQuery<any[]>({ queryKey: ["/api/payout-requests"], queryFn: () => apiRequest("GET", "/api/payout-requests").then(r => r.json()) });
  const { data: invoices = [] } = useQuery<any[]>({ queryKey: ["/api/invoices"], queryFn: () => apiRequest("GET", "/api/invoices").then(r => r.json()) });

  const partners = (contacts as any[]).filter(c => c.type === "partner" || c.type === "referral");

  const partnerStats = partners.map(p => {
    const partnerJobs = (jobs as any[]).filter(j => j.contactId === p.id || j.referralPartnerId === p.id);
    const partnerPayouts = (payouts as any[]).filter(pr => pr.contactId === p.id);
    const totalRevenue = partnerJobs.reduce((s: number, j: any) => {
      const jobInvoices = (invoices as any[]).filter(inv => inv.jobId === j.id);
      return s + jobInvoices.reduce((ss: number, inv: any) => ss + Number(inv.total || 0), 0);
    }, 0);
    const totalPaid = partnerPayouts.filter((pr:any) => pr.status === "paid").reduce((s:number, pr:any) => s + Number(pr.amount||0), 0);
    const daysPartner = Math.floor((new Date().getTime() - new Date(p.createdAt || "2024-01-01").getTime()) / 86400000);
    return { partner: p, jobCount: partnerJobs.length, totalRevenue, totalPaid, daysPartner };
  }).sort((a,b) => b.totalRevenue - a.totalRevenue);

  const totalPartners = partnerStats.length;
  const totalRevGenerated = partnerStats.reduce((s, ps) => s + ps.totalRevenue, 0);
  const totalPaidOut = partnerStats.reduce((s, ps) => s + ps.totalPaid, 0);
  const totalReferrals = partnerStats.reduce((s, ps) => s + ps.jobCount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-blue))] flex items-center justify-center">
          <Trophy className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Partner Value Dashboard</h1>
          <p className="text-sm text-muted-foreground">Lifetime value statements and goodwill tracking</p>
        </div>
      </div>

      {/* Summary overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 text-center">
            <Users className="w-5 h-5 mx-auto mb-1 text-[hsl(var(--titan-blue))]" />
            <p className="text-lg font-bold">{totalPartners}</p>
            <p className="text-xs text-muted-foreground">Partners</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <Trophy className="w-5 h-5 mx-auto mb-1 text-[hsl(var(--titan-blue))]" />
            <p className="text-lg font-bold">{totalReferrals}</p>
            <p className="text-xs text-muted-foreground">Total Referrals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <TrendingUp className="w-5 h-5 mx-auto mb-1 text-[hsl(var(--titan-blue))]" />
            <p className="text-lg font-bold">${totalRevGenerated.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Rev Generated</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <DollarSign className="w-5 h-5 mx-auto mb-1 text-[hsl(var(--titan-blue))]" />
            <p className="text-lg font-bold">${totalPaidOut.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Paid Out</p>
          </CardContent>
        </Card>
      </div>

      {/* Partner list */}
      <div className="space-y-3">
        {partnerStats.length === 0 ? (
          <Card><CardContent className="pt-6 text-center text-sm text-muted-foreground">No partner contacts found. Add contacts with type "partner" to see stats here.</CardContent></Card>
        ) : partnerStats.map((ps, i) => (
          <Card key={i} className="overflow-hidden">
            <CardContent className="pt-4">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{ps.partner.name}</span>
                    <Badge variant="outline" className="text-xs">{ps.daysPartner}d partnership</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{ps.partner.company || ps.partner.phone}</p>
                </div>
                <div className="flex items-center gap-3 text-center">
                  <div><p className="text-lg font-bold">{ps.jobCount}</p><p className="text-[10px] text-muted-foreground">Referrals</p></div>
                  <div><p className="text-lg font-bold">${ps.totalRevenue.toLocaleString()}</p><p className="text-[10px] text-muted-foreground">Rev Generated</p></div>
                  <div><p className="text-lg font-bold">${ps.totalPaid.toLocaleString()}</p><p className="text-[10px] text-muted-foreground">Paid Out</p></div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" className="text-xs">View Jobs</Button>
                <Button size="sm" variant="outline" className="text-xs">Send Update</Button>
                <Button size="sm" variant="outline" className="text-xs"><Heart className="w-3 h-3 mr-1" />Log Goodwill</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
