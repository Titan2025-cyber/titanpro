import { Handshake, LayoutDashboard, TrendingUp, Target, Award, Gem } from "lucide-react";
import HubShell from "@/components/HubShell";
import ReferralDashboard from "@/pages/ReferralDashboard";
import ReferralProfitability from "@/pages/ReferralProfitability";
import PartnerROI from "@/pages/PartnerROI";
import PartnerScorecard from "@/pages/PartnerScorecard";
import PartnerValueDashboard from "@/pages/PartnerValueDashboard";

export default function PartnerHub() {
  return (
    <HubShell
      title="Referrals & Partners"
      description="Referral dashboard, referral profitability, partner ROI, scorecards, and partner value in one workspace."
      icon={Handshake}
      tabs={[
        { value: "value", label: "Partner Value", icon: Gem, component: PartnerValueDashboard },
        { value: "referrals", label: "Referral Dashboard", icon: LayoutDashboard, component: ReferralDashboard },
        { value: "referral-profit", label: "Referral Profitability", icon: TrendingUp, component: ReferralProfitability },
        { value: "roi", label: "Partner ROI", icon: Target, component: PartnerROI },
        { value: "scorecard", label: "Scorecard", icon: Award, component: PartnerScorecard },
      ]}
    />
  );
}
