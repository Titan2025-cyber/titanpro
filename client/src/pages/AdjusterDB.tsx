import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Phone, Mail, Building2, Calendar, CheckCircle2, Trash2, Edit2 } from "lucide-react";

const PURPOSES = ["walkthrough", "reinspection", "scope_review", "final"];
const CARRIERS = ["State Farm", "Allstate", "Nationwide", "Farmers", "USAA", "Liberty Mutual", "Progressive", "Travelers", "Other"];

export default function AdjusterDB() {
  const { toast } = useToast();
  const [adjOpen, setAdjOpen] = useState(false);
  const [meetOpen, setMeetOpen] = useState(false);
  const [editAdj, setEditAdj] = useState<any>(null);
  const [adjForm, setAdjForm] = useState({ name: "", carrier: "", territory: "", email: "", phone: "", preferredContact: "email", notes: "" });
  const [meetForm, setMeetForm] = useState({ jobId: "", adjusterName: "", meetingDate: "", meetingTime: "", location: "", purpose: "walkthrough", outcome: "" });

  const { data: adjusters = [] } = useQuery<any[]>({ queryKey: ["/api/adjusters"] });
  const { data: meetings = [] } = useQuery<any[]>({ queryKey: ["/api/adjuster-meetings"] });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });

  const saveAdj = useMutation({
    mutationFn: (d: any) => editAdj ? apiRequest("PATCH", `/api/adjusters/${editAdj.id}`, d) : apiRequest("POST", "/api/adjusters", d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/adjusters"] }); setAdjOpen(false); setEditAdj(null); toast({ title: "Adjuster saved" }); },
  });
  const deleteAdj = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/adjusters/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/adjusters"] }); toast({ title: "Adjuster removed" }); },
  });
  const saveMeet = useMutation({
    mutationFn: (d: any) => apiRequest("POST", "/api/adjuster-meetings", d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/adjuster-meetings"] }); setMeetOpen(false); toast({ title: "Meeting scheduled" }); },
  });
  const updateMeet = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest("PATCH", `/api/adjuster-meetings/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/adjuster-meetings"] }); toast({ title: "Meeting updated" }); },
  });

  const openNewAdj = () => { setEditAdj(null); setAdjForm({ name: "", carrier: "", territory: "", email: "", phone: "", preferredContact: "email", notes: "" }); setAdjOpen(true); };
  const openEditAdj = (a: any) => { setEditAdj(a); setAdjForm({ name: a.name, carrier: a.carrier, territory: a.territory || "", email: a.email || "", phone: a.phone || "", preferredContact: a.preferredContact || "email", notes: a.notes || "" }); setAdjOpen(true); };

  const upcoming = meetings.filter((m: any) => !m.outcome && new Date(m.meetingDate) >= new Date()).sort((a: any, b: any) => a.meetingDate.localeCompare(b.meetingDate));
  const past = meetings.filter((m: any) => m.outcome || new Date(m.meetingDate) < new Date()).sort((a: any, b: any) => b.meetingDate.localeCompare(a.meetingDate));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Adjuster Database</h1>
          <p className="text-sm text-muted-foreground">Insurance adjuster contacts and meeting scheduler</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setMeetOpen(true)} data-testid="button-schedule-meeting"><Calendar className="w-4 h-4 mr-2" /> Schedule Meeting</Button>
          <Button className="bg-primary text-primary-foreground" onClick={openNewAdj} data-testid="button-add-adjuster"><Plus className="w-4 h-4 mr-2" /> Add Adjuster</Button>
        </div>
      </div>

      <Tabs defaultValue="adjusters">
        <TabsList><TabsTrigger value="adjusters">Adjusters ({adjusters.length})</TabsTrigger><TabsTrigger value="meetings">Meetings ({meetings.length})</TabsTrigger></TabsList>

        <TabsContent value="adjusters" className="mt-4">
          {adjusters.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No adjusters yet. Add your key carrier contacts to build your database.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {adjusters.map((adj: any) => (
                <Card key={adj.id} data-testid={`card-adjuster-${adj.id}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-foreground">{adj.name}</p>
                        <Badge variant="outline" className="mt-1 text-xs">{adj.carrier}</Badge>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEditAdj(adj)}><Edit2 className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteAdj.mutate(adj.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                    {adj.territory && <p className="text-xs text-muted-foreground">📍 {adj.territory}</p>}
                    <div className="space-y-1">
                      {adj.email && <div className="flex items-center gap-2 text-sm"><Mail className="w-3.5 h-3.5 text-muted-foreground" /><span>{adj.email}</span></div>}
                      {adj.phone && <div className="flex items-center gap-2 text-sm"><Phone className="w-3.5 h-3.5 text-muted-foreground" /><a href={`tel:${adj.phone}`} className="text-primary">{adj.phone}</a></div>}
                    </div>
                    {adj.notes && <p className="text-xs text-muted-foreground border-t pt-2">{adj.notes}</p>}
                    <Button size="sm" variant="outline" className="w-full" onClick={() => { setMeetForm(f => ({ ...f, adjusterName: adj.name })); setMeetOpen(true); }}>
                      <Calendar className="w-3.5 h-3.5 mr-2" /> Schedule Walkthrough
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="meetings" className="mt-4 space-y-4">
          {upcoming.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-3">Upcoming</h3>
              <div className="space-y-2">
                {upcoming.map((m: any) => {
                  const job = jobs.find((j: any) => j.id === m.jobId);
                  return (
                    <Card key={m.id} className="border-l-4 border-l-primary" data-testid={`card-meeting-${m.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold">{m.adjusterName || "Adjuster TBD"} · <span className="font-normal text-muted-foreground capitalize">{m.purpose}</span></p>
                            <p className="text-sm text-muted-foreground">{job?.jobNumber} — {job?.address}</p>
                            <p className="text-sm">{m.meetingDate}{m.meetingTime ? ` at ${m.meetingTime}` : ""}{m.location ? ` · ${m.location}` : ""}</p>
                          </div>
                          <Button size="sm" variant="outline" onClick={() => updateMeet.mutate({ id: m.id, data: { outcome: "Completed — no issues", followUpRequired: 0 } })}>
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Mark Done
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
          {past.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">Past Meetings</h3>
              <div className="space-y-2">
                {past.slice(0, 10).map((m: any) => {
                  const job = jobs.find((j: any) => j.id === m.jobId);
                  return (
                    <Card key={m.id} className="opacity-80">
                      <CardContent className="p-3 flex justify-between items-center">
                        <div>
                          <p className="text-sm font-medium">{m.adjusterName} · {job?.jobNumber}</p>
                          <p className="text-xs text-muted-foreground">{m.meetingDate} · <span className="capitalize">{m.purpose}</span></p>
                          {m.outcome && <p className="text-xs text-green-600 mt-1">{m.outcome}</p>}
                        </div>
                        <Badge variant={m.followUpRequired ? "destructive" : "secondary"}>{m.followUpRequired ? "Follow-up needed" : "Closed"}</Badge>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
          {meetings.length === 0 && <Card><CardContent className="py-12 text-center text-muted-foreground">No meetings scheduled yet.</CardContent></Card>}
        </TabsContent>
      </Tabs>

      {/* Adjuster Dialog */}
      <Dialog open={adjOpen} onOpenChange={setAdjOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editAdj ? "Edit Adjuster" : "Add Adjuster"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={adjForm.name} onChange={e => setAdjForm(f => ({ ...f, name: e.target.value }))} data-testid="input-adj-name" /></div>
            <div><Label>Carrier</Label>
              <Select value={adjForm.carrier} onValueChange={v => setAdjForm(f => ({ ...f, carrier: v }))}>
                <SelectTrigger data-testid="select-adj-carrier"><SelectValue placeholder="Select carrier" /></SelectTrigger>
                <SelectContent>{CARRIERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Territory</Label><Input value={adjForm.territory} onChange={e => setAdjForm(f => ({ ...f, territory: e.target.value }))} placeholder="e.g. Augusta GA / CSRA" data-testid="input-adj-territory" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input type="email" value={adjForm.email} onChange={e => setAdjForm(f => ({ ...f, email: e.target.value }))} data-testid="input-adj-email" /></div>
              <div><Label>Phone</Label><Input value={adjForm.phone} onChange={e => setAdjForm(f => ({ ...f, phone: e.target.value }))} data-testid="input-adj-phone" /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={adjForm.notes} onChange={e => setAdjForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAdjOpen(false)}>Cancel</Button>
              <Button onClick={() => saveAdj.mutate(adjForm)} disabled={saveAdj.isPending} data-testid="button-save-adj">Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Meeting Dialog */}
      <Dialog open={meetOpen} onOpenChange={setMeetOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Schedule Adjuster Meeting</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Job</Label>
              <Select value={meetForm.jobId} onValueChange={v => setMeetForm(f => ({ ...f, jobId: v }))}>
                <SelectTrigger data-testid="select-meet-job"><SelectValue placeholder="Select job" /></SelectTrigger>
                <SelectContent>{jobs.map((j: any) => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber} — {j.address}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Adjuster Name</Label><Input value={meetForm.adjusterName} onChange={e => setMeetForm(f => ({ ...f, adjusterName: e.target.value }))} data-testid="input-meet-adjuster" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={meetForm.meetingDate} onChange={e => setMeetForm(f => ({ ...f, meetingDate: e.target.value }))} data-testid="input-meet-date" /></div>
              <div><Label>Time</Label><Input type="time" value={meetForm.meetingTime} onChange={e => setMeetForm(f => ({ ...f, meetingTime: e.target.value }))} data-testid="input-meet-time" /></div>
            </div>
            <div><Label>Location</Label><Input value={meetForm.location} onChange={e => setMeetForm(f => ({ ...f, location: e.target.value }))} placeholder="Job site address or office" data-testid="input-meet-location" /></div>
            <div><Label>Purpose</Label>
              <Select value={meetForm.purpose} onValueChange={v => setMeetForm(f => ({ ...f, purpose: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PURPOSES.map(p => <SelectItem key={p} value={p} className="capitalize">{p.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setMeetOpen(false)}>Cancel</Button>
              <Button onClick={() => saveMeet.mutate({ ...meetForm, jobId: Number(meetForm.jobId) })} disabled={saveMeet.isPending || !meetForm.jobId || !meetForm.meetingDate} data-testid="button-save-meeting">Schedule</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
