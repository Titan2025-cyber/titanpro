import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Plus, Send, Inbox, Send as SendIcon, FileText, Mail, ExternalLink,
  Settings, CheckCircle, Trash2, Link2, LogOut, RefreshCw, Search,
  Star, Archive, MailOpen, ArrowLeft, X, Reply, ReplyAll, Forward,
  HelpCircle, Paperclip, File as FileIcon, Download, ChevronDown, Tag,
  MoreVertical, Undo2, Pen, Clock, CalendarClock, Briefcase, User as UserIcon,
  AlertTriangle, Printer, Play,
} from "lucide-react";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient, buildAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useAuth } from "@/lib/auth";
import type { Email } from "@shared/schema";
import { fmtDateShort } from "@/lib/dates";

// ─── Gmail-style Email page ───────────────────────────────────────────────
//   Three-pane layout that matches the Gmail web app: left rail (Compose +
//   folders), middle message list, right reading pane. Everything you touch
//   here is your OWN mailbox — the signed-in user's Gmail account. There is
//   no "send as another employee" surface; owner/admin manage other people's
//   linkage from Settings → User Management.
//
//   When Gmail is CONNECTED via OAuth (gmailLive === true), every action —
//   read, star, archive, mark-unread, trash — hits Gmail through the server
//   and reconciles with an optimistic update. When Gmail is NOT connected,
//   the page falls back to the local /api/emails prototype mailbox so the
//   module is still usable, but with far fewer actions.

interface Employee {
  id: number;
  name: string;
  role: string;
  gmailEmail: string | null;
  phone: string | null;
}

// One Gmail message row as returned by /api/gmail/messages.
interface GmailRow {
  id: string;
  threadId?: string;
  snippet?: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  unread: boolean;
  starred?: boolean;
  important?: boolean;
  labels?: string[];
}

// ── Sender helpers ──────────────────────────────────────────────────────
// "Cody Brantley <cody@titanaugusta.com>" → "Cody Brantley"
// Falls back to the address when there's no display name.
function parseSender(raw: string): { name: string; email: string } {
  if (!raw) return { name: "", email: "" };
  const m = raw.match(/^\s*(.*?)\s*<(.+?)>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, "").trim() || m[2], email: m[2] };
  return { name: raw.trim(), email: raw.trim() };
}

// Deterministic pastel colour for the avatar circle. Same address → same
// colour every render.
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

// "12345" → "12.1 KB". Used in the attachment strip and the compose picker.
function formatBytes(n: number): string {
  if (!n || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function initials(name: string): string {
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]!.toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function EmailPage() {
  const [folder, setFolder] = useState<"inbox" | "starred" | "sent" | "drafts" | "snoozed" | "scheduled" | "trash">("inbox");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [gmailSettingsOpen, setGmailSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [compose, setCompose] = useState<{
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    body: string;   // plain-text fallback (auto-derived from html)
    html: string;   // rich-text body
    attachments: Array<{ filename: string; mimeType: string; size: number; dataBase64: string }>;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
    mode: "new" | "reply" | "replyAll" | "forward";
  }>({
    to: "", cc: "", bcc: "", subject: "", body: "", html: "", attachments: [], mode: "new",
  });
  const [showCcBcc, setShowCcBcc] = useState(false);
  // Pagination cursor for the message list (Gmail's nextPageToken).
  const [pageTokens, setPageTokens] = useState<string[]>([]); // history stack
  const [pageToken, setPageToken] = useState<string | undefined>(undefined);
  // Bulk-select checkboxes in the list.
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  // Undo Send buffer: after send succeeds we hold the request for 10s so
  // the toast can cancel it. If the user hits Undo we call gmail.trash.
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  const composeFileRef = useRef<HTMLInputElement | null>(null);

  // Push B state: schedule send, snooze, drafts, contact autocomplete,
  // attach-from-job picker, current draft id (Gmail returns one per compose
  // once the user has saved).
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState<string>("");
  const [snoozeOpen, setSnoozeOpen] = useState<string | null>(null); // message id
  const [snoozeAt, setSnoozeAt] = useState<string>("");
  const [jobPickerOpen, setJobPickerOpen] = useState(false);
  const [contactSuggest, setContactSuggest] = useState<{ field: "to" | "cc" | "bcc"; q: string; items: Array<{ email: string; name: string; source: string }> } | null>(null);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);

  // Push C additions
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [threadOpen, setThreadOpen] = useState<string | null>(null); // threadId
  const [labelPickerFor, setLabelPickerFor] = useState<string | null>(null); // messageId
  const [jobLinkFor, setJobLinkFor] = useState<{ threadId?: string; messageId?: string; subject?: string; from?: string; snippet?: string } | null>(null);
  const [inlineReplyOpen, setInlineReplyOpen] = useState(false);
  const [inlineReplyText, setInlineReplyText] = useState("");
  const [inlineReplyMode, setInlineReplyMode] = useState<"reply" | "replyAll">("reply");

  // Attachment preview (Gmail-style modal for PDFs, images, text). Non-previewable
  // types fall through to download.
  const [attachPreview, setAttachPreview] = useState<{ url: string; filename: string; mimeType: string } | null>(null);

  // Trimmed-quote toggle per detail view. Only shown when the body actually
  // contains a Gmail-style quote block, and only in the top-level detail
  // (thread messages already have their own expand/collapse).

  const [gmailInput, setGmailInput] = useState("");
  const [liveSelectedId, setLiveSelectedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchQuery, setSearchQuery] = useState(""); // committed value sent to server
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  const { user: authUser } = useAuth();
  const activeEmployee = authUser?.name || "";
  const isPrivileged = !!authUser && ["owner", "admin", "general_manager"].includes(String(authUser.role));

  // ── Live Gmail (OAuth) status ─────────────────────────────────────────
  const { data: gmailStatus } = useQuery<{
    configured: boolean;
    connected: boolean;
    email: string | null;
    diag?: { expectedRedirectUri: string; env: Record<string, boolean> };
  }>({
    queryKey: ["/api/gmail/status"],
    queryFn: () => apiRequest("GET", "/api/gmail/status").then(r => r.json()),
  });
  const gmailLive = !!(gmailStatus?.configured && gmailStatus?.connected);

  // ── Signature (per employee, editable in Settings) ────────────────────
  const { data: sigData, refetch: refetchSig } = useQuery<{ signature: string }>({
    queryKey: ["/api/gmail/signature"],
    queryFn: () => apiRequest("GET", "/api/gmail/signature").then(r => r.json()),
    enabled: gmailLive,
  });
  const signatureHtml = sigData?.signature || "";
  const [signatureEditing, setSignatureEditing] = useState(false);
  const [signatureDraft, setSignatureDraft] = useState("");
  useEffect(() => { setSignatureDraft(signatureHtml); }, [signatureHtml]);
  const saveSignature = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/gmail/signature", { signature: signatureDraft }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/signature"] });
      setSignatureEditing(false);
      toast({ title: "Signature saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" }),
  });

  // ── Message list ──────────────────────────────────────────────────────
  // The `starred` folder is a client-side filter on top of a broader Gmail
  // query. Gmail's own "Starred" view is served by the `STARRED` label; the
  // `trash` view is `TRASH`. Everything else maps 1:1.
  const gmailLabel: string = (() => {
    switch (folder) {
      case "sent":    return "SENT";
      case "drafts":  return "DRAFT";
      case "starred": return "STARRED";
      case "trash":   return "TRASH";
      default:        return "INBOX";
    }
  })();

  const {
    data: gmailData,
    isLoading: gmailLoading,
    refetch: refetchGmail,
    isFetching: gmailFetching,
  } = useQuery<{ messages: GmailRow[]; nextPageToken?: string | null; resultSizeEstimate?: number | null }>({
    // The committed search query is part of the key so switching between
    // "" and a query re-fetches instead of showing stale results.
    queryKey: ["/api/gmail/messages", gmailLabel, searchQuery, pageToken || ""],
    queryFn: () => {
      const p = new URLSearchParams({ labelIds: gmailLabel, max: "40" });
      if (searchQuery) p.set("q", searchQuery);
      if (pageToken) p.set("pageToken", pageToken);
      return apiRequest("GET", `/api/gmail/messages?${p.toString()}`).then(r => r.json());
    },
    enabled: gmailLive,
    // Background polling so new mail lands without a manual refresh. 30s
    // is a good tradeoff — Gmail's own web UI polls in roughly the same
    // window. `refetchIntervalInBackground: false` (default) means we
    // stop when the tab is hidden, so this doesn't burn quota all night.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const liveMessages: GmailRow[] = gmailData?.messages || [];
  const nextPageToken = gmailData?.nextPageToken || null;
  // Reset pagination + selection when the label or search changes.
  useEffect(() => {
    setPageToken(undefined);
    setPageTokens([]);
    setSelectedRows(new Set());
  }, [gmailLabel, searchQuery]);

  const { data: liveDetail, isLoading: liveDetailLoading } = useQuery<any>({
    queryKey: ["/api/gmail/messages", liveSelectedId],
    queryFn: () => apiRequest("GET", `/api/gmail/messages/${liveSelectedId}`).then(r => r.json()),
    enabled: gmailLive && !!liveSelectedId,
  });

  // ── OAuth ─────────────────────────────────────────────────────────────
  const connectGmail = async () => {
    try {
      const res = await apiRequest("GET", "/api/gmail/oauth/start");
      const { authUrl, error } = await res.json();
      if (error || !authUrl) {
        toast({ title: "Cannot connect", description: error || "No auth URL returned.", variant: "destructive" });
        return;
      }
      const popup = window.open(authUrl, "gmail_oauth", "width=520,height=680");
      const timer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(timer);
          queryClient.invalidateQueries({ queryKey: ["/api/gmail/status"] });
          queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
        }
      }, 800);
    } catch (e: any) {
      toast({ title: "Cannot connect", description: String(e?.message || e), variant: "destructive" });
    }
  };

  const disconnectGmail = useMutation({
    mutationFn: () => apiRequest("POST", "/api/gmail/disconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      setLiveSelectedId(null);
      toast({ title: "Gmail disconnected" });
    },
  });

  // ── Send (real Gmail) ────────────────────────────────────────────────
  // Build final HTML by concatenating the user body + signature block.
  // Signature is only appended once; we don't want a signature to accumulate
  // across replies. If the user already deleted it inline they're free to
  // send without it.
  const composeHtmlWithSig = (bodyHtml: string) => {
    if (!signatureHtml) return bodyHtml;
    if (bodyHtml.includes("data-titan-signature")) return bodyHtml;
    const sig = `<br><br><div data-titan-signature style="color:#5f6368;font-size:13px;font-family:Arial,sans-serif">${signatureHtml}</div>`;
    return bodyHtml + sig;
  };
  const sendViaGmailLive = useMutation({
    mutationFn: async () => {
      const finalHtml = composeHtmlWithSig(compose.html || compose.body || "");
      const res = await apiRequest("POST", "/api/gmail/send", {
        to: compose.to,
        cc: compose.cc || undefined,
        bcc: compose.bcc || undefined,
        subject: compose.subject,
        html: finalHtml,
        body: compose.body || undefined,
        threadId: compose.threadId,
        inReplyTo: compose.inReplyTo,
        references: compose.references,
        attachments: compose.attachments.map(a => ({
          filename: a.filename, mimeType: a.mimeType, dataBase64: a.dataBase64,
        })),
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      setComposeOpen(false);
      setCompose({ to: "", cc: "", bcc: "", subject: "", body: "", html: "", attachments: [], mode: "new" });
      setShowCcBcc(false);
      // Undo Send: keep the message id around for 10 seconds so the toast's
      // Undo button can trash it. Gmail's own Undo Send is really "delay,
      // don't send yet"; this is a lighter version that trashes after the
      // fact, which is what most third-party Gmail clients do.
      const undoId = data?.id || null;
      setPendingUndoId(undoId);
      const t = window.setTimeout(() => setPendingUndoId(cur => cur === undoId ? null : cur), 10000);
      toast({
        title: "Email sent",
        description: `Delivered via Gmail (${gmailStatus?.email || "your account"})`,
      });
      // Cleanup timer if unmounted early.
      return () => window.clearTimeout(t);
    },
    onError: (e: any) => toast({ title: "Send failed", description: String(e?.message || e), variant: "destructive" }),
  });

  // Send-and-archive — Gmail's reply toolbar has this. After the reply
  // is delivered, remove INBOX from the ORIGINAL thread so it drops off the
  // inbox list. We use `compose.threadId` to identify which conversation to
  // archive; new (non-reply) sends won't have one, so the button is hidden.
  const sendAndArchive = useMutation({
    mutationFn: async () => {
      const originalThreadId = compose.threadId;
      const finalHtml = composeHtmlWithSig(compose.html || compose.body || "");
      const res = await apiRequest("POST", "/api/gmail/send", {
        to: compose.to,
        cc: compose.cc || undefined,
        bcc: compose.bcc || undefined,
        subject: compose.subject,
        html: finalHtml,
        body: compose.body || undefined,
        threadId: compose.threadId,
        inReplyTo: compose.inReplyTo,
        references: compose.references,
        attachments: compose.attachments.map(a => ({
          filename: a.filename, mimeType: a.mimeType, dataBase64: a.dataBase64,
        })),
      });
      const data = await res.json();
      // Archive the just-replied thread. Best-effort — if this fails the
      // send still counts as a success.
      if (originalThreadId) {
        try {
          await apiRequest("POST", `/api/gmail/messages/${originalThreadId}/modify`, { remove: ["INBOX"] });
        } catch { /* ignore */ }
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      setComposeOpen(false);
      setCompose({ to: "", cc: "", bcc: "", subject: "", body: "", html: "", attachments: [], mode: "new" });
      setShowCcBcc(false);
      setCurrentDraftId(null);
      toast({ title: "Sent and archived" });
    },
    onError: (e: any) => toast({ title: "Send failed", description: String(e?.message || e), variant: "destructive" }),
  });

  // Inline reply — Gmail's default reply flow: keep the user in the reading
  // pane. We build a message from `liveDetail` (currently open message) so we
  // don't have to touch the compose dialog state.
  const sendInlineReply = useMutation({
    mutationFn: async () => {
      if (!liveDetail) throw new Error("No open message");
      const bodyText = (inlineReplyText || "").trim();
      if (!bodyText) throw new Error("Empty reply");
      const senderInfo = parseSender(liveDetail.from || "");
      const to = senderInfo.email;
      const cc = inlineReplyMode === "replyAll"
        ? [liveDetail.to, liveDetail.cc].filter(Boolean).join(", ")
        : undefined;
      const subject = /^re:\s/i.test(liveDetail.subject || "") ? liveDetail.subject : `Re: ${liveDetail.subject || ""}`;
      const htmlEscaped = bodyText
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
      const finalHtml = composeHtmlWithSig(htmlEscaped);
      const res = await apiRequest("POST", "/api/gmail/send", {
        to, cc, subject, html: finalHtml, body: bodyText,
        threadId: liveDetail.threadId,
        inReplyTo: liveDetail.messageIdHeader || liveDetail.id,
        references: liveDetail.references,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread"] });
      setInlineReplyOpen(false); setInlineReplyText("");
      toast({ title: "Reply sent" });
    },
    onError: (e: any) => toast({ title: "Reply failed", description: String(e?.message || e), variant: "destructive" }),
  });

  // Undo Send: trash the just-sent message. Gmail doesn't expose a true
  // "unsend" so we do the next best thing — move it out of Sent into Trash
  // within the undo window.
  const undoSend = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/gmail/messages/${id}/trash`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      setPendingUndoId(null);
      toast({ title: "Send undone", description: "Message moved to Trash." });
    },
    onError: (e: any) => toast({ title: "Undo failed", description: String(e?.message || e), variant: "destructive" }),
  });

  // ── Push B mutations: drafts, scheduled send, snooze ────────────────────────
  // Save current compose to Gmail Drafts. If we already have a draft id
  // (from an earlier save in this compose session), we PUT to update; else
  // we POST to create and stash the returned id.
  const saveDraft = useMutation({
    mutationFn: async () => {
      const finalHtml = composeHtmlWithSig(compose.html || compose.body || "");
      const payload = {
        to: compose.to, cc: compose.cc || undefined, bcc: compose.bcc || undefined,
        subject: compose.subject, html: finalHtml, body: compose.body || undefined,
        threadId: compose.threadId, inReplyTo: compose.inReplyTo, references: compose.references,
      };
      const url = currentDraftId ? `/api/gmail/drafts/${currentDraftId}` : "/api/gmail/drafts";
      const method = currentDraftId ? "PUT" : "POST";
      const res = await apiRequest(method, url, payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data?.id) setCurrentDraftId(data.id);
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/drafts"] });
      toast({ title: "Draft saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" }),
  });

  // Auto-save the draft in the background while the compose window is open.
  // Gmail does this on every keystroke (debounced); 30s is plenty for our
  // volume and stays well under Gmail's per-user quota. Only runs when the
  // user has actually typed something so we don't create empty drafts.
  const composeIsDirty = !!(compose.to || compose.subject || (compose.html && compose.html.replace(/<[^>]+>/g, "").trim()));
  useEffect(() => {
    if (!composeOpen || !gmailLive || !composeIsDirty) return;
    const t = window.setTimeout(() => {
      if (!saveDraft.isPending) saveDraft.mutate();
    }, 30_000);
    return () => window.clearTimeout(t);
  }, [composeOpen, gmailLive, compose.to, compose.cc, compose.bcc, compose.subject, compose.html]);

  // Discard the current draft (Gmail's trash-can icon in compose). If we
  // haven't saved yet there's nothing on the server; just clear local state.
  const discardDraft = async () => {
    if (currentDraftId) {
      try { await apiRequest("DELETE", `/api/gmail/drafts/${currentDraftId}`); } catch { /* ignore */ }
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/drafts"] });
    }
    setCurrentDraftId(null);
    setCompose({ to: "", cc: "", bcc: "", subject: "", body: "", html: "", attachments: [], mode: "new" });
    setShowCcBcc(false);
    setComposeOpen(false);
    toast({ title: "Draft discarded" });
  };

  const scheduleSend = useMutation({
    mutationFn: async () => {
      if (!scheduleAt) throw new Error("Pick a time first.");
      const finalHtml = composeHtmlWithSig(compose.html || compose.body || "");
      const payload = {
        to: compose.to, cc: compose.cc || undefined, bcc: compose.bcc || undefined,
        subject: compose.subject, html: finalHtml, body: compose.body || undefined,
        threadId: compose.threadId, inReplyTo: compose.inReplyTo, references: compose.references,
        attachments: compose.attachments.map(a => ({ filename: a.filename, mimeType: a.mimeType, dataBase64: a.dataBase64 })),
      };
      const res = await apiRequest("POST", "/api/gmail/schedule", {
        scheduledFor: new Date(scheduleAt).toISOString(),
        payload,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/schedule"] });
      setScheduleOpen(false);
      setScheduleAt("");
      setComposeOpen(false);
      setCompose({ to: "", cc: "", bcc: "", subject: "", body: "", html: "", attachments: [], mode: "new" });
      setShowCcBcc(false);
      setCurrentDraftId(null);
      toast({ title: "Scheduled", description: "Email will send at the chosen time." });
    },
    onError: (e: any) => toast({ title: "Scheduling failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const cancelScheduled = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/gmail/schedule/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/schedule"] });
      toast({ title: "Scheduled send cancelled" });
    },
  });

  const snoozeMessage = useMutation({
    mutationFn: async (args: { messageId: string; wakeAt: string }) => {
      const res = await apiRequest("POST", `/api/gmail/messages/${args.messageId}/snooze`, { wakeAt: new Date(args.wakeAt).toISOString() });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/snooze"] });
      setSnoozeOpen(null);
      setSnoozeAt("");
      toast({ title: "Snoozed", description: "Message will return to your inbox at the chosen time." });
    },
    onError: (e: any) => toast({ title: "Snooze failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const unsnoozeMessage = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/gmail/snooze/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/snooze"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      toast({ title: "Unsnoozed", description: "Message is back in your inbox." });
    },
  });

  const deleteDraft = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/gmail/drafts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/drafts"] });
      toast({ title: "Draft deleted" });
    },
  });

  // Drafts + scheduled + snooze queries
  const draftsQuery = useQuery<{ drafts: Array<{ draftId: string; messageId: string; threadId: string; to: string; subject: string; snippet: string; date: string }> }>({
    queryKey: ["/api/gmail/drafts"],
    enabled: gmailLive && folder === "drafts",
  });
  const scheduledQuery = useQuery<{ scheduled: Array<{ id: number; scheduled_for: string; status: string; error: string | null; to_field: string; subject: string }> }>({
    queryKey: ["/api/gmail/schedule"],
    enabled: gmailLive && folder === "scheduled",
  });
  const snoozedQuery = useQuery<{ snoozed: Array<{ id: number; messageId: string; wakeAt: string; created_at: string }> }>({
    queryKey: ["/api/gmail/snooze"],
    enabled: gmailLive && folder === "snoozed",
  });

  // ── Push C: labels ─────────────────────────────────────────────────
  const labelsQuery = useQuery<{ labels: Array<{ id: string; name: string; type: string; messagesTotal: number | null; messagesUnread: number | null }> }>({
    queryKey: ["/api/gmail/labels"],
    enabled: gmailLive,
  });
  const createLabel = useMutation({
    mutationFn: (name: string) => apiRequest("POST", "/api/gmail/labels", { name }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/gmail/labels"] }); toast({ title: "Label created" }); },
  });
  const renameLabel = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => apiRequest("PATCH", `/api/gmail/labels/${id}`, { name }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/gmail/labels"] }); toast({ title: "Label renamed" }); },
  });
  const deleteLabel = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/gmail/labels/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/gmail/labels"] }); toast({ title: "Label deleted" }); },
  });
  const applyLabelToMessage = useMutation({
    mutationFn: async ({ messageId, addLabelIds, removeLabelIds }: { messageId: string; addLabelIds?: string[]; removeLabelIds?: string[] }) => {
      return apiRequest("POST", `/api/gmail/messages/${messageId}/modify`, { addLabelIds, removeLabelIds });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] }),
  });

  // ── Push C: rules ──────────────────────────────────────────────────
  const rulesQuery = useQuery<{ rules: Array<any> }>({
    queryKey: ["/api/gmail/rules"],
    enabled: gmailLive && rulesOpen,
  });
  const saveRule = useMutation({
    mutationFn: (rule: any) => rule.id ? apiRequest("PATCH", `/api/gmail/rules/${rule.id}`, rule) : apiRequest("POST", "/api/gmail/rules", rule),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/gmail/rules"] }); toast({ title: "Rule saved" }); },
  });
  const deleteRule = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/gmail/rules/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/gmail/rules"] }); toast({ title: "Rule deleted" }); },
  });
  const runRules = useMutation({
    mutationFn: () => apiRequest("POST", "/api/gmail/rules/run").then(r => r.json()),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/rules"] });
      toast({ title: "Rules ran", description: `${data.totalApplied || 0} messages affected` });
    },
  });

  // ── Push C: thread view ─────────────────────────────────────────────
  const threadQuery = useQuery<{ id: string; messages: Array<any> }>({
    queryKey: [`/api/gmail/threads/${threadOpen}`],
    enabled: gmailLive && !!threadOpen,
  });

  // ── Push C: job links ──────────────────────────────────────────────
  const threadLinksQuery = useQuery<{ links: Array<{ id: number; jobId: number; jobNumber?: string; customerName?: string }> }>({
    queryKey: [`/api/gmail/thread-links`, threadOpen || liveSelectedId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (threadOpen) params.set("threadId", threadOpen);
      else if (liveSelectedId) params.set("messageId", liveSelectedId);
      const r = await apiRequest("GET", `/api/gmail/thread-links?${params.toString()}`);
      return r.json();
    },
    enabled: gmailLive && !!(threadOpen || liveSelectedId),
  });
  const linkJob = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/gmail/link-job", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-links"] });
      toast({ title: "Filed under job" });
    },
  });
  const unlinkJob = useMutation({
    mutationFn: (linkId: number) => apiRequest("DELETE", `/api/gmail/link-job/${linkId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/thread-links"] });
      toast({ title: "Unlinked" });
    },
  });

  // ── Push C: undo trash / undo archive ─────────────────────────────
  const untrashMessage = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/gmail/messages/${id}/untrash`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] }),
  });

  // Contact autocomplete: debounce lookups so we don't hammer the server on
  // every keystroke. Fires GET /api/gmail/contacts?q= 220ms after the last
  // change on the currently-active field.
  useEffect(() => {
    if (!contactSuggest?.q || contactSuggest.q.length < 2) return;
    const t = window.setTimeout(async () => {
      try {
        const r = await apiRequest("GET", `/api/gmail/contacts?q=${encodeURIComponent(contactSuggest.q)}`);
        const data = await r.json();
        setContactSuggest(cur => cur ? { ...cur, items: data.contacts || [] } : cur);
      } catch { /* ignore */ }
    }, 220);
    return () => window.clearTimeout(t);
  }, [contactSuggest?.q]);

  // Load a draft into the compose window.
  const loadDraftIntoCompose = async (draftId: string) => {
    try {
      const r = await apiRequest("GET", `/api/gmail/drafts/${draftId}`);
      const d = await r.json();
      setCompose({
        to: d.to || "", cc: d.cc || "", bcc: d.bcc || "",
        subject: d.subject || "", body: d.body || "", html: d.bodyHtml || d.body || "",
        attachments: [], mode: "new",
        threadId: d.threadId || undefined,
        inReplyTo: d.inReplyTo || undefined,
        references: d.references || undefined,
      });
      setShowCcBcc(Boolean(d.cc || d.bcc));
      setCurrentDraftId(draftId);
      setComposeOpen(true);
    } catch (e: any) {
      toast({ title: "Failed to open draft", description: String(e?.message || e), variant: "destructive" });
    }
  };

  // Attach-from-job picker: fetch attachable files for the chosen job, then
  // pull their bytes one by one via /attach-content and stuff them into the
  // compose attachments list. Runs into the same 25 MB cap.
  const attachFromJob = async (jobId: number, files: Array<{ kind: "document" | "photo"; id: number; filename: string; mimeType: string }>) => {
    try {
      let running = compose.attachments.reduce((n, a) => n + a.size, 0);
      const next = [...compose.attachments];
      for (const f of files) {
        const r = await apiRequest("POST", `/api/jobs/${jobId}/attach-content`, { kind: f.kind, id: f.id });
        const data = await r.json();
        if (!data.contentBase64) continue;
        const size = Math.floor((data.contentBase64.length * 3) / 4);
        if (running + size > 25 * 1024 * 1024) {
          toast({ title: "Attachment too large", description: "Skipped remaining files — 25 MB limit reached.", variant: "destructive" });
          break;
        }
        running += size;
        next.push({ filename: data.filename || f.filename, mimeType: data.mimeType || f.mimeType, size, dataBase64: data.contentBase64 });
      }
      setCompose(c => ({ ...c, attachments: next }));
      setJobPickerOpen(false);
    } catch (e: any) {
      toast({ title: "Attach failed", description: String(e?.message || e), variant: "destructive" });
    }
  };

  // ── Reply / Reply All / Forward prefill ──────────────────────────────
  // Builds the compose state from a Gmail message detail. All three modes
  // share the same quote block and threading headers; only the recipient
  // set changes:
  //   reply:     To = original From
  //   replyAll:  To = original From; Cc = (original To + original Cc) − self
  //   forward:   To = empty; carry the attachments through
  const myEmail = (gmailStatus?.email || "").toLowerCase();
  const buildReplyCompose = (
    detail: any,
    mode: "reply" | "replyAll" | "forward",
  ) => {
    const parsed = parseSender(detail.from || "");
    const fromAddr = parsed.email || detail.from || "";
    // Gmail returns a bare list of email addresses in these headers.
    const splitAddrs = (raw: string) =>
      String(raw || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((a) => a.toLowerCase() !== myEmail && a.toLowerCase() !== fromAddr.toLowerCase());

    // Quoted body. Gmail wraps the quote in a class="gmail_quote" div; other
    // MUAs walk that DOM to collapse it. We use the same class so replies to
    // us also fold cleanly.
    const dateStr = detail.date || "";
    const attribution = `On ${dateStr}, ${escapeHtml(detail.from || "")} wrote:`;
    const bodyHtml: string = detail.bodyHtml || detail.body || "";
    const quoted =
      `<br><br><div class="gmail_quote">` +
      `<div>${attribution}</div>` +
      `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex;color:#5f6368">` +
      bodyHtml +
      `</blockquote></div>`;

    const subjectPrefix = mode === "forward" ? "Fwd: " : "Re: ";
    const cleanSubject = String(detail.subject || "").replace(/^(re:|fwd:)\s*/i, "").trim();
    const nextSubject = `${subjectPrefix}${cleanSubject}`;

    // Only reply modes carry threading headers — Forward starts a new
    // conversation on the recipient's side.
    const isReplyMode = mode === "reply" || mode === "replyAll";
    const references = [detail.references, detail.messageId].filter(Boolean).join(" ");

    setCompose({
      mode,
      to: mode === "forward" ? "" : fromAddr,
      cc: mode === "replyAll"
        ? [...splitAddrs(detail.to || ""), ...splitAddrs(detail.cc || "")].join(", ")
        : "",
      bcc: "",
      subject: nextSubject,
      body: "",
      html: quoted,
      attachments: mode === "forward" ? (detail.attachments || []).map((a: any) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        dataBase64: a.dataBase64 || "",
      })) : [],
      threadId: isReplyMode ? detail.threadId : undefined,
      inReplyTo: isReplyMode && detail.messageId ? detail.messageId : undefined,
      references: isReplyMode && references ? references : undefined,
    });
    if (mode === "replyAll") setShowCcBcc(true);
    setComposeOpen(true);
  };
  // Escape user-provided text before inserting into HTML quote blocks.
  function escapeHtml(s: string) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Bulk actions ────────────────────────────────────────────────────
  const toggleRow = (id: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAllRows = () => {
    setSelectedRows(prev => {
      const allSelected = liveMessages.length > 0 && liveMessages.every(m => prev.has(m.id));
      return allSelected ? new Set() : new Set(liveMessages.map(m => m.id));
    });
  };
  // Gmail's master-checkbox dropdown (All / None / Read / Unread / Starred /
  // Unstarred). Works on the currently-loaded page.
  const selectSubset = (subset: "all" | "none" | "read" | "unread" | "starred" | "unstarred") => {
    setSelectedRows(() => {
      switch (subset) {
        case "all":       return new Set(liveMessages.map(m => m.id));
        case "none":      return new Set();
        case "read":      return new Set(liveMessages.filter(m => !m.unread).map(m => m.id));
        case "unread":    return new Set(liveMessages.filter(m => m.unread).map(m => m.id));
        case "starred":   return new Set(liveMessages.filter(m => m.starred).map(m => m.id));
        case "unstarred": return new Set(liveMessages.filter(m => !m.starred).map(m => m.id));
      }
    });
  };
  // Click a sender's name/email in the list → apply Gmail search operator.
  const filterBySender = (email: string) => {
    if (!email) return;
    const q = `from:${email}`;
    setSearchTerm(q); setSearchQuery(q);
    setLiveSelectedId(null); setSelectedRows(new Set());
  };
  // Bulk endpoints are just repeated single-message calls. Small cost
  // vs. adding a whole new server route; keeps this diff tight.
  const bulkModify = async (opts: { addLabelIds?: string[]; removeLabelIds?: string[] }, trash = false) => {
    const ids = Array.from(selectedRows);
    if (ids.length === 0) return;
    await Promise.all(ids.map(id => trash
      ? apiRequest("POST", `/api/gmail/messages/${id}/trash`)
      : apiRequest("POST", `/api/gmail/messages/${id}/modify`, opts),
    ));
    queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
    setSelectedRows(new Set());
  };
  const bulkArchive = () => bulkModify({ removeLabelIds: ["INBOX"] }).then(() => toast({ title: `Archived ${selectedRows.size}` }));
  const bulkTrash = () => bulkModify({}, true).then(() => toast({ title: `Moved to Trash: ${selectedRows.size}` }));
  const bulkMarkRead = () => bulkModify({ removeLabelIds: ["UNREAD"] }).then(() => toast({ title: `Marked as read: ${selectedRows.size}` }));
  const bulkMarkUnread = () => bulkModify({ addLabelIds: ["UNREAD"] }).then(() => toast({ title: `Marked as unread: ${selectedRows.size}` }));

  // ── Pagination ──────────────────────────────────────────────────────
  const goNextPage = () => {
    if (!nextPageToken) return;
    setPageTokens(prev => [...prev, pageToken || ""]);
    setPageToken(nextPageToken);
  };
  const goPrevPage = () => {
    setPageTokens(prev => {
      if (prev.length === 0) return prev;
      const stack = [...prev];
      const restore = stack.pop() || "";
      setPageToken(restore || undefined);
      return stack;
    });
  };

  // ── Attachment picker (browser side) ────────────────────────────────
  //   Reads each selected file into a base64 string and stashes it on
  //   `compose.attachments`. We cap the running total at 25 MB (Gmail's own
  //   limit) so the send never fails server-side for size.
  const ATTACH_LIMIT = 25 * 1024 * 1024;
  const readFileAsBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      // FileReader returns a data URL: "data:mime;base64,XXXX". Strip prefix.
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let running = compose.attachments.reduce((n, a) => n + a.size, 0);
    const next = [...compose.attachments];
    for (const file of Array.from(files)) {
      if (running + file.size > ATTACH_LIMIT) {
        toast({
          title: "Attachment too large",
          description: `Skipped ${file.name} — total would exceed Gmail's 25 MB limit.`,
          variant: "destructive",
        });
        continue;
      }
      try {
        const dataBase64 = await readFileAsBase64(file);
        next.push({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          dataBase64,
        });
        running += file.size;
      } catch (e: any) {
        toast({ title: "Could not read file", description: `${file.name}: ${e?.message || e}`, variant: "destructive" });
      }
    }
    setCompose(c => ({ ...c, attachments: next }));
    if (composeFileRef.current) composeFileRef.current.value = ""; // allow re-pick same file
  };
  const removeAttachment = (idx: number) =>
    setCompose(c => ({ ...c, attachments: c.attachments.filter((_, i) => i !== idx) }));

  // ── Attachment download (from a message reading pane) ────────────────
  //   Streams raw bytes through the server so we don't have to hand Gmail's
  //   base64url decoding to the browser. Auth via same-origin session cookies.
  const downloadAttachment = async (
    messageId: string,
    att: { attachmentId: string; filename: string; mimeType: string },
  ) => {
    const p = new URLSearchParams({ filename: att.filename, mimeType: att.mimeType });
    const url = `/api/gmail/messages/${messageId}/attachments/${att.attachmentId}?${p.toString()}`;
    try {
      const res = await fetch(url, { credentials: "same-origin", headers: buildAuthHeaders(url) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (e: any) {
      toast({ title: "Download failed", description: String(e?.message || e), variant: "destructive" });
    }
  };

  // Preview an attachment inline. Gmail previews PDFs and images in a viewer;
  // for anything else we fall back to a plain download. We fetch through the
  // auth'd endpoint the same way as download so the browser doesn't try to
  // hit /api/... unauthenticated in an <iframe src>.
  const previewAttachment = async (
    messageId: string,
    att: { attachmentId: string; filename: string; mimeType: string },
  ) => {
    const previewable = /^image\//i.test(att.mimeType) || att.mimeType === "application/pdf" || /^text\//i.test(att.mimeType);
    if (!previewable) return downloadAttachment(messageId, att);
    const p = new URLSearchParams({ filename: att.filename, mimeType: att.mimeType });
    const url = `/api/gmail/messages/${messageId}/attachments/${att.attachmentId}?${p.toString()}`;
    try {
      const res = await fetch(url, { credentials: "same-origin", headers: buildAuthHeaders(url) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      setAttachPreview({ url: objectUrl, filename: att.filename, mimeType: att.mimeType });
    } catch (e: any) {
      toast({ title: "Preview failed", description: String(e?.message || e), variant: "destructive" });
    }
  };

  // Free the object URL when the preview closes; leaking blob URLs holds the
  // file in memory for the life of the tab.
  useEffect(() => {
    if (!attachPreview) return;
    return () => { URL.revokeObjectURL(attachPreview.url); };
  }, [attachPreview]);

  // ── Actions: star / archive / mark-unread / trash ────────────────────
  //   All four go through /api/gmail/messages/:id/modify (or /trash) and
  //   optimistically patch the currently-loaded list so the UI reacts
  //   instantly. onError rolls the cache back.
  const modifyOptimistic = useCallback(async (
    id: string,
    patch: (row: GmailRow) => Partial<GmailRow>,
    request: () => Promise<any>,
  ) => {
    const key = ["/api/gmail/messages", gmailLabel, searchQuery];
    const detailKey = ["/api/gmail/messages", id];
    const prevList = queryClient.getQueryData<{ messages: GmailRow[] }>(key);
    const prevDetail = queryClient.getQueryData<any>(detailKey);
    if (prevList) {
      queryClient.setQueryData<{ messages: GmailRow[] }>(key, {
        messages: prevList.messages.map(m => m.id === id ? { ...m, ...patch(m) } : m),
      });
    }
    if (prevDetail && prevDetail.id === id) {
      queryClient.setQueryData<any>(detailKey, { ...prevDetail, ...patch(prevDetail) });
    }
    try {
      await request();
    } catch (e: any) {
      if (prevList) queryClient.setQueryData(key, prevList);
      if (prevDetail) queryClient.setQueryData(detailKey, prevDetail);
      toast({ title: "Action failed", description: String(e?.message || e), variant: "destructive" });
    }
  }, [gmailLabel, searchQuery, toast]);

  const toggleStar = (row: GmailRow) => modifyOptimistic(
    row.id,
    () => ({ starred: !row.starred }),
    () => apiRequest("POST", `/api/gmail/messages/${row.id}/modify`, row.starred
      ? { remove: ["STARRED"] }
      : { add: ["STARRED"] }),
  );

  const archiveRow = (id: string) => modifyOptimistic(
    id,
    () => ({ labels: [] }),
    async () => {
      await apiRequest("POST", `/api/gmail/messages/${id}/modify`, { remove: ["INBOX"] });
      // The archived message no longer belongs in an inbox list; drop it.
      queryClient.setQueryData<{ messages: GmailRow[] }>(
        ["/api/gmail/messages", gmailLabel, searchQuery],
        (cur) => cur ? { messages: cur.messages.filter(m => m.id !== id) } : cur,
      );
      if (liveSelectedId === id) setLiveSelectedId(null);
      toast({
        title: "Archived",
        description: "Message archived",
        action: (
          <ToastAction altText="Undo archive" onClick={async () => {
            await apiRequest("POST", `/api/gmail/messages/${id}/modify`, { add: ["INBOX"] });
            queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
          }}>Undo</ToastAction>
        ),
      });
    },
  );

  const markUnreadRow = (id: string) => modifyOptimistic(
    id,
    () => ({ unread: true }),
    async () => {
      await apiRequest("POST", `/api/gmail/messages/${id}/modify`, { add: ["UNREAD"] });
    },
  );

  const trashRow = (id: string) => modifyOptimistic(
    id,
    () => ({ labels: [] }),
    async () => {
      await apiRequest("POST", `/api/gmail/messages/${id}/trash`);
      queryClient.setQueryData<{ messages: GmailRow[] }>(
        ["/api/gmail/messages", gmailLabel, searchQuery],
        (cur) => cur ? { messages: cur.messages.filter(m => m.id !== id) } : cur,
      );
      if (liveSelectedId === id) setLiveSelectedId(null);
      toast({
        title: "Moved to Trash",
        action: (
          <ToastAction altText="Undo trash" onClick={() => untrashMessage.mutate(id)}>
            Undo
          </ToastAction>
        ),
      });
    },
  );

  // Report as spam / not spam. Gmail's SPAM label bounces the row out of the
  // inbox on its own; we just mirror the current-list optimistic pattern.
  const spamRow = (id: string) => modifyOptimistic(
    id,
    () => ({ labels: [] }),
    async () => {
      await apiRequest("POST", `/api/gmail/messages/${id}/spam`);
      queryClient.setQueryData<{ messages: GmailRow[] }>(
        ["/api/gmail/messages", gmailLabel, searchQuery],
        (cur) => cur ? { messages: cur.messages.filter(m => m.id !== id) } : cur,
      );
      if (liveSelectedId === id) setLiveSelectedId(null);
      toast({
        title: "Reported as spam",
        action: (
          <ToastAction altText="Undo report" onClick={async () => {
            await apiRequest("POST", `/api/gmail/messages/${id}/not-spam`);
            queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
          }}>Not spam</ToastAction>
        ),
      });
    },
  );

  const notSpamRow = (id: string) => modifyOptimistic(
    id,
    () => ({ labels: [] }),
    async () => {
      await apiRequest("POST", `/api/gmail/messages/${id}/not-spam`);
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      toast({ title: "Moved to Inbox" });
    },
  );

  // "Move to" — Gmail's Move behavior applies a label AND removes INBOX in
  // a single trip. Purely a convenience over label+archive.
  const moveToLabel = (id: string, labelId: string) => modifyOptimistic(
    id,
    () => ({ labels: [] }),
    async () => {
      await apiRequest("POST", `/api/gmail/messages/${id}/modify`, { add: [labelId], remove: ["INBOX"] });
      queryClient.setQueryData<{ messages: GmailRow[] }>(
        ["/api/gmail/messages", gmailLabel, searchQuery],
        (cur) => cur ? { messages: cur.messages.filter(m => m.id !== id) } : cur,
      );
      if (liveSelectedId === id) setLiveSelectedId(null);
      toast({ title: "Moved" });
    },
  );

  // Auto-mark read when a message is opened (Gmail behavior).
  const markReadServer = useCallback((id: string) => {
    apiRequest("POST", `/api/gmail/messages/${id}/read`).catch(() => {/* ignore */});
    queryClient.setQueryData<{ messages: GmailRow[] }>(
      ["/api/gmail/messages", gmailLabel, searchQuery],
      (cur) => cur ? { messages: cur.messages.map(m => m.id === id ? { ...m, unread: false } : m) } : cur,
    );
  }, [gmailLabel, searchQuery]);

  const openLiveMessage = useCallback((id: string) => {
    setLiveSelectedId(id);
    const row = liveMessages.find(m => m.id === id);
    if (row?.unread) markReadServer(id);
  }, [liveMessages, markReadServer]);

  // ── Legacy /api/emails (used only when Gmail is NOT connected) ───────
  const { data: emails = [] } = useQuery<Email[]>({
    queryKey: ["/api/emails", folder],
    queryFn: () => apiRequest("GET", `/api/emails?folder=${folder}`).then(r => r.json()),
    enabled: !gmailLive,
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
    enabled: isPrivileged,
  });

  const { data: myRecord } = useQuery<Employee>({
    queryKey: ["/api/employees", authUser?.id],
    queryFn: () => apiRequest("GET", `/api/employees/${authUser!.id}`).then(r => r.json()),
    enabled: !!authUser?.id && !isPrivileged,
  });
  const currentEmployee: Employee | undefined = isPrivileged
    ? employees.find(e => e.id === authUser?.id)
    : myRecord;
  const fromAddress = currentEmployee?.gmailEmail
    || (activeEmployee ? `${activeEmployee.toLowerCase().replace(/\s/g, "")}@titanrestorationllc.com` : "");

  const sendMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/emails", {
      ...compose, folder: "sent", from: fromAddress, read: 1,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      setComposeOpen(false);
      setCompose({ to: "", cc: "", bcc: "", subject: "", body: "", html: "", attachments: [], mode: "new" });
      toast({ title: "Email saved", description: `Saved from ${fromAddress}` });
    },
  });

  const markRead = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/emails/${id}`, { read: 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/emails"] }),
  });

  const deleteEmail = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/emails/${id}`),
    onSuccess: () => {
      toast({ title: "Email deleted" });
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const linkGmailMutation = useMutation({
    mutationFn: () => {
      if (!authUser?.id) throw new Error("Not signed in");
      return apiRequest("PATCH", `/api/employees/${authUser.id}`, { gmailEmail: gmailInput });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setGmailSettingsOpen(false);
      toast({ title: "Gmail linked", description: `${gmailInput} is now linked to your account` });
    },
    onError: (e: any) => toast({ title: "Link failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const unlinkGmailMutation = useMutation({
    mutationFn: () => {
      if (!authUser?.id) throw new Error("Not signed in");
      return apiRequest("PATCH", `/api/employees/${authUser.id}`, { gmailEmail: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Gmail unlinked" });
    },
    onError: (e: any) => toast({ title: "Unlink failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const selected = emails.find(e => e.id === selectedId);
  const legacyUnread = emails.filter(e => !e.read && folder === "inbox").length;
  const liveUnread = liveMessages.filter(m => m.unread).length;
  const unreadCount = gmailLive ? liveUnread : legacyUnread;

  const FOLDERS: { id: typeof folder; label: string; icon: any }[] = [
    { id: "inbox",     label: "Inbox",     icon: Inbox },
    { id: "starred",   label: "Starred",   icon: Star },
    { id: "snoozed",   label: "Snoozed",   icon: Clock },
    { id: "scheduled", label: "Scheduled", icon: CalendarClock },
    { id: "sent",      label: "Sent",      icon: SendIcon },
    { id: "drafts",    label: "Drafts",    icon: FileText },
    { id: "trash",     label: "Trash",     icon: Trash2 },
  ];

  // ── Keyboard shortcuts (Gmail-style) ─────────────────────────────────
  //   / focus search, j/k next/prev row, Enter open, e archive, # trash,
  //   s star, u back to list, r reply, c compose, ? help.
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || (ev.target as HTMLElement | null)?.isContentEditable;

      // Cmd/Ctrl-modified shortcuts work anywhere — even inside form fields
      // — and always take priority. Match Gmail's own bindings.
      if (ev.metaKey || ev.ctrlKey) {
        if (ev.key.toLowerCase() === "k") {
          ev.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
          return;
        }
        if (ev.key === "/") { ev.preventDefault(); setShortcutsOpen(true); return; }
        // Cmd+Enter to send from compose is handled locally in the compose
        // Dialog's onKeyDown so it can reach the send button state.
        return;
      }
      if (ev.altKey) return;

      if (inField) return;
      if (composeOpen || gmailSettingsOpen || shortcutsOpen) return;

      const key = ev.key;
      if (key === "/") { ev.preventDefault(); searchInputRef.current?.focus(); return; }
      if (key === "?") { setShortcutsOpen(true); return; }
      if (key === "c") { setComposeOpen(true); return; }
      if (!gmailLive) return; // rest only apply to live Gmail rows

      const idx = liveSelectedId ? liveMessages.findIndex(m => m.id === liveSelectedId) : -1;
      if (key === "j") {
        const next = liveMessages[Math.min(liveMessages.length - 1, idx + 1)];
        if (next) openLiveMessage(next.id);
      } else if (key === "k") {
        const prev = liveMessages[Math.max(0, idx - 1)];
        if (prev) openLiveMessage(prev.id);
      } else if (key === "u") {
        setLiveSelectedId(null);
      } else if (liveSelectedId) {
        const row = liveMessages.find(m => m.id === liveSelectedId);
        if (!row) return;
        if (key === "e") archiveRow(row.id);
        else if (key === "#") trashRow(row.id);
        else if (key === "s") toggleStar(row);
        else if (key === "r") {
          const fromAddr = parseSender(row.from).email;
          setCompose({ to: fromAddr, cc: "", bcc: "", subject: `Re: ${row.subject}`, body: "", html: "", attachments: [], mode: "reply" });
          setComposeOpen(true);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [composeOpen, gmailSettingsOpen, shortcutsOpen, gmailLive, liveSelectedId, liveMessages, openLiveMessage]);

  const commitSearch = (ev: React.FormEvent) => {
    ev.preventDefault();
    setSearchQuery(searchTerm.trim());
    setLiveSelectedId(null);
  };
  const clearSearch = () => { setSearchTerm(""); setSearchQuery(""); };

  const openInGmail = () => {
    const params = new URLSearchParams({
      view: "cm", to: compose.to, su: compose.subject, body: compose.body,
    });
    window.open(`https://mail.google.com/mail/u/0/?${params.toString()}`, "_blank");
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] rounded-xl overflow-hidden border bg-white dark:bg-neutral-950">
      {/* ── Top bar: Gmail search + refresh + help ─────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-white dark:bg-neutral-950">
        <div className="flex items-center gap-2 min-w-[180px]">
          <div className="w-8 h-8 rounded-md bg-[#c5221f] text-white grid place-items-center">
            <Mail className="w-4 h-4" />
          </div>
          <span className="font-semibold text-neutral-800 dark:text-neutral-100">Mail</span>
        </div>
        <form onSubmit={commitSearch} className="flex-1 max-w-2xl">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              ref={searchInputRef}
              data-testid="input-gmail-search"
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={gmailLive ? "Search mail (from:, subject:, has:attachment, is:unread…)" : "Search"}
              title={"Gmail operators: from: to: subject: has:attachment is:unread newer_than:7d \"quoted phrase\""}
              disabled={!gmailLive}
              className="w-full h-10 pl-10 pr-10 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-transparent focus:border-neutral-300 dark:focus:border-neutral-700 focus:bg-white dark:focus:bg-neutral-950 focus:outline-none text-sm disabled:opacity-60"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5 text-neutral-500" />
              </button>
            )}
          </div>
        </form>
        <div className="flex items-center gap-1 ml-auto">
          {gmailLive && (
            <>
              <button
                onClick={() => setLabelsOpen(true)}
                className="px-2.5 py-1.5 text-xs rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
                aria-label="Manage labels"
              >
                Labels
              </button>
              <button
                onClick={() => setRulesOpen(true)}
                className="px-2.5 py-1.5 text-xs rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
                aria-label="Manage rules"
              >
                Rules
              </button>
            </>
          )}
          <button
            data-testid="button-shortcuts-help"
            onClick={() => setShortcutsOpen(true)}
            className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
            aria-label="Keyboard shortcuts"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
          <button
            data-testid="button-refresh-gmail-top"
            onClick={() => refetchGmail()}
            disabled={!gmailLive || gmailFetching}
            className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300 disabled:opacity-40"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${gmailFetching ? "animate-spin" : ""}`} />
          </button>
          <Dialog open={gmailSettingsOpen} onOpenChange={(o) => { setGmailSettingsOpen(o); if (o) setGmailInput(currentEmployee?.gmailEmail || ""); }}>
            <DialogTrigger asChild>
              <button
                data-testid="button-gmail-settings"
                className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
                aria-label="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5 text-[#c5221f]" />
                  Gmail — {activeEmployee}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
                  Link your Gmail address, then connect Gmail with OAuth to send and read mail directly here.
                </div>

                {gmailStatus?.configured && (
                  gmailStatus.connected ? (
                    <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                      <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">Gmail connected</p>
                        <p className="text-xs text-muted-foreground truncate">{gmailStatus.email}</p>
                      </div>
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => disconnectGmail.mutate()}
                        disabled={disconnectGmail.isPending}
                      >
                        <LogOut className="w-3.5 h-3.5 mr-1" /> Disconnect
                      </Button>
                    </div>
                  ) : (
                    <Button
                      data-testid="button-connect-gmail"
                      onClick={connectGmail}
                      className="w-full bg-[#c5221f] hover:bg-[#a01a17] text-white gap-2"
                    >
                      <Link2 className="w-4 h-4" /> Connect Gmail with OAuth
                    </Button>
                  )
                )}

                {currentEmployee?.gmailEmail && (
                  <div className="flex items-center gap-2 p-3 bg-neutral-100 dark:bg-neutral-900 border rounded-lg">
                    <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Linked address</p>
                      <p className="text-xs text-muted-foreground truncate">{currentEmployee.gmailEmail}</p>
                    </div>
                    <Button
                      variant="ghost" size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => unlinkGmailMutation.mutate()}
                      disabled={unlinkGmailMutation.isPending}
                    >
                      Unlink
                    </Button>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Your Gmail Address</Label>
                  <Input
                    data-testid="input-gmail-email"
                    type="email"
                    value={gmailInput}
                    onChange={e => setGmailInput(e.target.value)}
                    placeholder="name@gmail.com"
                  />
                  <p className="text-xs text-muted-foreground">Only you can see and use it here.</p>
                </div>

                <div className="flex gap-2">
                  <Button
                    data-testid="button-link-gmail"
                    className="flex-1 bg-[#c5221f] hover:bg-[#a01a17] text-white"
                    onClick={() => linkGmailMutation.mutate()}
                    disabled={!gmailInput || linkGmailMutation.isPending}
                  >
                    {linkGmailMutation.isPending ? "Saving…" : "Save Address"}
                  </Button>
                  <Button variant="outline" className="gap-2" onClick={() => window.open("https://mail.google.com", "_blank")}>
                    <ExternalLink className="w-4 h-4" /> Open Gmail
                  </Button>
                </div>

                {gmailLive && (
                  <div className="space-y-2 border-t pt-4">
                    <Label className="flex items-center gap-2">
                      <Pen className="w-3.5 h-3.5" /> Email signature
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Auto-appended to every new email and reply. Basic HTML is supported
                      (bold, italic, links).
                    </p>
                    <Textarea
                      data-testid="input-email-signature"
                      className="font-mono text-xs min-h-[120px]"
                      value={signatureDraft}
                      onChange={(e) => setSignatureDraft(e.target.value)}
                      placeholder='<strong>Cody Brantley</strong><br>Titan Restoration LLC<br><a href="mailto:cody@titanaugusta.com">cody@titanaugusta.com</a>'
                    />
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSignatureDraft(signatureHtml)}
                        disabled={signatureDraft === signatureHtml}
                      >
                        Reset
                      </Button>
                      <Button
                        size="sm"
                        className="bg-[#c5221f] hover:bg-[#a01a17] text-white"
                        onClick={() => saveSignature.mutate()}
                        disabled={saveSignature.isPending || signatureDraft === signatureHtml}
                      >
                        {saveSignature.isPending ? "Saving…" : "Save signature"}
                      </Button>
                    </div>
                    {signatureHtml && (
                      <div className="rounded-md border bg-neutral-50 dark:bg-neutral-900 p-3">
                        <p className="text-[11px] text-muted-foreground mb-1">Preview</p>
                        <div
                          className="text-sm text-neutral-700 dark:text-neutral-200 [&_a]:text-[#1a73e8] [&_a]:underline"
                          dangerouslySetInnerHTML={{ __html: signatureHtml }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {isPrivileged && (
                  <div className="border-t pt-4">
                    <p className="text-xs text-muted-foreground">
                      Manage other team members from <span className="font-medium">Settings → User Management</span>.
                    </p>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ── Body: sidebar / list / reading pane ────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* ─── Left rail: Compose + folders ─── */}
        <aside className="w-56 shrink-0 border-r bg-neutral-50 dark:bg-neutral-900 flex flex-col">
          <div className="p-3">
            <Dialog
              open={composeOpen}
              onOpenChange={(v) => {
                if (v) { setComposeOpen(true); return; }
                // On close (Esc or backdrop click): save the draft first if
                // there's anything worth saving, then close. Matches Gmail
                // which never silently discards work-in-progress.
                if (composeIsDirty && gmailLive && !saveDraft.isPending) {
                  saveDraft.mutate();
                }
                setComposeOpen(false);
              }}
            >
              <DialogTrigger asChild>
                <Button
                  data-testid="button-compose"
                  className="w-full h-12 rounded-2xl bg-[#c5221f] hover:bg-[#a01a17] text-white shadow-sm gap-2 text-sm font-medium"
                >
                  <Plus className="w-4 h-4" /> Compose
                </Button>
              </DialogTrigger>
              <DialogContent
                className="sm:max-w-lg"
                onKeyDown={(e) => {
                  // Cmd/Ctrl+Enter: send. Prefer sendAndArchive when the
                  // compose was opened as a reply (threadId is set).
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    if (!compose.to || sendViaGmailLive.isPending || sendAndArchive.isPending) return;
                    if (gmailLive) sendViaGmailLive.mutate();
                    else sendMutation.mutate();
                  }
                }}
              >
                <DialogHeader>
                  <DialogTitle>{compose.mode === "new" ? "New Email" : compose.mode === "forward" ? "Forward" : "Reply"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
                    <Mail className="w-3.5 h-3.5" />
                    From: <span className="font-medium text-foreground">{fromAddress}</span>
                    {gmailLive && <Badge variant="secondary" className="ml-auto text-xs">Gmail</Badge>}
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 relative">
                      <Label>To</Label>
                      <Input
                        data-testid="input-email-to"
                        value={compose.to}
                        onChange={e => {
                          const v = e.target.value;
                          setCompose(f => ({ ...f, to: v }));
                          const tail = v.split(/[,;]\s*/).pop() || "";
                          if (tail.length >= 2) setContactSuggest({ field: "to", q: tail, items: [] });
                          else setContactSuggest(null);
                        }}
                        onBlur={() => window.setTimeout(() => setContactSuggest(null), 150)}
                        placeholder="recipient@email.com"
                      />
                      {contactSuggest?.field === "to" && contactSuggest.items.length > 0 && (
                        <ContactSuggestList
                          items={contactSuggest.items}
                          onPick={(email) => {
                            const parts = (compose.to || "").split(/([,;]\s*)/);
                            parts[parts.length - 1] = email;
                            const newVal = parts.join("") + ", ";
                            setCompose(f => ({ ...f, to: newVal }));
                            setContactSuggest(null);
                          }}
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowCcBcc(v => !v)}
                      className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 mt-6 shrink-0"
                    >
                      {showCcBcc ? "Hide Cc/Bcc" : "Cc/Bcc"}
                    </button>
                  </div>
                  {showCcBcc && (
                    <>
                      <div className="relative">
                        <Label>Cc</Label>
                        <Input
                          data-testid="input-email-cc"
                          value={compose.cc}
                          onChange={e => {
                            const v = e.target.value;
                            setCompose(f => ({ ...f, cc: v }));
                            const tail = v.split(/[,;]\s*/).pop() || "";
                            if (tail.length >= 2) setContactSuggest({ field: "cc", q: tail, items: [] });
                            else setContactSuggest(null);
                          }}
                          onBlur={() => window.setTimeout(() => setContactSuggest(null), 150)}
                          placeholder="comma-separated"
                        />
                        {contactSuggest?.field === "cc" && contactSuggest.items.length > 0 && (
                          <ContactSuggestList
                            items={contactSuggest.items}
                            onPick={(email) => {
                              const parts = (compose.cc || "").split(/([,;]\s*)/);
                              parts[parts.length - 1] = email;
                              setCompose(f => ({ ...f, cc: parts.join("") + ", " }));
                              setContactSuggest(null);
                            }}
                          />
                        )}
                      </div>
                      <div className="relative">
                        <Label>Bcc</Label>
                        <Input
                          data-testid="input-email-bcc"
                          value={compose.bcc}
                          onChange={e => {
                            const v = e.target.value;
                            setCompose(f => ({ ...f, bcc: v }));
                            const tail = v.split(/[,;]\s*/).pop() || "";
                            if (tail.length >= 2) setContactSuggest({ field: "bcc", q: tail, items: [] });
                            else setContactSuggest(null);
                          }}
                          onBlur={() => window.setTimeout(() => setContactSuggest(null), 150)}
                          placeholder="comma-separated"
                        />
                        {contactSuggest?.field === "bcc" && contactSuggest.items.length > 0 && (
                          <ContactSuggestList
                            items={contactSuggest.items}
                            onPick={(email) => {
                              const parts = (compose.bcc || "").split(/([,;]\s*)/);
                              parts[parts.length - 1] = email;
                              setCompose(f => ({ ...f, bcc: parts.join("") + ", " }));
                              setContactSuggest(null);
                            }}
                          />
                        )}
                      </div>
                    </>
                  )}
                  <div>
                    <Label>Subject</Label>
                    <Input
                      data-testid="input-email-subject"
                      value={compose.subject}
                      onChange={e => setCompose(f => ({ ...f, subject: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Message</Label>
                    <RichTextEditor
                      html={compose.html}
                      onChange={(h) => setCompose(f => ({ ...f, html: h }))}
                    />
                    {signatureHtml && (
                      <p className="text-[11px] text-neutral-500 mt-1">
                        Your signature will be appended automatically.{" "}
                        <button
                          type="button"
                          className="underline hover:text-neutral-800 dark:hover:text-neutral-200"
                          onClick={() => { setComposeOpen(false); setGmailSettingsOpen(true); }}
                        >
                          Edit
                        </button>
                      </p>
                    )}
                  </div>
                  {/* Attachments strip — only rendered when the user has
                       actually attached something. Empty state stays clean. */}
                  {compose.attachments.length > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">
                        Attachments ({compose.attachments.length}) —{" "}
                        {formatBytes(compose.attachments.reduce((n, a) => n + a.size, 0))} of 25 MB
                      </Label>
                      <ul className="space-y-1">
                        {compose.attachments.map((a, i) => (
                          <li
                            key={i}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-md border bg-neutral-50 dark:bg-neutral-900"
                          >
                            <FileIcon className="w-4 h-4 text-neutral-500 shrink-0" />
                            <span className="text-xs flex-1 min-w-0 truncate">{a.filename}</span>
                            <span className="text-xs text-neutral-500 shrink-0">{formatBytes(a.size)}</span>
                            <button
                              data-testid={`button-remove-attachment-${i}`}
                              onClick={() => removeAttachment(i)}
                              className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 shrink-0"
                              aria-label={`Remove ${a.filename}`}
                              type="button"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <input
                    ref={composeFileRef}
                    data-testid="input-attach-file"
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => onPickFiles(e.target.files)}
                  />
                  <div className="flex flex-wrap gap-2 items-center">
                    {gmailLive ? (
                      <>
                        <Button
                          data-testid="button-send-gmail-live"
                          className="flex-1 bg-[#c5221f] hover:bg-[#a01a17] text-white"
                          onClick={() => sendViaGmailLive.mutate()}
                          disabled={sendViaGmailLive.isPending || !compose.to}
                          title="Send (⌘↵)"
                        >
                          <Send className="w-4 h-4 mr-2" />
                          {sendViaGmailLive.isPending ? "Sending…" : "Send"}
                        </Button>
                        {(compose.mode === "reply" || compose.mode === "replyAll") && compose.threadId && (
                          <Button
                            data-testid="button-send-and-archive"
                            type="button"
                            variant="outline"
                            className="gap-2"
                            onClick={() => sendAndArchive.mutate()}
                            disabled={sendAndArchive.isPending || !compose.to}
                            title="Send and archive the original conversation"
                          >
                            <Archive className="w-4 h-4" />
                            {sendAndArchive.isPending ? "Sending…" : "Send + Archive"}
                          </Button>
                        )}
                        <Button
                          data-testid="button-schedule-send"
                          type="button"
                          variant="outline"
                          className="gap-2"
                          onClick={() => setScheduleOpen(true)}
                          disabled={!compose.to}
                          title="Schedule send"
                        >
                          <CalendarClock className="w-4 h-4" />
                          Schedule
                        </Button>
                        <Button
                          data-testid="button-save-draft"
                          type="button"
                          variant="outline"
                          className="gap-2"
                          onClick={() => saveDraft.mutate()}
                          disabled={saveDraft.isPending || (!compose.to && !compose.subject && !compose.html)}
                          title="Save draft"
                        >
                          <FileText className="w-4 h-4" />
                          {saveDraft.isPending ? "Saving…" : "Save draft"}
                        </Button>
                        <Button
                          data-testid="button-attach-file"
                          type="button"
                          variant="outline"
                          className="gap-2"
                          onClick={() => composeFileRef.current?.click()}
                          title="Attach files"
                        >
                          <Paperclip className="w-4 h-4" />
                          Attach
                        </Button>
                        <Button
                          data-testid="button-attach-from-job"
                          type="button"
                          variant="outline"
                          className="gap-2"
                          onClick={() => setJobPickerOpen(true)}
                          title="Attach a file from a job"
                        >
                          <Briefcase className="w-4 h-4" />
                          Attach from job
                        </Button>
                        <Button
                          data-testid="button-discard-draft"
                          type="button"
                          variant="ghost"
                          className="gap-2 text-neutral-500 hover:text-red-600 ml-auto"
                          onClick={discardDraft}
                          title="Discard draft"
                        >
                          <Trash2 className="w-4 h-4" />
                          Discard
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          data-testid="button-send-email"
                          className="flex-1 bg-[#c5221f] hover:bg-[#a01a17] text-white"
                          onClick={() => sendMutation.mutate()}
                          disabled={sendMutation.isPending}
                        >
                          <Send className="w-4 h-4 mr-2" />
                          {sendMutation.isPending ? "Saving…" : "Save (Local)"}
                        </Button>
                        {currentEmployee?.gmailEmail && (
                          <Button
                            data-testid="button-send-gmail"
                            variant="outline"
                            className="gap-2"
                            onClick={openInGmail}
                          >
                            <ExternalLink className="w-4 h-4" /> Open in Gmail
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  {!gmailLive && (
                    <p className="text-xs text-muted-foreground text-center">
                      <button
                        className="underline text-[#c5221f]"
                        onClick={() => { setComposeOpen(false); setGmailSettingsOpen(true); }}
                      >
                        Connect Gmail
                      </button>
                      {" "}to send and receive real email inside Titan Pro.
                    </p>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <nav className="flex-1 overflow-y-auto pb-3">
            {FOLDERS.map(f => {
              const active = folder === f.id;
              const badge = f.id === "inbox" && unreadCount > 0 ? unreadCount : null;
              return (
                <button
                  key={f.id}
                  data-testid={`nav-folder-${f.id}`}
                  onClick={() => { setFolder(f.id); setSelectedId(null); setLiveSelectedId(null); setSearchTerm(""); setSearchQuery(""); }}
                  className={`w-full flex items-center gap-3 h-8 pl-6 pr-4 rounded-r-full text-sm transition-colors ${
                    active
                      ? "bg-[#fce8e6] text-[#c5221f] font-semibold"
                      : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800"
                  }`}
                >
                  <f.icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1 text-left">{f.label}</span>
                  {badge != null && (
                    <span className={`text-xs ${active ? "text-[#c5221f]" : "text-neutral-500"}`}>{badge}</span>
                  )}
                </button>
              );
            })}
            {gmailLive && labelsQuery.data?.labels && labelsQuery.data.labels.some(l => l.type === "user") && (
              <div className="mt-3 pl-6 pr-4">
                <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500 mb-1">Labels</div>
                {labelsQuery.data.labels.filter(l => l.type === "user").sort((a, b) => (a.name || "").localeCompare(b.name || "")).slice(0, 40).map(l => {
                  const active = searchQuery === `label:${JSON.stringify(l.name)}`;
                  return (
                    <button
                      key={l.id}
                      onClick={() => {
                        const q = `label:${JSON.stringify(l.name)}`;
                        setSearchTerm(q); setSearchQuery(q);
                        setFolder("inbox"); setSelectedId(null); setLiveSelectedId(null);
                      }}
                      className={`w-full flex items-center gap-2 h-7 px-2 -ml-2 rounded text-xs transition-colors ${
                        active ? "bg-[#fce8e6] text-[#c5221f] font-semibold" : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800"
                      }`}
                    >
                      <Tag className="w-3 h-3 shrink-0" />
                      <span className="flex-1 text-left truncate">{l.name}</span>
                      {l.messagesUnread ? <span className="text-neutral-500">{l.messagesUnread}</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </nav>

          {/* Signed-in identity + owner diag block — pinned bottom */}
          <div className="border-t p-3 text-xs">
            <p className="text-neutral-500 dark:text-neutral-400 mb-1">Signed in as</p>
            <p className="font-medium text-neutral-800 dark:text-neutral-200 truncate">{activeEmployee || "—"}</p>
            {gmailLive ? (
              <p className="text-green-600 dark:text-green-400 truncate mt-0.5 flex items-center gap-1">
                <CheckCircle className="w-3 h-3 shrink-0" />
                <span className="truncate">{gmailStatus?.email}</span>
              </p>
            ) : currentEmployee?.gmailEmail ? (
              <p className="text-neutral-500 truncate mt-0.5">{currentEmployee.gmailEmail}</p>
            ) : (
              <p className="text-neutral-400 truncate mt-0.5">{fromAddress}</p>
            )}
            {isPrivileged && gmailStatus && !gmailStatus.configured && gmailStatus.diag && (
              <div className="mt-3 p-2 rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50">
                <p className="text-[10px] font-bold text-red-700 dark:text-red-300 mb-1">Gmail not configured</p>
                <ul className="text-[10px] font-mono space-y-0.5">
                  {Object.entries(gmailStatus.diag.env).map(([k, v]) => (
                    <li key={k} className="flex items-center gap-1">
                      <span className={v ? "text-green-600" : "text-red-500"}>{v ? "✓" : "✗"}</span>
                      <span className={v ? "text-neutral-600" : "text-red-600 dark:text-red-400"}>{k}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-neutral-500 mt-1 leading-snug">Redirect URI:</p>
                <p className="text-[10px] font-mono break-all mt-0.5 text-neutral-700 dark:text-neutral-300">
                  {gmailStatus.diag.expectedRedirectUri}
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* ─── Middle: message list ─── */}
        <section className={`${(gmailLive ? liveSelectedId : selected) ? "hidden md:flex" : "flex"} flex-col ${gmailLive ? "w-96" : "w-80"} shrink-0 border-r bg-white dark:bg-neutral-950`}>
          {gmailLive && folder === "drafts" ? (
            <div className="flex flex-col h-full">
              <div className="px-3 py-2 border-b text-xs font-medium text-neutral-500">Drafts</div>
              <div className="flex-1 overflow-y-auto">
                {draftsQuery.isLoading && <div className="p-4 text-sm text-neutral-500">Loading drafts…</div>}
                {(draftsQuery.data?.drafts || []).length === 0 && !draftsQuery.isLoading && (
                  <div className="p-4 text-sm text-neutral-500">No drafts saved.</div>
                )}
                {(draftsQuery.data?.drafts || []).map(d => (
                  <div
                    key={d.draftId}
                    className="px-3 py-2 border-b hover:bg-neutral-50 dark:hover:bg-neutral-900 cursor-pointer flex items-start gap-2"
                    onClick={() => loadDraftIntoCompose(d.draftId)}
                  >
                    <FileText className="w-4 h-4 mt-1 text-neutral-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{d.subject || "(no subject)"}</div>
                      <div className="text-xs text-neutral-500 truncate">To: {d.to || "(no recipient)"}</div>
                      <div className="text-xs text-neutral-400 truncate">{d.snippet}</div>
                    </div>
                    <button
                      type="button"
                      onClick={(ev) => { ev.stopPropagation(); deleteDraft.mutate(d.draftId); }}
                      className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800"
                      title="Delete draft"
                    ><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>
          ) : gmailLive && folder === "scheduled" ? (
            <div className="flex flex-col h-full">
              <div className="px-3 py-2 border-b text-xs font-medium text-neutral-500">Scheduled sends</div>
              <div className="flex-1 overflow-y-auto">
                {scheduledQuery.isLoading && <div className="p-4 text-sm text-neutral-500">Loading…</div>}
                {(scheduledQuery.data?.scheduled || []).length === 0 && !scheduledQuery.isLoading && (
                  <div className="p-4 text-sm text-neutral-500">Nothing scheduled.</div>
                )}
                {(scheduledQuery.data?.scheduled || []).map(s => (
                  <div key={s.id} className="px-3 py-2 border-b flex items-start gap-2">
                    <CalendarClock className="w-4 h-4 mt-1 text-neutral-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{s.subject || "(no subject)"}</div>
                      <div className="text-xs text-neutral-500 truncate">To: {s.to_field || ""}</div>
                      <div className="text-xs text-neutral-400">
                        {new Date(s.scheduled_for).toLocaleString()} — {s.status}
                        {s.error && <span className="text-red-600"> — {s.error}</span>}
                      </div>
                    </div>
                    {s.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => cancelScheduled.mutate(s.id)}
                        className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800"
                        title="Cancel scheduled send"
                      ><X className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : gmailLive && folder === "snoozed" ? (
            <div className="flex flex-col h-full">
              <div className="px-3 py-2 border-b text-xs font-medium text-neutral-500">Snoozed</div>
              <div className="flex-1 overflow-y-auto">
                {snoozedQuery.isLoading && <div className="p-4 text-sm text-neutral-500">Loading…</div>}
                {(snoozedQuery.data?.snoozed || []).length === 0 && !snoozedQuery.isLoading && (
                  <div className="p-4 text-sm text-neutral-500">No snoozed messages.</div>
                )}
                {(snoozedQuery.data?.snoozed || []).map(s => (
                  <div key={s.id} className="px-3 py-2 border-b flex items-start gap-2">
                    <Clock className="w-4 h-4 mt-1 text-neutral-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">Message #{s.messageId.slice(-8)}</div>
                      <div className="text-xs text-neutral-500">Wakes {new Date(s.wakeAt).toLocaleString()}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => unsnoozeMessage.mutate(s.id)}
                      className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800"
                      title="Unsnooze now"
                    ><Undo2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>
          ) : gmailLive ? (
            <GmailList
              rows={liveMessages}
              loading={gmailLoading}
              folder={folder}
              selectedId={liveSelectedId}
              onOpen={openLiveMessage}
              onToggleStar={toggleStar}
              onArchive={archiveRow}
              onTrash={trashRow}
              searchQuery={searchQuery}
              onClearSearch={clearSearch}
              selectedRows={selectedRows}
              onToggleRow={toggleRow}
              onToggleAll={toggleAllRows}
              onSelectSubset={selectSubset}
              onBulkArchive={bulkArchive}
              onBulkTrash={bulkTrash}
              onBulkMarkRead={bulkMarkRead}
              onBulkMarkUnread={bulkMarkUnread}
              hasNextPage={!!nextPageToken}
              hasPrevPage={pageTokens.length > 0}
              onNextPage={goNextPage}
              onPrevPage={goPrevPage}
              onFilterSender={filterBySender}
            />
          ) : (
            <LegacyList
              emails={emails}
              folder={folder}
              selectedId={selectedId}
              onOpen={(id) => {
                setSelectedId(id);
                const e = emails.find(x => x.id === id);
                if (e && !e.read) markRead.mutate(id);
              }}
            />
          )}
        </section>

        {/* ─── Right: reading pane ─── */}
        <section className="flex-1 overflow-y-auto bg-white dark:bg-neutral-950">
          {gmailLive ? (
            liveSelectedId ? (
              liveDetailLoading ? (
                <div className="p-8 space-y-3 animate-pulse max-w-3xl">
                  <div className="h-6 bg-neutral-200 dark:bg-neutral-800 rounded w-1/2" />
                  <div className="h-3 bg-neutral-200 dark:bg-neutral-800 rounded w-1/3" />
                  <div className="h-40 bg-neutral-200 dark:bg-neutral-800 rounded w-full mt-4" />
                </div>
              ) : liveDetail ? (
                <GmailDetail
                  detail={liveDetail}
                  onBack={() => setLiveSelectedId(null)}
                  onReply={() => buildReplyCompose(liveDetail, "reply")}
                  onReplyAll={() => buildReplyCompose(liveDetail, "replyAll")}
                  onForward={() => buildReplyCompose(liveDetail, "forward")}
                  onArchive={() => archiveRow(liveDetail.id)}
                  onTrash={() => trashRow(liveDetail.id)}
                  onMarkUnread={() => { markUnreadRow(liveDetail.id); setLiveSelectedId(null); }}
                  onToggleStar={() => toggleStar({
                    id: liveDetail.id,
                    from: liveDetail.from,
                    to: liveDetail.to,
                    subject: liveDetail.subject,
                    date: liveDetail.date,
                    unread: false,
                    starred: liveDetail.starred,
                  })}
                  starred={!!liveDetail.starred}
                  onDownloadAttachment={(att) => downloadAttachment(liveDetail.id, att)}
                  onSnooze={() => { setSnoozeAt(""); setSnoozeOpen(liveDetail.id); }}
                  onOpenThread={() => setThreadOpen(liveDetail.threadId || liveDetail.id)}
                  onFileToJob={() => setJobLinkFor({
                    threadId: liveDetail.threadId,
                    messageId: liveDetail.id,
                    subject: liveDetail.subject,
                    from: liveDetail.from,
                    snippet: liveDetail.snippet,
                  })}
                  jobLinks={threadLinksQuery.data?.links || []}
                  onUnlinkJob={(linkId) => unlinkJob.mutate(linkId)}
                  labels={labelsQuery.data?.labels || []}
                  onAddLabel={(labelId) => applyLabelToMessage.mutate({ messageId: liveDetail.id, addLabelIds: [labelId] })}
                  onRemoveLabel={(labelId) => applyLabelToMessage.mutate({ messageId: liveDetail.id, removeLabelIds: [labelId] })}
                  onSpam={() => spamRow(liveDetail.id)}
                  onNotSpam={() => notSpamRow(liveDetail.id)}
                  onMoveTo={(labelId) => moveToLabel(liveDetail.id, labelId)}
                  onPreviewAttachment={(att) => previewAttachment(liveDetail.id, att)}
                  onFilterSender={filterBySender}
                  inline={{ open: inlineReplyOpen, mode: inlineReplyMode }}
                  onInlineReplyOpen={(mode) => { setInlineReplyMode(mode); setInlineReplyText(""); setInlineReplyOpen(true); }}
                  inlineReplyText={inlineReplyText}
                  onInlineReplyChange={setInlineReplyText}
                  onInlineReplySend={() => sendInlineReply.mutate()}
                  onInlineReplyCancel={() => { setInlineReplyOpen(false); setInlineReplyText(""); }}
                  inlineReplyPending={sendInlineReply.isPending}
                />
              ) : (
                <EmptyPane message="Could not load this message." />
              )
            ) : (
              <EmptyPane
                message={searchQuery ? `No results for “${searchQuery}”.` : "Select a conversation to read."}
                sub={gmailStatus?.email ? `Live Gmail — ${gmailStatus.email}` : undefined}
              />
            )
          ) : selected ? (
            <LegacyDetail
              email={selected}
              onBack={() => setSelectedId(null)}
              onReply={() => {
                setCompose({
                  to: selected.from,
                  cc: "",
                  bcc: "",
                  subject: `Re: ${selected.subject}`,
                  body: `\n\n--- Original Message ---\nFrom: ${selected.from}\n${selected.body}`,
                  html: "",
                  attachments: [],
                  mode: "reply",
                });
                setComposeOpen(true);
              }}
              onDelete={() => deleteEmail.mutate(selected.id)}
              onOpenInGmail={currentEmployee?.gmailEmail ? () => {
                const params = new URLSearchParams({
                  view: "cm", to: selected.from, su: `Re: ${selected.subject}`, body: `\n\n--- Original ---\n${selected.body}`,
                });
                window.open(`https://mail.google.com/mail/u/0/?${params.toString()}`, "_blank");
              } : undefined}
            />
          ) : (
            <EmptyPane
              message="Select an email to read."
              sub={!currentEmployee?.gmailEmail ? "Connect Gmail from the top-right settings to see your real mailbox." : undefined}
            />
          )}
        </section>
      </div>

      {/* ── Keyboard-shortcuts help dialog ─────────────────────────────── */}
      {/* ── Undo Send toast ──────────────────────────────────────────────
           Persistent at the bottom of the screen for 10s after every send.
           Clicking Undo trashes the just-sent message. */}
      {pendingUndoId && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-neutral-900 dark:bg-neutral-800 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg">
          <CheckCircle className="w-4 h-4 text-green-400" />
          <span>Message sent</span>
          <button
            data-testid="button-undo-send"
            onClick={() => undoSend.mutate(pendingUndoId)}
            disabled={undoSend.isPending}
            className="underline text-blue-300 hover:text-blue-200 flex items-center gap-1 disabled:opacity-50"
          >
            <Undo2 className="w-3.5 h-3.5" /> Undo
          </button>
          <button
            onClick={() => setPendingUndoId(null)}
            className="text-neutral-400 hover:text-white ml-1"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Schedule send dialog ── */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule send</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Tomorrow 8am", offset: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d; } },
                { label: "Tomorrow 1pm", offset: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(13, 0, 0, 0); return d; } },
                { label: "Monday 8am",   offset: () => { const d = new Date(); const day = d.getDay(); const add = (1 + 7 - day) % 7 || 7; d.setDate(d.getDate() + add); d.setHours(8, 0, 0, 0); return d; } },
                { label: "In 1 hour",    offset: () => new Date(Date.now() + 60 * 60_000) },
              ].map(p => (
                <Button key={p.label} size="sm" variant="outline" onClick={() => setScheduleAt(p.offset().toISOString().slice(0, 16))}>
                  {p.label}
                </Button>
              ))}
            </div>
            <div>
              <Label>Custom date + time (your local time)</Label>
              <Input type="datetime-local" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button onClick={() => scheduleSend.mutate()} disabled={!scheduleAt || scheduleSend.isPending} className="bg-[#c5221f] hover:bg-[#a01a17] text-white">
              {scheduleSend.isPending ? "Scheduling…" : "Schedule send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Snooze dialog ── */}
      <Dialog open={!!snoozeOpen} onOpenChange={(v) => { if (!v) setSnoozeOpen(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Snooze until</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Later today (3h)", offset: () => new Date(Date.now() + 3 * 60 * 60_000) },
                { label: "Tomorrow 8am",     offset: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d; } },
                { label: "This weekend",     offset: () => { const d = new Date(); const day = d.getDay(); const add = (6 + 7 - day) % 7 || 7; d.setDate(d.getDate() + add); d.setHours(8, 0, 0, 0); return d; } },
                { label: "Next week",        offset: () => { const d = new Date(); const day = d.getDay(); const add = (1 + 7 - day) % 7 || 7; d.setDate(d.getDate() + add); d.setHours(8, 0, 0, 0); return d; } },
              ].map(p => (
                <Button key={p.label} size="sm" variant="outline" onClick={() => setSnoozeAt(p.offset().toISOString().slice(0, 16))}>{p.label}</Button>
              ))}
            </div>
            <div>
              <Label>Custom</Label>
              <Input type="datetime-local" value={snoozeAt} onChange={e => setSnoozeAt(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSnoozeOpen(null)}>Cancel</Button>
            <Button onClick={() => snoozeOpen && snoozeMessage.mutate({ messageId: snoozeOpen, wakeAt: snoozeAt })} disabled={!snoozeAt || snoozeMessage.isPending}>
              {snoozeMessage.isPending ? "Snoozing…" : "Snooze"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Attach from job ── */}
      <JobPickerDialog open={jobPickerOpen} onOpenChange={setJobPickerOpen} onAttach={attachFromJob} />

      {/* ── Labels manager ── */}
      <LabelsManagerDialog
        open={labelsOpen}
        onOpenChange={setLabelsOpen}
        labels={labelsQuery.data?.labels || []}
        onCreate={(name) => createLabel.mutate(name)}
        onRename={(id, name) => renameLabel.mutate({ id, name })}
        onDelete={(id) => deleteLabel.mutate(id)}
      />

      {/* ── Rules manager ── */}
      <RulesManagerDialog
        open={rulesOpen}
        onOpenChange={setRulesOpen}
        rules={rulesQuery.data?.rules || []}
        onSave={(rule) => saveRule.mutate(rule)}
        onDelete={(id) => deleteRule.mutate(id)}
        onRunNow={() => runRules.mutate()}
        running={runRules.isPending}
      />

      {/* ── Thread (conversation) dialog ── */}
      <Dialog open={!!threadOpen} onOpenChange={(v) => { if (!v) setThreadOpen(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{threadQuery.data?.messages?.[0]?.subject || "Conversation"}</DialogTitle>
          </DialogHeader>
          {threadQuery.isLoading && <div className="text-sm text-neutral-500">Loading conversation…</div>}
          <div className="space-y-3">
            {(threadQuery.data?.messages || []).map((m, idx, arr) => (
              <ThreadMessage
                key={m.id}
                msg={m}
                defaultOpen={idx === arr.length - 1}
              />
            ))}
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.print()}><FileText className="w-4 h-4 mr-1" /> Print / PDF</Button>
            <Button variant="outline" onClick={() => {
              const m = threadQuery.data?.messages?.[0];
              if (m) setJobLinkFor({ threadId: threadQuery.data?.id, subject: m.subject, from: m.from, snippet: m.snippet });
            }}><Briefcase className="w-4 h-4 mr-1" /> File under job</Button>
            <Button onClick={() => {
              const last = threadQuery.data?.messages?.[threadQuery.data.messages.length - 1];
              if (last) {
                setThreadOpen(null);
                buildReplyCompose({
                  ...last,
                  to: last.from,
                }, "reply");
              }
            }} className="bg-[#c5221f] hover:bg-[#a01a17] text-white"><Reply className="w-4 h-4 mr-1" /> Reply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Job link picker ── */}
      <Dialog open={!!jobLinkFor} onOpenChange={(v) => { if (!v) setJobLinkFor(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>File email under job</DialogTitle>
          </DialogHeader>
          <JobLinkPickerBody
            onPick={(jobId) => {
              if (jobLinkFor) linkJob.mutate({ jobId, ...jobLinkFor });
              setJobLinkFor(null);
            }}
            onCancel={() => setJobLinkFor(null)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <ShortcutRow k="/" label="Focus search" />
            <ShortcutRow k="⌘K" label="Focus search (from anywhere)" />
            <ShortcutRow k="c" label="Compose" />
            <ShortcutRow k="j" label="Next conversation" />
            <ShortcutRow k="k" label="Previous conversation" />
            <ShortcutRow k="Enter" label="Open (from list)" />
            <ShortcutRow k="u" label="Back to list" />
            <ShortcutRow k="r" label="Reply" />
            <ShortcutRow k="s" label="Toggle star" />
            <ShortcutRow k="e" label="Archive" />
            <ShortcutRow k="#" label="Move to Trash" />
            <ShortcutRow k="⌘↵" label="Send (in compose)" />
            <ShortcutRow k="Esc" label="Close compose (saves draft)" />
            <ShortcutRow k="?" label="This help" />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Shortcuts are ignored while you're typing in a field or a dialog is open.
          </p>
        </DialogContent>
      </Dialog>

      {/* Attachment preview modal — Gmail's inline viewer for images and PDFs.
           Object URL is created in previewAttachment and revoked on unmount. */}
      <Dialog open={!!attachPreview} onOpenChange={(v) => { if (!v) setAttachPreview(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate">{attachPreview?.filename || "Preview"}</DialogTitle>
          </DialogHeader>
          {attachPreview && (
            <div className="h-[70vh] w-full bg-neutral-100 dark:bg-neutral-900 rounded-lg overflow-hidden">
              {attachPreview.mimeType.startsWith("image/") ? (
                <img
                  src={attachPreview.url}
                  alt={attachPreview.filename}
                  className="w-full h-full object-contain"
                />
              ) : (
                <iframe
                  src={attachPreview.url}
                  title={attachPreview.filename}
                  className="w-full h-full border-0"
                />
              )}
            </div>
          )}
          <DialogFooter>
            {attachPreview && (
              <a
                href={attachPreview.url}
                download={attachPreview.filename}
                className="inline-flex items-center gap-2 px-3 h-9 rounded-md border border-neutral-300 dark:border-neutral-700 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <Download className="w-4 h-4" /> Download
              </a>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function ShortcutRow({ k, label }: { k: string; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-600 dark:text-neutral-400">{label}</span>
      <kbd className="px-1.5 py-0.5 rounded border bg-neutral-100 dark:bg-neutral-900 text-xs font-mono">{k}</kbd>
    </div>
  );
}

function EmptyPane({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="h-full grid place-items-center">
      <div className="text-center text-neutral-500 dark:text-neutral-400 max-w-sm px-4">
        <Inbox className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p className="text-sm">{message}</p>
        {sub && <p className="text-xs mt-2 opacity-70">{sub}</p>}
      </div>
    </div>
  );
}

// Message row for live Gmail. Gmail-styled: hover = full-width row action
// buttons (archive / trash / mark unread), star on left, sender + snippet
// inline, date on the right.
function GmailList({
  rows, loading, folder, selectedId, onOpen, onToggleStar, onArchive, onTrash,
  searchQuery, onClearSearch,
  selectedRows, onToggleRow, onToggleAll, onSelectSubset, onBulkArchive, onBulkTrash, onBulkMarkRead, onBulkMarkUnread,
  hasNextPage, hasPrevPage, onNextPage, onPrevPage,
  onFilterSender,
}: {
  rows: GmailRow[];
  loading: boolean;
  folder: string;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onToggleStar: (row: GmailRow) => void;
  onArchive: (id: string) => void;
  onTrash: (id: string) => void;
  searchQuery: string;
  onClearSearch: () => void;
  selectedRows: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  onSelectSubset: (subset: "all" | "none" | "read" | "unread" | "starred" | "unstarred") => void;
  onBulkArchive: () => void;
  onBulkTrash: () => void;
  onBulkMarkRead: () => void;
  onBulkMarkUnread: () => void;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  onNextPage: () => void;
  onPrevPage: () => void;
  onFilterSender?: (email: string) => void;
}) {
  const allChecked = rows.length > 0 && rows.every(r => selectedRows.has(r.id));
  const someChecked = rows.some(r => selectedRows.has(r.id));
  const bulkCount = selectedRows.size;
  const bulkBar = (
    <div className="flex items-center gap-1 px-2 h-10 border-b bg-neutral-50 dark:bg-neutral-900">
      <Checkbox
        checked={allChecked ? true : someChecked ? "indeterminate" : false}
        onCheckedChange={onToggleAll}
        aria-label="Select all on this page"
        data-testid="checkbox-select-all"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-500"
            aria-label="Select options"
            data-testid="button-select-subset"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => onSelectSubset("all")}>All</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSelectSubset("none")}>None</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSelectSubset("read")}>Read</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSelectSubset("unread")}>Unread</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSelectSubset("starred")}>Starred</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSelectSubset("unstarred")}>Unstarred</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {bulkCount > 0 ? (
        <>
          <span className="text-xs text-neutral-600 dark:text-neutral-300 ml-2">{bulkCount} selected</span>
          <div className="w-px h-4 bg-neutral-300 dark:bg-neutral-700 mx-1" />
          <button onClick={onBulkArchive} className="p-1.5 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300" title="Archive" data-testid="button-bulk-archive">
            <Archive className="w-4 h-4" />
          </button>
          <button onClick={onBulkTrash} className="p-1.5 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300" title="Trash" data-testid="button-bulk-trash">
            <Trash2 className="w-4 h-4" />
          </button>
          <button onClick={onBulkMarkRead} className="p-1.5 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300" title="Mark as read" data-testid="button-bulk-read">
            <MailOpen className="w-4 h-4" />
          </button>
          <button onClick={onBulkMarkUnread} className="p-1.5 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300" title="Mark as unread" data-testid="button-bulk-unread">
            <Mail className="w-4 h-4" />
          </button>
        </>
      ) : (
        <span className="text-[11px] text-neutral-500 ml-2">Select messages to bulk-manage</span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={onPrevPage}
          disabled={!hasPrevPage}
          className="p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300 disabled:opacity-40 disabled:hover:bg-transparent"
          title="Previous page"
          data-testid="button-prev-page"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onNextPage}
          disabled={!hasNextPage}
          className="p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300 disabled:opacity-40 disabled:hover:bg-transparent"
          title="Next page"
          data-testid="button-next-page"
        >
          <ArrowLeft className="w-3.5 h-3.5 rotate-180" />
        </button>
      </div>
    </div>
  );
  if (loading) {
    return (
      <>
        {bulkBar}
        <div className="p-3 space-y-3">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="space-y-1.5 animate-pulse">
              <div className="h-3 bg-neutral-200 dark:bg-neutral-800 rounded w-2/3" />
              <div className="h-2.5 bg-neutral-200 dark:bg-neutral-800 rounded w-full" />
            </div>
          ))}
        </div>
      </>
    );
  }
  if (rows.length === 0) {
    return (
      <>
        {bulkBar}
        <div className="h-full grid place-items-center">
          <div className="text-center text-neutral-500 max-w-xs px-4">
            <p className="text-sm">
              {searchQuery ? `No results for “${searchQuery}”` : `No messages in ${folder}`}
            </p>
            {searchQuery && (
              <button onClick={onClearSearch} className="text-xs mt-2 underline text-[#c5221f]">
                Clear search
              </button>
            )}
          </div>
        </div>
      </>
    );
  }
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {bulkBar}
      <ul className="flex-1 overflow-y-auto" role="list">
      {rows.map(m => {
        const sender = parseSender(folder === "sent" ? m.to : m.from);
        const active = m.id === selectedId;
        return (
          <li
            key={m.id}
            className={`group relative border-b flex items-center gap-2 px-3 h-14 cursor-pointer transition-colors ${
              active
                ? "bg-[#c2dbff] dark:bg-blue-950/40"
                : m.unread
                ? "bg-white dark:bg-neutral-950 hover:bg-neutral-100 dark:hover:bg-neutral-900 shadow-[inset_2px_0_0_0_#c5221f]"
                : "bg-neutral-50/60 dark:bg-neutral-900/40 hover:bg-neutral-100 dark:hover:bg-neutral-900"
            }`}
            onClick={() => onOpen(m.id)}
            data-testid={`gmail-row-${m.id}`}
          >
            <div onClick={(ev) => ev.stopPropagation()} className="shrink-0 pl-0.5">
              <Checkbox
                checked={selectedRows.has(m.id)}
                onCheckedChange={() => onToggleRow(m.id)}
                aria-label="Select message"
                data-testid={`checkbox-row-${m.id}`}
              />
            </div>
            <button
              onClick={(ev) => { ev.stopPropagation(); onToggleStar(m); }}
              className="p-1 shrink-0"
              aria-label={m.starred ? "Unstar" : "Star"}
              data-testid={`button-star-${m.id}`}
            >
              <Star
                className={`w-4 h-4 ${m.starred ? "text-amber-500 fill-amber-500" : "text-neutral-400 hover:text-neutral-600"}`}
              />
            </button>
            <div
              className="w-8 h-8 rounded-full shrink-0 grid place-items-center text-xs font-medium text-white"
              style={{ backgroundColor: avatarColor(sender.email || sender.name) }}
              aria-hidden
            >
              {initials(sender.name || sender.email)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <button
                  type="button"
                  onClick={(ev) => { ev.stopPropagation(); onFilterSender?.(sender.email); }}
                  className={`text-sm truncate text-left hover:underline ${m.unread ? "font-semibold text-neutral-900 dark:text-neutral-50" : "text-neutral-700 dark:text-neutral-300"}`}
                  title={`Filter by ${sender.email}`}
                  data-testid={`sender-${m.id}`}
                >
                  {sender.name || sender.email}
                </button>
              </div>
              <div className="flex items-center gap-1 text-xs">
                <span className={`truncate ${m.unread ? "font-semibold text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-400"}`}>
                  {m.subject}
                </span>
                {(m.labels || []).filter(l => !SYSTEM_LABELS.has(l)).slice(0, 3).map(l => (
                  <span
                    key={l}
                    className="px-1.5 py-0.5 rounded-sm text-[10px] font-medium shrink-0"
                    style={{ backgroundColor: avatarColor(l) + "22", color: avatarColor(l) }}
                    title={l}
                  >
                    {l.replace(/^CATEGORY_/, "").toLowerCase()}
                  </span>
                ))}
                <span className="text-neutral-400 dark:text-neutral-500 truncate">— {m.snippet}</span>
              </div>
            </div>
            <div className="shrink-0 flex items-center">
              {/* Hover-actions overlay the date column, exactly like Gmail. */}
              <div className="hidden group-hover:flex items-center gap-1 pr-1">
                <button
                  onClick={(ev) => { ev.stopPropagation(); onArchive(m.id); }}
                  className="p-1.5 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300"
                  aria-label="Archive"
                  title="Archive (e)"
                  data-testid={`button-archive-${m.id}`}
                >
                  <Archive className="w-4 h-4" />
                </button>
                <button
                  onClick={(ev) => { ev.stopPropagation(); onTrash(m.id); }}
                  className="p-1.5 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300"
                  aria-label="Trash"
                  title="Move to Trash (#)"
                  data-testid={`button-trash-${m.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <span className={`group-hover:hidden text-xs w-14 text-right ${m.unread ? "font-semibold text-neutral-900 dark:text-neutral-100" : "text-neutral-500"}`}>
                {m.date ? fmtDateShort(m.date) : ""}
              </span>
            </div>
          </li>
        );
      })}
      </ul>
    </div>
  );
}

// Gmail system label ids that we hide from the row chip strip (INBOX/UNREAD
// etc. are covered by the styling; category labels + IMPORTANT etc. are
// distracting when shown on every row).
const SYSTEM_LABELS = new Set([
  "INBOX", "UNREAD", "STARRED", "IMPORTANT", "SENT", "DRAFT", "TRASH", "SPAM", "CHAT",
  "CATEGORY_PERSONAL", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS",
]);

function GmailDetail({
  detail, onBack, onReply, onReplyAll, onForward, onArchive, onTrash, onMarkUnread, onToggleStar, starred, onSnooze,
  onDownloadAttachment, onPreviewAttachment, onOpenThread, onFileToJob, jobLinks, onUnlinkJob, labels, onAddLabel, onRemoveLabel,
  onSpam, onNotSpam, onMoveTo, onFilterSender, inline, onInlineReplyOpen,
  inlineReplyText, onInlineReplyChange, onInlineReplySend, onInlineReplyCancel, inlineReplyPending,
}: {
  detail: any;
  onBack: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onMarkUnread: () => void;
  onToggleStar: () => void;
  starred: boolean;
  onDownloadAttachment: (att: { attachmentId: string; filename: string; mimeType: string }) => void;
  onPreviewAttachment?: (att: { attachmentId: string; filename: string; mimeType: string }) => void;
  onSnooze: () => void;
  onOpenThread?: () => void;
  onFileToJob?: () => void;
  jobLinks?: Array<{ id: number; jobId: number; jobNumber?: string; customerName?: string }>;
  onUnlinkJob?: (linkId: number) => void;
  labels?: Array<{ id: string; name: string; type: string }>;
  onAddLabel?: (labelId: string) => void;
  onRemoveLabel?: (labelId: string) => void;
  onSpam?: () => void;
  onNotSpam?: () => void;
  onMoveTo?: (labelId: string) => void;
  onFilterSender?: (email: string) => void;
  inline?: { open: boolean; mode: "reply" | "replyAll" };
  onInlineReplyOpen?: (mode: "reply" | "replyAll") => void;
  inlineReplyText?: string;
  onInlineReplyChange?: (v: string) => void;
  onInlineReplySend?: () => void;
  onInlineReplyCancel?: () => void;
  inlineReplyPending?: boolean;
}) {
  const sender = parseSender(detail.from || "");
  const isHtml = /<[a-z][\s\S]*>/i.test(detail.body || "");
  // Trimmed-content toggle: Gmail hides the quoted-history block by default.
  const hasQuote = /class="gmail_quote"/.test(detail.body || "") || /^&gt;|^>/m.test(detail.body || "");
  const [showQuoted, setShowQuoted] = useState(false);
  // Split HTML at the quote block for the trim toggle. Only used when the body
  // actually contains a Gmail-style quote wrapper.
  const { visible, quoted } = (() => {
    if (!isHtml || !hasQuote) return { visible: detail.body || "", quoted: "" };
    const src = String(detail.body || "");
    const idx = src.search(/<(?:div|blockquote)[^>]*(?:gmail_quote|class="gmail_quote")/i);
    if (idx < 0) return { visible: src, quoted: "" };
    return { visible: src.slice(0, idx), quoted: src.slice(idx) };
  })();
  // Trash on Spam is Gmail's own behavior: user is in SPAM folder.
  const isInSpam = (detail.labels || []).includes("SPAM");
  // Inline images (referenced from HTML with cid:) are already visible in the
  // body. Skip them in the chip strip so we don't double-show them; keep
  // inline PDFs and other non-image inlines around because most HTML bodies
  // don't actually render those.
  const attachments: Array<{
    attachmentId: string; filename: string; mimeType: string; size: number; inline?: boolean;
  }> = (detail.attachments || []).filter((a: any) => !(a.inline && /^image\//i.test(a.mimeType)));
  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Action bar */}
      <div className="flex items-center gap-1 mb-4 -ml-2">
        <button
          onClick={onBack}
          className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300 md:hidden"
          aria-label="Back to list"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          data-testid="button-archive-detail"
          onClick={onArchive}
          className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
          aria-label="Archive"
          title="Archive (e)"
        >
          <Archive className="w-4 h-4" />
        </button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              data-testid="button-trash-detail"
              className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
              aria-label="Move to Trash"
              title="Move to Trash (#)"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Move this message to Trash?</AlertDialogTitle>
              <AlertDialogDescription>
                Gmail keeps trashed messages for about 30 days before deleting them permanently.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onTrash}>Move to Trash</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <button
          data-testid="button-mark-unread"
          onClick={onMarkUnread}
          className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
          aria-label="Mark as unread"
          title="Mark as unread"
        >
          <MailOpen className="w-4 h-4" />
        </button>
        <button
          data-testid="button-snooze-detail"
          onClick={onSnooze}
          className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
          aria-label="Snooze"
          title="Snooze"
        >
          <Clock className="w-4 h-4" />
        </button>
        <div className="w-px h-6 bg-neutral-200 dark:bg-neutral-800 mx-1" />
        <button
          data-testid="button-reply-top"
          onClick={onReply}
          className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
          aria-label="Reply"
          title="Reply (r)"
        >
          <Reply className="w-4 h-4" />
        </button>
        <button
          data-testid="button-reply-all-top"
          onClick={onReplyAll}
          className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
          aria-label="Reply all"
          title="Reply all (a)"
        >
          <ReplyAll className="w-4 h-4" />
        </button>
        <button
          data-testid="button-forward-top"
          onClick={onForward}
          className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
          aria-label="Forward"
          title="Forward (f)"
        >
          <Forward className="w-4 h-4" />
        </button>
        {onOpenThread && detail.threadId && (
          <button
            onClick={onOpenThread}
            className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
            aria-label="View conversation"
            title="View conversation"
          >
            <Mail className="w-4 h-4" />
          </button>
        )}
        {onFileToJob && (
          <button
            onClick={onFileToJob}
            className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
            aria-label="File under job"
            title="File under job"
          >
            <Briefcase className="w-4 h-4" />
          </button>
        )}
        {labels && onAddLabel && labels.filter(l => l.type === "user").length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
                aria-label="Apply label"
                title="Apply label"
              >
                <Tag className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
              {labels.filter(l => l.type === "user").sort((a, b) => a.name.localeCompare(b.name)).map(l => {
                const has = (detail.labels || []).includes(l.id);
                return (
                  <DropdownMenuItem
                    key={l.id}
                    onSelect={() => has ? onRemoveLabel?.(l.id) : onAddLabel(l.id)}
                  >
                    <span className={`inline-block w-3 mr-2 ${has ? "text-[#c5221f]" : "text-neutral-400"}`}>{has ? "✓" : "·"}</span>
                    <span>{l.name}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {/* Move to — apply a label + remove INBOX (Gmail's Move) in one shot. */}
        {labels && onMoveTo && labels.filter(l => l.type === "user").length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
                aria-label="Move to"
                title="Move to"
                data-testid="button-move-to"
              >
                <ArrowLeft className="w-4 h-4 rotate-[-45deg]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-500">Move to label</div>
              {labels.filter(l => l.type === "user").sort((a, b) => a.name.localeCompare(b.name)).map(l => (
                <DropdownMenuItem key={l.id} onSelect={() => onMoveTo(l.id)}>
                  <Tag className="w-3 h-3 mr-2 text-neutral-500" />
                  <span>{l.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {/* Spam / not-spam — different button depending on where we are. */}
        {onSpam && !isInSpam && (
          <button
            data-testid="button-report-spam"
            onClick={onSpam}
            className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
            aria-label="Report spam"
            title="Report spam"
          >
            <AlertTriangle className="w-4 h-4" />
          </button>
        )}
        {onNotSpam && isInSpam && (
          <button
            data-testid="button-not-spam"
            onClick={onNotSpam}
            className="px-2 h-8 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs text-neutral-700 dark:text-neutral-200"
            title="Not spam — move to Inbox"
          >
            Not spam
          </button>
        )}
      </div>

      {/* Job link chips + tracker warning */}
      {(jobLinks && jobLinks.length > 0) && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {jobLinks.map(l => (
            <span key={l.id} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900/50">
              <Briefcase className="w-3 h-3" />
              Filed under Job {l.jobNumber || `#${l.jobId}`}{l.customerName ? ` · ${l.customerName}` : ""}
              {onUnlinkJob && (
                <button onClick={() => onUnlinkJob(l.id)} className="ml-1 opacity-60 hover:opacity-100" aria-label="Unlink">
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {detail.hasTracker && (
        <div className="mb-3 inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/50">
          <AlertTriangle className="w-3.5 h-3.5" />
          This message contains a tracking pixel.
        </div>
      )}

      <div className="flex items-start justify-between gap-4 mb-4">
        <h1
          data-testid="text-gmail-subject"
          className="text-2xl font-normal text-neutral-800 dark:text-neutral-100 leading-tight"
        >
          {detail.subject}
        </h1>
        <button
          data-testid="button-star-detail"
          onClick={onToggleStar}
          className="p-1 shrink-0"
          aria-label={starred ? "Unstar" : "Star"}
        >
          <Star
            className={`w-5 h-5 ${starred ? "text-amber-500 fill-amber-500" : "text-neutral-400 hover:text-neutral-600"}`}
          />
        </button>
      </div>

      <div className="flex items-start gap-3 pb-4 border-b">
        <div
          className="w-10 h-10 rounded-full shrink-0 grid place-items-center text-sm font-medium text-white"
          style={{ backgroundColor: avatarColor(sender.email || sender.name) }}
          aria-hidden
        >
          {initials(sender.name || sender.email)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <button
              type="button"
              onClick={() => onFilterSender?.(sender.email)}
              className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 hover:underline"
              title={sender.email ? `Filter by ${sender.email}` : sender.name}
              data-testid="button-filter-sender"
            >{sender.name}</button>
            {sender.email !== sender.name && (
              <button
                type="button"
                onClick={() => onFilterSender?.(sender.email)}
                className="text-xs text-neutral-500 hover:underline"
                title={`Filter by ${sender.email}`}
              >&lt;{sender.email}&gt;</button>
            )}
            <span className="ml-auto text-xs text-neutral-500">{detail.date ? fmtDateShort(detail.date) : ""}</span>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">to {detail.to}</p>
        </div>
      </div>

      <div className="py-6">
        {isHtml ? (
          <>
            <div
              className="text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed break-words [&_a]:text-[#1a73e8] [&_a]:underline [&_img]:max-w-full [&_img]:h-auto"
              dangerouslySetInnerHTML={{ __html: visible }}
            />
            {quoted && (
              <div className="mt-2">
                {!showQuoted ? (
                  <button
                    type="button"
                    onClick={() => setShowQuoted(true)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200 text-xs"
                    title="Show trimmed content"
                    data-testid="button-show-trimmed"
                  >…</button>
                ) : (
                  <div
                    className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed break-words border-l-2 border-neutral-200 dark:border-neutral-800 pl-3 [&_a]:text-[#1a73e8] [&_a]:underline [&_img]:max-w-full [&_img]:h-auto"
                    dangerouslySetInnerHTML={{ __html: quoted }}
                  />
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap leading-relaxed break-words font-normal">
            {detail.body || ""}
          </div>
        )}
      </div>

      {/* Attachment chip strip — Gmail-style. Each chip is clickable and
           downloads the file through the /attachments endpoint. */}
      {attachments.length > 0 && (
        <div className="border-t pt-4">
          <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2 flex items-center gap-1.5">
            <Paperclip className="w-3.5 h-3.5" />
            {attachments.length} attachment{attachments.length === 1 ? "" : "s"}
          </p>
          <div className="flex flex-wrap gap-2">
            {attachments.map((a) => {
              const canPreview = !!onPreviewAttachment && (
                (a.mimeType || "").startsWith("image/") ||
                (a.mimeType || "").includes("pdf") ||
                (a.filename || "").toLowerCase().match(/\.(png|jpe?g|gif|webp|svg|pdf)$/i)
              );
              return (
                <div
                  key={a.attachmentId}
                  className="group flex items-center gap-2 px-3 py-2 rounded-lg border bg-neutral-50 dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800 min-w-[220px] max-w-[320px]"
                >
                  <button
                    type="button"
                    onClick={(ev) => {
                      // Ctrl/Cmd-click: force download regardless of type.
                      if (ev.metaKey || ev.ctrlKey || !canPreview) {
                        onDownloadAttachment(a);
                      } else {
                        onPreviewAttachment!(a);
                      }
                    }}
                    data-testid={`attachment-${a.attachmentId}`}
                    className="flex-1 flex items-center gap-2 text-left min-w-0"
                    title={canPreview ? `Preview ${a.filename} (⌘-click to download)` : `Download ${a.filename}`}
                  >
                    <div className="w-9 h-9 rounded-md bg-neutral-200 dark:bg-neutral-800 grid place-items-center shrink-0">
                      <FileIcon className="w-4 h-4 text-neutral-600 dark:text-neutral-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-neutral-800 dark:text-neutral-100 truncate">{a.filename}</p>
                      <p className="text-[11px] text-neutral-500 truncate">
                        {a.size ? formatBytes(a.size) : ""}
                        {a.size && a.mimeType ? " · " : ""}
                        {a.mimeType?.split("/")[1]?.toUpperCase() || a.mimeType}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDownloadAttachment(a)}
                    className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 opacity-0 group-hover:opacity-100 shrink-0"
                    title="Download"
                    aria-label="Download"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Inline reply — Gmail's default reply UI stays in the reading pane.
           Only rendered when the parent opts into inlineReply mode. */}
      {inline?.open ? (
        <div className="pt-4 border-t">
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3 bg-white dark:bg-neutral-900">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-neutral-500">
                {inline.mode === "replyAll" ? "Reply all to" : "Reply to"} {sender.name || sender.email}
              </span>
              <button
                type="button"
                onClick={onInlineReplyCancel}
                className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500"
                aria-label="Close reply"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <Textarea
              data-testid="input-inline-reply"
              value={inlineReplyText || ""}
              onChange={(e) => onInlineReplyChange?.(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  onInlineReplySend?.();
                }
              }}
              placeholder="Type your reply… (⌘↵ to send)"
              className="min-h-[100px] text-sm"
            />
            <div className="flex items-center gap-2 mt-2">
              <Button
                data-testid="button-inline-reply-send"
                onClick={onInlineReplySend}
                disabled={inlineReplyPending || !(inlineReplyText || "").trim()}
                className="bg-[#c5221f] hover:bg-[#a01a17] text-white gap-2"
              >
                <Send className="w-4 h-4" />
                {inlineReplyPending ? "Sending…" : "Send"}
              </Button>
              <span className="text-xs text-neutral-500">⌘↵ to send</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="pt-4 border-t flex flex-wrap gap-2">
          <Button
            data-testid="button-reply-bottom"
            variant="outline"
            onClick={() => onInlineReplyOpen ? onInlineReplyOpen("reply") : onReply()}
            className="gap-2 rounded-full border-neutral-300 dark:border-neutral-700"
          >
            <Reply className="w-4 h-4" /> Reply
          </Button>
          <Button
            data-testid="button-reply-all-bottom"
            variant="outline"
            onClick={() => onInlineReplyOpen ? onInlineReplyOpen("replyAll") : onReplyAll()}
            className="gap-2 rounded-full border-neutral-300 dark:border-neutral-700"
          >
            <ReplyAll className="w-4 h-4" /> Reply all
          </Button>
          <Button
            data-testid="button-forward-bottom"
            variant="outline"
            onClick={onForward}
            className="gap-2 rounded-full border-neutral-300 dark:border-neutral-700"
          >
            <Forward className="w-4 h-4" /> Forward
          </Button>
        </div>
      )}
    </div>
  );
}

// Fallback (non-live-Gmail) list, styled to match.
function LegacyList({
  emails, folder, selectedId, onOpen,
}: {
  emails: Email[];
  folder: string;
  selectedId: number | null;
  onOpen: (id: number) => void;
}) {
  if (emails.length === 0) {
    return (
      <div className="h-full grid place-items-center">
        <p className="text-sm text-neutral-500">No emails in {folder}.</p>
      </div>
    );
  }
  return (
    <ul className="flex-1 overflow-y-auto" role="list">
      {emails.map(email => {
        const sender = parseSender(folder === "sent" ? email.to : email.from);
        const active = email.id === selectedId;
        return (
          <li
            key={email.id}
            className={`border-b flex items-center gap-2 px-3 h-14 cursor-pointer ${
              active ? "bg-[#c2dbff] dark:bg-blue-950/40" : !email.read
                ? "bg-white dark:bg-neutral-950 hover:bg-neutral-100 dark:hover:bg-neutral-900 shadow-[inset_2px_0_0_0_#c5221f]"
                : "bg-neutral-50/60 dark:bg-neutral-900/40 hover:bg-neutral-100 dark:hover:bg-neutral-900"
            }`}
            onClick={() => onOpen(email.id)}
            data-testid={`email-row-${email.id}`}
          >
            <div
              className="w-8 h-8 rounded-full shrink-0 grid place-items-center text-xs font-medium text-white"
              style={{ backgroundColor: avatarColor(sender.email || sender.name) }}
            >
              {initials(sender.name || sender.email)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className={`text-sm truncate ${!email.read ? "font-semibold" : ""}`}>
                  {sender.name || sender.email}
                </span>
              </div>
              <div className="flex items-center gap-1 text-xs">
                <span className={`truncate ${!email.read ? "font-semibold" : "text-neutral-600"}`}>{email.subject}</span>
                <span className="text-neutral-400 truncate">— {email.body.slice(0, 80)}</span>
              </div>
            </div>
            <span className="shrink-0 text-xs text-neutral-500 w-14 text-right">
              {email.createdAt ? fmtDateShort(email.createdAt) : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function LegacyDetail({
  email, onBack, onReply, onDelete, onOpenInGmail,
}: {
  email: Email;
  onBack: () => void;
  onReply: () => void;
  onDelete: () => void;
  onOpenInGmail?: () => void;
}) {
  const sender = parseSender(email.from);
  return (
    <div className="max-w-4xl mx-auto p-6">
      <button onClick={onBack} className="p-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 md:hidden mb-2" aria-label="Back">
        <ArrowLeft className="w-4 h-4" />
      </button>
      <h1 className="text-2xl font-normal mb-4">{email.subject}</h1>
      <div className="flex items-start gap-3 pb-4 border-b">
        <div
          className="w-10 h-10 rounded-full grid place-items-center text-sm font-medium text-white shrink-0"
          style={{ backgroundColor: avatarColor(sender.email || sender.name) }}
        >
          {initials(sender.name || sender.email)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-semibold">{sender.name}</span>
            {sender.email !== sender.name && <span className="text-xs text-neutral-500">&lt;{sender.email}&gt;</span>}
            <span className="ml-auto text-xs text-neutral-500">{email.createdAt ? fmtDateShort(email.createdAt) : ""}</span>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">to {email.to}</p>
        </div>
      </div>
      <div className="py-6 text-sm whitespace-pre-wrap leading-relaxed break-words">{email.body}</div>
      <div className="pt-4 border-t flex gap-2 flex-wrap">
        <Button variant="outline" onClick={onReply} className="gap-2 rounded-full">
          <Reply className="w-4 h-4" /> Reply
        </Button>
        {onOpenInGmail && (
          <Button variant="outline" onClick={onOpenInGmail} className="gap-2 rounded-full">
            <ExternalLink className="w-4 h-4" /> Reply in Gmail
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="gap-2 rounded-full text-destructive hover:text-destructive">
              <Trash2 className="w-4 h-4" /> Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this email?</AlertDialogTitle>
              <AlertDialogDescription>"{email.subject}" will be permanently removed.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

// ─── ContactSuggestList ─────────────────────────────────────────────────
// Small floating list rendered under a To/Cc/Bcc input when the server
// returns any contact suggestions for the current tail token.
function ContactSuggestList({
  items,
  onPick,
}: {
  items: Array<{ email: string; name: string; source: string }>;
  onPick: (email: string) => void;
}) {
  return (
    <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white dark:bg-neutral-900 border rounded-md shadow-lg max-h-64 overflow-y-auto">
      {items.map((c, i) => (
        <button
          key={`${c.email}-${i}`}
          type="button"
          onMouseDown={(e) => { e.preventDefault(); onPick(c.email); }}
          className="w-full text-left px-3 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2"
        >
          <UserIcon className="w-3.5 h-3.5 text-neutral-400" />
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{c.name || c.email}</div>
            {c.name && <div className="text-xs text-neutral-500 truncate">{c.email}</div>}
          </div>
          <span className="text-[10px] uppercase tracking-wide text-neutral-400">{c.source}</span>
        </button>
      ))}
    </div>
  );
}

// ─── JobPickerDialog ────────────────────────────────────────────────────
// Two-step picker for "Attach from job": pick a recent job, then pick the
// files to attach. Bytes are fetched at attach time, not list time.
export function JobPickerDialog({
  open,
  onOpenChange,
  onAttach,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAttach: (jobId: number, files: Array<{ kind: "document" | "photo"; id: number; filename: string; mimeType: string }>) => void;
}) {
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Recent jobs (top 25 by id desc).
  const jobsQuery = useQuery<any[]>({
    queryKey: ["/api/jobs", { limit: 25 }],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/jobs?limit=25");
      return r.json();
    },
    enabled: open,
  });
  const filesQuery = useQuery<{ files: Array<{ kind: "document" | "photo"; id: number; filename: string; mimeType: string }> }>({
    queryKey: [`/api/jobs/${selectedJobId}/attachable-files`],
    enabled: open && selectedJobId !== null,
  });

  useEffect(() => {
    if (!open) { setSelectedJobId(null); setSelected(new Set()); }
  }, [open]);

  const toggle = (k: string) => setSelected(cur => {
    const n = new Set(cur);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const attach = () => {
    if (selectedJobId === null) return;
    const files = (filesQuery.data?.files || []).filter(f => selected.has(`${f.kind}-${f.id}`));
    onAttach(selectedJobId, files);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Attach from job</DialogTitle>
        </DialogHeader>
        {selectedJobId === null ? (
          <div className="max-h-[400px] overflow-y-auto -mx-6 px-6">
            {jobsQuery.isLoading && <div className="text-sm text-neutral-500 py-4">Loading recent jobs…</div>}
            {(jobsQuery.data || []).map((j: any) => (
              <button
                type="button"
                key={j.id}
                className="w-full text-left px-3 py-2 border-b hover:bg-neutral-50 dark:hover:bg-neutral-900"
                onClick={() => setSelectedJobId(j.id)}
              >
                <div className="text-sm font-medium">{j.jobNumber || `Job #${j.id}`} — {j.customerName || "(no customer)"}</div>
                <div className="text-xs text-neutral-500">{j.address || j.propertyAddress || ""}</div>
              </button>
            ))}
          </div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto -mx-6 px-6">
            <button
              type="button"
              className="text-xs text-neutral-500 hover:text-neutral-800 mb-2"
              onClick={() => setSelectedJobId(null)}
            >← Pick a different job</button>
            {filesQuery.isLoading && <div className="text-sm text-neutral-500 py-4">Loading files…</div>}
            {(filesQuery.data?.files || []).length === 0 && !filesQuery.isLoading && (
              <div className="text-sm text-neutral-500 py-4">This job has no attachable files.</div>
            )}
            {(filesQuery.data?.files || []).map(f => {
              const k = `${f.kind}-${f.id}`;
              return (
                <label key={k} className="flex items-center gap-2 px-3 py-2 border-b hover:bg-neutral-50 dark:hover:bg-neutral-900 cursor-pointer">
                  <Checkbox checked={selected.has(k)} onCheckedChange={() => toggle(k)} />
                  {f.kind === "photo" ? <FileIcon className="w-4 h-4 text-neutral-400" /> : <FileText className="w-4 h-4 text-neutral-400" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{f.filename}</div>
                    <div className="text-xs text-neutral-500">{f.mimeType}</div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {selectedJobId !== null && (
            <Button onClick={attach} disabled={selected.size === 0}>
              Attach {selected.size > 0 ? `(${selected.size})` : ""}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Push C — helper components
// ══════════════════════════════════════════════════════════════════════════

function LabelsManagerDialog({
  open, onOpenChange, labels, onCreate, onRename, onDelete,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  labels: Array<{ id: string; name: string; type: string }>;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const userLabels = labels.filter(l => l.type === "user").sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage labels</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="New label name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) {
                  onCreate(newName.trim());
                  setNewName("");
                }
              }}
            />
            <Button
              onClick={() => { if (newName.trim()) { onCreate(newName.trim()); setNewName(""); } }}
              disabled={!newName.trim()}
              className="bg-[#c5221f] hover:bg-[#a01a17] text-white"
            >Create</Button>
          </div>
          <div className="border rounded max-h-80 overflow-y-auto">
            {userLabels.length === 0 && (
              <div className="p-3 text-sm text-neutral-500">No custom labels yet.</div>
            )}
            {userLabels.map(l => (
              <div key={l.id} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0">
                <Tag className="w-3.5 h-3.5 text-neutral-500" />
                {editingId === l.id ? (
                  <>
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="h-7 text-sm flex-1"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") { onRename(l.id, editingName.trim()); setEditingId(null); } }}
                    />
                    <Button size="sm" variant="ghost" onClick={() => { onRename(l.id, editingName.trim()); setEditingId(null); }}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm">{l.name}</span>
                    <Button size="sm" variant="ghost" onClick={() => { setEditingId(l.id); setEditingName(l.name); }}>Rename</Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700">Delete</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete label “{l.name}”?</AlertDialogTitle>
                          <AlertDialogDescription>Messages tagged with this label will remain in Gmail; only the label is removed.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => onDelete(l.id)} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RulesManagerDialog({
  open, onOpenChange, rules, onSave, onDelete, onRunNow, running,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rules: Array<any>;
  onSave: (rule: any) => void;
  onDelete: (id: number) => void;
  onRunNow: () => void;
  running: boolean;
}) {
  const emptyRule = () => ({
    name: "", matchFrom: "", matchTo: "", matchSubject: "", matchHasWords: "",
    actionAddLabel: "", actionStar: false, actionMarkRead: false, actionArchive: false, enabled: true,
  });
  const [draft, setDraft] = useState<any>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Email rules</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-xs text-neutral-500">Rules run on inbox messages from the last 2 days when triggered manually.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={onRunNow} disabled={running}>
                <Play className="w-3.5 h-3.5 mr-1" /> {running ? "Running…" : "Run now"}
              </Button>
              <Button size="sm" onClick={() => setDraft(emptyRule())} className="bg-[#c5221f] hover:bg-[#a01a17] text-white">
                <Plus className="w-3.5 h-3.5 mr-1" /> New rule
              </Button>
            </div>
          </div>

          {draft && (
            <div className="border rounded p-3 space-y-2 bg-neutral-50 dark:bg-neutral-900">
              <div className="flex gap-2">
                <Input placeholder="Rule name (e.g. State Farm claims)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder='From contains… (e.g. "@statefarm.com")' value={draft.matchFrom} onChange={(e) => setDraft({ ...draft, matchFrom: e.target.value })} />
                <Input placeholder="To contains…" value={draft.matchTo} onChange={(e) => setDraft({ ...draft, matchTo: e.target.value })} />
                <Input placeholder='Subject contains… (e.g. "claim")' value={draft.matchSubject} onChange={(e) => setDraft({ ...draft, matchSubject: e.target.value })} />
                <Input placeholder="Body/subject has words…" value={draft.matchHasWords} onChange={(e) => setDraft({ ...draft, matchHasWords: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2 items-center">
                <Input placeholder="Then add label… (creates if missing)" value={draft.actionAddLabel} onChange={(e) => setDraft({ ...draft, actionAddLabel: e.target.value })} />
                <div className="flex flex-wrap gap-3 text-sm">
                  <label className="inline-flex items-center gap-1.5"><Checkbox checked={draft.actionStar} onCheckedChange={(v) => setDraft({ ...draft, actionStar: !!v })} /> Star</label>
                  <label className="inline-flex items-center gap-1.5"><Checkbox checked={draft.actionMarkRead} onCheckedChange={(v) => setDraft({ ...draft, actionMarkRead: !!v })} /> Mark read</label>
                  <label className="inline-flex items-center gap-1.5"><Checkbox checked={draft.actionArchive} onCheckedChange={(v) => setDraft({ ...draft, actionArchive: !!v })} /> Archive</label>
                  <label className="inline-flex items-center gap-1.5"><Checkbox checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: !!v })} /> Enabled</label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
                <Button size="sm" onClick={() => { onSave(draft); setDraft(null); }} disabled={!draft.name.trim()} className="bg-[#c5221f] hover:bg-[#a01a17] text-white">Save</Button>
              </div>
            </div>
          )}

          <div className="border rounded max-h-96 overflow-y-auto">
            {rules.length === 0 && !draft && (
              <div className="p-4 text-sm text-neutral-500 text-center">No rules yet. Click New rule to create one.</div>
            )}
            {rules.map((r: any) => (
              <div key={r.id} className="px-3 py-2 border-b last:border-b-0 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{r.name}</span>
                    {!r.enabled && <span className="text-xs px-1.5 rounded bg-neutral-200 dark:bg-neutral-800 text-neutral-600">Disabled</span>}
                  </div>
                  <div className="text-xs text-neutral-500 truncate">
                    {[r.match_from && `from:${r.match_from}`, r.match_subject && `subject:${r.match_subject}`, r.match_has_words && `has:${r.match_has_words}`].filter(Boolean).join(" • ")}
                    {r.action_add_label && <> → label <b>{r.action_add_label}</b></>}
                    {r.action_star && " · star"}
                    {r.action_mark_read && " · mark read"}
                    {r.action_archive && " · archive"}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setDraft({
                  id: r.id, name: r.name, matchFrom: r.match_from || "", matchTo: r.match_to || "",
                  matchSubject: r.match_subject || "", matchHasWords: r.match_has_words || "",
                  actionAddLabel: r.action_add_label || "", actionStar: !!r.action_star,
                  actionMarkRead: !!r.action_mark_read, actionArchive: !!r.action_archive, enabled: !!r.enabled,
                })}>Edit</Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="text-red-600">Delete</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete rule?</AlertDialogTitle>
                      <AlertDialogDescription>“{r.name}” will no longer run.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => onDelete(r.id)} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ThreadMessage({ msg, defaultOpen }: { msg: any; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const isHtml = /<[a-z][\s\S]*>/i.test(msg.body || "");
  return (
    <div className="border rounded">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-neutral-50 dark:hover:bg-neutral-900"
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{msg.from}</div>
          {!open && <div className="text-xs text-neutral-500 truncate">{msg.snippet}</div>}
        </div>
        {msg.hasTracker && <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />}
        <span className="text-xs text-neutral-500 whitespace-nowrap">{new Date(msg.date).toLocaleString()}</span>
        <ChevronDown className={`w-4 h-4 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 text-sm">
          <div className="text-xs text-neutral-500 mb-2">To: {msg.to}{msg.cc ? ` · Cc: ${msg.cc}` : ""}</div>
          {isHtml ? (
            <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: msg.body }} />
          ) : (
            <pre className="whitespace-pre-wrap font-sans">{msg.body}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function JobLinkPickerBody({ onPick, onCancel }: { onPick: (jobId: number) => void; onCancel: () => void }) {
  const jobsQ = useQuery<{ jobs: Array<any> }>({ queryKey: ["/api/jobs"] });
  const [q, setQ] = useState("");
  const filtered = (jobsQ.data?.jobs || []).filter(j => {
    if (!q) return true;
    const term = q.toLowerCase();
    return String(j.jobNumber || "").toLowerCase().includes(term)
      || String(j.customerName || "").toLowerCase().includes(term)
      || String(j.address || "").toLowerCase().includes(term);
  }).slice(0, 40);
  return (
    <div className="space-y-3">
      <Input placeholder="Search jobs by number, customer, or address…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="border rounded max-h-80 overflow-y-auto">
        {filtered.length === 0 && <div className="p-3 text-sm text-neutral-500">No jobs match.</div>}
        {filtered.map(j => (
          <button
            key={j.id}
            onClick={() => onPick(j.id)}
            className="w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-neutral-50 dark:hover:bg-neutral-900"
          >
            <div className="text-sm font-medium">Job {j.jobNumber} · {j.customerName || "—"}</div>
            <div className="text-xs text-neutral-500 truncate">{j.address || ""}</div>
          </button>
        ))}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </DialogFooter>
    </div>
  );
}
