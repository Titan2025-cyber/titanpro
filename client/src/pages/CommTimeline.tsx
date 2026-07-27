import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { Plus, Mail, MessageSquare, Phone, FileText, Users, Tag, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const TAG_COLORS: Record<string, string> = {
  supplement: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  payment: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  scheduling: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  status_update: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  insurance: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  other: "bg-muted text-muted-foreground",
};

const CHANNEL_ICON: Record<string, any> = {
  email: Mail, sms: MessageSquare, call: Phone, internal: Users, note: FileText,
};

export default function CommTimeline() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [filterTag, setFilterTag] = useState("all");
  const [filterChannel, setFilterChannel] = useState("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ jobId: "", contactId: "", channel: "email", direction: "inbound", from: "", to: "", subject: "", body: "" });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ jobId: "", contactId: "", channel: "email", direction: "inbound", from: "", to: "", subject: "", body: "" });

  const { data: entries = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/comm-timeline"], queryFn: () => apiRequest("/api/comm-timeline").then(r => r.json()) });

  const addEntry = useMutation({
    mutationFn: (data: any) => apiRequest("/api/comm-timeline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/comm-timeline"] }); setShowAdd(false); setForm({ jobId: "", contactId: "", channel: "email", direction: "inbound", from: "", to: "", subject: "", body: "" }); },
  });
  const deleteEntry = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/comm-timeline/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/comm-timeline"] }),
  });

  const updateEntry = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/comm-timeline/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/comm-timeline"] });
      setEditingId(null);
      toast({ title: "Entry updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const openEdit = (entry: any) => {
    setEditForm({
      jobId: entry.job_id != null ? String(entry.job_id) : "",
      contactId: entry.contact_id != null ? String(entry.contact_id) : "",
      channel: entry.channel || "email",
      direction: entry.direction || "inbound",
      from: entry.from || "",
      to: entry.to || "",
      subject: entry.subject || "",
      body: entry.body || "",
    });
    setEditingId(entry.id);
  };

  const filtered = entries.filter((e: any) => {
    if (filterTag !== "all" && e.ai_tag !== filterTag) return false;
    if (filterChannel !== "all" && e.channel !== filterChannel) return false;
    if (search) { const s = search.toLowerCase(); return (e.body || "").toLowerCase().includes(s) || (e.subject || "").toLowerCase().includes(s) || (e.from || "").toLowerCase().includes(s); }
    return true;
  });

  const tagCounts = entries.reduce((acc: Record<string, number>, e: any) => { acc[e.ai_tag || "other"] = (acc[e.ai_tag || "other"] || 0) + 1; return acc; }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Unified Communications Timeline</h1>
          <p className="text-sm text-muted-foreground">Every call, email, text, and note — AI-tagged and searchable in one place</p>
        </div>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white" data-testid="button-add-comm"><Plus className="w-4 h-4 mr-2" />Log Communication</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Log Communication</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Select value={form.channel} onValueChange={v => setForm(f => ({ ...f, channel: v }))}>
                  <SelectTrigger data-testid="select-channel"><SelectValue placeholder="Channel" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS/Text</SelectItem>
                    <SelectItem value="call">Phone Call</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                    <SelectItem value="note">Note</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={form.direction} onValueChange={v => setForm(f => ({ ...f, direction: v }))}>
                  <SelectTrigger data-testid="select-direction"><SelectValue placeholder="Direction" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inbound">Inbound</SelectItem>
                    <SelectItem value="outbound">Outbound</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Job ID (optional)" value={form.jobId} onChange={e => setForm(f => ({ ...f, jobId: e.target.value }))} data-testid="input-job-id" />
                <Input placeholder="Contact ID (optional)" value={form.contactId} onChange={e => setForm(f => ({ ...f, contactId: e.target.value }))} data-testid="input-contact-id" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="From" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} data-testid="input-from" />
                <Input placeholder="To" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} data-testid="input-to" />
              </div>
              {form.channel === "email" && <Input placeholder="Subject" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} data-testid="input-subject" />}
              <Textarea placeholder="Message body / notes" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} rows={4} data-testid="textarea-body" />
              <Button className="w-full bg-[hsl(var(--titan-blue))] text-white" onClick={() => addEntry.mutate({ jobId: form.jobId ? Number(form.jobId) : undefined, contactId: form.contactId ? Number(form.contactId) : undefined, channel: form.channel, direction: form.direction, from: form.from || undefined, to: form.to || undefined, subject: form.subject || undefined, body: form.body })} disabled={!form.body} data-testid="button-save-comm">Log Entry</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tag summary chips */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(tagCounts).map(([tag, count]) => (
          <button key={tag} onClick={() => setFilterTag(filterTag === tag ? "all" : tag)} className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${filterTag === tag ? "ring-2 ring-offset-1 ring-[hsl(var(--titan-blue))]" : ""} ${TAG_COLORS[tag] || TAG_COLORS.other}`} data-testid={`chip-tag-${tag}`}>
            {tag.replace(/_/g, " ")} ({count as number})
          </button>
        ))}
        {filterTag !== "all" && <button onClick={() => setFilterTag("all")} className="px-3 py-1 rounded-full text-xs border text-muted-foreground">Clear filter</button>}
      </div>

      {/* Search + channel filter */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search communications..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search" />
        </div>
        <Select value={filterChannel} onValueChange={setFilterChannel}>
          <SelectTrigger className="w-36" data-testid="select-filter-channel"><SelectValue placeholder="All channels" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="sms">SMS</SelectItem>
            <SelectItem value="call">Call</SelectItem>
            <SelectItem value="internal">Internal</SelectItem>
            <SelectItem value="note">Note</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Timeline */}
      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium">No communications logged yet</p>
            <p className="text-sm text-muted-foreground mt-1">Log calls, emails, and texts to build a complete job communication history</p>
          </CardContent>
        </Card>
      ) : (
        <div className="relative">
          <div className="absolute left-6 top-0 bottom-0 w-px bg-border" />
          <div className="space-y-4">
            {filtered.map((entry: any) => {
              const Icon = CHANNEL_ICON[entry.channel] || MessageSquare;
              return (
                <div key={entry.id} className="relative flex gap-4" data-testid={`entry-comm-${entry.id}`}>
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center shrink-0 z-10 border-2 border-background">
                    <Icon className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <Card className="flex-1">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-xs">{entry.channel}</Badge>
                            <Badge variant="outline" className={`text-xs ${TAG_COLORS[entry.ai_tag] || TAG_COLORS.other}`}>{(entry.ai_tag || "other").replace(/_/g, " ")}</Badge>
                            {entry.direction !== "internal" && <Badge variant="secondary" className="text-xs">{entry.direction}</Badge>}
                            {entry.job_id && <span className="text-xs text-muted-foreground">Job #{entry.job_id}</span>}
                          </div>
                          {entry.subject && <p className="font-medium text-sm mt-1">{entry.subject}</p>}
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-3">{entry.ai_summary || entry.body}</p>
                          {(entry.from || entry.to) && (
                            <p className="text-xs text-muted-foreground mt-1">{entry.from && `From: ${entry.from}`}{entry.from && entry.to && " · "}{entry.to && `To: ${entry.to}`}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                          <p className="text-xs text-muted-foreground">{new Date(entry.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</p>
                          <div className="flex items-center gap-2 mt-1 justify-end">
                            <button onClick={() => openEdit(entry)} className="text-xs text-muted-foreground hover:text-foreground" data-testid={`button-edit-comm-timeline-${entry.id}`}>edit</button>
                            <button onClick={() => deleteEntry.mutate(entry.id)} className="text-xs text-red-400 hover:text-red-600" data-testid={`button-delete-comm-timeline-${entry.id}`}>delete</button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editingId !== null} onOpenChange={v => { if (!v) setEditingId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Communication</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Select value={editForm.channel} onValueChange={v => setEditForm(f => ({ ...f, channel: v }))}>
                <SelectTrigger data-testid={`input-channel-${editingId}`}><SelectValue placeholder="Channel" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS/Text</SelectItem>
                  <SelectItem value="call">Phone Call</SelectItem>
                  <SelectItem value="internal">Internal</SelectItem>
                  <SelectItem value="note">Note</SelectItem>
                </SelectContent>
              </Select>
              <Select value={editForm.direction} onValueChange={v => setEditForm(f => ({ ...f, direction: v }))}>
                <SelectTrigger data-testid={`input-direction-${editingId}`}><SelectValue placeholder="Direction" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inbound">Inbound</SelectItem>
                  <SelectItem value="outbound">Outbound</SelectItem>
                  <SelectItem value="internal">Internal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Job ID (optional)" value={editForm.jobId} onChange={e => setEditForm(f => ({ ...f, jobId: e.target.value }))} data-testid={`input-jobId-${editingId}`} />
              <Input placeholder="Contact ID (optional)" value={editForm.contactId} onChange={e => setEditForm(f => ({ ...f, contactId: e.target.value }))} data-testid={`input-contactId-${editingId}`} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="From" value={editForm.from} onChange={e => setEditForm(f => ({ ...f, from: e.target.value }))} data-testid={`input-from-${editingId}`} />
              <Input placeholder="To" value={editForm.to} onChange={e => setEditForm(f => ({ ...f, to: e.target.value }))} data-testid={`input-to-${editingId}`} />
            </div>
            {editForm.channel === "email" && <Input placeholder="Subject" value={editForm.subject} onChange={e => setEditForm(f => ({ ...f, subject: e.target.value }))} data-testid={`input-subject-${editingId}`} />}
            <Textarea placeholder="Message body / notes" value={editForm.body} onChange={e => setEditForm(f => ({ ...f, body: e.target.value }))} rows={4} data-testid={`input-body-${editingId}`} />
            <Button
              className="w-full bg-[hsl(var(--titan-blue))] text-white"
              onClick={() => editingId !== null && updateEntry.mutate({ id: editingId, data: { jobId: editForm.jobId ? Number(editForm.jobId) : undefined, contactId: editForm.contactId ? Number(editForm.contactId) : undefined, channel: editForm.channel, direction: editForm.direction, from: editForm.from || undefined, to: editForm.to || undefined, subject: editForm.subject || undefined, body: editForm.body } })}
              disabled={!editForm.body || updateEntry.isPending}
              data-testid={`button-save-comm-timeline-${editingId}`}
            >
              {updateEntry.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
