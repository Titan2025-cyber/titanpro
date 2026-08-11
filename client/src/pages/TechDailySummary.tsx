import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, MapPin, Briefcase, CalendarCheck, Clock } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { fmtDate, todayLocalISO } from "@/lib/dates";

const TECHS = ["John", "Mason", "Clint", "Blake", "Blake Foster"];

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  mitigation: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  drying: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  reconstruction: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  complete: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
};

const LOSS_ICONS: Record<string, string> = {
  water: "💧", fire: "🔥", mold: "🍄", storm: "⛈️", biohazard: "☣️", reconstruction: "🏗️",
};

export default function TechDailySummary() {
  const [selectedTech, setSelectedTech] = useState<string>(TECHS[0]);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/tech-daily", selectedTech],
    queryFn: () => apiRequest("GET", `/api/tech-daily/${encodeURIComponent(selectedTech)}`).then(r => r.json()),
    enabled: !!selectedTech,
  });

  const activeJobs: any[] = data?.activeJobs || [];
  const scheduledToday: any[] = data?.scheduledToday || [];
  const today = data?.date || todayLocalISO();

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <User className="w-6 h-6 text-[hsl(var(--titan-blue))]" />
          <div>
            <h1 className="text-xl font-bold">Tech Daily Summary</h1>
            <p className="text-sm text-muted-foreground">
              {fmtDate(today + "T12:00:00", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
        </div>
        <Select value={selectedTech} onValueChange={setSelectedTech}>
          <SelectTrigger className="w-44" data-testid="select-tech">
            <SelectValue placeholder="Select tech" />
          </SelectTrigger>
          <SelectContent>
            {TECHS.map(t => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Today's Schedule */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
            Today's Scheduled Shifts
            <Badge variant="outline">{scheduledToday.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : scheduledToday.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              No shifts scheduled for {selectedTech} today
            </div>
          ) : (
            <div className="divide-y">
              {scheduledToday.map((shift: any) => (
                <div key={shift.id} className="p-4 flex items-center justify-between" data-testid={`row-shift-${shift.id}`}>
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">{shift.job_number || `Job #${shift.job_id}`}</p>
                      <p className="text-xs text-muted-foreground">{shift.address || "No address"}</p>
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {shift.start_time && (
                      <p>{new Date(shift.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                    )}
                    {shift.loss_type && <p className="capitalize">{LOSS_ICONS[shift.loss_type]} {shift.loss_type}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Jobs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-[hsl(var(--titan-red))]" />
            Active Jobs Assigned to {selectedTech}
            <Badge variant="outline">{activeJobs.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : activeJobs.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              No active jobs for {selectedTech}
            </div>
          ) : (
            <div className="divide-y">
              {activeJobs.map((job: any) => (
                <Link key={job.id} href={`/jobs/${job.id}`}>
                  <div className="p-4 hover:bg-muted/30 transition-colors cursor-pointer" data-testid={`row-job-${job.id}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{LOSS_ICONS[job.loss_type] || "📋"}</span>
                        <div>
                          <p className="font-semibold text-sm">{job.job_number || `#${job.id}`}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {job.address || "No address"}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge className={STATUS_COLORS[job.status] || "bg-muted text-muted-foreground"}>
                          {job.status}
                        </Badge>
                        {job.insurance_carrier && (
                          <p className="text-xs text-muted-foreground mt-1">{job.insurance_carrier}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Titan Restoration LLC · 706-922-0154 · Active jobs exclude completed and closed statuses
      </p>
    </div>
  );
}
