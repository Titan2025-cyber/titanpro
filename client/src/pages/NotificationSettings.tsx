import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Bell, BellOff, Mail, MessageSquare, CheckCircle2,
  Briefcase, Droplets, AlertCircle, Check, CheckCheck, Trash2, Inbox,
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { fmtDateShort } from "@/lib/dates";
import { useAuth } from "@/lib/auth";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Notifications page — reached from Settings.
 *
 * Two tabs:
 *  1. Preferences — the per-user event × channel matrix (in-app / email / sms).
 *  2. Inbox       — the signed-in user's own in-app notification stream. This
 *                   is what /tech-notifications used to be, but scoped to the
 *                   current user via useAuth() instead of a "which tech?"
 *                   dropdown. The old route still resolves.
 *
 * The SMS column is disabled with a "coming soon" label until we wire up an
 * SMS transport. Event and channel definitions come from the backend so
 * they only ever change in one place (server/notify_prefs.ts).
 */

type Channel = "bell" | "email" | "sms";
type EventKey = string;
type MatrixRow = { event: EventKey; channels: Record<Channel, boolean> };

const EVENT_LABELS: Record<string, { label: string; description: string }> = {
  shift_assigned:  { label: "Shift assigned",   description: "You're placed on a job shift on the Scheduling page." },
  mentioned:       { label: "@Mentioned in a note", description: "Someone tags @you in a job note or comment." },
  event_tagged:    { label: "Tagged on an event", description: "You're added to a calendar event on the Scheduling page." },
  invoice_paid:    { label: "Invoice paid",      description: "An invoice you own is marked paid." },
  invoice_overdue: { label: "Invoice overdue",   description: "An invoice you own passes its due date without payment." },
  drying_missed:   { label: "Drying benchmark missed", description: "A job you own passes IICRC 3-day drying without completion." },
};

const CHANNEL_LABELS: Record<Channel, { label: string; icon: any; note?: string }> = {
  bell:  { label: "In-app", icon: Bell },
  email: { label: "Email",  icon: Mail },
  sms:   { label: "SMS",    icon: MessageSquare, note: "Coming soon" },
};

// ─── Preferences tab (event × channel matrix) ─────────────────────────────
function PreferencesTab() {
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [events, setEvents] = useState<EventKey[]>([]);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/notify/preferences", { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setMatrix(json.matrix || []);
        setEvents(json.events || []);
      } catch (e: any) {
        toast({ title: "Couldn't load preferences", description: e.message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  const toggle = (event: EventKey, channel: Channel, value: boolean) => {
    if (channel === "sms") return; // Disabled until SMS transport is wired.
    setMatrix((prev) => prev.map((row) =>
      row.event === event ? { ...row, channels: { ...row.channels, [channel]: value } } : row
    ));
    setDirty((prev) => ({ ...prev, [`${channel}:${event}`]: true }));
  };

  const dirtyCount = Object.keys(dirty).length;

  const save = async () => {
    setSaving(true);
    const updates: any[] = [];
    for (const key of Object.keys(dirty)) {
      const [channel, event] = key.split(":") as [Channel, EventKey];
      const row = matrix.find(r => r.event === event);
      if (!row) continue;
      updates.push({ channel, event, enabled: row.channels[channel] });
    }
    try {
      const res = await fetch("/api/notify/preferences", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setMatrix(json.matrix || matrix);
      setDirty({});
      setSavedAt(Date.now());
      toast({ title: "Preferences saved", description: `${updates.length} change${updates.length === 1 ? "" : "s"} applied.` });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const rows = useMemo(() => {
    return events.map(evt => matrix.find(r => r.event === evt)).filter(Boolean) as MatrixRow[];
  }, [events, matrix]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Choose which alerts you want, and where. In-app bell notifications keep the alert
        panel current; email is optional per event.
      </p>

      {loading ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading preferences…</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border/60 bg-muted/40">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Notification</th>
                    {(Object.keys(CHANNEL_LABELS) as Channel[]).map((ch) => {
                      const meta = CHANNEL_LABELS[ch];
                      const Icon = meta.icon;
                      return (
                        <th key={ch} className="text-center px-4 py-3 font-medium text-muted-foreground w-24">
                          <div className="inline-flex items-center gap-1.5">
                            <Icon className="w-3.5 h-3.5" /> {meta.label}
                          </div>
                          {meta.note && (
                            <div className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground/70">
                              {meta.note}
                            </div>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const meta = EVENT_LABELS[row.event] || { label: row.event, description: "" };
                    return (
                      <tr key={row.event} className="border-b border-border/40 last:border-b-0">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{meta.label}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">{meta.description}</div>
                        </td>
                        {(Object.keys(CHANNEL_LABELS) as Channel[]).map((ch) => (
                          <td key={ch} className="px-4 py-3 text-center">
                            <div className="inline-flex items-center justify-center">
                              <Switch
                                checked={!!row.channels[ch]}
                                disabled={ch === "sms"}
                                onCheckedChange={(v) => toggle(row.event, ch, v)}
                                aria-label={`${meta.label} — ${CHANNEL_LABELS[ch].label}`}
                              />
                            </div>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {savedAt && dirtyCount === 0 && (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-green-600" /> Saved
            </span>
          )}
        </div>
        <Button onClick={save} disabled={dirtyCount === 0 || saving}>
          {saving ? "Saving…" : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount === 1 ? "" : "s"}` : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ─── Inbox tab (in-app alerts, scoped to current user) ────────────────────
const TYPE_ICONS: Record<string, any> = {
  assignment: Briefcase,
  drying_alert: Droplets,
  message: MessageSquare,
  follow_up: AlertCircle,
  general: Bell,
};

const TYPE_COLORS: Record<string, string> = {
  assignment: "text-[hsl(var(--titan-blue))] bg-[hsl(var(--titan-blue)/0.1)]",
  drying_alert: "text-orange-600 bg-orange-100",
  message: "text-green-600 bg-green-100",
  follow_up: "text-yellow-600 bg-yellow-100",
  general: "text-gray-600 bg-gray-100",
};

function InboxTab() {
  const { user } = useAuth();
  const { toast } = useToast();

  // Prefer the current user's full name; fall back to a placeholder that
  // will simply return an empty list from the backend rather than showing
  // some other tech's notifications.
  const who = (user?.name || "").trim() || "__unknown__";
  const enabled = who !== "__unknown__";

  const { data: notifications = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/tech-notifications", who],
    queryFn: () => apiRequest("GET", `/api/tech-notifications/${encodeURIComponent(who)}`).then(r => r.json()),
    enabled,
  });

  const readMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/tech-notifications/${id}/read`, {}).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tech-notifications", who] });
    },
  });

  const readAllMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/tech-notifications/${encodeURIComponent(who)}/read-all`, {}).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tech-notifications", who] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/tech-notifications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tech-notifications", who] });
      toast({ title: "Notification deleted" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const unread = notifications.filter((n: any) => !n.read).length;

  if (!enabled) {
    return (
      <Card><CardContent className="p-6 text-sm text-muted-foreground">
        Sign in to view your notifications.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            In-app alerts for job assignments, drying alerts, and follow-ups.
          </p>
          {unread > 0 && (
            <Badge variant="destructive" className="text-xs">{unread} unread</Badge>
          )}
        </div>
        {unread > 0 && (
          <Button variant="outline" size="sm" onClick={() => readAllMutation.mutate()} data-testid="button-mark-all-read">
            <CheckCheck className="w-4 h-4 mr-1" />Mark all read
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}
        </div>
      ) : notifications.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <BellOff className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="font-semibold text-foreground">All caught up.</p>
            <p className="text-muted-foreground text-sm mt-1">No notifications for you right now.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((n: any) => {
            const Icon = TYPE_ICONS[n.type] || Bell;
            return (
              <Card
                key={n.id}
                className={`transition-all ${!n.read ? "border-l-4 border-l-[hsl(var(--titan-blue))] shadow-sm" : "opacity-70"}`}
                data-testid={`notification-${n.id}`}
              >
                <CardContent className="p-4 flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${TYPE_COLORS[n.type] || "text-gray-600 bg-gray-100"}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm font-semibold ${!n.read ? "text-foreground" : "text-muted-foreground"}`}>{n.title}</p>
                      {!n.read && <span className="w-2 h-2 rounded-full bg-[hsl(var(--titan-blue))]" />}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{n.body}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {fmtDateShort(n.created_at)}
                      {n.job_id && ` · Job #${n.job_id}`}
                    </p>
                  </div>
                  {!n.read && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => readMutation.mutate(n.id)}
                      className="shrink-0 text-muted-foreground"
                      data-testid={`button-read-${n.id}`}
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-muted-foreground"
                        data-testid={`button-delete-tech-notifications-${n.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this notification?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {n.title ? `"${n.title}" ` : ""}This permanently removes the record and cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteMutation.mutate(n.id)} data-testid={`button-confirm-delete-tech-notifications-${n.id}`}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function NotificationSettings() {
  return (
    <div className="max-w-3xl mx-auto space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Notifications</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your inbox and your preferences, together.
        </p>
      </div>

      <Tabs defaultValue="inbox">
        <TabsList>
          <TabsTrigger value="inbox" data-testid="tab-inbox">
            <Inbox className="w-3.5 h-3.5 mr-1.5" />Inbox
          </TabsTrigger>
          <TabsTrigger value="preferences" data-testid="tab-preferences">
            <Bell className="w-3.5 h-3.5 mr-1.5" />Preferences
          </TabsTrigger>
        </TabsList>
        <TabsContent value="inbox" className="mt-4">
          <InboxTab />
        </TabsContent>
        <TabsContent value="preferences" className="mt-4">
          <PreferencesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
