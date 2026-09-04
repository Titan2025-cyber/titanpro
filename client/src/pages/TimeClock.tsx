import { useState } from "react";
import { UserSelect } from "@/components/UserSelect";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import JobCombobox from "@/components/JobCombobox";
import { useToast } from "@/hooks/use-toast";
import { Clock, MapPin, LogIn, LogOut, Users, Timer, Briefcase, Pencil, Trash2 } from "lucide-react";
import { fmtDateShort, todayLocalISO } from "@/lib/dates";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";


export default function TimeClock() {
  const { toast } = useToast();
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [selectedJob, setSelectedJob] = useState("");
  const [geoError, setGeoError] = useState("");
  const [clockingIn, setClockingIn] = useState(false);

  const { data: entries = [], refetch } = useQuery<any[]>({
    queryKey: ["/api/time-clock"],
    queryFn: () => apiRequest("/api/time-clock").then(r => r.json()),
  });

  const { data: openEntries = [] } = useQuery<any[]>({
    queryKey: ["/api/time-clock/open"],
    queryFn: () => apiRequest("/api/time-clock/open").then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: jobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then(r => r.json()),
  });

  // Feeds the JobCombobox so techs can also match a job by the customer's
  // name, not just the address / job number.
  const { data: contacts = [] } = useQuery<any[]>({
    queryKey: ["/api/contacts"],
    queryFn: () => apiRequest("/api/contacts").then(r => r.json()),
  });

  const { data: laborReport = [] } = useQuery<any[]>({
    queryKey: ["/api/reports/labor-by-job"],
    queryFn: () => apiRequest("/api/reports/labor-by-job").then(r => r.json()),
  });

  const clockInMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/time-clock/clock-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/time-clock"] }); queryClient.invalidateQueries({ queryKey: ["/api/time-clock/open"] }); toast({ title: `${selectedEmployee} clocked in` }); setClockingIn(false); },
    onError: () => { toast({ title: "Clock-in failed", variant: "destructive" }); setClockingIn(false); },
  });

  const clockOutMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/time-clock/clock-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ["/api/time-clock"] }); queryClient.invalidateQueries({ queryKey: ["/api/time-clock/open"] }); toast({ title: `Clocked out — ${data.duration_minutes} min logged` }); },
  });

  // ── Manual edit / delete of a time entry ─────────────────────────────
  //
  // Techs need this when GPS missed a punch, they forgot to clock out
  // at end of day, or they clocked into the wrong job. The dialog
  // shows local datetime inputs so field guys don't have to think in
  // UTC — we convert to ISO before submitting.
  const [editing, setEditing] = useState<any | null>(null);
  const [editIn, setEditIn] = useState<string>("");
  const [editOut, setEditOut] = useState<string>("");
  const [editReason, setEditReason] = useState<string>("");

  // Convert an ISO string to the value shape a <input type="datetime-local">
  // expects (YYYY-MM-DDTHH:mm in the browser's local timezone).
  const toLocalInput = (iso?: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openEdit = (row: any) => {
    setEditing(row);
    setEditIn(toLocalInput(row.clock_in_at));
    setEditOut(toLocalInput(row.clock_out_at));
    setEditReason("");
  };

  const editMutation = useMutation({
    mutationFn: (payload: { id: number; body: any }) =>
      apiRequest(`/api/time-clock/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload.body),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Update failed");
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/labor-by-job"] });
      toast({ title: "Time entry updated" });
      setEditing(null);
    },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message || "", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/api/time-clock/${id}`, { method: "DELETE" }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "Delete failed");
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/time-clock/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reports/labor-by-job"] });
      toast({ title: "Time entry deleted" });
      setEditing(null);
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e?.message || "", variant: "destructive" }),
  });

  const submitEdit = () => {
    if (!editing) return;
    if (!editIn) { toast({ title: "Clock-in is required", variant: "destructive" }); return; }
    // datetime-local values are wall-clock in the browser's TZ. new Date()
    // interprets them that way — exactly what we want — so we can just
    // hand it .toISOString() for the server.
    const inIso  = new Date(editIn).toISOString();
    const outIso = editOut ? new Date(editOut).toISOString() : null;
    editMutation.mutate({
      id: editing.id,
      body: { clockInAt: inIso, clockOutAt: outIso, editReason: editReason.trim() || null },
    });
  };

  function handleClockIn() {
    if (!selectedEmployee) { toast({ title: "Select an employee first", variant: "destructive" }); return; }
    setClockingIn(true);
    setGeoError("");
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clockInMutation.mutate({ employeeName: selectedEmployee, jobId: selectedJob ? parseInt(selectedJob) : null, lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          // Clock in without GPS if denied
          clockInMutation.mutate({ employeeName: selectedEmployee, jobId: selectedJob ? parseInt(selectedJob) : null });
          setGeoError("GPS unavailable — clocked in without location");
        }
      );
    } else {
      clockInMutation.mutate({ employeeName: selectedEmployee, jobId: selectedJob ? parseInt(selectedJob) : null });
    }
  }

  function handleClockOut(employeeName: string) {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => clockOutMutation.mutate({ employeeName, lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => clockOutMutation.mutate({ employeeName })
      );
    } else {
      clockOutMutation.mutate({ employeeName });
    }
  }

  const totalMinutesToday = entries
    .filter((e: any) => e.clock_in_at?.startsWith(todayLocalISO()))
    .reduce((s: number, e: any) => s + (e.duration_minutes || 0), 0);

  const recentEntries = entries.slice(0, 30);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" /> GPS Time Clock
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Track tech clock-in/out with GPS verification — feeds directly into job cost labor data</p>
      </div>

      {/* Clock In/Out Panel */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><LogIn className="w-4 h-4 text-green-500" />Clock In</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Employee</Label>
              <UserSelect
                value={selectedEmployee}
                onChange={setSelectedEmployee}
                placeholder="Select employee..."
                testId="select-employee"
              />
            </div>
            <div>
              <Label>Job (optional)</Label>
              <JobCombobox
                jobs={jobs}
                contacts={contacts}
                value={selectedJob}
                onChange={setSelectedJob}
                placeholder="Search jobs by number, address, customer…"
                data-testid="select-job"
              />
            </div>
            {geoError && <p className="text-xs text-yellow-600">{geoError}</p>}
            <Button className="w-full" onClick={handleClockIn} disabled={!selectedEmployee || clockingIn || clockInMutation.isPending} data-testid="button-clock-in">
              <LogIn className="w-4 h-4 mr-2" />{clockingIn ? "Getting GPS..." : "Clock In"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><LogOut className="w-4 h-4 text-red-500" />Active Sessions</CardTitle></CardHeader>
          <CardContent>
            {openEntries.length === 0 ? (
              <p className="text-center py-6 text-muted-foreground text-sm">No active clock-ins</p>
            ) : (
              <div className="space-y-2">
                {openEntries.map((e: any) => {
                  const job = jobs.find((j: any) => j.id === e.job_id);
                  const minutesElapsed = Math.floor((Date.now() - new Date(e.clock_in_at).getTime()) / 60000);
                  return (
                    <div key={e.id} className="flex items-center justify-between p-2 rounded border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20" data-testid={`active-session-${e.id}`}>
                      <div>
                        <p className="text-sm font-semibold">{e.employee_name}</p>
                        <p className="text-xs text-muted-foreground">{job ? `TP-${String(job.id).padStart(4, "0")}` : "General"} · {minutesElapsed}m elapsed</p>
                        {(e.clock_in_lat) && <p className="text-xs text-muted-foreground flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{e.clock_in_lat.toFixed(4)}, {e.clock_in_lng.toFixed(4)}</p>}
                      </div>
                      <Button size="sm" variant="destructive" onClick={() => handleClockOut(e.employee_name)} data-testid={`button-clock-out-${e.id}`}>
                        <LogOut className="w-3 h-3 mr-1" />Out
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-4 flex items-center gap-3"><Timer className="w-8 h-8 text-blue-500" /><div><p className="text-xs text-muted-foreground">Today's Total Hours</p><p className="text-lg font-bold">{(totalMinutesToday / 60).toFixed(1)}h</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><Users className="w-8 h-8 text-green-500" /><div><p className="text-xs text-muted-foreground">Currently Clocked In</p><p className="text-lg font-bold">{openEntries.length}</p></div></CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3"><Briefcase className="w-8 h-8 text-primary" /><div><p className="text-xs text-muted-foreground">Jobs with Labor</p><p className="text-lg font-bold">{laborReport.length}</p></div></CardContent></Card>
      </div>

      {/* Recent Entries */}
      <Card>
        <CardHeader><CardTitle className="text-base">Recent Time Entries</CardTitle></CardHeader>
        <CardContent>
          {recentEntries.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No time entries yet.</p>
          ) : (
            <div className="space-y-2">
              {recentEntries.map((e: any) => {
                const job = jobs.find((j: any) => j.id === e.job_id);
                return (
                  <div key={e.id} className="flex items-center gap-3 p-2 rounded border border-border text-sm" data-testid={`time-entry-${e.id}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{e.employee_name}</span>
                        {job && <Badge variant="outline" className="text-xs">TP-{String(job.id).padStart(4, "0")}</Badge>}
                        {!e.clock_out_at && <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">Active</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{fmtDateShort(e.clock_in_at)}{e.clock_out_at ? ` → ${new Date(e.clock_out_at).toLocaleTimeString()}` : ""}</p>
                    </div>
                    <div className="text-right shrink-0 flex items-center gap-2">
                      <div>
                        {e.duration_minutes != null && <p className="font-semibold">{(e.duration_minutes / 60).toFixed(1)}h</p>}
                        {e.clock_in_lat && <p className="text-xs text-muted-foreground flex items-center gap-0.5 justify-end"><MapPin className="w-2.5 h-2.5" />GPS</p>}
                        {e.edited_at && (
                          <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5" title={`Edited by ${e.edited_by || "unknown"}${e.edit_reason ? ` — ${e.edit_reason}` : ""}`}>edited</p>
                        )}
                      </div>
                      {/* Manual edit button. Works for open (still-active)
                          entries too so a tech can back-date their clock-in
                          if they realize the app didn't punch them in when
                          they arrived on-site. */}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => openEdit(e)}
                        title="Edit time entry"
                        aria-label="Edit time entry"
                        data-testid={`button-edit-time-entry-${e.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual edit dialog. Opened by the pencil on any row. Server-side
          auth restricts non-managers to editing their own entries. */}
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit time entry</DialogTitle>
            <DialogDescription>
              {editing?.employee_name} — adjust the clock-in / clock-out times. Enter times in your local timezone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label className="text-xs">Clock in</Label>
              <Input
                type="datetime-local"
                value={editIn}
                onChange={(e) => setEditIn(e.target.value)}
                data-testid="input-edit-clock-in"
              />
            </div>
            <div>
              <Label className="text-xs">
                Clock out <span className="text-muted-foreground font-normal">(leave blank to keep the entry open)</span>
              </Label>
              <Input
                type="datetime-local"
                value={editOut}
                onChange={(e) => setEditOut(e.target.value)}
                data-testid="input-edit-clock-out"
              />
            </div>
            <div>
              <Label className="text-xs">Reason for edit <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                placeholder="e.g. GPS missed clock-in, forgot to clock out"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                data-testid="input-edit-reason"
              />
            </div>
            {editIn && editOut && new Date(editOut).getTime() > new Date(editIn).getTime() && (
              <p className="text-xs text-muted-foreground">
                Duration: <span className="font-semibold tabular-nums">{((new Date(editOut).getTime() - new Date(editIn).getTime()) / 3600000).toFixed(2)}h</span>
              </p>
            )}
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:justify-between">
            <Button
              variant="destructive"
              onClick={() => {
                if (editing && confirm("Delete this time entry? This cannot be undone.")) {
                  deleteMutation.mutate(editing.id);
                }
              }}
              disabled={deleteMutation.isPending}
              data-testid="button-delete-time-entry"
            >
              <Trash2 className="w-4 h-4 mr-1.5" />Delete
            </Button>
            <div className="flex gap-2 sm:justify-end">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button
                onClick={submitEdit}
                disabled={editMutation.isPending}
                data-testid="button-save-time-entry"
              >
                Save changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
