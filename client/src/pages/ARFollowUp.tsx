import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Bell, Plus, Play, CheckCircle, MessageSquare, Mail, Clock } from "lucide-react";

export default function ARFollowUp() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ triggerDays: "15", channel: "sms", messageTemplate: "", isActive: true });

  const { data: rules = [] } = useQuery<any[]>({
    queryKey: ["/api/ar-followup-rules"],
    queryFn: () => apiRequest("/api/ar-followup-rules").then(r => r.json()),
  });

  const [engineResults, setEngineResults] = useState<any[]>([]);
  const [showEngine, setShowEngine] = useState(false);

  const { data: invoices = [] } = useQuery<any[]>({
    queryKey: ["/api/invoices"],
    queryFn: () => apiRequest("/api/invoices").then(r => r.json()),
  });

  const { data: log = [] } = useQuery<any[]>({
    queryKey: ["/api/ar-followup-log"],
    queryFn: () => apiRequest("/api/ar-followup-log").then(r => r.json()).catch(() => []),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/ar-followup-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/ar-followup-rules"] }); setOpen(false); setForm({ triggerDays: "15", channel: "sms", messageTemplate: "", isActive: true }); toast({ title: "Follow-up rule created" }); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: any) => apiRequest(`/api/ar-followup-rules/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/ar-followup-rules"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/ar-followup-rules/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/ar-followup-rules"] }); toast({ title: "Rule deleted" }); },
  });

  const runMutation = useMutation({
    mutationFn: () => apiRequest("GET", "/api/ar-followup-engine").then(r => r.json()),
    onSuccess: (data: any[]) => {
      setEngineResults(data);
      setShowEngine(true);
      toast({ title: `Engine ran — ${data.length} invoice${data.length !== 1 ? "s" : ""} flagged for follow-up` });
    },
    onError: () => toast({ title: "Engine error", description: "Could not run AR engine", variant: "destructive" }),
  });

  const overdueInvoices = invoices.filter((i: any) => i.status !== "paid" && i.status !== "draft");
  const now = new Date();
  const inv15 = overdueInvoices.filter((i: any) => {
    const days = Math.floor((now.getTime() - new Date(i.createdAt || i.created_at || now).getTime()) / 86400000);
    return days >= 15;
  }).length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" /> Automated A/R Follow-Up Engine
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Rule-based follow-up messages fire automatically on overdue invoices — no manual collection calls</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => runMutation.mutate()} disabled={runMutation.isPending} data-testid="button-run-engine">
            {runMutation.isPending ? "Running..." : <><Play className="w-4 h-4 mr-2" />Run Now</>}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-rule"><Plus className="w-4 h-4 mr-2" />New Rule</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>New Follow-Up Rule</DialogTitle></DialogHeader>
              <div className="space-y-4 mt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Trigger (days overdue)</Label>
                    <Input data-testid="input-trigger-days" type="number" value={form.triggerDays} onChange={e => setForm({ ...form, triggerDays: e.target.value })} />
                  </div>
                  <div>
                    <Label>Channel</Label>
                    <Select value={form.channel} onValueChange={v => setForm({ ...form, channel: v })}>
                      <SelectTrigger data-testid="select-channel"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sms">SMS Only</SelectItem>
                        <SelectItem value="email">Email Only</SelectItem>
                        <SelectItem value="both">SMS + Email</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Message Template</Label>
                  <Textarea data-testid="input-template" value={form.messageTemplate} onChange={e => setForm({ ...form, messageTemplate: e.target.value })} rows={4} placeholder="Use {invoice_id}, {amount}, {days} as variables" />
                  <p className="text-xs text-muted-foreground mt-1">Variables: {"{invoice_id}"} {"{amount}"} {"{days}"}</p>
                </div>
                <Button className="w-full" data-testid="button-create-rule" onClick={() => createMutation.mutate({ triggerDays: parseInt(form.triggerDays), channel: form.channel, messageTemplate: form.messageTemplate, isActive: true })} disabled={createMutation.isPending}>
                  Create Rule
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="w-8 h-8 text-yellow-500" />
            <div><p className="text-xs text-muted-foreground">Invoices 15+ Days</p><p className="text-lg font-bold" data-testid="kpi-overdue">{inv15}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle className="w-8 h-8 text-green-500" />
            <div><p className="text-xs text-muted-foreground">Active Rules</p><p className="text-lg font-bold">{rules.filter((r: any) => r.is_active).length}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <MessageSquare className="w-8 h-8 text-blue-500" />
            <div><p className="text-xs text-muted-foreground">Messages Sent</p><p className="text-lg font-bold">{log.length}</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Rules */}
      <Card>
        <CardHeader><CardTitle className="text-base">Follow-Up Rules</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {rules.length === 0 ? (
            <p className="text-center py-6 text-muted-foreground">No rules yet. Default 15/30/45-day rules will be created automatically on first server start.</p>
          ) : rules.map((rule: any) => (
            <div key={rule.id} className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border bg-muted/30" data-testid={`rule-${rule.id}`}>
              <div className="flex items-center gap-3">
                <Switch checked={!!rule.is_active} onCheckedChange={v => toggleMutation.mutate({ id: rule.id, isActive: v })} data-testid={`toggle-rule-${rule.id}`} />
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Day {rule.trigger_days}</Badge>
                    <Badge variant="outline">{rule.channel === "both" ? "SMS + Email" : rule.channel.toUpperCase()}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{rule.message_template}</p>
                </div>
              </div>
              <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => deleteMutation.mutate(rule.id)} data-testid={`delete-rule-${rule.id}`}>Remove</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Engine Results */}
      {showEngine && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Play className="w-4 h-4 text-green-500" />
                Engine Results — {engineResults.length} action{engineResults.length !== 1 ? "s" : ""} flagged
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setShowEngine(false)}>Dismiss</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {engineResults.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">
                <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
                <p>All invoices are current — no follow-ups needed</p>
              </div>
            ) : (
              <div className="divide-y">
                {engineResults.map((item: any, i: number) => (
                  <div key={i} className="p-4" data-testid={`engine-result-${i}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">INV-{String(item.invoice?.id || "").padStart(4, "0")}</Badge>
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">{item.daysOut}d overdue</Badge>
                          <Badge variant="outline">{item.rule?.action?.toUpperCase()}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {item.contact?.name || "Unknown contact"} · ${(item.invoice?.total || 0).toLocaleString()}
                        </p>
                        <p className="text-xs text-foreground mt-1 italic">{item.message}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
