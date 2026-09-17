import { useQuery, useMutation } from "@tanstack/react-query";
import { UserSelect } from "@/components/UserSelect";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Plus, Send, Hash, Briefcase, MapPin, FileText, Check, Sparkles, ArrowRight, UserPlus, X, MoreVertical, Users, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Channel, Message, Job } from "@shared/schema";


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
  // Titan's actual dispatch format uses "Name:" and "Description of Loss:";
  // legacy patterns also included "Customer:", "Address:", "Loss:", etc.
  const hasIdentity = /(customer|client|homeowner|insured|name|address|property|location)\s*[:\-]/i.test(body);
  const hasLoss = /(loss|damage|type|description of loss)\s*[:\-]/i.test(body) ||
    /\b(water|fire|mold|storm|biohazard|reconstruction|leak|flood|smoke)\b/i.test(body);
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

// Titan's real-world lead layout. Copy-paste-friendly for dispatchers so a
// message dropped into #augusta or #columbia parses cleanly into a job file.
// Empty labels are OK — the parser only requires enough to derive a customer
// or address plus a loss keyword in the description.
const SAMPLE = `Job #: TP-26-Augusta-0490
Name: Horace Johnson
Number: (706) 699-1413
(706) 445-4848 (sherry)
Address: 929 Earle Street, Thomson, GA 30824
Email: 
Insurance: 
Claim #: 
Description of Loss: Drain leak under home and possible leak from fiberglass tub surround..floor on bath is done..lots of water under home when they use the tub.. leak in cast iron under home.
Referral Source: Nick - universal`;

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
    ["Customer", p.customer], ["Phone", p.customerPhone], ["Alt. phone", p.altPhone],
    ["Email", p.customerEmail], ["Address", p.address],
    ["Description", p.description], ["Loss type", p.lossType],
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

/** New Lead dialog: dedicated form to enter a complete lead/job from Dispatch.
 *  On submit it POSTs a contact (if new customer) then a job, which fires the
 *  server-side `notifyNewJob` — that already drops a bell notification into
 *  every active employee's inbox AND posts an announcement to #general.
 *  Also posts a summary message into the currently-active channel so the
 *  Dispatch feed shows the new lead in real time. */
function NewLeadDialog({
  channelId, open, onOpenChange,
}: {
  channelId: number | undefined;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const initial = {
    // Customer
    customerName: "",
    customerPhone: "",
    altPhone: "",
    customerEmail: "",
    address: "",
    // Loss
    lossType: "water",
    division: "mitigation",
    market: "",
    description: "",
    // Insurance
    insuranceCarrier: "",
    claimNumber: "",
    policyNumber: "",
    adjusterName: "",
    adjusterPhone: "",
    adjusterEmail: "",
    // Assignment / source
    assignedTech: "",
    leadSource: "",
    leadSourceDetail: "",
  };
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof initial, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Reset on close so the next open is fresh.
  useEffect(() => { if (!open) setForm(initial); /* eslint-disable-next-line */ }, [open]);

  const submit = useMutation({
    mutationFn: async () => {
      const trimmed = form.customerName.trim();
      if (!trimmed) throw new Error("Customer name is required");

      // Step 1 — Reuse an existing customer contact when the name matches
      // (case-insensitive), otherwise create a new one. Same pattern as
      // parse-job so we do not duplicate customer records on repeat leads.
      const contactsRes = await apiRequest("GET", "/api/contacts");
      const contacts = (await contactsRes.json()) as Array<{ id: number; name: string; type?: string }>;
      let contactId: number | null = null;
      const existing = contacts.find(c =>
        (c.type === "customer" || !c.type) &&
        c.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (existing) {
        contactId = existing.id;
      } else {
        const newContactRes = await apiRequest("POST", "/api/contacts", {
          name: trimmed,
          type: "customer",
          email: form.customerEmail.trim() || null,
          phone: form.customerPhone.trim() || null,
          address: form.address.trim() || null,
        });
        const nc = await newContactRes.json();
        contactId = nc?.id ?? null;
      }

      // Step 2 — Build the job payload. Empty strings coerced to null so
      // SQLite doesn't reject text-column bindings.
      const nn = (v: string) => (v.trim() === "" ? null : v.trim());
      const jobPayload: Record<string, any> = {
        contactId,
        lossType: form.lossType || "water",
        division: form.division || "mitigation",
        status: "new",
        progressStage: "pending_sale",
        address: nn(form.address),
        description: nn(form.description) || `${trimmed}${form.market ? " \u2014 " + form.market : ""}`,
        insuranceCarrier: nn(form.insuranceCarrier),
        claimNumber: nn(form.claimNumber),
        policyNumber: nn(form.policyNumber),
        adjusterName: nn(form.adjusterName),
        adjusterPhone: nn(form.adjusterPhone),
        adjusterEmail: nn(form.adjusterEmail),
        assignedTech: nn(form.assignedTech),
        leadSource: nn(form.leadSource),
        leadSourceDetail: nn(form.leadSourceDetail),
      };

      const jobRes = await apiRequest("POST", "/api/jobs", jobPayload);
      const job = await jobRes.json();

      // Step 3 — Announce in the current Dispatch channel (best-effort).
      // The server-side notifyNewJob already handles the team-wide bell +
      // #general announcement; this extra post keeps the current channel
      // conversation aware too.
      if (channelId) {
        const lines: string[] = [`\ud83c\udd95 New lead entered: ${job.jobNumber}`];
        lines.push(`Customer: ${trimmed}`);
        if (jobPayload.address) lines.push(`Address: ${jobPayload.address}`);
        lines.push(`Loss: ${(jobPayload.lossType || "").charAt(0).toUpperCase() + (jobPayload.lossType || "").slice(1)}`);
        if (form.market) lines.push(`Market: ${form.market}`);
        if (jobPayload.assignedTech) lines.push(`Assigned: ${jobPayload.assignedTech}`);
        if (jobPayload.insuranceCarrier || jobPayload.claimNumber) {
          lines.push(`Insurance: ${[jobPayload.insuranceCarrier, jobPayload.claimNumber && `Claim ${jobPayload.claimNumber}`].filter(Boolean).join(" \u00b7 ")}`);
        }
        try {
          await apiRequest("POST", `/api/channels/${channelId}/messages`, {
            author: "Titan Pro",
            body: lines.join("\n"),
          });
        } catch { /* non-fatal */ }
      }

      return job;
    },
    onSuccess: (job: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      if (channelId) {
        queryClient.invalidateQueries({ queryKey: ["/api/channels", channelId, "messages"] });
      }
      toast({ title: "Lead created", description: `${job.jobNumber} \u00b7 team notified` });
      onOpenChange(false);
      if (job?.id) navigate(`/jobs/${job.id}`);
    },
    onError: (e: any) => toast({
      title: "Could not create lead",
      description: e?.message || "Please check the form and try again.",
      variant: "destructive",
    }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-[hsl(var(--titan-red))]" />
            New Lead
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Enter as much as you know. The whole team is notified the moment you save.
          </p>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-6">
            {/* --- Customer --- */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Customer</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <Label className="text-xs">Full name *</Label>
                  <Input
                    value={form.customerName}
                    onChange={e => set("customerName", e.target.value)}
                    placeholder="Jane Homeowner"
                    data-testid="input-lead-name"
                  />
                </div>
                <div>
                  <Label className="text-xs">Phone</Label>
                  <Input
                    value={form.customerPhone}
                    onChange={e => set("customerPhone", e.target.value)}
                    placeholder="(706) 555-0100"
                    data-testid="input-lead-phone"
                  />
                </div>
                <div>
                  <Label className="text-xs">Alt. phone</Label>
                  <Input
                    value={form.altPhone}
                    onChange={e => set("altPhone", e.target.value)}
                    placeholder="(706) 555-0101"
                    data-testid="input-lead-altphone"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Email</Label>
                  <Input
                    type="email"
                    value={form.customerEmail}
                    onChange={e => set("customerEmail", e.target.value)}
                    placeholder="jane@example.com"
                    data-testid="input-lead-email"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Property address</Label>
                  <Input
                    value={form.address}
                    onChange={e => set("address", e.target.value)}
                    placeholder="929 Earle St, Thomson, GA 30824"
                    data-testid="input-lead-address"
                  />
                </div>
              </div>
            </section>

            {/* --- Loss --- */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Loss</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Loss type</Label>
                  <Select value={form.lossType} onValueChange={v => set("lossType", v)}>
                    <SelectTrigger data-testid="select-lead-losstype"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="water">Water</SelectItem>
                      <SelectItem value="fire">Fire</SelectItem>
                      <SelectItem value="mold">Mold</SelectItem>
                      <SelectItem value="storm">Storm</SelectItem>
                      <SelectItem value="biohazard">Biohazard</SelectItem>
                      <SelectItem value="reconstruction">Reconstruction</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Division</Label>
                  <Select value={form.division} onValueChange={v => set("division", v)}>
                    <SelectTrigger data-testid="select-lead-division"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mitigation">Mitigation</SelectItem>
                      <SelectItem value="reconstruction">Reconstruction</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Market</Label>
                  <Input
                    value={form.market}
                    onChange={e => set("market", e.target.value)}
                    placeholder="Augusta, GA"
                    data-testid="input-lead-market"
                  />
                </div>
                <div className="sm:col-span-3">
                  <Label className="text-xs">Description of loss</Label>
                  <Textarea
                    className="min-h-[80px]"
                    value={form.description}
                    onChange={e => set("description", e.target.value)}
                    placeholder="Drain leak under home, water damage to bathroom floor..."
                    data-testid="input-lead-description"
                  />
                </div>
              </div>
            </section>

            {/* --- Insurance --- */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Insurance</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Carrier</Label>
                  <Input
                    value={form.insuranceCarrier}
                    onChange={e => set("insuranceCarrier", e.target.value)}
                    placeholder="State Farm"
                    data-testid="input-lead-carrier"
                  />
                </div>
                <div>
                  <Label className="text-xs">Claim #</Label>
                  <Input
                    value={form.claimNumber}
                    onChange={e => set("claimNumber", e.target.value)}
                    data-testid="input-lead-claim"
                  />
                </div>
                <div>
                  <Label className="text-xs">Policy #</Label>
                  <Input
                    value={form.policyNumber}
                    onChange={e => set("policyNumber", e.target.value)}
                    data-testid="input-lead-policy"
                  />
                </div>
                <div>
                  <Label className="text-xs">Adjuster name</Label>
                  <Input
                    value={form.adjusterName}
                    onChange={e => set("adjusterName", e.target.value)}
                    data-testid="input-lead-adjuster-name"
                  />
                </div>
                <div>
                  <Label className="text-xs">Adjuster phone</Label>
                  <Input
                    value={form.adjusterPhone}
                    onChange={e => set("adjusterPhone", e.target.value)}
                    data-testid="input-lead-adjuster-phone"
                  />
                </div>
                <div>
                  <Label className="text-xs">Adjuster email</Label>
                  <Input
                    type="email"
                    value={form.adjusterEmail}
                    onChange={e => set("adjusterEmail", e.target.value)}
                    data-testid="input-lead-adjuster-email"
                  />
                </div>
              </div>
            </section>

            {/* --- Assignment / Source --- */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Assignment & Source</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Assigned tech</Label>
                  <Input
                    value={form.assignedTech}
                    onChange={e => set("assignedTech", e.target.value)}
                    placeholder="Kalobe Hedden"
                    data-testid="input-lead-tech"
                  />
                </div>
                <div>
                  <Label className="text-xs">Lead source</Label>
                  <Input
                    value={form.leadSource}
                    onChange={e => set("leadSource", e.target.value)}
                    placeholder="Referral, Google, Repeat, etc."
                    data-testid="input-lead-source"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Source detail</Label>
                  <Input
                    value={form.leadSourceDetail}
                    onChange={e => set("leadSourceDetail", e.target.value)}
                    placeholder="e.g. Nick @ Universal, walk-in, etc."
                    data-testid="input-lead-source-detail"
                  />
                </div>
              </div>
            </section>
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t shrink-0 bg-muted/30">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-lead-cancel"
          >
            Cancel
          </Button>
          <Button
            className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)] text-white"
            disabled={submit.isPending || !form.customerName.trim()}
            onClick={() => submit.mutate()}
            data-testid="button-lead-submit"
          >
            <Check className="w-4 h-4 mr-1" />
            {submit.isPending ? "Creating..." : "Create lead & notify team"}
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
  const [channelDescription, setChannelDescription] = useState("");
  const [newChannelMemberIds, setNewChannelMemberIds] = useState<number[]>([]);
  const [jobDialogMsg, setJobDialogMsg] = useState<Message | null>(null);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  // Manage / rename / delete state for the channel kebab menu.
  const [manageChannel, setManageChannel] = useState<Channel | null>(null);
  const [manageMemberIds, setManageMemberIds] = useState<number[]>([]);
  const [renameChannel, setRenameChannel] = useState<Channel | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteChannel, setDeleteChannel] = useState<Channel | null>(null);
  // Push 6.1 mobile fix: channel sidebar collapses on phones and slides in
  // as a full-width overlay. Auto-closes when a channel is picked.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { toast } = useToast();

  const [, navigate] = useLocation();
  const { data: channels = [] } = useQuery<Channel[]>({ queryKey: ["/api/channels"] });
  const { data: employees = [] } = useQuery<Array<{ id: number; name: string; role: string; isActive?: boolean }>>({
    queryKey: ["/api/employees"],
  });
  const activeEmployees = employees.filter(e => e.isActive !== false);
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
    mutationFn: () => apiRequest("POST", "/api/channels", {
      name: channelName.toLowerCase().trim().replace(/\s+/g, "-"),
      description: channelDescription.trim() || undefined,
      memberIds: newChannelMemberIds,
    }),
    onSuccess: async (res) => {
      const body = await res.json().catch(() => ({}));
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      setNewChannelOpen(false);
      setChannelName("");
      setChannelDescription("");
      setNewChannelMemberIds([]);
      if (body?.id) setActiveChannelId(body.id);
      toast({ title: "Channel created", description: `#${body?.name || channelName}` });
    },
    onError: async (err: any) => {
      const msg = err?.body?.error || err?.message || "Could not create channel.";
      toast({ title: "Create failed", description: msg, variant: "destructive" });
    },
  });

  // Save member changes on an existing channel.
  const updateMembers = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/channels/${manageChannel!.id}`, { memberIds: manageMemberIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      setManageChannel(null);
      toast({ title: "Members updated" });
    },
    onError: async (err: any) => {
      const msg = err?.body?.error || err?.message || "Could not update members.";
      toast({ title: "Update failed", description: msg, variant: "destructive" });
    },
  });

  // Rename a channel.
  const renameChannelMut = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/channels/${renameChannel!.id}`, {
      name: renameValue.toLowerCase().trim().replace(/\s+/g, "-"),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      setRenameChannel(null);
      setRenameValue("");
      toast({ title: "Channel renamed" });
    },
    onError: async (err: any) => {
      const msg = err?.body?.error || err?.message || "Could not rename channel.";
      toast({ title: "Rename failed", description: msg, variant: "destructive" });
    },
  });

  // Delete a channel (and its message history + membership rows on the server).
  const deleteChannelMut = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/channels/${deleteChannel!.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      // If we deleted the active channel, move focus to the first surviving one.
      if (activeChannelId === deleteChannel!.id) {
        const rest = channels.filter(c => c.id !== deleteChannel!.id);
        setActiveChannelId(rest[0]?.id ?? null);
      }
      const name = deleteChannel!.name;
      setDeleteChannel(null);
      toast({ title: "Channel deleted", description: `#${name}` });
    },
    onError: async (err: any) => {
      const msg = err?.body?.error || err?.message || "Could not delete channel.";
      toast({ title: "Delete failed", description: msg, variant: "destructive" });
    },
  });

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-0 rounded-xl overflow-hidden border relative">
      {/* Mobile backdrop when sidebar is open */}
      {sidebarOpen && (
        <div
          className="md:hidden absolute inset-0 bg-black/50 z-20"
          onClick={() => setSidebarOpen(false)}
          data-testid="sidebar-backdrop"
        />
      )}
      {/* Sidebar — full-width slide-over on mobile, fixed 224px on md+ */}
      <div className={`${sidebarOpen ? "flex absolute inset-y-0 left-0 z-30 w-[85%] max-w-[280px]" : "hidden"} md:flex md:relative md:w-56 shrink-0 bg-[hsl(220,20%,12%)] text-white flex-col`}>
        <div className="px-4 py-3 border-b border-white/10">
          <p className="font-bold text-sm">Titan Pro Chat</p>
          <p className="text-xs opacity-50">706-922-0154</p>
        </div>
        <div className="flex-1 overflow-y-auto py-2 px-2">
          <div className="flex items-center justify-between px-2 mb-1">
            <p className="text-xs uppercase tracking-wider opacity-50">Channels</p>
            <Dialog open={newChannelOpen} onOpenChange={(o) => {
              setNewChannelOpen(o);
              if (!o) { setChannelName(""); setChannelDescription(""); setNewChannelMemberIds([]); }
            }}>
              <DialogTrigger asChild>
                <button className="text-white opacity-50 hover:opacity-100" data-testid="button-new-channel"><Plus className="w-3.5 h-3.5" /></button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>New Channel</DialogTitle>
                  <DialogDescription>Create a channel and choose who can see it. Leave members empty for a public channel visible to everyone.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Channel Name</Label>
                    <Input
                      value={channelName}
                      onChange={e => setChannelName(e.target.value)}
                      placeholder="e.g. water-damage"
                      data-testid="input-channel-name"
                    />
                  </div>
                  <div>
                    <Label>Description (optional)</Label>
                    <Input
                      value={channelDescription}
                      onChange={e => setChannelDescription(e.target.value)}
                      placeholder="What's this channel for?"
                      data-testid="input-channel-description"
                    />
                  </div>
                  <div>
                    <Label>Members ({newChannelMemberIds.length} selected)</Label>
                    <p className="text-xs text-muted-foreground mb-2">Empty = public. You'll be added automatically when you pick anyone.</p>
                    <div className="max-h-52 overflow-y-auto border rounded-md p-2 space-y-1">
                      {activeEmployees.map(emp => (
                        <label key={emp.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-muted cursor-pointer text-sm">
                          <Checkbox
                            checked={newChannelMemberIds.includes(emp.id)}
                            onCheckedChange={(chk) => {
                              setNewChannelMemberIds(prev => chk ? [...prev, emp.id] : prev.filter(x => x !== emp.id));
                            }}
                            data-testid={`checkbox-newchan-${emp.id}`}
                          />
                          <span className="flex-1">{emp.name}</span>
                          <span className="text-xs text-muted-foreground capitalize">{emp.role}</span>
                        </label>
                      ))}
                      {activeEmployees.length === 0 && <p className="text-xs text-muted-foreground py-2 text-center">No active employees yet.</p>}
                    </div>
                  </div>
                  <Button
                    className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)]"
                    onClick={() => createChannel.mutate()}
                    disabled={!channelName.trim() || createChannel.isPending}
                    data-testid="button-create-channel"
                  >
                    {createChannel.isPending ? "Creating…" : "Create Channel"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          {channels.map(ch => {
            const isActive = (activeChannelId || channels[0]?.id) === ch.id;
            const memberCount = (ch as any).memberIds?.length || 0;
            return (
              <div key={ch.id} className={`group flex items-center gap-1 pr-1 rounded ${isActive ? "bg-white/20" : "hover:bg-white/10"}`}>
                <button
                  onClick={() => { setActiveChannelId(ch.id); setSidebarOpen(false); }}
                  data-testid={`channel-${ch.name}`}
                  className={`flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-sm text-left ${isActive ? "text-white" : "text-white/60 group-hover:text-white"}`}
                >
                  <Hash className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{ch.name}</span>
                  {isJobChannel(ch.name) && <Briefcase className="w-3 h-3 shrink-0 opacity-60" />}
                  {memberCount > 0 && <span className="ml-auto text-[10px] opacity-50">{memberCount}</span>}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="p-1 rounded opacity-0 group-hover:opacity-70 hover:opacity-100 text-white"
                      onClick={(e) => e.stopPropagation()}
                      data-testid={`channel-menu-${ch.name}`}
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      onClick={() => {
                        setManageChannel(ch);
                        setManageMemberIds((ch as any).memberIds || []);
                      }}
                      data-testid={`menu-manage-${ch.name}`}
                    >
                      <Users className="w-4 h-4 mr-2" />Manage members
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => { setRenameChannel(ch); setRenameValue(ch.name); }}
                      data-testid={`menu-rename-${ch.name}`}
                    >
                      <Pencil className="w-4 h-4 mr-2" />Rename
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeleteChannel(ch)}
                      data-testid={`menu-delete-${ch.name}`}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
        <div className="px-3 py-2 border-t border-white/10">
          <UserSelect
            value={author}
            onChange={setAuthor}
            placeholder="Select author"
            className="h-7 text-xs bg-white/10 border-0 text-white"
            testId="select-message-author"
          />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 flex flex-col bg-background min-w-0">
        <div className="px-3 md:px-4 py-3 border-b flex items-center gap-2">
          {/* Mobile: open sidebar */}
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden h-8 w-8 p-0"
            onClick={() => setSidebarOpen(true)}
            data-testid="button-open-sidebar"
          >
            <Hash className="w-4 h-4" />
          </Button>
          <Hash className="w-4 h-4 text-muted-foreground hidden md:block" />
          <p className="font-semibold truncate">{activeChannel?.name || "general"}</p>
          {activeChannel?.description && <p className="text-sm text-muted-foreground hidden sm:block">— {activeChannel.description}</p>}
          {jobChannel && (
            <Badge className="ml-2 bg-[hsl(var(--titan-red))]/10 text-[hsl(var(--titan-red))] border-[hsl(var(--titan-red))]/30">
              <MapPin className="w-3 h-3 mr-1" />{marketFor(activeChannel?.name)}
            </Badge>
          )}
          <Button
            size="sm"
            className="ml-auto bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)] text-white h-8"
            onClick={() => setNewLeadOpen(true)}
            data-testid="button-new-lead"
          >
            <UserPlus className="w-4 h-4 mr-1.5" />
            New Lead
          </Button>
        </div>

        {/* Intake helper banner for job channels */}
        {jobChannel && (
          <div className="mx-4 mt-3 rounded-lg border border-[hsl(var(--titan-blue))]/30 bg-[hsl(var(--titan-blue))]/5 px-3 py-2 text-xs">
            <p className="flex items-center gap-1.5 font-medium text-[hsl(var(--titan-blue))]">
              <Sparkles className="w-3.5 h-3.5" />Post a job here to create a {marketFor(activeChannel?.name)} job file
            </p>
            <p className="text-muted-foreground mt-1">
              Use labels: <span className="font-mono">Job #</span>, <span className="font-mono">Name</span>, <span className="font-mono">Number</span>, <span className="font-mono">Address</span>, <span className="font-mono">Email</span>, <span className="font-mono">Insurance</span>, <span className="font-mono">Claim #</span>, <span className="font-mono">Description of Loss</span>, <span className="font-mono">Referral Source</span>. You'll get a "Create job file" button on the message.
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

      <NewLeadDialog
        channelId={channelId}
        open={newLeadOpen}
        onOpenChange={setNewLeadOpen}
      />

      {jobDialogMsg && channelId && (
        <CreateJobDialog
          channelId={channelId}
          channelName={activeChannel?.name || ""}
          message={jobDialogMsg}
          open={!!jobDialogMsg}
          onOpenChange={(v) => { if (!v) setJobDialogMsg(null); }}
        />
      )}

      {/* Manage members */}
      <Dialog open={!!manageChannel} onOpenChange={(o) => { if (!o) setManageChannel(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>#{manageChannel?.name} — Members</DialogTitle>
            <DialogDescription>Check anyone who should see this channel. Uncheck everyone to make it public.</DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto border rounded-md p-2 space-y-1">
            {activeEmployees.map(emp => (
              <label key={emp.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-muted cursor-pointer text-sm">
                <Checkbox
                  checked={manageMemberIds.includes(emp.id)}
                  onCheckedChange={(chk) => {
                    setManageMemberIds(prev => chk ? [...prev, emp.id] : prev.filter(x => x !== emp.id));
                  }}
                  data-testid={`checkbox-manage-${emp.id}`}
                />
                <span className="flex-1">{emp.name}</span>
                <span className="text-xs text-muted-foreground capitalize">{emp.role}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageChannel(null)}>Cancel</Button>
            <Button onClick={() => updateMembers.mutate()} disabled={updateMembers.isPending} data-testid="button-save-members">
              {updateMembers.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={!!renameChannel} onOpenChange={(o) => { if (!o) { setRenameChannel(null); setRenameValue(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename #{renameChannel?.name}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            placeholder="new-name"
            data-testid="input-rename-channel"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameChannel(null)}>Cancel</Button>
            <Button
              onClick={() => renameChannelMut.mutate()}
              disabled={!renameValue.trim() || renameValue.trim() === renameChannel?.name || renameChannelMut.isPending}
              data-testid="button-save-rename"
            >
              {renameChannelMut.isPending ? "Saving…" : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteChannel} onOpenChange={(o) => { if (!o) setDeleteChannel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete #{deleteChannel?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the channel and every message posted in it. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteChannelMut.mutate()}
              data-testid="button-confirm-delete-channel"
            >
              {deleteChannelMut.isPending ? "Deleting…" : "Delete channel"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
