import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CloudLightning, MapPin, Users, Zap, Phone, Bell, AlertTriangle, CheckCircle2 } from "lucide-react";

const STORM_EVENTS = [
  { id: 1, name: "Hail Event — North Augusta", date: "Jun 28", severity: "Large hail 1.5\"", affected: 3, status: "active", dispatched: true },
  { id: 2, name: "Water Main Break — Chapin", date: "Jun 25", severity: "Category 2", affected: 1, status: "closed", dispatched: true },
  { id: 3, name: "Tornado Warning — Lexington Co", date: "Jun 20", severity: "Wind damage", affected: 0, status: "monitoring", dispatched: false },
];

const OUTREACH_TEMPLATES = [
  { name: "Referral Partner Alert", body: "Hi [Partner], we just activated our storm response team in [Area]. If you have clients with damage, we have crews available now. Call 706-922-0154." },
  { name: "Homeowner First Contact", body: "Hi [Name], we noticed your area was affected by [Storm]. Titan Restoration has crews available now for emergency response. Call 706-922-0154 or reply YES for a free inspection." },
  { name: "Adjuster Heads-Up", body: "Hi [Adjuster], Titan Restoration is responding to storm damage in [Area]. We have job files ready and can meet you on site. Call 706-922-0154." },
];

export default function StormCAT() {
  const [zipCode, setZipCode] = useState("29036");
  const [crewCapacity, setCrewCapacity] = useState<"available" | "full" | "limited">("available");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-red))] flex items-center justify-center">
          <CloudLightning className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Storm CAT Auto-Dispatch</h1>
          <p className="text-sm text-muted-foreground">Weather monitoring → auto-populated dispatch wave → partner outreach</p>
        </div>
      </div>

      {/* Crew capacity toggle */}
      <Card className={crewCapacity === "available" ? "border-green-300 bg-green-50 dark:bg-green-950/20" : crewCapacity === "limited" ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20" : "border-red-300 bg-red-50 dark:bg-red-950/20"}>
        <CardContent className="pt-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${crewCapacity === "available" ? "bg-green-500" : crewCapacity === "limited" ? "bg-amber-400" : "bg-red-500"}`} />
            <div>
              <p className="font-semibold text-sm">Crew Capacity: <span className="capitalize">{crewCapacity}</span></p>
              <p className="text-xs text-muted-foreground">This status is shown to partners in their portal</p>
            </div>
          </div>
          <div className="flex gap-2">
            {(["available","limited","full"] as const).map(s => (
              <Button key={s} size="sm" variant={crewCapacity === s ? "default" : "outline"} onClick={() => setCrewCapacity(s)} className={crewCapacity === s && s === "available" ? "bg-green-600 hover:bg-green-700 text-white" : ""}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Service area monitor */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><MapPin className="w-4 h-4 text-[hsl(var(--titan-red))]" />Service Area Weather Monitor</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="ZIP code to monitor" value={zipCode} onChange={e => setZipCode(e.target.value)} className="max-w-40" />
            <Button size="sm" variant="outline">+ Add ZIP</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {["29036","29201","29803","29841","30904"].map(z => (
              <Badge key={z} variant="outline" className="text-xs">{z} {z === "29803" ? "⚡ Event" : "✓"}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Active storm events */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Storm Events</h2>
        {STORM_EVENTS.map(ev => (
          <Card key={ev.id} className={ev.status === "active" ? "border-amber-300" : ""}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <CloudLightning className={`w-4 h-4 ${ev.status === "active" ? "text-amber-500" : "text-muted-foreground"}`} />
                    <span className="font-medium text-sm">{ev.name}</span>
                    <Badge variant="outline" className="text-xs">{ev.date}</Badge>
                    <Badge variant="outline" className={`text-xs ${ev.status === "active" ? "border-amber-300 text-amber-600" : ev.status === "monitoring" ? "border-blue-300 text-blue-600" : "border-green-300 text-green-600"}`}>
                      {ev.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{ev.severity} · {ev.affected} job{ev.affected !== 1 ? "s" : ""} created</p>
                </div>
                <div className="flex gap-2">
                  {!ev.dispatched && <Button size="sm" variant="outline" className="text-xs"><Zap className="w-3 h-3 mr-1" />Auto-Dispatch</Button>}
                  {ev.dispatched && <Badge className="bg-green-100 text-green-700 border-0">Dispatched ✓</Badge>}
                  <Button size="sm" variant="outline" className="text-xs"><Bell className="w-3 h-3 mr-1" />Alert Partners</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
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
                <Button size="sm" variant="outline" className="text-xs h-7"><Phone className="w-3 h-3 mr-1" />Send SMS</Button>
                <Button size="sm" variant="outline" className="text-xs h-7">Send Email</Button>
                <Button size="sm" variant="outline" className="text-xs h-7">Copy</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
