/**
 * CustomerPortal.tsx — Homeowner self-service portal
 *
 * Tabs per job:
 *   1. Status       — progress bar + milestone dates
 *   2. Updates      — public notes from Titan team
 *   3. Documents    — signed work auths, deviation forms, uploaded PDFs
 *   4. Reports      — estimates (sent/approved) + drying record summary
 *   5. Invoices     — invoice list + pay online
 */
import { useState, useRef, useEffect } from "react";
import titanLogo from "@/assets/titan-logo.png";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Home, Phone, FileText, CreditCard, MessageSquare, Globe,
  Clock, ChevronDown, ChevronUp, CheckCircle, FileCheck,
  Droplets, BarChart2, AlertCircle, Download, Shield,
  CalendarDays, User, Thermometer, Wind, LogOut,
  Info, ArrowRight, Fan, Send, HelpCircle, Sparkles, Gauge, Landmark
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Job, Invoice, Contact } from "@shared/schema";
import { StageExplainer, NextActionPanel, MoistureVisualization, EquipmentTracker, MessageThread, InsuranceAdvocacy } from "./CustomerPortalParts";

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt$ = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n || 0);
const fmtDate = (s?: string | null) => s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  mitigation: "bg-yellow-100 text-yellow-800",
  drying: "bg-orange-100 text-orange-800",
  reconstruction: "bg-purple-100 text-purple-800",
  complete: "bg-green-100 text-green-800",
  closed: "bg-gray-100 text-gray-600",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New", mitigation: "Mitigation", drying: "Drying",
  reconstruction: "Reconstruction", complete: "Complete", closed: "Closed",
};

const STATUS_STEPS = [
  { key: "new",            label: "Opened" },
  { key: "mitigation",     label: "Mitigation" },
  { key: "drying",         label: "Drying" },
  { key: "reconstruction", label: "Rebuild" },
  { key: "complete",       label: "Done" },
];

const DOC_TYPE_LABELS: Record<string, string> = {
  work_authorization: "Work Authorization",
  deviation_of_standard: "Deviation of Standard",
  pdf_upload: "Uploaded Document",
  other: "Document",
};

const DOC_ICONS: Record<string, any> = {
  work_authorization: Shield,
  deviation_of_standard: AlertCircle,
  pdf_upload: FileText,
  other: FileText,
};

// ── Progress Bar ──────────────────────────────────────────────────────────────
function ProgressBar({ status }: { status: string }) {
  const idx = STATUS_STEPS.findIndex(s => s.key === status);
  return (
    <div className="mt-3">
      <div className="flex items-center">
        {STATUS_STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center flex-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 z-10 transition-colors ${
              i < idx ? "bg-[hsl(var(--titan-red))] text-white" :
              i === idx ? "bg-[hsl(var(--titan-red))] text-white ring-4 ring-[hsl(var(--titan-red)/0.25)]" :
              "bg-muted text-muted-foreground"
            }`}>
              {i < idx ? <CheckCircle className="w-4 h-4" /> : i + 1}
            </div>
            {i < STATUS_STEPS.length - 1 && (
              <div className={`flex-1 h-1.5 transition-colors ${i < idx ? "bg-[hsl(var(--titan-red))]" : "bg-muted"}`} />
            )}
          </div>
        ))}
      </div>
      <div className="flex mt-1.5">
        {STATUS_STEPS.map((s, i) => (
          <div key={s.key} className="flex-1 text-center first:text-left last:text-right">
            <span className={`text-[10px] font-medium ${i === idx ? "text-[hsl(var(--titan-red))] font-bold" : "text-muted-foreground"}`}>
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Job Detail Tabs ───────────────────────────────────────────────────────────
function JobDetailTabs({ job, invoices, onPay, contactId, contactName }: { job: Job; invoices: Invoice[]; onPay: (inv: Invoice) => void; contactId: number; contactName: string }) {
  const myInvoices = invoices.filter(i => i.jobId === job.id);

  const { data: detail, isLoading } = useQuery<{
    notes: any[];
    docs: any[];
    estimates: any[];
    dryingRecords: any[];
    docusketch: { projectName: string; tourUrl: string; sketchUrl: string; completedAt: string; status: string } | null;
    equipmentOnSite: any[];
    deploymentLog: any[];
    messages: any[];
    nextAction: { title: string; detail: string; who: string } | null;
    dryingComplete: boolean;
    claim: any | null;
  }>({
    queryKey: ["/api/customer-portal/job-detail", job.id],
    queryFn: () => apiRequest("GET", `/api/customer-portal/job-detail/${job.id}`).then(r => r.json()),
    staleTime: 0,
  });

  const notes       = detail?.notes || [];
  const docs        = detail?.docs || [];
  const estimates   = detail?.estimates || [];
  const dryingRecs  = detail?.dryingRecords || [];
  const docusketch  = detail?.docusketch || null;
  const equipmentOnSite = detail?.equipmentOnSite || [];
  const deploymentLog   = detail?.deploymentLog || [];
  const messages        = detail?.messages || [];
  const nextAction      = detail?.nextAction || null;
  const claim           = detail?.claim || null;

  return (
    <Tabs defaultValue="status">
      <TabsList className="w-full h-auto flex flex-wrap gap-1 bg-muted/50 p-1 rounded-lg mb-3">
        <TabsTrigger value="status"    className="flex-1 text-xs py-1.5">Status</TabsTrigger>
        <TabsTrigger value="updates"   className="flex-1 text-xs py-1.5">
          Updates {notes.length > 0 && <Badge className="ml-1 h-4 text-[10px] px-1 bg-[hsl(var(--titan-blue))] text-white">{notes.length}</Badge>}
        </TabsTrigger>
        <TabsTrigger value="documents" className="flex-1 text-xs py-1.5">
          Docs {docs.length > 0 && <Badge className="ml-1 h-4 text-[10px] px-1">{docs.length}</Badge>}
        </TabsTrigger>
        <TabsTrigger value="insurance" className="flex-1 text-xs py-1.5">Insurance</TabsTrigger>
        <TabsTrigger value="reports"   className="flex-1 text-xs py-1.5">Reports</TabsTrigger>
        <TabsTrigger value="invoices"  className="flex-1 text-xs py-1.5">
          Invoices {myInvoices.length > 0 && <Badge className="ml-1 h-4 text-[10px] px-1">{myInvoices.length}</Badge>}
        </TabsTrigger>
        <TabsTrigger value="messages"  className="flex-1 text-xs py-1.5">
          Messages {messages.length > 0 && <Badge className="ml-1 h-4 text-[10px] px-1 bg-[hsl(var(--titan-red))] text-white">{messages.length}</Badge>}
        </TabsTrigger>
      </TabsList>

      {/* ── STATUS ──────────────────────────────────────────────────────────── */}
      <TabsContent value="status" className="space-y-3">
        <ProgressBar status={job.status} />

        {/* Next Action — what happens next, at a glance */}
        {nextAction && <NextActionPanel action={nextAction} />}

        {/* Claim Stage Explainer — plain-English education */}
        <StageExplainer status={job.status} />

        <div className="grid grid-cols-2 gap-2 mt-3">
          {[
            { label: "Job Number",  value: job.jobNumber },
            { label: "Loss Type",   value: job.lossType ? job.lossType.charAt(0).toUpperCase() + job.lossType.slice(1) : "—" },
            { label: "Carrier",     value: job.insuranceCarrier || "Not on file" },
            { label: "Claim #",     value: (job as any).claimNumber || "—" },
            { label: "Tech",        value: job.assignedTech || "TBD" },
          ].map(row => (
            <div key={row.label} className="bg-muted/40 rounded-lg p-2.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{row.label}</p>
              <p className="text-sm font-semibold mt-0.5">{row.value}</p>
            </div>
          ))}
        </div>

        {/* Milestone dates */}
        {((job as any).mitigationStart || (job as any).dryOutComplete || (job as any).reconstructionStart || (job as any).jobComplete) && (
          <div className="space-y-1.5 pt-2 border-t">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Milestones</p>
            {(job as any).mitigationStart    && <MilestoneRow icon={CalendarDays} label="Mitigation started"  date={(job as any).mitigationStart} />}
            {(job as any).dryOutComplete     && <MilestoneRow icon={CheckCircle}  label="Dry-out complete"     date={(job as any).dryOutComplete} done />}
            {(job as any).reconstructionStart && <MilestoneRow icon={CalendarDays} label="Rebuild started"     date={(job as any).reconstructionStart} />}
            {(job as any).jobComplete        && <MilestoneRow icon={CheckCircle}  label="Job complete"         date={(job as any).jobComplete} done />}
          </div>
        )}
      </TabsContent>

      {/* ── UPDATES ─────────────────────────────────────────────────────────── */}
      <TabsContent value="updates">
        {isLoading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Loading updates…</p>
        ) : notes.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-medium">No updates yet</p>
            <p className="text-xs">We'll post status updates here as work progresses.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {notes.map((note: any) => (
              <div key={note.id} className="border rounded-xl p-3.5 bg-blue-50/40 dark:bg-blue-950/10 border-blue-200 dark:border-blue-800">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-[hsl(var(--titan-blue))]" />
                    <span className="text-xs font-semibold text-[hsl(var(--titan-blue))]">{note.author}</span>
                    {note.tag && <Badge className="text-[10px] h-4 px-1.5 capitalize">{note.tag}</Badge>}
                  </div>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />{fmtDate(note.created_at || note.createdAt)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{note.body}</p>
              </div>
            ))}
          </div>
        )}
      </TabsContent>

      {/* ── DOCUMENTS ───────────────────────────────────────────────────────── */}
      <TabsContent value="documents">
        {/* DocuSketch 360° Scan — shown when complete */}
        {docusketch && (
          <div className="mb-4 rounded-xl border-2 border-blue-200 dark:border-blue-800 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-blue-600 text-white">
              <span className="text-sm font-semibold flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" /></svg>
                DocuSketch 360° Scan
                {docusketch.projectName && <span className="font-normal opacity-80">— {docusketch.projectName}</span>}
              </span>
              <div className="flex items-center gap-2">
                {docusketch.tourUrl && (
                  <button onClick={() => window.open(docusketch.tourUrl, "_blank")} className="text-xs bg-white/20 hover:bg-white/30 px-2 py-1 rounded flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    Open Full Screen
                  </button>
                )}
                {docusketch.sketchUrl && (
                  <button onClick={() => window.open(docusketch.sketchUrl, "_blank")} className="text-xs bg-white/20 hover:bg-white/30 px-2 py-1 rounded flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    Download Sketch
                  </button>
                )}
              </div>
            </div>
            {docusketch.tourUrl ? (
              <iframe
                src={docusketch.tourUrl}
                className="w-full"
                style={{ height: "380px", border: "none", background: "#000" }}
                allow="fullscreen; xr-spatial-tracking"
                loading="lazy"
                title="DocuSketch 360° Tour"
              />
            ) : (
              <div className="p-4 text-sm text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30">
                360° scan complete. Tour link coming soon.
              </div>
            )}
            {docusketch.completedAt && (
              <div className="px-4 py-2 bg-muted/40 text-xs text-muted-foreground border-t">
                Scan completed {new Date(docusketch.completedAt).toLocaleDateString()}
              </div>
            )}
          </div>
        )}
        {isLoading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Loading documents…</p>
        ) : docs.length === 0 && !docusketch ? (
          <div className="text-center py-10 text-muted-foreground">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-medium">No documents yet</p>
            <p className="text-xs">Signed authorizations and uploaded files will appear here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map((doc: any) => {
              const DocIcon = DOC_ICONS[doc.doc_type || doc.docType] || FileText;
              const docType = doc.doc_type || doc.docType;
              const isSigned = doc.status === "signed";
              const isUploaded = doc.status === "uploaded";
              return (
                <div key={doc.id} className="flex items-start gap-3 p-3.5 rounded-xl border bg-muted/20">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isSigned ? "bg-green-100 dark:bg-green-900/30" : isUploaded ? "bg-blue-100 dark:bg-blue-900/30" : "bg-muted"}`}>
                    <DocIcon className={`w-4.5 h-4.5 ${isSigned ? "text-green-600" : isUploaded ? "text-blue-600" : "text-muted-foreground"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-snug">{doc.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{DOC_TYPE_LABELS[docType] || "Document"}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      {isSigned && (
                        <Badge className="bg-green-100 text-green-700 border-green-300 text-[10px]">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Signed {doc.signer_name ? `by ${doc.signer_name}` : ""} {doc.signed_at ? `· ${fmtDate(doc.signed_at)}` : ""}
                        </Badge>
                      )}
                      {isUploaded && (
                        <Badge className="bg-blue-100 text-blue-700 border-blue-300 text-[10px]">
                          <FileText className="w-3 h-3 mr-1" />
                          {doc.file_name || doc.fileName || "File"}
                        </Badge>
                      )}
                      {!isSigned && !isUploaded && (
                        <Badge variant="outline" className="text-[10px]">Pending signature</Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground">{fmtDate(doc.created_at || doc.createdAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </TabsContent>

      {/* ── INSURANCE ADVOCACY ──────────────────────────────────────────────── */}
      <TabsContent value="insurance">
        {isLoading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Loading your claim details…</p>
        ) : (
          <InsuranceAdvocacy claim={claim} />
        )}
      </TabsContent>

      {/* ── REPORTS ─────────────────────────────────────────────────────────── */}
      <TabsContent value="reports" className="space-y-5">
        {isLoading ? (
          <p className="text-xs text-muted-foreground py-4 text-center">Loading reports…</p>
        ) : (
          <>
            {/* Estimates */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <FileCheck className="w-3.5 h-3.5" />Estimates
              </p>
              {estimates.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No estimates shared yet.</p>
              ) : (
                <div className="space-y-2">
                  {estimates.map((est: any) => (
                    <div key={est.id} className="border rounded-xl p-3.5 bg-muted/20">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">{est.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(est.created_at || est.createdAt)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-[hsl(var(--titan-blue))]">{fmt$(est.total)}</p>
                          <Badge className={`text-[10px] ${est.status === "approved" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                            {est.status === "approved" ? "✓ Approved" : "Sent for Review"}
                          </Badge>
                        </div>
                      </div>
                      {est.notes && <p className="text-xs text-muted-foreground mt-2 pt-2 border-t">{est.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Equipment on-site */}
            <EquipmentTracker equipment={equipmentOnSite} deploymentLog={deploymentLog} />

            {/* Moisture visualization */}
            {dryingRecs.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <BarChart2 className="w-3.5 h-3.5" />Moisture &amp; Drying Progress
                </p>
                <MoistureVisualization records={dryingRecs} />
              </div>
            )}

            {/* Drying Records */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Droplets className="w-3.5 h-3.5" />Daily Drying Log
              </p>
              {dryingRecs.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No drying records yet.</p>
              ) : (
                <>
                  <div className="rounded-xl border overflow-hidden">
                    <div className="grid grid-cols-5 bg-muted px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                      <span>Day</span>
                      <span>Date</span>
                      <span className="flex items-center gap-1"><Thermometer className="w-3 h-3" />Temp</span>
                      <span className="flex items-center gap-1"><Wind className="w-3 h-3" />RH%</span>
                      <span>Status</span>
                    </div>
                    {dryingRecs.map((rec: any, i: number) => {
                      const complete = rec.structural_drying_complete ?? rec.structuralDryingComplete;
                      const goalMet = rec.drying_goal_met ?? rec.dryingGoalMet;
                      const statusLabel = complete ? "Dry" : goalMet ? "On track" : "Drying";
                      const statusClass = complete ? "text-green-600" : goalMet ? "text-[hsl(var(--titan-blue))]" : "text-orange-600";
                      return (
                        <div key={rec.id} className={`grid grid-cols-5 px-3 py-2 text-xs border-t ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                          <span className="font-semibold">Day {rec.day_number || rec.dayNumber || i + 1}</span>
                          <span className="text-muted-foreground">{fmtDate(rec.reading_date || rec.readingDate)}</span>
                          <span>{rec.temp_f || rec.tempF ? `${rec.temp_f || rec.tempF}°F` : "—"}</span>
                          <span>{rec.rh_pct || rec.rhPct ? `${rec.rh_pct || rec.rhPct}%` : "—"}</span>
                          <span className={`font-semibold ${statusClass}`}>{statusLabel}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    {dryingRecs.length} reading{dryingRecs.length !== 1 ? "s" : ""} logged · Equipment monitored daily per IICRC S500 protocol
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </TabsContent>

      {/* ── INVOICES ────────────────────────────────────────────────────────── */}
      <TabsContent value="invoices">
        {myInvoices.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-medium">No invoices yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {myInvoices.map(inv => (
              <div key={inv.id} className="border rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-bold text-sm">{inv.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground">Due: {fmtDate(inv.dueDate)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-[hsl(var(--titan-blue))]">{fmt$(inv.total || 0)}</p>
                    <Badge className={inv.status === "paid" ? "bg-green-100 text-green-700 text-xs" : "bg-yellow-100 text-yellow-700 text-xs"}>
                      {inv.status === "paid" ? `✓ Paid ${fmtDate(inv.paidAt)}` : inv.status}
                    </Badge>
                  </div>
                </div>
                {inv.status !== "paid" && (
                  <Button className="w-full mt-2 bg-green-600 hover:bg-green-700 text-white" onClick={() => onPay(inv)}>
                    <CreditCard className="w-4 h-4 mr-2" />Pay Now — {fmt$(inv.total || 0)}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </TabsContent>

      {/* MESSAGES */}
      <TabsContent value="messages">
        <MessageThread jobId={job.id} contactId={contactId} authorName={contactName} initial={messages} />
      </TabsContent>
    </Tabs>
  );
}

// ── Bank Payout Timeline (customer-facing) ─────────────────────────────────────
// Shows each Stripe card payment and where the money is on its way to Titan's
// bank account: captured → in transit → deposited (Stripe standard 2-day payout).
type PayoutRow = {
  sessionId: string; invoiceId: number; invoiceNumber: string | null;
  amount: number; fee: number; net: number; cardLast4: string | null;
  paidAt: string | null; payoutStatus: "pending" | "in_transit" | "paid"; payoutArrival: string | null;
};

const PAYOUT_STEPS: { key: PayoutRow["payoutStatus"]; label: string; sub: string }[] = [
  { key: "pending",    label: "Payment captured", sub: "Card charged successfully" },
  { key: "in_transit", label: "In transit",       sub: "On its way to the bank" },
  { key: "paid",       label: "Deposited",         sub: "Funds in Titan's account" },
];
const PAYOUT_ORDER: Record<PayoutRow["payoutStatus"], number> = { pending: 0, in_transit: 1, paid: 2 };
const PAYOUT_BADGE: Record<PayoutRow["payoutStatus"], string> = {
  pending: "bg-blue-100 text-blue-700",
  in_transit: "bg-amber-100 text-amber-700",
  paid: "bg-green-100 text-green-700",
};
const PAYOUT_BADGE_LABEL: Record<PayoutRow["payoutStatus"], string> = {
  pending: "Captured", in_transit: "In transit", paid: "Deposited",
};

function PayoutTimeline({ contactId }: { contactId: number }) {
  const { data: payouts = [], isLoading } = useQuery<PayoutRow[]>({
    queryKey: ["/api/customer-portal/payouts", contactId],
    enabled: !!contactId,
    queryFn: () => apiRequest("GET", `/api/customer-portal/stripe/payouts/${contactId}`).then(r => r.json()),
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-2">
          <div className="h-4 w-40 bg-muted rounded animate-pulse" />
          <div className="h-16 bg-muted/60 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }
  if (!payouts.length) return null;

  return (
    <Card className="shadow-sm" data-testid="card-payout-timeline">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
          Card Payments &amp; Bank Deposits
        </CardTitle>
        <p className="text-xs text-muted-foreground">Track your online card payments as they clear to Titan's bank via Stripe.</p>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        {payouts.map((p) => {
          const stepIdx = PAYOUT_ORDER[p.payoutStatus];
          return (
            <div key={p.sessionId} className="border rounded-xl p-3.5" data-testid={`row-payout-${p.sessionId}`}>
              <div className="flex items-center justify-between mb-1">
                <div>
                  <p className="font-bold text-sm">{p.invoiceNumber || `Invoice #${p.invoiceId}`}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDate(p.paidAt)} · Visa ending {p.cardLast4 || "••••"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-[hsl(var(--titan-blue))]">{fmt$(p.amount)}</p>
                  <Badge className={`${PAYOUT_BADGE[p.payoutStatus]} text-xs`}>{PAYOUT_BADGE_LABEL[p.payoutStatus]}</Badge>
                </div>
              </div>

              {/* Timeline */}
              <div className="flex items-center gap-1.5 mt-3 mb-2">
                {PAYOUT_STEPS.map((step, i) => {
                  const reached = i <= stepIdx;
                  return (
                    <div key={step.key} className="flex items-center flex-1 last:flex-none">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${reached ? "bg-[hsl(var(--titan-blue))] text-white" : "bg-muted text-muted-foreground"}`}>
                        {reached ? <CheckCircle className="w-3.5 h-3.5" /> : <span className="text-[10px] font-bold">{i + 1}</span>}
                      </div>
                      {i < PAYOUT_STEPS.length - 1 && (
                        <div className={`h-0.5 flex-1 mx-1 ${i < stepIdx ? "bg-[hsl(var(--titan-blue))]" : "bg-muted"}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-start justify-between gap-2">
                {PAYOUT_STEPS.map((step, i) => (
                  <div key={step.key} className={`flex-1 ${i === PAYOUT_STEPS.length - 1 ? "text-right" : i === 1 ? "text-center" : ""}`}>
                    <p className={`text-[11px] font-semibold ${i <= stepIdx ? "" : "text-muted-foreground"}`}>{step.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">{step.sub}</p>
                  </div>
                ))}
              </div>

              {p.payoutStatus !== "paid" && p.payoutArrival && (
                <p className="text-[11px] text-muted-foreground mt-2.5 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Estimated deposit by {fmtDate(p.payoutArrival)}
                </p>
              )}
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-2 pt-2 border-t">
                <span>Processing fee: {fmt$(p.fee)}</span>
                <span>Net to Titan: <span className="font-semibold text-foreground">{fmt$(p.net)}</span></span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function MilestoneRow({ icon: Icon, label, date, done }: { icon: any; label: string; date: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs py-1.5">
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${done ? "text-green-600" : "text-[hsl(var(--titan-blue))]"}`} />
      <span className="text-muted-foreground flex-1">{label}</span>
      <span className={`font-semibold ${done ? "text-green-600" : ""}`}>{fmtDate(date)}</span>
    </div>
  );
}

// ── Pay Modal — Stripe Checkout flow (test mode) ───────────────────────────────
// "Pay Now" opens a Stripe-hosted checkout in a new tab. We listen for the
// return page's postMessage AND poll the session endpoint as a fallback
// (in case the popup is blocked or postMessage never arrives).
function PayModal({ invoice, contactId, onClose }: { invoice: Invoice; contactId: number; onClose: () => void }) {
  const [phase, setPhase] = useState<"idle" | "starting" | "awaiting" | "paid" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const sessionRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const winRef = useRef<Window | null>(null);

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const markPaid = () => {
    stopPolling();
    setPhase("paid");
    queryClient.invalidateQueries({ queryKey: ["/api/customer-portal/invoices"] });
    queryClient.invalidateQueries({ queryKey: ["/api/customer-portal/payouts"] });
  };

  // Listen for the checkout return page signalling back to the opener.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.type !== "stripe-checkout") return;
      if (sessionRef.current && d.sessionId && d.sessionId !== sessionRef.current) return;
      if (d.outcome === "paid") markPaid();
      else if (d.outcome === "canceled") { stopPolling(); setPhase("idle"); }
    };
    window.addEventListener("message", onMsg);
    return () => { window.removeEventListener("message", onMsg); stopPolling(); };
  }, []);

  const startCheckout = async () => {
    setPhase("starting"); setErrorMsg("");
    try {
      const res = await apiRequest("POST", "/api/customer-portal/stripe/create-checkout", {
        invoiceId: invoice.id, contactId,
      }).then(r => r.json());
      if (res.error) { setErrorMsg(res.error); setPhase("error"); return; }
      sessionRef.current = res.sessionId;
      setPhase("awaiting");
      // Open Stripe checkout in a new tab
      winRef.current = window.open(res.checkoutUrl, "_blank");
      // Fallback poll: check session status every 2.5s until paid
      stopPolling();
      pollRef.current = setInterval(async () => {
        if (!sessionRef.current) return;
        try {
          const s = await apiRequest("GET", `/api/customer-portal/stripe/session/${sessionRef.current}`).then(r => r.json());
          if (s.status === "paid") markPaid();
        } catch { /* keep polling */ }
      }, 2500);
    } catch {
      setErrorMsg("Could not start checkout. Please try again or call us.");
      setPhase("error");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-background rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-xl" data-testid="modal-pay">
        <div className="flex items-center justify-between">
          <h3 className="font-bold">Pay Invoice</h3>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose} data-testid="button-pay-close">✕</Button>
        </div>
        <div className="p-3 rounded-xl bg-muted/40 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{invoice.invoiceNumber}</span>
          <span className="text-xl font-bold">{fmt$(invoice.total || 0)}</span>
        </div>

        {phase === "paid" ? (
          <div className="text-center py-4 space-y-2" data-testid="status-pay-success">
            <CheckCircle className="w-12 h-12 mx-auto text-green-600" />
            <p className="font-bold text-green-700">Payment received</p>
            <p className="text-xs text-muted-foreground">Thank you. Your invoice is now marked paid and a receipt is on its way.</p>
            <Button className="w-full bg-[hsl(var(--titan-blue))] text-white font-semibold mt-2" onClick={onClose} data-testid="button-pay-done">Done</Button>
          </div>
        ) : phase === "awaiting" ? (
          <div className="text-center py-3 space-y-3" data-testid="status-pay-awaiting">
            <div className="w-10 h-10 mx-auto border-3 border-[hsl(var(--titan-blue))] border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-semibold">Complete your payment in the Stripe window</p>
            <p className="text-xs text-muted-foreground">A secure Stripe checkout opened in a new tab. This screen updates automatically once your payment goes through.</p>
            <Button variant="outline" size="sm" className="w-full" onClick={() => { if (winRef.current) winRef.current.focus(); }} data-testid="button-reopen-checkout">
              Reopen checkout window
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg p-2.5">
              <Shield className="w-4 h-4 text-[hsl(var(--titan-blue))] flex-shrink-0" />
              <span>Pay securely by card. Powered by <span className="font-semibold">Stripe</span>.{" "}Your card details are entered on Stripe's secure page — never stored by Titan.</span>
            </div>
            {phase === "error" && (
              <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-lg p-2.5" data-testid="status-pay-error">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{errorMsg}
              </div>
            )}
            <Button className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold"
              onClick={startCheckout} disabled={phase === "starting"} data-testid="button-stripe-pay">
              <CreditCard className="w-4 h-4 mr-2" />
              {phase === "starting" ? "Opening secure checkout…" : `Pay ${fmt$(invoice.total || 0)} with Card`}
            </Button>
          </>
        )}

        <p className="text-[10px] text-muted-foreground text-center">
          Questions? Call Titan Restoration at <a href="tel:7069220154" className="font-semibold text-[hsl(var(--titan-red))]">706-922-0154</a>
        </p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CustomerPortal() {
  const [login, setLogin] = useState({ phone: "", pin: "" });
  const [session, setSession] = useState<{ contact: Contact; token: string } | null>(null);
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [loginError, setLoginError] = useState("");

  const handleLogin = async () => {
    setLoginError("");
    try {
      const res = await apiRequest("POST", "/api/customer-portal/login", login).then(r => r.json());
      if (res.error) { setLoginError(res.error); return; }
      if (res.token) { (window as any).__titanPortalToken__ = res.token; }
      setSession(res as any);
    } catch {
      setLoginError("Invalid phone or PIN. Please contact Titan Restoration at 706-922-0154.");
    }
  };

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/customer-portal/jobs", session?.contact?.id],
    enabled: !!session,
    queryFn: () => apiRequest("GET", `/api/customer-portal/jobs/${session?.contact?.id}`).then(r => r.json()),
  });

  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ["/api/customer-portal/invoices", session?.contact?.id],
    enabled: !!session,
    queryFn: () => apiRequest("GET", `/api/customer-portal/invoices/${session?.contact?.id}`).then(r => r.json()),
  });

  // ── Login screen ────────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="max-w-md mx-auto space-y-5 py-6">
        <div className="text-center">
          <div className="w-20 h-20 flex items-center justify-center mx-auto mb-3">
            <img src={titanLogo} alt="Titan Restoration" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold">Customer Portal</h1>
          <p className="text-sm font-medium text-[hsl(var(--titan-red))]">Titan Restoration LLC</p>
          <p className="text-xs text-muted-foreground mt-1.5">Track your job, view documents, and pay your invoice online</p>
        </div>

        <Card className="shadow-md">
          <CardContent className="p-5 space-y-4">
            <div>
              <Label className="text-xs font-semibold">Phone Number (on file)</Label>
              <Input className="mt-1" value={login.phone}
                onChange={e => setLogin(f => ({ ...f, phone: e.target.value }))}
                placeholder="706-555-0101"
                onKeyDown={e => e.key === "Enter" && handleLogin()} />
            </div>
            <div>
              <Label className="text-xs font-semibold">Portal PIN</Label>
              <Input type="password" maxLength={4} className="mt-1" value={login.pin}
                onChange={e => setLogin(f => ({ ...f, pin: e.target.value }))}
                placeholder="4-digit PIN"
                onKeyDown={e => e.key === "Enter" && handleLogin()} />
            </div>
            {loginError && (
              <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-lg p-2.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{loginError}
              </div>
            )}
            <Button className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)] text-white font-semibold h-10"
              onClick={handleLogin}>
              Access My Portal
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Don't have a PIN? Call us at{" "}
              <a href="tel:7069220154" className="text-[hsl(var(--titan-red))] font-semibold hover:underline">706-922-0154</a>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const firstName = session.contact.name?.split(" ")[0] || "there";

  // ── Authenticated view ──────────────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto space-y-4 py-4">
      {payInvoice && (
        <PayModal invoice={payInvoice} contactId={session.contact.id} onClose={() => setPayInvoice(null)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Hi, {firstName} 👋</h1>
          <p className="text-xs text-muted-foreground">Titan Restoration Customer Portal</p>
        </div>
        <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => { (window as any).__titanPortalToken__ = undefined; setSession(null); }}>
          <LogOut className="w-3.5 h-3.5" />Sign Out
        </Button>
      </div>

      {/* Help bar */}
      <div className="flex items-center gap-3 p-3 rounded-xl border bg-red-50/50 dark:bg-red-950/10 border-red-200 dark:border-red-800">
        <Phone className="w-4 h-4 text-[hsl(var(--titan-red))] shrink-0" />
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">Need help? We're available 24/7</p>
          <a href="tel:7069220154" className="text-sm font-bold text-[hsl(var(--titan-red))] hover:underline">706-922-0154</a>
        </div>
      </div>

      {/* Jobs */}
      {jobs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Home className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="font-medium">No jobs found for your account</p>
          <p className="text-xs">Please call us if you think this is an error.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map(job => (
            <Card key={job.id} className="overflow-hidden shadow-sm">
              {/* Job header */}
              <div className="p-4 pb-3 border-b bg-gradient-to-r from-[hsl(var(--titan-red)/0.08)] to-transparent">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-base">{job.jobNumber}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{job.address || "Address not set"}</p>
                  </div>
                  <Badge className={`${STATUS_COLORS[job.status]} text-xs font-semibold px-2.5 py-1 flex-shrink-0`}>
                    {STATUS_LABELS[job.status] || job.status}
                  </Badge>
                </div>
              </div>

              {/* Tabbed detail */}
              <CardContent className="p-3 pt-4">
                <JobDetailTabs job={job} invoices={invoices} onPay={setPayInvoice} contactId={session.contact.id} contactName={session.contact.name} />
              </CardContent>
            </Card>
          ))}

          {/* Bank-payout status view — shown once, below all jobs */}
          <PayoutTimeline contactId={session.contact.id} />
        </div>
      )}
    </div>
  );
}
