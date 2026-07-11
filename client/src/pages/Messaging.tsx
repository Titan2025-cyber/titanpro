import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Plus, Send, Hash, Briefcase, MapPin, FileText, Check, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Channel, Message, Job } from "@shared/schema";

const TEAM = ["John", "Mason", "Clint", "Blake", "Blake Foster", "Cody Brantley"];

// Channels that create job files from posted intake messages.
const isJobChannel = (name?: string) => {
  const n = (name || "").toLowerCase();
  return n.includes("aug") || n.includes("cola");
};
const marketFor = (name?: string) => {
  const n = (name || "").toLowerCase();
  if (n.includes("aug")) return "Augusta, GA";
  if (n.includes("cola")) return "Columbia, SC";
  return "";
};

// Heuristic: does this message look like a job intake? Needs at least one
// identity label and a loss keyword, OR a leading /job marker.
const looksLikeIntake = (body: string) => {
  const b = body.toLowerCase();
  if (b.trim().startsWith("/job")) return true;
  const hasIdentity = /(customer|client|homeowner|insured|address|property|location)\s*[:\-]/i.test(body);
  const hasLoss = /(loss|damage|type)\s*[:\-]/i.test(body) ||
    /\b(water|fire|mold|storm|biohazard|reconstruction)\b/i.test(body);
  return hasIdentity && hasLoss;
};

interface ParseResult {
  ok: boolean;
  missing?: string[];
  market: string;
  jobNumber: string;
  draft: Record<string, any>;
  parsed: Record<string, any>;
}

const SAMPLE = `Customer: Jane Doe
Address: 123 Oak St, Augusta, GA 30901
Loss: water
Carrier: State Farm
Claim: SF-88231
Adjuster: Bob Smith
Tech: John
Source: referral`;

/** Preview dialog: parses a message server-side, shows the draft, confirms create. */
function CreateJobDialog({
  channelId, channelName, message, open, onOpenChange,
}: {
  channelId: number; channelName: string; message: Message;
  open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [parse, setParse] = useState<ParseResult | null>(null);

  const runPreview = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/channels/${channelId}/parse-job`, { body: message.body, preview: true });
      return res.json() as Promise<ParseResult>;
    },
    onSuccess: (data) => setParse(data),
  });

  // Run the preview parse as soon as the dialog opens.
  useEffect(() => {
    if (open && !parse && !runPreview.isPending) runPreview.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/channels/${channelId}/parse-job`, { body: message.body });
      return res.json();
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      // Post a confirmation message back into the channel.
      const job = data?.job || {};
      const parsed = data?.parsed || {};
      const jn = job.jobNumber;
      const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
      const lines: string[] = [`📋 Job file created — ${jn}`];
      if (parsed.customer) lines.push(`• Customer: ${parsed.customer}`);
      if (job.address) lines.push(`• Address: ${job.address}`);
      if (job.lossType) lines.push(`• Loss: ${cap(job.lossType)}${job.division ? ` (${cap(job.division)})` : ""}`);
      if (parse?.market) lines.push(`• Market: ${parse.market}`);
      if (job.assignedTech) lines.push(`• Assigned tech: ${job.assignedTech}`);
      if (job.insuranceCarrier || job.claimNumber) {
        lines.push(`• Insurance: ${[job.insuranceCarrier, job.claimNumber && `Claim ${job.claimNumber}`].filter(Boolean).join(" · ")}`);
      }
      lines.push("", `Open the full job file below ↓`);
      await apiRequest("POST", `/api/channels/${channelId}/messages`, {
        author: "Titan Pro",
        body: lines.join("\n"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/channels", channelId, "messages"] });
      toast({ title: "Job file created", description: `${jn} added to Jobs.` });
      onOpenChange(false);
      if (data?.job?.id) navigate(`/jobs/${data.job.id}`);
    },
    onError: () => toast({ title: "Could not create job", description: "Please try again.", variant: "destructive" }),
  });

  const p = parse?.parsed || {};
  const rows: [string, any][] = [
    ["Customer", p.customer], ["Address", p.address], ["Loss type", p.lossType],
    ["Market", parse?.market], ["Carrier", p.carrier], ["Claim #", p.claimNumber],
    ["Adjuster", p.adjusterName], ["Adjuster phone", p.adjusterPhone],
    ["Adjuster email", p.adjusterEmail], ["Policy #", p.policyNumber],
    ["Assigned tech", p.assignedTech], ["Lead source", p.leadSource],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-[hsl(var(--titan-red))]" />
            Create job file from message
          </DialogTitle>
        </DialogHeader>

        {runPreview.isPending && <p className="text-sm text-muted-foreground py-6 text-center">Reading message…</p>}

        {parse && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
              <span className="text-xs text-muted-foreground">New job number</span>
              <span className="font-mono font-semibold" data-testid="text-parsed-jobnumber">{parse.jobNumber}</span>
            </div>

            {!parse.ok && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-parse-missing">
                Missing required info: {parse.missing?.join(", ")}. Add these to the message, or create the job and fill them in later.
              </div>
            )}

            <div className="rounded-lg border divide-y">
              {rows.map(([label, val]) => (
                <div key={label} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                  <span className="text-muted-foreground text-xs">{label}</span>
                  <span className={`font-medium text-right truncate ${val ? "" : "text-muted-foreground/50"}`} data-testid={`text-parsed-${label.toLowerCase().replace(/[^a-z]/g, "")}`}>
                    {val || "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-parsejob-cancel">Cancel</Button>
          <Button
            className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)] text-white"
            disabled={!parse || create.isPending}
            onClick={() => create.mutate()}
            data-testid="button-parsejob-create"
          >
            <Check className="w-4 h-4 mr-1" />{create.isPending ? "Creating…" : "Create job file"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Messaging() {
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [msgText, setMsgText] = useState("");
  const [author, setAuthor] = useState("Cody Brantley");
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [jobDialogMsg, setJobDialogMsg] = useState<Message | null>(null);

  const [, navigate] = useLocation();
  const { data: channels = [] } = useQuery<Channel[]>({ queryKey: ["/api/channels"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ["/api/channels", activeChannelId, "messages"],
    enabled: activeChannelId !== null,
  });

  const activeChannel = channels.find(c => c.id === activeChannelId) || channels[0];
  const channelId = activeChannelId || channels[0]?.id;
  const jobChannel = isJobChannel(activeChannel?.name);

  const sendMsg = useMutation({
    mutationFn: () => apiRequest("POST", `/api/channels/${channelId}/messages`, { author, body: msgText }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/channels", channelId, "messages"] }); setMsgText(""); },
  });

  const createChannel = useMutation({
    mutationFn: () => apiRequest("POST", "/api/channels", { name: channelName.toLowerCase().replace(/\s+/g, "-"), description: "" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/channels"] }); setNewChannelOpen(false); setChannelName(""); },
  });

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-0 rounded-xl overflow-hidden border">
      {/* Sidebar */}
      <div className="w-56 shrink-0 bg-[hsl(220,20%,12%)] text-white flex flex-col">
        <div className="px-4 py-3 border-b border-white/10">
          <p className="font-bold text-sm">Titan Pro Chat</p>
          <p className="text-xs opacity-50">706-922-0154</p>
        </div>
        <div className="flex-1 overflow-y-auto py-2 px-2">
          <div className="flex items-center justify-between px-2 mb-1">
            <p className="text-xs uppercase tracking-wider opacity-50">Channels</p>
            <Dialog open={newChannelOpen} onOpenChange={setNewChannelOpen}>
              <DialogTrigger asChild>
                <button className="text-white opacity-50 hover:opacity-100"><Plus className="w-3.5 h-3.5" /></button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New Channel</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div><Label>Channel Name</Label><Input value={channelName} onChange={e => setChannelName(e.target.value)} placeholder="e.g. water-damage" /></div>
                  <Button className="w-full" onClick={() => createChannel.mutate()} disabled={!channelName.trim()}>Create</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          {channels.map(ch => (
            <button
              key={ch.id}
              onClick={() => setActiveChannelId(ch.id)}
              data-testid={`channel-${ch.name}`}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left ${(activeChannelId || channels[0]?.id) === ch.id ? "bg-white/20 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"}`}
            >
              <Hash className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{ch.name}</span>
              {isJobChannel(ch.name) && <Briefcase className="w-3 h-3 ml-auto shrink-0 opacity-60" />}
            </button>
          ))}
        </div>
        <div className="px-3 py-2 border-t border-white/10">
          <Select value={author} onValueChange={setAuthor}>
            <SelectTrigger className="h-7 text-xs bg-white/10 border-0 text-white"><SelectValue /></SelectTrigger>
            <SelectContent>{TEAM.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 flex flex-col bg-background">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Hash className="w-4 h-4 text-muted-foreground" />
          <p className="font-semibold">{activeChannel?.name || "general"}</p>
          {activeChannel?.description && <p className="text-sm text-muted-foreground hidden sm:block">— {activeChannel.description}</p>}
          {jobChannel && (
            <Badge className="ml-auto bg-[hsl(var(--titan-red))]/10 text-[hsl(var(--titan-red))] border-[hsl(var(--titan-red))]/30">
              <MapPin className="w-3 h-3 mr-1" />{marketFor(activeChannel?.name)}
            </Badge>
          )}
        </div>

        {/* Intake helper banner for job channels */}
        {jobChannel && (
          <div className="mx-4 mt-3 rounded-lg border border-[hsl(var(--titan-blue))]/30 bg-[hsl(var(--titan-blue))]/5 px-3 py-2 text-xs">
            <p className="flex items-center gap-1.5 font-medium text-[hsl(var(--titan-blue))]">
              <Sparkles className="w-3.5 h-3.5" />Post a job here to create a {marketFor(activeChannel?.name)} job file
            </p>
            <p className="text-muted-foreground mt-1">
              Include labeled lines like <span className="font-mono">Customer:</span>, <span className="font-mono">Address:</span>, <span className="font-mono">Loss:</span>, <span className="font-mono">Carrier:</span>, <span className="font-mono">Claim:</span>, <span className="font-mono">Adjuster:</span>, <span className="font-mono">Tech:</span>. You'll get a "Create job file" button on the message.
            </p>
            <button
              className="mt-1.5 text-[hsl(var(--titan-blue))] hover:underline font-medium"
              onClick={() => setMsgText(SAMPLE)}
              data-testid="button-insert-sample"
            >
              Insert example
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map(msg => {
            const intake = jobChannel && msg.author !== "Titan Pro" && looksLikeIntake(msg.body);
            // Detect a job file created by the bot and link it directly.
            const jnMatch = msg.author === "Titan Pro" && /Job file created/i.test(msg.body)
              ? msg.body.match(/TP-\d{4}-\d{3,}/)?.[0]
              : undefined;
            const linkedJob = jnMatch ? jobs.find(j => j.jobNumber === jnMatch) : undefined;
            return (
              <div key={msg.id} className="flex gap-3 group">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${msg.author === "Titan Pro" ? "bg-[hsl(var(--titan-red))]" : "bg-[hsl(var(--titan-blue))]"}`}>
                  {msg.author === "Titan Pro" ? <FileText className="w-4 h-4" /> : msg.author.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">{msg.author}</span>
                    <span className="text-xs text-muted-foreground">{msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                  </div>
                  <p className="text-sm text-foreground leading-snug whitespace-pre-wrap">{msg.body}</p>
                  {intake && (
                    <button
                      onClick={() => setJobDialogMsg(msg)}
                      data-testid={`button-createjob-${msg.id}`}
                      className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--titan-red))]/40 bg-[hsl(var(--titan-red))]/5 px-2.5 py-1 text-xs font-medium text-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red))]/10"
                    >
                      <Briefcase className="w-3.5 h-3.5" />Create job file<ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                  {linkedJob && (
                    <button
                      onClick={() => navigate(`/jobs/${linkedJob.id}`)}
                      data-testid={`button-openjob-${msg.id}`}
                      className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--titan-red))]/40 bg-[hsl(var(--titan-red))]/5 px-2.5 py-1 text-xs font-medium text-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red))]/10"
                    >
                      <FileText className="w-3.5 h-3.5" />Open job file<ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {messages.length === 0 && <p className="text-sm text-muted-foreground text-center mt-8">No messages yet. Start the conversation.</p>}
        </div>

        <div className="px-4 pb-4">
          <div className="flex gap-2 items-start border rounded-lg px-3 py-2 bg-background">
            <textarea
              className="flex-1 border-0 shadow-none focus-visible:ring-0 focus:outline-none p-0 text-sm bg-transparent resize-none min-h-[24px] max-h-40"
              rows={msgText.includes("\n") ? Math.min(msgText.split("\n").length, 8) : 1}
              placeholder={jobChannel ? `Post a job to #${activeChannel?.name}…` : `Message #${activeChannel?.name || "general"}`}
              value={msgText}
              onChange={e => setMsgText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && msgText.trim()) { e.preventDefault(); sendMsg.mutate(); } }}
              data-testid="input-message"
            />
            <Button size="sm" className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white h-7 w-7 p-0 shrink-0 mt-0.5" onClick={() => msgText.trim() && sendMsg.mutate()} data-testid="button-send">
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {jobDialogMsg && channelId && (
        <CreateJobDialog
          channelId={channelId}
          channelName={activeChannel?.name || ""}
          message={jobDialogMsg}
          open={!!jobDialogMsg}
          onOpenChange={(v) => { if (!v) setJobDialogMsg(null); }}
        />
      )}
    </div>
  );
}
