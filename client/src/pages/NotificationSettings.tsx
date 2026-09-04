import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Bell, Mail, MessageSquare, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Per-user notification preferences page. Reached from the user menu at
 * /notification-settings. Users toggle a matrix of event × channel;
 * the SMS column is disabled with a "coming soon" label until we wire
 * up an SMS transport.
 *
 * The event & channel definitions come from the backend so we only
 * ever have to update the list in one place (server/notify_prefs.ts).
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

export default function NotificationSettings() {
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
    // Preserve backend event order rather than sort locally.
    return events.map(evt => matrix.find(r => r.event === evt)).filter(Boolean) as MatrixRow[];
  }, [events, matrix]);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Notifications</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Choose which alerts you want, and where. In-app bell notifications keep the alert panel current;
          email is optional per event.
        </p>
      </div>

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
