import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { fmtDate } from "@/lib/dates";
import {
  MapPin, Plus, Route, Calendar, ChevronRight, Trash2, Edit2, CheckCircle2,
  Circle, Navigation, Star, AlertCircle, Clock, Truck, Users, ArrowUp,
  ArrowDown, ExternalLink, X, Map, ListOrdered, CalendarPlus, Flag
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface SavedRoute {
  id: number;
  name: string;
  type: string;
  description: string | null;
  assigned_to: string | null;
  color: string;
  is_active: boolean;
  estimated_duration: number | null;
  estimated_miles: number | null;
  notes: string | null;
  stopCount: number;
  tripCount: number;
  lastTrip: { scheduled_date: string; status: string } | null;
  created_at: string;
}

interface RouteStop {
  id: number;
  route_id: number;
  job_id: number | null;
  contact_id: number | null;
  label: string;
  address: string;
  lat: number | null;
  lng: number | null;
  stop_type: string;
  priority: number;
  order_index: number;
  notes: string | null;
  completed: boolean;
  completed_at: string | null;
  job: { job_number: string; address: string; loss_type: string; status: string } | null;
  contact: { name: string; phone: string; company: string } | null;
}

interface RouteDetail extends SavedRoute { stops: RouteStop[]; }

interface RouteTrip {
  id: number;
  route_id: number;
  assigned_to: string | null;
  scheduled_date: string;
  status: string;
  completed_at: string | null;
  actual_miles: number | null;
  notes: string | null;
  route_name?: string;
  route_type?: string;
  route_color?: string;
}

interface Stats {
  totalRoutes: number;
  totalTrips: number;
  tripsThisMonth: number;
  completedTrips: number;
  pendingTrips: number;
  byType: Array<{ type: string; cnt: number }>;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const ROUTE_TYPES = [
  { value: "dedicated", label: "Dedicated Route", icon: Route, color: "#3b82f6", desc: "Regular recurring territory" },
  { value: "priority_followup", label: "Priority Follow-Up", icon: Star, color: "#ef4444", desc: "High-value leads & open jobs" },
  { value: "canvass", label: "Canvass Route", icon: Map, color: "#10b981", desc: "Storm / neighborhood canvass" },
];

const STOP_TYPES = [
  { value: "visit", label: "Visit" },
  { value: "follow_up", label: "Follow-Up" },
  { value: "canvass", label: "Canvass" },
  { value: "drop_off", label: "Drop-Off" },
  { value: "pickup", label: "Pickup" },
];

const PRIORITIES = [
  { value: 1, label: "High", color: "text-red-500" },
  { value: 2, label: "Medium", color: "text-yellow-500" },
  { value: 3, label: "Low", color: "text-green-500" },
];

const EMPLOYEES = ["Cody Brantley", "John", "Mason", "Clint", "Blake", "Blake Foster"];

const ROUTE_COLORS = ["#3b82f6","#ef4444","#10b981","#f59e0b","#8b5cf6","#06b6d4","#f97316","#ec4899"];

// ── Schemas ───────────────────────────────────────────────────────────────────
const routeSchema = z.object({
  name: z.string().min(1, "Name required"),
  type: z.string().min(1),
  description: z.string().optional(),
  assigned_to: z.string().optional(),
  color: z.string().default("#3b82f6"),
  estimated_duration: z.coerce.number().optional(),
  estimated_miles: z.coerce.number().optional(),
  notes: z.string().optional(),
});

const stopSchema = z.object({
  label: z.string().min(1, "Label required"),
  address: z.string().min(1, "Address required"),
  stop_type: z.string().default("visit"),
  priority: z.coerce.number().default(2),
  notes: z.string().optional(),
});

const tripSchema = z.object({
  scheduled_date: z.string().min(1, "Date required"),
  assigned_to: z.string().optional(),
  notes: z.string().optional(),
});

// ── Helper components ─────────────────────────────────────────────────────────
function TypeBadge({ type }: { type: string }) {
  const t = ROUTE_TYPES.find(r => r.value === type);
  if (!t) return <Badge variant="outline">{type}</Badge>;
  const Icon = t.icon;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ background: t.color + "20", color: t.color }}>
      <Icon className="h-3 w-3" />{t.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    in_progress: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    complete: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    cancelled: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${map[status] ?? map.scheduled}`}>{status}</span>;
}

function PriorityDot({ priority }: { priority: number }) {
  const p = PRIORITIES.find(p => p.value === priority);
  return <span className={`text-xs font-semibold ${p?.color ?? ""}`}>{p?.label ?? "—"}</span>;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function RoutePlanner() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedRoute, setSelectedRoute] = useState<number | null>(null);
  const [view, setView] = useState<"routes" | "detail" | "trips">("routes");
  const [showNewRoute, setShowNewRoute] = useState(false);
  const [showNewStop, setShowNewStop] = useState(false);
  const [showScheduleTrip, setShowScheduleTrip] = useState(false);
  const [editingRoute, setEditingRoute] = useState<SavedRoute | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: routes = [], isLoading } = useQuery<SavedRoute[]>({
    queryKey: ["/api/routes"],
    queryFn: () => apiRequest("/api/routes").then(r => r.json()),
  });

  const { data: routeDetail } = useQuery<RouteDetail>({
    queryKey: ["/api/routes", selectedRoute],
    queryFn: () => apiRequest(`/api/routes/${selectedRoute}`).then(r => r.json()),
    enabled: !!selectedRoute,
  });

  const { data: trips = [] } = useQuery<RouteTrip[]>({
    queryKey: ["/api/trips"],
    queryFn: () => apiRequest("/api/trips").then(r => r.json()),
    enabled: view === "trips",
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/routes/stats/summary"],
    queryFn: () => apiRequest("/api/routes/stats/summary").then(r => r.json()),
  });

  const { data: followupSuggestions = [] } = useQuery<any[]>({
    queryKey: ["/api/routes/priority-followups/suggestions"],
    queryFn: () => apiRequest("/api/routes/priority-followups/suggestions").then(r => r.json()),
    enabled: view === "routes",
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createRoute = useMutation({
    mutationFn: (data: any) => apiRequest("/api/routes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/routes"] }); setShowNewRoute(false); toast({ title: "Route created" }); },
  });

  const updateRoute = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/routes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/routes"] }); queryClient.invalidateQueries({ queryKey: ["/api/routes", selectedRoute] }); setEditingRoute(null); toast({ title: "Route updated" }); },
  });

  const deleteRoute = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/routes/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/routes"] }); setSelectedRoute(null); setView("routes"); toast({ title: "Route deleted" }); },
  });

  const createStop = useMutation({
    mutationFn: (data: any) => apiRequest(`/api/routes/${selectedRoute}/stops`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/routes", selectedRoute] }); setShowNewStop(false); toast({ title: "Stop added" }); },
  });

  const updateStop = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/route-stops/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/routes", selectedRoute] }); },
  });

  const deleteStop = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/route-stops/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/routes", selectedRoute] }); },
  });

  const createTrip = useMutation({
    mutationFn: (data: any) => apiRequest(`/api/routes/${selectedRoute}/trips`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/trips"] }); queryClient.invalidateQueries({ queryKey: ["/api/routes"] }); setShowScheduleTrip(false); toast({ title: "Trip scheduled" }); },
  });

  const updateTrip = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/trips/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/trips"] }); },
  });

  // ── Forms ─────────────────────────────────────────────────────────────────
  const routeForm = useForm<z.infer<typeof routeSchema>>({
    resolver: zodResolver(routeSchema),
    defaultValues: { name: "", type: "dedicated", color: "#3b82f6", description: "", assigned_to: "", notes: "" },
  });

  const stopForm = useForm<z.infer<typeof stopSchema>>({
    resolver: zodResolver(stopSchema),
    defaultValues: { label: "", address: "", stop_type: "visit", priority: 2, notes: "" },
  });

  const tripForm = useForm<z.infer<typeof tripSchema>>({
    resolver: zodResolver(tripSchema),
    defaultValues: { scheduled_date: new Date().toISOString().split("T")[0], assigned_to: "", notes: "" },
  });

  // Reset + prefill edit form
  const openEdit = (r: SavedRoute) => {
    setEditingRoute(r);
    routeForm.reset({
      name: r.name, type: r.type, color: r.color,
      description: r.description ?? "", assigned_to: r.assigned_to ?? "",
      estimated_duration: r.estimated_duration ?? undefined,
      estimated_miles: r.estimated_miles ?? undefined,
      notes: r.notes ?? "",
    });
  };

  const moveStop = (stop: RouteStop, dir: "up" | "down") => {
    const stops = routeDetail?.stops ?? [];
    const idx = stops.findIndex(s => s.id === stop.id);
    const target = dir === "up" ? stops[idx - 1] : stops[idx + 1];
    if (!target) return;
    updateStop.mutate({ id: stop.id, data: { order_index: target.order_index } });
    updateStop.mutate({ id: target.id, data: { order_index: stop.order_index } });
  };

  const openMaps = (stop: RouteStop) => {
    const q = encodeURIComponent(stop.address);
    window.open(`https://maps.apple.com/?q=${q}`, "_blank");
  };

  // ── Build full route in Apple Maps ────────────────────────────────────────
  const launchFullRoute = () => {
    if (!routeDetail?.stops.length) return;
    const addrs = routeDetail.stops
      .filter(s => !s.completed)
      .sort((a, b) => a.order_index - b.order_index)
      .map(s => encodeURIComponent(s.address));
    if (addrs.length === 1) {
      window.open(`https://maps.apple.com/?daddr=${addrs[0]}`, "_blank");
    } else {
      // Apple Maps doesn't support multi-stop — use Google Maps
      const url = `https://www.google.com/maps/dir/${addrs.join("/")}`;
      window.open(url, "_blank");
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-600/10">
            <Route className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Route Planner</h1>
            <p className="text-sm text-muted-foreground">Dedicated territories, priority follow-ups, and canvass routes</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant={view === "routes" ? "default" : "outline"}
            className={view === "routes" ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}
            onClick={() => setView("routes")}
            data-testid="button-view-routes"
          ><Route className="h-3 w-3 mr-1" />Routes</Button>
          <Button
            size="sm" variant={view === "trips" ? "default" : "outline"}
            className={view === "trips" ? "bg-blue-600 hover:bg-blue-700 text-white" : ""}
            onClick={() => setView("trips")}
            data-testid="button-view-trips"
          ><Calendar className="h-3 w-3 mr-1" />Trips</Button>
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={() => { setShowNewRoute(true); routeForm.reset({ name: "", type: "dedicated", color: "#3b82f6" }); }}
            data-testid="button-new-route"
          ><Plus className="h-3 w-3 mr-1" />New Route</Button>
        </div>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Active Routes", value: stats.totalRoutes, icon: Route, color: "text-blue-600" },
            { label: "Total Trips", value: stats.totalTrips, icon: Truck, color: "text-purple-600" },
            { label: "This Month", value: stats.tripsThisMonth, icon: Calendar, color: "text-green-600" },
            { label: "Completed", value: stats.completedTrips, icon: CheckCircle2, color: "text-green-600" },
            { label: "Scheduled", value: stats.pendingTrips, icon: Clock, color: "text-yellow-600" },
          ].map(s => (
            <Card key={s.label} className="p-3">
              <div className="flex items-center gap-2">
                <s.icon className={`h-4 w-4 ${s.color}`} />
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-lg font-bold text-foreground">{s.value}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── ROUTES LIST VIEW ─────────────────────────────────────────────── */}
      {view === "routes" && !selectedRoute && (
        <div className="grid md:grid-cols-3 gap-6">
          {/* Route Cards */}
          <div className="md:col-span-2 space-y-3">
            {isLoading && <p className="text-sm text-muted-foreground">Loading routes...</p>}
            {!isLoading && routes.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="p-12 text-center">
                  <Map className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
                  <h3 className="font-semibold text-foreground mb-2">No routes yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">Create your first dedicated territory, follow-up route, or canvass run.</p>
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setShowNewRoute(true)}>
                    <Plus className="h-3 w-3 mr-1" />Create First Route
                  </Button>
                </CardContent>
              </Card>
            )}
            {routes.map(r => (
              <Card
                key={r.id}
                className="cursor-pointer hover:shadow-md transition-shadow border-l-4"
                style={{ borderLeftColor: r.color }}
                data-testid={`card-route-${r.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-semibold text-foreground">{r.name}</h3>
                        <TypeBadge type={r.type} />
                        {!r.is_active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                      </div>
                      {r.description && <p className="text-sm text-muted-foreground mb-2">{r.description}</p>}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{r.stopCount} stops</span>
                        {r.assigned_to && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{r.assigned_to}</span>}
                        {r.estimated_miles && <span className="flex items-center gap-1"><Navigation className="h-3 w-3" />{r.estimated_miles} mi</span>}
                        {r.estimated_duration && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{r.estimated_duration} min</span>}
                        {r.lastTrip && <span>Last run: {fmtDate(r.lastTrip.scheduled_date, { month: "short", day: "numeric" })}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={e => { e.stopPropagation(); openEdit(r); }} data-testid={`button-edit-route-${r.id}`}><Edit2 className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-600" onClick={e => { e.stopPropagation(); if (confirm("Delete this route?")) deleteRoute.mutate(r.id); }} data-testid={`button-delete-route-${r.id}`}><Trash2 className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-blue-600" onClick={() => { setSelectedRoute(r.id); setView("detail"); }} data-testid={`button-open-route-${r.id}`}>
                        Open <ChevronRight className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Priority Follow-Up Suggestions */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Flag className="h-4 w-4 text-red-500" />
              Priority Follow-Ups
            </h2>
            {followupSuggestions.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="p-4 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-green-500" />
                  No pending follow-ups
                </CardContent>
              </Card>
            )}
            {followupSuggestions.slice(0, 8).map((f: any) => (
              <Card key={f.id} className="border-l-4 border-l-red-500">
                <CardContent className="p-3">
                  <p className="text-xs font-semibold text-foreground">{f.contact_name || f.job_number || "Follow-Up"}</p>
                  {f.address && <p className="text-xs text-muted-foreground mt-0.5 truncate">{f.address}</p>}
                  {f.due_date && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Due {fmtDate(f.due_date, { month: "short", day: "numeric" })}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
            {followupSuggestions.length > 8 && (
              <p className="text-xs text-muted-foreground text-center">+ {followupSuggestions.length - 8} more in Follow-Ups module</p>
            )}
          </div>
        </div>
      )}

      {/* ── ROUTE DETAIL VIEW ────────────────────────────────────────────── */}
      {view === "detail" && selectedRoute && routeDetail && (
        <div className="space-y-4">
          {/* Back + route header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Button size="sm" variant="ghost" onClick={() => { setSelectedRoute(null); setView("routes"); }}>
                ← Back
              </Button>
              <div className="h-4 w-0.5 bg-border" />
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full" style={{ background: routeDetail.color }} />
                <h2 className="font-bold text-foreground">{routeDetail.name}</h2>
                <TypeBadge type={routeDetail.type} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={launchFullRoute} data-testid="button-launch-maps">
                <Navigation className="h-3 w-3 mr-1" />Launch in Maps
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setSelectedRoute(selectedRoute); setShowScheduleTrip(true); }} data-testid="button-schedule-trip">
                <CalendarPlus className="h-3 w-3 mr-1" />Schedule Trip
              </Button>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setShowNewStop(true)} data-testid="button-add-stop">
                <Plus className="h-3 w-3 mr-1" />Add Stop
              </Button>
            </div>
          </div>

          {/* Route meta */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            {routeDetail.assigned_to && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{routeDetail.assigned_to}</span>}
            {routeDetail.estimated_miles && <span className="flex items-center gap-1"><Navigation className="h-3 w-3" />~{routeDetail.estimated_miles} mi</span>}
            {routeDetail.estimated_duration && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />~{routeDetail.estimated_duration} min</span>}
            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{routeDetail.stops.length} stops</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" />{routeDetail.stops.filter(s => s.completed).length} completed</span>
          </div>

          {routeDetail.description && <p className="text-sm text-muted-foreground">{routeDetail.description}</p>}

          {/* Stops */}
          {routeDetail.stops.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-10 text-center">
                <MapPin className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No stops yet — add your first stop above.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {[...routeDetail.stops]
                .sort((a, b) => a.order_index - b.order_index)
                .map((stop, idx) => (
                <Card
                  key={stop.id}
                  className={`transition-opacity ${stop.completed ? "opacity-50" : ""}`}
                  data-testid={`card-stop-${stop.id}`}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      {/* Order number */}
                      <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
                        <div className="h-6 w-6 rounded-full border-2 flex items-center justify-center text-xs font-bold"
                          style={{ borderColor: routeDetail.color, color: routeDetail.color }}>
                          {idx + 1}
                        </div>
                      </div>

                      {/* Main content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className={`font-semibold text-sm ${stop.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
                            {stop.label}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground capitalize">{stop.stop_type.replace("_", " ")}</span>
                          <PriorityDot priority={stop.priority} />
                          {stop.job && <Badge variant="outline" className="text-xs">{stop.job.job_number}</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">{stop.address}</p>
                        {stop.contact && <p className="text-xs text-blue-600">{stop.contact.name}{stop.contact.phone ? ` · ${stop.contact.phone}` : ""}</p>}
                        {stop.notes && <p className="text-xs text-muted-foreground italic mt-1">{stop.notes}</p>}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Move up" onClick={() => moveStop(stop, "up")} disabled={idx === 0}><ArrowUp className="h-3 w-3" /></Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Move down" onClick={() => moveStop(stop, "down")} disabled={idx === routeDetail.stops.length - 1}><ArrowDown className="h-3 w-3" /></Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Open in Maps" onClick={() => openMaps(stop)} data-testid={`button-maps-${stop.id}`}><ExternalLink className="h-3 w-3" /></Button>
                        <Button
                          size="sm" variant="ghost"
                          className={`h-7 w-7 p-0 ${stop.completed ? "text-green-600" : "text-muted-foreground"}`}
                          title={stop.completed ? "Mark incomplete" : "Mark complete"}
                          onClick={() => updateStop.mutate({ id: stop.id, data: { completed: !stop.completed } })}
                          data-testid={`button-complete-${stop.id}`}
                        >
                          {stop.completed ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-600" onClick={() => { if (confirm("Remove stop?")) deleteStop.mutate(stop.id); }} data-testid={`button-remove-stop-${stop.id}`}><X className="h-3 w-3" /></Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Reset completed */}
          {routeDetail.stops.some(s => s.completed) && (
            <Button size="sm" variant="outline" className="text-xs"
              onClick={() => routeDetail.stops.filter(s => s.completed).forEach(s => updateStop.mutate({ id: s.id, data: { completed: false } }))}>
              Reset All Stops
            </Button>
          )}
        </div>
      )}

      {/* ── TRIPS VIEW ───────────────────────────────────────────────────── */}
      {view === "trips" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4 text-blue-600" />
              All Scheduled Trips
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {trips.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground text-sm">
                <Calendar className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
                No trips scheduled yet. Open a route and click "Schedule Trip".
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="text-left p-3 font-medium text-muted-foreground">Route</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Assigned To</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Miles</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map(trip => (
                    <tr key={trip.id} className="border-b hover:bg-muted/20" data-testid={`row-trip-${trip.id}`}>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          {trip.route_color && <div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: trip.route_color }} />}
                          <span className="font-medium text-foreground">{trip.route_name ?? `Route #${trip.route_id}`}</span>
                        </div>
                        {trip.route_type && <TypeBadge type={trip.route_type} />}
                      </td>
                      <td className="p-3 text-foreground whitespace-nowrap">
                        {fmtDate(trip.scheduled_date, { weekday: "short", month: "short", day: "numeric" })}
                      </td>
                      <td className="p-3 text-foreground">{trip.assigned_to || "—"}</td>
                      <td className="p-3"><StatusBadge status={trip.status} /></td>
                      <td className="p-3 text-foreground">{trip.actual_miles ? `${trip.actual_miles} mi` : "—"}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          {trip.status === "scheduled" && (
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-green-600"
                              onClick={() => updateTrip.mutate({ id: trip.id, data: { status: "complete" } })}>
                              Complete
                            </Button>
                          )}
                          {trip.status === "scheduled" && (
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-red-500"
                              onClick={() => updateTrip.mutate({ id: trip.id, data: { status: "cancelled" } })}>
                              Cancel
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── NEW / EDIT ROUTE DIALOG ──────────────────────────────────────── */}
      <Dialog open={showNewRoute || !!editingRoute} onOpenChange={open => { if (!open) { setShowNewRoute(false); setEditingRoute(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRoute ? "Edit Route" : "New Route"}</DialogTitle>
          </DialogHeader>
          <Form {...routeForm}>
            <form onSubmit={routeForm.handleSubmit(data => {
              if (editingRoute) updateRoute.mutate({ id: editingRoute.id, data });
              else createRoute.mutate(data);
            })} className="space-y-4">
              <FormField control={routeForm.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Route Name</FormLabel><FormControl><Input {...field} placeholder="e.g. North Augusta Territory" data-testid="input-route-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={routeForm.control} name="type" render={({ field }) => (
                <FormItem><FormLabel>Route Type</FormLabel>
                  <div className="grid grid-cols-3 gap-2">
                    {ROUTE_TYPES.map(t => {
                      const Icon = t.icon;
                      return (
                        <button key={t.value} type="button"
                          onClick={() => routeForm.setValue("type", t.value)}
                          className={`p-3 rounded-lg border-2 text-left transition-all ${field.value === t.value ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20" : "border-border hover:border-blue-300"}`}
                          data-testid={`button-type-${t.value}`}
                        >
                          <Icon className="h-4 w-4 mb-1" style={{ color: t.color }} />
                          <p className="text-xs font-semibold text-foreground leading-tight">{t.label}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{t.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={routeForm.control} name="assigned_to" render={({ field }) => (
                  <FormItem><FormLabel>Assigned To</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger data-testid="select-assigned-to"><SelectValue placeholder="Select team member" /></SelectTrigger>
                      <SelectContent>
                        {EMPLOYEES.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={routeForm.control} name="color" render={({ field }) => (
                  <FormItem><FormLabel>Color</FormLabel>
                    <div className="flex gap-1.5 flex-wrap pt-1">
                      {ROUTE_COLORS.map(c => (
                        <button key={c} type="button"
                          onClick={() => routeForm.setValue("color", c)}
                          className={`h-6 w-6 rounded-full transition-transform ${field.value === c ? "scale-125 ring-2 ring-offset-1 ring-border" : "hover:scale-110"}`}
                          style={{ background: c }} />
                      ))}
                    </div>
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={routeForm.control} name="estimated_miles" render={({ field }) => (
                  <FormItem><FormLabel>Est. Miles</FormLabel><FormControl><Input type="number" {...field} placeholder="0" /></FormControl></FormItem>
                )} />
                <FormField control={routeForm.control} name="estimated_duration" render={({ field }) => (
                  <FormItem><FormLabel>Est. Duration (min)</FormLabel><FormControl><Input type="number" {...field} placeholder="0" /></FormControl></FormItem>
                )} />
              </div>
              <FormField control={routeForm.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea {...field} rows={2} placeholder="Notes about this route..." /></FormControl></FormItem>
              )} />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => { setShowNewRoute(false); setEditingRoute(null); }}>Cancel</Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={createRoute.isPending || updateRoute.isPending} data-testid="button-save-route">
                  {editingRoute ? "Save Changes" : "Create Route"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── NEW STOP DIALOG ──────────────────────────────────────────────── */}
      <Dialog open={showNewStop} onOpenChange={setShowNewStop}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Stop</DialogTitle>
          </DialogHeader>
          <Form {...stopForm}>
            <form onSubmit={stopForm.handleSubmit(data => createStop.mutate({ ...data, order_index: (routeDetail?.stops.length ?? 0) }))} className="space-y-4">
              <FormField control={stopForm.control} name="label" render={({ field }) => (
                <FormItem><FormLabel>Stop Name / Label</FormLabel><FormControl><Input {...field} placeholder="e.g. Dr. Smith's Office" data-testid="input-stop-label" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={stopForm.control} name="address" render={({ field }) => (
                <FormItem><FormLabel>Address</FormLabel><FormControl><Input {...field} placeholder="123 Main St, Augusta GA" data-testid="input-stop-address" /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={stopForm.control} name="stop_type" render={({ field }) => (
                  <FormItem><FormLabel>Stop Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger data-testid="select-stop-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STOP_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={stopForm.control} name="priority" render={({ field }) => (
                  <FormItem><FormLabel>Priority</FormLabel>
                    <Select value={String(field.value)} onValueChange={v => field.onChange(Number(v))}>
                      <SelectTrigger data-testid="select-stop-priority"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PRIORITIES.map(p => <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
              <FormField control={stopForm.control} name="notes" render={({ field }) => (
                <FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea {...field} rows={2} placeholder="Any notes for this stop..." /></FormControl></FormItem>
              )} />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowNewStop(false)}>Cancel</Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={createStop.isPending} data-testid="button-save-stop">Add Stop</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── SCHEDULE TRIP DIALOG ────────────────────────────────────────── */}
      <Dialog open={showScheduleTrip} onOpenChange={setShowScheduleTrip}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Schedule Trip — {routeDetail?.name}</DialogTitle>
          </DialogHeader>
          <Form {...tripForm}>
            <form onSubmit={tripForm.handleSubmit(data => createTrip.mutate(data))} className="space-y-4">
              <FormField control={tripForm.control} name="scheduled_date" render={({ field }) => (
                <FormItem><FormLabel>Date</FormLabel><FormControl><Input type="date" {...field} data-testid="input-trip-date" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={tripForm.control} name="assigned_to" render={({ field }) => (
                <FormItem><FormLabel>Assigned To</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger data-testid="select-trip-assigned"><SelectValue placeholder="Select team member" /></SelectTrigger>
                    <SelectContent>
                      {EMPLOYEES.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={tripForm.control} name="notes" render={({ field }) => (
                <FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea {...field} rows={2} placeholder="Trip notes..." /></FormControl></FormItem>
              )} />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowScheduleTrip(false)}>Cancel</Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={createTrip.isPending} data-testid="button-confirm-trip">Schedule Trip</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
