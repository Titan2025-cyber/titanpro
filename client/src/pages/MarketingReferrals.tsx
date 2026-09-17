// MarketingReferrals.tsx
//
// Consolidated Referrals tab for the Marketing Hub. Absorbs three previously
// scattered pages into one scrollable surface:
//   • Referral Dashboard (partner list + payouts)
//   • Referral Nurture (dormant-partner nurture cadence)
//   • Referral Profitability (quality scores + ROI)
//
// Order is intentional: nurture actions first (highest daily-use), then
// partner list, then profitability review. Rep works top-down.

import ReferralNurture from "@/pages/ReferralNurture";
import ReferralDashboard from "@/pages/ReferralDashboard";
import ReferralProfitability from "@/pages/ReferralProfitability";
import { Card, CardContent } from "@/components/ui/card";
import { Handshake } from "lucide-react";

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
