import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useState, lazy, Suspense, useEffect, useRef } from "react";
import { ArrowLeft, MapPin, Phone, Mail, Shield, FileText, Receipt, Droplets, Camera, FolderOpen, TrendingUp, StickyNote, Lock, Globe, Pencil, Trash2, Plus, Check, X, Wrench, MessageSquare, Star, Send, KeyRound, Copy, RefreshCw, ExternalLink, ShieldCheck, HandCoins } from "lucide-react";
import { StageSelector, DateManager, PROGRESS_STAGES } from "@/components/JobPipeline";
import { JobCostingPanel } from "@/pages/JobCosting";
import { SupplementPanel } from "@/pages/Supplements";
import { SafetyPanel } from "@/pages/Safety";
// PDF-heavy components (they pull jsPDF, ~600KB) are lazy-loaded so the
// pdf bundle downloads only when the user opens the relevant tab — not on
// every JobDetail page view.
const DryStandardReportGenerator = lazy(() =>
  import("@/components/DryStandardReport").then((m) => ({ default: m.DryStandardReportGenerator })),
);
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { RotateCcw } from "lucide-react";
import type { Job, Contact, Estimate, Invoice } from "@shared/schema";
import DryingRecords from "@/components/DryingRecords";
import MitigationSketch from "@/components/MitigationSketch";
import DocuSketchPanel from "@/components/DocuSketchPanel";
import JobPhotos from "@/components/JobPhotos";
const JobDocuments = lazy(() => import("@/components/JobDocuments"));

function TabLoading() {
  return (
    <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
      Loading…
    </div>
  );
}
import { WarrantyCallPanel } from "@/components/WarrantyCallPanel";
import { ReferralPayoutPanel } from "@/components/ReferralPayoutPanel";

// ── Per-Job SMS Thread ───────────────────────────────────────────────────────
function JobSMSThread({ jobId, contactPhone }: { jobId: number; contactPhone?: string }) {
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [to, setTo] = useState(contactPhone || "");

  const { data: messages = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/jobs", jobId, "sms"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/sms`).then(r => r.json()),
  });

  const sendMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/jobs/${jobId}/sms`, { to, body, direction: "outbound" }).then(r => r.json()),
    onSuccess: () => { setBody(""); refetch(); toast({ title: "SMS sent" }); },
    onError: () => toast({ title: "Error", description: "Failed to send SMS", variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Phone number (e.g. 7065551234)"
          value={to}
          onChange={e => setTo(e.target.value)}
          className="w-48"
          data-testid="input-sms-to"
        />
        <span className="text-xs text-muted-foreground">From: Titan Restoration (706-922-0154)</span>
      </div>
      <div className="border rounded-lg divide-y max-h-80 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
        ) : messages.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No messages yet
          </div>
        ) : messages.map((msg: any) => (
          <div key={msg.id} className={`p-3 flex gap-3 ${msg.direction === "outbound" ? "bg-blue-50 dark:bg-blue-950/20" : ""}`} data-testid={`sms-msg-${msg.id}`}>
            <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${msg.direction === "outbound" ? "bg-[hsl(var(--titan-blue))]" : "bg-green-500"}`} />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{msg.direction === "outbound" ? "Titan" : "Homeowner"}</span>
                <span className="text-xs text-muted-foreground">{msg.created_at ? new Date(msg.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span>
              </div>
              <p className="text-sm mt-0.5">{msg.body}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Type a message..."
          rows={2}
          data-testid="input-sms-body"
          className="flex-1"
        />
        <Button
          onClick={() => sendMutation.mutate()}
          disabled={!body.trim() || !to.trim() || sendMutation.isPending}
          className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white self-end"
          data-testid="button-send-sms"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Review Request Button ────────────────────────────────────────────────────
function ReviewRequestButton({ jobId, jobStatus }: { jobId: number; jobStatus: string }) {
  const { toast } = useToast();
  const sendMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/jobs/${jobId}/review-request`, {}).then(r => r.json()),
    onSuccess: (data: any) => toast({
      title: "Review request sent",
      description: `SMS queued to ${data.phone || "homeowner"}: "${data.message?.slice(0, 60)}…"`,
    }),
    onError: () => toast({ title: "Error", description: "Could not send review request", variant: "destructive" }),
  });

  if (jobStatus !== "complete") return null;
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => sendMutation.mutate()}
      disabled={sendMutation.isPending}
      className="text-yellow-600 border-yellow-300 hover:bg-yellow-50"
      data-testid="button-review-request"
    >
      <Star className="w-4 h-4 mr-1" />
      {sendMutation.isPending ? "Sending..." : "Request Google Review"}
    </Button>
  );
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800", mitigation: "bg-yellow-100 text-yellow-800",
  drying: "bg-orange-100 text-orange-800", reconstruction: "bg-purple-100 text-purple-800",
  complete: "bg-green-100 text-green-800", closed: "bg-gray-100 text-gray-600",
};

const SC_STATUTES = [
  "SC Code § 38-77-290: Insurer must acknowledge claim within 10 days of notice.",
  "SC Code § 38-59-20: Insurer must accept or deny within 45 days of proof of loss.",
  "SC Reg. 69-64(D): Bad-faith failure to settle supports extra-contractual damages.",
  "SC Code § 38-59-40: Attorney's fees awarded when insurer's refusal is without reasonable cause.",
  "SC Code § 38-77-310: Insurer may not unreasonably delay payment of undisputed amounts.",
];

const GA_STATUTES = [
  "GA Code § 33-6-34: Insurer must respond to claim within 10 days of notice.",
  "GA Code § 33-6-34(4): Insurer shall tender undisputed amount within 60 days.",
  "GA Code § 13-6-11: Bad faith attorney's fees available when insurer acts in bad faith.",
  "GA Code § 33-4-6: 50% penalty plus attorney's fees for bad faith refusal to pay.",
  "GA Code § 33-6-34(3): Insurer prohibited from requiring policyholder to waive rights.",
];

interface JobNote {
  id: number;
  jobId: number;
  author: string;
  body: string;
  isPublic: boolean;
  tag: string | null;
  editedAt: string | null;
  createdAt: string;
}

// ── Notes Tab Component ──────────────────────────────────────────────────────
function NotesTab({ jobId }: { jobId: number }) {
  const [newBody, setNewBody] = useState("");
  const [newAuthor, setNewAuthor] = useState("Titan Team");
  const [newTag, setNewTag] = useState("");
  const [newPublic, setNewPublic] = useState(false);
  const [filter, setFilter] = useState<"all" | "public" | "private">("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editPublic, setEditPublic] = useState(false);
  const [editTag, setEditTag] = useState("");

  const { data: notes = [], isLoading } = useQuery<JobNote[]>({
    queryKey: ["/api/jobs", jobId, "notes"],
    queryFn: () => apiRequest("GET", `/api/jobs/${jobId}/notes`).then(r => r.json()),
  });

  const createNote = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/jobs/${jobId}/notes`, {
        author: newAuthor || "Titan Team",
        body: newBody,
        isPublic: newPublic,
        tag: newTag || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "notes"] });
      setNewBody("");
      setNewTag("");
      setNewPublic(false);
    },
  });

  const updateNote = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PATCH", `/api/jobs/${jobId}/notes/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "notes"] });
      setEditingId(null);
    },
  });

  const deleteNote = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/jobs/${jobId}/notes/${id}`, undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "notes"] }),
  });

  const startEdit = (note: JobNote) => {
    setEditingId(note.id);
    setEditBody(note.body);
    setEditPublic(note.isPublic);
    setEditTag(note.tag || "");
  };

  const filtered = notes.filter(n => {
    if (filter === "public") return n.isPublic;
    if (filter === "private") return !n.isPublic;
    return true;
  });

  const publicCount = notes.filter(n => n.isPublic).length;
  const privateCount = notes.filter(n => !n.isPublic).length;

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setFilter("all")}
          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${filter === "all" ? "bg-foreground text-background border-foreground" : "border-border hover:border-foreground/40"}`}
        >
          All ({notes.length})
        </button>
        <button
          onClick={() => setFilter("public")}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${filter === "public" ? "bg-green-600 text-white border-green-600" : "border-green-300 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30"}`}
        >
          <Globe className="w-3 h-3" />Public ({publicCount})
        </button>
        <button
          onClick={() => setFilter("private")}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${filter === "private" ? "bg-[hsl(var(--titan-red))] text-white border-[hsl(var(--titan-red))]" : "border-[hsl(var(--titan-red)/0.4)] text-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.05)]"}`}
        >
          <Lock className="w-3 h-3" />Private ({privateCount})
        </button>
      </div>

      {/* Notes list */}
      {isLoading && <p className="text-sm text-muted-foreground text-center py-6">Loading notes…</p>}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <StickyNote className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No {filter !== "all" ? filter + " " : ""}notes yet.</p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map(note => (
          <Card
            key={note.id}
            className={`border transition-colors ${note.isPublic ? "border-green-200 dark:border-green-800 bg-green-50/40 dark:bg-green-950/10" : "border-border"}`}
          >
            {editingId === note.id ? (
              /* ── Edit mode ── */
              <CardContent className="pt-4 space-y-3">
                <Textarea
                  className="text-sm min-h-[80px]"
                  value={editBody}
                  onChange={e => setEditBody(e.target.value)}
                  data-testid={`input-note-edit-${note.id}`}
                />
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={editPublic}
                      onCheckedChange={setEditPublic}
                      data-testid={`switch-note-public-edit-${note.id}`}
                    />
                    <span className={`text-xs font-medium flex items-center gap-1 ${editPublic ? "text-green-600" : "text-muted-foreground"}`}>
                      {editPublic ? <><Globe className="w-3 h-3" />Public — visible to homeowner</> : <><Lock className="w-3 h-3" />Private — company only</>}
                    </span>
                  </div>
                  <Input
                    className="h-7 text-xs w-32"
                    placeholder="@tag (optional)"
                    value={editTag}
                    onChange={e => setEditTag(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
                    onClick={() => updateNote.mutate({ id: note.id, data: { body: editBody, isPublic: editPublic, tag: editTag || null } })}
                    disabled={updateNote.isPending || !editBody.trim()}
                    data-testid={`button-save-note-${note.id}`}
                  >
                    <Check className="w-3 h-3 mr-1" />Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                    <X className="w-3 h-3 mr-1" />Cancel
                  </Button>
                </div>
              </CardContent>
            ) : (
              /* ── View mode ── */
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-xs font-semibold">{note.author}</span>
                      {note.tag && (
                        <span className="text-xs bg-[hsl(var(--titan-blue)/0.12)] text-[hsl(var(--titan-blue))] px-2 py-0.5 rounded-full">@{note.tag}</span>
                      )}
                      <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${note.isPublic ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"}`}>
                        {note.isPublic ? <><Globe className="w-3 h-3" />Public</> : <><Lock className="w-3 h-3" />Private</>}
                      </span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {note.createdAt ? new Date(note.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
                        {note.editedAt && <span className="italic ml-1">(edited)</span>}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{note.body}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => startEdit(note)}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      data-testid={`button-edit-note-${note.id}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("Delete this note?")) deleteNote.mutate(note.id);
                      }}
                      className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      data-testid={`button-delete-note-${note.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* ── Add new note ── */}
      <Card className="border-dashed border-2 border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Plus className="w-4 h-4" />Add Note
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <Textarea
            className="text-sm min-h-[100px]"
            placeholder="Type your note here… (visible to team, or toggle Public to share with homeowner)"
            value={newBody}
            onChange={e => setNewBody(e.target.value)}
            data-testid="input-new-note"
          />

          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <Label className="text-xs mb-1 block">Author</Label>
              <Input
                className="h-7 text-xs w-36"
                value={newAuthor}
                onChange={e => setNewAuthor(e.target.value)}
                placeholder="Your name"
                data-testid="input-note-author"
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Tag (optional)</Label>
              <Input
                className="h-7 text-xs w-32"
                placeholder="e.g. mason"
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                data-testid="input-note-tag"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Visibility</Label>
              <div className="flex items-center gap-2 h-7">
                <Switch
                  checked={newPublic}
                  onCheckedChange={setNewPublic}
                  data-testid="switch-new-note-public"
                />
                <span className={`text-xs font-medium flex items-center gap-1 ${newPublic ? "text-green-600" : "text-muted-foreground"}`}>
                  {newPublic
                    ? <><Globe className="w-3 h-3" />Public — homeowner can see this</>
                    : <><Lock className="w-3 h-3" />Private — company only</>}
                </span>
              </div>
            </div>
          </div>

          {newPublic && (
            <div className="text-xs bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 rounded px-3 py-2">
              This note will appear in the homeowner's Customer Portal under job updates.
            </div>
          )}

          <Button
            size="sm"
            className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
            onClick={() => createNote.mutate()}
            disabled={createNote.isPending || !newBody.trim()}
            data-testid="button-add-note"
          >
            <Plus className="w-4 h-4 mr-1" />
            {createNote.isPending ? "Saving…" : "Add Note"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Inline Milestone Dates Component ─────────────────────────────────────────
function InlineMilestoneDates({ job }: { job: any }) {
  const { toast } = useToast();
  const [dates, setDates] = useState({
    salesDate: job.salesDate || "",
    preProductionDate: job.preProductionDate || "",
    wipDate: job.wipDate || "",
    invoiceSentDate: job.invoiceSentDate || "",
    invoicePaidDate: job.invoicePaidDate || "",
  });
  const [dirty, setDirty] = useState(false);

  // Mirror DateManager (JobPipeline.tsx): editing a milestone date moves the job
  // forward through PROGRESS_STAGES (never backward, and A/R placement is
  // preserved when only invoice_sent is set).
  const DATE_TO_STAGE: { field: string; stageKey: string }[] = [
    { field: "salesDate", stageKey: "pre_production" },
    { field: "preProductionDate", stageKey: "pre_production" },
    { field: "wipDate", stageKey: "wip" },
    { field: "invoiceSentDate", stageKey: "invoice_pending" },
    { field: "invoicePaidDate", stageKey: "complete" },
  ];
  const STATUS_MAP: Record<string, string> = {
    pending_sale: "new",
    pre_production: "new",
    wip: "mitigation",
    invoice_pending: "reconstruction",
    accounts_receivable: "reconstruction",
    complete: "complete",
  };
  const computeAutoStage = (d: typeof dates): string | null => {
    let best: string | null = null;
    let bestOrder = -1;
    for (const { field, stageKey } of DATE_TO_STAGE) {
      if ((d as any)[field]) {
        const order = PROGRESS_STAGES.find(s => s.key === stageKey)?.order ?? -1;
        if (order > bestOrder) { bestOrder = order; best = stageKey; }
      }
    }
    return best;
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload: any = { ...dates };
      const autoStage = computeAutoStage(dates);
      const currentStage = (job as any).progressStage || "pending_sale";
      const currentOrder = PROGRESS_STAGES.find(s => s.key === currentStage)?.order ?? 0;
      const autoOrder = autoStage ? (PROGRESS_STAGES.find(s => s.key === autoStage)?.order ?? -1) : -1;
      // Forward-only bucket move; preserve manual A/R placement (which shares
      // the invoice-sent date) unless payment received completes the job.
      if (autoStage && autoOrder > currentOrder && !(currentStage === "accounts_receivable" && autoStage === "invoice_pending")) {
        payload.progressStage = autoStage;
        if (STATUS_MAP[autoStage]) payload.status = STATUS_MAP[autoStage];
      }
      return apiRequest("PATCH", `/api/jobs/${job.id}`, payload).then((r) => r.json());
    },
    onSuccess: (updatedJob: any) => {
      queryClient.setQueryData(["/api/jobs", job.id], updatedJob);
      queryClient.setQueryData(["/api/jobs", String(job.id)], updatedJob);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      const moved = (updatedJob as any).progressStage && (updatedJob as any).progressStage !== ((job as any).progressStage || "pending_sale");
      toast({
        title: moved
          ? `Dates saved — moved to ${PROGRESS_STAGES.find((s) => s.key === (updatedJob as any).progressStage)?.label || "new stage"}`
          : "Milestone dates saved",
      });
      setDirty(false);
    },
    onError: () => toast({ title: "Failed to save dates", variant: "destructive" }),
  });

  const DATE_ROWS = [
    { key: "salesDate", label: "Sale Date", stage: PROGRESS_STAGES[0] },
    { key: "preProductionDate", label: "Pre-Production Start", stage: PROGRESS_STAGES[1] },
    { key: "wipDate", label: "WIP Start", stage: PROGRESS_STAGES[2] },
    { key: "invoiceSentDate", label: "Invoice Sent", stage: PROGRESS_STAGES[3] },
    { key: "invoicePaidDate", label: "Payment Received", stage: PROGRESS_STAGES[5] },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <span>📅</span> Milestone Dates
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {DATE_ROWS.map((row) => {
          const S = row.stage;
          return (
            <div key={row.key} className="flex items-center gap-3">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${S.color} ${S.textColor}`}
              >
                <S.icon className="w-3.5 h-3.5" />
              </div>
              <Label className="text-sm w-44 shrink-0">{row.label}</Label>
              <Input
                type="date"
                className="h-8 text-sm flex-1"
                value={(dates as any)[row.key]}
                onChange={(e) => {
                  setDates((d) => ({ ...d, [row.key]: e.target.value }));
                  setDirty(true);
                }}
                data-testid={`milestone-date-${row.key}`}
              />
            </div>
          );
        })}
        <Button
          className="w-full mt-1 h-9 text-sm bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !dirty}
          data-testid="save-milestone-dates"
        >
          {saveMutation.isPending ? "Saving…" : dirty ? "Save Milestone Dates" : "Dates Saved"}
        </Button>
      </CardContent>
    </Card>
  );
}


// ── Customer Portal Access Card ───────────────────────────────────────────────
// Lets staff activate the homeowner's self-service portal directly from the job
// file: set/generate a 4-digit PIN, then hand the customer their login details
// (phone on file + PIN + portal link).
function CustomerPortalCard({ contact }: { contact: Contact }) {
  const { toast } = useToast();
  const cardRef = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState(false);
  const [pin, setPin] = useState(contact.portalPin || "");

  // When navigated to via /jobs/:id#portal-setup, scroll this card into view and
  // briefly highlight it so the user immediately sees the portal controls.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const marker = window.location.hash + window.location.search;
    if (marker.includes("portal-setup") || marker.includes("portal=1")) {
      const t = setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlight(true);
        setTimeout(() => setHighlight(false), 2200);
      }, 350);
      return () => clearTimeout(t);
    }
  }, []);
  const [copied, setCopied] = useState<string | null>(null);
  const isActive = !!contact.portalPin;
  const portalUrl = `${window.location.origin}/#/customer-portal`;

  const save = useMutation({
    mutationFn: (portalPin: string) =>
      apiRequest("PATCH", `/api/contacts/${contact.id}`, { portalPin }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Customer portal activated", description: `${contact.name} can now log in with their PIN.` });
    },
    onError: () => toast({ title: "Could not save", description: "Please try again.", variant: "destructive" }),
  });

  const deactivate = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/contacts/${contact.id}`, { portalPin: null }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setPin("");
      toast({ title: "Portal access revoked", description: `${contact.name} can no longer log in.` });
    },
  });

  const genPin = () => setPin(String(Math.floor(1000 + Math.random() * 9000)));
  const validPin = /^\d{4}$/.test(pin);

  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  const credentialBlock =
    `Titan Restoration — Customer Portal\n` +
    `Link: ${portalUrl}\n` +
    `Phone on file: ${contact.phone || "(no phone on file)"}\n` +
    `PIN: ${contact.portalPin || pin}`;

  const firstName = contact.name?.split(" ")[0] || "there";
  const emailSubject = "Your Titan Restoration Customer Portal login";
  const emailBody =
    `Hi ${firstName},\n\n` +
    `Your Titan Restoration customer portal is ready. You can track your job's progress, view documents and reports, message our team, and pay invoices online.\n\n` +
    `How to log in:\n` +
    `1. Go to: ${portalUrl}\n` +
    `2. Enter your phone number on file: ${contact.phone || "(the phone number we have on file)"}\n` +
    `3. Enter your 4-digit PIN: ${contact.portalPin}\n\n` +
    `Please keep your PIN private. If you have any questions or need a new PIN, call us at 706-922-0154.\n\n` +
    `Thank you,\n` +
    `Titan Restoration LLC\n` +
    `706-922-0154 | titanrestorationllc.com`;

  const emailLogin = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/emails", {
        folder: "sent",
        from: "cody@titanrestorationllc.com",
        to: contact.email,
        subject: emailSubject,
        body: emailBody,
        read: 1,
        createdAt: new Date().toISOString(),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      // Open the staff member's mail client pre-filled so the message actually goes out.
      window.location.href =
        `mailto:${encodeURIComponent(contact.email || "")}` +
        `?subject=${encodeURIComponent(emailSubject)}` +
        `&body=${encodeURIComponent(emailBody)}`;
      toast({ title: "Login email ready", description: `Drafted to ${contact.email} and saved to your Sent folder.` });
    },
    onError: () => toast({ title: "Could not create email", description: "Please try again.", variant: "destructive" }),
  });

  return (
    <Card
      id="portal-setup"
      ref={cardRef}
      className={`border-[hsl(var(--titan-blue)/0.35)] scroll-mt-24 transition-shadow ${highlight ? "ring-2 ring-[hsl(var(--titan-blue))] shadow-lg" : ""}`}
    >
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
          Customer Portal Access
        </CardTitle>
        <Badge className={isActive ? "bg-green-100 text-green-800" : "bg-muted text-muted-foreground"}>
          {isActive ? "Active" : "Not set up"}
        </Badge>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {!contact.phone && (
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2.5">
            <X className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            This contact has no phone number on file. Add one on the Contacts page — the customer logs in with their phone + PIN.
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs">Portal PIN (4 digits)</Label>
            <Input
              className="mt-1"
              value={pin}
              maxLength={4}
              inputMode="numeric"
              placeholder="e.g. 4827"
              onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              data-testid="input-portal-pin"
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={genPin} data-testid="button-generate-pin">
            <RefreshCw className="w-3.5 h-3.5 mr-1" />Generate
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)] text-white"
            disabled={!validPin || save.isPending}
            onClick={() => save.mutate(pin)}
            data-testid="button-save-pin"
          >
            <Check className="w-3.5 h-3.5 mr-1" />{isActive ? "Update" : "Activate"}
          </Button>
        </div>

        {isActive && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
            <p className="text-xs font-semibold flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-green-600" />Login details to share with {contact.name.split(" ")[0]}</p>
            <div className="grid gap-1.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">Portal link</span>
                <button className="flex items-center gap-1 text-[hsl(var(--titan-blue))] hover:underline text-xs font-medium" onClick={() => copy("link", portalUrl)} data-testid="button-copy-link">
                  <Copy className="w-3 h-3" />{copied === "link" ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">Phone on file</span>
                <span className="font-medium">{contact.phone || "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">PIN</span>
                <span className="font-mono font-semibold tracking-widest" data-testid="text-active-pin">{contact.portalPin}</span>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              className="w-full bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue)/0.85)] text-white"
              disabled={!contact.email || emailLogin.isPending}
              onClick={() => emailLogin.mutate()}
              data-testid="button-email-login"
            >
              <Mail className="w-3.5 h-3.5 mr-1.5" />
              {contact.email ? `Email login details to ${contact.email}` : "No email on file"}
            </Button>
            {!contact.email && (
              <p className="text-[11px] text-muted-foreground text-center">Add an email on the Contacts page to email these details.</p>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => copy("all", credentialBlock)} data-testid="button-copy-credentials">
                <Copy className="w-3.5 h-3.5 mr-1" />{copied === "all" ? "Copied" : "Copy all details"}
              </Button>
              <Link href="/customer-portal">
                <Button type="button" variant="outline" size="sm"><ExternalLink className="w-3.5 h-3.5 mr-1" />Open portal</Button>
              </Link>
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => deactivate.mutate()} data-testid="button-revoke-portal">
                Revoke
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


// ── Main JobDetail Page ──────────────────────────────────────────────────────
export default function JobDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const { data: job, isLoading } = useQuery<Job>({ queryKey: ["/api/jobs", id], staleTime: 0 });
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: estimates = [] } = useQuery<Estimate[]>({ queryKey: ["/api/jobs", id, "estimates"] });
  const { data: invoices = [] } = useQuery<Invoice[]>({ queryKey: ["/api/jobs", id, "invoices"] });
  const { data: notes = [] } = useQuery<JobNote[]>({
    queryKey: ["/api/jobs", id, "notes"],
    queryFn: () => apiRequest("GET", `/api/jobs/${id}/notes`).then(r => r.json()),
    enabled: !!id,
  });
  const { data: financialsRaw = {} } = useQuery<Record<string, any>>({
    queryKey: ["/api/jobs/financials"],
    queryFn: () => apiRequest("GET", "/api/jobs/financials").then(r => r.json()),
  });

  const [activeTab, setActiveTab] = useState("activity");

  // Phase filter — controls which phase's data is shown across the job workspace.
  // Mitigation and Reconstruction are fully independent data sets on the same job:
  // each phase shows ONLY its own estimates, invoices, photos, and documents.
  const [phaseFilter, setPhaseFilter] = useState<string>("mitigation");

  // Tabs that only apply to the mitigation phase. When the user switches to
  // Reconstruction, these are hidden — auto-switch away if one is active.
  const MITIGATION_ONLY_TABS = ["mitigation", "dry-report"];
  useEffect(() => {
    if (phaseFilter === "reconstruction" && MITIGATION_ONLY_TABS.includes(activeTab)) {
      setActiveTab("activity");
    }
  }, [phaseFilter, activeTab]);

  const updateStatus = useMutation({
    mutationFn: (status: string) => apiRequest("PATCH", `/api/jobs/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/jobs"] }),
  });

  const updateLocation = useMutation({
    mutationFn: (location: string) => apiRequest("PATCH", `/api/jobs/${id}`, { location }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/jobs"] }),
  });

  // Close / reopen state. Owner+admin only — the server also enforces this.
  const { employee: currentEmployee } = useAuth();
  const canManageClose = currentEmployee?.role === "owner" || currentEmployee?.role === "admin";
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [reopenOpen, setReopenOpen] = useState(false);

  const closeJobMut = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/jobs/${id}/close`, { reason: closeReason || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job closed", description: "Removed from dashboards, KPIs, and reports." });
      setCloseOpen(false);
      setCloseReason("");
    },
    onError: (e: any) =>
      toast({ title: "Could not close job", description: e?.message || "Server rejected the request.", variant: "destructive" }),
  });

  const reopenJobMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/jobs/${id}/reopen`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job reopened", description: "Back in dashboards and reports." });
      setReopenOpen(false);
    },
    onError: (e: any) =>
      toast({ title: "Could not reopen job", description: e?.message || "Server rejected the request.", variant: "destructive" }),
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (!job) return <div className="p-6 text-destructive">Job not found.</div>;

  const contact = contacts.find(c => c.id === job.contactId);
  const fin = financialsRaw[String(job.id)] || financialsRaw[job.id as any];
  // Phase-specific financials — falls back to the job-level totals if byPhase is absent.
  const phaseFin = fin?.byPhase?.[phaseFilter] || fin;
  const money = (n: number) => `$${(n || 0).toLocaleString("en-US")}`;
  const isGA = (job.address || "").toUpperCase().includes("GA");
  const statutes = isGA ? GA_STATUTES : SC_STATUTES;
  const stateLabel = isGA ? "Georgia" : "South Carolina";

  const legacyNotes = JSON.parse(job.notes || "[]") as any[];
  const notesCount = notes.length + legacyNotes.length;

  // Phase-filtered views — strictly independent per phase (null/undefined phase
  // is treated as 'mitigation'). Data is never shared or duplicated between phases.
  const visibleEstimates = estimates.filter(e => (((e as any).phase as string) || "mitigation") === phaseFilter);
  const visibleInvoices = invoices.filter(i => (((i as any).phase as string) || "mitigation") === phaseFilter);
  const isRecon = phaseFilter === "reconstruction";
  const hasReferralPartner = !!job.referralPartnerId || job.leadSource === "referral";
  const PHASES = [
    { value: "mitigation", label: "Mitigation" },
    { value: "reconstruction", label: "Reconstruction" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/jobs">
          <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Jobs</Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{job.jobNumber}</h1>
          <p className="text-sm text-muted-foreground">{job.lossType} · {job.address}</p>
        </div>
        <div className="flex items-center gap-2">
          <ReviewRequestButton jobId={Number(id)} jobStatus={job.status} />
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none px-1">Location</span>
            <Select value={(job as any).location || "Augusta"} onValueChange={v => updateLocation.mutate(v)}>
              <SelectTrigger className="w-32" data-testid="select-detail-location">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Augusta">Augusta</SelectItem>
                <SelectItem value="Columbia">Columbia</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none px-1">Status</span>
            <Select value={job.status} onValueChange={v => updateStatus.mutate(v)}
              disabled={job.status === "closed"}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["new","mitigation","drying","reconstruction","complete"].map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canManageClose && (
            <div className="flex flex-col gap-1 justify-end">
              <span className="text-[10px] uppercase tracking-wide text-transparent leading-none px-1 select-none">.</span>
              {job.status === "closed" ? (
                <Button size="sm" variant="outline" onClick={() => setReopenOpen(true)}
                  data-testid="btn-reopen-job" className="gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" /> Reopen
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setCloseOpen(true)}
                  data-testid="btn-close-job" className="gap-1.5">
                  <Lock className="w-3.5 h-3.5" /> Close job
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {job.status === "closed" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
            <Lock className="w-3.5 h-3.5" />
            <span className="font-semibold uppercase tracking-wide">Closed</span>
            {(job as any).closedAt && (
              <span>on {new Date((job as any).closedAt).toLocaleDateString()}</span>
            )}
            {(job as any).closedBy && <span>by {(job as any).closedBy}</span>}
          </div>
          {(job as any).closedReason && (
            <div className="mt-1 text-amber-900 dark:text-amber-100">Reason: {(job as any).closedReason}</div>
          )}
          <div className="mt-1 text-amber-900/80 dark:text-amber-100/80">
            This job is hidden from dashboards, KPIs, reports, and technicians. Reopen to restore.
          </div>
        </div>
      )}

      {/* Close-job confirmation */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close this job?</DialogTitle>
            <DialogDescription>
              Closing removes this job from dashboards, KPIs, reports, and technician views.
              All data stays intact and comes back if you reopen. You can find and reopen closed jobs from the Closed Jobs page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Reason (optional)</Label>
            <Textarea
              rows={3}
              placeholder="e.g., duplicate of TP-2026-002, cancelled by homeowner, warranty resolved…"
              value={closeReason}
              onChange={e => setCloseReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)} disabled={closeJobMut.isPending}>Cancel</Button>
            <Button variant="destructive" onClick={() => closeJobMut.mutate()} disabled={closeJobMut.isPending} className="gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              {closeJobMut.isPending ? "Closing…" : "Close job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reopen confirmation */}
      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reopen this job?</DialogTitle>
            <DialogDescription>
              Restores to <span className="font-semibold">{(job as any).previousStatus || "mitigation"}</span>{" "}
              and brings the job back into dashboards, KPIs, reports, and technician views.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenOpen(false)} disabled={reopenJobMut.isPending}>Cancel</Button>
            <Button onClick={() => reopenJobMut.mutate()} disabled={reopenJobMut.isPending} className="gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" />
              {reopenJobMut.isPending ? "Reopening…" : "Reopen job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Phase filter switch ── controls which phase's data is shown across the workspace */}
      <div className="flex items-center gap-3 flex-wrap" data-testid="phase-filter-bar">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">Phase view</span>
        <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
          {PHASES.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPhaseFilter(p.value)}
              data-testid={`phase-filter-${p.value}`}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                phaseFilter === p.value
                  ? "bg-[hsl(var(--titan-blue))] text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          Showing <span className="font-medium capitalize text-foreground">{phaseFilter}</span> data only
        </span>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="notes" className="flex items-center gap-1">
            <StickyNote className="w-3 h-3" />
            Notes {notesCount > 0 && <span className="ml-1 bg-[hsl(var(--titan-blue))] text-white text-[10px] px-1.5 py-0 rounded-full leading-5">{notesCount}</span>}
          </TabsTrigger>
          {!isRecon && <TabsTrigger value="mitigation"><Droplets className="w-3 h-3 mr-1 inline-block" />Mitigation</TabsTrigger>}
          <TabsTrigger value="photos"><Camera className="w-3 h-3 mr-1 inline-block" />Photos</TabsTrigger>
          <TabsTrigger value="documents"><FolderOpen className="w-3 h-3 mr-1 inline-block" />Documents</TabsTrigger>
          <TabsTrigger value="estimates">Estimates ({visibleEstimates.length})</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({visibleInvoices.length})</TabsTrigger>
          <TabsTrigger value="insurance">Insurance</TabsTrigger>
          <TabsTrigger value="pipeline"><TrendingUp className="w-3 h-3 mr-1 inline-block" />Pipeline</TabsTrigger>
          <TabsTrigger value="costing">Job Costing</TabsTrigger>
          <TabsTrigger value="supplements">Supplements</TabsTrigger>
          <TabsTrigger value="safety">Safety</TabsTrigger>
          {!isRecon && <TabsTrigger value="dry-report">Dry Report</TabsTrigger>}
          <TabsTrigger value="warranty"><Wrench className="w-3 h-3 mr-1 inline-block" />Warranty Calls</TabsTrigger>
          {hasReferralPartner && <TabsTrigger value="referral-payout"><HandCoins className="w-3 h-3 mr-1 inline-block" />Referral Payout</TabsTrigger>}
          <TabsTrigger value="sms-thread"><MessageSquare className="w-3 h-3 mr-1 inline-block" />SMS Thread</TabsTrigger>
        </TabsList>

        {/* ── Activity Tab ── */}
        <TabsContent value="activity" className="mt-4 space-y-4">
          {/* ── Financial Summary ── */}
          <Card data-testid="card-job-financials">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
                Financial Summary
                <span className="ml-1 text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full bg-[hsl(var(--titan-blue))]/10 text-[hsl(var(--titan-blue))]" data-testid="jobfin-phase-label">
                  {phaseFilter} phase
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
                <button
                  type="button"
                  onClick={() => setActiveTab("estimates")}
                  className="text-left group focus:outline-none"
                  data-testid="jobfin-estimate"
                  title="View estimates"
                >
                  <span className="text-xs text-muted-foreground block mb-0.5">Estimate Amount</span>
                  <span className="text-lg font-bold text-[hsl(var(--titan-blue))] group-hover:underline inline-flex items-center gap-1">
                    {money(phaseFin?.estimateTotal ?? 0)}
                    <ExternalLink className="w-3 h-3 opacity-60" />
                  </span>
                </button>
                <div data-testid="jobfin-costs">
                  <span className="text-xs text-muted-foreground block mb-0.5">Costs</span>
                  <span className="text-lg font-bold text-orange-600 dark:text-orange-400">{money(phaseFin?.totalCosts ?? 0)}</span>
                </div>
                <div data-testid="jobfin-settled">
                  <span className="text-xs text-muted-foreground block mb-0.5">Settled Amount <span className="text-[9px] normal-case text-muted-foreground/70">(claim-level)</span></span>
                  <span className="text-lg font-bold text-[hsl(var(--titan-blue))]">{money(phaseFin?.settledAmount ?? 0)}</span>
                </div>
                <div data-testid="jobfin-collected">
                  <span className="text-xs text-muted-foreground block mb-0.5">Collected Revenue</span>
                  <span className="text-lg font-bold text-green-600 dark:text-green-400">{money(phaseFin?.collected ?? 0)}</span>
                </div>
                <div data-testid="jobfin-creditmemo">
                  <span className="text-xs text-muted-foreground block mb-0.5">Credit Memo</span>
                  <span className="text-lg font-bold text-red-600 dark:text-red-400">{money(phaseFin?.creditMemos ?? 0)}</span>
                </div>
                <div data-testid="jobfin-outstanding">
                  <span className="text-xs text-muted-foreground block mb-0.5">Outstanding Balance</span>
                  <span className={`text-lg font-bold ${(phaseFin?.outstanding ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{money(phaseFin?.outstanding ?? 0)}</span>
                </div>
                <div data-testid="jobfin-grossprofit">
                  <span className="text-xs text-muted-foreground block mb-0.5">Gross Profit</span>
                  <span className={`text-lg font-bold ${(phaseFin?.grossProfit ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{money(phaseFin?.grossProfit ?? 0)}</span>
                </div>
                <div data-testid="jobfin-margin">
                  <span className="text-xs text-muted-foreground block mb-0.5">Gross Profit Margin</span>
                  <span className={`text-lg font-bold ${(phaseFin?.grossMarginPct ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{phaseFin?.grossMarginPct ?? 0}%</span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-4 pt-3 border-t">
                Figures reflect the <span className="font-medium capitalize text-foreground">{phaseFilter}</span> phase only, except Settled Amount which is claim-level (same on both phases).
                Gross profit = collected revenue &minus; job costs. Margin is profit as a share of collected revenue.
                Outstanding = invoiced &minus; collected. Click the estimate amount to view estimates.
              </p>
            </CardContent>
          </Card>

          {contact && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Customer</CardTitle></CardHeader>
              <CardContent className="pt-0 space-y-1">
                <p className="font-semibold">{contact.name}</p>
                {contact.phone && <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-sm text-[hsl(var(--titan-blue))] hover:underline"><Phone className="w-3 h-3" />{contact.phone}</a>}
                {contact.email && <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-sm text-[hsl(var(--titan-blue))] hover:underline"><Mail className="w-3 h-3" />{contact.email}</a>}
                {contact.address && <p className="flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="w-3 h-3" />{contact.address}</p>}
              </CardContent>
            </Card>
          )}

          {contact && <CustomerPortalCard contact={contact} />}

          {job.description && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Description</CardTitle></CardHeader>
              <CardContent className="pt-0"><p className="text-sm text-muted-foreground">{job.description}</p></CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Milestones</CardTitle></CardHeader>
            <CardContent className="pt-0 grid grid-cols-2 gap-2">
              {[
                { label: "Mitigation Start", value: job.mitigationStart },
                { label: "Dry-Out Complete", value: job.dryOutComplete },
                { label: "Reconstruction Start", value: job.reconstructionStart },
                { label: "Job Complete", value: job.jobComplete },
              ].map(m => (
                <div key={m.label}>
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                  <p className="text-sm font-medium">{m.value ? new Date(m.value).toLocaleDateString() : "—"}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Recent public notes preview on activity tab */}
          {notes.filter(n => n.isPublic).length > 0 && (
            <Card className="border-green-200 dark:border-green-800">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Globe className="w-4 h-4 text-green-600" />
                  Public Updates (visible to homeowner)
                </CardTitle>
                <Badge variant="outline" className="text-green-700 border-green-300 text-xs">{notes.filter(n => n.isPublic).length} note{notes.filter(n => n.isPublic).length !== 1 ? "s" : ""}</Badge>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {notes.filter(n => n.isPublic).slice(0, 3).map(note => (
                  <div key={note.id} className="text-sm bg-green-50/60 dark:bg-green-950/10 rounded p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold">{note.author}</span>
                      {note.tag && <span className="text-xs text-muted-foreground">@{note.tag}</span>}
                      <span className="text-xs text-muted-foreground ml-auto">{note.createdAt ? new Date(note.createdAt).toLocaleDateString() : ""}</span>
                    </div>
                    <p className="text-muted-foreground">{note.body}</p>
                  </div>
                ))}
                {notes.filter(n => n.isPublic).length > 3 && (
                  <p className="text-xs text-muted-foreground text-center">+ {notes.filter(n => n.isPublic).length - 3} more — open Notes tab to view all</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Legacy JSON notes (backward compat) */}
          {legacyNotes.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Notes (legacy)</CardTitle></CardHeader>
              <CardContent className="pt-0 space-y-2">
                {legacyNotes.map((n: any) => (
                  <div key={n.id} className="p-2 bg-muted rounded text-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-xs">{n.author || "Tech"}</span>
                      {n.tag && <span className="text-xs bg-[hsl(var(--titan-blue)/0.1)] text-[hsl(var(--titan-blue))] px-2 py-0.5 rounded-full">@{n.tag}</span>}
                      <span className="text-xs text-muted-foreground ml-auto">{n.createdAt ? new Date(n.createdAt).toLocaleDateString() : ""}</span>
                    </div>
                    <p>{n.text}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Notes Tab ── */}
        <TabsContent value="notes" className="mt-4">
          <NotesTab jobId={job.id} />
        </TabsContent>

        {/* ── Mitigation Tab ── */}
        <TabsContent value="mitigation" className="mt-4">
          <div className="space-y-6">
            <DocuSketchPanel jobId={job.id} job={job} />
            <div className="border-t pt-2">
              <MitigationSketch jobId={job.id} />
            </div>
            <div className="border-t pt-6">
              <DryingRecords jobId={job.id} />
            </div>
          </div>
        </TabsContent>

        {/* ── Photos Tab ── */}
        <TabsContent value="photos" className="mt-4">
          <JobPhotos jobId={job.id} phase={phaseFilter} />
        </TabsContent>

        {/* ── Documents Tab ── */}
        <TabsContent value="documents" className="mt-4">
          <Suspense fallback={<TabLoading />}><JobDocuments jobId={job.id} phase={phaseFilter} /></Suspense>
        </TabsContent>

        {/* ── Estimates Tab ── */}
        <TabsContent value="estimates" className="mt-4">
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm text-muted-foreground">{visibleEstimates.length} estimate(s)<span className="capitalize"> · {phaseFilter}</span></p>
            <Link href="/estimates">
              <Button size="sm" variant="outline"><FileText className="w-3 h-3 mr-1" />New Estimate</Button>
            </Link>
          </div>
          <div className="space-y-2">
            {visibleEstimates.map(e => (
              <Link key={e.id} href={`/estimates/${e.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-sm">{e.title}</p>
                      <p className="text-xs text-muted-foreground">{e.status}</p>
                    </div>
                    <p className="font-bold text-[hsl(var(--titan-blue))]">${(e.total || 0).toLocaleString()}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
            {visibleEstimates.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No estimates for {phaseFilter} yet.</p>}
          </div>
        </TabsContent>

        {/* ── Invoices Tab ── */}
        <TabsContent value="invoices" className="mt-4">
          <div className="space-y-2">
            {visibleInvoices.map(inv => (
              <Card key={inv.id}>
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-sm">{inv.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground">{inv.status} · Due {inv.dueDate}</p>
                  </div>
                  <p className="font-bold text-green-600">${(inv.total || 0).toLocaleString()}</p>
                </CardContent>
              </Card>
            ))}
            {visibleInvoices.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No invoices for {phaseFilter} yet.</p>}
          </div>
        </TabsContent>

        {/* ── Insurance Tab ── */}
        <TabsContent value="insurance" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4 text-[hsl(var(--titan-blue))]" />Adjuster Information</CardTitle></CardHeader>
            <CardContent className="pt-0 grid grid-cols-2 gap-2 text-sm">
              <div><p className="text-xs text-muted-foreground">Adjuster</p><p className="font-medium">{job.adjusterName || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Phone</p>
                {job.adjusterPhone
                  ? <a href={`tel:${job.adjusterPhone}`} className="text-[hsl(var(--titan-blue))] hover:underline">{job.adjusterPhone}</a>
                  : <p>—</p>}
              </div>
              <div><p className="text-xs text-muted-foreground">Policy #</p><p className="font-medium">{job.policyNumber || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Claim #</p><p className="font-medium">{job.claimNumber || "—"}</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{stateLabel} Insurance Statutes</CardTitle></CardHeader>
            <CardContent className="pt-0 space-y-2">
              {statutes.map((s, i) => (
                <div key={i} className="flex gap-2 text-xs text-muted-foreground">
                  <span className="text-[hsl(var(--titan-red))] font-bold mt-0.5">§</span>
                  <span>{s}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground text-center">Navigate to Estimates to generate a formal carrier rebuttal.</p>
        </TabsContent>

        {/* ── Pipeline Tab ── */}
        <TabsContent value="pipeline" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
                Progress Stage
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-sm text-muted-foreground">Current Stage:</p>
                <StageSelector job={job} />
              </div>
              <p className="text-xs text-muted-foreground">
                Click the stage badge to advance or move the job to any pipeline stage. Dates are auto-stamped when you change stages.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Pipeline Progress</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                {PROGRESS_STAGES.map((stage, idx) => {
                  const currentOrder = PROGRESS_STAGES.findIndex(s => s.key === (job.progressStage || "pending_sale"));
                  const isPast = idx < currentOrder;
                  const isCurrent = idx === currentOrder;
                  const dateStr = (job as any)[stage.dateField] as string | undefined;
                  return (
                    <div key={stage.key} className={`flex items-center gap-3 p-2.5 rounded-lg border transition-all ${
                      isCurrent ? `${stage.color} ${stage.borderColor} shadow-sm` :
                      isPast ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800" :
                      "bg-muted/20 border-border opacity-50"
                    }`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                        isPast ? "bg-green-100 text-green-700" :
                        isCurrent ? `${stage.color} ${stage.textColor}` :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {isPast
                          ? <span className="text-green-700 text-xs font-bold">✓</span>
                          : <stage.icon className="w-3.5 h-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-medium ${isCurrent ? stage.textColor : isPast ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}`}>{stage.label}</p>
                          {isCurrent && <Badge className={`text-xs border ${stage.color} ${stage.textColor} ${stage.borderColor}`}>Current</Badge>}
                        </div>
                        {dateStr && <p className="text-xs text-muted-foreground mt-0.5">{stage.dateLabel}: {new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
          <InlineMilestoneDates job={job} />
        </TabsContent>

        <TabsContent value="costing" className="mt-4"><JobCostingPanel jobId={Number(id)} phase={phaseFilter} /></TabsContent>
        <TabsContent value="supplements" className="mt-4"><SupplementPanel jobId={Number(id)} job={job} /></TabsContent>
        <TabsContent value="safety" className="mt-4"><SafetyPanel jobId={Number(id)} /></TabsContent>
        <TabsContent value="dry-report" className="mt-4"><Suspense fallback={<TabLoading />}><DryStandardReportGenerator job={job} jobId={Number(id)} /></Suspense></TabsContent>
        <TabsContent value="warranty" className="mt-4">
          <WarrantyCallPanel
            jobId={Number(id)}
            referralPartnerId={job.referralPartnerId ?? undefined}
            referralPartnerName={job.leadSource === "referral" ? (job.leadSourceDetail ?? undefined) : undefined}
          />
        </TabsContent>
        {hasReferralPartner && (
          <TabsContent value="referral-payout" className="mt-4">
            <ReferralPayoutPanel
              job={job}
              estimates={estimates}
              invoices={invoices}
              partnerName={job.leadSource === "referral" ? (job.leadSourceDetail ?? undefined) : undefined}
            />
          </TabsContent>
        )}
        <TabsContent value="sms-thread" className="mt-4">
          <JobSMSThread jobId={Number(id)} contactPhone={contact?.phone ?? undefined} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
