import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Clock, Wrench, MapPin, User, CalendarCheck } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

export default function EquipmentAlerts() {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [returnDate, setReturnDate] = useState<string>("");

  const { data: alerts = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/equipment-alerts"],
    queryFn: () => apiRequest("GET", "/api/equipment-alerts").then(r => r.json()),
  });

  const { data: allDeployments = [] } = useQuery<any[]>({
    queryKey: ["/api/equipment-deployments"],
    queryFn: () => apiRequest("GET", "/api/equipment-deployments").then(r => r.json()),
  });

  const setReturnMutation = useMutation({
    mutationFn: ({ id, date }: { id: number; date: string }) =>
      apiRequest("PATCH", `/api/equipment-deployments/${id}/expected-return`, { expectedReturnDate: date }).then(r => r.json()),
    onSuccess: () => {
      setEditingId(null);
      setReturnDate("");
      queryClient.invalidateQueries({ queryKey: ["/api/equipment-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/equipment-deployments"] });
      toast({ title: "Return date set", description: "Equipment return date updated." });
      refetch();
    },
    onError: () => toast({ title: "Error", description: "Failed to set return date.", variant: "destructive" }),
  });

  const overdueCount = alerts.filter((a: any) => a.isOverdue).length;
  const noReturnCount = alerts.filter((a: any) => !a.expected_return_date).length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-6 h-6 text-[hsl(var(--titan-red))]" />
        <div>
          <h1 className="text-xl font-bold">Equipment Return Alerts</h1>
          <p className="text-sm text-muted-foreground">Overdue pickups and missing return dates</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Overdue</p>
            <p className="text-2xl font-bold mt-1 text-red-600" data-testid="text-overdue-count">{overdueCount}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">No Return Date</p>
            <p className="text-2xl font-bold mt-1 text-yellow-600" data-testid="text-no-return-count">{noReturnCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Total Flagged</p>
            <p className="text-2xl font-bold mt-1" data-testid="text-total-flagged">{alerts.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Alerts List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wrench className="w-4 h-4" /> Flagged Equipment Deployments
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : alerts.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <CalendarCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">All equipment is on schedule</p>
              <p className="text-sm mt-1">No overdue or missing return dates</p>
            </div>
          ) : (
            <div className="divide-y">
              {alerts.map((alert: any) => (
                <div key={alert.id} className="p-4 hover:bg-muted/30 transition-colors" data-testid={`row-alert-${alert.id}`}>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{alert.equipment_name || `Equipment #${alert.equipment_id}`}</span>
                        {alert.isOverdue ? (
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            {alert.deployedDays ? `${alert.deployedDays}d overdue` : "Overdue"}
                          </Badge>
                        ) : (
                          <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">
                            No Return Date
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {alert.job_number && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            <Link href={`/jobs/${alert.job_id}`} className="text-[hsl(var(--titan-blue))] hover:underline">
                              {alert.job_number}
                            </Link>
                          </span>
                        )}
                        {alert.tech && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" /> {alert.tech}
                          </span>
                        )}
                        {alert.deployed_at && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Deployed {new Date(alert.deployed_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      {alert.expected_return_date && (
                        <p className="text-xs text-muted-foreground">
                          Expected return: {new Date(alert.expected_return_date).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {editingId === alert.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            type="date"
                            value={returnDate}
                            onChange={e => setReturnDate(e.target.value)}
                            className="h-8 w-36 text-xs"
                            data-testid={`input-return-date-${alert.id}`}
                          />
                          <Button
                            size="sm"
                            className="h-8 bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
                            onClick={() => setReturnMutation.mutate({ id: alert.id, date: returnDate })}
                            disabled={!returnDate || setReturnMutation.isPending}
                            data-testid={`button-save-return-${alert.id}`}
                          >
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => { setEditingId(alert.id); setReturnDate(alert.expected_return_date?.slice(0, 10) || ""); }}
                          data-testid={`button-set-return-${alert.id}`}
                        >
                          <CalendarCheck className="w-3 h-3 mr-1" />
                          Set Return Date
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
