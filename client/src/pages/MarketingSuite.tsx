import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Megaphone, Star, Camera, Send, Trophy, Users, CloudLightning, BarChart3, Instagram, Facebook, Copy, Sparkles } from "lucide-react";

const SOCIAL_TEMPLATES = [
  { platform: "Facebook", type: "Water Damage Win", text: "🏠 Another Augusta family back home after a water damage disaster. Our team responded within the hour, dried the property in 4 days, and helped navigate the entire insurance claim. Before → After below. Call Titan Restoration at 706-922-0154 if you need us. #AugustaGA #WaterDamage #TitanRestoration" },
  { platform: "Instagram", type: "Storm Season Alert", text: "⚡ Storm season is here, Augusta. If your home sustains damage, don't wait. Titan Restoration responds 24/7. Swipe to see a recent storm restoration. Save our number: 706-922-0154. #AugustaRestoration #StormDamage #CSRA" },
  { platform: "Google Business", type: "Review Request Post", text: "We just completed a project for a family in North Augusta — they were kind enough to share their experience. If Titan has helped you, we'd love a Google review. It helps our neighbors find us when they need us most. Thank you for trusting Titan! 706-922-0154" },
];

const PARTNER_DRIPS = [
  { step: 1, timing: "Day 0 — After referral received", message: "Hi [Partner], just wanted to confirm we got your referral for [Address]. Crew is en route. We'll keep you posted every step of the way. — Titan Restoration" },
  { step: 2, timing: "Day 3 — Mid-mitigation", message: "Hi [Partner], update on [Address]: mitigation is going well, moisture is dropping on schedule. Estimated dry by [Date]. Thank you for trusting us with your client." },
  { step: 3, timing: "Job complete", message: "Hi [Partner], great news — [Address] is complete and your client is thrilled. Your referral commission is being processed. Want to grab coffee next week? — Cody, Titan Restoration 706-922-0154" },
];

const REVIEW_DRIPS = [
  { step: 1, timing: "24h after job complete", message: "Hi [Customer], thank you for choosing Titan Restoration! Your home is restored. If we did a great job, would you share a quick Google review? It takes 60 seconds: https://g.page/r/CbTitanRestorationAugusta/review — Cody, 706-922-0154" },
  { step: 2, timing: "Day 5 (if no review)", message: "Hi [Customer], just following up — we hope everything is looking great at [Address]. If you have a moment, a Google review truly helps our local business: https://g.page/r/CbTitanRestorationAugusta/review" },
];

export default function MarketingSuite() {
  const [activeTab, setActiveTab] = useState<"social"|"partner-drip"|"review-drip"|"before-after">("social");
  const [generatedPost, setGeneratedPost] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");

  const generatePost = () => {
    setGeneratedPost(`🔴 Titan Restoration LLC — ${customPrompt || "Water Damage Response"}\n\nAnother Augusta family protected. Our crew arrived within 60 minutes, deployed IICRC-certified drying protocol, and coordinated directly with the insurance adjuster — no stress for the homeowner.\n\n✅ 24/7 Emergency Response\n✅ Insurance Claim Coordination\n✅ IICRC Certified Technicians\n✅ Augusta GA & CSRA\n\nCall or text 706-922-0154\n\n#TitanRestoration #AugustaGA #WaterDamage #FireDamage #MoldRemediation #CSRA #RestorationContractor`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-red))] flex items-center justify-center">
          <Megaphone className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Marketing Suite</h1>
          <p className="text-sm text-muted-foreground">Social posts, partner drip sequences, review automation, before/after portfolio</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 flex-wrap">
        {([["social","Social Posts"],["partner-drip","Partner Drip"],["review-drip","Review Automation"],["before-after","Before/After Portfolio"]] as const).map(([t,l]) => (
          <Button key={t} size="sm" variant={activeTab===t?"default":"outline"} onClick={()=>setActiveTab(t)} className={activeTab===t?"bg-[hsl(var(--titan-red))] text-white":""}>{l}</Button>
        ))}
      </div>

      {activeTab === "social" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="w-4 h-4 text-[hsl(var(--titan-blue))]" />AI Post Generator</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Describe the job or topic (e.g. 'storm response in Aiken', 'mold remediation complete')" value={customPrompt} onChange={e=>setCustomPrompt(e.target.value)} />
              <Button size="sm" onClick={generatePost} className="bg-[hsl(var(--titan-blue))] text-white hover:opacity-90"><Sparkles className="w-3 h-3 mr-1" />Generate Post</Button>
              {generatedPost && (
                <div className="space-y-2">
                  <Textarea rows={7} value={generatedPost} onChange={e=>setGeneratedPost(e.target.value)} className="text-sm" />
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-xs"><Facebook className="w-3 h-3 mr-1" />Post to Facebook</Button>
                    <Button size="sm" variant="outline" className="text-xs"><Instagram className="w-3 h-3 mr-1" />Instagram</Button>
                    <Button size="sm" variant="outline" className="text-xs"><Copy className="w-3 h-3 mr-1" />Copy</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Ready-Made Templates</h2>
            {SOCIAL_TEMPLATES.map((t,i) => (
              <Card key={i}>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">
                  {t.platform === "Facebook" ? <Facebook className="w-4 h-4 text-blue-600" /> : t.platform === "Instagram" ? <Instagram className="w-4 h-4 text-pink-500" /> : <Star className="w-4 h-4 text-amber-500" />}
                  {t.platform} — {t.type}
                </CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-muted-foreground">{t.text}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-xs"><Send className="w-3 h-3 mr-1" />Post Now</Button>
                    <Button size="sm" variant="outline" className="text-xs">Schedule</Button>
                    <Button size="sm" variant="outline" className="text-xs"><Copy className="w-3 h-3 mr-1" />Copy</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {activeTab === "partner-drip" && (
        <div className="space-y-4">
          <Card className="border-[hsl(var(--titan-blue)/0.3)] bg-[hsl(var(--titan-blue)/0.03)]">
            <CardContent className="pt-4">
              <p className="text-sm font-medium">Partner Communication Sequence</p>
              <p className="text-xs text-muted-foreground mt-1">Automatically sent when a referral is received, mid-job, and at completion — keeps partners informed and engaged without manual effort.</p>
            </CardContent>
          </Card>
          {PARTNER_DRIPS.map((d,i) => (
            <Card key={i}>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-[hsl(var(--titan-blue))] text-white text-xs flex items-center justify-center font-bold shrink-0">{d.step}</div>
                {d.timing}
              </CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">{d.message}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="text-xs">Edit Template</Button>
                  <Button size="sm" variant="outline" className="text-xs">Send Test</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activeTab === "review-drip" && (
        <div className="space-y-4">
          <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
            <CardContent className="pt-4 flex items-center gap-3">
              <Star className="w-8 h-8 text-amber-500" />
              <div>
                <p className="font-semibold text-sm">Automated Review Sequence</p>
                <p className="text-xs text-muted-foreground">2 touchpoints — fires automatically when job status moves to complete. Every new review links directly to Google.</p>
              </div>
            </CardContent>
          </Card>
          {REVIEW_DRIPS.map((d,i) => (
            <Card key={i}>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{d.timing}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <p className="text-sm text-muted-foreground">{d.message}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="text-xs">Edit</Button>
                  <Button size="sm" variant="outline" className="text-xs">Send Test SMS</Button>
                  <Button size="sm" variant="outline" className="text-xs">Send Test Email</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activeTab === "before-after" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Camera className="w-4 h-4" />Auto-Generated Before/After Portfolio</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Titan Pro automatically pairs arrival photos and completion photos from each job to create a shareable before/after gallery. Each entry links to your Google Business profile.</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {["Water — Augusta","Fire — Martinez","Mold — Aiken"].map((j,i) => (
                  <div key={i} className="rounded-lg border overflow-hidden">
                    <div className="h-20 bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                      <Camera className="w-8 h-8 text-muted-foreground opacity-40" />
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-medium">{j}</p>
                      <div className="flex gap-1 mt-1">
                        <Button size="sm" variant="outline" className="text-[10px] h-6 px-2">Share</Button>
                        <Button size="sm" variant="outline" className="text-[10px] h-6 px-2">Post</Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline">Generate Portfolio from Job Photos</Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
