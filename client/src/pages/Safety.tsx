/**
 * Safety.tsx — OSHA Safety Incident Log
 *
 * Full-page incident management: report, update, close, filter.
 * Exports:
 *   default — full page (route /safety)
 *   SafetyPanel — embedded per-job panel
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertTriangle, Plus, CheckCircle2, Clock, Search,
  ShieldAlert, X, ChevronDown, ChevronUp, CalendarX2,
  Clipboard, User, Briefcase, HardHat, Trash2, Edit3,
  TriangleAlert
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SafetyIncident, Job } from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const INCIDENT_TYPES = [
  { value: "injury",          label: "Injury",           icon: "🩹" },
  { value: "near_miss",       label: "Near Miss",        icon: "⚠️" },
  { value: "property_damage", label: "Property Damage",  icon: "🏚️" },
  { value: "ppe_violation",   label: "PPE Violation",    icon: "🦺" },
  { value: "environmental",   label: "Environmental",    icon: "🌿" },
  { value: "other",           label: "Other",            icon: "📋" },
] as const;

const SEVERITY_CONFIG: Record<string, { label: string; className: string; dot: string }> = {
  low:      { label: "Low",      className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",      dot: "bg-gray-400" },
  medium:   { label: "Medium",   className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", dot: "bg-yellow-400" },
  high:     { label: "High",     className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400", dot: "bg-orange-500" },
  critical: { label: "Critical", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",       dot: "bg-red-600" },
};

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  open:          { label: "Open",          className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  investigating: { label: "Investigating", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  closed:        { label: "Closed",        className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function isOverdue(date: string | null | undefined): boolean {
  if (!date) return false;
  return new Date(date) < new Date();
}

function incidentTypeLabel(t: string) {
  return INCIDENT_TYPES.find(i => i.value === t)?.label || t;
}

// ─────────────────────────────────────────────────────────────────────────────
// Report Incident Dialog
// ─────────────────────────────────────────────────────────────────────────────
interface ReportDialogProps {
  open: boolean;
  onClose: () => void;
  jobs: Job[];
  defaultJobId?: number;
}

function ReportIncidentDialog({ open, onClose, jobs, defaultJobId }: ReportDialogProps) {
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    incidentType: "near_miss",
    severity: "medium",
    reportedBy: "Cody Brantley",
    incidentDate: today,
    jobId: defaultJobId ? String(defaultJobId) : "",
    description: "",
    personsInvolved: "",
    correctiveAction: "",
    oshaRecordable: false,
    followUpDate: "",
  });

  const set = (k: keyof typeof form, v: string | boolean) =>
    setForm(f => ({ ...f, [k]: v }));

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/safety-incidents", {
        incidentType: form.incidentType,
        severity: form.severity,
        reportedBy: form.reportedBy,
        incidentDate: form.incidentDate,
        jobId: form.jobId ? parseInt(form.jobId, 10) : null,
        description: form.description,
        personsInvolved: form.personsInvolved || null,
        correctiveAction: form.correctiveAction || null,
        oshaRecordable: form.oshaRecordable ? 1 : 0,
        followUpDate: form.followUpDate || null,
        status: "open",
        createdAt: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety-incidents"] });
      if (defaultJobId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/jobs", String(defaultJobId), "safety-incidents"],
        });
      }
      toast({ title: "✅ Safety incident reported" });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: "Error reporting incident",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const canSave = !!form.description && !!form.reportedBy && !!form.incidentDate;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-[hsl(var(--titan-red))]" />
            Report Safety Incident
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          {/* Incident Type */}
          <div>
            <Label className="text-xs">Incident Type *</Label>
            <Select value={form.incidentType} onValueChange={v => set("incidentType", v)}>
              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="safety-select-incident-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INCIDENT_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.icon} {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Severity */}
          <div>
            <Label className="text-xs">Severity *</Label>
            <Select value={form.severity} onValueChange={v => set("severity", v)}>
              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="safety-select-severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SEVERITY_CONFIG).map(([v, c]) => (
                  <SelectItem key={v} value={v}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reported By */}
          <div>
            <Label className="text-xs">Reported By *</Label>
            <Input
              className="mt-1 h-8 text-sm"
              value={form.reportedBy}
              onChange={e => set("reportedBy", e.target.value)}
              data-testid="safety-input-reported-by"
            />
          </div>

          {/* Incident Date */}
          <div>
            <Label className="text-xs">Incident Date *</Label>
            <Input
              type="date"
              className="mt-1 h-8 text-xs"
              value={form.incidentDate}
              onChange={e => set("incidentDate", e.target.value)}
              data-testid="safety-input-incident-date"
            />
          </div>

          {/* Job (optional) */}
          <div>
            <Label className="text-xs">Associated Job (optional)</Label>
            <Select
              value={form.jobId}
              onValueChange={v => set("jobId", v === "__none" ? "" : v)}
            >
              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="safety-select-job">
                <SelectValue placeholder="No job linked" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— No job —</SelectItem>
                {jobs.map(j => (
                  <SelectItem key={j.id} value={String(j.id)}>
                    #{j.jobNumber} · {j.address?.slice(0, 30) || "No address"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Follow-up date */}
          <div>
            <Label className="text-xs">Follow-Up Due Date</Label>
            <Input
              type="date"
              className="mt-1 h-8 text-xs"
              value={form.followUpDate}
              onChange={e => set("followUpDate", e.target.value)}
              data-testid="safety-input-followup-date"
            />
          </div>

          {/* Description */}
          <div className="col-span-2">
            <Label className="text-xs">Description *</Label>
            <Textarea
              className="mt-1 text-sm min-h-[80px]"
              value={form.description}
              onChange={e => set("description", e.target.value)}
              placeholder="Describe what happened, where, and under what conditions…"
              data-testid="safety-input-description"
            />
          </div>

          {/* Persons Involved */}
          <div className="col-span-2">
            <Label className="text-xs">Persons Involved</Label>
            <Textarea
              className="mt-1 text-sm min-h-[50px]"
              value={form.personsInvolved}
              onChange={e => set("personsInvolved", e.target.value)}
              placeholder="Names, roles of anyone involved or witnessing the incident…"
              data-testid="safety-input-persons-involved"
            />
          </div>

          {/* Corrective Action */}
          <div className="col-span-2">
            <Label className="text-xs">Corrective Action Taken / Planned</Label>
            <Textarea
              className="mt-1 text-sm min-h-[50px]"
              value={form.correctiveAction}
              onChange={e => set("correctiveAction", e.target.value)}
              placeholder="What immediate steps were taken? What is planned to prevent recurrence?"
              data-testid="safety-input-corrective-action"
            />
          </div>

          {/* OSHA Recordable */}
          <div className="col-span-2 flex items-center gap-2">
            <Checkbox
              id="osha-recordable"
              checked={form.oshaRecordable}
              onCheckedChange={v => set("oshaRecordable", !!v)}
              data-testid="safety-checkbox-osha"
            />
            <label htmlFor="osha-recordable" className="text-sm cursor-pointer">
              OSHA Recordable Incident
              <span className="text-xs text-muted-foreground ml-1.5">
                (required to log in OSHA 300 Log)
              </span>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="safety-dialog-cancel">
            Cancel
          </Button>
          <Button
            className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)] text-white"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !canSave}
            data-testid="safety-dialog-submit"
          >
            {createMutation.isPending ? "Reporting…" : "Report Incident"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Update / Close Incident Dialog
// ─────────────────────────────────────────────────────────────────────────────
interface UpdateDialogProps {
  incident: SafetyIncident;
  open: boolean;
  onClose: () => void;
}

function UpdateIncidentDialog({ incident, open, onClose }: UpdateDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    status: incident.status || "open",
    correctiveAction: incident.correctiveAction || "",
    followUpDate: incident.followUpDate || "",
    closedAt: incident.closedAt || "",
  });

  const setF = (k: keyof typeof form, v: string) =>
    setForm(f => ({ ...f, [k]: v }));

  const updateMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/safety-incidents/${incident.id}`, {
        status: form.status,
        correctiveAction: form.correctiveAction || null,
        followUpDate: form.followUpDate || null,
        closedAt: form.status === "closed"
          ? (form.closedAt || new Date().toISOString().slice(0, 10))
          : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety-incidents"] });
      if (incident.jobId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/jobs", String(incident.jobId), "safety-incidents"],
        });
      }
      toast({ title: "✅ Incident updated" });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: "Update failed",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const closeMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/safety-incidents/${incident.id}`, {
        status: "closed",
        closedAt: new Date().toISOString().slice(0, 10),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety-incidents"] });
      if (incident.jobId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/jobs", String(incident.jobId), "safety-incidents"],
        });
      }
      toast({ title: "✅ Incident closed" });
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Edit3 className="w-4 h-4" />
            Update Incident #{incident.id}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={v => setF("status", v)}>
              <SelectTrigger className="mt-1 h-8 text-xs" data-testid="update-select-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="investigating">Investigating</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Corrective Action</Label>
            <Textarea
              className="mt-1 text-sm min-h-[70px]"
              value={form.correctiveAction}
              onChange={e => setF("correctiveAction", e.target.value)}
              placeholder="Describe actions taken to address and prevent recurrence…"
              data-testid="update-input-corrective-action"
            />
          </div>

          <div>
            <Label className="text-xs">Follow-Up Due Date</Label>
            <Input
              type="date"
              className="mt-1 h-8 text-xs"
              value={form.followUpDate}
              onChange={e => setF("followUpDate", e.target.value)}
              data-testid="update-input-followup-date"
            />
          </div>

          {form.status === "closed" && (
            <div>
              <Label className="text-xs">Closed Date</Label>
              <Input
                type="date"
                className="mt-1 h-8 text-xs"
                value={form.closedAt || new Date().toISOString().slice(0, 10)}
                onChange={e => setF("closedAt", e.target.value)}
                data-testid="update-input-closed-at"
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} data-testid="update-dialog-cancel">
            Cancel
          </Button>
          {incident.status !== "closed" && (
            <Button
              variant="outline"
              className="border-green-500 text-green-700 hover:bg-green-50"
              onClick={() => closeMutation.mutate()}
              disabled={closeMutation.isPending}
              data-testid="update-dialog-close-incident"
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
              Close Incident
            </Button>
          )}
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            data-testid="update-dialog-save"
          >
            {updateMutation.isPending ? "Saving…" : "Save Update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Incident Card
// ─────────────────────────────────────────────────────────────────────────────
interface IncidentCardProps {
  incident: SafetyIncident;
  jobs: Job[];
  showJobLink?: boolean;
}

function IncidentCard({ incident, jobs, showJobLink = true }: IncidentCardProps) {
  const { toast } = useToast();
  const [updateOpen, setUpdateOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const sev = SEVERITY_CONFIG[incident.severity || "low"];
  const sta = STATUS_CONFIG[incident.status || "open"];
  const overdue = isOverdue(incident.followUpDate) && incident.status !== "closed";
  const linkedJob = showJobLink ? jobs.find(j => j.id === incident.jobId) : undefined;

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiRequest("DELETE", `/api/safety-incidents/${incident.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/safety-incidents"] });
      if (incident.jobId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/jobs", String(incident.jobId), "safety-incidents"],
        });
      }
      toast({ title: "Incident deleted" });
    },
  });

  return (
    <>
      <Card className={`border transition-shadow hover:shadow-sm ${incident.severity === "critical" ? "border-red-300 dark:border-red-800" : ""}`}>
        <CardContent className="p-4">
          {/* Header row */}
          <div className="flex items-start gap-2.5">
            <div
              className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${sev.dot}`}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Severity */}
                  <Badge className={`text-[10px] h-4 px-1.5 ${sev.className}`}>
                    {sev.label}
                  </Badge>
                  {/* OSHA recordable */}
                  {incident.oshaRecordable ? (
                    <Badge className="text-[10px] h-4 px-1.5 bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                      <TriangleAlert className="w-2.5 h-2.5 mr-0.5" />
                      OSHA Recordable
                    </Badge>
                  ) : null}
                  {/* Status */}
                  <Badge className={`text-[10px] h-4 px-1.5 ${sta.className}`}>
                    {sta.label}
                  </Badge>
                  {/* Type */}
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                    {incidentTypeLabel(incident.incidentType)}
                  </Badge>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => setUpdateOpen(true)}
                    data-testid={`incident-btn-update-${incident.id}`}
                  >
                    <Edit3 className="w-3 h-3 mr-1" />
                    Update
                  </Button>
                  {incident.status !== "closed" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-green-700 hover:text-green-800"
                      onClick={() =>
                        apiRequest("PATCH", `/api/safety-incidents/${incident.id}`, {
                          status: "closed",
                          closedAt: new Date().toISOString().slice(0, 10),
                        }).then(() => {
                          queryClient.invalidateQueries({ queryKey: ["/api/safety-incidents"] });
                          toast({ title: "Incident closed" });
                        })
                      }
                      data-testid={`incident-btn-close-${incident.id}`}
                    >
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Close
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (confirm("Delete this incident?")) deleteMutation.mutate();
                    }}
                    data-testid={`incident-btn-delete-${incident.id}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3" />
                  {incident.reportedBy}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {incident.incidentDate
                    ? new Date(incident.incidentDate).toLocaleDateString()
                    : "—"}
                </span>
                {linkedJob && (
                  <span className="flex items-center gap-1">
                    <Briefcase className="w-3 h-3" />
                    <span className="text-[hsl(var(--titan-blue))] font-medium">
                      Job #{linkedJob.jobNumber}
                    </span>
                    {linkedJob.address && (
                      <span>· {linkedJob.address.slice(0, 25)}{linkedJob.address.length > 25 ? "…" : ""}</span>
                    )}
                  </span>
                )}
                {incident.followUpDate && (
                  <span
                    className={`flex items-center gap-1 ${overdue ? "text-red-600 font-medium" : ""}`}
                  >
                    <CalendarX2 className="w-3 h-3" />
                    Follow-up: {new Date(incident.followUpDate).toLocaleDateString()}
                    {overdue && " (OVERDUE)"}
                  </span>
                )}
                {incident.closedAt && (
                  <span className="flex items-center gap-1 text-green-600">
                    <CheckCircle2 className="w-3 h-3" />
                    Closed {new Date(incident.closedAt).toLocaleDateString()}
                  </span>
                )}
              </div>

              {/* Description */}
              <p className="text-sm mt-2 line-clamp-2 text-foreground">
                {incident.description}
              </p>

              {/* Expand for corrective action / more */}
              {(incident.correctiveAction || incident.personsInvolved) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-0 text-xs mt-1 text-muted-foreground"
                  onClick={() => setExpanded(e => !e)}
                  data-testid={`incident-btn-expand-${incident.id}`}
                >
                  {expanded ? (
                    <><ChevronUp className="w-3 h-3 mr-1" />Less</>
                  ) : (
                    <><ChevronDown className="w-3 h-3 mr-1" />More details</>
                  )}
                </Button>
              )}

              {expanded && (
                <div className="mt-2 space-y-2 text-xs border-t pt-2">
                  {incident.personsInvolved && (
                    <div>
                      <p className="font-semibold text-muted-foreground">Persons Involved</p>
                      <p className="mt-0.5">{incident.personsInvolved}</p>
                    </div>
                  )}
                  {incident.correctiveAction && (
                    <div>
                      <p className="font-semibold text-muted-foreground">Corrective Action</p>
                      <p className="mt-0.5">{incident.correctiveAction}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {updateOpen && (
        <UpdateIncidentDialog
          incident={incident}
          open={updateOpen}
          onClose={() => setUpdateOpen(false)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary Cards
// ─────────────────────────────────────────────────────────────────────────────
function SummaryCards({ incidents }: { incidents: SafetyIncident[] }) {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const openCount = incidents.filter(i => i.status === "open" || i.status === "investigating").length;
  const oshaCount = incidents.filter(i => i.oshaRecordable).length;
  const highCritical = incidents.filter(i => i.severity === "high" || i.severity === "critical").length;
  const closedThisMonth = incidents.filter(
    i => i.status === "closed" && i.closedAt && i.closedAt >= thisMonthStart
  ).length;

  const cards = [
    {
      label: "Open Incidents",
      value: openCount,
      icon: <AlertTriangle className="w-4 h-4" />,
      color: "text-amber-600",
      bg: "bg-amber-50 dark:bg-amber-950/20",
      testId: "safety-card-open",
    },
    {
      label: "OSHA Recordable",
      value: oshaCount,
      icon: <ShieldAlert className="w-4 h-4" />,
      color: "text-red-600",
      bg: "bg-red-50 dark:bg-red-950/20",
      testId: "safety-card-osha",
    },
    {
      label: "High / Critical",
      value: highCritical,
      icon: <TriangleAlert className="w-4 h-4" />,
      color: "text-orange-600",
      bg: "bg-orange-50 dark:bg-orange-950/20",
      testId: "safety-card-high-critical",
    },
    {
      label: "Closed This Month",
      value: closedThisMonth,
      icon: <CheckCircle2 className="w-4 h-4" />,
      color: "text-green-600",
      bg: "bg-green-50 dark:bg-green-950/20",
      testId: "safety-card-closed-month",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map(c => (
        <div
          key={c.label}
          className={`border rounded-lg p-4 ${c.bg}`}
          data-testid={c.testId}
        >
          <div className={`flex items-center gap-2 ${c.color}`}>
            {c.icon}
            <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
          </div>
          <p className={`text-3xl font-bold mt-1 ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Incident list with filters
// ─────────────────────────────────────────────────────────────────────────────
interface IncidentListProps {
  incidents: SafetyIncident[];
  jobs: Job[];
  showJobLink?: boolean;
}

function IncidentList({ incidents, jobs, showJobLink = true }: IncidentListProps) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = incidents.filter(i => {
    if (typeFilter !== "all" && i.incidentType !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        i.description.toLowerCase().includes(q) ||
        (i.reportedBy || "").toLowerCase().includes(q) ||
        (i.correctiveAction || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Filter tabs + search */}
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
        <Tabs value={typeFilter} onValueChange={setTypeFilter} className="flex-1">
          <TabsList className="h-8 flex-wrap">
            <TabsTrigger value="all" className="text-xs h-7" data-testid="safety-filter-all">
              All
            </TabsTrigger>
            {INCIDENT_TYPES.map(t => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="text-xs h-7"
                data-testid={`safety-filter-${t.value}`}
              >
                {t.icon} {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-52">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-8 text-xs"
            placeholder="Search incidents…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="safety-search-input"
          />
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">
          <HardHat className="w-8 h-8 mx-auto mb-2 opacity-30" />
          {incidents.length === 0
            ? "No incidents reported. Keep up the safe work!"
            : "No incidents match the current filters."}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(inc => (
            <IncidentCard
              key={inc.id}
              incident={inc}
              jobs={jobs}
              showJobLink={showJobLink}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SafetyPanel — embedded per-job
// ─────────────────────────────────────────────────────────────────────────────
export function SafetyPanel({ jobId }: { jobId: number }) {
  const { toast } = useToast();
  const [reportOpen, setReportOpen] = useState(false);

  const { data: incidents = [], isLoading } = useQuery<SafetyIncident[]>({
    queryKey: ["/api/jobs", String(jobId), "safety-incidents"],
    queryFn: () =>
      apiRequest("GET", `/api/jobs/${jobId}/safety-incidents`).then(r => r.json()),
  });

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("GET", "/api/jobs").then(r => r.json()),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-[hsl(var(--titan-red))]" />
          Safety Incidents
          {incidents.length > 0 && (
            <Badge variant="secondary" className="text-xs">{incidents.length}</Badge>
          )}
        </h3>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => setReportOpen(true)}
          data-testid="safety-panel-report-btn"
        >
          <Plus className="w-3 h-3 mr-1" />
          Report Incident
        </Button>
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground py-4 text-center">
          Loading incidents…
        </div>
      ) : incidents.length === 0 ? (
        <div className="border border-dashed rounded-lg p-4 text-center text-xs text-muted-foreground">
          No safety incidents for this job.
        </div>
      ) : (
        <IncidentList incidents={incidents} jobs={jobs} showJobLink={false} />
      )}

      {reportOpen && (
        <ReportIncidentDialog
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          jobs={jobs}
          defaultJobId={jobId}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Full Page
// ─────────────────────────────────────────────────────────────────────────────
export default function Safety() {
  const [reportOpen, setReportOpen] = useState(false);

  const { data: incidents = [], isLoading: incidentsLoading } = useQuery<SafetyIncident[]>({
    queryKey: ["/api/safety-incidents"],
    queryFn: () => apiRequest("GET", "/api/safety-incidents").then(r => r.json()),
  });

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("GET", "/api/jobs").then(r => r.json()),
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-[hsl(var(--titan-red))]" />
            Safety Incident Log
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            OSHA compliance tracking · All incidents, investigations, and closures
          </p>
        </div>
        <Button
          className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)] text-white"
          onClick={() => setReportOpen(true)}
          data-testid="safety-page-report-btn"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Report Incident
        </Button>
      </div>

      {/* Summary cards */}
      {!incidentsLoading && <SummaryCards incidents={incidents} />}

      {/* Incident list */}
      {incidentsLoading ? (
        <div className="text-sm text-muted-foreground text-center py-12">
          Loading incidents…
        </div>
      ) : (
        <IncidentList incidents={incidents} jobs={jobs} showJobLink />
      )}

      {/* Report dialog */}
      {reportOpen && (
        <ReportIncidentDialog
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          jobs={jobs}
        />
      )}
    </div>
  );
}
