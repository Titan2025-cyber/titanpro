import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Send, Inbox, Send as SendIcon, FileText, Mail, ExternalLink, User, Settings, CheckCircle, Trash2, Link2, LogOut, RefreshCw } from "lucide-react";
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

interface Employee {
  id: number;
  name: string;
  role: string;
  gmailEmail: string | null;
  phone: string | null;
}

export default function EmailPage() {
  const [folder, setFolder] = useState("inbox");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [gmailSettingsOpen, setGmailSettingsOpen] = useState(false);
  const [compose, setCompose] = useState({ to: "", subject: "", body: "" });
  const [gmailInput, setGmailInput] = useState("");
  const [liveSelectedId, setLiveSelectedId] = useState<string | null>(null);
  const { toast } = useToast();
  // The Email page is ALWAYS scoped to the signed-in user — you cannot
  // "send as" or read another employee's mail from this UI. Owner / admin can
  // still manage other people's Gmail linkage from the User Management page.
  const { user: authUser } = useAuth();
  const activeEmployee = authUser?.name || "";
  const isPrivileged = !!authUser && ["owner", "admin", "general_manager"].includes(String(authUser.role));

  // ── Live Gmail (OAuth) status for the SIGNED-IN user ──────────────────────
  // configured = server has GOOGLE_CLIENT_ID/SECRET; connected = this user linked
  // their Google account. When not configured/connected, the page behaves exactly
  // as before (simulated mailbox + new-tab hand-off).
  const { data: gmailStatus } = useQuery<{ configured: boolean; connected: boolean; email: string | null }>({
    queryKey: ["/api/gmail/status"],
    queryFn: () => apiRequest("GET", "/api/gmail/status").then(r => r.json()),
  });
  const gmailLive = !!(gmailStatus?.configured && gmailStatus?.connected);

  // Live Gmail inbox — only queried when the signed-in user is truly connected.
  const gmailLabel = folder === "sent" ? "SENT" : folder === "drafts" ? "DRAFT" : "INBOX";
  const { data: gmailData, isLoading: gmailLoading, refetch: refetchGmail } = useQuery<{ messages: any[] }>({
    queryKey: ["/api/gmail/messages", gmailLabel],
    queryFn: () => apiRequest("GET", `/api/gmail/messages?labelIds=${gmailLabel}&max=25`).then(r => r.json()),
    enabled: gmailLive,
  });
  const liveMessages = gmailData?.messages || [];

  // Full body of the opened live message.
  const { data: liveDetail, isLoading: liveDetailLoading } = useQuery<any>({
    queryKey: ["/api/gmail/messages", liveSelectedId],
    queryFn: () => apiRequest("GET", `/api/gmail/messages/${liveSelectedId}`).then(r => r.json()),
    enabled: gmailLive && !!liveSelectedId,
  });

  // Connect Gmail — opens the Google consent screen in a popup, then refreshes.
  const connectGmail = async () => {
    try {
      const res = await apiRequest("GET", "/api/gmail/oauth/start");
      const { authUrl, error } = await res.json();
      if (error || !authUrl) { toast({ title: "Cannot connect", description: error || "No auth URL returned.", variant: "destructive" }); return; }
      const popup = window.open(authUrl, "gmail_oauth", "width=520,height=680");
      // Poll for the popup closing, then refresh status/messages.
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
      setSelectedId(null);
      toast({ title: "Gmail disconnected" });
    },
  });

  // Send a REAL email through the connected Gmail account (in-app, no new tab).
  const sendViaGmailLive = useMutation({
    mutationFn: () => apiRequest("POST", "/api/gmail/send", { to: compose.to, subject: compose.subject, body: compose.body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/messages"] });
      setComposeOpen(false);
      setCompose({ to: "", subject: "", body: "" });
      toast({ title: "Email sent", description: `Delivered via Gmail (${gmailStatus?.email || "your account"})` });
    },
    onError: (e: any) => toast({ title: "Send failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const { data: emails = [] } = useQuery<Email[]>({
    queryKey: ["/api/emails", folder],
    queryFn: () => apiRequest("GET", `/api/emails?folder=${folder}`).then(r => r.json()),
  });

  // Only owner/admin need the full employee list (for the User Management
  // handoff link in the settings dialog). Regular users never fetch it — they
  // don't need it and shouldn't see everyone else's linked Gmail addresses.
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
    enabled: isPrivileged,
  });

  // The "current employee" for this page is always the signed-in user.
  // We fetch just their own record so we can read gmailEmail without
  // pulling every employee.
  const { data: myRecord } = useQuery<Employee>({
    queryKey: ["/api/employees", authUser?.id],
    queryFn: () => apiRequest("GET", `/api/employees/${authUser!.id}`).then(r => r.json()),
    enabled: !!authUser?.id && !isPrivileged,
  });
  const currentEmployee: Employee | undefined = isPrivileged
    ? employees.find(e => e.id === authUser?.id)
    : myRecord;
  const fromAddress = currentEmployee?.gmailEmail || (activeEmployee ? `${activeEmployee.toLowerCase().replace(/\s/g, "")}@titanrestorationllc.com` : "");

  const sendMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/emails", {
      ...compose,
      folder: "sent",
      from: fromAddress,
      read: 1,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/emails"] });
      setComposeOpen(false);
      setCompose({ to: "", subject: "", body: "" });
      toast({ title: "Email sent", description: `Sent from ${fromAddress}` });
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

  // These only ever act on the signed-in user's own record. The server also
  // enforces this: a non-owner/admin cannot PATCH another employee's row.
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
  const unreadCount = emails.filter(e => !e.read && folder === "inbox").length;

  const FOLDERS = [
    { id: "inbox", label: "Inbox", icon: Inbox },
    { id: "sent", label: "Sent", icon: SendIcon },
    { id: "drafts", label: "Drafts", icon: FileText },
  ];

  // Open Gmail compose in new tab
  const openInGmail = () => {
    if (!currentEmployee?.gmailEmail) return;
    const params = new URLSearchParams({
      view: "cm",
      to: compose.to,
      su: compose.subject,
      body: compose.body,
    });
    window.open(`https://mail.google.com/mail/u/0/?${params.toString()}`, "_blank");
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-0 rounded-xl overflow-hidden border">
      {/* Sidebar */}
      <div className="w-52 shrink-0 bg-[hsl(220,20%,12%)] text-white flex flex-col">
        {/* Signed-in identity — fixed. This page never allows "sending as"
            another employee. Each user only sees their own mailbox. */}
        <div className="px-3 py-3 border-b border-white/10">
          <p className="font-bold text-xs uppercase tracking-wider opacity-50 mb-2">Signed in as</p>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/10">
            <User className="w-3.5 h-3.5 text-white/70 shrink-0" />
            <span className="text-xs font-medium truncate">{activeEmployee || "—"}</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            {currentEmployee?.gmailEmail ? (
              <>
                <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />
                <span className="text-xs text-green-400 truncate">{currentEmployee.gmailEmail}</span>
              </>
            ) : (
              <span className="text-xs opacity-40 truncate">{fromAddress}</span>
            )}
          </div>
        </div>

        {/* Live Gmail (OAuth) connection — for the signed-in user. Only shown
            once the server is configured with Google credentials. */}
        {gmailStatus?.configured && (
          <div className="px-3 py-3 border-b border-white/10">
            {gmailStatus.connected ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                  <span className="text-xs text-green-400 font-medium">Gmail connected</span>
                </div>
                {gmailStatus.email && <p className="text-[11px] text-white/60 truncate">{gmailStatus.email}</p>}
                <div className="flex gap-1.5">
                  <button
                    data-testid="button-refresh-gmail"
                    onClick={() => refetchGmail()}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] text-white/70 bg-white/10 hover:bg-white/20"
                  >
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                  <button
                    data-testid="button-disconnect-gmail"
                    onClick={() => disconnectGmail.mutate()}
                    disabled={disconnectGmail.isPending}
                    className="flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] text-white/70 bg-white/10 hover:bg-white/20"
                  >
                    <LogOut className="w-3 h-3" /> Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <button
                data-testid="button-connect-gmail"
                onClick={connectGmail}
                className="w-full flex items-center justify-center gap-2 px-2 py-2 rounded text-xs font-semibold bg-white text-[hsl(220,20%,12%)] hover:bg-white/90"
              >
                <Link2 className="w-3.5 h-3.5" /> Connect Gmail
              </button>
            )}
          </div>
        )}

        {/* Gmail Settings — always visible, always scoped to YOU. */}
        <div className="px-3 py-2 border-b border-white/10">
          <Dialog open={gmailSettingsOpen} onOpenChange={(o) => { setGmailSettingsOpen(o); if (o) setGmailInput(currentEmployee?.gmailEmail || ""); }}>
            <DialogTrigger asChild>
              <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-white/60 hover:bg-white/10 hover:text-white text-left">
                <Settings className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs">My Gmail Settings</span>
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5 text-[hsl(var(--titan-red))]" />
                  Link My Gmail — {activeEmployee}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="bg-muted/50 rounded-lg p-3 text-sm text-muted-foreground">
                  Linking a Gmail address lets Titan Pro display the correct sender address and opens Gmail compose when you choose "Send via Gmail". Your emails are composed here and sent through your real Gmail account.
                </div>

                {currentEmployee?.gmailEmail && (
                  <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                    <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Linked Gmail</p>
                      <p className="text-xs text-muted-foreground truncate">{currentEmployee.gmailEmail}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
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
                  <p className="text-xs text-muted-foreground">Enter YOUR Gmail address. Only you can see and use it here.</p>
                </div>

                <div className="flex gap-2">
                  <Button
                    data-testid="button-link-gmail"
                    className="flex-1 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
                    onClick={() => linkGmailMutation.mutate()}
                    disabled={!gmailInput || linkGmailMutation.isPending}
                  >
                    {linkGmailMutation.isPending ? "Saving…" : "Link Gmail Address"}
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => window.open("https://mail.google.com", "_blank")}
                  >
                    <ExternalLink className="w-4 h-4" /> Open Gmail
                  </Button>
                </div>

                {/* Team-wide Gmail linkage lives in User Management (owner/admin
                    only). We deliberately do NOT list other employees' Gmail
                    addresses here — that would leak private linkage data. */}
                {isPrivileged && (
                  <div className="border-t pt-4">
                    <p className="text-xs text-muted-foreground">
                      Managing other team members? Open <span className="font-medium">Settings → User Management</span> to see and change each employee's Gmail linkage.
                    </p>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Compose + folders */}
        <div className="flex-1 py-2 px-2 overflow-y-auto">
          <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
            <DialogTrigger asChild>
              <Button
                data-testid="button-compose"
                className="w-full mb-3 bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white text-xs h-8"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />Compose
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
                  {currentEmployee?.gmailEmail && (
                    <Badge variant="secondary" className="ml-auto text-xs">Gmail</Badge>
                  )}
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
                    className="min-h-[200px]"
                    value={compose.body}
                    onChange={e => setCompose(f => ({ ...f, body: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2">
                  {gmailLive ? (
                    <>
                      {/* Connected: send the REAL email in-app via Gmail. */}
                      <Button
                        data-testid="button-send-gmail-live"
                        className="flex-1 bg-[hsl(var(--titan-red))] text-white"
                        onClick={() => sendViaGmailLive.mutate()}
                        disabled={sendViaGmailLive.isPending || !compose.to}
                      >
                        <Send className="w-4 h-4 mr-2" />
                        {sendViaGmailLive.isPending ? "Sending…" : "Send via Gmail"}
                      </Button>
                      <Button
                        data-testid="button-send-email"
                        variant="outline"
                        onClick={() => sendMutation.mutate()}
                        disabled={sendMutation.isPending}
                        title="Save an internal copy without sending through Gmail"
                      >
                        {sendMutation.isPending ? "Saving…" : "Save Internal"}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        data-testid="button-send-email"
                        className="flex-1 bg-[hsl(var(--titan-red))] text-white"
                        onClick={() => sendMutation.mutate()}
                        disabled={sendMutation.isPending}
                      >
                        <Send className="w-4 h-4 mr-2" />
                        {sendMutation.isPending ? "Sending…" : "Send (Internal)"}
                      </Button>
                      {currentEmployee?.gmailEmail && (
                        <Button
                          data-testid="button-send-gmail"
                          variant="outline"
                          className="gap-2 border-[hsl(var(--titan-blue))] text-[hsl(var(--titan-blue))]"
                          onClick={openInGmail}
                        >
                          <ExternalLink className="w-4 h-4" />
                          Send via Gmail
                        </Button>
                      )}
                    </>
                  )}
                </div>
                {!currentEmployee?.gmailEmail && !gmailLive && (
                  <p className="text-xs text-muted-foreground text-center">
                    <button
                      className="underline text-[hsl(var(--titan-blue))]"
                      onClick={() => { setComposeOpen(false); setGmailSettingsOpen(true); }}
                    >
                      Link your Gmail
                    </button>
                    {" "}to send from your real Gmail account.
                  </p>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {FOLDERS.map(f => (
            <button
              key={f.id}
              data-testid={`nav-folder-${f.id}`}
              onClick={() => { setFolder(f.id); setSelectedId(null); }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left ${folder === f.id ? "bg-white/20 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"}`}
            >
              <f.icon className="w-3.5 h-3.5 shrink-0" />{f.label}
              {f.id === "inbox" && unreadCount > 0 && (
                <span className="ml-auto bg-[hsl(var(--titan-red))] text-white text-xs rounded-full px-1.5 py-0.5 leading-none">{unreadCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Email list */}
      {gmailLive ? (
        <div className={`${liveSelectedId ? "hidden md:flex" : "flex"} flex-col w-72 shrink-0 border-r overflow-y-auto`}>
          {gmailLoading && (
            <div className="p-3 space-y-3">
              {[0,1,2,3].map(i => (
                <div key={i} className="space-y-1.5 animate-pulse">
                  <div className="h-3 bg-muted rounded w-2/3" />
                  <div className="h-2.5 bg-muted rounded w-full" />
                  <div className="h-2.5 bg-muted rounded w-1/2" />
                </div>
              ))}
            </div>
          )}
          {!gmailLoading && liveMessages.map((m: any) => (
            <button
              key={m.id}
              data-testid={`gmail-row-${m.id}`}
              onClick={() => setLiveSelectedId(m.id)}
              className={`text-left p-3 border-b hover:bg-muted/50 transition-colors ${liveSelectedId === m.id ? "bg-muted" : ""} ${m.unread ? "bg-[hsl(var(--titan-blue)/0.05)]" : ""}`}
            >
              <div className="flex items-center gap-2">
                {m.unread && folder === "inbox" && <div className="w-2 h-2 rounded-full bg-[hsl(var(--titan-blue))] shrink-0" />}
                <p className={`text-sm truncate ${m.unread ? "font-bold" : "font-medium"}`}>
                  {folder === "sent" ? m.to : m.from}
                </p>
              </div>
              <p className="text-xs font-medium truncate mt-0.5">{m.subject}</p>
              <p className="text-xs text-muted-foreground truncate">{(m.snippet || "").slice(0, 60)}…</p>
              <p className="text-xs text-muted-foreground mt-1">{m.date ? fmtDateShort(m.date) : ""}</p>
            </button>
          ))}
          {!gmailLoading && liveMessages.length === 0 && <p className="text-sm text-muted-foreground text-center p-8">No messages in {folder}.</p>}
        </div>
      ) : (
      <div className={`${selected ? "hidden md:flex" : "flex"} flex-col w-72 shrink-0 border-r overflow-y-auto`}>
        {emails.map(email => (
          <button
            key={email.id}
            data-testid={`email-row-${email.id}`}
            onClick={() => { setSelectedId(email.id); if (!email.read) markRead.mutate(email.id); }}
            className={`text-left p-3 border-b hover:bg-muted/50 transition-colors ${selectedId === email.id ? "bg-muted" : ""} ${!email.read ? "bg-[hsl(var(--titan-blue)/0.05)]" : ""}`}
          >
            <div className="flex items-center gap-2">
              {!email.read && folder === "inbox" && <div className="w-2 h-2 rounded-full bg-[hsl(var(--titan-blue))] shrink-0" />}
              <p className={`text-sm truncate ${!email.read ? "font-bold" : "font-medium"}`}>
                {folder === "sent" ? email.to : email.from}
              </p>
            </div>
            <p className="text-xs font-medium truncate mt-0.5">{email.subject}</p>
            <p className="text-xs text-muted-foreground truncate">{email.body.slice(0, 60)}…</p>
            <p className="text-xs text-muted-foreground mt-1">{email.createdAt ? fmtDateShort(email.createdAt) : ""}</p>
          </button>
        ))}
        {emails.length === 0 && <p className="text-sm text-muted-foreground text-center p-8">No emails.</p>}
      </div>
      )}

      {/* Email detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {gmailLive ? (
          liveSelectedId ? (
            liveDetailLoading ? (
              <div className="space-y-3 animate-pulse max-w-2xl">
                <div className="h-5 bg-muted rounded w-1/2" />
                <div className="h-3 bg-muted rounded w-1/3" />
                <div className="h-40 bg-muted rounded w-full mt-4" />
              </div>
            ) : liveDetail ? (
              <div>
                <Button variant="ghost" size="sm" className="mb-4 md:hidden" onClick={() => setLiveSelectedId(null)}>← Back</Button>
                <h2 className="text-lg font-bold mb-1" data-testid="text-gmail-subject">{liveDetail.subject}</h2>
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground mb-4">
                  <span>From: {liveDetail.from}</span>
                  <span>To: {liveDetail.to}</span>
                  <span>{liveDetail.date ? fmtDateShort(liveDetail.date) : ""}</span>
                </div>
                <div className="border-t pt-4">
                  {/* Body may be plain text or HTML from Gmail. Render EITHER an
                      HTML div OR a plain-text div — never both props on one node. */}
                  {/<[a-z][\s\S]*>/i.test(liveDetail.body || "") ? (
                    <div
                      className="text-sm text-foreground leading-relaxed break-words"
                      dangerouslySetInnerHTML={{ __html: liveDetail.body || "" }}
                    />
                  ) : (
                    <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed break-words">
                      {liveDetail.body || ""}
                    </div>
                  )}
                </div>
                <div className="mt-6 flex gap-2">
                  <Button
                    data-testid="button-reply-gmail-live"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const fromAddr = (liveDetail.from || "").match(/<(.+?)>/)?.[1] || liveDetail.from || "";
                      setCompose({ to: fromAddr, subject: `RE: ${liveDetail.subject}`, body: `\n\n--- Original Message ---\nFrom: ${liveDetail.from}\n${(liveDetail.body || "").replace(/<[^>]+>/g, "")}` });
                      setComposeOpen(true);
                    }}
                  >
                    Reply
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground mt-20"><p>Could not load this message.</p></div>
            )
          ) : (
            <div className="text-center text-muted-foreground mt-20">
              <Inbox className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>Select a message to read</p>
              <p className="text-xs mt-2 text-green-600">Live Gmail — {gmailStatus?.email}</p>
            </div>
          )
        ) : selected ? (
          <div>
            <Button variant="ghost" size="sm" className="mb-4 md:hidden" onClick={() => setSelectedId(null)}>← Back</Button>
            <h2 className="text-lg font-bold mb-1">{selected.subject}</h2>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground mb-4">
              <span>From: {selected.from}</span>
              <span>To: {selected.to}</span>
              <span>{selected.createdAt ? fmtDateShort(selected.createdAt) : ""}</span>
            </div>
            <div className="border-t pt-4">
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{selected.body}</p>
            </div>
            <div className="mt-6 flex gap-2">
              <Button
                data-testid="button-reply"
                variant="outline"
                size="sm"
                onClick={() => {
                  setCompose({ to: selected.from, subject: `RE: ${selected.subject}`, body: `\n\n--- Original Message ---\nFrom: ${selected.from}\n${selected.body}` });
                  setComposeOpen(true);
                }}
              >
                Reply
              </Button>
              {currentEmployee?.gmailEmail && (
                <Button
                  data-testid="button-reply-gmail"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-[hsl(var(--titan-blue))]"
                  onClick={() => {
                    const params = new URLSearchParams({
                      view: "cm",
                      to: selected.from,
                      su: `RE: ${selected.subject}`,
                      body: `\n\n--- Original ---\n${selected.body}`,
                    });
                    window.open(`https://mail.google.com/mail/u/0/?${params.toString()}`, "_blank");
                  }}
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Reply in Gmail
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button data-testid={`button-delete-email-${selected.id}`} variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive">
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this email?</AlertDialogTitle>
                    <AlertDialogDescription>"{selected.subject}" will be permanently removed and cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteEmail.mutate(selected.id)} data-testid={`button-confirm-delete-email-${selected.id}`}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ) : (
          <div className="text-center text-muted-foreground mt-20">
            <Inbox className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p>Select an email to read</p>
            {!currentEmployee?.gmailEmail && (
              <p className="text-xs mt-4 max-w-xs mx-auto">
                <button
                  className="underline text-[hsl(var(--titan-blue))]"
                  onClick={() => setGmailSettingsOpen(true)}
                >
                  Link your Gmail account
                </button>
                {" "}to send emails directly from your real Gmail.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
