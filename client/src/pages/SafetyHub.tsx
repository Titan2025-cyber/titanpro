import { ShieldAlert, ClipboardCheck } from "lucide-react";
import HubShell from "@/components/HubShell";
import Safety from "@/pages/Safety";
import SafetyChecklist from "@/pages/SafetyChecklist";
// HazmatFlags removed as a global tab — lead & asbestos is per-job now
// (JobDetail → Lead & Asbestos tab).

export default function SafetyHub() {
  return (
    <HubShell
      title="Safety"
      description="Safety log and pre-job checklists in one workspace."
      icon={ShieldAlert}
      tabs={[
        { value: "log", label: "Safety Log", icon: ShieldAlert, component: Safety },
        { value: "checklist", label: "Checklist", icon: ClipboardCheck, component: SafetyChecklist },
      ]}
    />
  );
}
