import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Grid3X3, User, CheckCircle, XCircle, Clock, AlertTriangle, Plane } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { todayLocalISO } from "@/lib/dates";

const HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // 7am - 7pm
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  available: { bg: "bg-green-500", text: "text-white", label: "Available" },
  on_job: { bg: "bg-blue-500", text: "text-white", label: "On Job" },
  unavailable: { bg: "bg-red-500", text: "text-white", label: "Unavailable" },
  pto: { bg: "bg-purple-400", text: "text-white", label: "PTO" },
  training: { bg: "bg-yellow-400", text: "text-gray-900", label: "Training" },
  // Read-only overlay from approved HR time-off (not manually assignable).
  off: { bg: "bg-amber-400", text: "text-gray-900", label: "Out" },
};

// Manually assignable statuses (excludes the read-only "off" overlay).
const STATUSES = Object.entries(STATUS_COLORS)
  .filter(([value]) => value !== "off")
  .map(([value, { label }]) => ({ value, label }));

// Approved time-off entry from the HR module, surfaced read-only for dispatch.
type TimeOff = { id: number; employeeId: number; name: string; category: string; startDate: string; endDate: string; hours: number };
const TO_CAT_LABEL: Record<string, string> = {
  pto: "PTO", sick: "Sick", unpaid: "Unpaid", bereavement: "Bereavement",
  jury_duty: "Jury Duty", holiday: "Holiday", other: "Time Off",
};

export default function DispatchMatrix() {
  const { toast } = useToast();
  const [selectedWeek, setSelectedWeek] = useState(() => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(now.setDate(diff));
    return mon.toISOString().slice(0, 10);
  });
  const [editCell, setEditCell] = useState<{ empId: number; day: string; hour: number } | null>(null);
  const [cellStatus, setCellStatus] = useState("available");

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["/api/employees"],
    queryFn: () => apiRequest("/api/employees").then(r => r.json()),
  });

  const { data: shifts = [] } = useQuery({
    queryKey: ["/api/shifts"],
    queryFn: () => apiRequest("/api/shifts").then(r => r.json()),
  });

  const { data: jobs = [] } = useQuery({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then(r => r.json()),
  });

  // Visible week range: Monday (selectedWeek) through Sunday (+6 days).
  const weekEndDate = (() => {
    const d = new Date(selectedWeek);
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  })();

  // Approved time-off overlapping the visible week (read-only, from HR module).
  const { data: timeOff = [] } = useQuery<TimeOff[]>({
    queryKey: ["/api/hr/timeoff/calendar", selectedWeek, weekEndDate],
    queryFn: () => apiRequest(`/api/hr/timeoff/calendar?start=${selectedWeek}&end=${weekEndDate}`).then(r => r.json()),
  });

  // Look up approved time-off for an employee (by name) covering a given day.
  const timeOffFor = (empName: string, date: string): TimeOff | undefined => {
    const n = (empName || "").trim().toLowerCase();
    if (!n) return undefined;
    return timeOff.find(t => t.name.trim().toLowerCase() === n && t.startDate <= date && t.endDate >= date);
  };

  const createShiftMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/shifts", { method: "POST", body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shifts"] });
      setEditCell(null);
      toast({ title: "Availability updated" });
    },
  });

  const weekDates = DAYS.map((day, i) => {
    const d = new Date(selectedWeek);
    d.setDate(d.getDate() + i);
    return { label: day, date: d.toISOString().slice(0, 10), display: `${day} ${d.getMonth() + 1}/${d.getDate()}` };
  });

  // Get status for an employee on a given day
  const getStatus = (empId: number, date: string) => {
    const emp = employees.find((e: any) => e.id === empId);

    // Approved HR time-off takes precedence over everything else.
    if (emp && timeOffFor(emp.name, date)) return "off";

    // Check shifts table for that day/emp
    const dayShifts = shifts.filter((s: any) => {
      const shiftDate = (s.start_time || "").slice(0, 10);
      return shiftDate === date && s.employee_id === empId;
    });
    if (dayShifts.length > 0) return dayShifts[0].status || "on_job";

    // Check active jobs for assigned tech
    if (!emp) return "available";
    const hasJob = jobs.some((j: any) =>
      j.assigned_tech === emp.name &&
      !["complete", "closed"].includes(j.status)
    );
    return hasJob ? "on_job" : "available";
  };

  const handleCellClick = (empId: number, date: string) => {
    const current = getStatus(empId, date);
    // "off" is a read-only overlay driven by approved HR time-off — not editable here.
    if (current === "off") {
      const emp = employees.find((e: any) => e.id === empId);
      const t = emp ? timeOffFor(emp.name, date) : undefined;
      toast({
        title: "Approved time-off",
        description: `${emp?.name || "This tech"} is out (${t ? TO_CAT_LABEL[t.category] || "Time Off" : "Time Off"}). Manage it in HR → PTO & Time-Off.`,
      });
      return;
    }
    setEditCell({ empId, day: date, hour: 8 });
    setCellStatus(current);
  };

  const saveCell = () => {
    if (!editCell) return;
    const startTime = `${editCell.day}T08:00:00`;
    const endTime = `${editCell.day}T17:00:00`;
    createShiftMutation.mutate({
      employee_id: editCell.empId,
      employee_name: employees.find((e: any) => e.id === editCell.empId)?.name || "",
      start_time: startTime,
      end_time: endTime,
      status: cellStatus,
      notes: `Availability: ${STATUS_COLORS[cellStatus]?.label}`,
    });
  };

  // Counts for summary
  const getTodayStats = () => {
    const today = todayLocalISO();
    const avail = employees.filter((e: any) => getStatus(e.id, today) === "available").length;
    const onJob = employees.filter((e: any) => getStatus(e.id, today) === "on_job").length;
    const unavail = employees.filter((e: any) => ["unavailable","pto","training","off"].includes(getStatus(e.id, today))).length;
    return { avail, onJob, unavail };
  };
  const todayStats = getTodayStats();

  const prevWeek = () => {
    const d = new Date(selectedWeek);
    d.setDate(d.getDate() - 7);
    setSelectedWeek(d.toISOString().slice(0, 10));
  };
  const nextWeek = () => {
    const d = new Date(selectedWeek);
    d.setDate(d.getDate() + 7);
    setSelectedWeek(d.toISOString().slice(0, 10));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Grid3X3 className="h-6 w-6 text-blue-500" />
            Dispatch Availability Matrix
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visual week-view of technician availability — click any cell to update status
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={prevWeek} data-testid="button-prev-week">← Prev</Button>
          <span className="text-sm font-medium">{weekDates[0].display} – {weekDates[6].display}</span>
          <Button size="sm" variant="outline" onClick={nextWeek} data-testid="button-next-week">Next →</Button>
        </div>
      </div>

      {/* Today's Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <div>
                <p className="text-xs text-muted-foreground">Available Today</p>
                <p className="text-xl font-bold text-green-600">{todayStats.avail}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-500" />
              <div>
                <p className="text-xs text-muted-foreground">On Job Today</p>
                <p className="text-xl font-bold text-blue-600">{todayStats.onJob}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <div>
                <p className="text-xs text-muted-foreground">Unavailable</p>
                <p className="text-xl font-bold text-red-600">{todayStats.unavail}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Legend */}
      <div className="flex gap-3 flex-wrap items-center">
        {STATUSES.map(s => (
          <div key={s.value} className="flex items-center gap-1">
            <div className={`w-3 h-3 rounded-sm ${STATUS_COLORS[s.value].bg}`} />
            <span className="text-xs text-muted-foreground">{s.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <div className={`w-3 h-3 rounded-sm ${STATUS_COLORS.off.bg} flex items-center justify-center`}>
            <Plane className="w-2 h-2 text-gray-900" />
          </div>
          <span className="text-xs text-muted-foreground">Out (approved time-off — read-only)</span>
        </div>
      </div>

      {/* Matrix */}
      {isLoading ? (
        <div className="h-48 bg-muted rounded animate-pulse" />
      ) : employees.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <User className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="font-semibold">No employees found</p>
          <p className="text-sm text-muted-foreground">Add team members in User Management</p>
        </CardContent></Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="text-left p-2 bg-muted font-semibold text-xs w-32">Tech</th>
                {weekDates.map(({ display, date }) => {
                  const isToday = date === todayLocalISO();
                  return (
                    <th key={date} className={`p-2 text-center text-xs font-semibold ${isToday ? "bg-blue-100 text-blue-700" : "bg-muted"}`}>
                      {display}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp: any) => (
                <tr key={emp.id} className="border-b hover:bg-muted/30" data-testid={`row-emp-${emp.id}`}>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {emp.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-xs leading-tight">{emp.name}</p>
                        <p className="text-xs text-muted-foreground">{emp.role}</p>
                      </div>
                    </div>
                  </td>
                  {weekDates.map(({ date, label }) => {
                    const status = getStatus(emp.id, date);
                    const sc = STATUS_COLORS[status] || STATUS_COLORS.available;
                    const isToday = date === todayLocalISO();
                    return (
                      <td key={date} className={`p-1 text-center ${isToday ? "bg-blue-50" : ""}`}>
                        <button
                          className={`w-full rounded py-1 px-2 text-xs font-medium transition-opacity hover:opacity-80 ${sc.bg} ${sc.text} ${status === "off" ? "cursor-default flex items-center justify-center gap-1" : "cursor-pointer"}`}
                          onClick={() => handleCellClick(emp.id, date)}
                          data-testid={`cell-${emp.id}-${date}`}
                        >
                          {status === "off" && <Plane className="w-2.5 h-2.5" />}
                          {sc.label}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Cell Panel */}
      {editCell && (
        <div className="fixed bottom-6 right-6 bg-card border shadow-xl rounded-xl p-4 w-72 z-50">
          <p className="font-semibold text-sm mb-3">
            Update {employees.find((e: any) => e.id === editCell.empId)?.name} — {editCell.day}
          </p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {STATUSES.map(s => (
              <button
                key={s.value}
                className={`py-2 px-3 rounded text-xs font-medium transition-all ${cellStatus === s.value ? `${STATUS_COLORS[s.value].bg} ${STATUS_COLORS[s.value].text} ring-2 ring-offset-1 ring-current` : "bg-muted text-foreground hover:bg-muted/70"}`}
                onClick={() => setCellStatus(s.value)}
                data-testid={`btn-status-${s.value}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={saveCell} disabled={createShiftMutation.isPending} data-testid="button-save-cell">Save</Button>
            <Button size="sm" variant="outline" onClick={() => setEditCell(null)} data-testid="button-cancel-cell">Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
