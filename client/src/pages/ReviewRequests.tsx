import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Star, Send, CheckCircle, Clock, ExternalLink, Plus } from "lucide-react";

const GOOGLE_REVIEW_URL = "https://g.page/r/CbTitanRestorationAugusta/review";

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-yellow-100 text-yellow-800" },
  sent: { label: "Sent", color: "bg-blue-100 text-blue-800" },
  clicked: { label: "Clicked", color: "bg-purple-100 text-purple-800" },
  reviewed: { label: "Reviewed ⭐", color: "bg-green-100 text-green-800" },
  skipped: { label: "Skipped", color: "bg-gray-100 text-gray-600" },
};

export default function ReviewRequests() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewText, setPreviewText] = useState("");

  const { data: requests = [] } = useQuery<any[]>({ queryKey: ["/api/review-requests"] });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });
  const { data: contacts = [] } = useQuery<any[]>({ queryKey: ["/api/contacts"] });

  const sendMutation = useMutation({
    mutationFn: async ({ jobId }: { jobId: number }) => {
      const job = (jobs as any[]).find(j => j.id === jobId);
      const contact = (contacts as any[]).find(c => c.id === job?.contactId);
      return apiRequest("POST", "/api/review-requests", {
        jobId,
        contactId: job?.contactId,
        channel: "email",
        status: "sent",
        sentAt: new Date().toISOString(),
        reviewUrl: GOOGLE_REVIEW_URL,
      });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/review-requests"] }); setOpen(false); toast({ title: "Review request sent" }); },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: any) => apiRequest("PATCH", `/api/review-requests/${id}`, { status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/review-requests"] }); },
  });

  const completedJobs = (jobs as any[]).filter((j: any) => j.status === "complete");
  const sentJobIds = new Set((requests as any[]).map((r: any) => r.jobId));

  const stats = {
    total: (requests as any[]).length,
    sent: (requests as any[]).filter((r: any) => r.status !== "pending").length,
    reviewed: (requests as any[]).filter((r: any) => r.status === "reviewed").length,
  };
  const convRate = stats.sent > 0 ? Math.round((stats.reviewed / stats.sent) * 100) : 0;

  const getPreview = (jobId: string) => {
    const job = (jobs as any[]).find(j => j.id === Number(jobId));
    const contact = (contacts as any[]).find(c => c.id === job?.contactId);
    return `Subject: How did we do? — Titan Restoration LLC

Hi ${contact?.name || "Valued Customer"},

Thank you for choosing Titan Restoration LLC for your ${job?.lossType || "restoration"} project at ${job?.address || "your property"}.

We'd love to hear how we did! A quick Google review helps other families in the Augusta area find trusted restoration professionals when they need help most.

⭐ Leave a Review: ${GOOGLE_REVIEW_URL}

It takes less than 60 seconds and means the world to our team.

Thank you again,
Cody Brantley
Titan Restoration LLC
706-922-0154
titanrestorationllc.com`;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Review Requests</h1>
          <p className="text-sm text-muted-foreground">Automated Google review outreach after job completion</p>
        </div>
        <Button className="bg-primary text-primary-foreground" onClick={() => setOpen(true)} data-testid="button-send-review">
          <Plus className="w-4 h-4 mr-2" /> Send Review Request
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Sent</p>
          <p className="text-xl font-bold text-foreground">{stats.sent}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Reviews Received</p>
          <p className="text-xl font-bold text-green-600">{stats.reviewed}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Conversion Rate</p>
          <p className="text-xl font-bold text-foreground">{convRate}%</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Pending (unsent)</p>
          <p className="text-xl font-bold text-yellow-600">{completedJobs.filter(j => !sentJobIds.has(j.id)).length}</p>
        </CardContent></Card>
      </div>

      {/* Unsent completed jobs alert */}
      {completedJobs.filter(j => !sentJobIds.has(j.id)).length > 0 && (
        <Card className="border-yellow-400 bg-yellow-50 dark:bg-yellow-950">
          <CardContent className="p-4">
            <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
              {completedJobs.filter(j => !sentJobIds.has(j.id)).length} completed jobs haven't received a review request yet
            </p>
            <div className="space-y-2">
              {completedJobs.filter(j => !sentJobIds.has(j.id)).map((j: any) => {
                const contact = (contacts as any[]).find(c => c.id === j.contactId);
                return (
                  <div key={j.id} className="flex items-center justify-between bg-white dark:bg-yellow-900 rounded px-3 py-2">
                    <div><p className="text-sm font-medium">{j.jobNumber}</p><p className="text-xs text-muted-foreground">{contact?.name} · {j.address}</p></div>
                    <Button size="sm" onClick={() => sendMutation.mutate({ jobId: j.id })} disabled={sendMutation.isPending}>
                      <Send className="w-3.5 h-3.5 mr-1" /> Send
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Request history */}
      {(requests as any[]).length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No review requests yet. Send your first request after completing a job.</CardContent></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-3 font-medium">Job</th>
                <th className="text-left px-4 py-3 font-medium">Contact</th>
                <th className="text-left px-4 py-3 font-medium">Sent</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3"></th>
              </tr></thead>
              <tbody>
                {(requests as any[]).map((r: any) => {
                  const job = (jobs as any[]).find(j => j.id === r.jobId);
                  const contact = (contacts as any[]).find(c => c.id === r.contactId);
                  const meta = STATUS_META[r.status] || STATUS_META.pending;
                  return (
                    <tr key={r.id} className="border-b hover:bg-muted/20" data-testid={`row-review-${r.id}`}>
                      <td className="px-4 py-3 font-medium">{job?.jobNumber || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{contact?.name || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{r.sentAt ? new Date(r.sentAt).toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${meta.color}`}>{meta.label}</span></td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          {r.status === "sent" && (
                            <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: r.id, status: "reviewed" })}>
                              <Star className="w-3.5 h-3.5 mr-1 fill-yellow-400 text-yellow-400" /> Mark Reviewed
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => { setPreviewText(getPreview(String(r.jobId))); setPreviewOpen(true); }}>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Send dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Send Review Request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Select Completed Job</Label>
              <Select value={selectedJob} onValueChange={setSelectedJob}>
                <SelectTrigger data-testid="select-review-job"><SelectValue placeholder="Choose job" /></SelectTrigger>
                <SelectContent>
                  {(jobs as any[]).map((j: any) => { const c = (contacts as any[]).find(x => x.id === j.contactId); return <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber} — {c?.name || j.address}</SelectItem>; })}
                </SelectContent>
              </Select>
            </div>
            {selectedJob && (
              <div className="bg-muted rounded p-3 text-xs whitespace-pre-wrap font-mono">{getPreview(selectedJob).slice(0, 300)}...</div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => sendMutation.mutate({ jobId: Number(selectedJob) })} disabled={sendMutation.isPending || !selectedJob} data-testid="button-confirm-send">
                <Send className="w-4 h-4 mr-2" /> Send Request
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Email Preview</DialogTitle></DialogHeader>
          <pre className="text-xs whitespace-pre-wrap bg-muted rounded p-4 max-h-96 overflow-y-auto">{previewText}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
