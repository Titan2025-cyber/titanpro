import { CreditCard, Clock, PhoneCall, FileText, MailWarning, Scale } from "lucide-react";
import HubShell from "@/components/HubShell";
import ARaging from "@/pages/ARaging";
import ARFollowUp from "@/pages/ARFollowUp";
import CarrierARIntelligence from "@/pages/CarrierARIntelligence";
import StatuteDemandLetter from "@/pages/StatuteDemandLetter";
import PaymentReminders from "@/pages/PaymentReminders";
import Reconciliation from "@/pages/Reconciliation";

export default function ARHub() {
  return (
    <HubShell
      title="Accounts Receivable"
      description="A/R aging, follow-up, carrier A/R intelligence, and statute demand letters together."
      icon={CreditCard}
      tabs={[
        { value: "aging", label: "A/R Aging", icon: Clock, component: ARaging },
        { value: "followup", label: "Follow-Up", icon: PhoneCall, component: ARFollowUp },
        { value: "reminders", label: "Payment Reminders", icon: MailWarning, component: PaymentReminders },
        { value: "reconciliation", label: "Reconciliation", icon: Scale, component: Reconciliation },
        { value: "carrier-ar", label: "Carrier A/R", icon: CreditCard, component: CarrierARIntelligence },
        { value: "statute", label: "Statute Demand", icon: FileText, component: StatuteDemandLetter },
      ]}
    />
  );
}
