import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CloudLightning, MapPin, Users, Phone, Bell, Plus, Trash2, Copy, Radar, Home, MessageSquare } from "lucide-react";
import StormMap from "@/components/StormMap";

const SERVICE_ZIPS = ["29036", "29201", "29803", "29841", "30904", "30907", "30809"];

const OUTREACH_TEMPLATES = [
  { name: "Referral Partner Alert", body: "Hi [Partner], we just activated our storm response team in [Area]. If you have clients with damage, we have crews available now. Call 706-922-0154." },
  { name: "Homeowner First Contact", body: "Hi [Name], we noticed your area was affected by [Storm]. Titan Restoration has crews available now for emergency response. Call 706-922-0154 or reply YES for a free inspection." },
  { name: "Adjuster Heads-Up", body: "Hi [Adjuster], Titan Restoration is responding to storm damage in [Area]. We have job files ready and can meet you on site. Call 706-922-0154." },
];

const EVENT_TYPES = ["hail", "wind", "tornado", "flood", "water", "hurricane", "other"];
const STATUSES = ["monitoring", "active", "closed"];

export default function StormCAT() {
  const { toast } = useToast();
  const [newZip, setNewZip] = useState("");
  const [eventOpen, setEventOpen] = useState(false);
  const [kitEvent, setKitEvent] = useState<any>(null);
  const [form, setForm] = useState({ name: "", eventType: "hail", severity: "", zip: "", area: "", status: "monitoring" });

  const { data: events = [] } = useQuery<any[]>({ queryKey: ["/api/storm-events"] });
  const { data: zips = [] } = useQuery<any[]>({ queryKey: ["/api/storm-zips"] });
  const { data: capacity } = useQuery<{ value: string }>({ queryKey: ["/api/storm-capacity"] });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });
  const { data: contacts = [] } = useQuery<any[]>({ queryKey: ["/api/contacts"] });

  const crewCapacity = capacity?.value || "available";

  // ZIPs with an active/monitoring event or any job address → "hot" (pulsing red).
  const mapZips = Array.from(new Set([...SERVICE_ZIPS, ...(zips as any[]).map((z: any) => z.zip)]));
  const activeZips = mapZips.filter((zip) => {
    const eventHit = (events as any[]).some((e: any) => e.zip === zip && e.status !== "closed");
    const jobHit = (jobs as any[]).some((j: any) => (j.address || "").includes(zip));
    return eventHit || jobHit;
  });

  const capacityMutation = useMutation({
    mutationFn: (value: string) => apiRequest("POST", "/api/storm-capacity", { value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/storm-capacity"] }),
  });

  const addZip = useMutation({
    mutationFn: (zip: string) => apiRequest("POST", "/api/storm-zips", { zip }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/storm-zips"] }); setNewZip(""); },
  });
  const removeZip = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/storm-zips/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/storm-zips"] }),
  });

  const addEvent = useMutation({
    mutationFn: () => apiRequest("POST", "/api/storm-events", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm-events"] });
      setEventOpen(false);
      setForm({ name: "", eventType: "hail", severity: "", zip: "", area: "", status: "monitoring" });
      toast({ title: "Storm event added" });
    },
  });
  const updateEvent = useMutation({
    mutationFn: ({ id, data }: any) => apiRequest("PATCH", `/api/storm-events/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/storm-events"] }),
  });
  const deleteEvent = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/storm-events/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/storm-events"] }); toast({ title: "Event removed" }); },
  });

  const monitoredZipStrings = new Set((zips as any[]).map((z: any) => z.zip));
  const quickAddZips = SERVICE_ZIPS.filter((z) => !monitoredZipStrings.has(z));

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied`, description: "Draft copied to clipboard — no message was sent." });
    } catch (_) {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  // ── Geo-targeted response kit (client-side, static fallback) ──────────────
  const contactsInZip = (zip: string) => {
    if (!zip) return [];
    const jobMatches = (jobs as any[]).filter((j: any) => (j.address || "").includes(zip));
    const contactIds = new Set(jobMatches.map((j: any) => j.contactId));
    return (contacts as any[]).filter((c: any) =>
      contactIds.has(c.id) || (c.address || "").includes(zip)
    );
  };

  const buildKit = (ev: any) => {
    const zip = ev.zip || "";
    const area = ev.area || zip || "your area";
    const targets = contactsInZip(zip);
    const social = `⚠️ STORM RESPONSE ACTIVE — ${area}\n\nTitan Restoration LLC has emergency crews deployed in ${area}${zip ? ` (${zip})` : ""} following the ${ev.name}. If your property took ${ev.eventType} damage, we offer free inspections and work directly with your insurance.\n\n📞 Call 706-922-0154 for priority scheduling.\n#TitanRestoration #StormDamage #Augusta`;
    const sms = `Hi [Name], this is Titan Restoration. We're responding to ${ev.eventType} damage in ${area}. We already know your property and can prioritize a free inspection. Reply YES or call 706-922-0154.`;
    return { zip, area, targets, social, sms };
  };

  const kit = kitEvent ? buildKit(kitEvent) : null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <span className="tp-page-eyebrow">Storm Response</span>
          <h1 className="text-2xl font-bold tracking-tight tp-gradient-text">Storm CAT Command Center</h1>
          <p className="text-sm text-muted-foreground">Track events, monitor ZIPs, and generate geo-targeted response kits.</p>
        </div>
        <Button onClick={() => setEventOpen(true)} data-testid="button-add-event"><Plus className="w-4 h-4 mr-2" />Add Event</Button>
      </div>
      <hr className="tp-rule" />

      {/* Hero: regional storm radar map */}
      <StormMap zips={mapZips} activeZips={activeZips} />

      {/* Crew capacity toggle */}
      <Card className={crewCapacity === "available" ? "border-green-300" : crewCapacity === "limited" ? "border-amber-300" : "border-red-300"}>
        <CardContent className="pt-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${crewCapacity === "available" ? "bg-green-500" : crewCapacity === "limited" ? "bg-amber-400" : "bg-red-500"}`} />
            <div>
              <p className="font-semibold text-sm">Crew Capacity: <span className="capitalize">{crewCapacity}</span></p>
              <p className="text-xs text-muted-foreground">This status is shown to partners in their portal</p>
            </div>
          </div>
          <div className="flex gap-2">
            {(["available", "limited", "full"] as const).map((s) => (
              <Button key={s} size="sm" variant={crewCapacity === s ? "default" : "outline"} onClick={() => capacityMutation.mutate(s)} data-testid={`button-capacity-${s}`}
                className={crewCapacity === s && s === "available" ? "bg-green-600 hover:bg-green-700 text-white" : ""}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Service area monitor */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><MapPin className="w-4 h-4 text-[hsl(var(--titan-red))]" />Monitored ZIP Codes</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="ZIP code to monitor" value={newZip} onChange={(e) => setNewZip(e.target.value)} className="max-w-40" data-testid="input-new-zip" />
            <Button size="sm" variant="outline" onClick={() => newZip.trim() && addZip.mutate(newZip.trim())} disabled={addZip.isPending} data-testid="button-add-zip">+ Add ZIP</Button>
          </div>
          {quickAddZips.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-muted-foreground">Quick add:</span>
              {quickAddZips.map((z) => (
                <button key={z} type="button" onClick={() => addZip.mutate(z)} className="text-xs px-2 py-0.5 rounded-full border border-dashed hover:bg-muted" data-testid={`quickadd-zip-${z}`}>+ {z}</button>
              ))}
            </div>
          )}
          {(zips as any[]).length === 0 ? (
            <p className="text-xs text-muted-foreground">No ZIP codes monitored yet. Add your service areas above.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(zips as any[]).map((z: any) => (
                <Badge key={z.id} variant="outline" className="text-xs flex items-center gap-1" data-testid={`zip-${z.zip}`}>
                  {z.zip}
                  <button type="button" onClick={() => removeZip.mutate(z.id)} className="ml-1 text-destructive hover:opacity-70" data-testid={`remove-zip-${z.zip}`}><Trash2 className="w-3 h-3" /></button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Storm events */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Radar className="w-4 h-4 text-[hsl(var(--titan-blue))]" />Storm Events</h2>
        {(events as any[]).length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">
            No storm events tracked yet. Click <span className="font-medium">Add Event</span> to start monitoring.
          </CardContent></Card>
        ) : (
          (events as any[]).map((ev: any) => {
            const targets = contactsInZip(ev.zip);
            return (
              <Card key={ev.id} className={ev.status === "active" ? "border-amber-300" : ""} data-testid={`event-${ev.id}`}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <CloudLightning className={`w-4 h-4 ${ev.status === "active" ? "text-amber-500" : "text-muted-foreground"}`} />
                        <span className="font-medium text-sm">{ev.name}</span>
                        {ev.zip && <Badge variant="outline" className="text-xs">{ev.zip}</Badge>}
                        <Badge variant="outline" className={`text-xs capitalize ${ev.status === "active" ? "border-amber-300 text-amber-600" : ev.status === "monitoring" ? "border-blue-300 text-blue-600" : "border-green-300 text-green-600"}`}>
                          {ev.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground capitalize">
                        {ev.eventType}{ev.severity ? ` · ${ev.severity}` : ""}{ev.area ? ` · ${ev.area}` : ""} · {targets.length} past customer{targets.length !== 1 ? "s" : ""} in area
                      </p>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Select value={ev.status} onValueChange={(v) => updateEvent.mutate({ id: ev.id, data: { status: v } })}>
                        <SelectTrigger className="h-8 w-32 text-xs" data-testid={`event-status-${ev.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button size="sm" variant="outline" className="text-xs" onClick={() => setKitEvent(ev)} data-testid={`button-kit-${ev.id}`}><MessageSquare className="w-3 h-3 mr-1" />Generate Response Kit</Button>
                      <Button size="sm" variant="outline" className="text-xs" onClick={() => copyText(OUTREACH_TEMPLATES[0].body.replace("[Area]", ev.area || ev.zip || "the area"), "Partner alert")} data-testid={`button-alert-${ev.id}`}><Bell className="w-3 h-3 mr-1" />Alert Partners</Button>
                      <Button size="sm" variant="ghost" onClick={() => deleteEvent.mutate(ev.id)} data-testid={`button-delete-event-${ev.id}`}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Outreach templates */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" />One-Click Outreach Templates</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {OUTREACH_TEMPLATES.map((t, i) => (
            <div key={i} className="p-3 rounded-lg border bg-muted/20 space-y-2">
              <p className="text-xs font-semibold">{t.name}</p>
              <p className="text-xs text-muted-foreground">{t.body}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => copyText(t.body, "SMS draft")} data-testid={`template-sms-${i}`}><Phone className="w-3 h-3 mr-1" />Copy SMS</Button>
                <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => copyText(t.body, "Email draft")} data-testid={`template-email-${i}`}>Copy Email</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Add event dialog */}
      <Dialog open={eventOpen} onOpenChange={setEventOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Storm Event</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Hail Event — North Augusta" data-testid="input-event-name" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Type</Label>
                <Select value={form.eventType} onValueChange={(v) => setForm({ ...form, eventType: v })}>
                  <SelectTrigger data-testid="select-event-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{EVENT_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger data-testid="select-event-status"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Severity</Label><Input value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })} placeholder='Large hail 1.5"' data-testid="input-event-severity" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>ZIP</Label><Input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} placeholder="29841" data-testid="input-event-zip" /></div>
              <div><Label>Area</Label><Input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="North Augusta" data-testid="input-event-area" /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEventOpen(false)}>Cancel</Button>
              <Button onClick={() => addEvent.mutate()} disabled={addEvent.isPending || !form.name.trim()} data-testid="button-confirm-event">Add Event</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Response kit dialog */}
      <Dialog open={!!kitEvent} onOpenChange={(o) => !o && setKitEvent(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Response Kit — {kitEvent?.name}</DialogTitle></DialogHeader>
          {kit && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">
                {kit.targets.length} past customer{kit.targets.length !== 1 ? "s" : ""} in {kit.zip ? kit.zip : "this area"}
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-xs"><MessageSquare className="w-3.5 h-3.5" />Geo-targeted social post</Label>
                <pre className="text-xs whitespace-pre-wrap bg-muted rounded p-3" data-testid="kit-social">{kit.social}</pre>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => copyText(kit.social, "Social post")} data-testid="button-copy-social"><Copy className="w-3 h-3 mr-1" />Copy post</Button>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-xs"><Phone className="w-3.5 h-3.5" />SMS blast template</Label>
                <pre className="text-xs whitespace-pre-wrap bg-muted rounded p-3" data-testid="kit-sms">{kit.sms}</pre>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => copyText(kit.sms, "SMS template")} data-testid="button-copy-sms"><Copy className="w-3 h-3 mr-1" />Copy SMS</Button>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-xs"><Home className="w-3.5 h-3.5" />Door-knock target list ({kit.targets.length})</Label>
                {kit.targets.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No past customers found in {kit.zip || "this ZIP"}. Set the event's ZIP to match your job addresses.</p>
                ) : (
                  <div className="divide-y rounded-md border overflow-hidden max-h-52 overflow-y-auto">
                    {kit.targets.map((c: any) => (
                      <div key={c.id} className="px-3 py-2 text-xs" data-testid={`doorknock-${c.id}`}>
                        <span className="font-medium">{c.name}</span>
                        {c.address && <span className="ml-2 text-muted-foreground">{c.address}</span>}
                        {c.phone && <span className="ml-2 text-muted-foreground">· {c.phone}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
