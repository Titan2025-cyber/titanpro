import { Droplets, Wifi, CheckSquare, ClipboardList } from "lucide-react";
import HubShell from "@/components/HubShell";
import IoTDryingDashboard from "@/pages/IoTDryingDashboard";
import PredictiveDrying from "@/pages/PredictiveDrying";
import IICRCCompliance from "@/pages/IICRCCompliance";
import IICRCDeviationLog from "@/pages/IICRCDeviationLog";

export default function DryingComplianceHub() {
  return (
    <HubShell
      title="Drying & Compliance"
      description="Live drying telemetry, predictive drying, and IICRC compliance & deviations together."
      icon={Droplets}
      tabs={[
        { value: "iot", label: "IoT Drying", icon: Wifi, component: IoTDryingDashboard },
        { value: "predictive", label: "Predictive Drying", icon: Droplets, component: PredictiveDrying },
        { value: "iicrc", label: "IICRC Compliance", icon: CheckSquare, component: IICRCCompliance },
        { value: "deviations", label: "Deviation Log", icon: ClipboardList, component: IICRCDeviationLog },
      ]}
    />
  );
}
