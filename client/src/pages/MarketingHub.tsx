import { Megaphone, Sparkles, CloudLightning, Radar, Target } from "lucide-react";
import HubShell from "@/components/HubShell";
import Marketing from "@/pages/Marketing";
import MarketingSuite from "@/pages/MarketingSuite";
import StormMarketing from "@/pages/StormMarketing";
import StormCAT from "@/pages/StormCAT";
import ConversionRate from "@/pages/ConversionRate";

export default function MarketingHub() {
  return (
    <HubShell
      title="Marketing"
      description="Marketing overview, the full marketing suite, storm marketing, and storm CAT tracking together."
      icon={Megaphone}
      tabs={[
        { value: "overview", label: "Marketing", icon: Megaphone, component: Marketing },
        { value: "conversion", label: "Conversion", icon: Target, component: ConversionRate },
        { value: "suite", label: "Marketing Suite", icon: Sparkles, component: MarketingSuite },
        { value: "storm", label: "Storm Marketing", icon: CloudLightning, component: StormMarketing },
        { value: "storm-cat", label: "Storm CAT", icon: Radar, component: StormCAT },
      ]}
    />
  );
}
