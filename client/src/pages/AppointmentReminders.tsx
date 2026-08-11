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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CalendarClock, Plus, Send, CheckCircle, Clock, AlertTriangle, MessageSquare } from "lucide-react";
import { fmtDateShort } from "@/lib/dates";

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  sent: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  cancelled: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

const DEFAULT_MESSAGES: Record<string, string> = {
  "24h": "Hi {name}, this is Titan Restoration LLC confirming your appointment tomorrow at {time}. Our tech will be on-site to continue your restoration work. Questions? Call 706-922-0154.",
  "2h": "Hi {name}, Titan Restoration here — your tech is on the way and will arrive in approximately 2 hours. Call 706-922-0154 with any questions.",
  "custom": "Hi {name}, this is Titan Restoration LLC with an appointment reminder. Please call 706-922-0154 if you need to reschedule.",
};

export default function AppointmentReminders() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ jobId: "", scheduledFor: "", contactName: "", contactPhone: "", contactEmail: "", reminderType: "24h", channel: "sms", messageBody: "" });

  const { data: reminders = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/appointment-reminders"], queryFn: () => apiRequest("/api/appointment-reminders").then(r => r.json()) });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("/api/jobs").then(r => r.json()) });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/appointment-reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/appointment-reminders"] }); setOpen(false); resetForm(); toast({ title: "Reminder scheduled" }); },
  });

  const sendMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/appointment-reminders/${id}/send`, { method: "POST" }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/appointment-reminders"] }); toast({ title: "Reminder marked as sent" }); },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/appointment-reminders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled" }) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/appointment-reminders"] }); toast({ title: "Reminder cancelled" }); },
  });

  function resetForm() { setForm({ jobId: "", scheduledFor: "", contactName: "", contactPhone: "", contactEmail: "", reminderType: "24h", channel: "sms", messageBody: "" }); }

  function handleReminderTypeChange(type: string) {
    setForm(f => ({ ...f, reminderType: type, messageBody: DEFAULT_MESSAGES[type] || "" }));
  }

  const scheduled = reminders.filter((r: any) => r.status === "scheduled").length;
  const sent = reminders.filter((r: any) => r.status === "sent").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-primary" /> Homeowner Appointment Reminders
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Automated 24-hour and 2-hour reminders reduce no-shows — which cost up to 15% of scheduled revenue</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="button-new-reminder"><Plus className="w-4 h-4 mr-2" />Schedule Reminder</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Schedule Appointment Reminder</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Job</Label>
                  <Select value={form.jobId} onValueChange={v => {
                    const job = jobs.find((j: any) => String(j.id) === v);
                    setForm(f => ({ ...f, jobId: v, contactName: job?.contact || f.contactName }));
                  }}>
                    <SelectTrigger data-testid="select-job"><SelectValue placeholder="Select job" /></SelectTrigger>
                    <SelectContent>{jobs.map((j: any) => <SelectItem key={j.id} value={String(j.id)}>TP-{String(j.id).padStart(4, "0")} — {j.address?.substring(0, 18) || "N/A"}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Appointment Date/Time</Label>
                  <Input data-testid="input-scheduled-for" type="datetime-local" value={form.scheduledFor} onChange={e => setForm({ ...form, scheduledFor: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Homeowner Name</Label><Input data-testid="input-contact-name" value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} /></div>
                <div><Label>Phone</Label><Input data-testid="input-contact-phone" value={form.contactPhone} onChange={e => setForm({ ...form, contactPhone: e.target.value })} placeholder="(706) 000-0000" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Reminder Type</Label>
                  <Select value={form.reminderType} onValueChange={handleReminderTypeChange}>
                    <SelectTrigger data-testid="select-reminder-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24h">24 Hours Before</SelectItem>
                      <SelectItem value="2h">2 Hours Before</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Channel</Label>
                  <Select value={form.channel} onValueChange={v => setForm({ ...form, channel: v })}>
                    <SelectTrigger data-testid="select-channel"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sms">SMS</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Message</Label>
                <Textarea data-testid="input-message" value={form.messageBody || DEFAULT_MESSAGES[form.reminderType] || ""} onChange={e => setForm({ ...form, messageBody: e.target.value })} rows={3} />
                <p className="text-xs text-muted-foreground mt-1">Variables: {"{name}"} {"{time}"}</p>
              </div>
              <Button className="w-full" data-testid="button-create-reminder" disabled={!form.jobId || !form.scheduledFor || createMutation.isPending}
                onClick={() => createMutation.mutate({ ...form, jobId: parseInt(form.jobId), messageBody: form.messageBody || DEFAULT_MESSAGES[form.reminderType] })}>
                Schedule Reminder
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Scheduled", value: scheduled, icon: Clock, color: "text-blue-500" },
          { label: "Sent", value: sent, icon: CheckCircle, color: "text-green-500" },
          { label: "Total Created", value: reminders.length, icon: CalendarClock, color: "text-primary" },
        ].map(kpi => (
          <Card key={kpi.label}><CardContent className="p-4 flex items-center gap-3"><kpi.icon className={`w-8 h-8 ${kpi.color}`} /><div><p className="text-xs text-muted-foreground">{kpi.label}</p><p className="text-lg font-bold">{kpi.value}</p></div></CardContent></Card>
        ))}
      </div>

      <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
        <CardContent className="p-3 text-xs text-amber-800 dark:text-amber-400">
          <b>No-show impact:</b> Industry research (C&R Magazine 2026) shows automated appointment reminders reduce no-shows by up to 60%, recovering up to 15% of scheduled revenue that would otherwise be lost to missed appointments.
        </CardContent>
      </Card>

      {isLoading ? <p className="text-center py-8 text-muted-foreground">Loading...</p> : reminders.length === 0 ? (
        <Card><CardContent className="py-16 text-center"><CalendarClock className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-30" /><p className="text-muted-foreground">No reminders yet. Schedule your first one for an upcoming appointment.</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {reminders.map((r: any) => {
            const job = jobs.find((j: any) => j.id === r.job_id);
            return (
              <Card key={r.id} data-testid={`reminder-${r.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {job && <span className="font-mono text-sm font-bold">TP-{String(job.id).padStart(4, "0")}</span>}
                        <Badge className={STATUS_COLORS[r.status] || ""}>{r.status}</Badge>
                        <Badge variant="outline">{r.reminder_type === "24h" ? "24hr" : r.reminder_type === "2h" ? "2hr" : "Custom"}</Badge>
                        <Badge variant="outline">{r.channel?.toUpperCase()}</Badge>
                      </div>
                      <p className="text-sm font-medium mt-1">{r.contact_name || "Homeowner"} {r.contact_phone && `· ${r.contact_phone}`}</p>
                      <p className="text-xs text-muted-foreground">{r.scheduled_for ? fmtDateShort(r.scheduled_for) : "Time not set"}</p>
                      {r.message_body && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{r.message_body}</p>}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {r.status === "scheduled" && (
                        <>
                          <Button size="sm" onClick={() => sendMutation.mutate(r.id)} disabled={sendMutation.isPending} data-testid={`button-send-${r.id}`}>
                            <Send className="w-3 h-3 mr-1" />Mark Sent
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => cancelMutation.mutate(r.id)} data-testid={`button-cancel-${r.id}`}>Cancel</Button>
                        </>
                      )}
                      {r.sent_at && <p className="text-xs text-muted-foreground self-center">Sent {fmtDateShort(r.sent_at)}</p>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
