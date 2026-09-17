// InboundLeadsCard.tsx (Push 6 #6)
//
// Compact card for Marketing Today showing today's inbound leads with a
// quick-log button. Renders 5th action card next to Reviews / Partners /
// Storm / Untagged.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { PhoneIncoming, Plus, ArrowUpRight, Phone, MessageCircle } from "lucide-react";
import { Link } from "wouter";

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

export default function InboundLeadsCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState({
    source: "phone",
    callerName: "",
    callerPhone: "",
    lossType: "water",
    urgency: "normal",
    notes: "",
  });

  // last 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: leads = [] } = useQuery<any[]>({
    queryKey: ["/api/inbound-leads", { since }],
    queryFn: () => apiRequest("GET", `/api/inbound-leads?since=${encodeURIComponent(since)}`).then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/inbound-leads", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbound-leads"] });
      toast({ title: "Lead logged", description: "Added to today's queue." });
      setDialogOpen(false);
      setDraft({ source: "phone", callerName: "", callerPhone: "", lossType: "water", urgency: "normal", notes: "" });
    },
    onError: (e: any) => toast({ title: "Couldn't log lead", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/inbound-leads/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/inbound-leads"] }),
  });

  const openCount = leads.filter((l) => l.status === "open").length;
  const emergencyCount = leads.filter((l) => l.urgency === "emergency" && l.status === "open").length;

  return (
    <Card data-testid="queue-leads">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <PhoneIncoming className="w-4 h-4" />
            Today's inbound leads
            {emergencyCount > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 h-4">
                {emergencyCount} emergency
              </Badge>
            )}
          </CardTitle>
          <div className="flex gap-1">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" data-testid="button-log-lead">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Log
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
                          <SelectItem value="phone">Phone</SelectItem>
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
                  <div>
                    <Label>Caller phone</Label>
                    <Input value={draft.callerPhone} onChange={(e) => setDraft({ ...draft, callerPhone: e.target.value })} placeholder="(706) 555-0123" />
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
                    <Input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="What happened, any details" />
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
            <Link href="/inbound-leads">
              <Button variant="ghost" size="sm">
                All <ArrowUpRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {leads.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No leads in the last 24 hours. Tap Log when a call comes in.
          </p>
        ) : (
          <>
            <div className="text-xs text-muted-foreground mb-2">
              {leads.length} in 24h · <span className="font-medium text-foreground">{openCount}</span> open
            </div>
            <ul className="space-y-1.5">
              {leads.slice(0, 5).map((l) => {
                const tel = telHref(l.callerPhone);
                const sms = smsHref(l.callerPhone);
                return (
                  <li key={l.id} className="flex items-center justify-between text-sm py-1 gap-2 border-b last:border-0 pb-1.5" data-testid={`lead-item-${l.id}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium truncate">{l.callerName || "Unknown caller"}</span>
                        {l.urgency === "emergency" && <Badge variant="destructive" className="text-[9px] px-1 h-3.5">EMERGENCY</Badge>}
                        {l.urgency === "urgent" && <Badge className="text-[9px] px-1 h-3.5 bg-amber-500">Urgent</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {l.source} · {l.lossType || "—"} · {l.status}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {tel && (
                        <a href={tel}>
                          <Button size="sm" variant="outline" className="h-7 w-7 p-0" data-testid={`lead-call-${l.id}`}>
                            <Phone className="w-3 h-3" />
                          </Button>
                        </a>
                      )}
                      {sms && (
                        <a href={sms}>
                          <Button size="sm" variant="outline" className="h-7 w-7 p-0" data-testid={`lead-sms-${l.id}`}>
                            <MessageCircle className="w-3 h-3" />
                          </Button>
                        </a>
                      )}
                      {l.status === "open" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => statusMutation.mutate({ id: l.id, status: "contacted" })}
                          data-testid={`lead-done-${l.id}`}
                        >
                          ✓
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
