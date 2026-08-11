// ─────────────────────────────────────────────────────────────────────────────
// NotificationBell — header dropdown showing the current user's alerts.
//
// Polls /api/notifications/me/unread-count every 30s (silent) and only loads
// the full list when the popover opens, so the extra network traffic is small.
//
// Click a notification → marks it read + navigates to its `link` (usually the
// linked job's detail page). "Mark all read" + per-row delete supported.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell, Check, CheckCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";

interface Notification {
  id: number;
  type: string;
  title: string;
  body: string;
  jobId: number | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);

  // Lightweight badge poll — runs even when the dropdown is closed.
  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/me/unread-count"],
    queryFn: () => apiRequest("GET", "/api/notifications/me/unread-count").then(r => r.json()),
    refetchInterval: 30_000,
    enabled: !!user,
  });
  const unread = countData?.count || 0;

  // Full list — only fetched when the popover is open, but kept fresh at 15s
  // intervals while open.
  const { data: items = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications/me"],
    queryFn: () => apiRequest("GET", "/api/notifications/me").then(r => r.json()),
    enabled: !!user && open,
    refetchInterval: open ? 15_000 : false,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/notifications/${id}/read`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/notifications/me"] });
      qc.invalidateQueries({ queryKey: ["/api/notifications/me/unread-count"] });
    },
  });
  const markAll = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/notifications/me/read-all", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/notifications/me"] });
      qc.invalidateQueries({ queryKey: ["/api/notifications/me/unread-count"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/notifications/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/notifications/me"] });
      qc.invalidateQueries({ queryKey: ["/api/notifications/me/unread-count"] });
    },
  });

  function onOpenItem(n: Notification) {
    if (!n.read) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) setLocation(n.link);
    else if (n.jobId) setLocation(`/jobs/${n.jobId}`);
  }

  if (!user) return null;

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-full hover:bg-muted transition"
        aria-label="Notifications"
        data-testid="button-notification-bell"
        title="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[hsl(var(--titan-red))] text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* click-away layer */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-11 z-40 w-80 sm:w-96 max-h-[70vh] flex flex-col bg-background border border-border rounded-lg shadow-xl overflow-hidden"
            data-testid="dropdown-notifications"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-muted-foreground" />
                <span className="font-semibold text-sm">Notifications</span>
                {unread > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--titan-red))]/10 text-[hsl(var(--titan-red))] font-semibold">
                    {unread} new
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => markAll.mutate()}
                    disabled={markAll.isPending}
                    data-testid="button-mark-all-read"
                  >
                    <CheckCheck className="w-3 h-3 mr-1" />Mark all read
                  </Button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-1 rounded hover:bg-muted"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  You're all caught up.
                </div>
              ) : (
                items.map(n => (
                  <div
                    key={n.id}
                    className={`group flex gap-2 px-3 py-2.5 border-b border-border/60 last:border-0 cursor-pointer hover:bg-muted/50 transition ${!n.read ? "bg-[hsl(var(--titan-blue))]/[0.04]" : ""}`}
                    onClick={() => onOpenItem(n)}
                    data-testid={`notification-item-${n.id}`}
                  >
                    {/* unread dot */}
                    <div className="w-2 pt-1.5">
                      {!n.read && (
                        <span className="block w-2 h-2 rounded-full bg-[hsl(var(--titan-red))]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <p className="font-semibold text-sm truncate">{n.title}</p>
                        <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(n.createdAt)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</p>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 flex flex-col items-end gap-1 shrink-0">
                      {!n.read && (
                        <button
                          onClick={(e) => { e.stopPropagation(); markRead.mutate(n.id); }}
                          className="p-1 rounded hover:bg-muted"
                          title="Mark read"
                          data-testid={`button-notification-read-${n.id}`}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); remove.mutate(n.id); }}
                        className="p-1 rounded hover:bg-muted text-destructive"
                        title="Delete"
                        data-testid={`button-notification-delete-${n.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
