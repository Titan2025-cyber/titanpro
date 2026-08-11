import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  ShieldCheck,
  Scan,
  CheckCircle2,
  AlertCircle,
  Biohazard,
  Flame,
  Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtDateShort } from "@/lib/dates";

interface HazmatFlag {
  id: number;
  jobId: number;
  flagType: string;
  riskLevel: string;
  description: string;
  detectedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  status: string;
}

interface Job {
  id: number;
  jobNumber: string;
  address: string;
  lossType: string;
}

const FLAG_COLORS: Record<string, string> = {
  lead: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  asbestos: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  mold: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  biohazard: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  drug: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

const RISK_COLORS: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-green-500 text-white",
};

function FlagIcon({ type }: { type: string }) {
  if (type === "biohazard") return <Biohazard className="w-4 h-4" />;
  if (type === "mold") return <AlertTriangle className="w-4 h-4" />;
  if (type === "lead" || type === "asbestos") return <Flame className="w-4 h-4" />;
  return <AlertCircle className="w-4 h-4" />;
}

function DeleteFlagBtn({ id, label }: { id: number; label: string }) {
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: () => apiRequest(`/api/hazmat-flags/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Flag Deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/hazmat-flags"] });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className="shrink-0" data-testid={`button-delete-hazmat-flags-${id}`}>
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this hazmat flag?</AlertDialogTitle>
          <AlertDialogDescription>
            {label ? `"${label}" ` : ""}This permanently removes the record and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => m.mutate()} data-testid={`button-confirm-delete-hazmat-flags-${id}`}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function HazmatFlags() {
  const { toast } = useToast();
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: flags = [], isLoading: flagsLoading } = useQuery<HazmatFlag[]>({
    queryKey: ["/api/hazmat-flags"],
    queryFn: () => apiRequest("/api/hazmat-flags").then((r) => r.json()),
  });

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then((r) => r.json()),
  });

  const autoScanMutation = useMutation({
    mutationFn: (jobId: string) =>
      apiRequest(`/api/hazmat-flags/auto-scan/${jobId}`, { method: "POST" }).then((r) =>
        r.json()
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/hazmat-flags"] });
      const count = data?.flagsCreated ?? 0;
      toast({
        title: count > 0 ? `${count} Hazmat Flag(s) Detected` : "No Hazmat Flags Detected",
        description:
          count > 0
            ? "Flags have been added to the job file. Review and acknowledge below."
            : "Job scanned — no lead, asbestos, or mold indicators found.",
      });
    },
    onError: () => {
      toast({ title: "Scan Failed", description: "Could not complete the auto-scan.", variant: "destructive" });
    },
  });

  const acknowledgeMutation = useMutation({
    mutationFn: ({ id, by }: { id: number; by: string }) =>
      apiRequest(`/api/hazmat-flags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "acknowledged",
          acknowledgedAt: new Date().toISOString(),
          acknowledgedBy: by,
        }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hazmat-flags"] });
      toast({ title: "Flag Acknowledged", description: "Hazmat flag marked as reviewed." });
    },
  });

  const filtered = flags.filter((f) => {
    if (statusFilter !== "all" && f.status !== statusFilter) return false;
    return true;
  });

  const openCount = flags.filter((f) => f.status === "open").length;
  const criticalCount = flags.filter((f) => f.riskLevel === "critical").length;
  const acknowledgedCount = flags.filter((f) => f.status === "acknowledged").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-7 h-7 text-orange-500" />
          <div>
            <h1 className="text-xl font-bold">EPA Hazmat Flags</h1>
            <p className="text-sm text-muted-foreground">
              Lead, asbestos, mold, and biohazard detection per OSHA/EPA guidelines
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Open Flags</p>
            <p className="text-2xl font-bold text-orange-600">{openCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Critical Risk</p>
            <p className="text-2xl font-bold text-red-600">{criticalCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Acknowledged</p>
            <p className="text-2xl font-bold text-green-600">{acknowledgedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Flags</p>
            <p className="text-2xl font-bold">{flags.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Auto-Scan Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Scan className="w-4 h-4 text-blue-600" />
            Auto-Scan a Job
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Select a job to automatically scan for hazmat indicators: pre-1978 construction (lead),
            pre-1980 (asbestos), mold loss type, and biohazard conditions.
          </p>
          <div className="flex gap-3 flex-wrap">
            <Select value={selectedJobId} onValueChange={setSelectedJobId}>
              <SelectTrigger className="w-72" data-testid="select-job-scan">
                <SelectValue placeholder="Select a job to scan..." />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((job) => (
                  <SelectItem key={job.id} value={String(job.id)}>
                    {job.jobNumber} — {job.address?.split(",")[0]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              data-testid="button-auto-scan"
              onClick={() => selectedJobId && autoScanMutation.mutate(selectedJobId)}
              disabled={!selectedJobId || autoScanMutation.isPending}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              <Scan className="w-4 h-4 mr-2" />
              {autoScanMutation.isPending ? "Scanning..." : "Run Auto-Scan"}
            </Button>
          </div>

          {/* EPA Guidelines Quick Reference */}
          <div className="mt-3 p-3 bg-muted/40 rounded-lg text-xs space-y-1 text-muted-foreground">
            <p className="font-medium text-foreground">Auto-Scan Rules (EPA/OSHA):</p>
            <p>🟡 <strong>Lead:</strong> Pre-1978 construction → RRP rule applies (40 CFR Part 745)</p>
            <p>🟠 <strong>Asbestos:</strong> Pre-1980 construction → NESHAP inspection required (40 CFR Part 61)</p>
            <p>🟢 <strong>Mold:</strong> Mold loss type → IICRC S520 + EPA mold guidelines</p>
            <p>🔴 <strong>Biohazard:</strong> Biohazard loss type → OSHA Bloodborne Pathogen Standard (29 CFR 1910.1030)</p>
          </div>
        </CardContent>
      </Card>

      {/* Flags List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Hazmat Flags</CardTitle>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36" data-testid="select-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Flags</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="cleared">Cleared</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {flagsLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <ShieldCheck className="w-10 h-10 mx-auto mb-3 text-green-500 opacity-60" />
              <p className="font-medium">No hazmat flags found.</p>
              <p className="text-sm mt-1">
                Use Auto-Scan on any job to detect potential hazardous conditions.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((flag) => {
                const job = jobs.find((j) => j.id === flag.jobId);
                return (
                  <div
                    key={flag.id}
                    data-testid={`hazmat-flag-${flag.id}`}
                    className="p-4 flex items-start justify-between gap-4"
                  >
                    <div className="flex items-start gap-3">
                      {/* Flag type icon */}
                      <div
                        className={`mt-0.5 p-1.5 rounded-lg ${
                          FLAG_COLORS[flag.flagType] ?? "bg-gray-100 text-gray-700"
                        }`}
                      >
                        <FlagIcon type={flag.flagType} />
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold capitalize">{flag.flagType}</span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              RISK_COLORS[flag.riskLevel] ?? "bg-gray-200"
                            }`}
                          >
                            {flag.riskLevel?.toUpperCase()}
                          </span>
                          {flag.status === "acknowledged" && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                              <CheckCircle2 className="w-3 h-3" />
                              Acknowledged
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{flag.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {job
                            ? `${job.jobNumber} — ${job.address?.split(",")[0]}`
                            : `Job #${flag.jobId}`}{" "}
                          · Detected {fmtDateShort(flag.detectedAt)}
                        </p>
                        {flag.acknowledgedBy && (
                          <p className="text-xs text-green-600 dark:text-green-400">
                            Acknowledged by {flag.acknowledgedBy} on{" "}
                            {fmtDateShort(flag.acknowledgedAt!)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {flag.status === "open" && (
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`button-acknowledge-${flag.id}`}
                          onClick={() =>
                            acknowledgeMutation.mutate({ id: flag.id, by: "Cody Brantley" })
                          }
                          disabled={acknowledgeMutation.isPending}
                          className="shrink-0"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                          Acknowledge
                        </Button>
                      )}
                      <DeleteFlagBtn id={flag.id} label={flag.description || flag.flagType} />
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
