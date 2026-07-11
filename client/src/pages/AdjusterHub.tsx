import { UserRound, Search, Shield, GraduationCap } from "lucide-react";
import HubShell from "@/components/HubShell";
import AdjusterDB from "@/pages/AdjusterDB";
import AdjusterProfiler from "@/pages/AdjusterProfiler";
import AdjusterPortal from "@/pages/AdjusterPortal";
import AdjusterCE from "@/pages/AdjusterCE";

export default function AdjusterHub() {
  return (
    <HubShell
      title="Adjusters"
      description="Adjuster database, behavioral profiler, portal, and CE tracking — all in one hub."
      icon={UserRound}
      tabs={[
        { value: "database", label: "Database", icon: Search, component: AdjusterDB },
        { value: "profiler", label: "Profiler", icon: UserRound, component: AdjusterProfiler },
        { value: "portal", label: "Portal", icon: Shield, component: AdjusterPortal },
        { value: "ce", label: "CE Portal", icon: GraduationCap, component: AdjusterCE },
      ]}
    />
  );
}
