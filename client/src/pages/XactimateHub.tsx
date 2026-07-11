import { ScanLine, Upload, AlertTriangle, Bot } from "lucide-react";
import HubShell from "@/components/HubShell";
import XactimateImport from "@/pages/XactimateImport";
import XactimateAlert from "@/pages/XactimateAlert";
import XactAudit from "@/pages/XactAudit";
import AIEstimateReview from "@/pages/AIEstimateReview";

export default function XactimateHub() {
  return (
    <HubShell
      title="Xactimate"
      description="Import, monitor, audit, and AI-review Xactimate estimates from a single workspace."
      icon={ScanLine}
      tabs={[
        { value: "import", label: "Import", icon: Upload, component: XactimateImport },
        { value: "alerts", label: "Alerts", icon: AlertTriangle, component: XactimateAlert },
        { value: "audit", label: "Audit", icon: ScanLine, component: XactAudit },
        { value: "ai-review", label: "AI Review", icon: Bot, component: AIEstimateReview },
      ]}
    />
  );
}
