import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, CheckCircle, AlertTriangle, Clock, BookOpen, TrendingUp, FileText } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  synced: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

export default function QBSync() {
  const { toast } = useToast();

  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useQuery<any>({
    queryKey: ["/api/qb-sync/summary"],
    queryFn: () => apiRequest("/api/qb-sync/summary").then(r => r.json()),
  });

  const { data: log = [], isLoading: logLoading, refetch: refetchLog } = useQuery<any[]>({
    queryKey: ["/api/qb-sync-log"],
    queryFn: () => apiRequest("/api/qb-sync-log").then(r => r.json()),
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("/api/qb-sync/run", { method: "POST" }).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/qb-sync-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/qb-sync/summary"] });
      toast({ title: `Sync complete — ${data.synced} records pushed to QuickBooks` });
    },
    onError: () => toast({ title: "Sync failed", variant: "destructive" }),
  });

  const recentLog = log.slice(0, 50);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" /> QuickBooks Online Sync
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Push invoices and payments to QuickBooks — no double entry, tax-ready books</p>
        </div>
        <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} data-testid="button-run-sync">
          {syncMutation.isPending ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Syncing...</> : <><RefreshCw className="w-4 h-4 mr-2" />Sync Now</>}
        </Button>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Records", value: summary?.total ?? "—", icon: FileText, color: "text-primary" },
          { label: "Synced to QB", value: summary?.synced ?? "—", icon: CheckCircle, color: "text-green-500" },
          { label: "Pending", value: summary?.pending ?? "—", icon: Clock, color: "text-yellow-500" },
          { label: "Errors", value: summary?.errors ?? "—", icon: AlertTriangle, color: "text-red-500" },
        ].map(kpi => (
          <Card key={kpi.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <kpi.icon className={`w-8 h-8 ${kpi.color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-lg font-bold" data-testid={`kpi-${kpi.label.toLowerCase().replace(/ /g, "-")}`}>{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {summary?.lastSync && (
        <p className="text-xs text-muted-foreground">Last sync: {new Date(summary.lastSync).toLocaleString()}</p>
      )}

      {/* Connection Info */}
      <Card className="border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30">
        <CardContent className="p-4">
          <p className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">QuickBooks Online Integration</p>
          <p className="text-xs text-blue-700 dark:text-blue-400 mb-3">
            Connect your QuickBooks Online account to enable two-way sync. Invoices created in Titan Pro will appear in QB as Accounts Receivable. Payments received will reconcile automatically.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" data-testid="button-connect-qb" onClick={() => { window.location.hash = "/integrations"; }}>
              Connect QuickBooks Online
            </Button>
            <Button size="sm" variant="outline" onClick={() => { refetchSummary(); refetchLog(); }}>
              <RefreshCw className="w-3 h-3 mr-1" /> Refresh Status
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-blue-600 dark:text-blue-500">
            <p>✓ Invoices → QB Accounts Receivable</p>
            <p>✓ Payments → QB Deposits</p>
            <p>✓ Job costs → QB Job Costing</p>
          </div>
        </CardContent>
      </Card>

      {/* Sync Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Sync History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading...</p>
          ) : recentLog.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-30" />
              <p className="text-muted-foreground">No sync history yet. Click "Sync Now" to push your invoices and payments to QuickBooks.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentLog.map((entry: any) => (
                <div key={entry.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border" data-testid={`sync-entry-${entry.id}`}>
                  <div className="flex items-center gap-3">
                    <Badge className={STATUS_COLORS[entry.status] || ""}>{entry.status}</Badge>
                    <div>
                      <p className="text-sm font-medium capitalize">{entry.entity_type} #{entry.entity_id}</p>
                      {entry.qb_id && <p className="text-xs text-muted-foreground">QB ID: {entry.qb_id}</p>}
                      {entry.error_message && <p className="text-xs text-red-500">{entry.error_message}</p>}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{entry.synced_at ? new Date(entry.synced_at).toLocaleString() : "Pending"}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
