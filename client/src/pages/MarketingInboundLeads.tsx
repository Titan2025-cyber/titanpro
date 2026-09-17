// MarketingInboundLeads.tsx (Push 6 #6)
//
// Full lead queue with filters, quick-log, convert-to-job button, and status
// tracking. Bar-list layout — one lead per row, wide-open on desktop,
// wraps clean on phones.
//
// Deliberately does NOT auto-send anything. Rep decides what happens to a
// lead. Convert-to-job seeds a draft job file the rep still has to fill in.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  PhoneIncoming, Plus, Phone, MessageCircle, ArrowRight, Filter,
} from "lucide-react";

const telHref = (raw?: string | null) => {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  return `tel:${digits.length === 10 ? "+1" + digits : "+" + digits}`;
};
const smsHref = (raw?: string | null) => {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  return `sms:${digits.length === 10 ? "+1" + digits : "+" + digits}`;
};

const fmtRelative = (iso: string) => {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function MarketingInboundLeads() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState({
    source: "phone",
    callerName: "",
    callerPhone: "",
    callerEmail: "",
    propertyAddress: "",
    lossType: "water",
    urgency: "normal",
    notes: "",
  });

  const { data: leads = [] } = useQuery<any[]>({
    queryKey: ["/api/inbound-leads"],
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/inbound-leads", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbound-leads"] });
      toast({ title: "Lead logged" });
      setDialogOpen(false);
      setDraft({ source: "phone", callerName: "", callerPhone: "", callerEmail: "", propertyAddress: "", lossType: "water", urgency: "normal", notes: "" });
    },
    onError: (e: any) => toast({ title: "Couldn't log lead", description: e.message, variant: "destructive" }),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: any }) =>
      apiRequest("PATCH", `/api/inbound-leads/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/inbound-leads"] }),
  });

  const filtered = leads.filter((l) => {
    if (statusFilter !== "all" && l.status !== statusFilter) return false;
    if (sourceFilter !== "all" && l.source !== sourceFilter) return false;
    return true;
  });

  // Convert to job — jumps to Jobs page with lead data pre-filled via query params
  const convertToJob = (lead: any) => {
    const params = new URLSearchParams({
      fromLead: String(lead.id),
      name: lead.callerName || "",
      phone: lead.callerPhone || "",
      email: lead.callerEmail || "",
      address: lead.propertyAddress || "",
      lossType: lead.lossType || "",
      description: lead.notes || "",
    });
    // Mark lead as converted first
    patchMutation.mutate({ id: lead.id, patch: { status: "converted", convertedAt: new Date().toISOString() } });
    navigate(`/jobs?${params.toString()}`);
  };

  const openCount = leads.filter((l) => l.status === "open").length;
  const contactedCount = leads.filter((l) => l.status === "contacted").length;
  const convertedCount = leads.filter((l) => l.status === "converted").length;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <PhoneIncoming className="w-6 h-6" />
            Inbound Leads
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every call, text, form fill, and walk-in — logged, tracked, converted.
            No auto-send. You decide who becomes a job.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-lead">
              <Plus className="w-4 h-4 mr-1.5" /> Log lead
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Log an inbound lead</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Source</Label>
                  <Select value={draft.source} onValueChange={(v) => setDraft({ ...draft, source: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="phone">Phone call</SelectItem>
                      <SelectItem value="web_form">Web form</SelectItem>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="referral">Referral</SelectItem>
                      <SelectItem value="walk_in">Walk-in</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Urgency</Label>
                  <Select value={draft.urgency} onValueChange={(v) => setDraft({ ...draft, urgency: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="emergency">Emergency</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="quote">Just a quote</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Caller name</Label>
                <Input value={draft.callerName} onChange={(e) => setDraft({ ...draft, callerName: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Phone</Label>
                  <Input value={draft.callerPhone} onChange={(e) => setDraft({ ...draft, callerPhone: e.target.value })} placeholder="(706) 555-0123" />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input value={draft.callerEmail} onChange={(e) => setDraft({ ...draft, callerEmail: e.target.value })} placeholder="name@example.com" />
                </div>
              </div>
              <div>
                <Label>Property address</Label>
                <Input value={draft.propertyAddress} onChange={(e) => setDraft({ ...draft, propertyAddress: e.target.value })} />
              </div>
              <div>
                <Label>Loss type</Label>
                <Select value={draft.lossType} onValueChange={(v) => setDraft({ ...draft, lossType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="water">Water</SelectItem>
                    <SelectItem value="fire">Fire</SelectItem>
                    <SelectItem value="mold">Mold</SelectItem>
                    <SelectItem value="storm">Storm</SelectItem>
                    <SelectItem value="biohazard">Biohazard</SelectItem>
                    <SelectItem value="reconstruction">Reconstruction</SelectItem>
                    <SelectItem value="unknown">Not sure yet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Description of loss, what they said, follow-up needed" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={() => createMutation.mutate({ ...draft, receivedAt: new Date().toISOString() })}
                disabled={createMutation.isPending}
                data-testid="button-save-lead"
              >
                Log lead
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filter strip */}
      <Card>
        <CardContent className="p-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-sm">
            <Filter className="w-3.5 h-3.5" />
            <span className="text-muted-foreground">Filters:</span>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses ({leads.length})</SelectItem>
              <SelectItem value="open">Open ({openCount})</SelectItem>
              <SelectItem value="contacted">Contacted ({contactedCount})</SelectItem>
              <SelectItem value="converted">Converted ({convertedCount})</SelectItem>
              <SelectItem value="lost">Lost</SelectItem>
              <SelectItem value="junk">Junk / no-op</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[140px] h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="phone">Phone</SelectItem>
              <SelectItem value="web_form">Web form</SelectItem>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="referral">Referral</SelectItem>
              <SelectItem value="walk_in">Walk-in</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto text-sm text-muted-foreground">
            Showing {filtered.length} of {leads.length}
          </div>
        </CardContent>
      </Card>

      {/* Lead list */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              {leads.length === 0
                ? "No leads logged yet. Tap Log lead when the first one comes in."
                : "No leads match those filters."}
            </CardContent>
          </Card>
        ) : (
          filtered.map((l) => {
            const tel = telHref(l.callerPhone);
            const sms = smsHref(l.callerPhone);
            return (
              <Card key={l.id} data-testid={`lead-${l.id}`}>
                <CardContent className="p-3 md:p-4">
                  <div className="flex flex-col md:flex-row md:items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{l.callerName || "Unknown caller"}</span>
                        {l.urgency === "emergency" && <Badge variant="destructive" className="text-[10px] px-1.5 h-4">EMERGENCY</Badge>}
                        {l.urgency === "urgent" && <Badge className="text-[10px] px-1.5 h-4 bg-amber-500">Urgent</Badge>}
                        <Badge variant="outline" className="text-[10px] px-1.5 h-4 capitalize">{l.source?.replace("_", " ")}</Badge>
                        <Badge variant="outline" className="text-[10px] px-1.5 h-4 capitalize">{l.lossType}</Badge>
                        <Badge
                          className={`text-[10px] px-1.5 h-4 capitalize ${
                            l.status === "open"
                              ? "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30"
                              : l.status === "contacted"
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
                              : l.status === "converted"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {l.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                        <span>{fmtRelative(l.receivedAt)}</span>
                        {l.callerPhone && <span>· {l.callerPhone}</span>}
                        {l.propertyAddress && <span>· {l.propertyAddress}</span>}
                      </div>
                      {l.notes && (
                        <p className="text-sm mt-2 text-foreground/80 line-clamp-2">{l.notes}</p>
                      )}
                    </div>

                    <div className="flex gap-1.5 shrink-0 flex-wrap">
                      {tel && (
                        <a href={tel}>
                          <Button size="sm" variant="outline" className="h-8" data-testid={`call-${l.id}`}>
                            <Phone className="w-3.5 h-3.5 mr-1" /> Call
                          </Button>
                        </a>
                      )}
                      {sms && (
                        <a href={sms}>
                          <Button size="sm" variant="outline" className="h-8" data-testid={`sms-${l.id}`}>
                            <MessageCircle className="w-3.5 h-3.5 mr-1" /> Text
                          </Button>
                        </a>
                      )}
                      {l.status === "open" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => patchMutation.mutate({ id: l.id, patch: { status: "contacted", contactedAt: new Date().toISOString() } })}
                          data-testid={`mark-contacted-${l.id}`}
                        >
                          Mark contacted
                        </Button>
                      )}
                      {(l.status === "open" || l.status === "contacted") && (
                        <Button
                          size="sm"
                          className="h-8"
                          onClick={() => convertToJob(l)}
                          data-testid={`convert-${l.id}`}
                        >
                          Convert to job <ArrowRight className="w-3.5 h-3.5 ml-1" />
                        </Button>
                      )}
                      {l.status !== "junk" && l.status !== "lost" && l.status !== "converted" && (
                        <Select
                          value=""
                          onValueChange={(v) => patchMutation.mutate({ id: l.id, patch: { status: v } })}
                        >
                          <SelectTrigger className="h-8 w-[100px]"><SelectValue placeholder="More…" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="lost">Mark lost</SelectItem>
                            <SelectItem value="junk">Mark junk</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
