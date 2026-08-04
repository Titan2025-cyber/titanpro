import { useQuery, useMutation } from "@tanstack/react-query";
import { UserSelect } from "@/components/UserSelect";
import { useState } from "react";
import { Plus, ChevronLeft, ChevronRight, Briefcase, Bell, Plane, Trash2 } from "lucide-react";
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

function isoDate(d: Date) {
  return d.toISOString().split("T")[0];
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
  const weekStart = isoDate(weekDates0[0]);
  const weekEnd = isoDate(weekDates0[6]);

  const { data: shifts = [] } = useQuery<Shift[]>({ queryKey: ["/api/shifts"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  // Approved time-off overlapping the visible week (read-only, from HR module).
  const { data: timeOff = [] } = useQuery<TimeOff[]>({
    queryKey: ["/api/hr/timeoff/calendar", weekStart, weekEnd],
    queryFn: () => apiRequest("GET", `/api/hr/timeoff/calendar?start=${weekStart}&end=${weekEnd}`).then(r => r.json()),
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

  const weekDates = weekDates0;
  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const shiftsOnDate = (dateStr: string) => shifts.filter(s => s.shiftDate === dateStr);
  // Time-off entries covering a given day (inclusive of start & end).
  const timeOffOnDate = (dateStr: string) => timeOff.filter(t => t.startDate <= dateStr && t.endDate >= dateStr);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Scheduling</h1>
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
                <Select value={form.jobId} onValueChange={v => {
                  const job = jobs.find(j => j.id === Number(v));
                  setForm(f => ({ ...f, jobId: v, title: job ? `${job.jobNumber} — ${job.lossType}` : f.title }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Link to a job" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No job</SelectItem>
                    {jobs.filter(j => j.status !== "closed").map(j => (
                      <SelectItem key={j.id} value={String(j.id)}>
                        {j.jobNumber} — {j.address?.split(",")[0] || j.lossType}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

      {/* Week navigation */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => { const d = new Date(weekRef); d.setDate(d.getDate()-7); setWeekRef(d); }}><ChevronLeft className="w-4 h-4" /></Button>
        <span className="text-sm font-medium">{weekDates[0].toLocaleDateString()} – {weekDates[6].toLocaleDateString()}</span>
        <Button variant="outline" size="sm" onClick={() => { const d = new Date(weekRef); d.setDate(d.getDate()+7); setWeekRef(d); }}><ChevronRight className="w-4 h-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => setWeekRef(new Date())}>Today</Button>
      </div>

      {/* Calendar grid — click a day header or empty space to add, click a
         shift to edit / delete. Time-off pills remain read-only (HR module). */}
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
                {dayShifts.map(s => {
                  const job = jobs.find(j => j.id === s.jobId);
                  const colorClass = colorForName(s.techName);
                  return (
                    <div
                      key={s.id}
                      className={`text-xs rounded border px-1.5 py-1 ${colorClass} cursor-pointer hover:brightness-95 transition`}
                      data-testid={`shift-${s.id}`}
                      onClick={() => openEdit(s)}
                      title="Click to edit shift"
                    >
                      <p className="font-semibold truncate">{s.techName}</p>
                      {s.title && <p className="truncate opacity-80">{s.title}</p>}
                      {s.startTime && <p className="opacity-70">{s.startTime}{s.endTime ? `–${s.endTime}` : ""}</p>}
                      {job && (
                        <span className="flex items-center gap-0.5 mt-0.5">
                          <Briefcase className="w-2.5 h-2.5" />
                          <span className="truncate font-medium">{job.jobNumber}</span>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Team legend — active system users */}
      <div className="flex gap-2 flex-wrap items-center">
        {assignableUsers.map(u => (
          <div key={u.id} className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${colorForName(u.name)}`}>
            <div className="w-2 h-2 rounded-full bg-current opacity-70" />{u.name}
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-amber-300 bg-amber-50 text-amber-800">
          <Plane className="w-3 h-3" /> Out (approved time-off)
        </div>
      </div>
    </div>
  );
}
