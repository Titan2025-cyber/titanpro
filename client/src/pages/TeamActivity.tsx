/**
 * Team Activity — OWNER-ONLY.
 *
 * Shows, per staff user:
 *   - Live presence: who's active / idle / offline right now
 *   - Two separate time metrics: "Open" time (tab open & focused) and "Active"
 *     time (actually interacting), for TODAY and the LAST 7 DAYS
 *   - A per-day breakdown for the week
 *
 * Gated to role === "owner" only. General managers, admins, and techs cannot
 * reach this page or its data — the server also enforces requireRole("owner").
 */
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Users, Activity, Clock, Circle, CalendarRange } from "lucide-react";

// ── Time formatting ──────────────────────────────────────────────────────────
function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function dayLabel(iso: string): string {
  // iso is YYYY-MM-DD
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

const STATUS_STYLES: Record<string, { dot: string; label: string; text: string }> = {
  active:  { dot: "text-emerald-500 fill-emerald-500", label: "Active", text: "text-emerald-600" },
  idle:    { dot: "text-amber-500 fill-amber-500",     label: "Idle",   text: "text-amber-600" },
  offline: { dot: "text-gray-300 fill-gray-300",       label: "Offline", text: "text-muted-foreground" },
};

export default function TeamActivity() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";

  const { data: live } = useQuery<any>({
    queryKey: ["/api/presence/live"],
    queryFn: () => apiRequest("GET", "/api/presence/live").then(r => r.json()).catch(() => null),
    enabled: isOwner,
    refetchInterval: 15_000,       // live view refreshes every 15s
    refetchOnWindowFocus: true,
  });

  const { data: totals } = useQuery<any>({
    queryKey: ["/api/presence/totals"],
    queryFn: () => apiRequest("GET", "/api/presence/totals").then(r => r.json()).catch(() => null),
    enabled: isOwner,
    refetchInterval: 60_000,       // totals refresh every minute
  });

  if (!isOwner) {
    return <div className="p-8 text-center text-muted-foreground" data-testid="text-owner-only">Team Activity is available to the owner only.</div>;
  }

  const people: any[] = live?.people || [];
  const onlineCount = people.filter(p => p.status !== "offline").length;
  const activeCount = people.filter(p => p.status === "active").length;

  const totalsPeople: any[] = totals?.people || [];
  const days: string[] = totals?.days || [];
  // Max weekly open-seconds across users, used to scale the per-day bars.
  const maxDaySeconds = Math.max(
    1,
    ...totalsPeople.flatMap(p => (p.perDay || []).map((d: any) => d.openSeconds || 0)),
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6" data-testid="page-team-activity">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="w-6 h-6 text-[hsl(var(--titan-blue))]" /> Team Activity
        </h1>
        <p className="text-sm text-muted-foreground">
          Live presence and time-in-app per user. Visible to the owner only.
        </p>
      </div>

      {/* Live summary stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Online now</p>
          <p className="text-3xl font-bold" data-testid="stat-online">{onlineCount}</p>
          <p className="text-xs text-muted-foreground mt-1">of {people.length} staff</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Actively working</p>
          <p className="text-3xl font-bold text-emerald-600" data-testid="stat-active">{activeCount}</p>
          <p className="text-xs text-muted-foreground mt-1">interacting right now</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Updated</p>
          <p className="text-3xl font-bold">{live ? "Live" : "—"}</p>
          <p className="text-xs text-muted-foreground mt-1">auto-refreshes every 15s</p>
        </CardContent></Card>
      </div>

      {/* Live presence table */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <Activity className="w-4 h-4 text-[hsl(var(--titan-red))]" />
            <h2 className="text-sm font-bold">Who's using the app right now</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="px-4 py-2 font-semibold">Staff</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Last seen</th>
                  <th className="px-4 py-2 font-semibold">Current session open</th>
                  <th className="px-4 py-2 font-semibold">Current session active</th>
                </tr>
              </thead>
              <tbody>
                {people.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No staff activity yet.</td></tr>
                )}
                {people.map(p => {
                  const st = STATUS_STYLES[p.status] || STATUS_STYLES.offline;
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40" data-testid={`row-live-${p.id}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground capitalize">{p.position || p.role}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1.5 font-medium ${st.text}`} data-testid={`status-${p.id}`}>
                          <Circle className={`w-2.5 h-2.5 ${st.dot}`} /> {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{relTime(p.lastSeenAt)}</td>
                      <td className="px-4 py-2.5" data-testid={`open-${p.id}`}>{fmtDuration(p.currentSessionOpenSeconds)}</td>
                      <td className="px-4 py-2.5 text-emerald-700" data-testid={`active-${p.id}`}>{fmtDuration(p.currentSessionActiveSeconds)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Time totals — today & last 7 days */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            <Clock className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
            <h2 className="text-sm font-bold">Time in app — Today &amp; last 7 days</h2>
            <span className="ml-auto text-xs text-muted-foreground flex items-center gap-1">
              <CalendarRange className="w-3.5 h-3.5" /> Open = tab open · Active = interacting
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="px-4 py-2 font-semibold">Staff</th>
                  <th className="px-4 py-2 font-semibold">Today open</th>
                  <th className="px-4 py-2 font-semibold">Today active</th>
                  <th className="px-4 py-2 font-semibold">Week open</th>
                  <th className="px-4 py-2 font-semibold">Week active</th>
                  <th className="px-4 py-2 font-semibold">Daily open (last 7 days)</th>
                </tr>
              </thead>
              <tbody>
                {totalsPeople.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No activity recorded yet.</td></tr>
                )}
                {totalsPeople.map(p => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40" data-testid={`row-totals-${p.id}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground capitalize">{p.position || p.role}</div>
                    </td>
                    <td className="px-4 py-2.5" data-testid={`today-open-${p.id}`}>{fmtDuration(p.today.openSeconds)}</td>
                    <td className="px-4 py-2.5 text-emerald-700" data-testid={`today-active-${p.id}`}>{fmtDuration(p.today.activeSeconds)}</td>
                    <td className="px-4 py-2.5 font-medium" data-testid={`week-open-${p.id}`}>{fmtDuration(p.week.openSeconds)}</td>
                    <td className="px-4 py-2.5 font-medium text-emerald-700" data-testid={`week-active-${p.id}`}>{fmtDuration(p.week.activeSeconds)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-end gap-1 h-10" title="Open time per day">
                        {(p.perDay || []).map((d: any) => {
                          const h = Math.max(2, Math.round((d.openSeconds / maxDaySeconds) * 36));
                          const active = Math.max(0, Math.round((d.activeSeconds / maxDaySeconds) * 36));
                          return (
                            <div key={d.day} className="flex flex-col items-center gap-0.5" style={{ width: 18 }}>
                              <div className="relative w-3 flex items-end" style={{ height: 36 }}>
                                <div className="absolute bottom-0 w-3 rounded-sm bg-[hsl(var(--titan-blue)/0.25)]" style={{ height: h }} />
                                <div className="absolute bottom-0 w-3 rounded-sm bg-[hsl(var(--titan-blue))]" style={{ height: active }} title={`${dayLabel(d.day)}: ${fmtDuration(d.activeSeconds)} active`} />
                              </div>
                              <span className="text-[9px] text-muted-foreground">{dayLabel(d.day)[0]}</span>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t text-xs text-muted-foreground flex items-center gap-4">
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-[hsl(var(--titan-blue))]" /> Active (interacting)</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-[hsl(var(--titan-blue)/0.25)]" /> Open (tab open)</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
