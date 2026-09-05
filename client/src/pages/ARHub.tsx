import { CreditCard, Clock, PhoneCall, FileText, MailWarning, Scale, CalendarDays } from "lucide-react";
import HubShell from "@/components/HubShell";
import ARaging from "@/pages/ARaging";
import ARFollowUp from "@/pages/ARFollowUp";
import CarrierARIntelligence from "@/pages/CarrierARIntelligence";
import StatuteDemandLetter from "@/pages/StatuteDemandLetter";
import PaymentReminders from "@/pages/PaymentReminders";
import Reconciliation from "@/pages/Reconciliation";
import CashFlowCalendar from "@/pages/CashFlowCalendar";

export default function ARHub() {
  return (
    <HubShell
      title="Accounts Receivable"
      description="A/R aging, cash flow, follow-up, carrier A/R intelligence, and statute demand letters together."
      icon={CreditCard}
      tabs={[
        { value: "aging", label: "A/R Aging", icon: Clock, component: ARaging },
        // 13-week rolling cash-flow view moved from its own sidebar entry
        // (/cash-flow) into this hub. The standalone route still resolves
        // for anyone with a bookmark.
        { value: "cash-flow", label: "Cash Flow", icon: CalendarDays, component: CashFlowCalendar },
        { value: "followup", label: "Follow-Up", icon: PhoneCall, component: ARFollowUp },
        { value: "reminders", label: "Payment Reminders", icon: MailWarning, component: PaymentReminders },
        { value: "reconciliation", label: "Reconciliation", icon: Scale, component: Reconciliation },
        { value: "carrier-ar", label: "Carrier A/R", icon: CreditCard, component: CarrierARIntelligence },
        { value: "statute", label: "Statute Demand", icon: FileText, component: StatuteDemandLetter },
      ]}
    />
  );
}
