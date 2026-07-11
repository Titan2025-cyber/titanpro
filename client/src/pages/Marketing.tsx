import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Megaphone, Mail, Copy, CheckCheck, Sparkles, RefreshCw,
  Instagram, Facebook, Globe, Send, Users, TrendingUp,
  FileText, Phone, Star, Calendar, BarChart2, Zap,
  Wand2, CalendarDays, Bookmark, Trash2, Loader2, Save
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { Contact, Job } from "@shared/schema";

// ── Post templates ─────────────────────────────────────────────────────────
const POST_LIBRARY: Record<string, Record<string, Record<string, string>>> = {
  Facebook: {
    water: {
      emergency: `🚨 WATER DAMAGE? Don't wait — call NOW!\n\nEvery hour matters when water invades your home. Titan Restoration LLC responds 24/7 across Augusta, GA and the CSRA with IICRC-certified technicians, industrial drying equipment, and direct insurance billing.\n\n✅ On-site within 2 hours\n✅ Free damage assessment\n✅ We handle the insurance claim\n✅ Licensed & insured\n\n📞 706-922-0154 | titanrestorationllc.com\n\n#WaterDamage #AugustaGA #EmergencyRestoration #TitanRestoration #CSRA #24HourService`,
      educational: `💧 Did you know? Water damage left untreated for 24 hours can lead to mold growth, structural weakening, and skyrocketing repair costs.\n\nTitan Restoration LLC uses IICRC S500-compliant drying protocols — the gold standard in the industry — to ensure your home is completely dry and safe before we leave.\n\n🔬 Advanced moisture detection\n🌀 Industrial air movers & dehumidifiers\n📊 Daily monitoring logs you can review\n\nProtect your home the right way. Call 706-922-0154\n\n#WaterDamage #IICRCCertified #AugustaGA #TitanRestoration #MoldPrevention`,
      testimonial: `⭐⭐⭐⭐⭐ "Titan Restoration saved us. After our pipe burst, they were at our house within the hour. The team was professional, thorough, and made the entire insurance process painless. Our home looks better than ever."\n— Satisfied Customer, Augusta GA\n\nWater damage doesn't have to be a nightmare. Let Titan Restoration LLC handle everything from extraction to reconstruction.\n\n📞 706-922-0154 | titanrestorationllc.com\n#WaterRestoration #AugustaGA #TitanRestoration #5Stars`,
    },
    fire: {
      emergency: `🔥 Fire & Smoke Damage? Titan Restoration LLC is here.\n\nDealing with fire damage is overwhelming — but you don't have to face it alone. Titan handles everything: emergency board-up, smoke & soot removal, odor elimination, and full reconstruction.\n\n✅ 24/7 emergency response\n✅ Direct insurance billing\n✅ IICRC-certified technicians\n✅ Serving Augusta GA & CSRA\n\n📞 706-922-0154 | titanrestorationllc.com\n\n#FireDamage #SmokeRestoration #AugustaGA #TitanRestoration #EmergencyService`,
      educational: `🚨 After a fire, every hour counts.\n\nSoot and smoke residue continue damaging surfaces long after the flames are out. Titan Restoration LLC begins mitigation immediately — protecting your structure, belongings, and air quality.\n\nOur fire restoration process:\n1️⃣ Emergency stabilization & board-up\n2️⃣ Smoke & soot removal from all surfaces\n3️⃣ Deodorization with industrial equipment\n4️⃣ Contents cleaning & restoration\n5️⃣ Structural reconstruction\n\n📞 706-922-0154\n\n#FireDamage #SmokeRemoval #AugustaGA #TitanRestoration`,
      testimonial: `⭐⭐⭐⭐⭐ "After the fire, we were lost. Titan Restoration stepped in and guided us through everything — from the insurance claim to rebuilding our kitchen. They treated our home like it was their own."\n— Augusta GA Homeowner\n\n📞 706-922-0154 | titanrestorationllc.com\n#FireRestoration #TitanRestoration #AugustaGA`,
    },
    mold: {
      emergency: `🚨 Mold Alert: Don't ignore it.\n\nMold can begin growing within 24–48 hours of water exposure and poses serious health risks. Titan Restoration LLC provides IICRC S520-certified mold remediation across Augusta, GA.\n\n✅ Free mold inspection\n✅ Containment to prevent spread\n✅ EPA-approved antimicrobials\n✅ Full documentation for insurance\n\n📞 706-922-0154 | titanrestorationllc.com\n\n#MoldRemediation #IICRCCertified #AugustaGA #TitanRestoration #IndoorAirQuality`,
      educational: `🍄 Mold 101: What Augusta homeowners need to know.\n\n→ Mold grows in as little as 24 hours after moisture intrusion\n→ It can live inside walls where you can't see it\n→ Standard cleaning products don't eliminate mold spores\n→ Untreated mold can affect your family's health & tank your home's value\n\nTitan Restoration LLC uses IICRC S520 protocols to locate, contain, and completely eliminate mold — with documentation your insurer will accept.\n\n📞 706-922-0154\n\n#MoldFacts #MoldRemediation #AugustaGA #TitanRestoration`,
      testimonial: `⭐⭐⭐⭐⭐ "We suspected mold but weren't sure. Titan did a full inspection, found it in the crawl space, and had it completely remediated in 3 days. Total pros from start to finish."\n\n📞 706-922-0154 | titanrestorationllc.com\n#MoldRemoval #TitanRestoration #AugustaGA`,
    },
    storm: {
      emergency: `⛈️ Storm Season Is Here — Is Your Home Protected?\n\nTitan Restoration LLC provides 24/7 storm damage response across Augusta, GA, Columbia, SC, and the CSRA. We secure your property immediately and fight with your insurance carrier to get you fully paid.\n\n✅ Emergency tarping & board-up\n✅ Water extraction & drying\n✅ Hail & wind damage assessment\n✅ Full reconstruction\n\n📞 706-922-0154 | titanrestorationllc.com\n\n#StormDamage #HailDamage #AugustaGA #TitanRestoration #EmergencyResponse`,
      educational: `⚡ After a severe storm, here's what to do FIRST:\n\n1. Stay safe — don't enter if structurally unsafe\n2. Document damage with photos before touching anything\n3. Prevent further damage (tarps, towels) — insurers call this "mitigation"\n4. Call a licensed restoration company before calling your adjuster\n5. Do NOT sign any paperwork until you've spoken to a professional\n\nTitan Restoration LLC protects your rights and maximizes your insurance settlement.\n\n📞 706-922-0154\n\n#StormPrep #AugustaGA #TitanRestoration #InsuranceTips`,
      testimonial: `⭐⭐⭐⭐⭐ "A tree fell on our roof during the storms last month. Titan was there the same day to tarp and assess. They handled our entire State Farm claim and got us everything we needed for a full rebuild."\n\n📞 706-922-0154 | titanrestorationllc.com\n#StormRecovery #TitanRestoration #AugustaGA`,
    },
  },
  Instagram: {
    water: {
      emergency: `💧 Water damage in Augusta, GA? We respond 24/7.\n\nTitan Restoration LLC — IICRC certified, locally owned, insurance-approved.\n\n📞 706-922-0154\nLink in bio 👆\n\n#WaterDamage #AugustaGA #TitanRestoration #Restoration #CSRA #EmergencyResponse #WaterExtraction`,
      educational: `Did you know? Wet drywall must be dried within 72 hours or mold begins to grow.\n\nAt Titan Restoration, we use IICRC S500 protocols and daily moisture logs to ensure your home dries completely — every time.\n\n📞 706-922-0154 | Link in bio\n\n#WaterDamage #IICRC #DryingScience #TitanRestoration #AugustaGA`,
      testimonial: `⭐⭐⭐⭐⭐ Real results. Real clients.\n\n"They were at our door in 45 minutes. Absolute lifesavers." — Augusta, GA\n\nTitan Restoration LLC — When disaster strikes, we answer.\n\n📞 706-922-0154\n\n#TitanRestoration #5Star #WaterDamage #AugustaGA`,
    },
    fire: {
      emergency: `🔥 Fire damage doesn't wait — neither do we.\n\nTitan Restoration LLC responds 24/7 to fire & smoke damage across Augusta GA and the CSRA.\n\n📞 706-922-0154 | Link in bio\n\n#FireDamage #SmokeRemoval #TitanRestoration #AugustaGA #Restoration`,
      educational: `Smoke damage is invisible but devastating.\n\nSoot embeds into walls, HVAC systems, and fabrics within hours of a fire. Professional restoration is the only way to truly eliminate it.\n\nTitan Restoration LLC — restoring Augusta, one home at a time.\n\n📞 706-922-0154\n\n#FireRestoration #SmokeDamage #TitanRestoration #AugustaGA`,
      testimonial: `⭐⭐⭐⭐⭐ "From the emergency board-up to the final walkthrough — flawless. Thank you Titan." — Martinez, GA\n\n📞 706-922-0154\n\n#TitanRestoration #FireDamage #AugustaGA`,
    },
    mold: {
      emergency: `🍄 Mold? Call us first.\n\nIICRC-certified mold remediation by Titan Restoration LLC. Serving Augusta GA and the CSRA.\n\n📞 706-922-0154 | Link in bio\n\n#MoldRemediation #AugustaGA #TitanRestoration #IndoorAirQuality`,
      educational: `Mold spores are everywhere — but growth requires moisture.\n\nAfter any water event, professional drying is critical to prevent mold colonization. Titan's IICRC S500/S520 protocols stop it before it starts.\n\n📞 706-922-0154\n\n#MoldPrevention #IICRC #TitanRestoration #AugustaGA`,
      testimonial: `⭐⭐⭐⭐⭐ "Found mold behind our bathroom wall. Titan contained it, removed it, and rebuilt the wall in one week. Couldn't be happier." — Evans, GA\n\n📞 706-922-0154\n#TitanRestoration #MoldRemoval #AugustaGA`,
    },
    storm: {
      emergency: `⛈️ Storm damage? We're ready.\n\nTitan Restoration LLC — 24/7 storm response across Augusta GA & CSRA. Emergency tarping, water extraction, full reconstruction.\n\n📞 706-922-0154 | Link in bio\n\n#StormDamage #AugustaGA #TitanRestoration #EmergencyService`,
      educational: `After a storm: document everything BEFORE cleanup.\n\nPhotos + a licensed restoration company = maximum insurance settlement.\n\nTitan Restoration LLC fights for you.\n\n📞 706-922-0154\n\n#InsuranceTips #StormDamage #TitanRestoration #AugustaGA`,
      testimonial: `⭐⭐⭐⭐⭐ "Titan handled my entire storm claim. Got way more than I expected." — Columbia, SC\n\n📞 706-922-0154\n#StormRecovery #TitanRestoration #AugustaGA`,
    },
  },
  "Google Business": {
    water: {
      emergency: `Water Damage? Titan Restoration LLC responds 24/7 in Augusta, GA.\n\nOur IICRC-certified technicians use industrial drying equipment and IICRC S500 protocols to restore your property fast. We handle direct insurance billing so you don't have to worry.\n\n🕐 Available 24/7 | 📞 706-922-0154 | titanrestorationllc.com`,
      educational: `IICRC-Certified Water Damage Restoration in Augusta, GA.\n\nTitan Restoration LLC specializes in complete water damage mitigation using IICRC S500 standards. Daily moisture logs, psychrometric monitoring, and professional equipment ensure your home is fully dry — every time.\n\n📞 706-922-0154 | titanrestorationllc.com`,
      testimonial: `"Outstanding service. Titan responded within the hour and handled everything from water extraction to final repairs. Highly recommend." — 5-Star Review, Augusta GA\n\n📞 706-922-0154 | titanrestorationllc.com`,
    },
    fire: {
      emergency: `Fire & Smoke Damage Restoration — Augusta, GA. Titan Restoration LLC provides 24/7 emergency fire damage response: board-up, soot removal, deodorization, and full reconstruction. Direct insurance billing. 📞 706-922-0154`,
      educational: `Professional Fire Damage Restoration in Augusta, GA. Titan Restoration LLC follows IICRC protocols for complete fire and smoke remediation — from emergency stabilization to final reconstruction. Call 706-922-0154.`,
      testimonial: `"Titan restored our home after a kitchen fire. Professional, fast, and the insurance process was seamless." — 5-Star Review\n📞 706-922-0154 | titanrestorationllc.com`,
    },
    mold: {
      emergency: `IICRC-Certified Mold Remediation in Augusta, GA. Titan Restoration LLC provides safe, complete mold removal with EPA-approved products and full documentation for insurance claims. Free inspection. 📞 706-922-0154`,
      educational: `Mold Remediation Specialists — Augusta, GA. Titan Restoration uses IICRC S520 standards to locate, contain, and eliminate mold. Certified technicians, full documentation. Call 706-922-0154.`,
      testimonial: `"Found mold in our crawl space. Titan was thorough, professional, and had it handled in days." — 5-Star Review\n📞 706-922-0154`,
    },
    storm: {
      emergency: `Storm Damage Restoration — Augusta, GA & CSRA. Titan Restoration LLC responds 24/7 to storm, wind, and hail damage. Emergency tarping, water extraction, full reconstruction. We fight for your insurance claim. 📞 706-922-0154`,
      educational: `Storm Damage Experts Serving Augusta, GA. Titan Restoration handles every phase of storm damage recovery — from emergency response to complete reconstruction — with direct insurance billing. 📞 706-922-0154`,
      testimonial: `"Titan handled our entire storm claim and rebuilt our roof and siding perfectly." — 5-Star Review, Martinez GA\n📞 706-922-0154`,
    },
  },
};

// ── Email templates ────────────────────────────────────────────────────────
const EMAIL_TEMPLATES: Record<string, (name: string, company: string, role: string) => string> = {
  referral_partner: (name, company, role) =>
`Subject: Referral Partnership — Titan Restoration LLC

Hi ${name || "there"},

My name is Cody Brantley — I'm the owner of Titan Restoration LLC, a full-service property restoration company serving Augusta, GA, Columbia, SC, and the CSRA.

${role === "Insurance Agent" ? `As an insurance professional at ${company || "your agency"}, your clients frequently face property damage emergencies. I'd love to be your trusted restoration referral.` : `As a professional at ${company || "your organization"}, you may encounter clients dealing with property damage. I'd love to be your go-to restoration partner.`}

What we offer:
• Water damage mitigation & drying (IICRC S500)
• Fire & smoke damage restoration
• Mold remediation (IICRC S520 certified)
• Storm/hail damage & full reconstruction
• Biohazard cleanup

Why partner with Titan:
✅ 24/7 emergency response — on-site within 2 hours
✅ Direct insurance billing — we handle all claim paperwork
✅ IICRC-certified technicians
✅ Competitive, transparent referral compensation
✅ Real-time job status updates for your clients
✅ 100% satisfaction guarantee

We take care of your clients like family, and we'll make you look great for the referral.

Would you have 15 minutes this week for a quick call?

Best regards,
Cody Brantley
Owner, Titan Restoration LLC
📞 706-922-0154
📧 cody@titanrestorationllc.com
🌐 titanrestorationllc.com
Augusta, GA | "Recover · Restore · Rebuild"`,

  property_manager: (name, company, _role) =>
`Subject: Property Restoration Partner — Titan Restoration LLC

Hi ${name || "there"},

I'm Cody Brantley, owner of Titan Restoration LLC in Augusta, GA. We specialize in rapid-response property restoration for water, fire, mold, and storm damage across the CSRA.

For property managers like you at ${company || "your company"}, having a trusted restoration partner on speed dial is critical. When damage happens, every hour of delay increases repair costs and tenant disruption.

What Titan offers property managers:
✅ 24/7 emergency dispatch — fast response minimizes property damage
✅ Detailed documentation for insurance & liability
✅ Competitive commercial rates
✅ Clean, professional crews — respectful of tenants
✅ Full rebuild capability — one company, start to finish
✅ Digital job reports available to you at any time

I'd love to get on your vendor list and be the company you call first when something goes wrong.

Available for a quick call or site visit anytime.

Cody Brantley
Owner, Titan Restoration LLC
📞 706-922-0154
📧 cody@titanrestorationllc.com
🌐 titanrestorationllc.com`,

  plumber: (name, company, _role) =>
`Subject: Let's Build a Referral Relationship — Titan Restoration LLC

Hi ${name || "there"},

I'm Cody Brantley with Titan Restoration LLC in Augusta, GA. I work alongside plumbers like yourself all the time — when you find a burst pipe or flooding situation, that's where we come in.

I'd love to build a referral relationship with ${company || "your business"}. When you're on a job and the customer needs water damage restoration, you can hand them our card and we'll take it from there — professionally and fast.

In return, we offer competitive referral compensation for every job that results from your introduction.

Services we handle:
• Water extraction & structural drying (IICRC S500)
• Mold prevention & remediation
• Flooring, drywall, and reconstruction
• Direct insurance billing

Let's connect and make things easier for our mutual customers.

📞 706-922-0154 | cody@titanrestorationllc.com
Titan Restoration LLC | titanrestorationllc.com`,

  realtor: (name, company, _role) =>
`Subject: Restoration Partner for Your Real Estate Clients — Titan Restoration LLC

Hi ${name || "there"},

I'm Cody Brantley, owner of Titan Restoration LLC in Augusta, GA. I work with realtors at ${company || "your brokerage"} to help clients navigate property damage — whether it's a pre-sale mold issue, water damage discovered in inspection, or an emergency during a transaction.

How we help realtors:
✅ Fast turnaround to keep deals on track
✅ Pre-sale assessments & remediation documentation
✅ Emergency response that protects your client's investment
✅ Professional reports for disclosure & insurance purposes
✅ Referral compensation for qualified introductions

I'd love to be on your short list of trusted vendors. Let's grab coffee or jump on a quick call.

Cody Brantley
Owner, Titan Restoration LLC
📞 706-922-0154
📧 cody@titanrestorationllc.com
🌐 titanrestorationllc.com`,
};

// ── Seasonal campaigns ─────────────────────────────────────────────────────
const CAMPAIGNS = [
  {
    title: "Storm Season Awareness",
    season: "Spring/Summer",
    icon: "⛈️",
    platforms: ["Facebook", "Instagram", "Google Business"],
    posts: 3,
    desc: "3-post campaign alerting homeowners before storm season. Educational first, then urgency, then testimonial.",
    color: "bg-blue-50 border-blue-200",
  },
  {
    title: "Mold Awareness Month",
    season: "May",
    icon: "🍄",
    platforms: ["Facebook", "Instagram"],
    posts: 4,
    desc: "4-part educational series on mold risks, prevention, and IICRC-compliant remediation.",
    color: "bg-green-50 border-green-200",
  },
  {
    title: "Winter Pipe Freeze Campaign",
    season: "November–January",
    icon: "🧊",
    platforms: ["Facebook", "Google Business"],
    posts: 3,
    desc: "Prevention tips + emergency CTA targeting homeowners before and during freeze events.",
    color: "bg-cyan-50 border-cyan-200",
  },
  {
    title: "Insurance Partner Outreach",
    season: "Ongoing",
    icon: "🤝",
    platforms: ["Email"],
    posts: 5,
    desc: "5-email sequence targeting insurance agents, adjusters, and property managers in the CSRA.",
    color: "bg-purple-50 border-purple-200",
  },
];

// ── Performance metrics stub ───────────────────────────────────────────────
const METRICS = [
  { label: "Posts Created", value: "24", change: "+6 this month", up: true },
  { label: "Referral Emails Sent", value: "18", change: "+4 this month", up: true },
  { label: "Active Partners", value: "3", change: "Tom Bradley, Janet Wu, +1", up: true },
  { label: "Jobs from Marketing", value: "2", change: "TP-2026-001, TP-2026-003", up: true },
];

export default function Marketing() {
  const [platform, setPlatform] = useState("Facebook");
  const [lossType, setLossType] = useState("water");
  const [postType, setPostType] = useState("emergency");
  const [copied, setCopied] = useState<string | null>(null);
  const [emailTemplate, setEmailTemplate] = useState("referral_partner");
  const [recipientName, setRecipientName] = useState("");
  const [recipientCompany, setRecipientCompany] = useState("");
  const [recipientRole, setRecipientRole] = useState("Insurance Agent");
  const [selectedContact, setSelectedContact] = useState("");
  const [customPost, setCustomPost] = useState("");
  const [isCustomizing, setIsCustomizing] = useState(false);
  const { toast } = useToast();

  // ── AI Post generator state ──────────────────────────────────────────────
  const [aiPlatform, setAiPlatform] = useState("Facebook");
  const [aiTone, setAiTone] = useState("educational");
  const [aiLossType, setAiLossType] = useState("none");
  const [aiTopic, setAiTopic] = useState("");
  const [aiResult, setAiResult] = useState("");
  const [aiUsedLlm, setAiUsedLlm] = useState<boolean | null>(null);

  // ── Seasonal state ───────────────────────────────────────────────────────
  const [seasonPlatform, setSeasonPlatform] = useState("Facebook");
  const [seasonResult, setSeasonResult] = useState("");
  const [seasonLabel, setSeasonLabel] = useState("");
  const [seasonUsedLlm, setSeasonUsedLlm] = useState<boolean | null>(null);

  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  // ── Calendar + saved posts queries ───────────────────────────────────────
  const { data: calendar } = useQuery<{ date: string; entries: any[] }>({ queryKey: ["/api/marketing/calendar"] });
  const { data: savedPosts = [] } = useQuery<any[]>({ queryKey: ["/api/marketing/posts"] });

  // ── Mutations ────────────────────────────────────────────────────────────
  const genCustom = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/marketing/generate-post", {
      platform: aiPlatform, topic: aiTopic, tone: aiTone,
      lossType: aiLossType === "none" ? undefined : aiLossType,
    }).then(r => r.json()),
    onSuccess: (r: any) => { setAiResult(r.post || ""); setAiUsedLlm(!!r.usedLlm); },
    onError: (e: any) => toast({ title: "Could not generate", description: String(e?.message || e), variant: "destructive" }),
  });

  const genSeasonal = useMutation({
    mutationFn: async (key?: string) => apiRequest("POST", "/api/marketing/generate-seasonal", {
      platform: seasonPlatform, key,
    }).then(r => r.json()),
    onSuccess: (r: any) => { setSeasonResult(r.post || ""); setSeasonLabel(r.entry?.label || ""); setSeasonUsedLlm(!!r.usedLlm); },
    onError: (e: any) => toast({ title: "Could not generate", description: String(e?.message || e), variant: "destructive" }),
  });

  const savePost = useMutation({
    mutationFn: async (p: { platform: string; body: string; kind: string; topic?: string; tone?: string; lossType?: string; usedLlm?: boolean }) =>
      apiRequest("POST", "/api/marketing/posts", p),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/marketing/posts"] }); toast({ title: "Saved", description: "Post saved. The AI will learn from it for future posts." }); },
    onError: (e: any) => toast({ title: "Could not save", description: String(e?.message || e), variant: "destructive" }),
  });

  const starPost = useMutation({
    mutationFn: async (p: { id: number; starred: boolean }) => apiRequest("PATCH", `/api/marketing/posts/${p.id}`, { starred: p.starred }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/marketing/posts"] }),
  });

  const deletePost = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/marketing/posts/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/marketing/posts"] }),
  });

  const referralContacts = contacts.filter(c => c.type === "referral");
  const completedJobs = jobs.filter(j => j.status === "complete");

  const socialPost = POST_LIBRARY[platform]?.[lossType]?.[postType] || "";
  const displayPost = isCustomizing ? customPost : socialPost;
  const emailContent = EMAIL_TEMPLATES[emailTemplate]?.(recipientName, recipientCompany, recipientRole) || "";

  const copy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2500);
  };

  const handleContactSelect = (contactId: string) => {
    setSelectedContact(contactId);
    const c = contacts.find(c => c.id === Number(contactId));
    if (c) {
      setRecipientName(c.name);
      setRecipientCompany(c.company || "");
    }
  };

  const handleCustomize = () => {
    setCustomPost(socialPost);
    setIsCustomizing(true);
  };

  const handleResetToTemplate = () => {
    setIsCustomizing(false);
    setCustomPost("");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Marketing</h1>
          <p className="text-sm text-muted-foreground">Social posts, referral outreach, and campaign tools for Titan Restoration LLC</p>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {METRICS.map(m => (
          <Card key={m.label} className="border-0 bg-muted/40">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="text-xl font-bold mt-0.5">{m.value}</p>
              <p className={`text-xs mt-0.5 ${m.up ? "text-green-600" : "text-red-500"}`}>{m.change}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="social">
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="social"><Megaphone className="w-3.5 h-3.5 mr-1.5" />Social Posts</TabsTrigger>
          <TabsTrigger value="email"><Mail className="w-3.5 h-3.5 mr-1.5" />Outreach Emails</TabsTrigger>
          <TabsTrigger value="campaigns"><Zap className="w-3.5 h-3.5 mr-1.5" />Campaigns</TabsTrigger>
          <TabsTrigger value="contacts"><Users className="w-3.5 h-3.5 mr-1.5" />Referral Partners</TabsTrigger>
          <TabsTrigger value="ai"><Wand2 className="w-3.5 h-3.5 mr-1.5" />AI Post</TabsTrigger>
          <TabsTrigger value="seasonal"><CalendarDays className="w-3.5 h-3.5 mr-1.5" />Seasonal &amp; Holidays</TabsTrigger>
          <TabsTrigger value="saved"><Bookmark className="w-3.5 h-3.5 mr-1.5" />Saved &amp; Learning</TabsTrigger>
        </TabsList>

        {/* ── Social Posts ──────────────────────────────────────────── */}
        <TabsContent value="social" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-[hsl(var(--titan-red))]" />Social Post Generator
                <Badge variant="outline" className="ml-auto text-xs font-normal">24 templates across 3 platforms</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Controls */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Platform</Label>
                  <Select value={platform} onValueChange={v => { setPlatform(v); setIsCustomizing(false); }}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Facebook">📘 Facebook</SelectItem>
                      <SelectItem value="Instagram">📷 Instagram</SelectItem>
                      <SelectItem value="Google Business">🌐 Google Business</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Service Type</Label>
                  <Select value={lossType} onValueChange={v => { setLossType(v); setIsCustomizing(false); }}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="water">💧 Water Damage</SelectItem>
                      <SelectItem value="fire">🔥 Fire & Smoke</SelectItem>
                      <SelectItem value="mold">🍄 Mold</SelectItem>
                      <SelectItem value="storm">⛈️ Storm</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Post Style</Label>
                  <Select value={postType} onValueChange={v => { setPostType(v); setIsCustomizing(false); }}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="emergency">🚨 Emergency / CTA</SelectItem>
                      <SelectItem value="educational">📚 Educational</SelectItem>
                      <SelectItem value="testimonial">⭐ Testimonial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Post preview */}
              <div className="relative">
                <Textarea
                  className="min-h-[220px] text-sm font-mono resize-none"
                  value={displayPost}
                  readOnly={!isCustomizing}
                  onChange={e => setCustomPost(e.target.value)}
                  data-testid="textarea-social-post"
                />
                {isCustomizing && (
                  <Badge className="absolute top-2 right-2 bg-yellow-100 text-yellow-700 border-yellow-300">Editing</Badge>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 flex-wrap">
                <Button
                  className="flex-1 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
                  onClick={() => copy(displayPost, "social")}
                  data-testid="button-copy-post"
                >
                  {copied === "social"
                    ? <><CheckCheck className="w-4 h-4 mr-2 text-green-300" />Copied!</>
                    : <><Copy className="w-4 h-4 mr-2" />Copy Post</>}
                </Button>
                {!isCustomizing ? (
                  <Button variant="outline" onClick={handleCustomize}>
                    <Sparkles className="w-4 h-4 mr-1.5" />Customize
                  </Button>
                ) : (
                  <Button variant="outline" onClick={handleResetToTemplate}>
                    <RefreshCw className="w-4 h-4 mr-1.5" />Reset
                  </Button>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                All posts include Titan's phone number 706-922-0154. Customize before posting to add local details, job specifics, or seasonal context.
              </p>
            </CardContent>
          </Card>

          {/* Post calendar hint */}
          <Card className="border-dashed border-muted-foreground/30">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Calendar className="w-5 h-5 text-[hsl(var(--titan-blue))] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold">Recommended Posting Schedule</p>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <p><span className="font-medium text-foreground">Mon/Wed/Fri</span> — Facebook: educational content & local updates</p>
                    <p><span className="font-medium text-foreground">Tue/Thu</span> — Instagram: testimonials & before/after visuals</p>
                    <p><span className="font-medium text-foreground">Weekly</span> — Google Business: service updates, responses to reviews</p>
                    <p><span className="font-medium text-foreground">After every storm event</span> — Emergency CTA across all platforms</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Email Outreach ─────────────────────────────────────────── */}
        <TabsContent value="email" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Mail className="w-4 h-4 text-[hsl(var(--titan-blue))]" />Referral Partner Outreach
                <Badge variant="outline" className="ml-auto text-xs font-normal">4 templates</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Template selector */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Email Type</Label>
                  <Select value={emailTemplate} onValueChange={setEmailTemplate}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="referral_partner">🤝 Insurance / Referral Partner</SelectItem>
                      <SelectItem value="property_manager">🏢 Property Manager</SelectItem>
                      <SelectItem value="plumber">🔧 Plumber / Contractor</SelectItem>
                      <SelectItem value="realtor">🏠 Realtor / Real Estate Agent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Recipient Role</Label>
                  <Input
                    className="mt-1"
                    value={recipientRole}
                    onChange={e => setRecipientRole(e.target.value)}
                    placeholder="e.g. Insurance Agent"
                  />
                </div>
              </div>

              {/* Load from contacts */}
              {referralContacts.length > 0 && (
                <div>
                  <Label className="text-xs">Load from Referral Contacts</Label>
                  <Select value={selectedContact} onValueChange={handleContactSelect}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select contact to auto-fill" /></SelectTrigger>
                    <SelectContent>
                      {referralContacts.map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name} — {c.company || "Independent"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Recipient fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Recipient Name</Label>
                  <Input
                    className="mt-1"
                    value={recipientName}
                    onChange={e => setRecipientName(e.target.value)}
                    placeholder="e.g. Tom Bradley"
                    data-testid="input-recipient-name"
                  />
                </div>
                <div>
                  <Label className="text-xs">Company / Agency</Label>
                  <Input
                    className="mt-1"
                    value={recipientCompany}
                    onChange={e => setRecipientCompany(e.target.value)}
                    placeholder="e.g. State Farm"
                    data-testid="input-recipient-company"
                  />
                </div>
              </div>

              {/* Email preview */}
              <Textarea
                className="min-h-[320px] text-xs font-mono resize-none"
                value={emailContent}
                readOnly
                data-testid="textarea-email-content"
              />

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  className="flex-1 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
                  onClick={() => copy(emailContent, "email")}
                  data-testid="button-copy-email"
                >
                  {copied === "email"
                    ? <><CheckCheck className="w-4 h-4 mr-2 text-green-300" />Copied!</>
                    : <><Copy className="w-4 h-4 mr-2" />Copy Email</>}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const subject = encodeURIComponent("Referral Partnership — Titan Restoration LLC");
                    const body = encodeURIComponent(emailContent);
                    window.open(`mailto:?subject=${subject}&body=${body}`);
                  }}
                  data-testid="button-open-in-mail"
                >
                  <Send className="w-4 h-4 mr-1.5" />Open in Mail
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Personalize with the recipient's name and company. For Gmail integration, go to the Email module and send from your linked account.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Campaigns ──────────────────────────────────────────────── */}
        <TabsContent value="campaigns" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {CAMPAIGNS.map(c => (
              <Card key={c.title} className={`border ${c.color}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{c.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{c.title}</p>
                        <Badge variant="outline" className="text-xs">{c.season}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{c.desc}</p>
                      <div className="flex gap-1.5 mt-2 flex-wrap">
                        {c.platforms.map(p => (
                          <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>
                        ))}
                        <Badge variant="outline" className="text-xs">{c.posts} posts</Badge>
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-3 text-xs"
                    onClick={() => {
                      if (c.platforms[0] !== "Email") {
                        setPlatform(c.platforms[0]);
                        setLossType(c.title.toLowerCase().includes("mold") ? "mold" : c.title.toLowerCase().includes("storm") ? "storm" : "water");
                        setPostType("educational");
                        // Switch to social tab by finding the tab trigger
                        (document.querySelector('[data-state][value="social"]') as HTMLElement)?.click();
                      }
                    }}
                  >
                    <Sparkles className="w-3 h-3 mr-1.5" />Use This Campaign
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Tips */}
          <Card className="border-0 bg-muted/40">
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-[hsl(var(--titan-blue))]" />Marketing Best Practices for Restoration</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Content Strategy</p>
                  <p>• Post 3–5x per week on Facebook to stay top-of-mind</p>
                  <p>• Testimonials convert 3x better than promotional posts</p>
                  <p>• Before/after photos get highest engagement in restoration</p>
                  <p>• Storm events = post immediately — urgency drives calls</p>
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Referral Outreach</p>
                  <p>• Target insurance agents first — highest job value</p>
                  <p>• Follow up emails 3x: Day 1, Day 4, Day 10</p>
                  <p>• Offer lunch-and-learn to agency offices</p>
                  <p>• Ask for referrals at job completion — best time to ask</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Referral Partners ──────────────────────────────────────── */}
        <TabsContent value="contacts" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-[hsl(var(--titan-blue))]" />Referral Partner Directory
                <Badge variant="outline" className="ml-auto">{referralContacts.length} partners</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {referralContacts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No referral contacts yet. Add contacts with type "referral" in the Contacts module.</p>
              ) : (
                <div className="space-y-3">
                  {referralContacts.map(c => {
                    const jobsReferred = jobs.filter(j => j.insuranceCarrier === c.company || j.notes?.includes(c.name)).length;
                    return (
                      <div key={c.id} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/30 transition-colors">
                        <div className="w-9 h-9 rounded-full bg-[hsl(var(--titan-blue)/0.1)] flex items-center justify-center shrink-0">
                          <span className="text-sm font-bold text-[hsl(var(--titan-blue))]">
                            {c.name.charAt(0)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm">{c.name}</p>
                            {c.referralRate && (
                              <Badge className="bg-green-100 text-green-700 text-xs">{c.referralRate}% rate</Badge>
                            )}
                            {jobsReferred > 0 && (
                              <Badge variant="outline" className="text-xs">{jobsReferred} job(s)</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{c.company || "Independent"}</p>
                          <div className="flex gap-3 mt-1.5">
                            {c.phone && (
                              <a href={`tel:${c.phone}`} className="text-xs text-[hsl(var(--titan-blue))] hover:underline flex items-center gap-1">
                                <Phone className="w-3 h-3" />{c.phone}
                              </a>
                            )}
                            {c.email && (
                              <a href={`mailto:${c.email}`} className="text-xs text-[hsl(var(--titan-blue))] hover:underline flex items-center gap-1">
                                <Mail className="w-3 h-3" />{c.email}
                              </a>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs shrink-0"
                          onClick={() => {
                            setRecipientName(c.name);
                            setRecipientCompany(c.company || "");
                            setEmailTemplate("referral_partner");
                            // Switch to email tab
                            const tabs = document.querySelectorAll('[role="tab"]');
                            tabs.forEach(t => { if (t.textContent?.includes("Outreach")) (t as HTMLElement).click(); });
                          }}
                        >
                          <Mail className="w-3 h-3 mr-1" />Draft Email
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Jobs from completed work - testimonial candidates */}
          {completedJobs.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Star className="w-4 h-4 text-yellow-500" />Testimonial Candidates
                  <span className="text-xs text-muted-foreground font-normal ml-1">— completed jobs ready for review requests</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {completedJobs.slice(0, 5).map(j => (
                  <div key={j.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                    <div>
                      <span className="font-medium">{j.jobNumber}</span>
                      <span className="text-muted-foreground text-xs ml-2">{j.lossType} — {j.address}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs h-7"
                      onClick={() => copy(`Hi, thank you for choosing Titan Restoration LLC for your ${j.lossType} damage restoration. We'd love to hear about your experience! Please leave us a Google review at: https://g.page/r/TitanRestoration (takes 2 minutes) — Thank you! 🙏 Cody Brantley, 706-922-0154`, `review-${j.id}`)}
                    >
                      {copied === `review-${j.id}` ? <><CheckCheck className="w-3 h-3 mr-1 text-green-600" />Copied</> : <><Copy className="w-3 h-3 mr-1" />Review Request</>}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── AI Post (custom, on-demand) ────────────────────────────── */}
        <TabsContent value="ai" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-[hsl(var(--titan-red))]" />Custom AI Post Generator
                <Badge variant="outline" className="ml-auto text-xs font-normal">Generate any post, 24/7</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Platform</Label>
                  <Select value={aiPlatform} onValueChange={setAiPlatform}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Facebook">📘 Facebook</SelectItem>
                      <SelectItem value="Instagram">📷 Instagram</SelectItem>
                      <SelectItem value="Google Business">🌐 Google Business</SelectItem>
                      <SelectItem value="LinkedIn">💼 LinkedIn</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Tone</Label>
                  <Select value={aiTone} onValueChange={setAiTone}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="educational">📚 Educational</SelectItem>
                      <SelectItem value="emergency">🚨 Emergency / CTA</SelectItem>
                      <SelectItem value="testimonial">⭐ Testimonial</SelectItem>
                      <SelectItem value="promotional">📣 Promotional</SelectItem>
                      <SelectItem value="friendly">😊 Friendly / Community</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Service Focus</Label>
                  <Select value={aiLossType} onValueChange={setAiLossType}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Any / not specific</SelectItem>
                      <SelectItem value="water">💧 Water Damage</SelectItem>
                      <SelectItem value="fire">🔥 Fire &amp; Smoke</SelectItem>
                      <SelectItem value="mold">🍄 Mold</SelectItem>
                      <SelectItem value="storm">⛈️ Storm</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-xs">What should this post say?</Label>
                <Textarea
                  className="mt-1 min-h-[80px] text-sm resize-none"
                  placeholder="e.g. We just finished a big commercial water job downtown — highlight our fast response and direct insurance billing"
                  value={aiTopic}
                  onChange={e => setAiTopic(e.target.value)}
                  data-testid="textarea-ai-topic"
                />
              </div>

              <Button
                className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red))]/90 text-white"
                onClick={() => genCustom.mutate()}
                disabled={genCustom.isPending || !aiTopic.trim()}
                data-testid="button-generate-ai-post"
              >
                {genCustom.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating…</>
                  : <><Wand2 className="w-4 h-4 mr-2" />Generate Post</>}
              </Button>

              {aiResult && (
                <div className="space-y-3">
                  <div className="relative">
                    <Textarea
                      className="min-h-[220px] text-sm font-mono resize-none"
                      value={aiResult}
                      onChange={e => setAiResult(e.target.value)}
                      data-testid="textarea-ai-result"
                    />
                    {aiUsedLlm === false && (
                      <Badge className="absolute top-2 right-2 bg-slate-100 text-slate-600 border-slate-300">Template</Badge>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      className="flex-1 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
                      onClick={() => copy(aiResult, "ai")}
                      data-testid="button-copy-ai"
                    >
                      {copied === "ai" ? <><CheckCheck className="w-4 h-4 mr-2 text-green-300" />Copied!</> : <><Copy className="w-4 h-4 mr-2" />Copy Post</>}
                    </Button>
                    <Button variant="outline" onClick={() => genCustom.mutate()} disabled={genCustom.isPending}>
                      <RefreshCw className="w-4 h-4 mr-1.5" />Regenerate
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => savePost.mutate({ platform: aiPlatform, body: aiResult, kind: "custom", topic: aiTopic, tone: aiTone, lossType: aiLossType === "none" ? undefined : aiLossType, usedLlm: aiUsedLlm ?? false })}
                      disabled={savePost.isPending}
                      data-testid="button-save-ai"
                    >
                      <Save className="w-4 h-4 mr-1.5" />Save
                    </Button>
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Posts are grounded in Titan's brand voice and your saved posts. When AI isn't configured, a professional on-brand template is generated instead — this feature never fails.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Seasonal & Holidays ────────────────────────────────────── */}
        <TabsContent value="seasonal" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-[hsl(var(--titan-blue))]" />Seasonal &amp; Holiday Posts
                <Badge variant="outline" className="ml-auto text-xs font-normal">Full-year restoration calendar</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Platform</Label>
                  <Select value={seasonPlatform} onValueChange={setSeasonPlatform}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Facebook">📘 Facebook</SelectItem>
                      <SelectItem value="Instagram">📷 Instagram</SelectItem>
                      <SelectItem value="Google Business">🌐 Google Business</SelectItem>
                      <SelectItem value="LinkedIn">💼 LinkedIn</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button
                    className="w-full bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
                    onClick={() => genSeasonal.mutate(undefined)}
                    disabled={genSeasonal.isPending}
                    data-testid="button-generate-today"
                  >
                    {genSeasonal.isPending
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating…</>
                      : <><Sparkles className="w-4 h-4 mr-2" />Generate for Right Now</>}
                  </Button>
                </div>
              </div>

              {seasonResult && (
                <div className="space-y-3">
                  {seasonLabel && <Badge className="bg-[hsl(var(--titan-blue)/0.1)] text-[hsl(var(--titan-blue))]">{seasonLabel}</Badge>}
                  <div className="relative">
                    <Textarea className="min-h-[200px] text-sm font-mono resize-none" value={seasonResult} onChange={e => setSeasonResult(e.target.value)} data-testid="textarea-seasonal-result" />
                    {seasonUsedLlm === false && <Badge className="absolute top-2 right-2 bg-slate-100 text-slate-600 border-slate-300">Template</Badge>}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button className="flex-1 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white" onClick={() => copy(seasonResult, "seasonal")} data-testid="button-copy-seasonal">
                      {copied === "seasonal" ? <><CheckCheck className="w-4 h-4 mr-2 text-green-300" />Copied!</> : <><Copy className="w-4 h-4 mr-2" />Copy Post</>}
                    </Button>
                    <Button variant="outline" onClick={() => savePost.mutate({ platform: seasonPlatform, body: seasonResult, kind: "seasonal", topic: seasonLabel, usedLlm: seasonUsedLlm ?? false })} disabled={savePost.isPending}>
                      <Save className="w-4 h-4 mr-1.5" />Save
                    </Button>
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold mb-2">The full-year calendar — click any occasion to generate a post</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(calendar?.entries || []).map((c: any) => (
                    <button
                      key={c.key}
                      onClick={() => genSeasonal.mutate(c.key)}
                      disabled={genSeasonal.isPending}
                      className={`text-left p-3 border rounded-lg hover:bg-muted/40 transition-colors ${c.active ? "border-[hsl(var(--titan-red))] bg-[hsl(var(--titan-red)/0.04)]" : ""}`}
                      data-testid={`button-season-${c.key}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg">{c.emoji}</span>
                        <span className="text-sm font-medium">{c.label}</span>
                        <Badge variant="outline" className="text-xs">{c.season}</Badge>
                        {c.active && <Badge className="text-xs bg-[hsl(var(--titan-red))] text-white">Now</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.theme}</p>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Saved & Learning ───────────────────────────────────────── */}
        <TabsContent value="saved" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-[hsl(var(--titan-blue))]" />Saved Posts
                <Badge variant="outline" className="ml-auto text-xs font-normal">{savedPosts.length} saved · AI learns from these</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {savedPosts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No saved posts yet. Generate a post in the AI Post or Seasonal tab and click Save — the AI will use your saved posts as examples to match Titan's voice going forward.</p>
              ) : (
                <div className="space-y-3">
                  {savedPosts.map((p: any) => (
                    <div key={p.id} className="p-3 border rounded-lg" data-testid={`card-saved-${p.id}`}>
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <Badge variant="secondary" className="text-xs">{p.platform}</Badge>
                        {p.kind && <Badge variant="outline" className="text-xs">{p.kind}</Badge>}
                        {p.topic && <span className="text-xs text-muted-foreground truncate">{p.topic}</span>}
                        <div className="ml-auto flex items-center gap-1">
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => starPost.mutate({ id: p.id, starred: !p.starred })} data-testid={`button-star-${p.id}`}>
                            <Star className={`w-3.5 h-3.5 ${p.starred ? "fill-yellow-400 text-yellow-500" : "text-muted-foreground"}`} />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copy(p.body, `saved-${p.id}`)} data-testid={`button-copy-saved-${p.id}`}>
                            {copied === `saved-${p.id}` ? <CheckCheck className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => deletePost.mutate(p.id)} data-testid={`button-delete-${p.id}`}>
                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs whitespace-pre-wrap font-mono text-muted-foreground line-clamp-4">{p.body}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 flex items-start gap-3 p-3 rounded-lg bg-muted/40">
                <TrendingUp className="w-4 h-4 text-[hsl(var(--titan-blue))] shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">How learning works:</span> every post you save becomes an example the AI studies before writing new posts. Star your best ones (⭐) to prioritize them — over time the AI writes more like Titan and less like a generic template.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
