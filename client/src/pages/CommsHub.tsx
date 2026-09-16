import { MessageSquare, Mail } from "lucide-react";
import HubShell from "@/components/HubShell";
import Messaging from "@/pages/Messaging";
import EmailPage from "@/pages/Email";

// Two-Way SMS and Comms Timeline tabs were removed on 2026-09-16 at Cody's
// request. The underlying server routes (/api/sms, /api/comm-timeline) and
// the sms_messages / comm_timeline tables remain in place — internal ops
// notifications (server/notify.ts) still use transactional SMS via Twilio
// for low-stock and other admin alerts. Only the user-facing UI is gone.
export default function CommsHub() {
  return (
    <HubShell
      title="Communications"
      description="Messaging and email in one workspace."
      icon={MessageSquare}
      tabs={[
        { value: "messaging", label: "Messaging", icon: MessageSquare, component: Messaging },
        { value: "email", label: "Email", icon: Mail, component: EmailPage },
      ]}
    />
  );
}
