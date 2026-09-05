import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { format, isPast, parseISO } from "date-fns";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Mail,
  Plus,
  Send,
  SkipForward,
  Pencil,
  Clock,
  CheckCircle2,
  AlertCircle,
  ListChecks,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ────────────────────────────────────────────────────────────────────

type SequenceType = "post_job_30d" | "post_job_6mo" | "annual" | "custom";
type FollowUpStatus = "pending" | "sent" | "skipped";

interface FollowUp {
  id: number;
  jobId: number;
  jobNumber: string;
  address: string;
  sequenceType: SequenceType;
  status: FollowUpStatus;
  scheduledAt: string; // ISO date string
  emailSubject: string;
  emailBody: string;
  sentAt?: string | null;
  notes?: string | null;
}

interface Job {
  id: number;
  jobNumber: string;
  address: string;
  status: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SEQUENCE_LABELS: Record<SequenceType, string> = {
  post_job_30d: "30-Day Check-In",
  post_job_6mo: "6-Month Check-In",
  annual: "Annual Reminder",
  custom: "Custom",
};

const SEQUENCE_BADGE_CLASSES: Record<SequenceType, string> = {
  post_job_30d: "bg-blue-100 text-blue-800 border-blue-200",
  post_job_6mo: "bg-purple-100 text-purple-800 border-purple-200",
  annual: "bg-green-100 text-green-800 border-green-200",
  custom: "bg-orange-100 text-orange-800 border-orange-200",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOverdue(scheduledAt: string, status: FollowUpStatus): boolean {
  return status === "pending" && isPast(parseISO(scheduledAt));
}

function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), "MMM d, yyyy");
}

// ─── Edit Email Dialog ────────────────────────────────────────────────────────

interface EditEmailDialogProps {
  followUp: FollowUp;
  onClose: () => void;
  onSend: (subject: string, body: string) => void;
  isSending: boolean;
}

function EditEmailDialog({
  followUp,
  onClose,
  onSend,
  isSending,
}: EditEmailDialogProps) {
  const [subject, setSubject] = useState(followUp.emailSubject);
  const [body, setBody] = useState(followUp.emailBody);

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg" data-testid="edit-email-dialog">
        <DialogHeader>
          <DialogTitle>Edit & Send Email</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium">{followUp.jobNumber}</span>
            <span className="ml-2 text-muted-foreground">{followUp.address}</span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-subject">Subject</Label>
            <Input
              id="edit-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              data-testid="edit-email-subject"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-body">Email Body</Label>
            <Textarea
              id="edit-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              data-testid="edit-email-body"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="edit-cancel-btn">
            Cancel
          </Button>
          <Button
            onClick={() => onSend(subject, body)}
            disabled={isSending || !subject.trim()}
            data-testid="edit-send-btn"
          >
            <Send className="h-4 w-4 mr-1.5" />
            {isSending ? "Sending…" : "Mark as Sent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Schedule Follow-Ups Dialog ───────────────────────────────────────────────

interface ScheduleDialogProps {
  jobs: Job[];
  onClose: () => void;
  onSchedule: (jobId: number) => void;
  isScheduling: boolean;
}

function ScheduleFollowUpsDialog({
  jobs,
  onClose,
  onSchedule,
  isScheduling,
}: ScheduleDialogProps) {
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const completedJobs = jobs.filter((j) => j.status === "completed");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent data-testid="schedule-followups-dialog">
        <DialogHeader>
          <DialogTitle>Schedule Follow-Ups</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Select a completed job to auto-generate a 30-day, 6-month, and annual
            follow-up sequence.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="job-select">Completed Job</Label>
            <Select
              value={selectedJobId?.toString() ?? ""}
              onValueChange={(v) => setSelectedJobId(Number(v))}
            >
              <SelectTrigger id="job-select" data-testid="schedule-job-select">
                <SelectValue placeholder="Choose a job…" />
              </SelectTrigger>
              <SelectContent>
                {completedJobs.length === 0 && (
                  <SelectItem value="_none" disabled>
                    No completed jobs
                  </SelectItem>
                )}
                {completedJobs.map((j) => (
                  <SelectItem key={j.id} value={j.id.toString()}>
                    {j.jobNumber} — {j.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="schedule-cancel-btn">
            Cancel
          </Button>
          <Button
            disabled={!selectedJobId || isScheduling}
            onClick={() => selectedJobId && onSchedule(selectedJobId)}
            data-testid="schedule-confirm-btn"
          >
            <CalendarClock className="h-4 w-4 mr-1.5" />
            {isScheduling ? "Scheduling…" : "Schedule 3 Follow-Ups"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Custom Follow-Up Dialog ──────────────────────────────────────────────

interface AddCustomDialogProps {
  jobs: Job[];
  onClose: () => void;
  onAdd: (payload: {
    jobId: number;
    scheduledAt: string;
    emailSubject: string;
    emailBody: string;
    notes: string;
  }) => void;
  isAdding: boolean;
}

function AddCustomFollowUpDialog({
  jobs,
  onClose,
  onAdd,
  isAdding,
}: AddCustomDialogProps) {
  const [jobId, setJobId] = useState<number | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [notes, setNotes] = useState("");

  const valid = jobId && scheduledAt && emailSubject.trim();

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg" data-testid="add-custom-dialog">
        <DialogHeader>
          <DialogTitle>Add Custom Follow-Up</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Job</Label>
            <Select
              value={jobId?.toString() ?? ""}
              onValueChange={(v) => setJobId(Number(v))}
            >
              <SelectTrigger data-testid="custom-job-select">
                <SelectValue placeholder="Select job…" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id.toString()}>
                    {j.jobNumber} — {j.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="scheduled-at">Scheduled Date</Label>
            <Input
              id="scheduled-at"
              type="date"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              data-testid="custom-scheduled-at"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="custom-subject">Email Subject</Label>
            <Input
              id="custom-subject"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Subject line…"
              data-testid="custom-email-subject"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="custom-body">Email Body</Label>
            <Textarea
              id="custom-body"
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              rows={5}
              placeholder="Email content…"
              data-testid="custom-email-body"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="custom-notes">Notes (optional)</Label>
            <Input
              id="custom-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes…"
              data-testid="custom-notes"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="custom-cancel-btn">
            Cancel
          </Button>
          <Button
            disabled={!valid || isAdding}
            onClick={() =>
              jobId &&
              onAdd({ jobId, scheduledAt, emailSubject, emailBody, notes })
            }
            data-testid="custom-add-btn"
          >
            {isAdding ? "Adding…" : "Add Follow-Up"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Follow-Up Card ───────────────────────────────────────────────────────────

interface FollowUpCardProps {
  followUp: FollowUp;
  onMarkSent: (id: number, subject: string, body: string) => void;
  onSkip: (id: number) => void;
  isMutating: boolean;
}

function FollowUpCard({ followUp, onMarkSent, onSkip, isMutating }: FollowUpCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const overdue = isOverdue(followUp.scheduledAt, followUp.status);

  return (
    <>
      <Card
        className={`overflow-hidden transition-colors ${
          overdue ? "border-red-300" : ""
        }`}
        data-testid={`followup-card-${followUp.id}`}
      >
        <CardContent className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            {/* Left: meta */}
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="outline"
                  className={`text-xs ${SEQUENCE_BADGE_CLASSES[followUp.sequenceType]}`}
                  data-testid={`seq-badge-${followUp.id}`}
                >
                  {SEQUENCE_LABELS[followUp.sequenceType]}
                </Badge>

                <span className="font-semibold text-sm">{followUp.jobNumber}</span>
                <span
                  className={`text-xs font-medium flex items-center gap-1 ${
                    overdue ? "text-red-600" : "text-muted-foreground"
                  }`}
                >
                  {overdue ? (
                    <AlertCircle className="h-3 w-3" />
                  ) : (
                    <Clock className="h-3 w-3" />
                  )}
                  {overdue ? "Overdue – " : ""}
                  {formatDate(followUp.scheduledAt)}
                </span>
              </div>

              <p className="text-xs text-muted-foreground truncate max-w-xs">
                {followUp.address}
              </p>

              <p className="text-sm truncate max-w-sm">
                <Mail className="h-3 w-3 inline mr-1 text-muted-foreground" />
                {followUp.emailSubject}
              </p>
            </div>

            {/* Right: actions (only for pending) */}
            {followUp.status === "pending" && (
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1"
                  onClick={() => onMarkSent(followUp.id, followUp.emailSubject, followUp.emailBody)}
                  disabled={isMutating}
                  data-testid={`mark-sent-btn-${followUp.id}`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Mark Sent
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1"
                  onClick={() => setEditOpen(true)}
                  data-testid={`edit-email-btn-${followUp.id}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit Email
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs gap-1 text-muted-foreground"
                  onClick={() => onSkip(followUp.id)}
                  disabled={isMutating}
                  data-testid={`skip-btn-${followUp.id}`}
                >
                  <SkipForward className="h-3.5 w-3.5" />
                  Skip
                </Button>
              </div>
            )}

            {followUp.status === "sent" && (
              <Badge
                variant="outline"
                className="bg-green-50 text-green-700 border-green-200 text-xs"
              >
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Sent {followUp.sentAt ? formatDate(followUp.sentAt) : ""}
              </Badge>
            )}

            {followUp.status === "skipped" && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                <SkipForward className="h-3 w-3 mr-1" />
                Skipped
              </Badge>
            )}
          </div>

          {/* Expand/collapse body */}
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-6 px-1 text-xs gap-1 text-muted-foreground"
            onClick={() => setExpanded((v) => !v)}
            data-testid={`expand-body-btn-${followUp.id}`}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" /> Hide body
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> Show body
              </>
            )}
          </Button>

          {expanded && (
            <div className="mt-2 rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap text-muted-foreground">
              {followUp.emailBody || "(No body)"}
            </div>
          )}
        </CardContent>
      </Card>

      {editOpen && (
        <EditEmailDialog
          followUp={followUp}
          onClose={() => setEditOpen(false)}
          isSending={isMutating}
          onSend={(subject, body) => {
            onMarkSent(followUp.id, subject, body);
            setEditOpen(false);
          }}
        />
      )}
    </>
  );
}

// ─── Summary Strip ────────────────────────────────────────────────────────────

interface SummaryStripProps {
  followUps: FollowUp[];
}

function SummaryStrip({ followUps }: SummaryStripProps) {
  const dueThisWeek = followUps.filter((f) => {
    if (f.status !== "pending") return false;
    const d = parseISO(f.scheduledAt);
    const now = new Date();
    const weekOut = new Date(now);
    weekOut.setDate(weekOut.getDate() + 7);
    return d >= now && d <= weekOut;
  }).length;

  const overdue = followUps.filter(
    (f) => f.status === "pending" && isPast(parseISO(f.scheduledAt))
  ).length;

  const sent = followUps.filter((f) => f.status === "sent").length;
  const totalPending = followUps.filter((f) => f.status === "pending").length;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {[
        {
          label: "Due This Week",
          value: dueThisWeek,
          icon: <CalendarClock className="h-4 w-4" />,
          color: "text-blue-600",
        },
        {
          label: "Overdue",
          value: overdue,
          icon: <AlertCircle className="h-4 w-4" />,
          color: "text-red-600",
        },
        {
          label: "Sent",
          value: sent,
          icon: <CheckCircle2 className="h-4 w-4" />,
          color: "text-green-600",
        },
        {
          label: "Total Pending",
          value: totalPending,
          icon: <ListChecks className="h-4 w-4" />,
          color: "text-muted-foreground",
        },
      ].map(({ label, value, icon, color }) => (
        <Card key={label}>
          <CardContent className="flex items-center gap-3 p-4">
            <span className={color}>{icon}</span>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FollowUps() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("dueNow");
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [addCustomOpen, setAddCustomOpen] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: followUps = [], isLoading, isError } = useQuery<FollowUp[]>({
    queryKey: ["/api/follow-ups"],
    queryFn: () => apiRequest("GET", "/api/follow-ups").then((r) => r.json()),
  });

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("GET", "/api/jobs").then((r) => r.json()),
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const patchMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: Partial<FollowUp> & { status?: FollowUpStatus; sentAt?: string };
    }) =>
      apiRequest("PATCH", `/api/follow-ups/${id}`, payload).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/follow-ups"] });
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: (jobId: number) =>
      apiRequest("POST", `/api/jobs/${jobId}/schedule-follow-ups`).then((r) =>
        r.json()
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/follow-ups"] });
      setScheduleDialogOpen(false);
    },
  });

  const addCustomMutation = useMutation({
    mutationFn: (payload: {
      jobId: number;
      scheduledAt: string;
      emailSubject: string;
      emailBody: string;
      notes: string;
    }) => apiRequest("POST", "/api/follow-ups", payload).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/follow-ups"] });
      setAddCustomOpen(false);
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function handleMarkSent(id: number, subject: string, body: string) {
    patchMutation.mutate({
      id,
      payload: {
        status: "sent",
        sentAt: new Date().toISOString(),
        emailSubject: subject,
        emailBody: body,
      },
    });
  }

  function handleSkip(id: number) {
    patchMutation.mutate({ id, payload: { status: "skipped" } });
  }

  // ── Filtered lists ────────────────────────────────────────────────────────────

  // Collapsed from four tabs (pending / overdue / sent / all) to three
  // (dueNow / sent / all). The old "pending" vs "overdue" split forced people
  // to click twice to see everything they had to work today — the whole point
  // of the page. We keep the counts as chips inside the Due Now tab so you
  // still see the overdue number at a glance, but they act as one worklist.
  const pendingList = followUps.filter(
    (f) => f.status === "pending" && !isOverdue(f.scheduledAt, f.status)
  );
  const overdueList = followUps.filter((f) => isOverdue(f.scheduledAt, f.status));
  const filtered = {
    dueNow: [...overdueList, ...pendingList],
    sent: followUps.filter((f) => f.status === "sent"),
    all: followUps,
  } as const;

  const tabList = filtered[activeTab as keyof typeof filtered] ?? [];

  // ── Bulk-select state ─────────────────────────────────────────────────────
  // Selection is scoped to the currently visible tab — switching tabs clears
  // it so you can't accidentally bulk-send items you can't see.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  useEffect(() => { setSelectedIds(new Set()); }, [activeTab]);
  const visibleIds = tabList.map((f) => f.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const toggleOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const bulkMarkSent = () => {
    const now = new Date().toISOString();
    selectedIds.forEach((id) => {
      const fu = followUps.find((f) => f.id === id);
      if (!fu || fu.status === "sent") return;
      patchMutation.mutate({
        id,
        payload: {
          status: "sent",
          sentAt: now,
          emailSubject: fu.emailSubject || null,
          emailBody: fu.emailBody || null,
          notes: fu.notes || null,
        },
      });
    });
    setSelectedIds(new Set());
  };
  const bulkSkip = () => {
    selectedIds.forEach((id) => patchMutation.mutate({ id, payload: { status: "skipped" } }));
    setSelectedIds(new Set());
  };

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Follow-Up Sequences</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automated post-job outreach to past customers
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScheduleDialogOpen(true)}
            data-testid="schedule-followups-btn"
          >
            <CalendarClock className="h-4 w-4 mr-1.5" />
            Schedule Follow-Ups
          </Button>
          <Button
            size="sm"
            onClick={() => setAddCustomOpen(true)}
            data-testid="add-custom-btn"
            style={{ background: "hsl(var(--titan-red))" }}
            className="text-white hover:opacity-90"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Custom Follow-Up
          </Button>
        </div>
      </div>

      {/* Summary */}
      {!isLoading && <SummaryStrip followUps={followUps} />}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="h-24 p-4">
                <div className="space-y-2">
                  <div className="h-4 w-1/3 rounded bg-muted" />
                  <div className="h-3 w-1/2 rounded bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <Card className="border-destructive">
          <CardContent className="p-6 text-center text-sm text-destructive">
            Failed to load follow-ups. Please try again.
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      {!isLoading && !isError && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList data-testid="followup-tabs">
            <TabsTrigger value="dueNow" data-testid="tab-due-now">
              Due Now
              {filtered.dueNow.length > 0 && (
                <span className="ml-1.5 rounded-full bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5">
                  {filtered.dueNow.length}
                </span>
              )}
              {overdueList.length > 0 && (
                <span className="ml-1 rounded-full bg-red-100 text-red-700 text-[10px] px-1.5 py-0.5" title={`${overdueList.length} overdue`}>
                  {overdueList.length} late
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="sent" data-testid="tab-sent">
              Sent
            </TabsTrigger>
            <TabsTrigger value="all" data-testid="tab-all">
              All
            </TabsTrigger>
          </TabsList>

          {/* Bulk action bar — only appears when at least one row is selected.
              Sticky so long lists don't lose it above the fold. */}
          {selectedIds.size > 0 && (
            <div
              className="mt-3 sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50/95 backdrop-blur px-3 py-2"
              data-testid="bulk-action-bar"
            >
              <span className="text-sm font-medium text-blue-900">{selectedIds.size} selected</span>
              <div className="ml-auto flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>Clear</Button>
                <Button size="sm" variant="outline" onClick={bulkSkip} disabled={patchMutation.isPending} data-testid="bulk-skip">Skip</Button>
                <Button size="sm" onClick={bulkMarkSent} disabled={patchMutation.isPending} data-testid="bulk-mark-sent">Mark sent</Button>
              </div>
            </div>
          )}

          {(["dueNow", "sent", "all"] as const).map((tab) => (
            <TabsContent key={tab} value={tab} className="space-y-3 mt-4">
              {tabList.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Mail className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      No follow-ups in this category.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Select-all header for this tab. Hidden on Sent since bulk
                      actions there are meaningless. */}
                  {tab !== "sent" && (
                    <div className="flex items-center gap-2 px-1 pb-1 text-xs text-muted-foreground">
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={toggleAllVisible}
                        data-testid="bulk-select-all"
                      />
                      <span>Select all in this view</span>
                    </div>
                  )}
                  {tabList.map((fu) => (
                    <div key={fu.id} className="flex items-start gap-2">
                      {tab !== "sent" && (
                        <div className="pt-4 pl-1">
                          <Checkbox
                            checked={selectedIds.has(fu.id)}
                            onCheckedChange={() => toggleOne(fu.id)}
                            data-testid={`select-followup-${fu.id}`}
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <FollowUpCard
                          followUp={fu}
                          onMarkSent={handleMarkSent}
                          onSkip={handleSkip}
                          isMutating={patchMutation.isPending}
                        />
                      </div>
                    </div>
                  ))}
                </>
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* Schedule dialog */}
      {scheduleDialogOpen && (
        <ScheduleFollowUpsDialog
          jobs={jobs}
          onClose={() => setScheduleDialogOpen(false)}
          onSchedule={(jobId) => scheduleMutation.mutate(jobId)}
          isScheduling={scheduleMutation.isPending}
        />
      )}

      {/* Add custom dialog */}
      {addCustomOpen && (
        <AddCustomFollowUpDialog
          jobs={jobs}
          onClose={() => setAddCustomOpen(false)}
          onAdd={(payload) => addCustomMutation.mutate(payload)}
          isAdding={addCustomMutation.isPending}
        />
      )}
    </div>
  );
}
