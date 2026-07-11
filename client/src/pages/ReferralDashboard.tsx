import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { TrendingUp, Users, DollarSign, Briefcase, Award, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Contact, Job, PayoutRequest } from "@shared/schema";

export default function ReferralDashboard() {
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: payouts = [] } = useQuery<PayoutRequest[]>({ queryKey: ["/api/payout-requests"] });

  const partners = contacts.filter(c => c.type === "referral");

  const getPartnerStats = (partner: Contact) => {
    const partnerJobs = jobs.filter(j => j.contactId === partner.id || (j.leadSourceDetail || "").toLowerCase().includes(partner.name.toLowerCase()));
    const partnerPayouts = payouts.filter(p => p.contactId === partner.id);
    const totalPaid = partnerPayouts.filter(p => p.status === "paid").reduce((s, p) => s + (p.amount || 0), 0);
    const pendingPayout = partnerPayouts.filter(p => p.status === "pending").reduce((s, p) => s + (p.amount || 0), 0);
    const completedJobs = partnerJobs.filter(j => j.status === "complete" || j.status === "closed");
    return { jobs: partnerJobs.length, completedJobs: completedJobs.length, totalPaid, pendingPayout };
  };

  // Overall stats
  const totalPartners = partners.length;
  const totalReferralJobs = jobs.filter(j => j.leadSource === "referral").length;
  const totalPaidOut = payouts.filter(p => p.status === "paid").reduce((s, p) => s + (p.amount || 0), 0);
  const totalPending = payouts.filter(p => p.status === "pending").reduce((s, p) => s + (p.amount || 0), 0);

  // Top performers (by jobs)
  const ranked = partners
    .map(p => ({ partner: p, stats: getPartnerStats(p) }))
    .sort((a, b) => b.stats.jobs - a.stats.jobs);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-[hsl(var(--titan-blue))]" />Referral Partner Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">Self-service partner performance overview and payout tracking</p>
      </div>

      {/* Overview KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Active Partners", value: totalPartners, icon: Users, color: "text-[hsl(var(--titan-blue))] bg-[hsl(var(--titan-blue)/0.1)]", sub: "referring contacts" },
          { label: "Referral Jobs", value: totalReferralJobs, icon: Briefcase, color: "text-purple-600 bg-purple-100", sub: "jobs attributed" },
          { label: "Total Paid Out", value: `$${totalPaidOut.toLocaleString()}`, icon: DollarSign, color: "text-green-600 bg-green-100", sub: "to all partners" },
          { label: "Pending Payouts", value: `$${totalPending.toLocaleString()}`, icon: ArrowUpRight, color: "text-orange-600 bg-orange-100", sub: "awaiting approval" },
        ].map(kpi => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{kpi.label}</p>
                    <p className="text-2xl font-bold text-foreground mt-1">{kpi.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{kpi.sub}</p>
                  </div>
                  <div className={`p-2 rounded-lg ${kpi.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Partner Leaderboard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Award className="w-4 h-4 text-yellow-500" />Partner Leaderboard
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {ranked.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No referral partners added yet. Add partners in the Contacts module.
            </div>
          ) : (
            <div className="divide-y">
              {ranked.map(({ partner, stats }, i) => (
                <div key={partner.id} className="flex items-center gap-4 px-4 py-3" data-testid={`partner-row-${partner.id}`}>
                  {/* Rank */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                    i === 0 ? "bg-yellow-100 text-yellow-700" :
                    i === 1 ? "bg-gray-100 text-gray-700" :
                    i === 2 ? "bg-orange-100 text-orange-700" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {i + 1}
                  </div>

                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-[hsl(var(--titan-blue))] flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {partner.name.charAt(0)}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm text-foreground">{partner.name}</p>
                      {partner.company && <Badge variant="outline" className="text-xs">{partner.company}</Badge>}
                      {partner.referralRate && (
                        <span className="text-xs text-muted-foreground">{partner.referralRate}% rate</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{partner.email || partner.phone || "No contact info"}</p>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-6 shrink-0">
                    <div className="text-center">
                      <p className="text-lg font-bold text-foreground">{stats.jobs}</p>
                      <p className="text-xs text-muted-foreground">Jobs</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-green-600">${stats.totalPaid.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Paid Out</p>
                    </div>
                    <div className="text-center">
                      <p className={`text-lg font-bold ${stats.pendingPayout > 0 ? "text-orange-600" : "text-muted-foreground"}`}>
                        ${stats.pendingPayout.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">Pending</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Payout Activity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-green-600" />Recent Payout Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {payouts.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">No payout requests yet.</div>
          ) : (
            <div className="divide-y">
              {payouts.slice(0, 10).map((p: any) => {
                const contact = contacts.find(c => c.id === p.contactId);
                return (
                  <div key={p.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
                        {contact?.name?.charAt(0) || "?"}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{contact?.name || "Unknown"}</p>
                        <p className="text-xs text-muted-foreground">{p.description || `Job #${p.jobId || "—"}`}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-sm">${(p.amount || 0).toLocaleString()}</span>
                      <Badge variant={p.status === "paid" ? "default" : p.status === "approved" ? "secondary" : "outline"}>
                        {p.status}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
