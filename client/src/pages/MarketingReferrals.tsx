// MarketingReferrals.tsx
//
// Consolidated Referrals tab for the Marketing Hub. Absorbs three previously
// scattered pages into one scrollable surface:
//   • Referral Dashboard (partner list + payouts)
//   • Referral Nurture (dormant-partner nurture cadence)
//   • Referral Profitability (quality scores + ROI)
//
// Push 6 #11: Added Property Manager cadence panel at top. PMs need a
// different rhythm than realtor/agent partners — quarterly touches, seasonal
// tips, post-storm proactive checks — and seed a dedicated pm_quarterly
// follow-up sequence when the rep taps Start cadence.

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import ReferralNurture from "@/pages/ReferralNurture";
import ReferralDashboard from "@/pages/ReferralDashboard";
import ReferralProfitability from "@/pages/ReferralProfitability";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Handshake, Home, PlayCircle } from "lucide-react";

// ── Property Manager cadence panel (Push 6 #11) ─────────────────────────
// Lists contacts of type=property_manager. Each row shows current PM
// sequence status and a Start cadence button that seeds four quarterly
// touches into follow_up_sequences.

function PMCadencePanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: contacts = [] } = useQuery<any[]>({ queryKey: ["/api/contacts"] });
  const { data: followUps = [] } = useQuery<any[]>({ queryKey: ["/api/follow-ups"] });

  const pms = useMemo(
    () => (contacts as any[]).filter((c) => c.type === "property_manager"),
    [contacts],
  );

  // Index existing pm_% sequences per contact
  const pmSeqByContact = useMemo(() => {
    const map = new Map<number, any[]>();
    for (const f of followUps as any[]) {
      const t = f.sequence_type ?? f.sequenceType;
      if (!t?.startsWith("pm_")) continue;
      const cid = f.contact_id ?? f.contactId;
      if (!map.has(cid)) map.set(cid, []);
      map.get(cid)!.push(f);
    }
    return map;
  }, [followUps]);

  const startMutation = useMutation({
    mutationFn: (contactId: number) =>
      apiRequest("POST", `/api/contacts/${contactId}/pm-sequence`, {}),
    onSuccess: (_data, contactId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/follow-ups"] });
      toast({
        title: "PM cadence started",
        description: "Four quarterly touches seeded — approve each manually from Marketing → Nurture.",
      });
    },
    onError: (e: any) => {
      let msg = e.message;
      try {
        const parsed = JSON.parse(msg);
        msg = parsed.error || msg;
      } catch {}
      toast({ title: "Couldn't start cadence", description: msg, variant: "destructive" });
    },
  });

  if (pms.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Home className="w-4 h-4" /> Property manager cadence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No property manager contacts yet. Add a contact and set{" "}
            <span className="font-mono text-xs">type = property_manager</span>{" "}
            to enable the quarterly PM cadence. PMs are your highest-value
            referral source — one PM can send 15–30 jobs a year.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Home className="w-4 h-4" /> Property manager cadence
            <Badge variant="secondary" className="text-[10px]">{pms.length}</Badge>
          </CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">
          PMs get a different rhythm than realtors — 4 quarterly touches per year.
          Nothing sends automatically; approve each touch from{" "}
          <a href="/marketing-nurture" className="underline">Nurture</a>.
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {pms.map((pm: any) => {
            const seqs = pmSeqByContact.get(pm.id) || [];
            const pending = seqs.filter((s) => s.status === "pending").length;
            const active = pending > 0;
            return (
              <div
                key={pm.id}
                className="flex items-center gap-3 py-2 border-b last:border-0"
                data-testid={`pm-${pm.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{pm.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {pm.company || "—"} · {pm.email || pm.phone || "no contact info"}
                  </div>
                </div>
                {active ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-[10px]">
                    {pending} touch{pending > 1 ? "es" : ""} pending
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => startMutation.mutate(pm.id)}
                    disabled={startMutation.isPending}
                    data-testid={`start-pm-${pm.id}`}
                  >
                    <PlayCircle className="w-3.5 h-3.5 mr-1" /> Start cadence
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MarketingReferrals() {
  return (
    <div className="space-y-8">
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-4 flex items-start gap-3">
          <Handshake className="w-5 h-5 mt-0.5 text-primary shrink-0" />
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Referral partners drive the
            majority of restoration revenue in CSRA.</span> The nurture queue at the top
            surfaces partners who haven't heard from you in 60+ days — a single lunch
            invite or thank-you note is often the difference between a partner sending
            you three jobs a quarter vs. sending them to a competitor.
          </div>
        </CardContent>
      </Card>

      <section aria-label="Property manager cadence">
        <PMCadencePanel />
      </section>

      <section aria-label="Nurture queue">
        <ReferralNurture />
      </section>

      <section aria-label="Partner dashboard">
        <ReferralDashboard />
      </section>

      <section aria-label="Profitability review">
        <ReferralProfitability />
      </section>
    </div>
  );
}
