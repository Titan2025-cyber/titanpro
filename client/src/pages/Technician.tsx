import { useQuery, useMutation } from "@tanstack/react-query";
import { UserSelect } from "@/components/UserSelect";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Phone, MapPin, FileText, ChevronDown, ChevronUp, CheckCircle2, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NotifyPicker } from "@/components/NotifyPicker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import DryingRecords from "@/components/DryingRecords";
import JobPhotos from "@/components/JobPhotos";
import type { Job, Contact } from "@shared/schema";
import { fmtDateShort } from "@/lib/dates";


const LOSS_ICONS: Record<string, string> = {
  water: "💧", fire: "🔥", mold: "🍄", storm: "⛈️", biohazard: "☣️", reconstruction: "🏗️"
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-800", mitigation: "bg-yellow-100 text-yellow-800",
  drying: "bg-orange-100 text-orange-800", reconstruction: "bg-purple-100 text-purple-800",
  complete: "bg-green-100 text-green-800", closed: "bg-gray-100 text-gray-600",
};

interface MilestoneDates {
  mitigationStart?: string;
  dryOutComplete?: string;
  reconstructionStart?: string;
  jobComplete?: string;
}

function JobCard({ job, contacts }: { job: Job; contacts: Contact[] }) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteTag, setNoteTag] = useState("");
  const [noteNotify, setNoteNotify] = useState<number[]>([]);
  // Author defaults to the signed-in user's real name so the audit trail
  // shows who actually typed the note, not a generic 'Tech'. Field stays
  // editable in case a tech is logging something on someone else's behalf.
  const [noteAuthor, setNoteAuthor] = useState(user?.name || "Tech");
  const [milestones, setMilestones] = useState<MilestoneDates>({
    mitigationStart: job.mitigationStart || "",
    dryOutComplete: job.dryOutComplete || "",
    reconstructionStart: job.reconstructionStart || "",
    jobComplete: job.jobComplete || "",
  });
  const [statusVal, setStatusVal] = useState(job.status);

  const contact = contacts.find(c => c.id === job.contactId);

  const addNote = useMutation({
    // Canonical field is 'body' (server expected 'body' — the old 'text'
    // payload was silently rejected as 'body is required' and the note never
    // saved). Also mark tech-entered notes as public so the whole crew sees
    // them, and invalidate the per-job notes query so JobDetail refreshes.
    // Notes default to STAFF-ONLY on mobile too. The Add Note surface here
    // is one-tap by design (no toggle) — techs writing job notes almost
    // never mean 'share with homeowner'. If a note needs to be public, use
    // the desktop JobDetail composer where the toggle is exposed.
    mutationFn: () => apiRequest("POST", `/api/jobs/${job.id}/notes`, { body: noteText, author: noteAuthor, tag: noteTag, isPublic: false, notify: noteNotify }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", job.id, "notes"] });
      setNoteText(""); setNoteTag(""); setNoteNotify([]);
    },
  });

  const saveMilestones = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/jobs/${job.id}`, milestones),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/jobs"] }),
  });

  const updateStatus = useMutation({
    mutationFn: (s: string) => apiRequest("PATCH", `/api/jobs/${job.id}`, { status: s }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/jobs"] }),
  });

  const appleMapUrl = job.address
    ? `https://maps.apple.com/?daddr=${encodeURIComponent(job.address)}`
    : null;

  // Fetch shared notes from the job_notes table so every crew member sees
  // everything, not just whatever legacy JSON blob is still in job.notes.
  // Fall back to the legacy blob if the API returns nothing (early jobs).
  const { data: apiNotes = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs", job.id, "notes"],
    queryFn: () => apiRequest("GET", `/api/jobs/${job.id}/notes`).then(r => r.json()),
    enabled: expanded,
  });
  const legacyNotes = (() => {
    try { return JSON.parse(job.notes || "[]") as any[]; } catch { return []; }
  })();
  const notes = apiNotes.length > 0
    ? apiNotes.map(n => ({ id: n.id, author: n.author, tag: n.tag, createdAt: n.createdAt, text: n.body }))
    : legacyNotes;

  return (
    <Card className="overflow-hidden" data-testid={`tech-job-${job.id}`}>
      <CardContent className="p-0">
        {/* Header */}
        <div
          className="flex items-start gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
          onClick={() => setExpanded(e => !e)}
        >
          <div className="text-2xl pt-0.5">{LOSS_ICONS[job.lossType] || "📋"}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-base">{job.jobNumber}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[statusVal]}`}>{statusVal}</span>
            </div>
            {contact && <p className="text-sm font-medium text-foreground mt-0.5">{contact.name}</p>}
            {job.address && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{job.address}</p>
            )}
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0 mt-1" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />}
        </div>

        {/* Expanded content */}
        {expanded && (
          <div className="border-t space-y-4 p-4">
            {/* Quick actions */}
            <div className="flex gap-2">
              {contact?.phone && (
                <a href={`tel:${contact.phone}`} className="flex-1" data-testid={`call-${job.id}`}>
                  <Button className="w-full bg-green-600 hover:bg-green-700 text-white">
                    <Phone className="w-4 h-4 mr-2" />Call {contact.name?.split(" ")[0]}
                  </Button>
                </a>
              )}
              {appleMapUrl && (
                <a href={appleMapUrl} target="_blank" rel="noopener" className="flex-1" data-testid={`directions-${job.id}`}>
                  <Button className="w-full bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white">
                    <MapPin className="w-4 h-4 mr-2" />Directions
                  </Button>
                </a>
              )}
            </div>

            {/* Status Update */}
            <div>
              <Label className="text-xs">Update Status</Label>
              <Select value={statusVal} onValueChange={v => { setStatusVal(v); updateStatus.mutate(v); }}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["new","mitigation","drying","reconstruction","complete"].map(s => (
                    <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Milestone Dates */}
            <div>
              <Label className="text-xs">Milestone Dates</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {[
                  { label: "Mitigation Start", key: "mitigationStart" as const },
                  { label: "Dry-Out Complete", key: "dryOutComplete" as const },
                  { label: "Recon Start", key: "reconstructionStart" as const },
                  { label: "Job Complete", key: "jobComplete" as const },
                ].map(m => (
                  <div key={m.key}>
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <Input
                      type="date"
                      className="h-8 text-xs"
                      value={milestones[m.key] ? milestones[m.key]!.slice(0,10) : ""}
                      onChange={e => setMilestones(prev => ({ ...prev, [m.key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => saveMilestones.mutate()} disabled={saveMilestones.isPending}>
                <CheckCircle2 className="w-3 h-3 mr-1" />{saveMilestones.isPending ? "Saving…" : "Save Dates"}
              </Button>
            </div>

            {/* Past Notes */}
            {notes.length > 0 && (
              <div>
                <Label className="text-xs">Previous Notes</Label>
                <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
                  {notes.map((n: any) => (
                    <div key={n.id} className="p-2 bg-muted rounded text-xs">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className="font-semibold">{n.author}</span>
                        {n.tag && <span className="text-[hsl(var(--titan-blue))]">@{n.tag}</span>}
                        <span className="text-muted-foreground ml-auto">{n.createdAt ? fmtDateShort(n.createdAt) : ""}</span>
                      </div>
                      <p>{n.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add Note */}
            <div>
              <Label className="text-xs">Add Note</Label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">Your name</p>
                  <UserSelect
                    value={noteAuthor}
                    onChange={setNoteAuthor}
                    placeholder="Select"
                    className="h-8 text-xs"
                    testId="select-note-author"
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tag @member</p>
                  <UserSelect
                    value={noteTag}
                    onChange={setNoteTag}
                    placeholder="None"
                    allowUnassigned
                    unassignedLabel="None"
                    className="h-8 text-xs"
                    testId="select-note-tag"
                  />
                </div>
              </div>
              <Textarea
                className="mt-2 text-sm min-h-[80px]"
                placeholder="Enter note…"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                data-testid={`note-input-${job.id}`}
              />
              <div className="mt-2">
                <NotifyPicker
                  selectedIds={noteNotify}
                  onChange={setNoteNotify}
                  excludeName={noteAuthor}
                  compact
                />
              </div>
              <Button
                size="sm"
                className="mt-2 w-full bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
                disabled={!noteText.trim() || addNote.isPending}
                onClick={() => addNote.mutate()}
                data-testid={`note-submit-${job.id}`}
              >
                <FileText className="w-3 h-3 mr-1" />{addNote.isPending ? "Saving…" : "Submit Note"}
              </Button>
            </div>

            {/* Photos — directly in job file */}
            <div className="border-t pt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Job Photos</p>
              <JobPhotos jobId={job.id} />
            </div>

            {/* Drying Records — IICRC S500 Mitigation Log */}
            <div className="border-t pt-4">
              <DryingRecords jobId={job.id} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Technician() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");

  const { data: jobs = [], isLoading } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });

  const filtered = jobs.filter(j => {
    const q = search.toLowerCase();
    const matchSearch = !q || j.jobNumber.toLowerCase().includes(q) || (j.address || "").toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || (statusFilter === "active" ? (j.status !== "closed" && j.status !== "complete") : j.status === statusFilter);
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-bold">Technician View</h1>
        <p className="text-sm text-muted-foreground">Mobile-optimized job access · Call · Directions · Notes</p>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search jobs…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active Jobs</SelectItem>
            <SelectItem value="all">All Jobs</SelectItem>
            {["new","mitigation","drying","reconstruction","complete"].map(s => (
              <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{filtered.length} job(s)</span>
        <a href="tel:7069220154" className="flex items-center gap-1 text-[hsl(var(--titan-red))] font-medium">
          <Phone className="w-3 h-3" />Office: 706-922-0154
        </a>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : (
        <div className="space-y-3">
          {filtered.map(job => <JobCard key={job.id} job={job} contacts={contacts} />)}
          {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No jobs found.</p>}
        </div>
      )}
    </div>
  );
}
