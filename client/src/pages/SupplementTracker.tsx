import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Copy, Plus, Clock, AlertTriangle, CheckCircle2, Send, FileText, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtDateShort } from "@/lib/dates";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface SupplementTracker {
  id: number; jobId: number; carrier: string; claimNumber: string;
  state: string; submittedAt: string; deadlineDays: number; deadlineDate: string;
  status: string; respondedAt: string; approvedAmount: number; followUpSentAt: string;
  notes: string;
}
interface Job { id: number; jobNumber: string; address: string; insuranceCarrier?: string; }

const STATE_STATUTE = { GA: "O.C.G.A. § 33-24-46 (15 working days)", SC: "S.C. Code § 38-59-20 (15 working days)" };

function daysRemaining(deadlineDate: string) {
  const diff = Math.ceil((new Date(deadlineDate).getTime() - Date.now()) / 86400000);
  return diff;
}

export default function SupplementTracker() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [letterText, setLetterText] = useState("");
  const [showLetter, setShowLetter] = useState(false);
  const [form, setForm] = useState({ jobId: "", carrier: "", claimNumber: "", state: "GA", submittedAt: new Date().toISOString().split("T")[0] });

  const { data: trackers = [], isLoading } = useQuery<SupplementTracker[]>({
    queryKey: ["/api/supplement-tracker"],
    queryFn: () => apiRequest("/api/supplement-tracker").then(r => r.json()),
  });

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/supplement-tracker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/supplement-tracker"] }); setOpen(false); toast({ title: "Supplement Tracked" }); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/supplement-tracker/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/supplement-tracker"] }),
  });

  const followUpMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/supplement-tracker/${id}/followup`, { method: "POST" }).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplement-tracker"] });
      setLetterText(data.letter);
      setShowLetter(true);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/supplement-tracker/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/supplement-tracker"] });
      toast({ title: "Supplement deleted" });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const overdue = trackers.filter(t => t.status === "pending" && daysRemaining(t.deadlineDate) < 0);
  const dueSoon = trackers.filter(t => t.status === "pending" && daysRemaining(t.deadlineDate) >= 0 && daysRemaining(t.deadlineDate) <= 5);
  const pending = trackers.filter(t => t.status === "pending");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Clock className="w-7 h-7 text-orange-500" />
          <div>
            <h1 className="text-xl font-bold">Prompt-Pay Supplement Tracker</h1>
            <p className="text-sm text-muted-foreground">Track carrier response deadlines — GA & SC statute enforcement</p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-red-600 hover:bg-red-700 text-white" data-testid="button-add-supplement"><Plus className="w-4 h-4 mr-2" />Track Supplement</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Track New Supplement Submission</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label>Job</Label>
                <Select onValueChange={v => { const j = jobs.find(j => String(j.id) === v); setForm(f => ({ ...f, jobId: v, carrier: j?.insuranceCarrier || "" })); }}>
                  <SelectTrigger><SelectValue placeholder="Select job..." /></SelectTrigger>
                  <SelectContent>{jobs.map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber} — {j.address?.split(",")[0]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Carrier</Label><Input value={form.carrier} onChange={e => setForm(f => ({ ...f, carrier: e.target.value }))} placeholder="State Farm" /></div>
                <div><Label>Claim #</Label><Input value={form.claimNumber} onChange={e => setForm(f => ({ ...f, claimNumber: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>State</Label>
                  <Select value={form.state} onValueChange={v => setForm(f => ({ ...f, state: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="GA">Georgia</SelectItem><SelectItem value="SC">South Carolina</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>Date Submitted</Label><Input type="date" value={form.submittedAt} onChange={e => setForm(f => ({ ...f, submittedAt: e.target.value }))} /></div>
              </div>
              <p className="text-xs text-muted-foreground">Statute: {STATE_STATUTE[form.state as "GA" | "SC"]}</p>
              <Button onClick={() => createMutation.mutate(form)} disabled={!form.carrier || createMutation.isPending} className="w-full bg-red-600 hover:bg-red-700 text-white">
                Start Tracking
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Alerts */}
      {overdue.length > 0 && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-red-700 dark:text-red-400">{overdue.length} Supplement{overdue.length > 1 ? "s" : ""} Overdue</p>
            <p className="text-sm text-red-600 dark:text-red-300">Carrier has exceeded the statutory response window. Send follow-up letters now.</p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Pending</p><p className="text-2xl font-bold text-orange-600">{pending.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Overdue</p><p className="text-2xl font-bold text-red-600">{overdue.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Due ≤ 5 Days</p><p className="text-2xl font-bold text-yellow-600">{dueSoon.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Closed</p><p className="text-2xl font-bold text-green-600">{trackers.filter(t => t.status === "closed").length}</p></CardContent></Card>
      </div>

      {/* Tracker Table */}
      <Card>
        <CardHeader><CardTitle className="text-base">All Supplements</CardTitle></CardHeader>
        <CardContent className="p-0">
          {trackers.length === 0 ? (
            <p className="text-center text-muted-foreground p-8">No supplements tracked yet. Click "Track Supplement" to add one.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-medium">Job / Carrier</th>
                  <th className="text-left px-4 py-2.5 font-medium">State</th>
                  <th className="text-left px-4 py-2.5 font-medium">Submitted</th>
                  <th className="text-left px-4 py-2.5 font-medium">Deadline</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Actions</th>
                </tr></thead>
                <tbody>
                  {trackers.map(t => {
                    const job = jobs.find(j => j.id === t.jobId);
                    const days = daysRemaining(t.deadlineDate);
                    const isOverdue = t.status === "pending" && days < 0;
                    const isDueSoon = t.status === "pending" && days >= 0 && days <= 5;
                    return (
                      <tr key={t.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="px-4 py-3">
                          <p className="font-medium">{job?.jobNumber || `Job #${t.jobId}`}</p>
                          <p className="text-xs text-muted-foreground">{t.carrier} {t.claimNumber && `· ${t.claimNumber}`}</p>
                        </td>
                        <td className="px-4 py-3"><span className="font-mono text-xs">{t.state}</span></td>
                        <td className="px-4 py-3 text-muted-foreground">{fmtDateShort(t.submittedAt)}</td>
                        <td className="px-4 py-3">
                          <p className={isOverdue ? "text-red-600 font-bold" : isDueSoon ? "text-yellow-600 font-medium" : ""}>
                            {fmtDateShort(t.deadlineDate)}
                          </p>
                          {t.status === "pending" && (
                            <p className="text-xs text-muted-foreground">
                              {isOverdue ? `${Math.abs(days)}d overdue` : `${days}d remaining`}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            t.status === "pending" && isOverdue ? "bg-red-100 text-red-700" :
                            t.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                            t.status === "responded" ? "bg-blue-100 text-blue-700" :
                            t.status === "closed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"
                          }`}>{t.status}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            {t.status === "pending" && (
                              <Button size="sm" variant="outline" className="text-xs" onClick={() => followUpMutation.mutate(t.id)} disabled={followUpMutation.isPending}>
                                <Send className="w-3 h-3 mr-1" />Follow-Up Letter
                              </Button>
                            )}
                            {t.status === "pending" && (
                              <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: t.id, data: { status: "responded", respondedAt: new Date().toISOString() } })}>
                                <CheckCircle2 className="w-3 h-3 mr-1" />Responded
                              </Button>
                            )}
                            {t.status === "responded" && (
                              <Button size="sm" variant="outline" className="text-xs" onClick={() => updateMutation.mutate({ id: t.id, data: { status: "closed" } })}>Close</Button>
                            )}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="ghost" className="text-xs" data-testid={`button-delete-supplement-tracker-${t.id}`}>
                                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete this supplement record?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t.carrier ? `"${t.carrier}" ` : ""}This permanently removes the record and cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteMutation.mutate(t.id)} data-testid={`button-confirm-delete-supplement-tracker-${t.id}`}>
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
          )}
        </CardContent>
      </Card>

      {/* Follow-up Letter Dialog */}
      {showLetter && (
        <Dialog open={showLetter} onOpenChange={setShowLetter}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Follow-Up Letter — Overdue Supplement</DialogTitle></DialogHeader>
            <Textarea value={letterText} onChange={e => setLetterText(e.target.value)} className="font-mono text-xs min-h-80" />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { navigator.clipboard.writeText(letterText); toast({ title: "Copied" }); }}><Copy className="w-3.5 h-3.5 mr-1" />Copy</Button>
              <Button onClick={() => setShowLetter(false)}>Done</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
