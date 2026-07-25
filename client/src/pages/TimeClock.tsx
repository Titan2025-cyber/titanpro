import { useState } from "react";
import { UserSelect } from "@/components/UserSelect";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Clock, MapPin, LogIn, LogOut, Users, Timer, Briefcase } from "lucide-react";


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
    .filter((e: any) => e.clock_in_at?.startsWith(new Date().toISOString().slice(0, 10)))
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
              <Select value={selectedJob} onValueChange={setSelectedJob}>
                <SelectTrigger data-testid="select-job"><SelectValue placeholder="Select job..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No specific job</SelectItem>
                  {jobs.map((j: any) => <SelectItem key={j.id} value={String(j.id)}>TP-{String(j.id).padStart(4, "0")} — {j.address?.substring(0, 22) || "N/A"}</SelectItem>)}
                </SelectContent>
              </Select>
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
                      <p className="text-xs text-muted-foreground">{new Date(e.clock_in_at).toLocaleString()}{e.clock_out_at ? ` → ${new Date(e.clock_out_at).toLocaleTimeString()}` : ""}</p>
                    </div>
                    <div className="text-right shrink-0">
                      {e.duration_minutes != null && <p className="font-semibold">{(e.duration_minutes / 60).toFixed(1)}h</p>}
                      {e.clock_in_lat && <p className="text-xs text-muted-foreground flex items-center gap-0.5 justify-end"><MapPin className="w-2.5 h-2.5" />GPS</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
