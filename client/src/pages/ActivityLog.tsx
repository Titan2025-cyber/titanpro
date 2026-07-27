import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Activity, Filter, Briefcase, FileText, DollarSign, Camera, PenTool, MessageSquare, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

const ACTION_ICONS: Record<string, any> = {
  created: "✨", updated: "✏️", status_changed: "🔄", note_added: "📝",
  photo_added: "📸", signed: "✍️", paid: "💰", assigned: "👤", sms_sent: "💬",
  drying_alert: "🚨", estimate_submitted: "📤",
};

const ACTION_LABELS: Record<string, string> = {
  created: "Created", updated: "Updated", status_changed: "Status Changed",
  note_added: "Note Added", photo_added: "Photo Added", signed: "Signed",
  paid: "Payment", assigned: "Assigned", sms_sent: "SMS Sent", drying_alert: "Drying Alert",
};

const ENTITY_COLORS: Record<string, string> = {
  job: "bg-[hsl(var(--titan-blue)/0.1)] text-[hsl(var(--titan-blue))]",
  estimate: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  invoice: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  payment: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  drying: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  sms: "bg-[hsl(var(--titan-red)/0.1)] text-[hsl(var(--titan-red))]",
  document: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

function DeleteActivityLogBtn({ id, label, onDone }: { id: number; label: string; onDone: () => void }) {
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/activity-log/${id}`),
    onSuccess: () => { toast({ title: "Deleted" }); onDone(); },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-testid={`button-delete-activity-log-${id}`}>
          <Trash2 className="w-3.5 h-3.5 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this activity log entry?</AlertDialogTitle>
          <AlertDialogDescription>
            {label ? `"${label}" ` : ""}This permanently removes the record and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => m.mutate()} data-testid={`button-confirm-delete-activity-log-${id}`}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function ActivityLog() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<string>("all");

  const { data: logs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/activity-log"],
    queryFn: () => apiRequest("GET", "/api/activity-log").then(r => r.json()),
  });

  const entityTypes = ["all", "job", "estimate", "invoice", "payment", "drying", "sms", "document"];

  const filtered = filter === "all" ? logs : logs.filter(l => l.entity_type === filter);

  // Group by date
  const grouped: Record<string, any[]> = {};
  filtered.forEach(log => {
    const dateKey = new Date(log.created_at).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(log);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Activity className="w-5 h-5 text-[hsl(var(--titan-blue))]" />Activity Log
          </h1>
          <p className="text-sm text-muted-foreground">Full audit trail of all actions across Titan Pro</p>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {entityTypes.map(type => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${
              filter === type
                ? "bg-[hsl(var(--titan-blue))] text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            data-testid={`filter-${type}`}
          >
            {type}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No activity logged yet. Actions taken in Titan Pro will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([date, entries]) => (
            <div key={date}>
              <div className="flex items-center gap-3 mb-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{date}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-2">
                {entries.map((log: any) => (
                  <Card key={log.id} className="hover:shadow-sm transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="text-xl mt-0.5 w-8 text-center">{ACTION_ICONS[log.action] || "📋"}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ENTITY_COLORS[log.entity_type] || "bg-muted text-muted-foreground"}`}>
                              {log.entity_type}
                            </span>
                            <span className="text-xs text-muted-foreground">{ACTION_LABELS[log.action] || log.action}</span>
                            {log.job_id && (
                              <span className="text-xs text-[hsl(var(--titan-blue))] font-medium">Job #{log.job_id}</span>
                            )}
                          </div>
                          <p className="text-sm text-foreground">{log.description}</p>
                        </div>
                        <div className="text-right shrink-0 flex items-start gap-2">
                          <div>
                            <p className="text-xs font-medium text-foreground">{log.actor}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(log.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                          {(user?.role === "owner" || user?.role === "admin") && log.id != null && (
                            <DeleteActivityLogBtn
                              id={log.id}
                              label={log.description}
                              onDone={() => queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] })}
                            />
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
