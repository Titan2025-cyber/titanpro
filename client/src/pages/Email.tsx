import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Send, Inbox, Send as SendIcon, FileText, Mail, ExternalLink, User, Settings, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Email } from "@shared/schema";

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
  const [activeEmployee, setActiveEmployee] = useState<string>("Cody Brantley");
  const [gmailInput, setGmailInput] = useState("");
  const { toast } = useToast();

  const { data: emails = [] } = useQuery<Email[]>({
    queryKey: ["/api/emails", folder],
    queryFn: () => apiRequest("GET", `/api/emails?folder=${folder}`).then(r => r.json()),
  });

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const currentEmployee = employees.find(e => e.name === activeEmployee);
  const fromAddress = currentEmployee?.gmailEmail || `${activeEmployee.toLowerCase().replace(/\s/g, "")}@titanrestorationllc.com`;

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

  const linkGmailMutation = useMutation({
    mutationFn: () => {
      if (!currentEmployee) throw new Error("No employee selected");
      return apiRequest("PATCH", `/api/employees/${currentEmployee.id}`, { gmailEmail: gmailInput });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      setGmailSettingsOpen(false);
      toast({ title: "Gmail linked", description: `${gmailInput} is now linked to ${activeEmployee}` });
    },
  });

  const unlinkGmailMutation = useMutation({
    mutationFn: () => {
      if (!currentEmployee) throw new Error("No employee selected");
      return apiRequest("PATCH", `/api/employees/${currentEmployee.id}`, { gmailEmail: null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employees"] });
      toast({ title: "Gmail unlinked" });
    },
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
        {/* Employee selector */}
        <div className="px-3 py-3 border-b border-white/10">
          <p className="font-bold text-xs uppercase tracking-wider opacity-50 mb-2">Sending as</p>
          <Select value={activeEmployee} onValueChange={setActiveEmployee}>
            <SelectTrigger className="h-8 text-xs bg-white/10 border-white/20 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {employees.map(e => (
                <SelectItem key={e.id} value={e.name}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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

        {/* Gmail Settings */}
        <div className="px-3 py-2 border-b border-white/10">
          <Dialog open={gmailSettingsOpen} onOpenChange={(o) => { setGmailSettingsOpen(o); if (o) setGmailInput(currentEmployee?.gmailEmail || ""); }}>
            <DialogTrigger asChild>
              <button className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-white/60 hover:bg-white/10 hover:text-white text-left">
                <Settings className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs">Gmail Settings</span>
              </button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5 text-[hsl(var(--titan-red))]" />
                  Link Gmail — {activeEmployee}
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
                  <Label>Gmail Address</Label>
                  <Input
                    data-testid="input-gmail-email"
                    type="email"
                    value={gmailInput}
                    onChange={e => setGmailInput(e.target.value)}
                    placeholder="name@gmail.com"
                  />
                  <p className="text-xs text-muted-foreground">Enter the Gmail address you want to associate with {activeEmployee}.</p>
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

                <div className="border-t pt-4">
                  <p className="text-xs font-medium mb-2">All Team Members</p>
                  <div className="space-y-1.5">
                    {employees.map(e => (
                      <div key={e.id} className="flex items-center gap-2">
                        <User className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs font-medium w-28">{e.name}</span>
                        {e.gmailEmail ? (
                          <span className="text-xs text-green-600 truncate">{e.gmailEmail}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">not linked</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
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
                </div>
                {!currentEmployee?.gmailEmail && (
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
            <p className="text-xs text-muted-foreground mt-1">{email.createdAt ? new Date(email.createdAt).toLocaleDateString() : ""}</p>
          </button>
        ))}
        {emails.length === 0 && <p className="text-sm text-muted-foreground text-center p-8">No emails.</p>}
      </div>

      {/* Email detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {selected ? (
          <div>
            <Button variant="ghost" size="sm" className="mb-4 md:hidden" onClick={() => setSelectedId(null)}>← Back</Button>
            <h2 className="text-lg font-bold mb-1">{selected.subject}</h2>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground mb-4">
              <span>From: {selected.from}</span>
              <span>To: {selected.to}</span>
              <span>{selected.createdAt ? new Date(selected.createdAt).toLocaleString() : ""}</span>
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
            </div>
          </div>
        ) : (
          <div className="text-center text-muted-foreground mt-20">
            <Inbox className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p>Select an email to read</p>
            {employees.filter(e => !e.gmailEmail).length > 0 && (
              <p className="text-xs mt-4 max-w-xs mx-auto">
                <button
                  className="underline text-[hsl(var(--titan-blue))]"
                  onClick={() => setGmailSettingsOpen(true)}
                >
                  Link Gmail accounts
                </button>
                {" "}for your team to send emails directly from their real Gmail.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
