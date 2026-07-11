import { Shield, Star, Timer, Gavel, Brain, ShieldAlert } from "lucide-react";
import HubShell from "@/components/HubShell";
import CarrierScorecard from "@/pages/CarrierScorecard";
import CarrierResponseTime from "@/pages/CarrierResponseTime";
import CarrierClaimIntelligence from "@/pages/CarrierClaimIntelligence";
import CarrierCounterIntel from "@/pages/CarrierCounterIntel";
import CarrierEscalationAI from "@/pages/CarrierEscalationAI";

export default function CarrierHub() {
  return (
    <HubShell
      title="Carrier Intelligence"
      description="Everything about insurance carriers in one place — scorecards, response times, claim intel, counter-intel, and escalation."
      icon={Shield}
      tabs={[
        { value: "scorecard", label: "Scorecard", icon: Star, component: CarrierScorecard },
        { value: "response-time", label: "Response Times", icon: Timer, component: CarrierResponseTime },
        { value: "claim-intel", label: "Claim Intel", icon: Brain, component: CarrierClaimIntelligence },
        { value: "counter-intel", label: "Counter-Intel", icon: ShieldAlert, component: CarrierCounterIntel },
        { value: "escalation", label: "Escalation AI", icon: Gavel, component: CarrierEscalationAI },
      ]}
    />
  );
}
