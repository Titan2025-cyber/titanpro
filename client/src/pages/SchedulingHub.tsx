import { Grid3x3, BellRing, ListChecks } from "lucide-react";
import HubShell from "@/components/HubShell";
import DispatchMatrix from "@/pages/DispatchMatrix";
import AppointmentReminders from "@/pages/AppointmentReminders";
import DepartureChecklist from "@/pages/DepartureChecklist";

// Dispatch hub. Renamed from "Scheduling & Dispatch" — the Schedule
// Calendar was promoted to a standalone Core sidebar entry (/scheduling)
// so this hub now focuses purely on dispatch operations: the dispatch
// matrix, appointment reminders sent to customers, and the pre-departure
// tech checklist.
export default function SchedulingHub() {
  return (
    <HubShell
      title="Dispatch"
      description="Dispatch matrix, appointment reminders, and departure checklists in one workspace."
      icon={Grid3x3}
      tabs={[
        // "Dispatch Matrix" shortened to just "Dispatch" per user request.
        { value: "dispatch", label: "Dispatch", icon: Grid3x3, component: DispatchMatrix },
        { value: "reminders", label: "Appt Reminders", icon: BellRing, component: AppointmentReminders },
        { value: "departure", label: "Departure Checklist", icon: ListChecks, component: DepartureChecklist },
      ]}
    />
  );
}
