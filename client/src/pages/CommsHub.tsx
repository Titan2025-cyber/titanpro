import { MessageSquare, Mail, MessageCircle, Clock } from "lucide-react";
import HubShell from "@/components/HubShell";
import Messaging from "@/pages/Messaging";
import EmailPage from "@/pages/Email";
import SMS from "@/pages/SMS";
import CommTimeline from "@/pages/CommTimeline";

export default function CommsHub() {
  return (
    <HubShell
      title="Communications"
      description="Messaging, email, two-way SMS, and the full communication timeline in one workspace."
      icon={MessageSquare}
      tabs={[
        { value: "messaging", label: "Messaging", icon: MessageSquare, component: Messaging },
        { value: "email", label: "Email", icon: Mail, component: EmailPage },
        { value: "sms", label: "Two-Way SMS", icon: MessageCircle, component: SMS },
        { value: "timeline", label: "Comms Timeline", icon: Clock, component: CommTimeline },
      ]}
    />
  );
}
