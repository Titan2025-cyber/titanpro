import { Megaphone, Sparkles, CloudLightning, Radar, Target, Handshake } from "lucide-react";
import HubShell from "@/components/HubShell";
import MarketingRollup from "@/components/MarketingRollup";
import Marketing from "@/pages/Marketing";
import MarketingSuite from "@/pages/MarketingSuite";
import StormMarketing from "@/pages/StormMarketing";
import StormCAT from "@/pages/StormCAT";
import ConversionRate from "@/pages/ConversionRate";
import ReferralNurture from "@/pages/ReferralNurture";

export default function MarketingHub() {
  return (
    <div>
      <MarketingRollup />
      <HubShell
        title="Marketing"
        description="Marketing overview, the full marketing suite, storm marketing, and storm CAT tracking together."
        icon={Megaphone}
        tabs={[
          { value: "overview", label: "Marketing", icon: Megaphone, component: Marketing },
          { value: "conversion", label: "Conversion", icon: Target, component: ConversionRate },
          { value: "suite", label: "Marketing Suite", icon: Sparkles, component: MarketingSuite },
          { value: "nurture", label: "Referral Nurture", icon: Handshake, component: ReferralNurture },
          { value: "storm", label: "Storm Marketing", icon: CloudLightning, component: StormMarketing },
          { value: "storm-cat", label: "Storm CAT", icon: Radar, component: StormCAT },
        ]}
      />
    </div>
  );
}
