import { CalendarClock, Grid3x3, BellRing, ListChecks } from "lucide-react";
import HubShell from "@/components/HubShell";
import Scheduling from "@/pages/Scheduling";
import DispatchMatrix from "@/pages/DispatchMatrix";
import AppointmentReminders from "@/pages/AppointmentReminders";
import DepartureChecklist from "@/pages/DepartureChecklist";

export default function SchedulingHub() {
  return (
    <HubShell
      title="Scheduling & Dispatch"
      description="Schedule, dispatch matrix, appointment reminders, and departure checklists in one workspace."
      icon={CalendarClock}
      tabs={[
        { value: "schedule", label: "Schedule", icon: CalendarClock, component: Scheduling },
        { value: "dispatch", label: "Dispatch Matrix", icon: Grid3x3, component: DispatchMatrix },
        { value: "reminders", label: "Appt Reminders", icon: BellRing, component: AppointmentReminders },
        { value: "departure", label: "Departure Checklist", icon: ListChecks, component: DepartureChecklist },
      ]}
    />
  );
}
