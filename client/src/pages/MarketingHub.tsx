// MarketingHub.tsx
//
// Rebuilt for the marketing-rep workflow. Consolidates 12 scattered marketing
// pages into 5 tabs a rep can run their day from — top-down.
//
//   1. Today       — KPI strip + action queue (send, nurture, tag, compose)
//   2. Content     — social post templates + storm-triggered drafts
//   3. Reviews     — send funnel (manual approval per job — never auto-sent)
//   4. Referrals   — nurture queue + partner list + profitability
//   5. Insights    — conversion funnel + lead attribution
//
// Deprecated (kept on disk for legacy deep-links but not in the tab list):
//   • MarketingSuite — empty wrapper, redirect never worked
//   • StormCAT — merged into Content tab via StormMarketing
//   • ReferralNurture — surfaced inside Referrals tab
//
// Design principle: NOTHING in this hub sends a customer touch without the
// rep pressing a button. Auto-send is intentionally not built — problem
// customers stay silent unless the rep explicitly opts them in.

import { Megaphone, CloudLightning, Target, Send, Handshake, Zap } from "lucide-react";
import HubShell from "@/components/HubShell";
import MarketingRollup from "@/components/MarketingRollup";
import MarketingToday from "@/pages/MarketingToday";
import Marketing from "@/pages/Marketing";
import StormMarketing from "@/pages/StormMarketing";
import ReviewRequests from "@/pages/ReviewRequests";
import MarketingReferrals from "@/pages/MarketingReferrals";
import MarketingInsights from "@/pages/MarketingInsights";

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
          { value: "content", label: "Content", icon: Megaphone, component: ContentTab },
          { value: "reviews", label: "Reviews", icon: Send, component: ReviewRequests },
          { value: "referrals", label: "Referrals", icon: Handshake, component: MarketingReferrals },
          { value: "insights", label: "Insights", icon: Target, component: MarketingInsights },
        ]}
      />
    </div>
  );
}
