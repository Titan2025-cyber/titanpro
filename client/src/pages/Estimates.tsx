import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Plus, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import type { Estimate, Job, Contact } from "@shared/schema";
import JobCombobox from "@/components/JobCombobox";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600", sent: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800", rejected: "bg-red-100 text-red-800",
};

export default function Estimates() {
  // Auto-open the New Estimate dialog when we arrived from a Job page
  // (which passes ?jobId= in the URL). Saves the user a click.
  const _initialAuto = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("jobId");
  const [open, setOpen] = useState(!!_initialAuto);
  // Phase defaults to mitigation — matches the Job page filter's default.
  // Pre-fills jobId and phase from ?jobId= and ?phase= query params so the
  // "New Estimate" button on a Job screen carries context through.
  const initialParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const [form, setForm] = useState({
    jobId: initialParams.get("jobId") || "",
    title: "",
    status: "draft",
    phase: initialParams.get("phase") || "mitigation",
  });

  const { data: estimates = [], isLoading } = useQuery<Estimate[]>({ queryKey: ["/api/estimates"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });

  const { toast } = useToast();
  const { user } = useAuth();
  const canDelete = !!user && (["owner", "admin", "general_manager"] as string[]).includes(user.role);

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/estimates", data),
    onSuccess: () => {
      // Refresh every consumer of estimate data:
      //   • /api/estimates              — global list on this page
      //   • /api/jobs/:id/estimates     — per-job Estimates tab on JobDetail
      //   • /api/jobs/financials       — Financial Summary card totals
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      setOpen(false);
    },
    onError: (e: any) => toast({
      title: "Create failed",
      description: e?.message || "Estimate could not be created. Check your role and try again.",
      variant: "destructive",
    }),
  });

  // Inline row-level delete on the Estimates list. Confirms before firing.
  const deleteMutation = useMutation({
    mutationFn: (estId: number) => apiRequest("DELETE", `/api/estimates/${estId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs/financials"] });
      toast({ title: "Estimate deleted" });
    },
    onError: (e: any) => toast({
      title: "Delete failed",
      description: e?.message || "Estimate could not be deleted.",
      variant: "destructive",
    }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Estimates</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white">
              <Plus className="w-4 h-4 mr-2" />New Estimate
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Estimate</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Job</Label>
                <JobCombobox
                  jobs={jobs}
                  contacts={contacts}
                  value={form.jobId}
                  onChange={(v) => setForm(f => ({ ...f, jobId: v }))}
                  placeholder="Search jobs by number, address, customer…"
                  data-testid="select-estimate-job"
                />
              </div>
              <div>
                <Label>Title</Label>
                <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Water Mitigation Estimate" />
              </div>
              <div>
                <Label>Phase</Label>
                <Select value={form.phase} onValueChange={v => setForm(f => ({ ...f, phase: v }))}>
                  <SelectTrigger data-testid="select-estimate-phase"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mitigation">Mitigation</SelectItem>
                    <SelectItem value="reconstruction">Reconstruction</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  The Job page shows Mitigation and Reconstruction estimates separately — pick the phase you want this estimate to appear under.
                </p>
              </div>
              <Button
                className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
                disabled={createMutation.isPending || !form.jobId || !form.title}
                onClick={() => createMutation.mutate({ ...form, jobId: Number(form.jobId), lineItems: "[]", subtotal: 0, total: 0 })}
              >
                {createMutation.isPending ? "Creating…" : "Create Estimate"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : (
        <div className="space-y-2">
          {estimates.map(est => {
            const job = jobs.find(j => j.id === est.jobId);
            return (
              <Card key={est.id} className="hover:shadow-md transition-shadow" data-testid={`estimate-card-${est.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={`/estimates/${est.id}`} className="flex-1 flex items-center gap-3 cursor-pointer min-w-0">
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{est.title}</p>
                        <p className="text-xs text-muted-foreground">{job?.jobNumber || `Job #${est.jobId}`}</p>
                      </div>
                    </Link>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-[hsl(var(--titan-blue))]">${(est.total || 0).toLocaleString()}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[est.status]}`}>{est.status}</span>
                    </div>
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10 shrink-0"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (window.confirm(`Delete estimate "${est.title}"? This cannot be undone.`)) {
                            deleteMutation.mutate(est.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-estimate-${est.id}`}
                        title="Delete estimate"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {estimates.length === 0 && (
            <div className="col-span-full rounded-lg border border-dashed border-border/60 bg-card/40 px-6 py-16 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <FileText className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-foreground">No estimates yet</h3>
              <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                Estimates pull from your Line Item Library and can be sent to customers for approval and turned into invoices.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <Button size="sm" onClick={() => setOpen(true)} className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white">
                  <Plus className="w-4 h-4 mr-1" /> Create your first estimate
                </Button>
                <Link href="/line-items">
                  <Button size="sm" variant="outline">Review price list</Button>
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
