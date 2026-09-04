import { LifeBuoy, Bot, Mic } from "lucide-react";
import HubShell from "@/components/HubShell";
import EmergencyIntake from "@/pages/EmergencyIntake";
import FNOLChatbot from "@/pages/FNOLChatbot";
import VoiceToNote from "@/pages/VoiceToNote";

export default function IntakeHub() {
  return (
    <HubShell
      title="Intake"
      description="Every way to start a job in one place — after-hours emergency intake, the FNOL chatbot for adjuster-driven claims, and voice-to-note for hands-free field capture."
      icon={LifeBuoy}
      tabs={[
        { value: "emergency", label: "Emergency", icon: LifeBuoy, component: EmergencyIntake },
        { value: "fnol", label: "FNOL Bot", icon: Bot, component: FNOLChatbot },
        { value: "voice", label: "Voice Note", icon: Mic, component: VoiceToNote },
      ]}
    />
  );
}
