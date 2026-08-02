import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Lock, RotateCcw, Search, ExternalLink, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import type { Job } from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Closed Jobs page — only owner/admin can reach and act here. Closed jobs are
// intentionally hidden from every other view, KPI, and report; this page is the
// single portal to review or reopen them.
// ─────────────────────────────────────────────────────────────────────────────

export default function ClosedJobs() {
  const { toast } = useToast();
  const { employee } = useAuth();
  const canAct = employee?.role === "owner" || employee?.role === "admin";

  const { data: jobs = [], isLoading } = useQuery<Job[]>({
    queryKey: ["/api/jobs/closed"],
    // Fresh on every visit — this list changes as owners close/reopen.
    staleTime: 0,
  });

  const [q, setQ] = useState("");
  const [reopenTarget, setReopenTarget] = useState<Job | null>(null);

  const reopenMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/jobs/${id}/reopen`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/closed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      toast({ title: "Job reopened", description: "Back in dashboards and reports." });
      setReopenTarget(null);
    },
    onError: (e: any) =>
      toast({
        title: "Could not reopen job",
        description: e?.message || "Server rejected the request.",
        variant: "destructive",
      }),
  });

  const filtered = jobs.filter((j) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return (
      (j.jobNumber || "").toLowerCase().includes(needle) ||
      (j.address || "").toLowerCase().includes(needle) ||
      ((j as any).closedBy || "").toLowerCase().includes(needle) ||
      ((j as any).closedReason || "").toLowerCase().includes(needle)
    );
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/jobs">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Jobs
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Lock className="w-5 h-5 text-muted-foreground" /> Closed Jobs
          </h1>
          <p className="text-sm text-muted-foreground">
            Hidden from dashboards, KPIs, reports, and technicians. Reopen to bring one back.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">
              {jobs.length} closed {jobs.length === 1 ? "job" : "jobs"}
            </CardTitle>
            <div className="relative ml-auto w-72">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Search job #, address, closer, reason…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading closed jobs…</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {jobs.length === 0
                ? "No closed jobs yet. Any job you close from the job page will appear here."
                : "No closed jobs match your search."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Job #</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead className="w-32">Prev status</TableHead>
                  <TableHead className="w-36">Closed</TableHead>
                  <TableHead className="w-36">Closed by</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((j) => (
                  <TableRow key={j.id} className="text-sm">
                    <TableCell className="font-medium">
                      <Link href={`/jobs/${j.id}`}>
                        <a className="hover:underline flex items-center gap-1">
                          {j.jobNumber || `#${j.id}`}
                          <ExternalLink className="w-3 h-3 opacity-60" />
                        </a>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-xs">
                      {j.address || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize font-normal">
                        {(j as any).previousStatus || "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {(j as any).closedAt
                        ? new Date((j as any).closedAt).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {(j as any).closedBy || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-md">
                      {(j as any).closedReason || <span className="italic opacity-60">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {canAct && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => setReopenTarget(j)}
                          data-testid={`btn-reopen-${j.id}`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Reopen
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!reopenTarget} onOpenChange={(o) => !o && setReopenTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Reopen {reopenTarget?.jobNumber || `#${reopenTarget?.id}`}?
            </DialogTitle>
            <DialogDescription>
              Restores to{" "}
              <span className="font-semibold">
                {(reopenTarget as any)?.previousStatus || "mitigation"}
              </span>{" "}
              and brings the job back into dashboards, KPIs, reports, and technician views.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReopenTarget(null)}
              disabled={reopenMut.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => reopenTarget && reopenMut.mutate(reopenTarget.id)}
              disabled={reopenMut.isPending}
              className="gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              {reopenMut.isPending ? "Reopening…" : "Reopen job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
