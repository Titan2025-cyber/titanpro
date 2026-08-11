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
import { Star, Send, ExternalLink, Plus, Trash2, MousePointerClick, MessageSquare, ThumbsUp, ShieldAlert } from "lucide-react";
import { fmtDateShort } from "@/lib/dates";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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

  // Rating capture dialog state
  const [rateOpen, setRateOpen] = useState(false);
  const [rateRequest, setRateRequest] = useState<any>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");

  const { data: requests = [] } = useQuery<any[]>({ queryKey: ["/api/review-requests"] });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });
  const { data: contacts = [] } = useQuery<any[]>({ queryKey: ["/api/contacts"] });
  const { data: feedback = [] } = useQuery<any[]>({ queryKey: ["/api/review-feedback"] });

  const sendMutation = useMutation({
    mutationFn: async ({ jobId }: { jobId: number }) => {
      const job = (jobs as any[]).find(j => j.id === jobId);
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

  const sendAllMutation = useMutation({
    mutationFn: async (jobIds: number[]) => {
      for (const jobId of jobIds) {
        const job = (jobs as any[]).find(j => j.id === jobId);
        await apiRequest("POST", "/api/review-requests", {
          jobId,
          contactId: job?.contactId,
          channel: "email",
          status: "sent",
          sentAt: new Date().toISOString(),
          reviewUrl: GOOGLE_REVIEW_URL,
        });
      }
    },
    onSuccess: (_d, jobIds) => { queryClient.invalidateQueries({ queryKey: ["/api/review-requests"] }); toast({ title: `Sent ${jobIds.length} review requests` }); },
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: any) => apiRequest("PATCH", `/api/review-requests/${id}`, { status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/review-requests"] }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/review-requests/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/review-requests"] }); toast({ title: "Review request deleted" }); },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const feedbackMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/review-feedback", payload),
    onSuccess: (_d, payload: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/review-feedback"] });
      queryClient.invalidateQueries({ queryKey: ["/api/review-requests"] });
      setRateOpen(false);
      if (payload.rating >= 4) {
        toast({ title: "Routed to Google", description: "Happy customer sent to your public review page." });
      } else {
        toast({ title: "Routed to private feedback", description: "Captured internally — not published publicly." });
      }
    },
  });

  const completedJobs = (jobs as any[]).filter((j: any) => j.status === "complete");
  const sentJobIds = new Set((requests as any[]).map((r: any) => r.jobId));
  const unsentJobs = completedJobs.filter(j => !sentJobIds.has(j.id));

  // Funnel counts
  const sentCount = (requests as any[]).filter((r: any) => r.status !== "pending").length;
  const clickedCount = (requests as any[]).filter((r: any) => r.status === "clicked" || r.status === "reviewed").length;
  const reviewedCount = (requests as any[]).filter((r: any) => r.status === "reviewed").length;
  const convRate = sentCount > 0 ? Math.round((reviewedCount / sentCount) * 100) : 0;

  const privateFeedback = (feedback as any[]).filter((f: any) => f.routed === "private");

  const openRate = (r: any) => { setRateRequest(r); setRating(0); setComment(""); setRateOpen(true); };

  const submitRating = () => {
    if (!rateRequest || rating === 0) return;
    feedbackMutation.mutate({
      requestId: rateRequest.id,
      jobId: rateRequest.jobId,
      contactId: rateRequest.contactId,
      rating,
      comment: rating >= 4 ? null : comment,
    });
  };

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

  const funnelStages = [
    { label: "Sent", value: sentCount, icon: Send },
    { label: "Clicked", value: clickedCount, icon: MousePointerClick },
    { label: "Reviewed", value: reviewedCount, icon: Star },
  ];
  const funnelMax = Math.max(sentCount, 1);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <span className="tp-page-eyebrow">Reputation</span>
          <h1 className="text-2xl font-bold tracking-tight tp-gradient-text">Review Engine</h1>
          <p className="text-sm text-muted-foreground">Closed-loop Google review outreach — send, track clicks, and route ratings.</p>
        </div>
        <Button className="bg-primary text-primary-foreground" onClick={() => setOpen(true)} data-testid="button-send-review">
          <Plus className="w-4 h-4 mr-2" /> Send Review Request
        </Button>
      </div>
      <hr className="tp-rule" />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Total Sent</p>
          <p className="text-xl font-bold text-foreground" data-testid="stat-sent">{sentCount}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Reviews Received</p>
          <p className="text-xl font-bold text-green-600" data-testid="stat-reviewed">{reviewedCount}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Conversion Rate</p>
          <p className="text-xl font-bold text-foreground" data-testid="stat-conversion">{convRate}%</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Ready to request</p>
          <p className="text-xl font-bold text-yellow-600" data-testid="stat-unsent">{unsentJobs.length}</p>
        </CardContent></Card>
      </div>

      {/* Funnel widget */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Review Funnel</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {funnelStages.map((s) => {
            const pct = Math.round((s.value / funnelMax) * 100);
            const Icon = s.icon;
            return (
              <div key={s.label} data-testid={`funnel-${s.label.toLowerCase()}`}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="flex items-center gap-1.5 font-medium"><Icon className="w-3.5 h-3.5" />{s.label}</span>
                  <span className="text-muted-foreground">{s.value}</span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: "linear-gradient(90deg, hsl(var(--titan-red)), hsl(var(--titan-blue)))" }} />
                </div>
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground pt-1">Sent → Clicked → Reviewed · {convRate}% converted to a public review.</p>
        </CardContent>
      </Card>

      {/* Unsent completed jobs alert */}
      {unsentJobs.length > 0 && (
        <Card className="border-yellow-400 bg-yellow-50 dark:bg-yellow-950">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">
                {unsentJobs.length} completed job{unsentJobs.length !== 1 ? "s" : ""} haven't received a review request yet
              </p>
              <Button size="sm" onClick={() => sendAllMutation.mutate(unsentJobs.map(j => j.id))} disabled={sendAllMutation.isPending} data-testid="button-send-all">
                <Send className="w-3.5 h-3.5 mr-1" /> Send all
              </Button>
            </div>
            <div className="space-y-2">
              {unsentJobs.map((j: any) => {
                const contact = (contacts as any[]).find(c => c.id === j.contactId);
                return (
                  <div key={j.id} className="flex items-center justify-between bg-white dark:bg-yellow-900 rounded px-3 py-2">
                    <div><p className="text-sm font-medium">{j.jobNumber}</p><p className="text-xs text-muted-foreground">{contact?.name} · {j.address}</p></div>
                    <Button size="sm" onClick={() => sendMutation.mutate({ jobId: j.id })} disabled={sendMutation.isPending} data-testid={`button-send-${j.id}`}>
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
                      <td className="px-4 py-3 text-muted-foreground text-xs">{r.sentAt ? fmtDateShort(r.sentAt) : "—"}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${meta.color}`}>{meta.label}</span></td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          {r.status === "sent" && (
                            <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: r.id, status: "clicked" })} data-testid={`button-clicked-${r.id}`}>
                              <MousePointerClick className="w-3.5 h-3.5 mr-1" /> Mark clicked
                            </Button>
                          )}
                          {(r.status === "sent" || r.status === "clicked") && (
                            <Button size="sm" variant="outline" onClick={() => openRate(r)} data-testid={`button-rate-${r.id}`}>
                              <Star className="w-3.5 h-3.5 mr-1 text-yellow-500" /> Simulate rating
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => { setPreviewText(getPreview(String(r.jobId))); setPreviewOpen(true); }} data-testid={`button-preview-${r.id}`}>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="ghost" data-testid={`button-delete-review-requests-${r.id}`}>
                                <Trash2 className="w-3.5 h-3.5 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete this review request?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {job?.jobNumber ? `"${job.jobNumber}" ` : ""}This permanently removes the record and cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteMutation.mutate(r.id)} data-testid={`button-confirm-delete-review-requests-${r.id}`}>
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
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

      {/* Private feedback captured */}
      {privateFeedback.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-500" />Private Feedback ({privateFeedback.length})</CardTitle>
            <p className="text-xs text-muted-foreground">Low ratings routed internally — resolve before they become a public review.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {privateFeedback.map((f: any) => {
              const job = (jobs as any[]).find(j => j.id === f.jobId);
              const contact = (contacts as any[]).find(c => c.id === f.contactId);
              return (
                <div key={f.id} className="p-3 rounded-lg border bg-muted/20" data-testid={`private-feedback-${f.id}`}>
                  <div className="flex items-center gap-2 text-xs mb-1">
                    <span className="font-semibold">{contact?.name || "Customer"}</span>
                    <span className="text-muted-foreground">{job?.jobNumber}</span>
                    <span className="text-yellow-500">{"★".repeat(f.rating)}{"☆".repeat(5 - f.rating)}</span>
                  </div>
                  {f.comment && <p className="text-xs text-muted-foreground">{f.comment}</p>}
                </div>
              );
            })}
          </CardContent>
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

      {/* Rating capture dialog */}
      <Dialog open={rateOpen} onOpenChange={setRateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Simulate Customer Rating</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">4–5 stars route to your public Google page. 1–3 stars are captured privately so you can make it right first.</p>
            <div className="flex items-center justify-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRating(n)} data-testid={`star-${n}`} className="transition-transform hover:scale-110">
                  <Star className={`w-8 h-8 ${n <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                </button>
              ))}
            </div>
            {rating > 0 && rating >= 4 && (
              <div className="flex items-center gap-2 text-sm text-green-600 justify-center"><ThumbsUp className="w-4 h-4" /> Will route to Google (public)</div>
            )}
            {rating > 0 && rating < 4 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-amber-600 justify-center"><MessageSquare className="w-4 h-4" /> Will route to private feedback</div>
                <Textarea placeholder="What went wrong? (captured internally)" value={comment} onChange={(e) => setComment(e.target.value)} data-testid="input-feedback-comment" />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRateOpen(false)}>Cancel</Button>
              <Button onClick={submitRating} disabled={rating === 0 || feedbackMutation.isPending} data-testid="button-submit-rating">Submit rating</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
