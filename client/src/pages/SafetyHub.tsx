import { ShieldAlert, ClipboardCheck, AlertTriangle } from "lucide-react";
import HubShell from "@/components/HubShell";
import Safety from "@/pages/Safety";
import SafetyChecklist from "@/pages/SafetyChecklist";
import HazmatFlags from "@/pages/HazmatFlags";

export default function SafetyHub() {
  return (
    <HubShell
      title="Safety"
      description="Safety log, pre-job checklists, and hazmat flags in one workspace."
      icon={ShieldAlert}
      tabs={[
        { value: "log", label: "Safety Log", icon: ShieldAlert, component: Safety },
        { value: "checklist", label: "Checklist", icon: ClipboardCheck, component: SafetyChecklist },
        { value: "hazmat", label: "Hazmat Flags", icon: AlertTriangle, component: HazmatFlags },
      ]}
    />
  );
}
