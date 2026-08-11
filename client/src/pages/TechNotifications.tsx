import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Bell, BellOff, Check, CheckCheck, Briefcase, Droplets, MessageSquare, AlertCircle, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { fmtDateShort } from "@/lib/dates";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const TYPE_ICONS: Record<string, any> = {
  assignment: Briefcase,
  drying_alert: Droplets,
  message: MessageSquare,
  follow_up: AlertCircle,
  general: Bell,
};

const TYPE_COLORS: Record<string, string> = {
  assignment: "text-[hsl(var(--titan-blue))] bg-[hsl(var(--titan-blue)/0.1)]",
  drying_alert: "text-orange-600 bg-orange-100",
  message: "text-green-600 bg-green-100",
  follow_up: "text-yellow-600 bg-yellow-100",
  general: "text-gray-600 bg-gray-100",
};

const TECHS = ["Cody Brantley", "John", "Mason", "Clint", "Blake", "Blake Foster"];

export default function TechNotifications() {
  const { toast } = useToast();
  const [selectedTech, setSelectedTech] = useState("Cody Brantley");

  const { data: notifications = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/tech-notifications", selectedTech],
    queryFn: () => apiRequest("GET", `/api/tech-notifications/${encodeURIComponent(selectedTech)}`).then(r => r.json()),
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/tech-notifications", selectedTech, "unread"],
    queryFn: () => apiRequest("GET", `/api/tech-notifications/${encodeURIComponent(selectedTech)}/unread-count`).then(r => r.json()),
  });

  const readMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/tech-notifications/${id}/read`, {}).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tech-notifications", selectedTech] });
      queryClient.invalidateQueries({ queryKey: ["/api/tech-notifications", selectedTech, "unread"] });
    },
  });

  const readAllMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/tech-notifications/${encodeURIComponent(selectedTech)}/read-all`, {}).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tech-notifications", selectedTech] });
      queryClient.invalidateQueries({ queryKey: ["/api/tech-notifications", selectedTech, "unread"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/tech-notifications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tech-notifications", selectedTech] });
      queryClient.invalidateQueries({ queryKey: ["/api/tech-notifications", selectedTech, "unread"] });
      toast({ title: "Notification deleted" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const unread = notifications.filter(n => !n.read).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Bell className="w-5 h-5 text-[hsl(var(--titan-blue))]" />Tech Notifications
            {unread > 0 && (
              <span className="bg-[hsl(var(--titan-red))] text-white text-xs font-bold px-2 py-0.5 rounded-full">{unread}</span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">In-app alerts for job assignments, drying alerts, and follow-ups</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedTech} onValueChange={setSelectedTech}>
            <SelectTrigger className="w-44" data-testid="select-tech">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TECHS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          {unread > 0 && (
            <Button variant="outline" size="sm" onClick={() => readAllMutation.mutate()} data-testid="button-mark-all-read">
              <CheckCheck className="w-4 h-4 mr-1" />Mark all read
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}
        </div>
      ) : notifications.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <BellOff className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="font-semibold text-foreground">All caught up!</p>
            <p className="text-muted-foreground text-sm mt-1">No notifications for {selectedTech}.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((n: any) => {
            const Icon = TYPE_ICONS[n.type] || Bell;
            return (
              <Card
                key={n.id}
                className={`transition-all ${!n.read ? "border-l-4 border-l-[hsl(var(--titan-blue))] shadow-sm" : "opacity-70"}`}
                data-testid={`notification-${n.id}`}
              >
                <CardContent className="p-4 flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${TYPE_COLORS[n.type] || "text-gray-600 bg-gray-100"}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm font-semibold ${!n.read ? "text-foreground" : "text-muted-foreground"}`}>{n.title}</p>
                      {!n.read && <span className="w-2 h-2 rounded-full bg-[hsl(var(--titan-blue))]" />}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{n.body}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {fmtDateShort(n.created_at)}
                      {n.job_id && ` · Job #${n.job_id}`}
                    </p>
                  </div>
                  {!n.read && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => readMutation.mutate(n.id)}
                      className="shrink-0 text-muted-foreground"
                      data-testid={`button-read-${n.id}`}
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-muted-foreground"
                        data-testid={`button-delete-tech-notifications-${n.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this notification?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {n.title ? `"${n.title}" ` : ""}This permanently removes the record and cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteMutation.mutate(n.id)} data-testid={`button-confirm-delete-tech-notifications-${n.id}`}>
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
