import { Megaphone, CloudLightning, Target } from "lucide-react";
import HubShell from "@/components/HubShell";
import MarketingRollup from "@/components/MarketingRollup";
import Marketing from "@/pages/Marketing";
import StormMarketing from "@/pages/StormMarketing";
import StormCAT from "@/pages/StormCAT";
import ConversionRate from "@/pages/ConversionRate";

// Marketing Hub flattened from 6 tabs to 3. Retired:
//   • Marketing Suite  — its templates now live inside Marketing > Social Posts
//   • Referral Nurture — dormant-partner list moved to Partner Overview
// Storm Marketing and Storm CAT merged into one "Storm" tab with sub-sections.
// Files kept on disk so any deep links still resolve; sidebar/nav no longer
// surfaces them.
function StormTab() {
  return (
    <div className="space-y-6">
      <StormCAT />
      <StormMarketing />
    </div>
  );
}

export default function MarketingHub() {
  return (
    <div>
      <MarketingRollup />
      <HubShell
        title="Marketing"
        description="Compose, track conversions, and run storm response — all in one place."
        icon={Megaphone}
        tabs={[
          { value: "compose", label: "Compose", icon: Megaphone, component: Marketing },
          { value: "conversion", label: "Conversion", icon: Target, component: ConversionRate },
          { value: "storm", label: "Storm Response", icon: CloudLightning, component: StormTab },
        ]}
      />
    </div>
  );
}
