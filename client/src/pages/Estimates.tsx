import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { Plus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Estimate, Job } from "@shared/schema";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600", sent: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800", rejected: "bg-red-100 text-red-800",
};

export default function Estimates() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ jobId: "", title: "", status: "draft" });

  const { data: estimates = [], isLoading } = useQuery<Estimate[]>({ queryKey: ["/api/estimates"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/estimates", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/estimates"] }); setOpen(false); },
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
                <Select value={form.jobId} onValueChange={v => setForm(f => ({ ...f, jobId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select job" /></SelectTrigger>
                  <SelectContent>
                    {jobs.map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber} — {j.lossType}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Title</Label>
                <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Water Mitigation Estimate" />
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
              <Link key={est.id} href={`/estimates/${est.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer" data-testid={`estimate-card-${est.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <p className="font-semibold text-sm">{est.title}</p>
                          <p className="text-xs text-muted-foreground">{job?.jobNumber || `Job #${est.jobId}`}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-[hsl(var(--titan-blue))]">${(est.total || 0).toLocaleString()}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[est.status]}`}>{est.status}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
          {estimates.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No estimates yet.</p>}
        </div>
      )}
    </div>
  );
}
