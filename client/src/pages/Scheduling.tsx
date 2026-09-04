import { useQuery, useMutation } from "@tanstack/react-query";
import { UserSelect } from "@/components/UserSelect";
import JobCombobox from "@/components/JobCombobox";
import { useState } from "react";
import { Plus, ChevronLeft, ChevronRight, Briefcase, Bell, Plane, Trash2, Calendar as CalIcon, LayoutGrid, ListChecks, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Shift, Job } from "@shared/schema";

// A system user (from User Management) that can be assigned shifts.
type StaffMember = { id: number; name: string; role: string; isActive: boolean };

// Approved time-off entry from the HR module, surfaced read-only for dispatch.
type TimeOff = { id: number; employeeId: number; name: string; category: string; startDate: string; endDate: string; hours: number };

// Standalone calendar event — not tied to a job. Attendees are just names
// so anyone (system user, subcontractor, or a homeowner) can be tagged.
type CalendarEvent = {
  id: number; title: string; eventDate: string;
  startTime: string | null; endTime: string | null;
  location: string | null; notes: string | null;
  attendees: string[]; color: string | null;
  createdBy: string | null; createdAt: string;
};

const BLANK_EVENT = { title: "", eventDate: "", startTime: "09:00", endTime: "10:00", location: "", notes: "", attendees: [] as string[] };

const TO_CAT_LABEL: Record<string, string> = {
  pto: "PTO", sick: "Sick", unpaid: "Unpaid", bereavement: "Bereavement",
  jury_duty: "Jury Duty", holiday: "Holiday", other: "Time Off",
};

// Rotating color palette assigned deterministically by user name, so any
// system user gets a consistent color even though the roster is dynamic.
const COLOR_PALETTE = [
  "bg-[hsl(var(--titan-blue)/0.15)] border-[hsl(var(--titan-blue)/0.5)] text-[hsl(var(--titan-blue))]",
  "bg-purple-100 border-purple-300 text-purple-700",
  "bg-green-100 border-green-300 text-green-700",
  "bg-orange-100 border-orange-300 text-orange-700",
  "bg-yellow-100 border-yellow-300 text-yellow-700",
  "bg-[hsl(var(--titan-red)/0.1)] border-[hsl(var(--titan-red)/0.4)] text-[hsl(var(--titan-red))]",
  "bg-teal-100 border-teal-300 text-teal-700",
  "bg-pink-100 border-pink-300 text-pink-700",
];

function colorForName(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLOR_PALETTE[h % COLOR_PALETTE.length];
}

function getWeekDates(refDate: Date) {
  const d = new Date(refDate);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(d);
    dd.setDate(d.getDate() + i);
    return dd;
  });
}

// Build a 6-row (42-day) grid starting on the Sunday that precedes the
// first-of-month. This gives a consistent month view regardless of how
// the month falls, matching how Google/Apple Calendar render — leading
// and trailing gray-out days from the sibling months keep the layout
// symmetrical instead of ragged.
function getMonthGrid(refDate: Date) {
  const first = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const dd = new Date(start);
    dd.setDate(start.getDate() + i);
    return dd;
  });
}

// Use the local date parts, not toISOString(), so a shift on Sept 4 in
// EDT doesn't get shifted to Sept 5 UTC and end up in the wrong day cell.
function isoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The dialog handles both create AND edit. When `editingId` is null we call
// POST /api/shifts; otherwise PATCH /api/shifts/:id. A Delete button on the
// edit form makes shift removal a clear, one-click action instead of a hidden
// hover interaction that was easy to miss.
const BLANK_FORM = { techName: "", shiftDate: isoDate(new Date()), startTime: "08:00", endTime: "16:00", title: "", jobId: "", notes: "" };

export default function Scheduling() {
  const [weekRef, setWeekRef] = useState(new Date());
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(BLANK_FORM);
  // View toggle: 'week' (original planner) vs 'month' (compact overview).
  // Persisted per session in a useState — not localStorage — because
  // dispatchers move between the two constantly and the browser refresh
  // rate matters less than not surprising them next login.
  const [view, setView] = useState<"week" | "month">("month");
  // The day-detail sheet: when set to an ISO date string, we render a
  // bottom panel listing every shift + time-off for that date as a
  // task-style list. Set from clicking a day cell in either view.
  const [dayDetail, setDayDetail] = useState<string | null>(null);
  // Standalone calendar-event dialog state. Kept separate from the shift
  // dialog so we don't cross-wire two very different data shapes.
  const [eventOpen, setEventOpen] = useState(false);
  const [eventEditingId, setEventEditingId] = useState<number | null>(null);
  const [eventForm, setEventForm] = useState<typeof BLANK_EVENT>({ ...BLANK_EVENT, eventDate: isoDate(new Date()) });
  const { toast } = useToast();

  // Open the dialog fresh for a new shift on `dateStr` (or today).
  function openCreate(dateStr?: string) {
    setEditingId(null);
    setForm({ ...BLANK_FORM, shiftDate: dateStr || isoDate(new Date()) });
    setOpen(true);
  }

  // Open the dialog pre-filled from an existing shift for editing.
  function openEdit(s: Shift) {
    setEditingId(s.id);
    setForm({
      techName: s.techName || "",
      shiftDate: s.shiftDate || isoDate(new Date()),
      startTime: s.startTime || "08:00",
      endTime: s.endTime || "16:00",
      title: s.title || "",
      jobId: s.jobId != null ? String(s.jobId) : "",
      notes: (s as any).notes || "",
    });
    setOpen(true);
  }

  const weekDates0 = getWeekDates(weekRef);
  const monthGrid = getMonthGrid(weekRef);
  // Range used for time-off fetch — spans whichever view is active so we
  // never render a day cell missing its "out" pills.
  const rangeStart = view === "month" ? isoDate(monthGrid[0])  : isoDate(weekDates0[0]);
  const rangeEnd   = view === "month" ? isoDate(monthGrid[41]) : isoDate(weekDates0[6]);

  const { data: shifts = [] } = useQuery<Shift[]>({ queryKey: ["/api/shifts"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  // Standalone calendar events — not tied to a job. Fetched over the
  // same range as time-off so month/week both include them.
  const { data: events = [] } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/calendar-events", rangeStart, rangeEnd],
    queryFn: () => apiRequest("GET", `/api/calendar-events?start=${rangeStart}&end=${rangeEnd}`).then(r => r.json()),
  });
  // Approved time-off overlapping the visible range (read-only, from HR).
  const { data: timeOff = [] } = useQuery<TimeOff[]>({
    queryKey: ["/api/hr/timeoff/calendar", rangeStart, rangeEnd],
    queryFn: () => apiRequest("GET", `/api/hr/timeoff/calendar?start=${rangeStart}&end=${rangeEnd}`).then(r => r.json()),
  });
  // Only system users (from User Management) can be assigned. The assignable
  // endpoint already returns active users only and is readable by any user.
  const { data: assignableUsers = [] } = useQuery<StaffMember[]>({
    queryKey: ["/api/staff/assignable"],
    queryFn: () => apiRequest("GET", "/api/staff/assignable").then(r => r.json()),
  });

  const saveMutation = useMutation({
    // Route to POST when creating a new shift, PATCH when editing an existing
    // one — keeps the dialog code path identical for both flows.
    mutationFn: (data: any) => {
      if (editingId != null) return apiRequest("PATCH", `/api/shifts/${editingId}`, data);
      return apiRequest("POST", "/api/shifts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      setOpen(false);
      setEditingId(null);
      toast({ title: editingId != null ? "Shift updated" : "Shift created" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message || "Please try again.", variant: "destructive" }),
  });

  const deleteShift = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/shifts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      setOpen(false);
      setEditingId(null);
      toast({ title: "Shift deleted" });
    },
  });

  // Calendar-event save / delete. Refresh the same query key we read
  // from so the UI updates without a hard reload.
  const saveEvent = useMutation({
    mutationFn: (data: any) => {
      if (eventEditingId != null) return apiRequest("PATCH", `/api/calendar-events/${eventEditingId}`, data);
      return apiRequest("POST", "/api/calendar-events", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-events"] });
      setEventOpen(false); setEventEditingId(null);
      toast({ title: eventEditingId != null ? "Event updated" : "Event created" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message || "Please try again.", variant: "destructive" }),
  });
  const deleteEvent = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/calendar-events/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calendar-events"] });
      setEventOpen(false); setEventEditingId(null);
      toast({ title: "Event deleted" });
    },
  });

  function openCreateEvent(dateStr?: string) {
    setEventEditingId(null);
    setEventForm({ ...BLANK_EVENT, eventDate: dateStr || isoDate(new Date()) });
    setEventOpen(true);
  }
  function openEditEvent(ev: CalendarEvent) {
    setEventEditingId(ev.id);
    setEventForm({
      title: ev.title,
      eventDate: ev.eventDate,
      startTime: ev.startTime || "",
      endTime: ev.endTime || "",
      location: ev.location || "",
      notes: ev.notes || "",
      attendees: Array.isArray(ev.attendees) ? ev.attendees : [],
    });
    setEventOpen(true);
  }

  const weekDates = weekDates0;
  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const shiftsOnDate = (dateStr: string) => shifts.filter(s => s.shiftDate === dateStr);
  // Time-off entries covering a given day (inclusive of start & end).
  const timeOffOnDate = (dateStr: string) => timeOff.filter(t => t.startDate <= dateStr && t.endDate >= dateStr);
  const eventsOnDate = (dateStr: string) => events.filter(e => e.eventDate === dateStr);

  // Group a day's shifts by job so the calendar reads "job-first".
  // Shifts without a jobId roll into a single "Unassigned" bucket, and
  // we return them last. Ordering inside each group is by startTime so
  // the earliest crew shows first.
  function groupShiftsByJob(dayShifts: Shift[]) {
    const byJob = new Map<number | "none", Shift[]>();
    for (const s of dayShifts) {
      const key: number | "none" = s.jobId != null ? s.jobId : "none";
      const arr = byJob.get(key) || [];
      arr.push(s);
      byJob.set(key, arr);
    }
    const groups: { key: number | "none"; job: Job | null; shifts: Shift[] }[] = [];
    for (const [key, arr] of byJob.entries()) {
      const job = typeof key === "number" ? (jobs.find(j => j.id === key) || null) : null;
      arr.sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
      groups.push({ key, job, shifts: arr });
    }
    // Put job-linked groups first (by job number), then "none".
    groups.sort((a, b) => {
      if (a.key === "none") return 1;
      if (b.key === "none") return -1;
      const an = a.job?.jobNumber || "";
      const bn = b.job?.jobNumber || "";
      return an.localeCompare(bn);
    });
    return groups;
  }

  function jobDisplayLabel(job: Job | null | undefined) {
    if (!job) return "Unassigned";
    const who = (job as any).customerName || (job as any).customer || "";
    const addr = job.address ? String(job.address).split(",")[0] : "";
    const tail = who || addr || job.lossType || "";
    return tail ? `${job.jobNumber} — ${tail}` : job.jobNumber;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Scheduling</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => openCreateEvent()}
            data-testid="button-new-event"
            title="Add an event (meeting, training, etc.) not tied to a job"
          >
            <CalIcon className="w-4 h-4 mr-2" />New Event
          </Button>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditingId(null); }}>
          <DialogTrigger asChild>
            <Button
              className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
              onClick={() => openCreate()}
              data-testid="button-new-shift"
            >
              <Plus className="w-4 h-4 mr-2" />Assign Job / Shift
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingId != null ? "Edit Shift" : "Assign Job / Shift"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Assign To (system user)</Label>
                <UserSelect
                  value={form.techName}
                  onChange={v => setForm(f => ({ ...f, techName: v }))}
                  placeholder="Select a user"
                  testId="select-shift-assignee"
                />
              </div>

              <div>
                <Label>Assign Job (optional)</Label>
                {/* Searchable combobox replaces the plain <Select>. Types
                    to filter by job number, loss type, address, or
                    customer/contact name so dispatchers don't have to
                    scroll a growing list. */}
                <JobCombobox
                  jobs={jobs.filter(j => j.status !== "closed")}
                  value={form.jobId}
                  onChange={(v) => {
                    const job = jobs.find(j => j.id === Number(v));
                    const label = job ? `${job.jobNumber} — ${job.customerName || job.lossType || "Untitled"}` : "";
                    setForm(f => ({ ...f, jobId: v, title: label || f.title }));
                  }}
                  placeholder="Search jobs by number, customer, address, or loss type…"
                  data-testid="combobox-shift-job"
                />
              </div>

              <div><Label>Shift Title</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Day 1 Water Extraction" /></div>

              <div className="grid grid-cols-3 gap-3">
                <div><Label>Date</Label><Input type="date" value={form.shiftDate} onChange={e => setForm(f => ({ ...f, shiftDate: e.target.value }))} /></div>
                <div><Label>Start</Label><Input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} /></div>
                <div><Label>End</Label><Input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} /></div>
              </div>

              <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional instructions" /></div>

              {form.jobId && (
                <div className="flex items-center gap-2 p-2 bg-[hsl(var(--titan-blue)/0.1)] rounded-lg text-xs text-[hsl(var(--titan-blue))]">
                  <Bell className="w-4 h-4 shrink-0" />
                  An email notification will be sent to {form.techName || "the tech"} with job details.
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button
                  className="flex-1 bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
                  disabled={saveMutation.isPending || !form.techName}
                  onClick={() => saveMutation.mutate({ ...form, jobId: form.jobId ? Number(form.jobId) : null })}
                  data-testid="button-save-shift"
                >{saveMutation.isPending ? "Saving…" : editingId != null ? "Update Shift" : "Save Shift"}</Button>
                {editingId != null && (
                  <Button
                    variant="outline"
                    className="border-destructive text-destructive hover:bg-destructive/10"
                    disabled={deleteShift.isPending}
                    onClick={() => {
                      if (confirm("Delete this shift? This cannot be undone.")) deleteShift.mutate(editingId);
                    }}
                    data-testid="button-delete-shift"
                  ><Trash2 className="w-4 h-4" /></Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Range navigation + view toggle.
          Prev/Next step by 7 days in week mode and 1 calendar month in
          month mode so the buttons do what a dispatcher expects for each
          layout. The Today button snaps back to "now" in both modes. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => {
          const d = new Date(weekRef);
          if (view === "month") d.setMonth(d.getMonth() - 1);
          else d.setDate(d.getDate() - 7);
          setWeekRef(d);
        }} data-testid="button-cal-prev"><ChevronLeft className="w-4 h-4" /></Button>
        <span className="text-sm font-medium min-w-[180px]">
          {view === "month"
            ? weekRef.toLocaleDateString(undefined, { month: "long", year: "numeric" })
            : `${weekDates[0].toLocaleDateString()} – ${weekDates[6].toLocaleDateString()}`}
        </span>
        <Button variant="outline" size="sm" onClick={() => {
          const d = new Date(weekRef);
          if (view === "month") d.setMonth(d.getMonth() + 1);
          else d.setDate(d.getDate() + 7);
          setWeekRef(d);
        }} data-testid="button-cal-next"><ChevronRight className="w-4 h-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => setWeekRef(new Date())}>Today</Button>

        {/* View toggle. Segmented control style so both options are
            visible at all times (rather than a dropdown that hides the
            alternative). */}
        <div className="ml-auto inline-flex rounded-md border border-border overflow-hidden">
          <button
            type="button"
            className={`px-2.5 py-1 text-xs flex items-center gap-1 ${view === "week" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            onClick={() => setView("week")}
            data-testid="button-view-week"
          ><LayoutGrid className="w-3.5 h-3.5" /> Week</button>
          <button
            type="button"
            className={`px-2.5 py-1 text-xs flex items-center gap-1 border-l border-border ${view === "month" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            onClick={() => setView("month")}
            data-testid="button-view-month"
          ><CalIcon className="w-3.5 h-3.5" /> Month</button>
        </div>
      </div>

      {/* WEEK VIEW — the original planner. Click a day header or empty
         space to add, click a shift to edit / delete. Time-off pills
         remain read-only (owned by the HR module). */}
      {view === "week" && (
      <div className="grid grid-cols-7 gap-1">
        {weekDates.map((date, i) => {
          const dateStr = isoDate(date);
          const dayShifts = shiftsOnDate(dateStr);
          const dayOff = timeOffOnDate(dateStr);
          const today = isoDate(new Date()) === dateStr;
          return (
            <div
              key={i}
              className={`rounded-lg border min-h-[120px] flex flex-col ${today ? "border-[hsl(var(--titan-red))] bg-[hsl(var(--titan-red)/0.03)]" : "border-border"}`}
            >
              <button
                type="button"
                className={`w-full flex items-center justify-between px-2 py-1 text-xs font-semibold border-b hover:bg-muted transition-colors ${today ? "text-[hsl(var(--titan-red))]" : "text-muted-foreground"}`}
                onClick={() => openCreate(dateStr)}
                title="Add shift for this day"
                data-testid={`day-header-${dateStr}`}
              >
                <span>{DAY_LABELS[i]} <span className={`font-bold ${today ? "" : "text-foreground"}`}>{date.getDate()}</span></span>
                <Plus className="w-3 h-3 opacity-50" />
              </button>
              <div
                className="p-1 space-y-1 flex-1 cursor-pointer"
                onClick={(e) => {
                  // Only trigger add-on-empty when the actual container was
                  // clicked (not a child pill). We check the target directly
                  // instead of stopPropagation on children so shift edits still
                  // route to their own handler.
                  if (e.target === e.currentTarget) openCreate(dateStr);
                }}
              >
                {dayOff.map(t => (
                  <div
                    key={`off-${t.id}`}
                    className="text-xs rounded border border-amber-300 bg-amber-50 text-amber-800 px-1.5 py-1 flex items-start gap-1"
                    data-testid={`timeoff-${t.id}`}
                    title={`${t.name} — ${TO_CAT_LABEL[t.category] || "Time Off"} (out)`}
                  >
                    <Plane className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                    <span className="min-w-0">
                      <span className="font-semibold truncate block">{t.name}</span>
                      <span className="opacity-80">Out · {TO_CAT_LABEL[t.category] || "Time Off"}</span>
                    </span>
                  </div>
                ))}
                {/* Job-first grouping. One pill per job shows the job
                    identifier + customer + assignee count. Click opens
                    the day-detail sheet where the full assignee list
                    (and events) live — better flow than cramming names
                    into the calendar cell. */}
                {groupShiftsByJob(dayShifts).map(g => {
                  const first = g.shifts[0];
                  const times = first?.startTime ? `${first.startTime}${first.endTime ? `–${first.endTime}` : ""}` : "";
                  const label = g.job ? jobDisplayLabel(g.job) : (first?.title || "Unassigned");
                  return (
                    <div
                      key={`${g.key}`}
                      className="text-xs rounded border border-border bg-card hover:bg-muted/40 px-1.5 py-1 cursor-pointer transition"
                      onClick={(e) => { e.stopPropagation(); setDayDetail(dateStr); }}
                      data-testid={`job-group-${dateStr}-${g.key}`}
                      title={`${label} — ${g.shifts.length} assigned${times ? ` • ${times}` : ""}`}
                    >
                      <p className="font-semibold truncate flex items-center gap-1">
                        <Briefcase className="w-2.5 h-2.5 shrink-0 opacity-70" />
                        <span className="truncate">{label}</span>
                      </p>
                      {first?.title && !g.job && <p className="truncate opacity-80">{first.title}</p>}
                      <p className="opacity-70 tabular-nums flex items-center gap-1 justify-between">
                        <span>{times || "—"}</span>
                        <span className="text-[10px]">{g.shifts.length} assigned</span>
                      </p>
                    </div>
                  );
                })}
                {eventsOnDate(dateStr).map(ev => (
                  <div
                    key={`ev-${ev.id}`}
                    className="text-xs rounded border border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 text-blue-900 dark:text-blue-200 px-1.5 py-1 cursor-pointer hover:brightness-95"
                    onClick={(e) => { e.stopPropagation(); openEditEvent(ev); }}
                    data-testid={`event-${ev.id}`}
                    title={`${ev.title}${ev.location ? ` @ ${ev.location}` : ""}${ev.attendees.length ? ` • ${ev.attendees.join(", ")}` : ""}`}
                  >
                    <p className="font-semibold truncate flex items-center gap-1">
                      <CalIcon className="w-2.5 h-2.5 shrink-0" />
                      <span className="truncate">{ev.title}</span>
                    </p>
                    {(ev.startTime || ev.endTime) && (
                      <p className="opacity-80 tabular-nums">{ev.startTime || ""}{ev.endTime ? `–${ev.endTime}` : ""}</p>
                    )}
                    {ev.attendees.length > 0 && (
                      <p className="opacity-80 truncate text-[10px]">{ev.attendees.slice(0, 2).join(", ")}{ev.attendees.length > 2 ? ` +${ev.attendees.length - 2}` : ""}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* MONTH VIEW — 6-row grid. Each cell is compact: date number, up
         to 3 shift pills (by assignee color), a "+N more" chip, and a
         time-off dot when anyone is out. Tap a cell to open the day
         detail sheet with the full task-list of that day’s work. */}
      {view === "month" && (
        <div className="rounded-lg border border-border overflow-hidden">
          {/* Weekday header row */}
          <div className="grid grid-cols-7 bg-muted/50 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {DAY_LABELS.map(d => (
              <div key={d} className="px-2 py-1.5 text-center">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthGrid.map((date, i) => {
              const dateStr = isoDate(date);
              const inMonth = date.getMonth() === weekRef.getMonth();
              const today = isoDate(new Date()) === dateStr;
              const dayShifts = shiftsOnDate(dateStr);
              const dayOff = timeOffOnDate(dateStr);
              const dayEvents = eventsOnDate(dateStr);
              const groups = groupShiftsByJob(dayShifts);
              // Render up to 3 items in the cell (jobs first, then
              // events). Anything beyond becomes a "+N more" chip.
              type Item = { kind: "job"; label: string; count: number; time: string }
                        | { kind: "event"; label: string; time: string };
              const items: Item[] = [
                ...groups.map<Item>(g => ({
                  kind: "job",
                  label: g.job ? g.job.jobNumber : (g.shifts[0]?.title || "Unassigned"),
                  count: g.shifts.length,
                  time: g.shifts[0]?.startTime || "",
                })),
                ...dayEvents.map<Item>(ev => ({
                  kind: "event",
                  label: ev.title,
                  time: ev.startTime || "",
                })),
              ];
              const shown = items.slice(0, 3);
              const more = Math.max(0, items.length - shown.length);
              return (
                <button
                  type="button"
                  key={i}
                  onClick={() => setDayDetail(dateStr)}
                  className={`text-left border-t border-l border-border first:border-l-0 min-h-[92px] p-1.5 flex flex-col gap-1 hover:bg-muted/40 transition-colors ${!inMonth ? "bg-muted/20 text-muted-foreground" : ""} ${today ? "bg-[hsl(var(--titan-red)/0.05)]" : ""} ${(i % 7 === 0) ? "border-l-0" : ""}`}
                  data-testid={`month-day-${dateStr}`}
                  title={`${date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })} — ${dayShifts.length} shift${dayShifts.length === 1 ? "" : "s"}${dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}` : ""}${dayOff.length ? `, ${dayOff.length} out` : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold ${today ? "text-[hsl(var(--titan-red))]" : ""}`}>{date.getDate()}</span>
                    {dayOff.length > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 dark:text-amber-500" title={`${dayOff.length} out`}>
                        <Plane className="w-2.5 h-2.5" />{dayOff.length}
                      </span>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {shown.map((it, idx) => it.kind === "job" ? (
                      <div
                        key={`j-${idx}`}
                        className="truncate text-[10px] leading-tight px-1 py-0.5 rounded border border-border bg-card flex items-center gap-1"
                      >
                        <Briefcase className="w-2.5 h-2.5 shrink-0 opacity-60" />
                        <span className="truncate font-medium">{it.label}</span>
                        <span className="opacity-60 ml-auto">×{it.count}</span>
                      </div>
                    ) : (
                      <div
                        key={`e-${idx}`}
                        className="truncate text-[10px] leading-tight px-1 py-0.5 rounded border border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 text-blue-900 dark:text-blue-200 flex items-center gap-1"
                      >
                        <CalIcon className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{it.label}</span>
                      </div>
                    ))}
                    {more > 0 && (
                      <div className="text-[10px] text-muted-foreground px-1">+{more} more</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* DAY DETAIL sheet — opens for any clicked day. Renders every
         shift + time-off entry for that date as a task-list, with
         click-to-edit on shifts and an Add Shift shortcut. Kept as a
         Dialog so it works on mobile as a full-screen sheet. */}
      <Dialog open={dayDetail != null} onOpenChange={(o) => { if (!o) setDayDetail(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {dayDetail && (() => {
            const parts = dayDetail.split("-");
            const dObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            const dayShifts = shiftsOnDate(dayDetail);
            const dayOff = timeOffOnDate(dayDetail);
            const dayEvents = eventsOnDate(dayDetail);
            const groups = groupShiftsByJob(dayShifts);
            return (
              <>
                <DialogHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <DialogTitle className="flex items-center gap-2">
                        <ListChecks className="w-4 h-4" />
                        <span className="truncate">{dObj.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
                      </DialogTitle>
                      <p className="text-xs text-muted-foreground mt-1">
                        {groups.length} job{groups.length === 1 ? "" : "s"} • {dayShifts.length} assigned
                        {dayEvents.length > 0 && ` • ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}`}
                        {dayOff.length > 0 && ` • ${dayOff.length} out`}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => { setDayDetail(null); openCreateEvent(dayDetail); }} data-testid="button-day-add-event">
                        <CalIcon className="w-4 h-4 mr-1" />Event
                      </Button>
                      <Button size="sm" onClick={() => { setDayDetail(null); openCreate(dayDetail); }} data-testid="button-day-add-shift">
                        <Plus className="w-4 h-4 mr-1" />Shift
                      </Button>
                    </div>
                  </div>
                </DialogHeader>

                <div className="space-y-4 pt-1">
                  {dayOff.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Out today</p>
                      <div className="space-y-1">
                        {dayOff.map(t => (
                          <div key={`off-${t.id}`} className="text-xs rounded border border-amber-300 bg-amber-50 text-amber-800 px-2 py-1.5 flex items-center gap-2" data-testid={`day-off-${t.id}`}>
                            <Plane className="w-3 h-3 shrink-0" />
                            <span className="font-semibold">{t.name}</span>
                            <span className="opacity-80">— {TO_CAT_LABEL[t.category] || "Time Off"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Jobs on this day</p>
                    {groups.length === 0 ? (
                      <div className="text-xs text-muted-foreground rounded border border-dashed border-border px-3 py-4 text-center">
                        No jobs scheduled. Click <span className="font-semibold">Shift</span> to assign someone to a job, or <span className="font-semibold">Event</span> for a meeting.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {groups.map(g => <DayJobCard key={`${g.key}`} group={g} onOpenEdit={(s) => { setDayDetail(null); openEdit(s); }} />)}
                      </div>
                    )}
                  </div>

                  {dayEvents.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Events</p>
                      <div className="space-y-1">
                        {dayEvents
                          .slice()
                          .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""))
                          .map(ev => (
                          <button
                            key={`ev-${ev.id}`}
                            type="button"
                            onClick={() => { setDayDetail(null); openEditEvent(ev); }}
                            className="w-full text-left rounded border border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 text-blue-900 dark:text-blue-200 px-2.5 py-2 hover:brightness-95"
                            data-testid={`day-event-${ev.id}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-semibold truncate flex items-center gap-1"><CalIcon className="w-3 h-3 shrink-0" />{ev.title}</p>
                              <p className="text-[11px] opacity-80 tabular-nums shrink-0">{ev.startTime || "--:--"}{ev.endTime ? `–${ev.endTime}` : ""}</p>
                            </div>
                            {ev.location && <p className="text-[11px] opacity-80 truncate">📍 {ev.location}</p>}
                            {ev.attendees.length > 0 && (
                              <p className="text-[11px] opacity-90 truncate mt-0.5">With: {ev.attendees.join(", ")}</p>
                            )}
                            {ev.notes && <p className="text-[11px] opacity-70 truncate mt-0.5">{ev.notes}</p>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Standalone calendar-event dialog. Not tied to a job — title,
         date/time, optional location, and a chip-style attendee picker
         that accepts free text so anyone can be tagged. */}
      <Dialog open={eventOpen} onOpenChange={(v) => { setEventOpen(v); if (!v) setEventEditingId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{eventEditingId != null ? "Edit event" : "New event"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title</Label>
              <Input
                value={eventForm.title}
                onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
                placeholder="e.g. Team meeting, Insurance call, Training"
                data-testid="input-event-title"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-3">
                <Label>Date</Label>
                <Input type="date" value={eventForm.eventDate} onChange={(e) => setEventForm({ ...eventForm, eventDate: e.target.value })} data-testid="input-event-date" />
              </div>
              <div className="col-span-1">
                <Label className="text-xs">Start</Label>
                <Input type="time" value={eventForm.startTime} onChange={(e) => setEventForm({ ...eventForm, startTime: e.target.value })} data-testid="input-event-start" />
              </div>
              <div className="col-span-1">
                <Label className="text-xs">End</Label>
                <Input type="time" value={eventForm.endTime} onChange={(e) => setEventForm({ ...eventForm, endTime: e.target.value })} data-testid="input-event-end" />
              </div>
            </div>
            <div>
              <Label>Location <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
              <Input
                value={eventForm.location}
                onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
                placeholder="Office, address, video link, etc."
                data-testid="input-event-location"
              />
            </div>
            <div>
              <Label>Attendees <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
              <AttendeePicker
                value={eventForm.attendees}
                onChange={(v) => setEventForm({ ...eventForm, attendees: v })}
                suggestions={assignableUsers.map(u => u.name)}
              />
              {eventForm.attendees.length > 0 && (
                <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                  <Bell className="w-3 h-3" />
                  Tagged team members will get an email when you save.
                </p>
              )}
            </div>
            <div>
              <Label>Notes <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
              <Input
                value={eventForm.notes}
                onChange={(e) => setEventForm({ ...eventForm, notes: e.target.value })}
                placeholder="Anything else the team should know"
                data-testid="input-event-notes"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              {eventEditingId != null && (
                <Button
                  variant="outline"
                  className="border-destructive text-destructive hover:bg-destructive/10"
                  disabled={deleteEvent.isPending}
                  onClick={() => { if (confirm("Delete this event?")) deleteEvent.mutate(eventEditingId); }}
                  data-testid="button-delete-event"
                ><Trash2 className="w-4 h-4" /></Button>
              )}
              <Button variant="outline" onClick={() => { setEventOpen(false); setEventEditingId(null); }}>Cancel</Button>
              <Button
                onClick={() => saveEvent.mutate({
                  title: eventForm.title,
                  eventDate: eventForm.eventDate,
                  startTime: eventForm.startTime || null,
                  endTime: eventForm.endTime || null,
                  location: eventForm.location || null,
                  notes: eventForm.notes || null,
                  attendees: eventForm.attendees,
                })}
                disabled={saveEvent.isPending || !eventForm.title.trim() || !eventForm.eventDate}
                data-testid="button-save-event"
              >{saveEvent.isPending ? "Saving…" : eventEditingId != null ? "Update event" : "Save event"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── DayJobCard ────────────────────────────────────────────────────────
// Job-first card for the day-detail sheet. Shows the job identifier +
// customer at the top; a click reveals every assigned tech / shift so
// each shift row remains editable. "Job-first" flow the user asked for.
function DayJobCard({ group, onOpenEdit }: {
  group: { key: number | "none"; job: Job | null; shifts: Shift[] };
  onOpenEdit: (s: Shift) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const first = group.shifts[0];
  const label = group.job
    ? (() => {
        const who = (group.job as any).customerName || (group.job as any).customer || "";
        const addr = group.job.address ? String(group.job.address).split(",")[0] : "";
        const tail = who || addr || group.job.lossType || "";
        return tail ? `${group.job.jobNumber} — ${tail}` : group.job.jobNumber;
      })()
    : (first?.title || "Unassigned");
  const times = first?.startTime ? `${first.startTime}${first.endTime ? `–${first.endTime}` : ""}` : "";
  const uniqueTechs = Array.from(new Set(group.shifts.map(s => s.techName)));

  return (
    <div className="rounded border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-2.5 py-2 hover:bg-muted/40 transition"
        data-testid={`day-job-${group.key}`}
        aria-expanded={expanded}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate flex items-center gap-1">
              <Briefcase className="w-3.5 h-3.5 shrink-0 opacity-70" />
              <span className="truncate">{label}</span>
            </p>
            {group.job && (group.job as any).lossType && (
              <p className="text-[11px] text-muted-foreground truncate mt-0.5 capitalize">{(group.job as any).lossType}</p>
            )}
            {group.job && group.job.address && (
              <p className="text-[11px] text-muted-foreground truncate">{group.job.address}</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {group.shifts.length} assigned{times ? ` • ${times}` : ""}
            </p>
          </div>
          <div className="shrink-0 text-[11px] text-muted-foreground">
            {expanded ? "Hide" : "View"}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border bg-muted/20 divide-y divide-border">
          {group.shifts.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => onOpenEdit(s)}
              className={`w-full text-left px-2.5 py-2 hover:brightness-95 transition ${colorForName(s.techName)}`}
              data-testid={`day-shift-${s.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold truncate">{s.techName}</p>
                <p className="text-[11px] opacity-80 tabular-nums shrink-0">
                  {s.startTime || "--:--"}{s.endTime ? `–${s.endTime}` : ""}
                </p>
              </div>
              {s.title && <p className="text-xs opacity-80 truncate">{s.title}</p>}
              {(s as any).notes && <p className="text-[11px] opacity-80 truncate mt-0.5">{(s as any).notes}</p>}
            </button>
          ))}
          {!expanded && uniqueTechs.length > 0 && (
            <div className="px-2.5 py-1.5 text-[11px] text-muted-foreground">{uniqueTechs.join(", ")}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── AttendeePicker ───────────────────────────────────────────────────
// Chip-style attendee input. Accepts free text (Enter / comma commits)
// and offers suggestions from the assignable-users list so the common
// case is a one-click tag. Anyone can be tagged — no back-end record
// required — which matches the user's ask for events not tied to a job.
function AttendeePicker({ value, onChange, suggestions }: {
  value: string[]; onChange: (v: string[]) => void; suggestions: string[];
}) {
  const [draft, setDraft] = useState("");
  const remainingSuggestions = suggestions.filter(s => !value.includes(s) && (!draft || s.toLowerCase().includes(draft.toLowerCase())));

  function add(name: string) {
    const n = name.trim();
    if (!n) return;
    if (value.includes(n)) return;
    onChange([...value, n]);
    setDraft("");
  }
  function remove(name: string) {
    onChange(value.filter(v => v !== name));
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-1.5 min-h-[24px]">
        {value.map(name => (
          <span key={name} className="inline-flex items-center gap-1 text-xs rounded-full border border-border bg-muted px-2 py-0.5" data-testid={`attendee-${name}`}>
            {name}
            <button type="button" onClick={() => remove(name)} className="opacity-60 hover:opacity-100" aria-label={`Remove ${name}`}>
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === ",") && draft.trim()) {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length > 0) {
            // Quick removal of the last chip when the input is empty.
            onChange(value.slice(0, -1));
          }
        }}
        placeholder="Type a name and press Enter"
        data-testid="input-event-attendees"
      />
      {remainingSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {remainingSuggestions.slice(0, 8).map(name => (
            <button
              key={name}
              type="button"
              onClick={() => add(name)}
              className="text-[11px] rounded-full border border-dashed border-border px-2 py-0.5 text-muted-foreground hover:bg-muted"
              data-testid={`suggest-attendee-${name}`}
            >+ {name}</button>
          ))}
        </div>
      )}
    </div>
  );
}
