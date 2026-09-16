import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Plus, Send, Inbox, Send as SendIcon, FileText, Mail, ExternalLink,
  Settings, CheckCircle, Trash2, Link2, LogOut, RefreshCw, Search,
  Star, Archive, MailOpen, ArrowLeft, X, Reply, HelpCircle, Paperclip,
  File as FileIcon, Download,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
  const [folder, setFolder] = useState<"inbox" | "starred" | "sent" | "drafts" | "trash">("inbox");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [gmailSettingsOpen, setGmailSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [compose, setCompose] = useState<{
    to: string;
    subject: string;
    body: string;
    attachments: Array<{ filename: string; mimeType: string; size: number; dataBase64: string }>;
  }>({ to: "", subject: "", body: "", attachments: [] });
  const composeFileRef = useRef<HTMLInputElement | null>(null);
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
  } = useQuery<{ messages: GmailRow[] }>({
    // The committed search query is part of the key so switching between
    // "" and a query re-fetches instead of showing stale results.
    queryKey: ["/api/gmail/messages", gmailLabel, searchQuery],
    queryFn: () => {
      const p = new URLSearchParams({ labelIds: gmailLabel, max: "40" });
      if (searchQuery) p.set("q", searchQuery);
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
  const sendViaGmailLive = useMutation({
    mutationFn: () => apiRequest("POST", "/api/gmail/send", {
      to: compose.to,
      subject: compose.subject,
      body: compose.body,
      attachments: compose.attachments.map(a => ({
        filename: a.filename, mimeType: a.mimeType, dataBase64: a.dataBase64,
      })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      setComposeOpen(false);
      setCompose({ to: "", subject: "", body: "", attachments: [] });
      toast({ title: "Email sent", description: `Delivered via Gmail (${gmailStatus?.email || "your account"})` });
    },
    onError: (e: any) => toast({ title: "Send failed", description: String(e?.message || e), variant: "destructive" }),
  });

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
      const res = await fetch(url, { credentials: "same-origin" });
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
      toast({ title: "Archived" });
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
      toast({ title: "Moved to Trash" });
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
      setCompose({ to: "", subject: "", body: "" });
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
    { id: "inbox",   label: "Inbox",   icon: Inbox },
    { id: "starred", label: "Starred", icon: Star },
    { id: "sent",    label: "Sent",    icon: SendIcon },
    { id: "drafts",  label: "Drafts",  icon: FileText },
    { id: "trash",   label: "Trash",   icon: Trash2 },
  ];

  // ── Keyboard shortcuts (Gmail-style) ─────────────────────────────────
  //   / focus search, j/k next/prev row, Enter open, e archive, # trash,
  //   s star, u back to list, r reply, c compose, ? help.
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      // Ignore when typing in a form field or when a dialog is open.
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (ev.target as HTMLElement | null)?.isContentEditable) return;
      if (composeOpen || gmailSettingsOpen || shortcutsOpen) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

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
          setCompose({ to: fromAddr, subject: `Re: ${row.subject}`, body: "", attachments: [] });
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
              placeholder={gmailLive ? "Search mail  (press / to focus)" : "Search"}
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
            <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
              <DialogTrigger asChild>
                <Button
                  data-testid="button-compose"
                  className="w-full h-12 rounded-2xl bg-[#c5221f] hover:bg-[#a01a17] text-white shadow-sm gap-2 text-sm font-medium"
                >
                  <Plus className="w-4 h-4" /> Compose
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>New Email</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
                    <Mail className="w-3.5 h-3.5" />
                    From: <span className="font-medium text-foreground">{fromAddress}</span>
                    {gmailLive && <Badge variant="secondary" className="ml-auto text-xs">Gmail</Badge>}
                  </div>
                  <div>
                    <Label>To</Label>
                    <Input
                      data-testid="input-email-to"
                      value={compose.to}
                      onChange={e => setCompose(f => ({ ...f, to: e.target.value }))}
                      placeholder="recipient@email.com"
                    />
                  </div>
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
                    <Textarea
                      data-testid="input-email-body"
                      className="min-h-[220px]"
                      value={compose.body}
                      onChange={e => setCompose(f => ({ ...f, body: e.target.value }))}
                    />
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
                  <div className="flex gap-2">
                    {gmailLive ? (
                      <>
                        <Button
                          data-testid="button-send-gmail-live"
                          className="flex-1 bg-[#c5221f] hover:bg-[#a01a17] text-white"
                          onClick={() => sendViaGmailLive.mutate()}
                          disabled={sendViaGmailLive.isPending || !compose.to}
                        >
                          <Send className="w-4 h-4 mr-2" />
                          {sendViaGmailLive.isPending ? "Sending…" : "Send"}
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
                  onClick={() => { setFolder(f.id); setSelectedId(null); setLiveSelectedId(null); }}
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
          {gmailLive ? (
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
                  onReply={() => {
                    const fromAddr = parseSender(liveDetail.from || "").email;
                    setCompose({
                      to: fromAddr,
                      subject: `Re: ${liveDetail.subject}`,
                      body: `\n\nOn ${liveDetail.date}, ${liveDetail.from} wrote:\n> ${(liveDetail.body || "").replace(/<[^>]+>/g, "").split("\n").slice(0, 20).join("\n> ")}`,
                      attachments: [],
                    });
                    setComposeOpen(true);
                  }}
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
                  subject: `Re: ${selected.subject}`,
                  body: `\n\n--- Original Message ---\nFrom: ${selected.from}\n${selected.body}`,
                  attachments: [],
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
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <ShortcutRow k="/" label="Focus search" />
            <ShortcutRow k="c" label="Compose" />
            <ShortcutRow k="j" label="Next conversation" />
            <ShortcutRow k="k" label="Previous conversation" />
            <ShortcutRow k="Enter" label="Open (from list)" />
            <ShortcutRow k="u" label="Back to list" />
            <ShortcutRow k="r" label="Reply" />
            <ShortcutRow k="s" label="Toggle star" />
            <ShortcutRow k="e" label="Archive" />
            <ShortcutRow k="#" label="Move to Trash" />
            <ShortcutRow k="?" label="This help" />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Shortcuts are ignored while you're typing in a field or a dialog is open.
          </p>
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
}) {
  if (loading) {
    return (
      <div className="p-3 space-y-3">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="space-y-1.5 animate-pulse">
            <div className="h-3 bg-neutral-200 dark:bg-neutral-800 rounded w-2/3" />
            <div className="h-2.5 bg-neutral-200 dark:bg-neutral-800 rounded w-full" />
          </div>
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
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
    );
  }
  return (
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
                <span
                  className={`text-sm truncate ${m.unread ? "font-semibold text-neutral-900 dark:text-neutral-50" : "text-neutral-700 dark:text-neutral-300"}`}
                >
                  {sender.name || sender.email}
                </span>
              </div>
              <div className="flex items-center gap-1 text-xs">
                <span className={`truncate ${m.unread ? "font-semibold text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-400"}`}>
                  {m.subject}
                </span>
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
  );
}

function GmailDetail({
  detail, onBack, onReply, onArchive, onTrash, onMarkUnread, onToggleStar, starred,
  onDownloadAttachment,
}: {
  detail: any;
  onBack: () => void;
  onReply: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onMarkUnread: () => void;
  onToggleStar: () => void;
  starred: boolean;
  onDownloadAttachment: (att: { attachmentId: string; filename: string; mimeType: string }) => void;
}) {
  const sender = parseSender(detail.from || "");
  const isHtml = /<[a-z][\s\S]*>/i.test(detail.body || "");
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
      </div>

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
            <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{sender.name}</span>
            {sender.email !== sender.name && (
              <span className="text-xs text-neutral-500">&lt;{sender.email}&gt;</span>
            )}
            <span className="ml-auto text-xs text-neutral-500">{detail.date ? fmtDateShort(detail.date) : ""}</span>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">to {detail.to}</p>
        </div>
      </div>

      <div className="py-6">
        {isHtml ? (
          <div
            className="text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed break-words [&_a]:text-[#1a73e8] [&_a]:underline [&_img]:max-w-full [&_img]:h-auto"
            dangerouslySetInnerHTML={{ __html: detail.body || "" }}
          />
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
            {attachments.map((a) => (
              <button
                key={a.attachmentId}
                data-testid={`attachment-${a.attachmentId}`}
                onClick={() => onDownloadAttachment(a)}
                className="group flex items-center gap-2 px-3 py-2 rounded-lg border bg-neutral-50 dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-left min-w-[220px] max-w-[320px]"
                title={`Download ${a.filename}`}
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
                <Download className="w-4 h-4 text-neutral-500 opacity-0 group-hover:opacity-100 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="pt-4 border-t">
        <Button
          data-testid="button-reply-bottom"
          variant="outline"
          onClick={onReply}
          className="gap-2 rounded-full border-neutral-300 dark:border-neutral-700"
        >
          <Reply className="w-4 h-4" /> Reply
        </Button>
      </div>
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
