import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  MailWarning, Send, Play, Clock, CheckCircle2, AlertCircle,
  History, Settings2, DollarSign, Inbox,
} from "lucide-react";

const money = (n: number) =>
  "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const toneStyle: Record<string, string> = {
  friendly: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  firm: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  urgent: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  final: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

interface QueueItem {
  invoiceId: number;
  invoiceNumber: string;
  contactId: number | null;
  contactName: string | null;
  toEmail: string | null;
  amount: number;
  dueDate: string | null;
  daysOverdue: number;
  step: { days: number; tone: string; label: string };
  alreadySent: boolean;
}

export default function PaymentReminders() {
  const { toast } = useToast();
  const [editSteps, setEditSteps] = useState<{ days: number; tone: string; label: string }[] | null>(null);

  const { data: queueData, isLoading } = useQuery<{ settings: any; queue: QueueItem[] }>({
    queryKey: ["/api/reminders/queue"],
    queryFn: () => apiRequest("/api/reminders/queue").then((r) => r.json()),
  });
  const { data: settings } = useQuery<any>({
    queryKey: ["/api/reminders/settings"],
    queryFn: () => apiRequest("/api/reminders/settings").then((r) => r.json()),
  });
  const { data: history = [] } = useQuery<any[]>({
    queryKey: ["/api/reminders/history"],
    queryFn: () => apiRequest("/api/reminders/history").then((r) => r.json()),
  });

  const queue = queueData?.queue ?? [];
  const pending = queue.filter((q) => !q.alreadySent);
  const totalPendingAmount = pending.reduce((s, q) => s + (q.amount || 0), 0);

  const sendOne = useMutation({
    mutationFn: (item: QueueItem) =>
      apiRequest("/api/reminders/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: item.invoiceId, stepDays: item.step.days }),
      }).then((r) => r.json()),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reminders/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reminders/history"] });
      toast({
        title: r.status === "sent" ? "Reminder sent" : "Logged (no email on file)",
        description: r.status === "sent" ? `Emailed ${r.toEmail}` : "Customer has no email address — recorded but not delivered.",
      });
    },
    onError: () => toast({ title: "Could not send reminder", variant: "destructive" }),
  });

  const runAll = useMutation({
    mutationFn: () =>
      apiRequest("/api/reminders/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).then((r) => r.json()),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reminders/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reminders/history"] });
      if (r.disabled) toast({ title: "Reminders are turned off", description: "Enable the engine in Settings to send.", variant: "destructive" });
      else toast({ title: `Sent ${r.count} reminder${r.count !== 1 ? "s" : ""}`, description: `${r.considered} invoice(s) evaluated.` });
    },
    onError: () => toast({ title: "Engine error", variant: "destructive" }),
  });

  const saveSettings = useMutation({
    mutationFn: (patch: any) =>
      apiRequest("/api/reminders/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reminders/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reminders/queue"] });
      setEditSteps(null);
      toast({ title: "Cadence saved" });
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <MailWarning className="w-5 h-5 text-[hsl(var(--titan-red))]" /> Payment Reminders
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automated dunning emails escalate as invoices age past due — pulls cash forward without manual collection calls.
          </p>
        </div>
        <Button
          onClick={() => runAll.mutate()}
          disabled={runAll.isPending || pending.length === 0}
          data-testid="button-run-reminders"
          className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))]"
        >
          <Play className="w-4 h-4 mr-2" />
          {runAll.isPending ? "Sending..." : `Send All Due (${pending.length})`}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-xl font-bold" data-testid="stat-pending-count">{pending.length}</p>
              <p className="text-xs text-muted-foreground">Reminders due now</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-xl font-bold" data-testid="stat-pending-amount">{money(totalPendingAmount)}</p>
              <p className="text-xs text-muted-foreground">Overdue balance in queue</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
              <History className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xl font-bold" data-testid="stat-sent-total">{history.length}</p>
              <p className="text-xs text-muted-foreground">Reminders sent (all time)</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center">
              {settings?.enabled ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <Clock className="w-5 h-5 text-muted-foreground" />}
            </div>
            <div>
              <p className="text-sm font-semibold" data-testid="stat-engine-state">{settings?.enabled ? "Active" : "Paused"}</p>
              <p className="text-xs text-muted-foreground">Reminder engine</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cadence settings */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings2 className="w-4 h-4" /> Reminder Cadence
            </CardTitle>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Engine</span>
                <Switch
                  checked={!!settings?.enabled}
                  onCheckedChange={(v) => saveSettings.mutate({ enabled: v })}
                  data-testid="switch-engine-enabled"
                />
              </div>
              {editSteps ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setEditSteps(null)} data-testid="button-cancel-cadence">Cancel</Button>
                  <Button size="sm" onClick={() => saveSettings.mutate({ steps: editSteps })} data-testid="button-save-cadence">Save</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setEditSteps(settings?.steps ?? [])} data-testid="button-edit-cadence">Edit</Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(editSteps ?? settings?.steps ?? []).map((st: any, i: number) => (
              <div key={i} className="border rounded-md p-3" data-testid={`cadence-step-${i}`}>
                <Badge className={`mb-2 ${toneStyle[st.tone] || ""}`}>{st.label}</Badge>
                {editSteps ? (
                  <div className="space-y-1">
                    <Label className="text-xs">Days past due</Label>
                    <Input
                      type="number"
                      value={st.days}
                      data-testid={`input-step-days-${i}`}
                      onChange={(e) => {
                        const next = [...editSteps];
                        next[i] = { ...next[i], days: parseInt(e.target.value || "0") };
                        setEditSteps(next);
                      }}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-foreground">
                    Fires at <span className="font-semibold">{st.days} days</span> past due
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Each invoice gets at most one email per step. Reminders escalate in tone as the balance ages.
          </p>
        </CardContent>
      </Card>

      {/* Due queue */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Inbox className="w-4 h-4" /> Reminder Queue
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading queue…</p>
          ) : queue.length === 0 ? (
            <div className="text-center py-10">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-medium">All caught up</p>
              <p className="text-xs text-muted-foreground">No invoices are past due enough to trigger a reminder.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {queue.map((item) => (
                <div
                  key={`${item.invoiceId}-${item.step.days}`}
                  className="flex items-center justify-between gap-3 border rounded-md p-3 flex-wrap"
                  data-testid={`queue-row-${item.invoiceId}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge className={toneStyle[item.step.tone] || ""}>{item.step.label}</Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {item.invoiceNumber} · {money(item.amount)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.contactName || "Unknown customer"}
                        {item.toEmail ? ` · ${item.toEmail}` : " · no email on file"}
                        {" · "}
                        <span className="text-red-600 dark:text-red-400 font-medium">{item.daysOverdue} days overdue</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.alreadySent ? (
                      <Badge variant="outline" className="gap-1" data-testid={`badge-sent-${item.invoiceId}`}>
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Sent
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendOne.mutate(item)}
                        disabled={sendOne.isPending}
                        data-testid={`button-send-${item.invoiceId}`}
                      >
                        <Send className="w-3.5 h-3.5 mr-1.5" /> Send now
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="w-4 h-4" /> Sent History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No reminders sent yet.</p>
          ) : (
            <div className="space-y-1.5">
              {history.slice(0, 50).map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 text-sm py-1.5 border-b last:border-0 flex-wrap" data-testid={`history-row-${h.id}`}>
                  <div className="min-w-0">
                    <span className="font-medium">{h.invoice_number || `#${h.invoice_id}`}</span>
                    <span className="text-muted-foreground"> · {h.contact_name || "—"} · {h.to_email || "no email"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{h.days_overdue}d · step {h.step_days}</span>
                    {h.status === "sent" ? (
                      <Badge variant="outline" className="text-emerald-600 border-emerald-200">Delivered</Badge>
                    ) : (
                      <Badge variant="outline" className="text-amber-600 border-amber-200">No email</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">{h.sent_at ? new Date(h.sent_at).toLocaleDateString() : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
