import { useState } from "react";
import titanLogo from "@/assets/titan-logo.png";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useParams } from "wouter";
import {
  Shield, Droplets, Camera, FileText, AlertCircle, CheckCircle2,
  TrendingDown, Fan, Award, X, ChevronLeft, ChevronRight, DollarSign,
  ThumbsUp, HelpCircle, Send,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/dates";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800", mitigation: "bg-yellow-100 text-yellow-800",
  drying: "bg-orange-100 text-orange-800", reconstruction: "bg-purple-100 text-purple-800",
  complete: "bg-green-100 text-green-800", closed: "bg-gray-100 text-gray-600",
};

const CAT_LABELS: Record<string, string> = {
  before: "Before", during: "During Work", after: "After / Completed",
  moisture: "Moisture", equipment: "Equipment", damage: "Damage", general: "General",
};

const EQUIP_LABELS: Record<string, string> = {
  dehumidifier: "Dehumidifier", air_mover: "Air Mover", air_scrubber: "Air Scrubber",
  hepa: "HEPA Filter", moisture_meter: "Moisture Meter", other: "Equipment",
};

const fmt$ = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
const fmtDate = (s?: string | null) => s ? fmtDate(s, { month: "short", day: "numeric", year: "numeric" }) : "—";

function parseJSON<T>(v: any, fb: T): T {
  if (!v) return fb;
  if (typeof v !== "string") return v as T;
  try { return JSON.parse(v) as T; } catch { return fb; }
}

// ── Drying trend chart (RH% over days) ────────────────────────────────────────
function DryingChart({ records }: { records: any[] }) {
  if (!records || records.length < 1) return null;
  const pts = records.map((r, i) => ({
    day: r.day_number || i + 1,
    rh: Number(r.rh_pct) || 0,
    gpp: Number(r.gpp) || 0,
    date: r.reading_date,
    met: r.drying_goal_met,
  }));
  const maxRh = Math.max(...pts.map(p => p.rh), 60);
  const W = 320, H = 120, pad = 8;
  const stepX = pts.length > 1 ? (W - pad * 2) / (pts.length - 1) : 0;
  const yFor = (v: number) => H - pad - (v / maxRh) * (H - pad * 2);
  const line = pts.map((p, i) => `${pad + i * stepX},${yFor(p.rh)}`).join(" ");
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold flex items-center gap-1.5"><TrendingDown className="w-3.5 h-3.5 text-[hsl(var(--titan-blue))]" />Relative Humidity Trend</p>
        <span className="text-[10px] text-muted-foreground">Lower is drier</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 130 }}>
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={pad} x2={W - pad} y1={pad + f * (H - pad * 2)} y2={pad + f * (H - pad * 2)} stroke="currentColor" strokeOpacity={0.1} strokeWidth={1} />
        ))}
        {pts.length > 1 && <polyline points={line} fill="none" stroke="hsl(var(--titan-blue))" strokeWidth={2.5} strokeLinejoin="round" />}
        {pts.map((p, i) => (
          <circle key={i} cx={pad + i * stepX} cy={yFor(p.rh)} r={3.5} fill={p.met ? "#16a34a" : "hsl(var(--titan-blue))"} />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>Day {pts[0].day}</span>
        <span>Day {pts[pts.length - 1].day} · RH {pts[pts.length - 1].rh}%</span>
      </div>
    </div>
  );
}

// ── Photo browser (grouped by category, lightbox) ─────────────────────────────
function PhotoBrowser({ photos }: { photos: any[] }) {
  const [active, setActive] = useState<number | null>(null);
  if (!photos || photos.length === 0) return null;
  const cats = Array.from(new Set(photos.map(p => p.category || "general")));
  const flat = photos;
  return (
    <div>
      <p className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Camera className="w-4 h-4 text-green-600" />Job Photos ({photos.length})</p>
      {cats.map(cat => {
        const group = photos.filter(p => (p.category || "general") === cat);
        return (
          <div key={cat} className="mb-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{CAT_LABELS[cat] || cat} ({group.length})</p>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {group.map(p => (
                <button key={p.id} onClick={() => setActive(flat.indexOf(p))}
                  className="aspect-square rounded-lg overflow-hidden border bg-muted hover:ring-2 hover:ring-[hsl(var(--titan-blue))] transition"
                  data-testid={`photo-thumb-${p.id}`}>
                  <img src={p.data_url} alt={p.caption || "Job photo"} className="w-full h-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {/* Lightbox. Scrolls the whole backdrop so tall portrait shots and
          the caption underneath are fully reachable — no 75vh cap. Nav
          arrows + close pin to the top via a sticky bar so they don't
          fly off-screen when the user scrolls down the image. */}
      {active !== null && flat[active] && (
        <div
          className="fixed inset-0 bg-black/85 z-50 overflow-y-auto overscroll-contain"
          style={{ WebkitOverflowScrolling: "touch" as any }}
          onClick={() => setActive(null)}
        >
          <div
            className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 bg-black/70 backdrop-blur-sm"
            style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <button
                disabled={active === 0}
                className="h-10 w-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white"
                onClick={() => setActive(active - 1)}
              ><ChevronLeft className="w-6 h-6" /></button>
              <button
                disabled={active === flat.length - 1}
                className="h-10 w-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white"
                onClick={() => setActive(active + 1)}
              ><ChevronRight className="w-6 h-6" /></button>
              <span className="ml-2 text-white/80 text-xs tabular-nums">{active + 1} / {flat.length}</span>
            </div>
            <button
              className="h-10 w-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white"
              onClick={() => setActive(null)}
            ><X className="w-5 h-5" /></button>
          </div>
          <div
            className="max-w-2xl w-full mx-auto px-4 pt-2"
            style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}
            onClick={e => e.stopPropagation()}
          >
            <img
              src={flat[active].data_url}
              alt={flat[active].caption || ""}
              className="block w-full h-auto object-contain rounded-lg bg-black select-none"
              draggable={false}
            />
            <div className="text-center text-white mt-3">
              <p className="text-sm font-medium">{flat[active].caption || "Job photo"}</p>
              <p className="text-xs text-white/60">{CAT_LABELS[flat[active].category] || flat[active].category} · {fmtDate(flat[active].taken_at)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Supplement response ───────────────────────────────────────────────────────
function SupplementResponse({ supp, token }: { supp: any; token: string }) {
  const [note, setNote] = useState("");
  const [amt, setAmt] = useState<string>(String(supp.amount_requested || ""));
  const [done, setDone] = useState<string | null>(supp.status !== "pending" && supp.status !== "submitted" ? supp.status : null);
  const respond = useMutation({
    mutationFn: (decision: string) => apiRequest("POST", "/api/adjuster-portal/supplement-response", {
      token, supplementId: supp.id, decision, amountApproved: Number(amt) || 0, note,
    }).then(r => r.json()),
    onSuccess: (res: any) => { setDone(res.status); queryClient.invalidateQueries({ queryKey: ["/api/adjuster-portal/access", token] }); },
  });
  const lineItems = parseJSON<any[]>(supp.line_items, []);
  const statusBadge = (s: string) => {
    if (s === "approved") return <Badge className="bg-green-100 text-green-700">Approved</Badge>;
    if (s === "partial") return <Badge className="bg-blue-100 text-blue-700">Partial</Badge>;
    if (s === "info_requested") return <Badge className="bg-yellow-100 text-yellow-700">Info Requested</Badge>;
    if (s === "denied") return <Badge className="bg-red-100 text-red-700">Denied</Badge>;
    return <Badge variant="secondary">Pending Review</Badge>;
  };
  return (
    <div className="rounded-xl border bg-muted/20 p-3.5">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-sm font-semibold">{supp.title}</p>
          <p className="text-xs text-muted-foreground">Submitted {fmtDate(supp.submitted_at)}</p>
        </div>
        <div className="text-right">
          <p className="text-base font-bold text-[hsl(var(--titan-blue))]">{fmt$(supp.amount_requested)}</p>
          {statusBadge(done || supp.status)}
        </div>
      </div>
      {lineItems.length > 0 && (
        <div className="space-y-1 mb-2.5 pt-2 border-t">
          {lineItems.slice(0, 6).map((li: any, i: number) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-muted-foreground truncate pr-2">{li.description || li.desc || li.name || `Item ${i + 1}`}</span>
              <span className="font-medium">{fmt$(Number(li.total ?? li.amount ?? li.price) || 0)}</span>
            </div>
          ))}
        </div>
      )}
      {done ? (
        <div className="flex items-center gap-2 text-xs bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-300 rounded-lg p-2.5">
          <CheckCircle2 className="w-4 h-4" />
          <span>Response recorded{supp.amount_approved != null ? ` · ${fmt$(supp.amount_approved)} approved` : ""}. Titan has been notified.</span>
        </div>
      ) : (
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2">
            <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
            <input type="number" value={amt} onChange={e => setAmt(e.target.value)}
              className="flex-1 rounded-lg border bg-background px-2.5 py-1.5 text-sm" placeholder="Amount to approve"
              data-testid={`input-supp-amount-${supp.id}`} />
          </div>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="Optional note to Titan (reason, question, next step)…"
            className="w-full resize-none rounded-lg border bg-background px-2.5 py-1.5 text-sm"
            data-testid={`input-supp-note-${supp.id}`} />
          <div className="grid grid-cols-3 gap-2">
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white text-xs h-8" disabled={respond.isPending}
              onClick={() => respond.mutate("approved")} data-testid={`button-supp-approve-${supp.id}`}>
              <ThumbsUp className="w-3.5 h-3.5 mr-1" />Approve
            </Button>
            <Button size="sm" variant="outline" className="text-xs h-8" disabled={respond.isPending}
              onClick={() => respond.mutate("partial")} data-testid={`button-supp-partial-${supp.id}`}>
              Partial
            </Button>
            <Button size="sm" variant="outline" className="text-xs h-8" disabled={respond.isPending}
              onClick={() => respond.mutate("info")} data-testid={`button-supp-info-${supp.id}`}>
              <HelpCircle className="w-3.5 h-3.5 mr-1" />Ask
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdjusterPortalView() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/adjuster-portal/access", token],
    queryFn: () => apiRequest("GET", `/api/adjuster-portal/access/${token}`).then(r => r.json()),
    enabled: !!token,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[hsl(var(--titan-blue))] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading your secure job view...</p>
        </div>
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-foreground mb-2">Access Denied</h2>
            <p className="text-muted-foreground">This link is invalid or has expired. Please contact Titan Restoration LLC for a new access link.</p>
            <div className="mt-4 p-3 bg-muted rounded-lg">
              <p className="text-sm font-medium">706-922-0154</p>
              <p className="text-xs text-muted-foreground">cody@titanrestorationllc.com</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const credentials: any[] = data.credentials || [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-[hsl(var(--titan-blue))] text-white py-4 px-6">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center p-1">
              <img src={titanLogo} alt="Titan Restoration" className="w-full h-full object-contain" />
            </div>
            <div>
              <p className="font-bold">Titan Restoration LLC</p>
              <p className="text-xs text-blue-200">Adjuster Portal · Read-Only Access</p>
            </div>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{data.adjusterName}</p>
            <p className="text-xs text-blue-200">{data.carrier}</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-green-500" />
          <p className="text-sm text-muted-foreground">You are viewing <strong>{data.jobs?.length || 0} job(s)</strong> shared by Titan Restoration LLC. Documentation is provided for claim verification.</p>
        </div>

        {/* Credentialing */}
        {credentials.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Award className="w-4 h-4 text-[hsl(var(--titan-red))]" />Certified & Insured</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {credentials.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border bg-muted/20 p-2.5">
                    <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold leading-tight">{c.cert_type}</p>
                      <p className="text-[10px] text-muted-foreground">{c.issued_by}{c.expiration_date ? ` · valid to ${fmtDate(c.expiration_date)}` : ""}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">All mitigation performed to IICRC S500 standard by certified technicians.</p>
            </CardContent>
          </Card>
        )}

        {data.jobs?.map((job: any) => {
          const drying: any[] = job.dryingRecords || [];
          const latest = drying.length ? drying[drying.length - 1] : null;
          const supplements: any[] = job.supplements || [];
          const equipLog: any[] = job.equipmentLog || [];
          const equipOnSite: any[] = job.equipmentOnSite || [];
          return (
          <Card key={job.id} className="overflow-hidden">
            <CardHeader className="pb-3 bg-muted/30">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-base">{job.job_number || job.jobNumber}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-0.5">{job.address}</p>
                </div>
                <span className={`text-xs px-3 py-1 rounded-full font-medium capitalize ${STATUS_COLORS[job.status] || "bg-gray-100 text-gray-800"}`}>
                  {job.status}
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-5">
              {/* Job Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Loss Type", value: job.loss_type || job.lossType },
                  { label: "Insurance", value: job.insurance_carrier || job.insuranceCarrier || "N/A" },
                  { label: "Claim #", value: job.claim_number || job.claimNumber || "N/A" },
                  { label: "Assigned Tech", value: job.assigned_tech || job.assignedTech || "N/A" },
                ].map(f => (
                  <div key={f.label} className="bg-muted/30 rounded-lg p-2">
                    <p className="text-xs text-muted-foreground">{f.label}</p>
                    <p className="text-sm font-medium text-foreground capitalize">{f.value}</p>
                  </div>
                ))}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="border border-border rounded-lg p-3 text-center">
                  <Droplets className="w-5 h-5 text-[hsl(var(--titan-blue))] mx-auto mb-1" />
                  <p className="text-xl font-bold text-foreground">{drying.length}</p>
                  <p className="text-xs text-muted-foreground">Drying Records</p>
                </div>
                <div className="border border-border rounded-lg p-3 text-center">
                  <Camera className="w-5 h-5 text-green-600 mx-auto mb-1" />
                  <p className="text-xl font-bold text-foreground">{job.photoCount || 0}</p>
                  <p className="text-xs text-muted-foreground">Photos</p>
                </div>
                <div className="border border-border rounded-lg p-3 text-center">
                  <FileText className="w-5 h-5 text-purple-600 mx-auto mb-1" />
                  <p className="text-xl font-bold text-foreground">{job.estimates?.length || 0}</p>
                  <p className="text-xs text-muted-foreground">Estimates</p>
                </div>
              </div>

              {/* Drying chart + latest reading */}
              {drying.length > 0 && (
                <div className="space-y-3">
                  <DryingChart records={drying} />
                  {latest && (
                    <div>
                      <p className="text-sm font-semibold mb-2">Latest Drying Log (Day {latest.day_number})</p>
                      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { label: "Date", value: fmtDate(latest.reading_date) },
                          { label: "Temp °F", value: latest.temp_f ? `${latest.temp_f}°F` : "—" },
                          { label: "RH %", value: latest.rh_pct ? `${latest.rh_pct}%` : "—" },
                          { label: "Dry Standard", value: latest.structural_drying_complete ? "Met" : latest.drying_goal_met ? "On Track" : "In Progress" },
                        ].map(f => (
                          <div key={f.label}>
                            <p className="text-xs text-blue-600 dark:text-blue-300">{f.label}</p>
                            <p className="text-sm font-medium text-foreground">{f.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Equipment log */}
              {(equipLog.length > 0 || equipOnSite.length > 0) && (
                <div>
                  <p className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Fan className="w-4 h-4 text-[hsl(var(--titan-blue))]" />Equipment Log</p>
                  <div className="rounded-lg border overflow-hidden">
                    <div className="grid grid-cols-4 bg-muted px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      <span className="col-span-2">Unit</span><span>Deployed</span><span>Days</span>
                    </div>
                    {(equipLog.length ? equipLog : equipOnSite.map((e: any) => ({ ...e, days_out: null, returned_at: null }))).map((e: any, i: number) => (
                      <div key={e.id || i} className={`grid grid-cols-4 px-3 py-2 text-xs border-t ${i % 2 ? "bg-muted/20" : ""}`}>
                        <span className="col-span-2 font-medium">{EQUIP_LABELS[e.category] || e.name || "Equipment"}{e.model ? ` · ${e.model}` : ""}</span>
                        <span className="text-muted-foreground">{fmtDate(e.deployed_at)}</span>
                        <span>{e.days_out != null ? `${e.days_out}d` : e.returned_at ? "—" : "On-site"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Photo browser */}
              <PhotoBrowser photos={job.photos || []} />

              {/* Estimates */}
              {job.estimates?.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-2">Estimates</p>
                  <div className="space-y-2">
                    {job.estimates.map((e: any) => (
                      <div key={e.id} className="flex items-center justify-between py-2 px-3 bg-muted/30 rounded-lg">
                        <span className="text-sm text-foreground">{e.title}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{fmt$(e.total)}</span>
                          <Badge variant={e.status === "approved" ? "default" : "secondary"} className="capitalize">{e.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Supplements — adjuster can respond */}
              {supplements.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Send className="w-4 h-4 text-[hsl(var(--titan-red))]" />Supplement Requests</p>
                  <div className="space-y-3">
                    {supplements.map((s: any) => (
                      <SupplementResponse key={s.id} supp={s} token={token} />
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          );
        })}

        {/* Footer */}
        <div className="text-center py-4 border-t border-border">
          <p className="text-sm text-muted-foreground">Titan Restoration LLC · 706-922-0154 · cody@titanrestorationllc.com</p>
          <p className="text-xs text-muted-foreground mt-1">This is a secure, read-only documentation view. Contact us for questions.</p>
        </div>
      </div>
    </div>
  );
}
