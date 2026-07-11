/**
 * CustomerPortalParts.tsx — Portal Clarity building blocks for the homeowner portal.
 *
 * Exports the 5 clarity features requested:
 *   - StageExplainer        (Claim Stage Explainer)
 *   - NextActionPanel       (Next Action / "what happens next")
 *   - MoistureVisualization (moisture progress bars)
 *   - EquipmentTracker      (equipment on-site tracker)
 *   - MessageThread         (two-way messaging)
 */
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Info, ChevronDown, ChevronUp, CheckCircle, ArrowRight, User,
  Gauge, Fan, Wind, Droplets, MessageSquare, Send,
  Shield, ShieldCheck, Phone, Clock3, CircleDollarSign, FileCheck2,
  ClipboardList, AlertCircle, HandCoins, Landmark,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";

const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

// ── Claim Stage Explainer content ─────────────────────────────────────────────
const STAGE_EXPLAINER: Record<string, { headline: string; body: string; whatToExpect: string[] }> = {
  new: {
    headline: "Your claim is open",
    body: "We've logged your loss and are getting a crew scheduled. This first stage is about assessing the damage and planning the fastest safe path to recovery.",
    whatToExpect: ["A call to confirm your first crew visit", "An initial damage assessment", "Guidance on what to move or protect"],
  },
  mitigation: {
    headline: "We're stopping the damage from spreading",
    body: "Mitigation is emergency work — extracting standing water, removing unsalvageable materials, and setting professional drying equipment. Acting fast here protects your home and your claim.",
    whatToExpect: ["Water extraction and cleanup", "Drying equipment placed in affected rooms", "Daily moisture monitoring begins"],
  },
  drying: {
    headline: "Your home is drying to industry standard",
    body: "We monitor moisture every day and won't stop until your structure meets the IICRC S500 dry standard. The equipment running in your home is doing the work — please leave it on.",
    whatToExpect: ["Daily moisture and humidity readings", "Equipment stays until targets are met", "A dry-out completion confirmation"],
  },
  reconstruction: {
    headline: "We're rebuilding what was damaged",
    body: "Now we restore your home to pre-loss condition — drywall, flooring, paint, and finishes. You may be asked to choose colors or materials along the way.",
    whatToExpect: ["Repair and rebuild work", "Material and finish selections", "Estimates posted in your Reports tab"],
  },
  complete: {
    headline: "Your restoration is complete",
    body: "The work is done and your home is back to pre-loss condition. Please review your final documents and take care of any remaining invoice.",
    whatToExpect: ["Final walkthrough documents", "Any remaining invoice to settle", "Warranty details on file"],
  },
  closed: {
    headline: "This job is closed",
    body: "Everything is wrapped up. Thank you for trusting Titan Restoration with your home.",
    whatToExpect: ["All documents available here anytime", "Reach out if anything comes up"],
  },
};

const EQUIP_META: Record<string, { label: string; icon: any; blurb: string }> = {
  dehumidifier:  { label: "Dehumidifier",  icon: Droplets, blurb: "Pulls moisture out of the air" },
  air_mover:     { label: "Air Mover",     icon: Fan,      blurb: "Speeds evaporation off surfaces" },
  air_scrubber:  { label: "Air Scrubber",  icon: Wind,     blurb: "Cleans airborne particles" },
  hepa:          { label: "HEPA Filter",   icon: Wind,     blurb: "Captures fine contaminants" },
  moisture_meter:{ label: "Moisture Meter",icon: Gauge,    blurb: "Measures material moisture" },
  other:         { label: "Equipment",     icon: Fan,      blurb: "On-site drying equipment" },
};

function parseJSON<T>(v: any, fallback: T): T {
  if (!v) return fallback;
  if (typeof v !== "string") return v as T;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

// ── Claim Stage Explainer ─────────────────────────────────────────────────────
export function StageExplainer({ status }: { status: string }) {
  const [open, setOpen] = useState(false);
  const info = STAGE_EXPLAINER[status] || STAGE_EXPLAINER.new;
  return (
    <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/10 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2.5 p-3 text-left" data-testid="button-stage-explainer">
        <div className="w-8 h-8 rounded-lg bg-[hsl(var(--titan-blue))] flex items-center justify-center flex-shrink-0">
          <Info className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold text-[hsl(var(--titan-blue))] uppercase tracking-wide">What this stage means</p>
          <p className="text-sm font-semibold leading-snug">{info.headline}</p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-3.5 space-y-3">
          <p className="text-sm leading-relaxed text-muted-foreground">{info.body}</p>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">What to expect</p>
            <ul className="space-y-1">
              {info.whatToExpect.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <CheckCircle className="w-3.5 h-3.5 text-[hsl(var(--titan-blue))] flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Next Action Panel ─────────────────────────────────────────────────────────
export function NextActionPanel({ action }: { action: { title: string; detail: string; who: string } }) {
  if (!action) return null;
  return (
    <div className="rounded-xl border-2 border-[hsl(var(--titan-red)/0.3)] bg-[hsl(var(--titan-red)/0.05)] p-3.5">
      <div className="flex items-center gap-2 mb-1.5">
        <ArrowRight className="w-4 h-4 text-[hsl(var(--titan-red))]" />
        <p className="text-[10px] font-bold text-[hsl(var(--titan-red))] uppercase tracking-wide">What happens next</p>
      </div>
      <p className="text-sm font-semibold">{action.title}</p>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{action.detail}</p>
      {action.who && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-[hsl(var(--titan-red)/0.15)]">
          <User className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">Owner: <span className="font-semibold text-foreground">{action.who}</span></span>
        </div>
      )}
    </div>
  );
}

// ── Moisture Visualization ────────────────────────────────────────────────────
export function MoistureVisualization({ records }: { records: any[] }) {
  if (!records || records.length === 0) return null;
  const latest = records[records.length - 1];
  const readings = parseJSON<any[]>(latest.moisture_readings ?? latest.moistureReadings, []);
  let atTarget = 0, total = 0;
  readings.forEach((r: any) => {
    const reading = Number(r.reading ?? r.value);
    const target = Number(r.target ?? r.goal ?? 16);
    if (!isNaN(reading)) { total++; if (reading <= target) atTarget++; }
  });
  const pct = total ? Math.round((atTarget / total) * 100) : (latest.structural_drying_complete ? 100 : 0);
  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5 text-[hsl(var(--titan-blue))]" />Dry-out progress</span>
          <span className="text-xs font-bold text-[hsl(var(--titan-blue))]">{pct}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--titan-blue))] to-green-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          {pct >= 100 ? "Your structure has reached the dry standard." : `${atTarget} of ${total || "—"} monitored areas at target moisture.`}
        </p>
      </div>
      {readings.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Latest readings · Day {latest.day_number || latest.dayNumber || "—"}</p>
          {readings.slice(0, 8).map((r: any, i: number) => {
            const reading = Number(r.reading ?? r.value) || 0;
            const target = Number(r.target ?? r.goal ?? 16) || 16;
            const scaleMax = Math.max(reading, target, 30);
            const barPct = Math.min(100, Math.round((reading / scaleMax) * 100));
            const dry = reading <= target;
            return (
              <div key={i}>
                <div className="flex items-center justify-between text-[11px] mb-0.5">
                  <span className="font-medium truncate pr-2">{r.location || r.material || `Point ${i + 1}`}</span>
                  <span className={dry ? "text-green-600 font-semibold" : "text-orange-600 font-semibold"}>{reading}% {dry ? "· Dry" : "· Drying"}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden relative">
                  <div className={`h-full rounded-full ${dry ? "bg-green-500" : "bg-orange-400"}`} style={{ width: `${barPct}%` }} />
                  <div className="absolute top-0 bottom-0 w-0.5 bg-foreground/40" style={{ left: `${Math.min(100, Math.round((target / scaleMax) * 100))}%` }} title={`Target ${target}%`} />
                </div>
              </div>
            );
          })}
          <p className="text-[10px] text-muted-foreground">The dark line marks the dry target for each material.</p>
        </div>
      )}
    </div>
  );
}

// ── Equipment On-Site Tracker ─────────────────────────────────────────────────
export function EquipmentTracker({ equipment, deploymentLog }: { equipment: any[]; deploymentLog: any[] }) {
  const list = (equipment && equipment.length > 0) ? equipment : (deploymentLog || []);
  if (!list || list.length === 0) return null;
  const groups: Record<string, number> = {};
  list.forEach((e: any) => { const c = e.category || "other"; groups[c] = (groups[c] || 0) + 1; });
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5"><Fan className="w-3.5 h-3.5" />Equipment On-Site</p>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(groups).map(([cat, count]) => {
          const meta = EQUIP_META[cat] || EQUIP_META.other;
          const Icon = meta.icon;
          return (
            <div key={cat} className="flex items-center gap-2.5 rounded-xl border bg-muted/20 p-2.5">
              <div className="w-9 h-9 rounded-lg bg-[hsl(var(--titan-blue)/0.1)] flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-none">{count} × {meta.label}{count > 1 ? "s" : ""}</p>
                <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{meta.blurb}</p>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1"><Info className="w-3 h-3" />Please leave all equipment running until our crew removes it.</p>
    </div>
  );
}

// ── Two-Way Messaging ─────────────────────────────────────────────────────────
export function MessageThread({ jobId, contactId, authorName, initial }: { jobId: number; contactId: number; authorName: string; initial: any[] }) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const { data: messages = initial } = useQuery<any[]>({
    queryKey: ["/api/customer-portal/messages", jobId],
    queryFn: () => apiRequest("GET", `/api/customer-portal/messages/${jobId}`).then(r => r.json()),
    initialData: initial,
    refetchInterval: 15000,
  });
  const send = useMutation({
    mutationFn: (body: string) => apiRequest("POST", "/api/customer-portal/messages", { jobId, contactId, body, authorName }),
    onSuccess: () => { setDraft(""); queryClient.invalidateQueries({ queryKey: ["/api/customer-portal/messages", jobId] }); },
  });
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);
  const submit = () => { if (draft.trim()) send.mutate(draft.trim()); };
  return (
    <div className="flex flex-col" style={{ minHeight: 280 }}>
      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto max-h-[340px] pr-1">
        {messages.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-medium">Send us a message</p>
            <p className="text-xs">Ask a question about your job — our team will reply here.</p>
          </div>
        ) : (
          messages.map((m: any) => {
            const mine = m.sender === "customer";
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${mine ? "bg-[hsl(var(--titan-red))] text-white rounded-br-sm" : "bg-muted rounded-bl-sm"}`}>
                  {!mine && <p className="text-[10px] font-semibold text-[hsl(var(--titan-blue))] mb-0.5">{m.author_name || m.authorName || "Titan Restoration"}</p>}
                  <p className="text-sm leading-snug whitespace-pre-wrap">{m.body}</p>
                  <p className={`text-[9px] mt-1 ${mine ? "text-white/70" : "text-muted-foreground"}`}>{fmtDate(m.created_at || m.createdAt)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="flex items-end gap-2 pt-3 mt-2 border-t">
        <textarea value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Type your message…" rows={1}
          className="flex-1 resize-none rounded-xl border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--titan-red)/0.3)]"
          data-testid="input-customer-message" />
        <Button size="icon" className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)] text-white flex-shrink-0"
          onClick={submit} disabled={send.isPending || !draft.trim()} data-testid="button-send-message">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Insurance Advocacy ────────────────────────────────────────────────────────
// Helps the homeowner understand their claim money and make sure they receive
// everything they're entitled to. Shows CARRIER figures only — never Titan's
// internal costs or margins.
const fmtMoney = (n?: number | null) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

const CLAIM_STATUS_META: Record<string, { label: string }> = {
  open:               { label: "Claim Open" },
  inspected:          { label: "Inspected" },
  approved:           { label: "Approved" },
  supplement_pending: { label: "Supplement Pending" },
  closed:             { label: "Claim Settled" },
};

const PAY_STATUS_META: Record<string, { label: string; dot: string; text: string }> = {
  received: { label: "Received", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  issued:   { label: "Issued",   dot: "bg-blue-500",    text: "text-blue-600 dark:text-blue-400" },
  expected: { label: "Expected", dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
};

const PAY_ICON: Record<string, any> = {
  deductible: HandCoins, carrier: Landmark, depreciation: CircleDollarSign, supplement: FileCheck2,
};

const RIGHTS = [
  { t: "You choose your restoration company", d: "Your insurer can recommend a vendor, but the decision is yours. You hired Titan — the carrier cannot force you to use someone else." },
  { t: "You only owe your deductible", d: "On a covered loss, your out-of-pocket cost is your policy deductible. Everything approved above that is the carrier's responsibility." },
  { t: "Recoverable depreciation is your money", d: "Carriers hold back \"depreciation\" on the first check and release it once repairs are done. Titan documents completion so you get it back — don't leave it on the table." },
  { t: "Hidden damage can be supplemented", d: "If we uncover damage the original estimate missed, we document it and file a supplement so the carrier pays for the full scope — not just what was visible on day one." },
  { t: "You're entitled to a like-kind, quality repair", d: "Coverage restores your home to pre-loss condition with comparable materials and workmanship. Cut-rate substitutions are not what you paid premiums for." },
];

function MoneyRow({ label, hint, value, strong, accent }: { label: string; hint?: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className={`text-xs ${strong ? "font-semibold" : "font-medium"} leading-tight`}>{label}</p>
        {hint && <p className="text-[10px] text-muted-foreground leading-tight">{hint}</p>}
      </div>
      <span className={`text-sm ${strong ? "font-bold" : accent ? "font-semibold text-emerald-600 dark:text-emerald-400" : "font-medium"} whitespace-nowrap`}>{value}</span>
    </div>
  );
}

export function InsuranceAdvocacy({ claim }: { claim: any | null }) {
  const [showRights, setShowRights] = useState(true);
  if (!claim) {
    return (
      <div className="text-center py-10 text-muted-foreground" data-testid="empty-insurance">
        <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm font-medium">Claim details coming soon</p>
        <p className="text-xs">Once your carrier's estimate is in, your payment tracker and coverage breakdown will appear here.</p>
      </div>
    );
  }

  const status = CLAIM_STATUS_META[claim.status] || CLAIM_STATUS_META.open;
  const payments: any[] = claim.payments || [];
  const rcv = claim.rcv || 0;
  const acv = claim.acv || 0;
  const dep = claim.recoverableDepreciation || 0;
  const ded = claim.deductible || 0;
  const supp = claim.supplementTotal || 0;

  const stillComing = payments
    .filter(p => p.status !== "received" && p.kind !== "deductible")
    .reduce((s, p) => s + (p.amount || 0), 0);

  return (
    <div className="space-y-3" data-testid="panel-insurance">
      {/* Claim header card */}
      <div className="rounded-xl border-2 border-[hsl(var(--titan-blue)/0.25)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-[hsl(var(--titan-blue))] text-white">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            <div>
              <p className="text-sm font-bold leading-tight">{claim.carrier || "Your Carrier"}</p>
              <p className="text-[11px] opacity-80 leading-tight">Claim {claim.claimNumber || "—"}</p>
            </div>
          </div>
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white/15" data-testid="badge-claim-status">{status.label}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
          {[
            { label: "Policy #", value: claim.policyNumber || "—" },
            { label: "Date of Loss", value: fmtDate(claim.dateOfLoss) },
            { label: "Adjuster", value: claim.adjusterName || "—" },
            { label: "Adjuster Phone", value: claim.adjusterPhone || "—" },
          ].map(r => (
            <div key={r.label} className="bg-background px-3 py-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{r.label}</p>
              <p className="text-xs font-semibold mt-0.5 break-words">{r.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Coverage math */}
      <div className="rounded-xl border p-3.5 bg-muted/30">
        <div className="flex items-center gap-1.5 mb-2.5">
          <CircleDollarSign className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
          <p className="text-sm font-semibold">What your policy covers</p>
        </div>
        <div className="space-y-2">
          <MoneyRow label="Total approved scope (RCV)" hint="Full replacement cost of covered work" value={fmtMoney(rcv)} strong />
          <MoneyRow label="Initial payment (ACV)" hint="Actual cash value — paid first" value={fmtMoney(acv)} />
          <MoneyRow label="Recoverable depreciation" hint="Released when repairs are complete" value={fmtMoney(dep)} accent />
          {supp > 0 && <MoneyRow label="Approved supplement" hint="Extra scope we documented for you" value={fmtMoney(supp)} accent />}
          <div className="border-t pt-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Your deductible</span>
            <span className="text-sm font-semibold">{fmtMoney(ded)}</span>
          </div>
        </div>
      </div>

      {/* Money still coming */}
      {stillComing > 0 && (
        <div className="rounded-xl border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 p-3.5 flex items-start gap-2.5" data-testid="callout-still-owed">
          <HandCoins className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">{fmtMoney(stillComing)} still coming to you</p>
            <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">This is money your carrier still owes on the approved claim. Titan tracks and files for it so nothing gets left behind.</p>
          </div>
        </div>
      )}

      {/* Payment tracker */}
      <div className="rounded-xl border p-3.5">
        <div className="flex items-center gap-1.5 mb-3">
          <ClipboardList className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
          <p className="text-sm font-semibold">Payment tracker</p>
        </div>
        <div className="space-y-2.5">
          {payments.length === 0 && <p className="text-xs text-muted-foreground">No payments recorded yet.</p>}
          {payments.map((p: any) => {
            const meta = PAY_STATUS_META[p.status] || PAY_STATUS_META.expected;
            const Icon = PAY_ICON[p.kind] || CircleDollarSign;
            return (
              <div key={p.id} className="flex items-start gap-3 rounded-lg border bg-muted/20 p-2.5" data-testid={`payment-row-${p.id}`}>
                <div className="w-8 h-8 rounded-lg bg-[hsl(var(--titan-blue)/0.1)] flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium leading-tight">{p.label}</p>
                    <p className="text-sm font-bold whitespace-nowrap">{fmtMoney(p.amount)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                    <span className={`text-[11px] font-medium ${meta.text}`}>{meta.label}</span>
                    {p.received_date && <span className="text-[11px] text-muted-foreground">· {fmtDate(p.received_date)}</span>}
                    {!p.received_date && p.expected_date && <span className="text-[11px] text-muted-foreground">· est. {fmtDate(p.expected_date)}</span>}
                  </div>
                  {p.note && <p className="text-[11px] text-muted-foreground mt-1 leading-snug">{p.note}</p>}
                </div>
              </div>
            );
          })}
        </div>
        {claim.coverageNotes && (
          <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />{claim.coverageNotes}
          </p>
        )}
      </div>

      {/* Rights & advocacy checklist */}
      <div className="rounded-xl border-2 border-[hsl(var(--titan-red)/0.25)] overflow-hidden">
        <button onClick={() => setShowRights(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-[hsl(var(--titan-red)/0.06)] text-left"
          data-testid="button-toggle-rights">
          <span className="flex items-center gap-2 text-sm font-semibold text-[hsl(var(--titan-red))]">
            <Shield className="w-4 h-4" />Know your rights
          </span>
          {showRights ? <ChevronUp className="w-4 h-4 text-[hsl(var(--titan-red))]" /> : <ChevronDown className="w-4 h-4 text-[hsl(var(--titan-red))]" />}
        </button>
        {showRights && (
          <div className="p-3.5 space-y-2.5">
            {RIGHTS.map((r, i) => (
              <div key={i} className="flex items-start gap-2.5" data-testid={`right-item-${i}`}>
                <CheckCircle className="w-4 h-4 text-[hsl(var(--titan-red))] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium leading-tight">{r.t}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{r.d}</p>
                </div>
              </div>
            ))}
            <div className="rounded-lg bg-muted/40 p-2.5 flex items-start gap-2 mt-1">
              <AlertCircle className="w-4 h-4 text-[hsl(var(--titan-blue))] flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-muted-foreground leading-snug">
                Questions about a payment or something the adjuster said? Message us in the Messages tab or call Titan at
                <span className="font-semibold text-foreground"> 706-922-0154</span> — we advocate directly with your carrier on your behalf.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
