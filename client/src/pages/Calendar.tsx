// ─────────────────────────────────────────────────────────────────────────────
// Calendar (Google-Calendar-style)
// ─────────────────────────────────────────────────────────────────────────────
// Replaces the old list-oriented /scheduling page with a full month/week/day/
// agenda calendar built on FullCalendar. Same backend — GET/POST/PATCH/DELETE
// on /api/calendar-events. No external services, no API keys.
//
// UX parity with Google Calendar:
//   • Month, Week, Day, 4-day, and Agenda (list) views
//   • Click-and-drag on empty grid → creates a new event of that duration
//   • Drag existing event to move; drag bottom edge to resize
//   • Click event → edit dialog (title, date/time, location, notes, attendees, color)
//   • Mini month picker in the sidebar for fast navigation
//   • Prev/Next/Today buttons + view switcher in the top toolbar
//   • Keyboard shortcuts: M/W/D/A month/week/day/agenda, T today, ← / → navigate
//   • Multi-day event spans + all-day lane at the top of week/day
//   • Overlapping events auto-lay out side-by-side
//   • Filter chips: hide completed, filter by attendee
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
// FullCalendar v7 ships React-bundled plugin builds at
// @fullcalendar/react/{daygrid,timegrid,list,interaction}. The standalone
// @fullcalendar/daygrid etc. packages are v6 and INCOMPATIBLE with the v7
// React wrapper — mixing them causes the page to blank on load.
import FullCalendar from "@fullcalendar/react";
import type { EventInput } from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import listPlugin from "@fullcalendar/react/list";
import interactionPlugin from "@fullcalendar/react/interaction";
// v7 re-exports its callback arg types under obfuscated aliases
// (EventClickInfo, DateSelectInfo, EventDisplayInfo, PluginInput, …), so we
// use lightweight `any` param types on our handlers. Runtime shape is stable
// and covered by our own CalendarEvent type on extendedProps.raw.
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronLeft, ChevronRight, Plus, Trash2, Users, MapPin, X, Calendar as CalIcon, CheckCircle2 } from "lucide-react";

type CalendarEvent = {
  id: number; title: string; eventDate: string;
  startTime: string | null; endTime: string | null;
  location: string | null; notes: string | null;
  attendees: string[]; color: string | null;
  createdBy: string | null; createdAt: string;
  completedAt: string | null; completedBy: string | null;
};

type StaffMember = { id: number; name: string; role: string; isActive: boolean };

// Google-Calendar-style event color palette. Each key becomes a small dot in
// the event editor; the color is stored as a CSS hex string on the row.
const COLOR_CHOICES: Array<{ id: string; label: string; hex: string }> = [
  { id: "tomato",     label: "Tomato",     hex: "#d50000" },
  { id: "tangerine",  label: "Tangerine",  hex: "#f4511e" },
  { id: "banana",     label: "Banana",     hex: "#f6bf26" },
  { id: "sage",       label: "Sage",       hex: "#33b679" },
  { id: "basil",      label: "Basil",      hex: "#0b8043" },
  { id: "peacock",    label: "Peacock",    hex: "#039be5" },
  { id: "blueberry",  label: "Blueberry",  hex: "#3f51b5" },
  { id: "lavender",   label: "Lavender",   hex: "#7986cb" },
  { id: "grape",      label: "Grape",      hex: "#8e24aa" },
  { id: "flamingo",   label: "Flamingo",   hex: "#e67c73" },
  { id: "graphite",   label: "Graphite",   hex: "#616161" },
];

const DEFAULT_HEX = "#039be5"; // Peacock — Google's default event color

// Convert an ISO datetime (from FullCalendar drag) or the split
// {date, startTime, endTime} fields into strings the backend accepts.
function splitDateTime(iso: string): { date: string; time: string | null } {
  if (!iso) return { date: "", time: null };
  // FullCalendar returns "YYYY-MM-DD" for all-day and "YYYY-MM-DDTHH:MM:SS" otherwise.
  const [d, t] = iso.split("T");
  if (!t) return { date: d, time: null };
  const [h, m] = t.split(":");
  return { date: d, time: `${h}:${m}` };
}

function combineDateTime(date: string, time: string | null): string {
  if (!time) return date;
  return `${date}T${time}`;
}

// FullCalendar takes { start, end } as ISO — build them from the DB shape.
function eventToFC(ev: CalendarEvent): EventInput {
  const isAllDay = !ev.startTime;
  const start = isAllDay ? ev.eventDate : `${ev.eventDate}T${ev.startTime}`;
  // If endTime is missing, treat as 1-hour block (or all-day if start is too).
  let end: string | undefined;
  if (isAllDay) {
    end = undefined; // FC will render as full-day on eventDate
  } else if (ev.endTime) {
    end = `${ev.eventDate}T${ev.endTime}`;
  } else {
    // Default 1 hour if we somehow have a start but no end.
    const [h, m] = String(ev.startTime).split(":").map(Number);
    const endH = String((h + 1) % 24).padStart(2, "0");
    end = `${ev.eventDate}T${endH}:${String(m || 0).padStart(2, "0")}`;
  }
  const hex = ev.color && /^#[0-9a-f]{3,8}$/i.test(ev.color) ? ev.color : DEFAULT_HEX;
  return {
    id: String(ev.id),
    title: ev.title,
    start,
    end,
    allDay: isAllDay,
    backgroundColor: hex,
    borderColor: hex,
    textColor: "#ffffff",
    extendedProps: {
      raw: ev,
    },
  };
}

const BLANK_DRAFT = {
  id: null as number | null,
  title: "",
  eventDate: "",
  startTime: "09:00" as string | null,
  endTime: "10:00" as string | null,
  allDay: false,
  location: "",
  notes: "",
  attendees: [] as string[],
  color: DEFAULT_HEX,
};

export default function Calendar() {
  const calRef = useRef<any>(null);
  const { toast } = useToast();

  // Visible range — recomputed whenever FullCalendar moves. Used to scope
  // the GET so we don't ship every historical event on every render.
  const [visibleRange, setVisibleRange] = useState<{ start: string; end: string }>(() => {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return {
      start: startOfMonth.toISOString().slice(0, 10),
      end: endOfMonth.toISOString().slice(0, 10),
    };
  });
  const [viewLabel, setViewLabel] = useState<string>("");
  // Default view: month grid (dayGridMonth) on every viewport, including phone.
  // Earlier this defaulted to listMonth on mobile because dayGridMonth used to
  // collapse to a broken 40px single-column stack on narrow viewports — the
  // mobile CSS block at the bottom of the file now sizes rows/day-numbers/event
  // pills so the grid stays readable at 375px. The Agenda toggle in the
  // toolbar is still available for anyone who wants the list.
  type CalView = "dayGridMonth" | "timeGridWeek" | "timeGridDay" | "timeGridFourDay" | "listWeek" | "listMonth";
  const initialView: CalView = "dayGridMonth";
  const [currentView, setCurrentView] = useState<CalView>(initialView);

  // Data --------------------------------------------------------------------
  // Widen the visible range by ±60 days when fetching so that list views
  // (which report a narrow 7–31 day range in datesSet) still surface
  // adjacent scheduled work — and so we never appear “empty” because the
  // view happens to land on a slice with no events. Filtering back to the
  // exact visible slice is FullCalendar’s job.
  const wideRange = (() => {
    const s = new Date(visibleRange.start + "T00:00:00");
    const e = new Date(visibleRange.end + "T00:00:00");
    s.setDate(s.getDate() - 60);
    e.setDate(e.getDate() + 60);
    return { start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) };
  })();
  const { data: events = [], isLoading: eventsLoading, error: eventsError } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/calendar-events", wideRange.start, wideRange.end],
    queryFn: () =>
      apiRequest("GET", `/api/calendar-events?start=${wideRange.start}&end=${wideRange.end}`).then(r => {
        if (!r.ok) throw new Error(`Calendar fetch failed: ${r.status}`);
        return r.json();
      }),
  });

  const { data: assignableUsers = [] } = useQuery<StaffMember[]>({
    queryKey: ["/api/staff/assignable"],
    queryFn: () => apiRequest("GET", "/api/staff/assignable").then(r => r.json()),
  });

  // Filters -----------------------------------------------------------------
  const [hideCompleted, setHideCompleted] = useState(false);
  const [attendeeFilter, setAttendeeFilter] = useState<string>(""); // "" = all
  const filtered = useMemo(() => {
    return events.filter(ev => {
      if (hideCompleted && ev.completedAt) return false;
      if (attendeeFilter && !ev.attendees.includes(attendeeFilter)) return false;
      return true;
    });
  }, [events, hideCompleted, attendeeFilter]);
  const fcEvents = useMemo(() => filtered.map(eventToFC), [filtered]);

  // Editor dialog state -----------------------------------------------------
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState({ ...BLANK_DRAFT });
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  function openCreate(preset?: Partial<typeof BLANK_DRAFT>) {
    const today = new Date().toISOString().slice(0, 10);
    setDraft({ ...BLANK_DRAFT, eventDate: today, ...(preset || {}) });
    setEditorOpen(true);
  }
  function openEdit(ev: CalendarEvent) {
    setDraft({
      id: ev.id,
      title: ev.title,
      eventDate: ev.eventDate,
      startTime: ev.startTime,
      endTime: ev.endTime,
      allDay: !ev.startTime,
      location: ev.location || "",
      notes: ev.notes || "",
      attendees: [...ev.attendees],
      color: ev.color && /^#[0-9a-f]{3,8}$/i.test(ev.color) ? ev.color : DEFAULT_HEX,
    });
    setEditorOpen(true);
  }

  // Mutations ---------------------------------------------------------------
  const saveMut = useMutation({
    mutationFn: async (payload: any) => {
      if (draft.id != null) return apiRequest("PATCH", `/api/calendar-events/${draft.id}`, payload).then(r => r.json());
      return apiRequest("POST", "/api/calendar-events", payload).then(r => r.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-events"] });
      setEditorOpen(false);
      toast({ title: draft.id != null ? "Event updated" : "Event created" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message || "Try again.", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/calendar-events/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-events"] });
      setConfirmDeleteId(null);
      setEditorOpen(false);
      toast({ title: "Event deleted" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e?.message || "Try again.", variant: "destructive" }),
  });

  const completeMut = useMutation({
    mutationFn: (payload: { id: number; completed: boolean }) =>
      apiRequest("POST", `/api/calendar-events/${payload.id}/complete`, { completed: payload.completed }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/calendar-events"] }),
  });

  // Drag-move / resize sends a PATCH with new date + times.
  const dragPatch = useMutation({
    mutationFn: (payload: { id: number; body: any }) =>
      apiRequest("PATCH", `/api/calendar-events/${payload.id}`, payload.body).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/calendar-events"] }),
    onError: (e: any) => {
      toast({ title: "Move failed", description: e?.message || "Reverting.", variant: "destructive" });
      // Refetch to snap back visually.
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-events"] });
    },
  });

  // FullCalendar handlers ---------------------------------------------------
  function handleSelect(arg: any) {
    // Drag on empty grid → open Create with pre-filled date/time.
    const s = splitDateTime(arg.startStr);
    const e = splitDateTime(arg.endStr);
    openCreate({
      eventDate: s.date,
      startTime: arg.allDay ? null : s.time,
      endTime: arg.allDay ? null : e.time,
      allDay: arg.allDay,
    });
    arg.view.calendar.unselect();
  }
  function handleEventClick(arg: any) {
    const raw = arg.event.extendedProps.raw as CalendarEvent | undefined;
    if (raw) openEdit(raw);
  }
  function handleEventDrop(arg: any) {
    const s = splitDateTime(arg.event.startStr);
    const e = arg.event.endStr ? splitDateTime(arg.event.endStr) : null;
    const body: any = {
      eventDate: s.date,
      startTime: arg.event.allDay ? null : s.time,
      endTime: arg.event.allDay ? null : (e?.time ?? null),
    };
    dragPatch.mutate({ id: Number(arg.event.id), body });
  }
  function handleEventResize(arg: any) {
    const s = splitDateTime(arg.event.startStr);
    const e = arg.event.endStr ? splitDateTime(arg.event.endStr) : null;
    const body: any = {
      eventDate: s.date,
      startTime: arg.event.allDay ? null : s.time,
      endTime: arg.event.allDay ? null : (e?.time ?? null),
    };
    dragPatch.mutate({ id: Number(arg.event.id), body });
  }

  // Keyboard shortcuts (Google-Calendar-parity) -----------------------------
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      // Skip when the user is typing in an input/textarea/contenteditable.
      const tag = (ev.target as HTMLElement)?.tagName?.toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || (ev.target as HTMLElement)?.isContentEditable;
      if (isTyping || editorOpen || confirmDeleteId != null) return;
      const api = calRef.current?.getApi();
      if (!api) return;
      if (ev.key === "m" || ev.key === "1") { api.changeView("dayGridMonth"); setCurrentView("dayGridMonth"); }
      else if (ev.key === "w" || ev.key === "2") { api.changeView("timeGridWeek"); setCurrentView("timeGridWeek"); }
      else if (ev.key === "d" || ev.key === "3") { api.changeView("timeGridDay"); setCurrentView("timeGridDay"); }
      else if (ev.key === "x" || ev.key === "4") { api.changeView("timeGridFourDay"); setCurrentView("timeGridFourDay"); }
      else if (ev.key === "a" || ev.key === "5") { api.changeView("listWeek"); setCurrentView("listWeek"); }
      else if (ev.key === "t") { api.today(); }
      else if (ev.key === "j" || ev.key === "ArrowRight") { api.next(); }
      else if (ev.key === "k" || ev.key === "ArrowLeft") { api.prev(); }
      else if (ev.key === "c") { ev.preventDefault(); openCreate(); }
      else if (ev.key === "/") { ev.preventDefault(); document.getElementById("gcal-search")?.focus(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editorOpen, confirmDeleteId]);

  // Toolbar helpers ---------------------------------------------------------
  function nav(action: "prev" | "next" | "today") {
    const api = calRef.current?.getApi();
    if (!api) return;
    if (action === "prev") api.prev();
    else if (action === "next") api.next();
    else api.today();
  }
  function changeView(v: typeof currentView) {
    calRef.current?.getApi().changeView(v);
    setCurrentView(v);
  }
  function goToDate(iso: string) {
    calRef.current?.getApi().gotoDate(iso);
  }

  // Save handler
  function handleSave() {
    if (!draft.title.trim()) { toast({ title: "Title required", variant: "destructive" }); return; }
    if (!draft.eventDate) { toast({ title: "Date required", variant: "destructive" }); return; }
    const payload: any = {
      title: draft.title.trim(),
      eventDate: draft.eventDate,
      startTime: draft.allDay ? null : (draft.startTime || null),
      endTime: draft.allDay ? null : (draft.endTime || null),
      location: draft.location.trim() || null,
      notes: draft.notes.trim() || null,
      attendees: draft.attendees,
      color: draft.color,
    };
    saveMut.mutate(payload);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-3 md:p-4 space-y-3">
      {/* Top toolbar --------------------------------------------------- */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          onClick={() => openCreate()}
          className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
          data-testid="button-create-event"
        >
          <Plus className="w-4 h-4 mr-1" /> Create
        </Button>
        <div className="flex items-center gap-1 ml-2">
          <Button variant="outline" size="sm" onClick={() => nav("today")} data-testid="button-today">Today</Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => nav("prev")} data-testid="button-prev"><ChevronLeft className="w-4 h-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => nav("next")} data-testid="button-next"><ChevronRight className="w-4 h-4" /></Button>
        </div>
        <div className="text-lg font-semibold ml-2 min-w-[180px]">{viewLabel}</div>

        <div className="flex-1" />

        {/* Filters */}
        <div className="flex items-center gap-2 text-sm">
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="hide-completed"
              checked={hideCompleted}
              onCheckedChange={(v) => setHideCompleted(!!v)}
              data-testid="check-hide-completed"
            />
            <Label htmlFor="hide-completed" className="cursor-pointer">Hide completed</Label>
          </div>
          <Select value={attendeeFilter || "__all__"} onValueChange={(v) => setAttendeeFilter(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-[160px] h-8" data-testid="select-attendee-filter">
              <SelectValue placeholder="All attendees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All attendees</SelectItem>
              {assignableUsers.filter(u => u.isActive).map(u => (
                <SelectItem key={u.id} value={u.name}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* View switcher */}
        <div className="flex border rounded-md overflow-hidden text-xs">
          {[
            { key: "dayGridMonth" as const, label: "Month" },
            { key: "timeGridWeek" as const, label: "Week" },
            { key: "timeGridDay" as const, label: "Day" },
            { key: "timeGridFourDay" as const, label: "4 day" },
            { key: "listWeek" as const, label: "Week list" },
            { key: "listMonth" as const, label: "Agenda" },
          ].map(v => (
            <button
              key={v.key}
              type="button"
              onClick={() => changeView(v.key)}
              className={`px-3 py-1.5 border-r last:border-r-0 ${currentView === v.key ? "bg-[hsl(var(--titan-blue))] text-white" : "bg-background hover:bg-muted"}`}
              data-testid={`button-view-${v.key}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Two-column on desktop; on mobile the calendar takes the full width
          and the sidebar (mini month, staff filter, keyboard hints) is hidden
          — mini-month became a useless vertical S/M/T/W… column on a phone,
          and keyboard shortcuts don't apply on touch anyway. */}
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-3">
        {/* Sidebar: mini month picker + staff filter + keyboard hints — md+ only. */}
        <aside className="space-y-3 hidden md:block">
          <MiniMonth onPick={(iso) => goToDate(iso)} />
          <div className="rounded-md border p-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
              <Users className="w-3 h-3" /> Staff
            </div>
            <div className="max-h-64 overflow-y-auto space-y-0.5">
              {assignableUsers.filter(u => u.isActive).map(u => {
                const on = attendeeFilter === u.name;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setAttendeeFilter(on ? "" : u.name)}
                    className={`w-full text-left text-xs px-2 py-1 rounded ${on ? "bg-[hsl(var(--titan-blue))] text-white" : "hover:bg-muted"}`}
                    data-testid={`chip-staff-${u.id}`}
                  >
                    {u.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="rounded-md border p-2 text-[11px] text-muted-foreground space-y-0.5">
            <div className="uppercase tracking-wide mb-1">Keyboard</div>
            <div>M / W / D / X / A — views</div>
            <div>← / → or J / K — navigate</div>
            <div>T — today · C — create</div>
          </div>
        </aside>

        {/* FullCalendar main area */}
        <div className="rounded-md border bg-background p-2">
          {/* Diagnostic banner — makes empty / failed calendar loads loud
              instead of silently blank. Existing events data is untouched;
              this only reports what the fetch is doing. */}
          {eventsError ? (
            <div className="mb-2 rounded-md border border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300 px-3 py-2 text-sm">
              Couldn't load calendar events. Check your connection and pull to refresh, or sign in again if the session expired.
            </div>
          ) : !eventsLoading && events.length === 0 ? (
            <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200 px-3 py-2 text-xs">
              No scheduled events in the current window. Tap Month or Week to widen the view, or use the ← / → arrows to navigate.
            </div>
          ) : null}
          <FullCalendar
            ref={calRef as any}
            plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin] as any}
            initialView={initialView}
            headerToolbar={false /* we render our own */}
            height="calc(100vh - 220px)"
            firstDay={0}
            nowIndicator
            editable
            selectable
            selectMirror
            dayMaxEvents={3}
            weekNumbers={false}
            eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
            slotLabelFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
            views={{
              timeGridFourDay: { type: "timeGrid", duration: { days: 4 } },
            }}
            events={fcEvents as any}
            select={handleSelect}
            eventClick={handleEventClick}
            eventDrop={handleEventDrop}
            eventResize={handleEventResize}
            eventContent={(arg) => renderEventContent(arg, completeMut.mutate)}
            datesSet={(arg) => {
              setViewLabel(arg.view.title);
              // Extend fetch window slightly so events partially in view render.
              const s = arg.startStr.slice(0, 10);
              const e = arg.endStr.slice(0, 10);
              setVisibleRange((prev) => (prev.start === s && prev.end === e ? prev : { start: s, end: e }));
            }}
          />
        </div>
      </div>

      {/* Editor dialog --------------------------------------------------- */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft.id != null ? "Edit event" : "New event"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Input
                autoFocus
                placeholder="Add title"
                value={draft.title}
                onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                className="text-base font-medium"
                data-testid="input-event-title"
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="all-day"
                checked={draft.allDay}
                onCheckedChange={(v) => setDraft(d => ({
                  ...d,
                  allDay: !!v,
                  startTime: v ? null : (d.startTime || "09:00"),
                  endTime: v ? null : (d.endTime || "10:00"),
                }))}
                data-testid="check-all-day"
              />
              <Label htmlFor="all-day" className="cursor-pointer">All day</Label>
            </div>

            <div className={`grid ${draft.allDay ? "grid-cols-1" : "grid-cols-3"} gap-2`}>
              <div>
                <Label className="text-[11px]">Date</Label>
                <Input
                  type="date"
                  value={draft.eventDate}
                  onChange={e => setDraft(d => ({ ...d, eventDate: e.target.value }))}
                  data-testid="input-event-date"
                />
              </div>
              {!draft.allDay && (
                <>
                  <div>
                    <Label className="text-[11px]">Start</Label>
                    <Input
                      type="time"
                      value={draft.startTime || ""}
                      onChange={e => setDraft(d => ({ ...d, startTime: e.target.value }))}
                      data-testid="input-event-start"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px]">End</Label>
                    <Input
                      type="time"
                      value={draft.endTime || ""}
                      onChange={e => setDraft(d => ({ ...d, endTime: e.target.value }))}
                      data-testid="input-event-end"
                    />
                  </div>
                </>
              )}
            </div>

            <div>
              <Label className="text-[11px] flex items-center gap-1"><MapPin className="w-3 h-3" /> Location</Label>
              <Input
                value={draft.location}
                onChange={e => setDraft(d => ({ ...d, location: e.target.value }))}
                placeholder="Address or meeting link"
                data-testid="input-event-location"
              />
            </div>

            <div>
              <Label className="text-[11px] flex items-center gap-1"><Users className="w-3 h-3" /> Attendees</Label>
              <AttendeePicker
                users={assignableUsers}
                value={draft.attendees}
                onChange={(next) => setDraft(d => ({ ...d, attendees: next }))}
              />
            </div>

            <div>
              <Label className="text-[11px]">Color</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {COLOR_CHOICES.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    aria-label={c.label}
                    title={c.label}
                    onClick={() => setDraft(d => ({ ...d, color: c.hex }))}
                    className={`w-6 h-6 rounded-full border transition-transform ${draft.color === c.hex ? "ring-2 ring-offset-1 ring-[hsl(var(--titan-blue))] scale-110" : ""}`}
                    style={{ backgroundColor: c.hex, borderColor: c.hex }}
                    data-testid={`color-${c.id}`}
                  />
                ))}
              </div>
            </div>

            <div>
              <Label className="text-[11px]">Notes</Label>
              <Textarea
                value={draft.notes}
                onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
                rows={3}
                data-testid="textarea-event-notes"
              />
            </div>
          </div>
          <DialogFooter className="flex items-center justify-between gap-2">
            {draft.id != null && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDeleteId(draft.id)}
                data-testid="button-delete-event"
              >
                <Trash2 className="w-4 h-4 mr-1" /> Delete
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saveMut.isPending}
              className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue))/90] text-white"
              data-testid="button-save-event"
            >
              {saveMut.isPending ? "Saving…" : draft.id != null ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation -------------------------------------------- */}
      <AlertDialog open={confirmDeleteId != null} onOpenChange={(o) => { if (!o) setConfirmDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this event?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))]"
              onClick={() => { if (confirmDeleteId != null) deleteMut.mutate(confirmDeleteId); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* FullCalendar theme overrides ------------------------------------ */}
      <style>{`
        .fc { font-family: inherit; }
        .fc .fc-toolbar-title { font-size: 1.05rem; }
        .fc .fc-daygrid-day.fc-day-today,
        .fc .fc-timegrid-col.fc-day-today { background: hsl(var(--titan-blue) / 0.06) !important; }
        .fc .fc-daygrid-day-number { font-size: 12px; padding: 4px 6px; color: hsl(var(--foreground)); }
        .fc .fc-col-header-cell-cushion { font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: hsl(var(--muted-foreground)); padding: 6px 4px; }
        .fc .fc-event { border-radius: 4px; border-width: 0; padding: 1px 4px; font-size: 12px; cursor: pointer; }
        .fc .fc-event .gcal-event-inner { display: flex; align-items: center; gap: 4px; overflow: hidden; }
        .fc .fc-event.gcal-done { text-decoration: line-through; opacity: 0.65; }
        .fc .fc-timegrid-slot { height: 2.4em; }
        .fc .fc-timegrid-slot-label { font-size: 10.5px; color: hsl(var(--muted-foreground)); }
        .fc .fc-scrollgrid { border-color: hsl(var(--border)); }
        .fc .fc-daygrid-day-frame { min-height: 90px; }
        .fc .fc-list-event:hover td { background: hsl(var(--muted) / 0.4); }
        .fc .fc-list-day-cushion { background: hsl(var(--muted) / 0.3); }
        .fc-direction-ltr .fc-list-event-time { color: hsl(var(--muted-foreground)); }
        .fc .fc-more-link { color: hsl(var(--titan-blue)); font-size: 11px; }

        /* Mobile month grid — force the 7-column layout to hold at 375px.

           The root cause of the earlier broken layout: FullCalendar’s
           <table class="fc-scrollgrid"> uses table-layout:auto by default,
           and at narrow widths some webkit builds collapse day <td>s
           vertically instead of shrinking horizontally. Forcing
           table-layout:fixed with equal column widths pins the 7-column
           grid regardless of viewport. width:100% on <colgroup><col>
           ensures each column gets an equal 1/7 share.

           Row height + event pills also compact so the whole month fits
           without vertical scroll. */
        @media (max-width: 767px) {
          .fc .fc-toolbar-title { font-size: 0.95rem; }

          /* Hard-force the 7-column table layout. */
          .fc .fc-scrollgrid,
          .fc .fc-scrollgrid table,
          .fc .fc-daygrid-body,
          .fc .fc-daygrid-body > table { table-layout: fixed !important; width: 100% !important; }
          .fc .fc-scrollgrid col,
          .fc .fc-daygrid-body col { width: calc(100% / 7) !important; }
          .fc .fc-col-header-cell,
          .fc .fc-daygrid-day { width: calc(100% / 7) !important; min-width: 0 !important; }
          .fc .fc-daygrid-day-frame { min-height: 56px; overflow: hidden; }

          /* Weekday header + day number typography scaled down. */
          .fc .fc-col-header-cell-cushion { font-size: 10px; padding: 4px 0; }
          .fc .fc-daygrid-day-number { font-size: 11px; padding: 2px 4px; }

          /* Event pills stay small; hide the inline check button + time so
             each pill fits in ~48px width without clipping the title. */
          .fc .fc-daygrid-event { padding: 0 3px; margin: 1px 2px; font-size: 10px; line-height: 1.2; border-radius: 3px; }
          .fc .fc-daygrid-event .gcal-event-inner { gap: 2px; }
          .fc .fc-daygrid-event .gcal-event-inner > button,
          .fc .fc-daygrid-event .gcal-event-inner > span:not(:last-child) { display: none; }
          .fc .fc-daygrid-event .gcal-event-inner > span:last-child { font-size: 10px; }
          .fc .fc-more-link { font-size: 10px; padding: 0 2px; }
        }
      `}</style>
    </div>
  );
}

// ── Event pill renderer ─────────────────────────────────────────────────────
// Adds a subtle done-check affordance to each event. Left-click the check to
// toggle completion without opening the full editor.
function renderEventContent(arg: any, toggleDone: (p: { id: number; completed: boolean }) => void) {
  const raw = arg.event.extendedProps.raw as CalendarEvent | undefined;
  const done = !!raw?.completedAt;
  return (
    <div className={`gcal-event-inner ${done ? "gcal-done" : ""}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (raw) toggleDone({ id: raw.id, completed: !done });
        }}
        className="opacity-70 hover:opacity-100"
        title={done ? "Mark not done" : "Mark done"}
      >
        <CheckCircle2 className="w-3 h-3" />
      </button>
      {!arg.event.allDay && arg.timeText ? (
        <span className="opacity-90 whitespace-nowrap">{arg.timeText}</span>
      ) : null}
      <span className="truncate font-medium">{arg.event.title || "(no title)"}</span>
    </div>
  );
}

// ── Attendee picker (name-based) ────────────────────────────────────────────
// Attendees are just strings server-side so a homeowner or subcontractor can
// be tagged too. This picker shows active staff as suggestions but accepts
// arbitrary typed names via Enter.
function AttendeePicker({ users, value, onChange }:{
  users: StaffMember[]; value: string[]; onChange: (next: string[]) => void;
}) {
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const active = users.filter(u => u.isActive && !value.includes(u.name));
  const filtered = typed
    ? active.filter(u => u.name.toLowerCase().includes(typed.toLowerCase()))
    : active;

  function add(name: string) {
    const n = name.trim();
    if (!n) return;
    if (value.includes(n)) return;
    onChange([...value, n]);
    setTyped("");
  }
  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map(name => (
            <span key={name} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
              {name}
              <button
                type="button"
                onClick={() => onChange(value.filter(n => n !== name))}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Input
            value={typed}
            onChange={(e) => { setTyped(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(typed); } }}
            placeholder="Add staff, subcontractor, or homeowner…"
            data-testid="input-attendees"
          />
        </PopoverTrigger>
        <PopoverContent align="start" className="p-1 w-[280px] max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-xs text-muted-foreground p-2">
              {typed ? `Press Enter to add "${typed}"` : "All staff already added."}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map(u => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => { add(u.name); setOpen(false); }}
                  className="w-full text-left text-sm px-2 py-1 rounded hover:bg-muted"
                >
                  {u.name} <span className="text-[10px] text-muted-foreground">· {u.role}</span>
                </button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ── Mini month picker (Google-Calendar-style sidebar) ────────────────────
function MiniMonth({ onPick }: { onPick: (iso: string) => void }) {
  const [month, setMonth] = useState(() => new Date());
  const y = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(y, m, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: Array<{ d: number; iso: string; other?: boolean }> = [];
  // Leading blanks from prev month
  const prevDays = new Date(y, m, 0).getDate();
  for (let i = 0; i < startWeekday; i++) {
    const d = prevDays - startWeekday + 1 + i;
    const iso = new Date(y, m - 1, d).toISOString().slice(0, 10);
    cells.push({ d, iso, other: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ d, iso: new Date(y, m, d).toISOString().slice(0, 10) });
  }
  while (cells.length % 7 !== 0) {
    const d = cells.length - startWeekday - daysInMonth + 1;
    const iso = new Date(y, m + 1, d).toISOString().slice(0, 10);
    cells.push({ d, iso, other: true });
  }
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="rounded-md border p-2">
      <div className="flex items-center justify-between mb-1.5">
        <button
          type="button"
          className="p-1 hover:bg-muted rounded"
          onClick={() => setMonth(new Date(y, m - 1, 1))}
          aria-label="Previous month"
        ><ChevronLeft className="w-3.5 h-3.5" /></button>
        <div className="text-xs font-semibold">
          {month.toLocaleString("en-US", { month: "long", year: "numeric" })}
        </div>
        <button
          type="button"
          className="p-1 hover:bg-muted rounded"
          onClick={() => setMonth(new Date(y, m + 1, 1))}
          aria-label="Next month"
        ><ChevronRight className="w-3.5 h-3.5" /></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-[9px] text-muted-foreground uppercase mb-0.5">
        {["S","M","T","W","T","F","S"].map((d, i) => <div key={i} className="text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((c, i) => {
          const isToday = c.iso === today;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(c.iso)}
              className={`text-[10.5px] rounded aspect-square flex items-center justify-center transition
                ${c.other ? "text-muted-foreground/40" : "hover:bg-muted"}
                ${isToday ? "bg-[hsl(var(--titan-blue))] text-white hover:bg-[hsl(var(--titan-blue))/90]" : ""}
              `}
            >
              {c.d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
