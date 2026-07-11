import { HardHat, User, GraduationCap, Award, Zap } from "lucide-react";
import HubShell from "@/components/HubShell";
import Technician from "@/pages/Technician";
import TechDailySummary from "@/pages/TechDailySummary";
import TechLMS from "@/pages/TechLMS";
import TechScorecard from "@/pages/TechScorecard";
import CertTracker from "@/pages/CertTracker";
import TechCoach from "@/pages/TechCoach";

export default function TechnicianHub() {
  return (
    <HubShell
      title="Technicians"
      description="Everything for your crew — daily summaries, training, scorecards, certifications, and AI coaching in one place."
      icon={HardHat}
      tabs={[
        { value: "technician", label: "Technicians", icon: HardHat, component: Technician },
        { value: "daily", label: "Daily Summary", icon: User, component: TechDailySummary },
        { value: "scorecard", label: "Scorecard", icon: Award, component: TechScorecard },
        { value: "lms", label: "Training (LMS)", icon: GraduationCap, component: TechLMS },
        { value: "certs", label: "Certifications", icon: GraduationCap, component: CertTracker },
        { value: "coach", label: "AI Coach", icon: Zap, component: TechCoach },
      ]}
    />
  );
}
