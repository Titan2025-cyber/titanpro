import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CloudLightning, Plus, MapPin, Send, Copy, Mail, Facebook, Twitter, Users, TrendingUp } from "lucide-react";

const STORM_TYPES = ["tornado", "hurricane", "hail", "flooding", "wind", "ice", "fire_weather"];
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  completed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
};

const SOCIAL_TEMPLATES: Record<string, (name: string, area: string, type: string) => string> = {
  facebook: (name, area, type) =>
    `🚨 Storm Alert — ${area} area residents!\n\nIf your home was affected by the recent ${type} event, Titan Restoration LLC is here to help 24/7. We handle water, fire, mold, and structural damage — fast response, insurance specialists on staff.\n\n📞 Call or text: 706-922-0154\n🌐 titanrestorationllc.com\n\n#${area.replace(/\s+/g, "")}Storm #DisasterRestoration #TitanRestoration #${type.charAt(0).toUpperCase() + type.slice(1)}Damage`,
  instagram: (name, area, type) =>
    `Storm hit ${area}? We've got you covered 🏠⚡\n\nTitan Restoration is your trusted ${type} damage specialist — licensed, IICRC certified, and insurance-approved. Available 24/7 for emergency response.\n\n👉 Call 706-922-0154 now\n📍 Serving Augusta, GA & Surrounding Areas\n\n#TitanRestoration #${type}Damage #EmergencyResponse #AugustaGA #InsuranceClaim`,
  email: (name, area, type) =>
    `Subject: ${type.charAt(0).toUpperCase() + type.slice(1)} Damage Recovery — We Can Help\n\nDear ${area} Property Owner,\n\nWe hope you and your family are safe following the recent ${type} event. If your property sustained damage, Titan Restoration LLC is available 24/7 to provide a free damage assessment and begin emergency stabilization.\n\nOur team is IICRC-certified and works directly with all major insurance carriers to streamline your claim.\n\nServices we provide:\n• Emergency water extraction and drying\n• Structural damage assessment\n• Fire and smoke remediation\n• Mold prevention and remediation\n• Full reconstruction services\n\nCall or text us now: 706-922-0154\nVisit: titanrestorationllc.com\n\nWarm regards,\nCody Brantley\nTitan Restoration LLC\n706-922-0154`,
  sms: (name, area, type) =>
    `TITAN RESTORATION: ${area} affected by ${type}? We respond 24/7. Free damage assessment. Call/text 706-922-0154. STOP to opt out.`,
};

export default function StormMarketing() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [contentDialog, setContentDialog] = useState<{ open: boolean; campaign: any; channel: string } | null>(null);
  const [form, setForm] = useState({
    name: "",
    stormType: "wind",
    targetArea: "",
    radius: "25",
    status: "draft",
    notes: "",
    launchDate: "",
  });

  const { data: campaigns = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/storm-campaigns"],
    queryFn: () => apiRequest("/api/storm-campaigns").then((r) => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest("/api/storm-campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm-campaigns"] });
      setOpen(false);
      resetForm();
      toast({ title: "Storm campaign created" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) =>
      apiRequest(`/api/storm-campaigns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm-campaigns"] });
      toast({ title: "Campaign updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/storm-campaigns/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm-campaigns"] });
      toast({ title: "Campaign deleted" });
    },
  });

  function resetForm() {
    setForm({ name: "", stormType: "wind", targetArea: "", radius: "25", status: "draft", notes: "", launchDate: "" });
  }

  function handleCreate() {
    createMutation.mutate({
      name: form.name,
      stormType: form.stormType,
      targetArea: form.targetArea,
      radius: parseInt(form.radius) || 25,
      status: form.status,
      notes: form.notes,
      launchDate: form.launchDate || null,
    });
  }

  function getContent(campaign: any, channel: string) {
    return SOCIAL_TEMPLATES[channel]?.(campaign.name, campaign.targetArea || "the affected", campaign.stormType) || "";
  }

  function copyContent(text: string) {
    navigator.clipboard.writeText(text).then(() => toast({ title: "Copied to clipboard" }));
  }

  const activeCampaigns = campaigns.filter((c: any) => c.status === "active").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <CloudLightning className="w-5 h-5 text-primary" /> Storm Marketing Automation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Geo-targeted campaigns triggered by storm events — generate social posts, email templates, and SMS blasts</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-campaign"><Plus className="w-4 h-4 mr-2" />New Campaign</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New Storm Campaign</DialogTitle></DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <Label>Campaign Name</Label>
                <Input data-testid="input-campaign-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g., Augusta Hail Storm July 2026" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Storm Type</Label>
                  <Select value={form.stormType} onValueChange={(v) => setForm({ ...form, stormType: v })}>
                    <SelectTrigger data-testid="select-storm-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STORM_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ").toUpperCase()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.keys(STATUS_COLORS).map((s) => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Target Area / City</Label>
                  <Input data-testid="input-target-area" value={form.targetArea} onChange={(e) => setForm({ ...form, targetArea: e.target.value })} placeholder="e.g., Augusta, GA" />
                </div>
                <div>
                  <Label>Radius (miles)</Label>
                  <Input data-testid="input-radius" type="number" value={form.radius} onChange={(e) => setForm({ ...form, radius: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Launch Date</Label>
                <Input data-testid="input-launch-date" type="date" value={form.launchDate} onChange={(e) => setForm({ ...form, launchDate: e.target.value })} />
              </div>
              <div>
                <Label>Notes / Target Neighborhoods</Label>
                <Textarea data-testid="input-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="e.g., Focus on Summerville, Grovetown, Evans..." />
              </div>
              <Button data-testid="button-create-campaign" className="w-full" onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Campaign"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CloudLightning className="w-8 h-8 text-primary" />
            <div><p className="text-xs text-muted-foreground">Total Campaigns</p><p className="text-lg font-bold" data-testid="kpi-total-campaigns">{campaigns.length}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-green-500" />
            <div><p className="text-xs text-muted-foreground">Active Now</p><p className="text-lg font-bold" data-testid="kpi-active-campaigns">{activeCampaigns}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <MapPin className="w-8 h-8 text-blue-500" />
            <div><p className="text-xs text-muted-foreground">Coverage Areas</p><p className="text-lg font-bold">{[...new Set(campaigns.map((c: any) => c.targetArea).filter(Boolean))].length}</p></div>
          </CardContent>
        </Card>
      </div>

      {/* Campaigns */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading campaigns...</div>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <CloudLightning className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-30" />
            <p className="text-muted-foreground font-semibold">No campaigns yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create a campaign after a storm event to generate geo-targeted marketing content</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {campaigns.map((c: any) => (
            <Card key={c.id} data-testid={`card-campaign-${c.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold">{c.name || `Campaign #${c.id}`}</span>
                      <Badge className={STATUS_COLORS[c.status] || ""}>{c.status}</Badge>
                      <Badge variant="outline">{c.stormType?.replace("_", " ")}</Badge>
                    </div>
                    {c.targetArea && (
                      <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {c.targetArea} · {c.radius || 25}mi radius
                      </p>
                    )}
                    {c.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{c.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    <Select defaultValue={c.status} onValueChange={(v) => updateMutation.mutate({ id: c.id, data: { status: v } })}>
                      <SelectTrigger className="h-8 text-xs w-28" data-testid={`select-campaign-status-${c.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.keys(STATUS_COLORS).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(c.id)} data-testid={`button-delete-campaign-${c.id}`}>Delete</Button>
                  </div>
                </div>

                {/* Content Generation Buttons */}
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">GENERATE CONTENT</p>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { key: "facebook", icon: Facebook, label: "Facebook" },
                      { key: "instagram", icon: Send, label: "Instagram" },
                      { key: "email", icon: Mail, label: "Email Template" },
                      { key: "sms", icon: Users, label: "SMS Blast" },
                    ].map(({ key, icon: Icon, label }) => (
                      <Button
                        key={key}
                        size="sm"
                        variant="outline"
                        onClick={() => setContentDialog({ open: true, campaign: c, channel: key })}
                        data-testid={`button-gen-${key}-${c.id}`}
                      >
                        <Icon className="w-3 h-3 mr-1" /> {label}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Content Preview Dialog */}
      {contentDialog?.open && (
        <Dialog open={contentDialog.open} onOpenChange={() => setContentDialog(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="capitalize">{contentDialog.channel} — {contentDialog.campaign.name}</DialogTitle>
            </DialogHeader>
            <div className="mt-2">
              <div className="bg-muted rounded-lg p-4 text-sm whitespace-pre-wrap font-mono leading-relaxed max-h-80 overflow-y-auto" data-testid="content-preview">
                {getContent(contentDialog.campaign, contentDialog.channel)}
              </div>
              <div className="flex gap-2 mt-3">
                <Button className="flex-1" onClick={() => copyContent(getContent(contentDialog.campaign, contentDialog.channel))} data-testid="button-copy-content">
                  <Copy className="w-4 h-4 mr-2" /> Copy to Clipboard
                </Button>
                <Button variant="outline" onClick={() => setContentDialog(null)}>Close</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
