import {
  FileCheck, Zap, Clock, Bot, FileSearch,
  Scale, ClipboardCheck, Library, BookOpen, Gavel, Target,
} from "lucide-react";
import HubShell from "@/components/HubShell";
import Supplements from "@/pages/Supplements";
import SupplementAutoDraft from "@/pages/SupplementAutoDraft";
import SupplementTracker from "@/pages/SupplementTracker";
import AISupplementEngine from "@/pages/AISupplementEngine";
import SupplementAuditAI from "@/pages/SupplementAuditAI";
import OPRebuttal from "@/pages/OPRebuttal";
import GeneralConditions from "@/pages/GeneralConditions";
import ApprovedClaimsLibrary from "@/pages/ApprovedClaimsLibrary";
import CustomerClaimExplainer from "@/pages/CustomerClaimExplainer";
import SubrogationTracker from "@/pages/SubrogationTracker";
import CompetitiveBidIntel from "@/pages/CompetitiveBidIntel";

export default function SupplementHub() {
  return (
    <HubShell
      title="Supplements & Claim Tools"
      description="Draft, track, audit, and defend supplements in one workspace. Includes O&P rebuttals, general conditions, approved-claims library, file checker, customer explainer, subrogation, and competitive bid intel."
      icon={FileCheck}
      tabs={[
        { value: "active", label: "Active", icon: FileCheck, component: Supplements },
        { value: "draft", label: "AI Draft", icon: Zap, component: SupplementAutoDraft },
        { value: "tracker", label: "Tracker", icon: Clock, component: SupplementTracker },
        { value: "engine", label: "AI Engine", icon: Bot, component: AISupplementEngine },
        { value: "audit", label: "Audit AI", icon: FileSearch, component: SupplementAuditAI },
        { value: "op-rebuttal", label: "O&P Rebuttal", icon: Scale, component: OPRebuttal },
        { value: "general-conditions", label: "Gen. Conditions", icon: ClipboardCheck, component: GeneralConditions },
        { value: "approved-claims", label: "Approved Library", icon: Library, component: ApprovedClaimsLibrary },
        { value: "explainer", label: "Customer Explainer", icon: BookOpen, component: CustomerClaimExplainer },
        { value: "subrogation", label: "Subrogation", icon: Gavel, component: SubrogationTracker },
        { value: "bid-intel", label: "Bid Intel", icon: Target, component: CompetitiveBidIntel },
      ]}
    />
  );
}
