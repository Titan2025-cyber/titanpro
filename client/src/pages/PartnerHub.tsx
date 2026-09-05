import { Handshake, LayoutDashboard, Award } from "lucide-react";
import HubShell from "@/components/HubShell";
import ReferralDashboard from "@/pages/ReferralDashboard";
import PartnerScorecard from "@/pages/PartnerScorecard";

// Partner Hub simplified from 5 tabs down to 2 the operator actually uses:
//   Overview  — the referral dashboard (jobs / revenue / who sent what)
//   Scorecard — per-partner deep dive (value, ROI, profitability)
//
// Deprecated tabs (PartnerValueDashboard, ReferralProfitability, PartnerROI)
// remain as files so their routes/imports still resolve if referenced from
// dashboards or emails; they just aren't in the sidebar/nav anymore.
export default function PartnerHub() {
  return (
    <HubShell
      title="Referrals & Partners"
      description="One overview of referral activity, one deep-dive per partner."
      icon={Handshake}
      tabs={[
        { value: "overview", label: "Overview", icon: LayoutDashboard, component: ReferralDashboard },
        { value: "scorecard", label: "Partner Scorecard", icon: Award, component: PartnerScorecard },
      ]}
    />
  );
}
