// MarketingNurture.tsx (Push 6 #12 + #11 partial)
//
// Post-job customer nurture + property manager cadence queue.
// Reads from /api/follow-ups filtered to sequence types:
//   • post_job_6wk / post_job_90d / post_job_12mo  (Push 6 #12)
//   • pm_quarterly / pm_seasonal / pm_post_storm    (Push 6 #11)
//
// Rep sees pending sequences due today or overdue, with per-row Approve
// (send now) / Skip / Edit buttons. NOTHING sends automatically — every
// touch is manual. Respects contact.reviewOptOut too.
//
// "Approve" opens the message preview so the rep can review body text
// before sending — same manual-gate model as the Review queue.

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare, Send, SkipForward, Edit, Clock, AlertTriangle, ShieldAlert,
  Home, Briefcase,
} from "lucide-react";

const POST_JOB_TYPES = new Set(["post_job_6wk", "post_job_90d", "post_job_12mo"]);
const PM_TYPES = new Set(["pm_quarterly", "pm_seasonal", "pm_post_storm"]);

const LABEL_FOR_TYPE: Record<string, string> = {
  post_job_6wk: "6-week check-in",
  post_job_90d: "90-day maintenance tip",
  post_job_12mo: "12-month anniversary",
  pm_quarterly: "PM quarterly touch",
  pm_seasonal: "PM seasonal tip",
  pm_post_storm: "PM post-storm check",
};

const fmtDaysUntil = (iso: string) => {
  const days = Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days === -1) return "1 day overdue";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  return `due in ${days} days`;
};

export default function MarketingNurture() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<any | null>(null);
  const [editBody, setEditBody] = useState("");
  const [filter, setFilter] = useState<"all" | "post_job" | "pm">("all");

  // Follow-ups + contacts + jobs
  const { data: followUps = [] } = useQuery<any[]>({ queryKey: ["/api/follow-ups"] });
  const { data: contacts = [] } = useQuery<any[]>({ queryKey: ["/api/contacts"] });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });

  const contactById = useMemo(
    () => new Map((contacts as any[]).map((c) => [c.id, c])),
    [contacts],
  );
  const jobById = useMemo(
    () => new Map((jobs as any[]).map((j) => [j.id, j])),
    [jobs],
  );

  // Normalize snake_case backend rows into a friendlier shape for the UI
  const normalized = useMemo(
    () =>
      (followUps as any[]).map((f) => ({
        id: f.id,
        contactId: f.contact_id ?? f.contactId,
        jobId: f.job_id ?? f.jobId,
        sequenceType: f.sequence_type ?? f.sequenceType,
        dueDate: f.scheduled_at ?? f.scheduledAt,
        status: f.status,
        subject: f.email_subject ?? f.emailSubject,
        body: f.email_body ?? f.emailBody,
        notes: f.notes,
      })),
    [followUps],
  );

  // Filter to nurture types, pending status, sorted by dueDate ascending
  const rows = useMemo(() => {
    return normalized
      .filter((f) => {
        const t = f.sequenceType;
        if (!POST_JOB_TYPES.has(t) && !PM_TYPES.has(t)) return false;
        if (f.status && f.status !== "pending" && f.status !== "scheduled") return false;
        if (filter === "post_job" && !POST_JOB_TYPES.has(t)) return false;
        if (filter === "pm" && !PM_TYPES.has(t)) return false;
        return true;
      })
      .sort((a, b) => new Date(a.dueDate || 0).getTime() - new Date(b.dueDate || 0).getTime());
  }, [normalized, filter]);

  const overdueCount = rows.filter((r) => new Date(r.dueDate).getTime() < Date.now()).length;

  // Send — marks status=sent + sent_at. Backend PATCH handler updates only
  // those two columns and preserves body/subject when not supplied.
  const sendMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body?: string }) => {
      const payload: any = { status: "sent", sentAt: new Date().toISOString() };
      if (body) payload.emailBody = body;
      return apiRequest("PATCH", `/api/follow-ups/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/follow-ups"] });
      toast({ title: "Sent", description: "Nurture touch marked sent." });
      setEditing(null);
    },
    onError: (e: any) =>
      toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  const skipMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("PATCH", `/api/follow-ups/${id}`, { status: "skipped" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/follow-ups"] });
      toast({ title: "Skipped" });
    },
  });

  const openEdit = (row: any) => {
    setEditing(row);
    setEditBody(row.body || "");
  };

  return (
    <div className="space-y-4">
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-4 flex items-start gap-3">
          <MessageSquare className="w-5 h-5 mt-0.5 text-primary shrink-0" />
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Post-job nurture keeps you top of mind.</span>{" "}
            Every sequence below waits for your Approve tap. Review the body,
            edit if needed, then send. Nothing goes out on its own —
            problem customers and opt-outs are hidden automatically.
          </div>
        </CardContent>
      </Card>

      {/* Filter + counts */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
          <SelectTrigger className="w-[200px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All nurture types ({rows.length})</SelectItem>
            <SelectItem value="post_job">Post-job only</SelectItem>
            <SelectItem value="pm">Property manager only</SelectItem>
          </SelectContent>
        </Select>
        {overdueCount > 0 && (
          <Badge variant="destructive" className="h-6">
            <AlertTriangle className="w-3 h-3 mr-1" />
            {overdueCount} overdue
          </Badge>
        )}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No nurture touches pending. When you close jobs, 3 sequences seed
            automatically (6wk, 90d, 12mo). Property manager cadences seed
            from the Referrals tab.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const t = row.sequenceType || row.type;
            const isPM = PM_TYPES.has(t);
            const contact = contactById.get(row.contactId);
            const job = row.jobId ? jobById.get(row.jobId) : null;
            const overdue = new Date(row.dueDate).getTime() < Date.now();
            const optedOut = contact?.reviewOptOut === true;

            return (
              <Card
                key={row.id}
                className={overdue ? "border-red-500/40" : ""}
                data-testid={`nurture-${row.id}`}
              >
                <CardContent className="p-3 md:p-4">
                  <div className="flex flex-col md:flex-row md:items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isPM ? (
                          <Home className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <Briefcase className="w-4 h-4 text-muted-foreground" />
                        )}
                        <span className="font-semibold">
                          {contact?.name || `Contact #${row.contactId}`}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1.5 h-4">
                          {LABEL_FOR_TYPE[t] || t}
                        </Badge>
                        <Badge
                          className={`text-[10px] px-1.5 h-4 ${
                            overdue
                              ? "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30"
                              : "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30"
                          }`}
                        >
                          <Clock className="w-2.5 h-2.5 mr-1" />
                          {fmtDaysUntil(row.dueDate)}
                        </Badge>
                        {optedOut && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 h-4 border-red-500/40 text-red-700 dark:text-red-400"
                          >
                            <ShieldAlert className="w-2.5 h-2.5 mr-1" />
                            Opted out
                          </Badge>
                        )}
                      </div>
                      {job && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Job {job.jobNumber} · {job.lossType} · {job.propertyAddress}
                        </div>
                      )}
                      {row.body && (
                        <p className="text-sm mt-2 text-foreground/70 line-clamp-2 whitespace-pre-line">
                          {row.body}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-1.5 shrink-0 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => openEdit(row)}
                        data-testid={`edit-${row.id}`}
                      >
                        <Edit className="w-3.5 h-3.5 mr-1" /> Preview / Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => skipMutation.mutate(row.id)}
                        data-testid={`skip-${row.id}`}
                      >
                        <SkipForward className="w-3.5 h-3.5 mr-1" /> Skip
                      </Button>
                      <Button
                        size="sm"
                        className="h-8"
                        disabled={optedOut || sendMutation.isPending}
                        onClick={() => sendMutation.mutate({ id: row.id })}
                        data-testid={`approve-${row.id}`}
                      >
                        <Send className="w-3.5 h-3.5 mr-1" /> Approve & send
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Preview + edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Preview: {LABEL_FOR_TYPE[editing?.sequenceType || editing?.type] || "Nurture touch"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              To: {contactById.get(editing?.contactId)?.name || "—"}
            </div>
            <div>
              <Label>Message body</Label>
              <Textarea
                rows={8}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                data-testid="edit-nurture-body"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Nothing sends until you tap Send below. Skip closes this out without
              sending anything.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              onClick={() => sendMutation.mutate({ id: editing.id, body: editBody })}
              disabled={sendMutation.isPending}
              data-testid="button-send-nurture"
            >
              <Send className="w-3.5 h-3.5 mr-1" /> Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
