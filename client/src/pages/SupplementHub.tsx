import { FileCheck, Zap, Clock, Bot, FileSearch } from "lucide-react";
import HubShell from "@/components/HubShell";
import Supplements from "@/pages/Supplements";
import SupplementAutoDraft from "@/pages/SupplementAutoDraft";
import SupplementTracker from "@/pages/SupplementTracker";
import AISupplementEngine from "@/pages/AISupplementEngine";
import SupplementAuditAI from "@/pages/SupplementAuditAI";

export default function SupplementHub() {
  return (
    <HubShell
      title="Supplements"
      description="Draft, track, and audit supplements in one workspace — no more jumping between modules for a single supplement."
      icon={FileCheck}
      tabs={[
        { value: "active", label: "Active", icon: FileCheck, component: Supplements },
        { value: "draft", label: "AI Draft", icon: Zap, component: SupplementAutoDraft },
        { value: "tracker", label: "Tracker", icon: Clock, component: SupplementTracker },
        { value: "engine", label: "AI Engine", icon: Bot, component: AISupplementEngine },
        { value: "audit", label: "Audit AI", icon: FileSearch, component: SupplementAuditAI },
      ]}
    />
  );
}
