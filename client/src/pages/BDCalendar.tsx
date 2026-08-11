/**
 * BDCalendar.tsx — Business Development standalone calendar
 *
 * Features:
 * - Monthly calendar grid + weekly list view
 * - Event types: Breakfast, Lunch, Coffee, Chamber, Meeting, Site Visit, Other
 * - Create / edit / delete events via slide-in form
 * - Partner notification toggle — logs email to Sent when event is saved
 * - Contact picker from existing contacts (type = referral | partner | adjuster)
 * - Color-coded by event type
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  ChevronLeft, ChevronRight, Plus, Calendar, Clock, MapPin,
  User, Mail, X, Edit2, Trash2, Bell, BellOff, CheckCircle,
  Coffee, Utensils, Handshake, Building2, MoreHorizontal, List
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Contact } from "@shared/schema";
import { todayLocalISO } from "@/lib/dates";

// ── Types ─────────────────────────────────────────────────────────────────────
interface BdEvent {
  id: number;
  title: string;
  eventType: string;
  date: string;
  startTime: string;
  endTime?: string;
  location?: string;
  notes?: string;
  contactId?: number;
  contactEmail?: string;
  contactName?: string;
  notifyPartner: number;
  notified: number;
  createdBy: string;
  createdAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const EVENT_TYPES = [
  { value: "breakfast",   label: "Breakfast",    icon: "🍳", color: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300" },
  { value: "lunch",       label: "Lunch",        icon: "🍽️", color: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300" },
  { value: "coffee",      label: "Coffee",       icon: "☕", color: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-300" },
  { value: "chamber",     label: "Chamber",      icon: "🏛️", color: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300" },
  { value: "meeting",     label: "Meeting",      icon: "🤝", color: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300" },
  { value: "site_visit",  label: "Site Visit",   icon: "📍", color: "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300" },
  { value: "other",       label: "Other",        icon: "📅", color: "bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-800 dark:text-gray-300" },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function getEventType(type: string) {
  return EVENT_TYPES.find(e => e.value === type) || EVENT_TYPES[EVENT_TYPES.length - 1];
}

// ── Event Form Dialog ─────────────────────────────────────────────────────────
function EventForm({
  event, contacts, defaultDate, onClose
}: {
  event?: BdEvent;
  contacts: Contact[];
  defaultDate?: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!event;

  const [form, setForm] = useState({
    title: event?.title || "",
    eventType: event?.eventType || "meeting",
    date: event?.date || defaultDate || todayLocalISO(),
    startTime: event?.startTime || "09:00",
    endTime: event?.endTime || "",
    location: event?.location || "",
    notes: event?.notes || "",
    contactId: event?.contactId ? String(event.contactId) : "",
    contactEmail: event?.contactEmail || "",
    contactName: event?.contactName || "",
    notifyPartner: event ? Boolean(event.notifyPartner) : true,
  });

  // Auto-fill contact fields when a contact is selected
  const partnerContacts = contacts.filter(c =>
    ["referral", "partner", "adjuster", "plumber", "roofer", "realtor", "agent", "broker"].some(t => c.type?.toLowerCase().includes(t)) ||
    ["referral", "partner"].includes(c.type || "")
  );

  function handleContactChange(contactId: string) {
    const c = contacts.find(c => String(c.id) === contactId);
    setForm(f => ({
      ...f,
      contactId,
      contactEmail: c?.email || f.contactEmail,
      contactName: c?.name || f.contactName,
    }));
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        contactId: form.contactId ? Number(form.contactId) : null,
        notifyPartner: form.notifyPartner ? 1 : 0,
      };
      if (isEdit) {
        return apiRequest("PATCH", `/api/bd-events/${event!.id}`, payload).then(r => r.json());
      }
      return apiRequest("POST", "/api/bd-events", payload).then(r => r.json());
    },
    onSuccess: (saved: BdEvent) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bd-events"] });
      const notified = saved.notifyPartner && saved.contactEmail;
      toast({
        title: isEdit ? "Event updated" : "Event created",
        description: notified
          ? `Notification email logged to ${saved.contactEmail}`
          : "No partner notification sent.",
      });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Failed to save event", description: err?.message, variant: "destructive" });
    },
  });

  const f = form;
  const set = (k: keyof typeof form, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
      {/* Title */}
      <div>
        <Label className="text-xs">Event Title *</Label>
        <Input className="mt-1" placeholder="e.g. Breakfast with State Farm agent" value={f.title}
          onChange={e => set("title", e.target.value)} data-testid="input-event-title" />
      </div>

      {/* Type + Date row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Type</Label>
          <Select value={f.eventType} onValueChange={v => set("eventType", v)}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {EVENT_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value}>{t.icon} {t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Date *</Label>
          <Input type="date" className="mt-1 h-9" value={f.date}
            onChange={e => set("date", e.target.value)} />
        </div>
      </div>

      {/* Time row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Start Time *</Label>
          <Input type="time" className="mt-1 h-9" value={f.startTime}
            onChange={e => set("startTime", e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">End Time</Label>
          <Input type="time" className="mt-1 h-9" value={f.endTime}
            onChange={e => set("endTime", e.target.value)} />
        </div>
      </div>

      {/* Location */}
      <div>
        <Label className="text-xs">Location</Label>
        <Input className="mt-1" placeholder="Restaurant name, address, or Zoom link" value={f.location}
          onChange={e => set("location", e.target.value)} />
      </div>

      {/* Contact picker */}
      <div className="p-3 border rounded-lg space-y-3 bg-muted/30">
        <p className="text-xs font-semibold flex items-center gap-1.5"><User className="w-3.5 h-3.5" />Partner / Contact</p>
        <div>
          <Label className="text-xs">Select from Contacts</Label>
          <Select value={f.contactId} onValueChange={handleContactChange}>
            <SelectTrigger className="mt-1 h-9 text-xs"><SelectValue placeholder="Pick a contact (optional)" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">— No contact —</SelectItem>
              {contacts.map(c => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}{c.company ? ` — ${c.company}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Contact Name</Label>
            <Input className="mt-1 h-9 text-xs" placeholder="Full name" value={f.contactName}
              onChange={e => set("contactName", e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Contact Email</Label>
            <Input type="email" className="mt-1 h-9 text-xs" placeholder="email@example.com" value={f.contactEmail}
              onChange={e => set("contactEmail", e.target.value)} />
          </div>
        </div>

        {/* Notify toggle */}
        <div className="flex items-center justify-between pt-1">
          <div>
            <p className="text-xs font-medium">Notify Partner</p>
            <p className="text-xs text-muted-foreground">
              {f.contactEmail
                ? `Logs invite email to ${f.contactEmail}`
                : "Enter email above to enable"}
            </p>
          </div>
          <Switch checked={f.notifyPartner && !!f.contactEmail}
            onCheckedChange={v => set("notifyPartner", v)}
            disabled={!f.contactEmail} data-testid="switch-notify-partner" />
        </div>
        {f.notifyPartner && f.contactEmail && (
          <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded p-2">
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
            An invite email will be sent to {f.contactEmail} when saved.
          </div>
        )}
      </div>

      {/* Notes */}
      <div>
        <Label className="text-xs">Notes / Agenda</Label>
        <Textarea className="mt-1 text-sm resize-none" rows={3}
          placeholder="Agenda, talking points, what to bring..." value={f.notes}
          onChange={e => set("notes", e.target.value)} />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button className="flex-1 bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/.85)] text-white"
          onClick={() => save.mutate()} disabled={save.isPending || !f.title || !f.date || !f.startTime}
          data-testid="button-save-event">
          {save.isPending ? "Saving…" : isEdit ? "Update Event" : "Create Event"}
        </Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

// ── Event Detail Popover ──────────────────────────────────────────────────────
function EventDetail({ event, onEdit, onDelete, onClose }: {
  event: BdEvent;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const et = getEventType(event.eventType);
  const timeStr = event.startTime + (event.endTime ? ` – ${event.endTime}` : "");

  return (
    <div className="space-y-3 min-w-[280px]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Badge className={`text-xs mb-2 border ${et.color}`}>{et.icon} {et.label}</Badge>
          <h3 className="font-semibold text-sm leading-tight">{event.title}</h3>
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7 -mt-1" onClick={onClose}><X className="w-4 h-4" /></Button>
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Calendar className="w-3.5 h-3.5" />
          <span>{event.date}</span>
          <Clock className="w-3.5 h-3.5 ml-1" />
          <span>{timeStr}</span>
        </div>
        {event.location && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="w-3.5 h-3.5" />
            <span>{event.location}</span>
          </div>
        )}
        {event.contactName && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <User className="w-3.5 h-3.5" />
            <span>{event.contactName}</span>
          </div>
        )}
        {event.contactEmail && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mail className="w-3.5 h-3.5" />
            <span>{event.contactEmail}</span>
            {event.notified ? (
              <Badge className="bg-green-100 text-green-700 text-[10px] px-1.5 py-0">Notified ✓</Badge>
            ) : event.notifyPartner ? (
              <Badge className="bg-yellow-100 text-yellow-700 text-[10px] px-1.5 py-0">Notify pending</Badge>
            ) : null}
          </div>
        )}
        {event.notes && (
          <div className="mt-2 p-2 bg-muted rounded text-muted-foreground leading-relaxed">
            {event.notes}
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1 border-t">
        <Button size="sm" variant="outline" className="flex-1" onClick={onEdit}>
          <Edit2 className="w-3.5 h-3.5 mr-1" />Edit
        </Button>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Month Calendar Grid ───────────────────────────────────────────────────────
function MonthView({
  year, month, events, onDayClick, onEventClick
}: {
  year: number;
  month: number; // 0-indexed
  events: BdEvent[];
  onDayClick: (date: string) => void;
  onEventClick: (event: BdEvent) => void;
}) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayLocalISO();

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // pad to complete rows
  while (cells.length % 7 !== 0) cells.push(null);

  function dateStr(day: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function eventsOnDay(day: number) {
    const d = dateStr(day);
    return events.filter(e => e.date === d).sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  return (
    <div className="border rounded-xl overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 bg-muted border-b">
        {DAYS.map(d => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground">{d}</div>
        ))}
      </div>
      {/* Week rows */}
      <div className="grid grid-cols-7 divide-x divide-y">
        {cells.map((day, idx) => {
          if (!day) return <div key={`empty-${idx}`} className="min-h-[90px] bg-muted/20" />;
          const ds = dateStr(day);
          const isToday = ds === today;
          const dayEvents = eventsOnDay(day);
          return (
            <div
              key={ds}
              className={`min-h-[90px] p-1 cursor-pointer hover:bg-muted/40 transition-colors ${isToday ? "bg-blue-50 dark:bg-blue-950/20" : ""}`}
              onClick={() => onDayClick(ds)}
            >
              <div className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 ${
                isToday ? "bg-[hsl(var(--titan-blue))] text-white" : "text-foreground"
              }`}>
                {day}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map(ev => {
                  const et = getEventType(ev.eventType);
                  return (
                    <button
                      key={ev.id}
                      onClick={e => { e.stopPropagation(); onEventClick(ev); }}
                      className={`w-full text-left text-[10px] px-1.5 py-0.5 rounded truncate border font-medium ${et.color} hover:opacity-80 transition-opacity`}
                    >
                      {ev.startTime.slice(0, 5)} {ev.title}
                    </button>
                  );
                })}
                {dayEvents.length > 3 && (
                  <p className="text-[10px] text-muted-foreground pl-1">+{dayEvents.length - 3} more</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── List / Agenda View ────────────────────────────────────────────────────────
function ListView({ events, onEventClick }: { events: BdEvent[]; onEventClick: (e: BdEvent) => void }) {
  const today = todayLocalISO();
  const upcoming = events.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const past = events.filter(e => e.date < today).sort((a, b) => b.date.localeCompare(a.date));

  function EventRow({ ev }: { ev: BdEvent }) {
    const et = getEventType(ev.eventType);
    return (
      <button onClick={() => onEventClick(ev)}
        className="w-full text-left flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border">
        <div className={`w-10 h-10 flex-shrink-0 rounded-lg flex items-center justify-center text-lg border ${et.color}`}>
          {et.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{ev.title}</p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{ev.date}</span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{ev.startTime}{ev.endTime ? ` – ${ev.endTime}` : ""}</span>
            {ev.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{ev.location}</span>}
            {ev.contactName && <span className="flex items-center gap-1"><User className="w-3 h-3" />{ev.contactName}</span>}
          </div>
        </div>
        <div className="flex-shrink-0 flex flex-col items-end gap-1">
          <Badge className={`text-[10px] border ${et.color}`}>{et.label}</Badge>
          {ev.notified ? (
            <span className="text-[10px] text-green-600 flex items-center gap-0.5"><CheckCircle className="w-3 h-3" />Notified</span>
          ) : ev.notifyPartner && ev.contactEmail ? (
            <span className="text-[10px] text-yellow-600 flex items-center gap-0.5"><Bell className="w-3 h-3" />Pending</span>
          ) : null}
        </div>
      </button>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No events yet</p>
        <p className="text-sm">Click the + button to schedule your first BD event.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {upcoming.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Upcoming ({upcoming.length})</p>
          <div className="space-y-1">
            {upcoming.map(ev => <EventRow key={ev.id} ev={ev} />)}
          </div>
        </div>
      )}
      {past.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Past Events ({past.length})</p>
          <div className="space-y-1 opacity-60">
            {past.map(ev => <EventRow key={ev.id} ev={ev} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BDCalendar() {
  const { toast } = useToast();
  const today = new Date();
  const [viewMode, setViewMode] = useState<"month" | "list">("month");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [formOpen, setFormOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<BdEvent | undefined>();
  const [detailEvent, setDetailEvent] = useState<BdEvent | undefined>();
  const [defaultDate, setDefaultDate] = useState<string>("");
  const [filterType, setFilterType] = useState("all");

  const { data: events = [], isLoading } = useQuery<BdEvent[]>({
    queryKey: ["/api/bd-events"],
    queryFn: () => apiRequest("GET", "/api/bd-events").then(r => r.json()),
    staleTime: 0,
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
    queryFn: () => apiRequest("GET", "/api/contacts").then(r => r.json()),
  });

  const deleteEvent = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/bd-events/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bd-events"] });
      setDetailEvent(undefined);
      toast({ title: "Event deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  const filteredEvents = useMemo(() =>
    filterType === "all" ? events : events.filter(e => e.eventType === filterType),
    [events, filterType]
  );

  const monthEvents = useMemo(() =>
    filteredEvents.filter(e => {
      const d = new Date(e.date);
      return d.getFullYear() === year && d.getMonth() === month;
    }),
    [filteredEvents, year, month]
  );

  // Stats
  const thisMonthCount = monthEvents.length;
  const upcomingCount = events.filter(e => e.date >= today.toISOString().slice(0, 10)).length;
  const notifiedCount = events.filter(e => e.notified).length;

  function openCreate(date?: string) {
    setEditEvent(undefined);
    setDefaultDate(date || "");
    setFormOpen(true);
  }

  function openEdit(ev: BdEvent) {
    setDetailEvent(undefined);
    setEditEvent(ev);
    setFormOpen(true);
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Calendar className="w-5 h-5 text-[hsl(var(--titan-blue))]" />
            BD Calendar
          </h1>
          <p className="text-sm text-muted-foreground">Schedule breakfasts, chamber events, partner meetings &amp; more</p>
        </div>
        <Button onClick={() => openCreate()}
          className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/.85)] text-white"
          data-testid="button-new-event">
          <Plus className="w-4 h-4 mr-1.5" />New Event
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-0 bg-muted/40">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-2xl font-bold">{thisMonthCount}</p>
            <p className="text-xs text-muted-foreground">This Month</p>
          </CardContent>
        </Card>
        <Card className="border-0 bg-muted/40">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-2xl font-bold text-[hsl(var(--titan-blue))]">{upcomingCount}</p>
            <p className="text-xs text-muted-foreground">Upcoming</p>
          </CardContent>
        </Card>
        <Card className="border-0 bg-muted/40">
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-2xl font-bold text-green-600">{notifiedCount}</p>
            <p className="text-xs text-muted-foreground">Partners Notified</p>
          </CardContent>
        </Card>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Month nav */}
        {viewMode === "month" && (
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="font-semibold text-sm min-w-[130px] text-center">{MONTHS[month]} {year}</span>
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
            <Button variant="ghost" size="sm" className="text-xs h-8"
              onClick={() => { setMonth(today.getMonth()); setYear(today.getFullYear()); }}>Today</Button>
          </div>
        )}

        {/* Filter by type */}
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {EVENT_TYPES.map(t => (
              <SelectItem key={t.value} value={t.value}>{t.icon} {t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* View toggle */}
        <div className="flex items-center border rounded-lg overflow-hidden ml-auto">
          <Button size="sm" variant={viewMode === "month" ? "default" : "ghost"}
            className="h-8 rounded-none text-xs px-3" onClick={() => setViewMode("month")}>
            <Calendar className="w-3.5 h-3.5 mr-1" />Month
          </Button>
          <Button size="sm" variant={viewMode === "list" ? "default" : "ghost"}
            className="h-8 rounded-none text-xs px-3" onClick={() => setViewMode("list")}>
            <List className="w-3.5 h-3.5 mr-1" />List
          </Button>
        </div>
      </div>

      {/* Calendar or List */}
      {isLoading ? (
        <div className="text-center py-16 text-muted-foreground text-sm">Loading calendar…</div>
      ) : viewMode === "month" ? (
        <MonthView
          year={year} month={month}
          events={filteredEvents}
          onDayClick={(date) => openCreate(date)}
          onEventClick={setDetailEvent}
        />
      ) : (
        <ListView events={filteredEvents} onEventClick={setDetailEvent} />
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-2 pt-1">
        {EVENT_TYPES.map(t => (
          <span key={t.value} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${t.color}`}>
            {t.icon} {t.label}
          </span>
        ))}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={open => { if (!open) setFormOpen(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
              {editEvent ? "Edit Event" : "New BD Event"}
            </DialogTitle>
          </DialogHeader>
          <EventForm
            event={editEvent}
            contacts={contacts}
            defaultDate={defaultDate}
            onClose={() => setFormOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailEvent} onOpenChange={open => { if (!open) setDetailEvent(undefined); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="sr-only">Event Details</DialogTitle>
          </DialogHeader>
          {detailEvent && (
            <EventDetail
              event={detailEvent}
              onEdit={() => openEdit(detailEvent)}
              onDelete={() => {
                if (confirm(`Delete "${detailEvent.title}"?`)) deleteEvent.mutate(detailEvent.id);
              }}
              onClose={() => setDetailEvent(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
