import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, Search, LogIn, LogOut, AlertTriangle, Lock, Edit3, FileText, DollarSign, Trash2, Eye } from "lucide-react";

const ACTION_META: Record<string, { label: string; color: string; icon: typeof LogIn }> = {
  login_success:   { label: "Login",          color: "bg-green-100 text-green-700",  icon: LogIn       },
  login_failed:    { label: "Failed Login",   color: "bg-red-100 text-red-700",      icon: AlertTriangle },
  login_locked:    { label: "Account Locked", color: "bg-orange-100 text-orange-700",icon: Lock        },
  logout:          { label: "Logout",         color: "bg-gray-100 text-gray-700",    icon: LogOut      },
  create:          { label: "Created",        color: "bg-blue-100 text-blue-700",    icon: FileText    },
  update:          { label: "Updated",        color: "bg-yellow-100 text-yellow-700",icon: Edit3       },
  delete:          { label: "Deleted",        color: "bg-red-100 text-red-700",      icon: Trash3      },
  payment:         { label: "Payment",        color: "bg-green-100 text-green-700",  icon: DollarSign  },
  payout:          { label: "Payout",         color: "bg-purple-100 text-purple-700",icon: DollarSign  },
  view:            { label: "Viewed",         color: "bg-gray-100 text-gray-600",    icon: Eye         },
};

function Trash3(props: any) { return <Trash2 {...props} />; }

function fmtDate(d: string) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    + " " + dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

export default function AuditLog() {
  const { user, token } = useAuth();
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("all");

  const { data: logs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/audit-log", filterAction],
    queryFn: () =>
      apiRequest("GET", `/api/audit-log?limit=500${filterAction !== "all" ? `&action=${filterAction}` : ""}`).then(r => r.json()),
    staleTime: 0,
    enabled: !!token && (user?.role === "owner" || user?.role === "admin"),
  });

  const { data: loginAttempts = [] } = useQuery<any[]>({
    queryKey: ["/api/login-attempts"],
    queryFn: () =>
      apiRequest("GET", "/api/login-attempts").then(r => r.json()),
    staleTime: 0,
    enabled: !!token && user?.role === "owner",
  });

  if (!user || !["owner", "admin"].includes(user.role)) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Lock className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Access Restricted</p>
        <p className="text-sm">Audit log is available to owners and admins only.</p>
      </div>
    );
  }

  const filtered = logs.filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (l.employee_name || "").toLowerCase().includes(q) ||
      (l.action || "").toLowerCase().includes(q) ||
      (l.entity || "").toLowerCase().includes(q) ||
      (l.detail || "").toLowerCase().includes(q)
    );
  });

  const failedLogins = loginAttempts.filter(a => !a.success);
  const recentLocks = logs.filter(l => l.action === "login_locked").slice(0, 5);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck className="w-5 h-5 text-[hsl(var(--titan-blue))]" />
        <h1 className="text-lg font-bold">Security Audit Log</h1>
        <Badge variant="outline" className="ml-auto text-xs">{filtered.length} entries</Badge>
      </div>

      {/* Security Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-green-200">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total Events</p>
            <p className="text-xl font-bold text-green-600">{logs.length}</p>
          </CardContent>
        </Card>
        <Card className="border-red-200">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Failed Logins (recent)</p>
            <p className="text-xl font-bold text-red-600">{failedLogins.length}</p>
          </CardContent>
        </Card>
        <Card className="border-orange-200">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Accounts Locked</p>
            <p className="text-xl font-bold text-orange-600">{recentLocks.length}</p>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Successful Logins</p>
            <p className="text-xl font-bold text-blue-600">
              {logs.filter(l => l.action === "login_success").length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-xs"
            placeholder="Search by user, action, detail..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-audit-search"
          />
        </div>
        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="h-8 text-xs w-40" data-testid="select-audit-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            <SelectItem value="login_success">Logins</SelectItem>
            <SelectItem value="login_failed">Failed Logins</SelectItem>
            <SelectItem value="login_locked">Lockouts</SelectItem>
            <SelectItem value="payment">Payments</SelectItem>
            <SelectItem value="payout">Payouts</SelectItem>
            <SelectItem value="create">Created</SelectItem>
            <SelectItem value="update">Updated</SelectItem>
            <SelectItem value="delete">Deleted</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Log Table */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading audit log…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ShieldCheck className="w-10 h-10 mx-auto mb-2 opacity-20" />
          <p className="text-sm">No events found.</p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {filtered.map((log, i) => {
                const meta = ACTION_META[log.action] || { label: log.action, color: "bg-gray-100 text-gray-600", icon: Eye };
                const MetaIcon = meta.icon;
                return (
                  <div key={log.id || i} className="flex items-start gap-3 p-3 hover:bg-muted/20 transition-colors" data-testid={`row-audit-${log.id}`}>
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${meta.color}`}>
                      <MetaIcon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{log.employee_name || "System"}</span>
                        <Badge className={`${meta.color} text-[10px] py-0 px-1.5`}>{meta.label}</Badge>
                        {log.entity && (
                          <span className="text-xs text-muted-foreground">
                            · {log.entity}{log.entity_id != null && String(log.entity_id) !== "null" ? ` #${log.entity_id}` : ""}
                          </span>
                        )}
                      </div>
                      {log.detail && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.detail}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-muted-foreground whitespace-nowrap">{fmtDate(log.created_at)}</p>
                      {log.ip && <p className="text-[10px] text-muted-foreground/60">{log.ip.split(",")[0].trim()}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
