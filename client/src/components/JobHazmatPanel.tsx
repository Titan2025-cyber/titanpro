import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  FlaskConical, Scan, ShieldCheck, AlertTriangle, Trash2, FileWarning, CheckCircle2, RefreshCw,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { fmtDateShort } from "@/lib/dates";

/**
 * JobHazmatPanel — per-job Lead & Asbestos (and mold) risk detection.
 *
 * Backed by the existing hazmat_flags table and the two endpoints in
 * server/routes_suite5.ts:
 *   POST /api/hazmat-flags/auto-scan/:jobId — reads jobs.year_built + loss_type
 *     and inserts flags for pre-1978 lead paint, pre-1980 asbestos, and any
 *     mold-typed loss. Idempotent per (jobId, flagType) so repeat clicks are
 *     safe.
 *   PATCH /api/hazmat-flags/:id — acknowledge.
 *   DELETE /api/hazmat-flags/:id — remove.
 *
 * Replaces the global AI Agent Center "Lead & Asbestos" tab. The screen the
 * operator actually needs this on IS the job, so we scan only this job's
 * data and show only this job's flags. No cross-job scanning here.
 */

type Flag = {
  id: number;
  jobId: number;
  flagType: string;           // 'lead_rp' | 'asbestos' | 'mold' | ...
  riskLevel: string;          // 'low' | 'medium' | 'high'
  yearBuilt: number | null;
  autoDetected: number;
  acknowledged: number;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  documentationRequired: string | null;
  notes: string | null;
  createdAt: string;
};

const FLAG_META: Record<string, { label: string; icon: any; blurb: string }> = {
  lead_rp: {
    label: "Lead-Based Paint (EPA RRP)",
    icon: FlaskConical,
    blurb: "Pre-1978 structures fall under EPA's Renovation, Repair, and Painting rule. Certified renovator required on-site; homeowner must receive the Renovate Right pamphlet.",
  },
  asbestos: {
    label: "Asbestos-Containing Materials",
    icon: AlertTriangle,
    blurb: "Pre-1980 structures require asbestos assessment before any demolition per OSHA 1926.1101 and state regulations.",
  },
  mold: {
    label: "Mold (IICRC S520)",
    icon: FileWarning,
    blurb: "IICRC S520 requires pre-remediation air sampling and a post-clearance report on all mold jobs.",
  },
};

function riskBadge(r: string) {
  if (r === "high") return "bg-red-600 text-white";
  if (r === "medium") return "bg-amber-500 text-white";
  return "bg-slate-500 text-white";
}

export default function JobHazmatPanel({
  jobId,
  yearBuilt,
  lossType,
}: {
  jobId: number;
  /** For the "why did nothing get flagged?" hint when yearBuilt is missing. */
  yearBuilt?: number | null;
  lossType?: string | null;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const canDelete = user?.role === "owner" || user?.role === "admin";

  const { data: flags = [], isLoading } = useQuery<Flag[]>({
    queryKey: ["/api/hazmat-flags", { jobId }],
    queryFn: () => apiRequest("GET", `/api/hazmat-flags?jobId=${jobId}`).then(r => r.json()),
  });

  const scan = useMutation({
    mutationFn: () => apiRequest("POST", `/api/hazmat-flags/auto-scan/${jobId}`, {}).then(r => r.json()),
    onSuccess: (d: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hazmat-flags"] });
      const added = Array.isArray(d?.flags) ? d.flags.length : 0;
      toast({
        title: added > 0 ? `Added ${added} flag(s)` : "No new flags",
        description: added > 0
          ? "Review each one below and acknowledge when documented."
          : (yearBuilt
              ? "Nothing new to flag based on year built and loss type."
              : "Set the job's Year Built to enable lead/asbestos detection."),
      });
    },
    onError: (e: any) => toast({
      title: "Scan failed",
      description: String(e?.message || e),
      variant: "destructive",
    }),
  });

  const ack = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/hazmat-flags/${id}`, {
      acknowledged: 1,
      acknowledged_by: user?.name || user?.email || "unknown",
      acknowledged_at: new Date().toISOString(),
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hazmat-flags"] });
      toast({ title: "Flag acknowledged" });
    },
    onError: (e: any) => toast({
      title: "Acknowledge failed",
      description: String(e?.message || e),
      variant: "destructive",
    }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/hazmat-flags/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hazmat-flags"] });
      toast({ title: "Flag removed" });
    },
    onError: (e: any) => toast({
      title: "Delete failed",
      description: String(e?.message || e),
      variant: "destructive",
    }),
  });

  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0, unack: 0 };
    for (const f of flags) {
      if (f.riskLevel === "high") c.high++;
      else if (f.riskLevel === "medium") c.medium++;
      else c.low++;
      if (!f.acknowledged) c.unack++;
    }
    return c;
  }, [flags]);

  // Detection is driven by these two fields. Surface them so the operator
  // knows what the scan is looking at before they click.
  const hasEnoughToScan = !!yearBuilt || (lossType || "").toLowerCase() === "mold";

  return (
    <div className="space-y-4">
      {/* Header row: rescan on the right, quick context on the left. */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
            <h3 className="text-sm font-semibold">Lead &amp; Asbestos Assessment</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Reads this job's <span className="font-medium">Year Built</span>
            {" "}and <span className="font-medium">Loss Type</span> to flag
            EPA RRP lead-paint (pre-1978), asbestos assessment (pre-1980),
            and IICRC S520 mold documentation requirements. Idempotent —
            re-running only adds new flags.
          </p>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>Year Built: <span className="font-medium text-foreground">{yearBuilt || "—"}</span></span>
            <span>Loss Type: <span className="font-medium text-foreground capitalize">{lossType || "—"}</span></span>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => scan.mutate()}
          disabled={scan.isPending}
          data-testid="button-hazmat-scan"
        >
          {scan.isPending
            ? <><RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />Scanning…</>
            : <><Scan className="w-3.5 h-3.5 mr-1" />{flags.length > 0 ? "Rescan" : "Scan this job"}</>}
        </Button>
      </div>

      {/* Rollup */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Total Flags</p>
          <p className="text-xl font-bold" data-testid="hazmat-count-total">{flags.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">High Risk</p>
          <p className={`text-xl font-bold ${counts.high > 0 ? "text-red-600" : "text-muted-foreground"}`} data-testid="hazmat-count-high">{counts.high}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Medium Risk</p>
          <p className={`text-xl font-bold ${counts.medium > 0 ? "text-amber-600" : "text-muted-foreground"}`} data-testid="hazmat-count-medium">{counts.medium}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground">Unacknowledged</p>
          <p className={`text-xl font-bold ${counts.unack > 0 ? "text-[hsl(var(--titan-red))]" : "text-green-600"}`} data-testid="hazmat-count-unack">{counts.unack}</p>
        </CardContent></Card>
      </div>

      {/* Body */}
      {isLoading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading flags…</CardContent></Card>
      ) : flags.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <ShieldCheck className={`w-8 h-8 mx-auto mb-2 ${hasEnoughToScan ? "text-green-600" : "text-muted-foreground"}`} />
            <p className="font-medium text-sm">
              {hasEnoughToScan
                ? "No lead or asbestos flags on this job."
                : "Missing data to scan."}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              {hasEnoughToScan
                ? <>Click <span className="font-medium">Scan this job</span> to check for pre-1978 lead paint, pre-1980 asbestos, and mold-related documentation requirements.</>
                : <>Set the job's <span className="font-medium">Year Built</span> on the Overview tab so lead and asbestos rules can apply. Mold-typed losses will flag automatically.</>}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {flags.map(f => {
            const meta = FLAG_META[f.flagType] || {
              label: f.flagType.replace(/_/g, " "),
              icon: AlertTriangle,
              blurb: "",
            };
            const Icon = meta.icon;
            return (
              <Card key={f.id} data-testid={`hazmat-flag-${f.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${riskBadge(f.riskLevel)}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{meta.label}</span>
                          <Badge className={riskBadge(f.riskLevel)}>{f.riskLevel} risk</Badge>
                          {f.autoDetected ? <Badge variant="outline" className="text-[10px]">Auto</Badge> : <Badge variant="outline" className="text-[10px]">Manual</Badge>}
                          {f.acknowledged ? (
                            <Badge variant="outline" className="text-[10px] text-green-700 border-green-600/40">
                              <CheckCircle2 className="w-3 h-3 mr-1" />Acknowledged
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-[hsl(var(--titan-red))] border-[hsl(var(--titan-red))]/40">
                              Needs review
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                          {f.yearBuilt && <span>Structure built {f.yearBuilt}</span>}
                          {f.createdAt && <span>· Detected {fmtDateShort(f.createdAt)}</span>}
                          {f.acknowledged && f.acknowledgedBy && (
                            <span>· Ack by {f.acknowledgedBy}{f.acknowledgedAt ? ` on ${fmtDateShort(f.acknowledgedAt)}` : ""}</span>
                          )}
                        </div>
                        {f.notes && <p className="text-sm mt-2 whitespace-pre-wrap">{f.notes}</p>}
                        {meta.blurb && <p className="text-xs text-muted-foreground mt-2 italic">{meta.blurb}</p>}
                        {f.documentationRequired && (
                          <div className="mt-2 rounded-md border border-border/60 bg-muted/30 p-2">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">Documentation required</p>
                            <p className="text-xs whitespace-pre-wrap">{f.documentationRequired}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!f.acknowledged && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => ack.mutate(f.id)}
                          disabled={ack.isPending}
                          data-testid={`button-ack-hazmat-${f.id}`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />Acknowledge
                        </Button>
                      )}
                      {canDelete && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Delete flag" data-testid={`button-delete-hazmat-${f.id}`}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete this flag?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Removes the {meta.label} flag from this job.
                                {f.autoDetected ? " A rescan will re-add it if the underlying job data still qualifies." : ""}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => del.mutate(f.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
