// MarketingHub.tsx
//
// Rebuilt for the marketing-rep workflow. Consolidates scattered marketing
// pages into a tab shell a rep can run their day from — top-down.
//
//   1. Today       — KPI strip + action queue (send, nurture, tag, compose)
//   2. Leads       — inbound lead queue (Push 6 #6)
//   3. Content     — social post templates + storm-triggered drafts
//   4. Reviews     — send funnel (manual approval per job — never auto-sent)
//   5. Referrals   — nurture queue + partner list + profitability + PM cadence
//   6. Nurture     — post-job customer sequences + PM sequences (Push 6 #12/#11)
//   7. Canvassing  — neighborhood mailing lists after big jobs (Push 6 #13)
//   8. Goals       — set weekly targets for pace tracking (Push 6 #7)
//   9. Insights    — conversion funnel + lead attribution
//
// Design principle: NOTHING in this hub sends a customer touch without the
// rep pressing a button. Auto-send is intentionally not built — problem
// customers stay silent unless the rep explicitly opts them in.

import { Megaphone, CloudLightning, Target, Send, Handshake, Zap, PhoneIncoming, MessageSquare, Map } from "lucide-react";
import HubShell from "@/components/HubShell";
import MarketingRollup from "@/components/MarketingRollup";
import MarketingToday from "@/pages/MarketingToday";
import Marketing from "@/pages/Marketing";
import StormMarketing from "@/pages/StormMarketing";
import ReviewRequests from "@/pages/ReviewRequests";
import MarketingReferrals from "@/pages/MarketingReferrals";
import MarketingInsights from "@/pages/MarketingInsights";
import MarketingInboundLeads from "@/pages/MarketingInboundLeads";
import MarketingNurture from "@/pages/MarketingNurture";
import MarketingCanvassing from "@/pages/MarketingCanvassing";
import MarketingGoals from "@/pages/MarketingGoals";

// Content tab — social post templates + storm-triggered drafts stacked.
function ContentTab() {
  return (
    <div className="space-y-8">
      <section aria-label="Post templates">
        <Marketing />
      </section>
      <section aria-label="Storm-triggered content">
        <StormMarketing />
      </section>
    </div>
  );
}

export default function MarketingHub() {
  return (
    <div>
      <MarketingRollup />
      <HubShell
        title="Marketing"
        description="Run your day from here — send, nurture, compose, measure."
        icon={Megaphone}
        tabs={[
          { value: "today", label: "Today", icon: Zap, component: MarketingToday },
          { value: "leads", label: "Leads", icon: PhoneIncoming, component: MarketingInboundLeads },
          { value: "content", label: "Content", icon: Megaphone, component: ContentTab },
          { value: "reviews", label: "Reviews", icon: Send, component: ReviewRequests },
          { value: "referrals", label: "Referrals", icon: Handshake, component: MarketingReferrals },
          { value: "nurture", label: "Nurture", icon: MessageSquare, component: MarketingNurture },
          { value: "canvassing", label: "Canvassing", icon: Map, component: MarketingCanvassing },
          { value: "goals", label: "Goals", icon: Target, component: MarketingGoals },
          { value: "insights", label: "Insights", icon: Target, component: MarketingInsights },
        ]}
      />
    </div>
  );
}
