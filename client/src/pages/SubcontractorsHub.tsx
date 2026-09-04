import { HardHat, Shield } from "lucide-react";
import HubShell from "@/components/HubShell";
import Subcontractors from "@/pages/Subcontractors";
import COITracker from "@/pages/COITracker";

export default function SubcontractorsHub() {
  return (
    <HubShell
      title="Subcontractors"
      description="The full subcontractor compliance vault — sub roster, docs (COI, W-9, WC), plus company-wide COI & license expiration tracker."
      icon={HardHat}
      tabs={[
        { value: "roster", label: "Roster", icon: HardHat, component: Subcontractors },
        { value: "coi", label: "COI & Licenses", icon: Shield, component: COITracker },
      ]}
    />
  );
}
