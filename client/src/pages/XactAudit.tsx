import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Zap, CheckCircle2, XCircle, DollarSign, AlertTriangle, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Job { id: number; jobNumber: string; address: string; lossType: string; }
interface AuditFlag {
  id: number; jobId: number; code: string; description: string;
  estimatedValue: number; status: string; lossType: string;
}

const STATUS_COLORS: Record<string, string> = {
  flagged: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  added: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  dismissed: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

export default function XactAudit() {
  const { toast } = useToast();
  const [selectedJobId, setSelectedJobId] = useState("");
  const [viewJobId, setViewJobId] = useState("");

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then(r => r.json()),
  });

  const { data: flags = [], isLoading } = useQuery<AuditFlag[]>({
    queryKey: ["/api/xact-audit", viewJobId],
    queryFn: () => apiRequest(viewJobId ? `/api/xact-audit/${viewJobId}` : "/api/xact-audit").then(r => r.json()),
    enabled: true,
  });

  const scanMutation = useMutation({
    mutationFn: ({ jobId, lossType }: { jobId: string; lossType: string }) =>
      apiRequest(`/api/xact-audit/scan/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lossType }),
      }).then(r => r.json()),
    onSuccess: (data, vars) => {
      setViewJobId(vars.jobId);
      queryClient.invalidateQueries({ queryKey: ["/api/xact-audit"] });
      toast({ title: `${data.flagsCreated} Line Items Flagged`, description: `Potential missed value: $${data.totalPotentialValue?.toLocaleString("en-US", { maximumFractionDigits: 0 })}` });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest(`/api/xact-audit/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, dismissedBy: "Cody Brantley" }),
      }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/xact-audit"] }),
  });

  const selectedJob = jobs.find(j => String(j.id) === selectedJobId);
  const activeFlags = flags.filter(f => f.status === "flagged");
  const addedFlags = flags.filter(f => f.status === "added");
  const totalMissed = activeFlags.reduce((s, f) => s + (f.estimatedValue || 0), 0);
  const totalAdded = addedFlags.reduce((s, f) => s + (f.estimatedValue || 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Search className="w-7 h-7 text-blue-600" />
        <div>
          <h1 className="text-xl font-bold">Xactimate Line Item Audit</h1>
          <p className="text-sm text-muted-foreground">Auto-scan any job for commonly missed codes that leave money on the table</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Flagged Items</p>
          <p className="text-2xl font-bold text-red-600">{activeFlags.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Potential Missed Value</p>
          <p className="text-2xl font-bold text-orange-600">${totalMissed.toLocaleString("en-US", { maximumFractionDigits: 0 })}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Items Added to Estimate</p>
          <p className="text-2xl font-bold text-green-600">{addedFlags.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Value Recovered</p>
          <p className="text-2xl font-bold text-blue-600">${totalAdded.toLocaleString("en-US", { maximumFractionDigits: 0 })}</p>
        </CardContent></Card>
      </div>

      {/* Scan Panel */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Zap className="w-4 h-4 text-yellow-500" />Run Audit Scan</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Select a job and scan for missing Xactimate line items based on loss type. Each scan checks 10–12 commonly missed codes plus 8 universal general conditions items.</p>
          <div className="flex gap-3 flex-wrap">
            <Select value={selectedJobId} onValueChange={setSelectedJobId}>
              <SelectTrigger className="w-80" data-testid="select-audit-job">
                <SelectValue placeholder="Select a job to audit..." />
              </SelectTrigger>
              <SelectContent>
                {jobs.map(j => (
                  <SelectItem key={j.id} value={String(j.id)}>
                    {j.jobNumber} — {j.address?.split(",")[0]} ({j.lossType})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              data-testid="button-run-audit"
              onClick={() => selectedJob && scanMutation.mutate({ jobId: selectedJobId, lossType: selectedJob.lossType })}
              disabled={!selectedJobId || scanMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Zap className="w-4 h-4 mr-2" />
              {scanMutation.isPending ? "Scanning..." : "Audit This Job"}
            </Button>
            {viewJobId && (
              <Button variant="outline" onClick={() => setViewJobId("")}>View All Jobs</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Flags List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Flagged Line Items {viewJobId && <span className="text-muted-foreground font-normal ml-2">— {jobs.find(j => String(j.id) === viewJobId)?.jobNumber}</span>}</span>
            {totalMissed > 0 && (
              <span className="text-sm font-normal text-red-600 flex items-center gap-1">
                <TrendingUp className="w-4 h-4" />${totalMissed.toLocaleString("en-US", { maximumFractionDigits: 0 })} potential left on table
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
          ) : flags.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No audit results yet. Select a job above and run a scan.</p>
            </div>
          ) : (
            <div className="divide-y">
              {flags.map(flag => (
                <div key={flag.id} data-testid={`audit-flag-${flag.id}`} className={`p-4 flex items-start justify-between gap-4 ${flag.status === "dismissed" ? "opacity-40" : ""}`}>
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-sm bg-muted px-2 py-0.5 rounded">{flag.code}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[flag.status]}`}>{flag.status}</span>
                      {flag.estimatedValue > 0 && (
                        <span className="text-xs text-green-700 dark:text-green-400 font-medium">~${flag.estimatedValue.toLocaleString("en-US", { maximumFractionDigits: 0 })} est.</span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{flag.description}</p>
                    <p className="text-xs text-muted-foreground capitalize">{flag.lossType} loss</p>
                  </div>
                  {flag.status === "flagged" && (
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" onClick={() => updateMutation.mutate({ id: flag.id, status: "added" })} className="bg-green-600 hover:bg-green-700 text-white text-xs">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />Added
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ id: flag.id, status: "dismissed" })} className="text-xs">
                        <XCircle className="w-3.5 h-3.5 mr-1" />N/A
                      </Button>
                    </div>
                  )}
                  {flag.status === "added" && <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
