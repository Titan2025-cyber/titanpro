// ─────────────────────────────────────────────────────────────────────────────
// Push 7 · Geofence auto-punch settings
//
// Owner/admin/office UI for the geofence auto-punch feature. Controls whether
// it's enabled, how big the geofence is, dwell timers, business hours, and
// which days of the week it's allowed to fire. Also embeds a recent
// auto-events audit table so the office can see WHY a punch did or didn't
// happen for a given tech.
//
// Design rules preserved from the marketing safety principle: no rep-facing
// UI here — this is for owner / management review. The tech-side experience
// is invisible (poll + toast + undo banner) so training pressure stays low.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Clock, ShieldAlert, ListChecks } from "lucide-react";

type Settings = {
  id: number;
  enabled: 0 | 1 | boolean;
  radius_ft: number;
  enter_dwell_sec: number;
  exit_dwell_sec: number;
  business_hours_start: string;
  business_hours_end: string;
  days_of_week: string;
  require_shift_assignment: 0 | 1 | boolean;
  updated_at?: string;
  updated_by?: string;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function GeofenceSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ["/api/geofence-settings"],
  });

  const [enabled, setEnabled] = useState(false);
  const [radiusFt, setRadiusFt] = useState(300);
  const [enterDwellSec, setEnterDwellSec] = useState(180);
  const [exitDwellSec, setExitDwellSec] = useState(480);
  const [hoursStart, setHoursStart] = useState("06:00");
  const [hoursEnd, setHoursEnd] = useState("20:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [requireShift, setRequireShift] = useState(true);

  useEffect(() => {
    if (!settings) return;
    setEnabled(!!settings.enabled);
    setRadiusFt(settings.radius_ft);
    setEnterDwellSec(settings.enter_dwell_sec);
    setExitDwellSec(settings.exit_dwell_sec);
    setHoursStart(settings.business_hours_start);
    setHoursEnd(settings.business_hours_end);
    setDays(settings.days_of_week.split(",").map(x => parseInt(x.trim(), 10)).filter(Number.isFinite));
    setRequireShift(!!settings.require_shift_assignment);
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("/api/geofence-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled, radiusFt, enterDwellSec, exitDwellSec,
          businessHoursStart: hoursStart,
          businessHoursEnd: hoursEnd,
          daysOfWeek: days.sort((a, b) => a - b).join(","),
          requireShiftAssignment: requireShift,
        }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/geofence-settings"] });
      toast({ title: "Auto-punch settings saved" });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't save", description: e.message, variant: "destructive" });
    },
  });

  const toggleDay = (day: number) => {
    setDays(d => d.includes(day) ? d.filter(x => x !== day) : [...d, day]);
  };

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MapPin className="w-6 h-6" /> Geofence auto-punch
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Automatically clock techs in and out based on GPS proximity to their
          scheduled job site. Works while Titan Pro is open on their phone.
        </p>
      </div>

      {/* ── Honest limitation warning ─────────────────────────────── */}
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="p-4 flex gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground space-y-1">
            <div className="font-medium text-foreground">Web-app limitation</div>
            <div>
              This works while Titan Pro is open on the tech's phone. iOS locks
              JavaScript geolocation the moment the screen turns off or the
              tab is backgrounded, so it will not punch someone in whose phone
              sits in their pocket all day. Realistic reliability is ~60-75%.
              For true set-and-forget, a native mobile app or truck telematics
              integration is required. Business hours below prevent 2 AM
              drive-by punches.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Master toggle ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Auto-punch</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-medium">Enable auto clock-in and clock-out</div>
              <div className="text-xs text-muted-foreground max-w-md">
                When enabled, the app polls GPS every 60 seconds and automatically
                punches the tech in when they enter their job site and out when
                they leave. Each event has a 2-minute undo.
              </div>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              data-testid="switch-enabled"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Radius + dwell ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Geofence
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="radius" className="text-xs">Radius (feet)</Label>
            <Input
              id="radius"
              type="number"
              min={50}
              max={2000}
              step={50}
              value={radiusFt}
              onChange={(e) => setRadiusFt(Number(e.target.value))}
              data-testid="input-radius"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Recommended 250-400 ft. Larger radius = fewer missed punches,
              more false-positive drive-bys.
            </p>
          </div>
          <div>
            <Label htmlFor="enter" className="text-xs">Enter dwell (seconds)</Label>
            <Input
              id="enter"
              type="number"
              min={30}
              max={3600}
              step={30}
              value={enterDwellSec}
              onChange={(e) => setEnterDwellSec(Number(e.target.value))}
              data-testid="input-enter-dwell"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Time inside fence before punching in. Default 180 (3 min).
            </p>
          </div>
          <div>
            <Label htmlFor="exit" className="text-xs">Exit dwell (seconds)</Label>
            <Input
              id="exit"
              type="number"
              min={30}
              max={3600}
              step={30}
              value={exitDwellSec}
              onChange={(e) => setExitDwellSec(Number(e.target.value))}
              data-testid="input-exit-dwell"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Time outside fence before punching out. Default 480 (8 min).
              Larger = fewer false clock-outs when a tech walks to their truck
              to grab a tool.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Business hours ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" /> Business hours
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 max-w-sm">
            <div>
              <Label htmlFor="start" className="text-xs">Start</Label>
              <Input
                id="start"
                type="time"
                value={hoursStart}
                onChange={(e) => setHoursStart(e.target.value)}
                data-testid="input-hours-start"
              />
            </div>
            <div>
              <Label htmlFor="end" className="text-xs">End</Label>
              <Input
                id="end"
                type="time"
                value={hoursEnd}
                onChange={(e) => setHoursEnd(e.target.value)}
                data-testid="input-hours-end"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Days</Label>
            <div className="flex gap-1 mt-1 flex-wrap">
              {DAY_LABELS.map((label, i) => (
                <Button
                  key={i}
                  type="button"
                  size="sm"
                  variant={days.includes(i) ? "default" : "outline"}
                  className="h-8 w-12"
                  onClick={() => toggleDay(i)}
                  data-testid={`day-${i}`}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Auto-punch only fires on selected days between the hours above.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Shift assignment gate ────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Target eligibility</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-medium">Require an assigned shift today</div>
              <div className="text-xs text-muted-foreground max-w-md">
                Strict: only auto-punch if the tech has a shift scheduled at
                this job today. Recommended. Turn off if you don't use the
                schedule and want any assigned tech within range to auto-punch.
              </div>
            </div>
            <Switch
              checked={requireShift}
              onCheckedChange={setRequireShift}
              data-testid="switch-require-shift"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between border-t pt-4">
        <div className="text-xs text-muted-foreground">
          {settings?.updated_at
            ? `Last updated ${new Date(settings.updated_at).toLocaleString()} by ${settings.updated_by || "system"}`
            : "Never saved"}
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          data-testid="button-save-geofence"
        >
          {saveMutation.isPending ? "Saving..." : "Save settings"}
        </Button>
      </div>

      <AutoEventsPreview />
    </div>
  );
}

// ── Recent auto-events audit table ─────────────────────────────────────────
function AutoEventsPreview() {
  const { data: events = [] } = useQuery<any[]>({
    queryKey: ["/api/time-clock/auto-events"],
  });

  const recent = events.slice(0, 15);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ListChecks className="w-4 h-4" /> Recent auto-events (my last 15)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No auto-punch events yet. Once enabled, every automatic and
            skipped event logs here for the audit trail.
          </p>
        ) : (
          <div className="text-xs space-y-1">
            {recent.map((e: any) => (
              <div
                key={e.id}
                className="flex items-center gap-3 py-1.5 border-b last:border-0"
              >
                <div className="font-mono w-32 shrink-0 text-muted-foreground">
                  {new Date(e.created_at).toLocaleString([], {
                    month: "numeric", day: "numeric",
                    hour: "numeric", minute: "2-digit",
                  })}
                </div>
                <Badge
                  variant={e.event_type.startsWith("undo") ? "outline"
                    : e.event_type === "skip" ? "secondary"
                    : "default"}
                  className="text-[10px]"
                >
                  {e.event_type}
                </Badge>
                <div className="flex-1 min-w-0 truncate">
                  Job #{e.job_id ?? "—"} · {e.distance_ft != null ? `${e.distance_ft}ft` : ""}
                  {e.dwell_sec != null ? ` · ${e.dwell_sec}s` : ""}
                  {e.skip_reason ? ` · ${e.skip_reason}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
