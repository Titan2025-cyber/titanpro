import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { useState, lazy, Suspense, useEffect, useRef } from "react";
import { ArrowLeft, MapPin, Phone, Mail, Shield, FileText, Receipt, Droplets, Camera, FolderOpen, TrendingUp, StickyNote, Lock, Globe, Pencil, Trash2, Plus, Check, X, Wrench, MessageSquare, Star, Send, KeyRound, Copy, RefreshCw, ExternalLink, ShieldCheck, HandCoins, Upload, Paperclip, Mic, MicOff, DollarSign, FlaskConical } from "lucide-react";
import UploadExternalDocDialog from "@/components/UploadExternalDocDialog";
import { CarrierSelect } from "@/components/CarrierSelect";
import { StageSelector, DateManager, PROGRESS_STAGES } from "@/components/JobPipeline";
import { JobAnalytics } from "@/components/JobAnalytics";
import { JobCostingPanel } from "@/pages/JobCosting";
import { SupplementPanel } from "@/pages/Supplements";
import { SafetyPanel } from "@/pages/Safety";
import { LienWaiversPanel } from "@/pages/LienWaivers";
import RecordPaymentDialog from "@/components/RecordPaymentDialog";
import JobPaymentsPanel from "@/components/JobPaymentsPanel";
import JobHazmatPanel from "@/components/JobHazmatPanel";
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
import { NotifyPicker } from "@/components/NotifyPicker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import JobFileChecklist from "@/components/JobFileChecklist";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import type { Job, Contact, Estimate, Invoice } from "@shared/schema";
import DryingRecords from "@/components/DryingRecords";
import DryingPlanCard from "@/components/DryingPlanCard";
import MitigationSketch from "@/components/MitigationSketch";
import DocuSketchPanel from "@/components/DocuSketchPanel";
import JobPhotos from "@/components/JobPhotos";
import { MobileJobActionBar, JobFieldActionBar } from "@/components/MobileJobActionBar";
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
import { fmtDate, fmtDateShort } from "@/lib/dates";

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

// ── Voice dictation hook (browser SpeechRecognition) ────────────────────────
//
// Thin wrapper over the Web Speech API that streams recognized text back
// to the caller as it arrives. Interim results are kept separate from
// finalized results so the caller can render "live" text without
// double-committing it. On unsupported browsers (Firefox on desktop
// currently, some in-app WebViews) the hook still returns; `supported`
// will be false and `start()` becomes a no-op so the mic button can be
// hidden or disabled gracefully.
function useDictation(onFinalText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<any>(null);
  const supported =
    typeof window !== "undefined" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const start = () => {
    if (!supported || listening) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (evt: any) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let i = evt.resultIndex; i < evt.results.length; i++) {
        const r = evt.results[i];
        if (r.isFinal) finalChunk += r[0].transcript;
        else interimChunk += r[0].transcript;
      }
      if (finalChunk) onFinalText(finalChunk);
      setInterim(interimChunk);
    };
    rec.onend = () => { setListening(false); setInterim(""); };
    rec.onerror = () => { setListening(false); setInterim(""); };
    recRef.current = rec;
    rec.start();
    setListening(true);
  };

  const stop = () => {
    try { recRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
    setInterim("");
  };

  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* ignore */ } }, []);

  return { supported, listening, interim, start, stop };
}

// ── NoteDictationField ───────────────────────────────────────────────────
//
// Textarea + inline mic. Kept as a dedicated component so the dictation
// hook lives at a stable top level (React requires hooks be called from
// the same place every render) instead of inside an IIFE in the parent.
function NoteDictationField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const dict = useDictation((finalText) => {
    // Append recognized speech to whatever's already typed. Insert a
    // space when the current buffer doesn't end in whitespace so we
    // don't concatenate words together across dictation chunks.
    onChange(value + ((value && !/\s$/.test(value)) ? " " : "") + finalText.trim());
  });

  // Live preview: what the user sees while speaking = typed body + the
  // in-flight interim result. Committing to `value` only happens on the
  // final result callback above, so no double-writing.
  const displayValue = value + (
    dict.interim
      ? ((value && !/\s$/.test(value)) ? " " : "") + dict.interim
      : ""
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <Textarea
          className="text-sm min-h-[100px] pr-12"
          placeholder={dict.listening ? "Listening… speak your note" : "Type your note here… or tap the mic to dictate"}
          value={displayValue}
          onChange={(e) => {
            // If the user starts typing while dictation is running, cut
            // it off so we don't fight them for the cursor position.
            if (dict.listening) dict.stop();
            onChange(e.target.value);
          }}
          data-testid="input-new-note"
        />
        {dict.supported && (
          <button
            type="button"
            onClick={dict.listening ? dict.stop : dict.start}
            title={dict.listening ? "Stop dictation" : "Dictate"}
            aria-label={dict.listening ? "Stop dictation" : "Start voice dictation"}
            className={`absolute top-2 right-2 h-8 w-8 rounded-full flex items-center justify-center transition-colors ${dict.listening ? "bg-red-500 text-white animate-pulse" : "bg-muted hover:bg-muted/70 text-muted-foreground"}`}
            data-testid="button-note-dictate"
          >
            {dict.listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
        )}
      </div>
      {dict.listening && (
        <p className="text-[11px] text-red-600 flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          Listening — tap the mic again to stop
        </p>
      )}
      {!dict.supported && (
        <p className="text-[11px] text-muted-foreground">
          Voice dictation isn’t available in this browser. Try Chrome or Safari.
        </p>
      )}
    </div>
  );
}

// ── Notes Tab Component ────────────────────────────────────────────────────────
function NotesTab({ jobId }: { jobId: number }) {
  // Author defaults to the currently signed-in user. Keeping the field
  // editable so a manager can still attribute a note to someone else if
  // needed (e.g. logging a phone call from a tech in the field), but the
  // default is always 'me' so the audit trail is accurate.
  const { user } = useAuth();
  const defaultAuthor = user?.name || "Titan Team";
  const [newBody, setNewBody] = useState("");
  const [newAuthor, setNewAuthor] = useState(defaultAuthor);
  // Re-sync the author input if the signed-in user changes (rare, but
  // avoids a stale 'Titan Team' default sticking around after a login).
  useEffect(() => { setNewAuthor(defaultAuthor); }, [defaultAuthor]);
  const [newTag, setNewTag] = useState("");
  // Employees to email + bell when the note posts. Empty = nobody notified
  // (the note still saves and everyone can see it in the tab).
  const [newNotify, setNewNotify] = useState<number[]>([]);
  // Notes default to STAFF-ONLY. Every employee still sees every note in
  // Titan Pro (that's separate from this toggle), but the Homeowner Portal
  // only shows notes where isPublic === true. The toggle stays available
  // when you specifically want the homeowner to see the note.
  const [newPublic, setNewPublic] = useState(false);
  // Filter state kept for compatibility with a few downstream references,
  // but the UI no longer exposes the public/private toggle to employees.
  const [filter] = useState<"all" | "public" | "private">("all");
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
        notify: newNotify,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "notes"] });
      setNewBody("");
      setNewTag("");
      setNewPublic(false); // reset to staff-only default
      setNewNotify([]);
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

  // Every note is visible to every employee. The `isPublic` flag now only
  // controls whether the homeowner sees the note in the customer portal.
  // We drop the public/private filter buttons entirely so the crew can't
  // accidentally hide notes from themselves.
  // Display order: NEWEST at the top, OLDEST at the bottom. Server returns
  // notes in insertion order (id ASC), so we sort by createdAt (falling
  // back to id) descending on the client. Missing timestamps sort last.
  const filtered = [...notes].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return (b.id || 0) - (a.id || 0);
  });
  const homeownerVisible = notes.filter(n => n.isPublic).length;

  return (
    <div className="space-y-4">
      {/* Header — count + homeowner-visible callout */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">{notes.length}</span>{" "}
          note{notes.length === 1 ? "" : "s"} — all visible to every employee
        </span>
        {homeownerVisible > 0 && (
          <span className="flex items-center gap-1 text-green-700 dark:text-green-400">
            <Globe className="w-3 h-3" />
            {homeownerVisible} shared with homeowner
          </span>
        )}
      </div>

      {/* Add new note — lives at the TOP of the tab so the compose area is
          the first thing you land on when you switch to Notes. The list of
          existing notes follows below in newest-first order. */}
      <Card className="border-dashed border-2 border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Plus className="w-4 h-4" />Add Note
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {/* Voice dictation — tap the mic to stream field speech into the
              textarea. Uses the browser SpeechRecognition API (Chrome +
              Safari iOS). On unsupported browsers the button is hidden.
              Recognized text is appended to what's already in the note so
              techs can pause, tweak wording, and keep going. */}
          <NoteDictationField value={newBody} onChange={setNewBody} />

          {/* Notify recipient picker — chip multi-select. Each selected
              teammate gets an email (via the author's Gmail) + a bell when
              this note is saved. Author is excluded automatically. */}
          <NotifyPicker
            selectedIds={newNotify}
            onChange={setNewNotify}
            excludeName={newAuthor}
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
              <Label className="text-xs">Homeowner Portal</Label>
              <div className="flex items-center gap-2 h-7">
                <Switch
                  checked={newPublic}
                  onCheckedChange={setNewPublic}
                  data-testid="switch-new-note-public"
                />
                <span className={`text-xs font-medium flex items-center gap-1 ${newPublic ? "text-green-600" : "text-muted-foreground"}`}>
                  {newPublic
                    ? <><Globe className="w-3 h-3" />Share with homeowner</>
                    : <><Lock className="w-3 h-3" />Staff only (homeowner won't see)</>}
                </span>
              </div>
            </div>
          </div>

          <div className="text-xs bg-muted/50 border border-border rounded px-3 py-2 text-muted-foreground">
            <strong className="text-foreground">Every employee sees every note.</strong>{" "}
            The toggle above only controls whether the homeowner sees it in their Customer Portal.
          </div>

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

      {/* Notes list — newest first (client-side sort in `filtered`). */}
      {isLoading && <p className="text-sm text-muted-foreground text-center py-6">Loading notes…</p>}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <StickyNote className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No notes yet.</p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map(note => (
          <Card
            key={note.id}
            className="border border-border transition-colors"
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
                      {editPublic ? <><Globe className="w-3 h-3" />Shared with homeowner</> : <><Lock className="w-3 h-3" />Staff only (homeowner won't see)</>}
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
                      {note.isPublic && (
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          <Globe className="w-3 h-3" />Homeowner
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {note.createdAt ? fmtDate(note.createdAt, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
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
    </div>
  );
}

// ProgressAndMilestonesCard ── Collapsible pipeline+dates surface for Activity
//
// Cody: "the pipeline function and features need to collapse and work inside
// milestones the activity page in job detail". So the standalone Pipeline
// tab is gone and its two features (stage selector + vertical pipeline list)
// live here, folded into the same collapsible unit as the milestone-date
// editor that used to sit at the bottom of the Pipeline tab.
//
// Collapsed view (default): compact header + horizontal stepper dots so the
// pipeline picture is legible at a glance without opening the card.
// Expanded view: the full vertical stage list + the InlineMilestoneDates
// editor, exactly as they existed on the old Pipeline tab.
function ProgressAndMilestonesCard({ job }: { job: any }) {
  // Expanded by default — this section replaces the read-only Milestones
  // bucket that used to live at the bottom of Activity, so the dates it
  // held stay visible without an extra click. Users who prefer it
  // collapsed have their choice persisted per-job.
  const storageKey = `titan.progressMilestones.open.${job.id}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v === null ? true : v === "1";
    } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, open ? "1" : "0"); } catch { /* ignore */ }
  }, [open, storageKey]);

  const currentOrder = PROGRESS_STAGES.findIndex(
    (s) => s.key === (job.progressStage || "pending_sale")
  );
  const currentStage = PROGRESS_STAGES[Math.max(0, currentOrder)];
  const completed = Math.max(0, currentOrder);
  const total = PROGRESS_STAGES.length;

  return (
    <Card data-testid="card-progress-milestones">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 text-muted-foreground hover:text-foreground shrink-0"
            aria-label={open ? "Collapse" : "Expand"}
            data-testid="button-toggle-progress-milestones"
          >
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
              <TrendingUp className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
              Progress &amp; Milestones
              <span className="ml-1 text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                {completed}/{total} complete
              </span>
              <span className="ml-auto">
                <StageSelector job={job} />
              </span>
            </CardTitle>
            {/* Horizontal stepper — always visible so the pipeline is
                legible without expanding. Each dot is a stage; filled
                dots are past, the highlighted one is current, faint
                dots are ahead. */}
            <div className="mt-3 flex items-center gap-1.5" data-testid="mini-pipeline-stepper">
              {PROGRESS_STAGES.map((stage, idx) => {
                const isPast = idx < currentOrder;
                const isCurrent = idx === currentOrder;
                return (
                  <div
                    key={stage.key}
                    title={stage.label}
                    className={
                      "h-1.5 flex-1 rounded-full transition-colors " +
                      (isCurrent
                        ? "bg-[hsl(var(--titan-blue))]"
                        : isPast
                        ? "bg-green-500/70 dark:bg-green-400/60"
                        : "bg-muted")
                    }
                  />
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Current: <span className="font-medium">{currentStage?.label ?? "Pending"}</span>
              {" · "}
              {open ? "Edit any date below and hit save." : "Expand to edit any pipeline or phase date."}
            </p>
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="pt-0 space-y-4">
          {/* Full vertical stage list — same visual language as the old
              Pipeline tab so muscle memory carries over. */}
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium">Pipeline stages</p>
            <div className="space-y-2">
              {PROGRESS_STAGES.map((stage, idx) => {
                const isPast = idx < currentOrder;
                const isCurrent = idx === currentOrder;
                const dateStr = (job as any)[stage.dateField] as string | undefined;
                return (
                  <div
                    key={stage.key}
                    className={
                      "flex items-center gap-3 p-2.5 rounded-lg border transition-all " +
                      (isCurrent
                        ? `${stage.color} ${stage.borderColor} shadow-sm`
                        : isPast
                        ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                        : "bg-muted/20 border-border opacity-60")
                    }
                  >
                    <div
                      className={
                        "w-7 h-7 rounded-full flex items-center justify-center shrink-0 " +
                        (isPast
                          ? "bg-green-100 text-green-700"
                          : isCurrent
                          ? `${stage.color} ${stage.textColor}`
                          : "bg-muted text-muted-foreground")
                      }
                    >
                      {isPast ? (
                        <span className="text-green-700 text-xs font-bold">✓</span>
                      ) : (
                        <stage.icon className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p
                          className={
                            "text-sm font-medium " +
                            (isCurrent
                              ? stage.textColor
                              : isPast
                              ? "text-green-700 dark:text-green-400"
                              : "text-muted-foreground")
                          }
                        >
                          {stage.label}
                        </p>
                        {isCurrent && (
                          <Badge className={`text-xs border ${stage.color} ${stage.textColor} ${stage.borderColor}`}>
                            Current
                          </Badge>
                        )}
                      </div>
                      {dateStr && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {stage.dateLabel}: {fmtDate(dateStr, { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Click the stage badge at the top of this card to advance or move the job to any pipeline stage.
              Dates are auto-stamped when you change stages.
            </p>
          </div>

          {/* Editable milestone dates — same component the Pipeline tab used. */}
          <InlineMilestoneDates job={job} />
        </CardContent>
      )}
    </Card>
  );
}

// ── Inline Milestone Dates Component ─────────────────────────────────────────
function InlineMilestoneDates({ job }: { job: any }) {
  const { toast } = useToast();
  // Two groups of dates share this one editor:
  //   1) Pipeline-stage dates (drive PROGRESS_STAGES forward when saved).
  //   2) Phase-boundary dates (Mitigation Start / Dry-Out Complete /
  //      Reconstruction Start / Job Complete) — previously read-only on
  //      the Activity page. Cody: "I want to be able to manually edit
  //      dates all in that one section", so they're plain editable
  //      inputs saved through the same PATCH.
  const [dates, setDates] = useState({
    salesDate: job.salesDate || "",
    preProductionDate: job.preProductionDate || "",
    wipDate: job.wipDate || "",
    invoiceSentDate: job.invoiceSentDate || "",
    invoicePaidDate: job.invoicePaidDate || "",
    mitigationStart: job.mitigationStart || "",
    dryOutComplete: job.dryOutComplete || "",
    reconstructionStart: job.reconstructionStart || "",
    jobComplete: job.jobComplete || "",
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
    { key: "salesDate", label: "Date Received", stage: PROGRESS_STAGES[0] },
    { key: "preProductionDate", label: "Pre-Production Start", stage: PROGRESS_STAGES[1] },
    { key: "wipDate", label: "WIP Start", stage: PROGRESS_STAGES[2] },
    { key: "invoiceSentDate", label: "Invoice Sent", stage: PROGRESS_STAGES[3] },
    { key: "invoicePaidDate", label: "Payment Received", stage: PROGRESS_STAGES[5] },
  ];

  // Phase-boundary dates — don't drive pipeline stages, but track the
  // work-on-the-ground timeline the office reports on.
  const PHASE_ROWS = [
    { key: "mitigationStart", label: "Mitigation Start" },
    { key: "dryOutComplete", label: "Dry-Out Complete" },
    { key: "reconstructionStart", label: "Reconstruction Start" },
    { key: "jobComplete", label: "Job Complete" },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <span>📅</span> Milestone Dates
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Pipeline-stage dates — drive PROGRESS_STAGES forward. */}
        <div className="space-y-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Pipeline Dates</p>
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
        </div>

        {/* Phase-boundary dates — track work-on-the-ground timing. */}
        <div className="space-y-3 pt-3 border-t">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Phase Dates</p>
          {PHASE_ROWS.map((row) => (
            <div key={row.key} className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
                <Droplets className="w-3.5 h-3.5" />
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
          ))}
        </div>

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

  const [activeTab, setActiveTab] = useState(() => {
    // Respect ?tab=documents (or any tab name) from deep-links — used by
    // notification-bell / pending-signatures-badge navigation so a click on
    // "Jane signed the Work Auth" lands directly on the Documents tab.
    try {
      const p = new URLSearchParams(window.location.search).get("tab");
      if (p) {
        // Pipeline tab retired — its content now lives inside a collapsible
        // "Progress & Milestones" card on the Activity tab. Old ?tab=pipeline
        // deep-links still work by landing on Activity.
        if (p === "pipeline") return "activity";
        return p;
      }
    } catch { /* ignore SSR / bad url */ }
    return "activity";
  });

  // Phase filter — controls which phase's data is shown across the job workspace.
  // Mitigation and Reconstruction are fully independent data sets on the same job:
  // each phase shows ONLY its own estimates, invoices, photos, and documents.
  const [phaseFilter, setPhaseFilter] = useState<string>("mitigation");
  // External-document upload dialogs — dropped in below the existing
  // "New Estimate" / "New Invoice" buttons on the Estimates and Invoices
  // tabs. See UploadExternalDocDialog.tsx.
  const [uploadEstOpen, setUploadEstOpen] = useState(false);
  const [uploadInvOpen, setUploadInvOpen] = useState(false);
  // Which invoice, if any, has the Record Payment dialog open. Null when
  // closed. Kept as an object so the dialog re-mounts fresh when switching
  // between invoices without stale state.
  const [payingInvoice, setPayingInvoice] = useState<{ id: number; invoiceNumber?: string | null; total?: number | null; contactId?: number | null; jobId?: number | null } | null>(null);
  // Settled Amount tile inline editor (Financial Summary). Writes to
  // jobs.settled_amount_manual which overrides the supplement-derived value.
  const [showSettledDialog, setShowSettledDialog] = useState(false);
  // Credit Memo tile dedicated dialog. Credit memos are billing reductions /
  // write-offs — tracked separately from payments received so we can
  // report them at tax time. Requires a reason.
  const [showCreditMemoDialog, setShowCreditMemoDialog] = useState(false);

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

  // Programmatic navigator for wouter — used after duplicating an estimate
  // to jump straight into the fresh draft.
  const [, navigate] = useLocation();

  // "Copy this estimate" — clones an existing estimate on this job into a
  // brand-new draft on the same job. Carries line items, notes, and phase.
  // Status is forced to "draft" (never carry over sent/approved/rejected).
  // Totals are re-derived server-side from the copied lineItems by the
  // POST /api/estimates handler, so we don't need to send them.
  const duplicateEstimate = useMutation({
    mutationFn: async (source: Estimate) => {
      const body = {
        jobId: source.jobId,
        title: /\(copy( \d+)?\)$/i.test(source.title || "")
          ? source.title
          : `${source.title || "Estimate"} (copy)`,
        status: "draft",
        phase: (source as any).phase || "mitigation",
        lineItems: (source as any).lineItems || "[]",
        notes: (source as any).notes || null,
      };
      const r = await apiRequest("POST", "/api/estimates", body);
      return r.json() as Promise<Estimate>;
    },
    onSuccess: (created) => {
      // Refresh both the per-job estimates list and the global one so the
      // new draft appears immediately on the Estimates tab and the /estimates
      // page. Financial totals are re-derived from lineItems on the server.
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", id, "estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      toast({ title: "Estimate duplicated", description: `Opened ${created.title} as a new draft.` });
      navigate(`/estimates/${created.id}`);
    },
    onError: (e: any) => toast({
      title: "Could not duplicate",
      description: e?.message || "Try again in a moment.",
      variant: "destructive",
    }),
  });

  // Delete an estimate from inside JobDetail (Estimates card trash button).
  // Server (DELETE /api/estimates/:id) enforces owner/admin/general_manager;
  // non-privileged clicks surface a 403 toast rather than silently no-op.
  const deleteEstimate = useMutation({
    mutationFn: async (estimateId: number) => {
      const r = await apiRequest("DELETE", `/api/estimates/${estimateId}`);
      return r.json().catch(() => ({}));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", id, "estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      toast({ title: "Estimate deleted" });
    },
    onError: (e: any) => toast({
      title: "Could not delete estimate",
      description: e?.message || "You may not have permission, or the estimate is locked.",
      variant: "destructive",
    }),
  });

  // Delete an invoice from inside JobDetail (Invoices card trash button).
  // Same role gate as estimates. Invalidates BOTH the per-job invoices list
  // and the global invoices/financials queries so the AR page updates too.
  const deleteInvoice = useMutation({
    mutationFn: async (invoiceId: number) => {
      const r = await apiRequest("DELETE", `/api/invoices/${invoiceId}`);
      return r.json().catch(() => ({}));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", id, "invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      toast({ title: "Invoice deleted" });
    },
    onError: (e: any) => toast({
      title: "Could not delete invoice",
      description: e?.message || "You may not have permission, or the invoice is locked.",
      variant: "destructive",
    }),
  });

  // Close / reopen state. UI is open to everyone — the server enforces
  // owner+admin at /api/jobs/:id/close (a non-admin click just gets a 403
  // toast). This keeps role-gate breakage from ever silently hiding the
  // button when a role string has an unexpected case or whitespace.
  const { employee: currentEmployee } = useAuth();
  const canManageClose = true;
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

  // Generic patch for any editable job field (jobNumber, yearBuilt, squareFeet).
  const updateJob = useMutation({
    mutationFn: (patch: Record<string, any>) =>
      apiRequest("PATCH", `/api/jobs/${id}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${id}`] });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message || "Try again.", variant: "destructive" }),
  });

  // Contact patch — identical shape, hits /api/contacts/:id. Used by the
  // in-job Customer editor so operators can fix a typo or phone number without
  // leaving the job page.
  const updateContactMut = useMutation({
    mutationFn: async (payload: { contactId: number; patch: Record<string, any> }) =>
      apiRequest("PATCH", `/api/contacts/${payload.contactId}`, payload.patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/contacts"] }),
    onError: (e: any) => toast({ title: "Customer update failed", description: e?.message || "Try again.", variant: "destructive" }),
  });

  // Header inline-edit state.
  const [editingJobNumber, setEditingJobNumber] = useState(false);
  const [jobNumberDraft, setJobNumberDraft] = useState("");
  const [propRefresh, setPropRefresh] = useState<{ status: "idle" | "loading" | "done" | "empty" | "error"; note: string }>({ status: "idle", note: "" });

  // ⚠️ Any hook (useState / useEffect / useMutation / useMemo / etc.) that
  // this component needs MUST live above the early returns below. React
  // requires the same set of hooks to be called on every render — adding a
  // hook after `if (isLoading) return ...` causes "Rendered more hooks than
  // during the previous render" (minified React error #310) on the render
  // that resolves the job. If you need to add a new effect, hoist it here
  // and guard the body with an early `if (!job) return;` inside the effect.

  // Job scope auto-switch. Kept up here (before early returns) so the hook
  // order stays stable across the loading -> loaded transition. The effect
  // body reads `job` defensively — it's undefined during the loading render.
  const jobScopeForEffect = String(((job as any)?.division) || "").toLowerCase();
  useEffect(() => {
    if (!job) return;
    if (jobScopeForEffect === "mitigation" && phaseFilter !== "mitigation") setPhaseFilter("mitigation");
    if (jobScopeForEffect === "reconstruction" && phaseFilter !== "reconstruction") setPhaseFilter("reconstruction");
  }, [job, jobScopeForEffect, phaseFilter]);

  // Set the browser tab title to the job number + customer/address so
  // multiple job tabs are distinguishable at a glance. Restore the default
  // title when this component unmounts so we don't leak a stale job label
  // onto the next page the user navigates to.
  const contactsForTitle = contacts;
  useEffect(() => {
    if (!job) return;
    const c = contactsForTitle.find(x => x.id === job.contactId);
    // Prefer customer name; fall back to short address; then just the number.
    // Format: "TP-2026-0042 · Jane Doe — Titan Pro"
    const shortAddr = (job.address || "").split(",")[0].trim();
    const label = c?.name || shortAddr || "";
    const title = label
      ? `${job.jobNumber} · ${label} — Titan Pro`
      : `${job.jobNumber} — Titan Pro`;
    const prev = document.title;
    document.title = title;
    return () => { document.title = prev; };
  }, [job, contactsForTitle]);

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

  // job.notes is a legacy free-form column. Historically it held a JSON
  // string of [{ author, body, ... }] before the job_notes table existed.
  // On older rows it may be plain text (or corrupted JSON), which used to
  // throw here and take down the whole page as "JobDetail failed to load".
  // Anything non-parseable is treated as "no legacy notes" — the current
  // notes table is the source of truth.
  let legacyNotes: any[] = [];
  try {
    const raw = job.notes;
    if (raw && typeof raw === "string" && raw.trim().startsWith("[")) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) legacyNotes = parsed;
    }
  } catch { /* legacy plain-text or garbage — ignore */ }
  const notesCount = notes.length + legacyNotes.length;

  // Phase-filtered views — strictly independent per phase (null/undefined phase
  // is treated as 'mitigation'). Data is never shared or duplicated between phases.
  const visibleEstimates = estimates.filter(e => (((e as any).phase as string) || "mitigation") === phaseFilter);
  const visibleInvoices = invoices.filter(i => (((i as any).phase as string) || "mitigation") === phaseFilter);
  const isRecon = phaseFilter === "reconstruction";
  const hasReferralPartner = !!job.referralPartnerId || job.leadSource === "referral";
  // Job scope drives which phase buttons appear. 'mitigation' = mit-only
  // job (no recon toggle). 'reconstruction' = recon-only job. 'both' or
  // unset = show both (legacy behavior).
  const jobScope = String((job as any).division || "").toLowerCase();
  const PHASES = ([
    { value: "mitigation", label: "Mitigation" },
    { value: "reconstruction", label: "Reconstruction" },
  ] as const).filter(p => {
    if (jobScope === "mitigation") return p.value === "mitigation";
    if (jobScope === "reconstruction") return p.value === "reconstruction";
    return true;
  });
  // Auto-switch effect for jobScope is hoisted above the early returns
  // (see `jobScopeForEffect` block near the top of the component). Do NOT
  // add a useEffect here — hooks after an early return break rules-of-hooks
  // and cause React error #310 on the loading → loaded transition.

  const isIncidental = (job as any).jobKind === "incidental";

  return (
    <div className="space-y-4">
      {isIncidental && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 flex items-start gap-3">
          <div className="text-2xl leading-none" aria-hidden>🤝</div>
          <div className="flex-1 text-sm">
            <div className="font-semibold text-amber-900 dark:text-amber-100">Courtesy work</div>
            <div className="text-amber-800 dark:text-amber-200/80 text-xs mt-0.5">
              This job is documented in full but excluded from revenue, AR, and pipeline reports.{" "}
              Estimate value is rolled up under the referring partner as courtesy delivered.
              {(job as any).incidentalReason ? <> · <span className="italic">{(job as any).incidentalReason}</span></> : null}
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3">
        <Link href="/jobs">
          <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Jobs</Button>
        </Link>
        <div className="flex-1 min-w-0">
          {editingJobNumber ? (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={jobNumberDraft}
                onChange={e => setJobNumberDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    const v = jobNumberDraft.trim();
                    if (v && v !== job.jobNumber) {
                      updateJob.mutate({ jobNumber: v }, { onSuccess: () => toast({ title: "Job number updated", description: v }) });
                    }
                    setEditingJobNumber(false);
                  } else if (e.key === "Escape") {
                    setEditingJobNumber(false);
                  }
                }}
                className="h-8 text-lg font-bold max-w-[220px]"
                data-testid="input-edit-job-number"
              />
              <Button size="sm" variant="ghost" onClick={() => {
                const v = jobNumberDraft.trim();
                if (v && v !== job.jobNumber) {
                  updateJob.mutate({ jobNumber: v }, { onSuccess: () => toast({ title: "Job number updated", description: v }) });
                }
                setEditingJobNumber(false);
              }}><Check className="w-4 h-4" /></Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingJobNumber(false)}><X className="w-4 h-4" /></Button>
            </div>
          ) : (
            <button
              type="button"
              className="group inline-flex items-center gap-1.5 text-xl font-bold hover:text-[hsl(var(--titan-blue))] transition-colors"
              onClick={() => { setJobNumberDraft(job.jobNumber); setEditingJobNumber(true); }}
              title="Click to edit job number"
              data-testid="btn-edit-job-number"
            >
              <span>{job.jobNumber}</span>
              <Pencil className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60" />
            </button>
          )}
          <p className="text-sm text-muted-foreground truncate">{job.lossType} · {job.address}</p>
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

      {/* ── Phase filter switch ── hidden for single-phase (mit-only or recon-only)
          jobs since there's only one option. The scope was set at job creation and
          drives which phase button(s) render here via PHASES. */}
      {PHASES.length > 1 && (
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
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="file-check" className="flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" />File Check
          </TabsTrigger>
          <TabsTrigger value="notes" className="flex items-center gap-1">
            <StickyNote className="w-3 h-3" />
            Notes {notesCount > 0 && <span className="ml-1 bg-[hsl(var(--titan-blue))] text-white text-[10px] px-1.5 py-0 rounded-full leading-5">{notesCount}</span>}
          </TabsTrigger>
          {!isRecon && <TabsTrigger value="mitigation"><Droplets className="w-3 h-3 mr-1 inline-block" />Mitigation</TabsTrigger>}
          <TabsTrigger value="photos"><Camera className="w-3 h-3 mr-1 inline-block" />Photos</TabsTrigger>
          <TabsTrigger value="documents"><FolderOpen className="w-3 h-3 mr-1 inline-block" />Documents</TabsTrigger>
          <TabsTrigger value="estimates">Estimates ({visibleEstimates.length})</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({visibleInvoices.length})</TabsTrigger>
          <TabsTrigger value="payments"><DollarSign className="w-3 h-3 mr-1 inline-block" />Payments</TabsTrigger>
          <TabsTrigger value="insurance">Insurance</TabsTrigger>
          <TabsTrigger value="costing">Job Costing</TabsTrigger>
          <TabsTrigger value="supplements">Supplements</TabsTrigger>
          <TabsTrigger value="safety">Safety</TabsTrigger>
          <TabsTrigger value="hazmat"><FlaskConical className="w-3 h-3 mr-1 inline-block" />Lead &amp; Asbestos</TabsTrigger>
          {!isRecon && <TabsTrigger value="dry-report">Dry Report</TabsTrigger>}
          <TabsTrigger value="warranty"><Wrench className="w-3 h-3 mr-1 inline-block" />Warranty Calls</TabsTrigger>
          {hasReferralPartner && <TabsTrigger value="referral-payout"><HandCoins className="w-3 h-3 mr-1 inline-block" />Referral Payout</TabsTrigger>}
          <TabsTrigger value="sms-thread"><MessageSquare className="w-3 h-3 mr-1 inline-block" />SMS Thread</TabsTrigger>
          <TabsTrigger value="lien-waivers"><ShieldCheck className="w-3 h-3 mr-1 inline-block" />Lien Waivers</TabsTrigger>
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
                {/* Costs — clickable, jumps to Job Costing where entries are
                    added, edited, and deleted. */}
                <button
                  type="button"
                  onClick={() => setActiveTab("costing")}
                  className="text-left group focus:outline-none"
                  data-testid="jobfin-costs"
                  title="Open Job Costing to add or edit costs"
                >
                  <span className="text-xs text-muted-foreground block mb-0.5">Costs</span>
                  <span className="text-lg font-bold text-orange-600 dark:text-orange-400 group-hover:underline inline-flex items-center gap-1">
                    {money(phaseFin?.totalCosts ?? 0)}
                    <ExternalLink className="w-3 h-3 opacity-60" />
                  </span>
                </button>
                {/* Settled Amount — manual override lives on jobs.settled_amount_manual.
                    Click to open a small dollar-input dialog. */}
                <button
                  type="button"
                  onClick={() => setShowSettledDialog(true)}
                  className="text-left group focus:outline-none"
                  data-testid="jobfin-settled"
                  title="Click to manually set the claim settled amount"
                >
                  <span className="text-xs text-muted-foreground block mb-0.5">
                    Settled Amount <span className="text-[9px] normal-case text-muted-foreground/70">(claim-level)</span>
                  </span>
                  <span className="text-lg font-bold text-[hsl(var(--titan-blue))] group-hover:underline inline-flex items-center gap-1">
                    {money(phaseFin?.settledAmount ?? 0)}
                    <Pencil className="w-3 h-3 opacity-60" />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("payments")}
                  className="text-left group focus:outline-none"
                  data-testid="jobfin-collected"
                  title="View payment history"
                >
                  <span className="text-xs text-muted-foreground block mb-0.5">Received</span>
                  <span className="text-lg font-bold text-green-600 dark:text-green-400 group-hover:underline inline-flex items-center gap-1">
                    {money(phaseFin?.collected ?? 0)}
                    <ExternalLink className="w-3 h-3 opacity-60" />
                  </span>
                </button>
                {/* Credit Memo — write-offs / bill reductions. Opens a
                    dedicated dialog because this is a LOSS (not a
                    payment) and each entry needs a taxable reason. */}
                <button
                  type="button"
                  onClick={() => setShowCreditMemoDialog(true)}
                  className="text-left group focus:outline-none"
                  data-testid="jobfin-creditmemo"
                  title="Record a write-off / bill reduction (tracked for taxes)"
                >
                  <span className="text-xs text-muted-foreground block mb-0.5">Credit Memo</span>
                  <span className="text-lg font-bold text-red-600 dark:text-red-400 group-hover:underline inline-flex items-center gap-1">
                    {money(phaseFin?.creditMemos ?? 0)}
                    <Pencil className="w-3 h-3 opacity-60" />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("payments")}
                  className="text-left group focus:outline-none"
                  data-testid="jobfin-outstanding"
                  title="View payment history"
                >
                  <span className="text-xs text-muted-foreground block mb-0.5">Outstanding</span>
                  <span className={`text-lg font-bold group-hover:underline inline-flex items-center gap-1 ${(phaseFin?.outstanding ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                    {money(phaseFin?.outstanding ?? 0)}
                    <ExternalLink className="w-3 h-3 opacity-60" />
                  </span>
                </button>
                {/* Gross Profit / Margin — both derived (collected − costs),
                    so clicking jumps to Job Costing where the movable
                    variable (costs) lives. */}
                <button
                  type="button"
                  onClick={() => setActiveTab("costing")}
                  className="text-left group focus:outline-none"
                  data-testid="jobfin-grossprofit"
                  title="Derived from Received − Costs. Open Job Costing to adjust."
                >
                  <span className="text-xs text-muted-foreground block mb-0.5">Gross Profit</span>
                  <span className={`text-lg font-bold group-hover:underline inline-flex items-center gap-1 ${(phaseFin?.grossProfit ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {money(phaseFin?.grossProfit ?? 0)}
                    <ExternalLink className="w-3 h-3 opacity-60" />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("costing")}
                  className="text-left group focus:outline-none"
                  data-testid="jobfin-margin"
                  title="Gross profit as a share of received revenue. Open Job Costing to adjust."
                >
                  <span className="text-xs text-muted-foreground block mb-0.5">Gross Profit Margin</span>
                  <span className={`text-lg font-bold group-hover:underline inline-flex items-center gap-1 ${(phaseFin?.grossMarginPct ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {phaseFin?.grossMarginPct ?? 0}%
                    <ExternalLink className="w-3 h-3 opacity-60" />
                  </span>
                </button>
              </div>
              {/* External-document rollup: highlights the portion of the
                  phase's Estimate/Invoice totals that came from outside-
                  authored PDFs uploaded to the job (Xactimate, sub invoices,
                  carrier approvals, etc.). Hidden entirely when there are
                  none in this phase. */}
              {(((phaseFin?.externalEstimateCount ?? 0) + (phaseFin?.externalInvoiceCount ?? 0)) > 0) && (
                <div className="mt-4 pt-3 border-t" data-testid="jobfin-external">
                  <div className="flex items-center gap-2 mb-2">
                    <Paperclip className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">External documents in this phase</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <button
                      type="button"
                      onClick={() => setActiveTab("estimates")}
                      className="text-left group focus:outline-none"
                      data-testid="jobfin-external-estimates"
                      title="View estimates"
                    >
                      <span className="text-xs text-muted-foreground block">
                        {phaseFin?.externalEstimateCount ?? 0} uploaded estimate(s)
                      </span>
                      <span className="text-sm font-semibold text-[hsl(var(--titan-blue))] group-hover:underline">
                        {money(phaseFin?.externalEstimateTotal ?? 0)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab("invoices")}
                      className="text-left group focus:outline-none"
                      data-testid="jobfin-external-invoices"
                      title="View invoices"
                    >
                      <span className="text-xs text-muted-foreground block">
                        {phaseFin?.externalInvoiceCount ?? 0} uploaded invoice(s)
                      </span>
                      <span className="text-sm font-semibold text-green-600 dark:text-green-400 group-hover:underline">
                        {money(phaseFin?.externalInvoiceTotal ?? 0)}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground mt-4 pt-3 border-t">
                Figures reflect the <span className="font-medium capitalize text-foreground">{phaseFilter}</span> phase only, except Settled Amount which is claim-level (same on both phases).
                Gross profit = collected revenue &minus; job costs. Margin is profit as a share of collected revenue.
                Outstanding = invoiced &minus; collected. External-doc totals are already included in the Estimate Amount and Outstanding figures above &mdash; the strip only breaks out how much came from uploaded outside documents. Click the estimate amount to view estimates.
              </p>
            </CardContent>
          </Card>

          {/* ── Per-job Analytics ── */}
          {/* Cycle time, estimate variance, supplement win rate, AR aging,
              margin, activity, and a carrier benchmark scoped to THIS job. */}
          <JobAnalytics jobId={job.id} />

          {contact && (
            <EditableCustomerCard
              contact={contact}
              saving={updateContactMut.isPending}
              onSave={(patch) => updateContactMut.mutate({ contactId: contact.id, patch })}
            />
          )}

          {/* Inline field-action bar. Sits under the customer card so techs
              hit Check In / Photo / Note / Call at the top of the Activity
              tab without scrolling. The sticky bottom bar (mobile only) is
              still rendered at page level as a fallback. */}
          <JobFieldActionBar
            jobId={job.id}
            contactPhone={(contact as any)?.phone || null}
            onSwitchTab={setActiveTab}
          />

          {/* Property record card — editable Year Built & Square Feet plus a
              button to re-run the OSM lookup. Year Built drives EPA RRP lead
              risk flagging in the AI agent. */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Property Details</CardTitle>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-xs"
                disabled={!job.address || propRefresh.status === "loading"}
                onClick={async () => {
                  setPropRefresh({ status: "loading", note: "Looking up public records…" });
                  try {
                    const resp = await fetch(`/api/property-lookup?address=${encodeURIComponent(job.address || "")}`);
                    const data = await resp.json();
                    const patch: any = {};
                    if (data.yearBuilt) patch.yearBuilt = data.yearBuilt;
                    if (data.squareFeet) patch.squareFeet = data.squareFeet;
                    if (Object.keys(patch).length > 0) updateJob.mutate(patch);
                    setPropRefresh({ status: (data.yearBuilt || data.squareFeet) ? "done" : "empty", note: data.note || "" });
                  } catch {
                    setPropRefresh({ status: "error", note: "Lookup unavailable." });
                  }
                }}
                data-testid="btn-refresh-property"
              >
                <RefreshCw className={`w-3 h-3 ${propRefresh.status === "loading" ? "animate-spin" : ""}`} /> Refresh from address
              </Button>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Year Built</Label>
                  <Input
                    type="number"
                    min={1700}
                    max={new Date().getFullYear() + 1}
                    placeholder="e.g. 1965"
                    defaultValue={(job as any).yearBuilt ?? ""}
                    key={`yb-${(job as any).yearBuilt ?? ""}`}
                    onBlur={e => {
                      const v = e.target.value.trim();
                      const num = v === "" ? null : Number(v) || null;
                      if (num !== ((job as any).yearBuilt ?? null)) {
                        updateJob.mutate({ yearBuilt: num });
                      }
                    }}
                    data-testid="input-detail-year-built"
                  />
                  {(((job as any).yearBuilt || 0) > 0 && ((job as any).yearBuilt || 0) < 1978) && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">Pre-1978 — EPA RRP lead-safe protocol applies.</p>
                  )}
                </div>
                <div>
                  <Label className="text-xs">Square Feet</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="e.g. 1800"
                    defaultValue={(job as any).squareFeet ?? ""}
                    key={`sf-${(job as any).squareFeet ?? ""}`}
                    onBlur={e => {
                      const v = e.target.value.trim();
                      const num = v === "" ? null : Number(v) || null;
                      if (num !== ((job as any).squareFeet ?? null)) {
                        updateJob.mutate({ squareFeet: num });
                      }
                    }}
                    data-testid="input-detail-square-feet"
                  />
                </div>
              </div>
              {propRefresh.status !== "idle" && (
                <p className={`text-[11px] ${
                  propRefresh.status === "done" ? "text-green-700 dark:text-green-400" :
                  propRefresh.status === "error" ? "text-amber-700 dark:text-amber-400" :
                  "text-muted-foreground"
                }`}>{propRefresh.note}</p>
              )}
            </CardContent>
          </Card>

          {contact && <CustomerPortalCard contact={contact} />}

          {job.description && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Description</CardTitle></CardHeader>
              <CardContent className="pt-0"><p className="text-sm text-muted-foreground">{job.description}</p></CardContent>
            </Card>
          )}

          {/* Merged Progress + Milestones section (Cody: merge them,
              collapse, and let me edit every date here). Header shows
              current stage + mini stepper; expand to see full stage
              list and editable date grid (pipeline + phase dates). */}
          <ProgressAndMilestonesCard job={job} />

          {/* Recent public notes preview on activity tab */}
          {notes.length > 0 && (
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <StickyNote className="w-4 h-4" />
                  Recent Notes
                </CardTitle>
                <Badge variant="outline" className="text-xs">{notes.length} note{notes.length !== 1 ? "s" : ""}</Badge>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                {notes.slice(-3).reverse().map(note => (
                  <div key={note.id} className="text-sm bg-muted/40 rounded p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold">{note.author}</span>
                      {note.tag && <span className="text-xs text-muted-foreground">@{note.tag}</span>}
                      {note.isPublic && (
                        <span className="flex items-center gap-0.5 text-[10px] text-green-700 dark:text-green-400">
                          <Globe className="w-2.5 h-2.5" />homeowner
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">{note.createdAt ? fmtDateShort(note.createdAt) : ""}</span>
                    </div>
                    <p className="text-muted-foreground">{note.body}</p>
                  </div>
                ))}
                {notes.length > 3 && (
                  <p className="text-xs text-muted-foreground text-center">+ {notes.length - 3} more — open Notes tab to view all</p>
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
                      <span className="text-xs text-muted-foreground ml-auto">{n.createdAt ? fmtDateShort(n.createdAt) : ""}</span>
                    </div>
                    <p>{n.text}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Notes Tab ── */}
        <TabsContent value="file-check" className="mt-4">
          <JobFileChecklist job={job} />
        </TabsContent>
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
            <div className="border-t pt-6 space-y-4">
              <DryingPlanCard jobId={job.id} />
              <DryingRecords jobId={job.id} />
            </div>
          </div>
        </TabsContent>

        {/* ── Photos Tab ── */}
        <TabsContent value="photos" className="mt-4">
          <JobPhotos jobId={job.id} phase={phaseFilter} />
        </TabsContent>

        {/* Standalone Floor Plan tab retired — sketch tool lives on the
            Mitigation tab (MitigationSketch). */}

        {/* ── Documents Tab ── */}
        <TabsContent value="documents" className="mt-4">
          <Suspense fallback={<TabLoading />}><JobDocuments jobId={job.id} phase={phaseFilter} /></Suspense>
        </TabsContent>

        {/* ── Estimates Tab ── */}
        <TabsContent value="estimates" className="mt-4">
          <div className="flex justify-between items-center mb-3 gap-2">
            <p className="text-sm text-muted-foreground">{visibleEstimates.length} estimate(s)<span className="capitalize"> · {phaseFilter}</span></p>
            <div className="flex items-center gap-2">
              {/* Upload an outside-authored estimate PDF/image directly into
                  this phase's bucket. See UploadExternalDocDialog. */}
              <Button size="sm" variant="outline" onClick={() => setUploadEstOpen(true)}>
                <Upload className="w-3 h-3 mr-1" />Upload external
              </Button>
              {/* Carry the current job id + phase into the New Estimate
                  dialog so the estimate lands on the phase the user is
                  actually viewing (was defaulting to mitigation and
                  appearing missing when the user was on reconstruction). */}
              <Link href={`/estimates?jobId=${job.id}&phase=${phaseFilter}`}>
                <Button size="sm" variant="outline"><FileText className="w-3 h-3 mr-1" />New Estimate</Button>
              </Link>
            </div>
          </div>
          <div className="space-y-2">
            {visibleEstimates.map(e => {
              const isExternal = (e as any).source === "external";
              // Internal estimates get a "Duplicate" action so users can
              // start a new estimate seeded with the line items / notes
              // from an existing one on the same job. External estimates
              // (uploaded PDFs) can't be duplicated — there's no line-item
              // data to copy, they're just attached files.
              // Plain-anchor navigation can't attach the Authorization header,
              // so external-file routes accept the same session token via ?t=.
              // Falls back to the un-tokened path if we don't have a token yet
              // (e.g. race with initial auth) — the server still returns 401
              // in that case, matching prior behavior.
              const tok = typeof window !== "undefined" ? (window as any).__titanToken__ : undefined;
              const openHref = isExternal
                ? `/api/estimates/${e.id}/external-file${tok ? `?t=${encodeURIComponent(tok)}` : ""}`
                : `/estimates/${e.id}`;
              return (
                <Card key={e.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    {isExternal ? (
                      <a
                        href={openHref}
                        target="_blank"
                        rel="noreferrer"
                        title="Open external estimate"
                        className="min-w-0 flex-1 cursor-pointer"
                      >
                        <p className="font-semibold text-sm truncate flex items-center gap-1.5">
                          <Paperclip className="w-3 h-3 shrink-0 text-muted-foreground" />
                          {e.title}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {e.status}
                          {(e as any).externalVendor ? ` · ${(e as any).externalVendor}` : ""}
                          {" · external"}
                        </p>
                      </a>
                    ) : (
                      <Link href={openHref} className="min-w-0 flex-1 cursor-pointer">
                        <p className="font-semibold text-sm truncate">{e.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{e.status}</p>
                      </Link>
                    )}
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="font-bold text-[hsl(var(--titan-blue))]">${(e.total || 0).toLocaleString()}</p>
                      {!isExternal && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          title="Duplicate as new draft on this job"
                          disabled={duplicateEstimate.isPending}
                          onClick={(ev) => {
                            ev.preventDefault();
                            ev.stopPropagation();
                            duplicateEstimate.mutate(e);
                          }}
                          data-testid={`button-duplicate-estimate-${e.id}`}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      )}
                      {/* Delete estimate. Server enforces owner/admin/GM;
                          the confirm() dialog just guards against fat-finger
                          taps on the mobile job page. Works for both internal
                          and external (uploaded PDF) estimates. */}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        title="Delete this estimate"
                        disabled={deleteEstimate.isPending}
                        onClick={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                          if (confirm(`Delete estimate "${e.title}"? This cannot be undone.`)) {
                            deleteEstimate.mutate(e.id);
                          }
                        }}
                        data-testid={`button-delete-estimate-${e.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {visibleEstimates.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No estimates for {phaseFilter} yet.</p>}
          </div>
        </TabsContent>

        {/* ── Invoices Tab ── */}
        <TabsContent value="invoices" className="mt-4">
          <div className="flex justify-between items-center mb-3 gap-2">
            <p className="text-sm text-muted-foreground">{visibleInvoices.length} invoice(s)<span className="capitalize"> · {phaseFilter}</span></p>
            <div className="flex items-center gap-2">
              {/* Upload an outside-authored invoice PDF/image directly into
                  this phase's bucket. See UploadExternalDocDialog. */}
              <Button size="sm" variant="outline" onClick={() => setUploadInvOpen(true)}>
                <Upload className="w-3 h-3 mr-1" />Upload external
              </Button>
              {/* Deep-link to the standalone Invoices page with jobId + phase
                  pre-filled so the new invoice lands on the phase the user
                  is actually viewing (matches the Estimates flow). */}
              <Link href={`/invoices?jobId=${job.id}&phase=${phaseFilter}`}>
                <Button size="sm" variant="outline"><Receipt className="w-3 h-3 mr-1" />New Invoice</Button>
              </Link>
            </div>
          </div>
          <div className="space-y-2">
            {visibleInvoices.map(inv => {
              const isExternal = (inv as any).source === "external";
              // Internal invoices don't have their own /invoices/:id route
              // (the invoice editor lives on /invoices via an in-page dialog),
              // so we deep-link to /invoices?edit=<id> and the Invoices page
              // auto-opens the edit dialog on mount. External invoices are
              // just uploaded files — open the file directly, no edit UI.
              const inner = (
                <Card className={isExternal ? "hover:shadow-md transition-shadow cursor-pointer" : "hover:shadow-md transition-shadow"}>
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate flex items-center gap-1.5">
                        {isExternal && <Paperclip className="w-3 h-3 shrink-0 text-muted-foreground" />}
                        {inv.invoiceNumber}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {inv.status}{inv.dueDate ? ` · Due ${inv.dueDate}` : ""}
                        {isExternal && (inv as any).externalVendor ? ` · ${(inv as any).externalVendor}` : ""}
                        {isExternal ? " · external" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="font-bold text-green-600">${(inv.total || 0).toLocaleString()}</p>
                      {!isExternal && (
                        <>
                          {/* Record Payment — the primary money-in action.
                              Hidden for invoices already fully paid so the
                              row stays quiet once it's cleared. */}
                          {inv.status !== "paid" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8"
                              title="Record a payment against this invoice"
                              onClick={(ev) => {
                                ev.preventDefault();
                                ev.stopPropagation();
                                setPayingInvoice({
                                  id: inv.id,
                                  invoiceNumber: inv.invoiceNumber,
                                  total: inv.total,
                                  contactId: (inv as any).contactId ?? null,
                                  jobId: (inv as any).jobId ?? Number(id),
                                });
                              }}
                              data-testid={`button-record-payment-${inv.id}`}
                            >
                              <DollarSign className="w-3 h-3 mr-1" />Record Payment
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            title="Edit this invoice"
                            onClick={(ev) => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              navigate(`/invoices?edit=${inv.id}`);
                            }}
                            data-testid={`button-edit-invoice-${inv.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            title="Delete this invoice"
                            disabled={deleteInvoice.isPending}
                            onClick={(ev) => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              if (confirm(`Delete invoice ${inv.invoiceNumber}? This cannot be undone.`)) {
                                deleteInvoice.mutate(inv.id);
                              }
                            }}
                            data-testid={`button-delete-invoice-${inv.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
              return isExternal ? (
                <a
                  key={inv.id}
                  href={(() => {
                    const tok = typeof window !== "undefined" ? (window as any).__titanToken__ : undefined;
                    return `/api/invoices/${inv.id}/external-file${tok ? `?t=${encodeURIComponent(tok)}` : ""}`;
                  })()}
                  target="_blank"
                  rel="noreferrer"
                  title="Open external invoice"
                >
                  {inner}
                </a>
              ) : (
                <div key={inv.id}>{inner}</div>
              );
            })}
            {visibleInvoices.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No invoices for {phaseFilter} yet.</p>}
          </div>
        </TabsContent>

        {/* ── Payments Tab ── */}
        {/* Full history of every payment received on this job's invoices,
            plus invoiced/received/outstanding rollup. Answers 'has this
            check hit yet?' without leaving the job. */}
        <TabsContent value="payments" className="mt-4">
          <JobPaymentsPanel jobId={Number(id)} contactId={job?.contactId ?? null} />
        </TabsContent>

        {/* ── Lead & Asbestos Tab ── */}
        {/* Per-job hazmat assessment. Replaces the removed AI Agent Center's
            global hazmat scan — the decision is always per-structure, so it
            belongs on the job. */}
        <TabsContent value="hazmat" className="mt-4">
          <JobHazmatPanel
            jobId={Number(id)}
            yearBuilt={(job as any)?.yearBuilt ?? null}
            lossType={(job as any)?.lossType ?? null}
          />
        </TabsContent>

        {/* ── Insurance Tab ── */}
        <TabsContent value="insurance" className="mt-4 space-y-4">
          <InsuranceEditor job={job} updateJob={updateJob} />
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


        <TabsContent value="costing" className="mt-4"><JobCostingPanel jobId={Number(id)} phase={phaseFilter} /></TabsContent>
        <TabsContent value="supplements" className="mt-4"><SupplementPanel jobId={Number(id)} job={job} /></TabsContent>
        <TabsContent value="safety" className="mt-4"><SafetyPanel jobId={Number(id)} /></TabsContent>
        {/* Lien Waivers used to live at /lien-waivers as a global list.
            The route still resolves; day-to-day authoring now happens in
            job context, so the tab is where waivers actually get written. */}
        <TabsContent value="lien-waivers" className="mt-4"><LienWaiversPanel jobId={Number(id)} /></TabsContent>
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

      {/* External-doc upload dialogs (mounted once, opened from the tab headers) */}
      <UploadExternalDocDialog
        kind="estimate"
        jobId={Number(id)}
        phase={phaseFilter}
        open={uploadEstOpen}
        onOpenChange={setUploadEstOpen}
        onUploaded={() => queryClient.invalidateQueries({ queryKey: ["/api/jobs", id, "estimates"] })}
      />
      <UploadExternalDocDialog
        kind="invoice"
        jobId={Number(id)}
        phase={phaseFilter}
        open={uploadInvOpen}
        onOpenChange={setUploadInvOpen}
        onUploaded={() => queryClient.invalidateQueries({ queryKey: ["/api/jobs", id, "invoices"] })}
      />

      {/* Record Payment dialog — driven by the Invoices tab's per-row button.
          Mounted once at the page level so it survives tab switches and
          re-mounts fresh per invoice via the key. */}
      {payingInvoice && (
        <RecordPaymentDialog
          key={payingInvoice.id}
          open={!!payingInvoice}
          onOpenChange={(o) => { if (!o) setPayingInvoice(null); }}
          invoice={payingInvoice}
          onRecorded={() => {
            // Refresh job-scoped invoice list so the row's status/badge updates.
            queryClient.invalidateQueries({ queryKey: ["/api/jobs", id, "invoices"] });
            queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
          }}
        />
      )}

      {/* Manual Settled Amount editor — opened from the Financial Summary tile. */}
      <SettledAmountDialog
        open={showSettledDialog}
        onOpenChange={setShowSettledDialog}
        job={job}
      />

      {/* Credit Memo (write-off) editor — opened from the Financial Summary tile.
          Suggests the invoiced-vs-settled delta as a starting amount. */}
      <CreditMemoDialog
        open={showCreditMemoDialog}
        onOpenChange={setShowCreditMemoDialog}
        jobId={job.id}
        invoicedTotal={(phaseFin as any)?.invoiceTotal ?? 0}
        collected={(phaseFin as any)?.collected ?? 0}
        settledAmount={(phaseFin as any)?.settledAmount ?? 0}
        currentCreditMemos={(phaseFin as any)?.creditMemos ?? 0}
      />
      {/* Sticky mobile action bar — hidden on md+ screens. Field techs get
          Check-In, Photo, Note, and Call one tap away no matter where they
          scroll on the job page. */}
      <MobileJobActionBar
        jobId={job.id}
        contactPhone={(contact as any)?.phone || null}
        onSwitchTab={setActiveTab}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EditableCustomerCard
// Inline editor for the customer contact linked to a job. Operators often
// discover typos or updated phone numbers while working the job — this saves
// them a trip back to the Contacts page.
//
// UX: displays as the read-only card by default; clicking "Edit" swaps to a
// stacked field editor with Save/Cancel. Save calls the parent-supplied
// onSave with only the changed fields.
// ─────────────────────────────────────────────────────────────────────────────
function EditableCustomerCard(props: {
  contact: Contact;
  onSave: (patch: Partial<Contact>) => void;
  saving: boolean;
}) {
  const { contact, onSave, saving } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    name: contact.name || "",
    phone: contact.phone || "",
    email: contact.email || "",
    address: contact.address || "",
  });

  useEffect(() => {
    setDraft({
      name: contact.name || "",
      phone: contact.phone || "",
      email: contact.email || "",
      address: contact.address || "",
    });
  }, [contact.id, contact.name, contact.phone, contact.email, contact.address]);

  const handleSave = () => {
    const patch: Partial<Contact> = {};
    if (draft.name.trim() && draft.name !== contact.name) patch.name = draft.name.trim();
    if (draft.phone !== (contact.phone || "")) (patch as any).phone = draft.phone.trim() || null;
    if (draft.email !== (contact.email || "")) (patch as any).email = draft.email.trim() || null;
    if (draft.address !== (contact.address || "")) (patch as any).address = draft.address.trim() || null;
    if (Object.keys(patch).length > 0) onSave(patch);
    setEditing(false);
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Customer</CardTitle>
        {!editing ? (
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs"
            onClick={() => setEditing(true)} data-testid="btn-edit-customer">
            <Pencil className="w-3 h-3" /> Edit
          </Button>
        ) : (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs"
              onClick={handleSave} disabled={saving} data-testid="btn-save-customer">
              <Check className="w-3 h-3" /> Save
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs"
              onClick={() => { setEditing(false); setDraft({
                name: contact.name || "", phone: contact.phone || "",
                email: contact.email || "", address: contact.address || "",
              }); }}>
              <X className="w-3 h-3" /> Cancel
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {!editing ? (
          <>
            <p className="font-semibold">{contact.name}</p>
            {contact.phone && <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-sm text-[hsl(var(--titan-blue))] hover:underline"><Phone className="w-3 h-3" />{contact.phone}</a>}
            {contact.email && <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-sm text-[hsl(var(--titan-blue))] hover:underline"><Mail className="w-3 h-3" />{contact.email}</a>}
            {contact.address && <p className="flex items-center gap-2 text-sm text-muted-foreground"><MapPin className="w-3 h-3" />{contact.address}</p>}
          </>
        ) : (
          <div className="space-y-2">
            <div>
              <Label className="text-xs">Name</Label>
              <Input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} data-testid="input-customer-name" />
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input value={draft.phone} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} placeholder="(555) 555-5555" data-testid="input-customer-phone" />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input type="email" value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} placeholder="name@example.com" data-testid="input-customer-email" />
            </div>
            <div>
              <Label className="text-xs">Address</Label>
              <Input value={draft.address} onChange={e => setDraft(d => ({ ...d, address: e.target.value }))} placeholder="Home address" data-testid="input-customer-address" />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * InsuranceEditor \u2014 inline-editable adjuster/claim card on the Insurance tab.
 * Displays as read-only until the operator clicks Edit; then reveals inputs
 * for adjuster name, phone, policy #, claim #. Save PATCHes /api/jobs/:id
 * via the shared updateJob mutation so cache invalidation is consistent
 * with the rest of the page.
 */
function InsuranceEditor({ job, updateJob }: { job: any; updateJob: any }) {
  const [editing, setEditing] = useState(false);
  // NOTE: the schema column is `insuranceCarrier` (DB: insurance_carrier).
  // An earlier version used `insuranceCompany`, which Drizzle silently
  // dropped on PATCH because it wasn't a real column — so the save appeared
  // to succeed but nothing persisted. Always read + write insuranceCarrier.
  const [draft, setDraft] = useState({
    adjusterName: job.adjusterName ?? "",
    adjusterPhone: job.adjusterPhone ?? "",
    policyNumber: job.policyNumber ?? "",
    claimNumber: job.claimNumber ?? "",
    insuranceCarrier: job.insuranceCarrier ?? "",
  });
  // Sync draft whenever the underlying job changes (e.g. after save invalidation).
  useEffect(() => {
    setDraft({
      adjusterName: job.adjusterName ?? "",
      adjusterPhone: job.adjusterPhone ?? "",
      policyNumber: job.policyNumber ?? "",
      claimNumber: job.claimNumber ?? "",
      insuranceCarrier: job.insuranceCarrier ?? "",
    });
  }, [job.adjusterName, job.adjusterPhone, job.policyNumber, job.claimNumber, job.insuranceCarrier]);

  const save = async () => {
    await updateJob.mutateAsync({
      adjusterName: draft.adjusterName.trim() || null,
      adjusterPhone: draft.adjusterPhone.trim() || null,
      policyNumber: draft.policyNumber.trim() || null,
      claimNumber: draft.claimNumber.trim() || null,
      insuranceCarrier: draft.insuranceCarrier.trim() || null,
    });
    setEditing(false);
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
          Adjuster Information
        </CardTitle>
        {editing ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} data-testid="button-insurance-cancel">
              <X className="w-3.5 h-3.5 mr-1" />Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={updateJob.isPending} data-testid="button-insurance-save">
              <Check className="w-3.5 h-3.5 mr-1" />{updateJob.isPending ? "Saving\u2026" : "Save"}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="button-insurance-edit">
            <Pencil className="w-3.5 h-3.5 mr-1" />Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {editing ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="col-span-2">
              <Label className="text-xs">Insurance Carrier</Label>
              {/* Select instead of free-text so scorecards group cleanly.
                  Users can add a new carrier via the "+ Add new" row —
                  server dedupes case-insensitively. */}
              <div className="mt-1">
                <CarrierSelect
                  value={draft.insuranceCarrier}
                  onChange={(name) => setDraft((d) => ({ ...d, insuranceCarrier: name }))}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Adjuster Name</Label>
              <Input
                className="mt-1"
                value={draft.adjusterName}
                onChange={e => setDraft(d => ({ ...d, adjusterName: e.target.value }))}
                placeholder="Full name"
                data-testid="input-adjuster-name"
              />
            </div>
            <div>
              <Label className="text-xs">Adjuster Phone</Label>
              <Input
                className="mt-1"
                value={draft.adjusterPhone}
                onChange={e => setDraft(d => ({ ...d, adjusterPhone: e.target.value }))}
                placeholder="(555) 555-5555"
                data-testid="input-adjuster-phone"
              />
            </div>
            <div>
              <Label className="text-xs">Policy #</Label>
              <Input
                className="mt-1"
                value={draft.policyNumber}
                onChange={e => setDraft(d => ({ ...d, policyNumber: e.target.value }))}
                data-testid="input-policy-number"
              />
            </div>
            <div>
              <Label className="text-xs">Claim #</Label>
              <Input
                className="mt-1"
                value={draft.claimNumber}
                onChange={e => setDraft(d => ({ ...d, claimNumber: e.target.value }))}
                data-testid="input-claim-number"
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">Insurance Carrier</p>
              <p className="font-medium">{job.insuranceCarrier || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Adjuster</p>
              <p className="font-medium">{job.adjusterName || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              {job.adjusterPhone
                ? <a href={`tel:${job.adjusterPhone}`} className="text-[hsl(var(--titan-blue))] hover:underline font-medium">{job.adjusterPhone}</a>
                : <p className="font-medium">—</p>}
            </div>
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground">Adjuster Email</p>
              {job.adjusterEmail
                ? <a href={`mailto:${job.adjusterEmail}`} className="text-[hsl(var(--titan-blue))] hover:underline font-medium break-all">{job.adjusterEmail}</a>
                : <p className="font-medium">—</p>}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Policy #</p>
              <p className="font-medium">{job.policyNumber || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Claim #</p>
              <p className="font-medium">{job.claimNumber || "—"}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SettledAmountDialog — inline manual entry for the Financial Summary
// "Settled Amount" tile. Writes jobs.settled_amount_manual, which the
// /api/jobs/financials aggregate prefers over the supplement-derived value.
// Empty string clears the override so the value falls back to the supplement
// sum (or 0 if there are no approved supplements).
// ─────────────────────────────────────────────────────────────────────────────
function SettledAmountDialog({
  open, onOpenChange, job,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  job: any;
}) {
  const { toast } = useToast();
  const initial = job?.settledAmountManual != null ? String(job.settledAmountManual) : "";
  const [value, setValue] = useState<string>(initial);
  useEffect(() => { if (open) setValue(initial); }, [open, initial]);

  const save = useMutation({
    mutationFn: () => {
      const trimmed = value.trim();
      const payload: any = {
        // Empty string tells updateJob() to null the column (clears the
        // manual override so the supplement value is used again).
        settledAmountManual: trimmed === "" ? "" : trimmed,
      };
      return apiRequest("PATCH", `/api/jobs/${job.id}`, payload).then(r => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${job.id}`] });
      toast({ title: "Settled amount saved" });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: String(err?.message || err), variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Settled Amount</DialogTitle>
          <DialogDescription>
            Claim-level settlement dollars. Overrides the supplement-derived
            total shown on this job. Leave blank to fall back to the
            supplement approved total.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label className="text-sm">Amount (USD)</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="pl-6"
              data-testid="input-settled-amount"
              autoFocus
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Tip: leaving this blank clears the manual override.
          </p>
        </div>
        <DialogFooter className="flex justify-between gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => { setValue(""); }}
            disabled={save.isPending}
          >
            Clear
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
              data-testid="button-save-settled-amount"
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CreditMemoDialog — records a write-off / bill reduction on a job.
//
// Cody: credit memos are the difference between what we invoiced and what
// we ultimately settled for (carrier haircut, goodwill discount, etc.).
// They are NOT payments. Every one is tracked with a reason so the annual
// total can be pulled at tax time.
//
// The dialog suggests (invoicedTotal − collected − existingCreditMemos) as
// a starting amount so a single click captures the remaining shortfall.
// ─────────────────────────────────────────────────────────────────────────────

const CREDIT_MEMO_REASONS = [
  "Carrier settlement shortfall",
  "Deductible waiver / write-off",
  "Goodwill / customer satisfaction",
  "Duplicate invoice adjustment",
  "Pricing correction",
  "Uncollectible / bad debt",
  "Other",
];

function CreditMemoDialog({
  open, onOpenChange, jobId,
  invoicedTotal, collected, settledAmount, currentCreditMemos,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  jobId: number;
  invoicedTotal: number;
  collected: number;
  settledAmount: number;
  currentCreditMemos: number;
}) {
  const { toast } = useToast();

  // Suggested loss: what's still on the invoice that a settlement / write-off
  // is going to eat. Falls back to invoicedTotal − settledAmount if the
  // settlement figure implies a bigger haircut.
  const settlementDelta = Math.max(0, invoicedTotal - Math.max(collected, settledAmount) - currentCreditMemos);
  const suggested = settlementDelta > 0
    ? settlementDelta.toFixed(2)
    : Math.max(0, invoicedTotal - collected - currentCreditMemos).toFixed(2);

  const [amount, setAmount] = useState<string>(suggested);
  const [reasonPick, setReasonPick] = useState<string>(CREDIT_MEMO_REASONS[0]);
  const [note, setNote] = useState<string>("");
  useEffect(() => {
    if (open) {
      setAmount(suggested);
      setReasonPick(CREDIT_MEMO_REASONS[0]);
      setNote("");
    }
    // suggested is derived from props — safe to include here.
  }, [open, suggested]);

  const list = useQuery<any[]>({
    queryKey: [`/api/jobs/${jobId}/credit-memos`],
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () => {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter an amount greater than 0");
      const combinedReason = note.trim()
        ? `${reasonPick} — ${note.trim()}`
        : reasonPick;
      return apiRequest("POST", `/api/jobs/${jobId}/credit-memo`, {
        amount: amt,
        reason: combinedReason,
      }).then(r => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}/credit-memos`] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "invoices"] });
      toast({ title: "Credit memo recorded" });
      setNote("");
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: String(err?.message || err), variant: "destructive" });
    },
  });

  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/jobs/${jobId}/credit-memo/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}/credit-memos`] });
    },
  });

  const memos = list.data || [];
  const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Credit Memo (Write-Off)</DialogTitle>
          <DialogDescription>
            Records a reduction to the invoiced amount. This is a loss (not
            a payment) and is tracked separately so it can be reported at
            tax time.
          </DialogDescription>
        </DialogHeader>

        {/* Reference numbers so Cody can see the delta at a glance. */}
        <div className="grid grid-cols-3 gap-2 text-xs bg-muted/40 rounded-md p-3 border">
          <div>
            <div className="text-muted-foreground">Invoiced</div>
            <div className="font-semibold">{money(invoicedTotal)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Collected</div>
            <div className="font-semibold">{money(collected)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Settled</div>
            <div className="font-semibold">{money(settledAmount)}</div>
          </div>
          <div className="col-span-3 pt-1 border-t mt-1">
            <div className="text-muted-foreground">Suggested loss (invoiced − received − existing memos)</div>
            <div className="font-semibold text-red-600 dark:text-red-400">{money(Number(suggested))}</div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-sm">Loss amount (USD)</Label>
            <div className="relative mt-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-6"
                data-testid="input-credit-memo-amount"
                autoFocus
              />
            </div>
          </div>

          <div>
            <Label className="text-sm">Reason (required for tax)</Label>
            <Select value={reasonPick} onValueChange={setReasonPick}>
              <SelectTrigger className="mt-1" data-testid="select-credit-memo-reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CREDIT_MEMO_REASONS.map(r => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm">Notes (optional detail)</Label>
            <Input
              className="mt-1"
              placeholder="e.g. State Farm settled at $8,412 vs invoiced $9,200"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              data-testid="input-credit-memo-note"
            />
          </div>
        </div>

        {/* Existing credit memos for this job — quick history + delete. */}
        {memos.length > 0 && (
          <div className="border-t pt-3">
            <div className="text-xs font-semibold text-muted-foreground mb-2">
              Existing credit memos on this job
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {memos.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between gap-2 text-xs bg-muted/30 rounded px-2 py-1.5">
                  <div className="min-w-0">
                    <div className="font-semibold text-red-600 dark:text-red-400">{money(m.amount)}</div>
                    <div className="text-muted-foreground truncate">{m.memo_reason || "(no reason)"}</div>
                    {m.paid_at && (
                      <div className="text-[10px] text-muted-foreground/70">
                        {new Date(m.paid_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-muted-foreground hover:text-red-600"
                    onClick={() => del.mutate(m.id)}
                    disabled={del.isPending}
                    title="Delete this credit memo"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Close
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending}
            className="bg-red-600 hover:bg-red-700 text-white"
            data-testid="button-save-credit-memo"
          >
            {create.isPending ? "Saving…" : "Add credit memo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
