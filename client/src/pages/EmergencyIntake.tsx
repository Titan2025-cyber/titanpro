import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useState } from "react";
import { Phone, AlertTriangle, CheckCircle, Zap, Plus, Flame, Droplets, Wind, Trash2, Home, Skull, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatPhoneInput } from "@/lib/phone";

const LOSS_ICONS: Record<string, any> = { water: Droplets, fire: Flame, storm: Wind, mold: AlertTriangle, other: Zap };

function DeleteIntakeBtn({ id, label, onDone }: { id: number; label: string; onDone: () => void }) {
  const { toast } = useToast();
  const m = useMutation({
    mutationFn: () => apiRequest(`/api/emergency-intakes/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Intake Deleted" }); onDone(); },
    onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className="shrink-0" data-testid={`button-delete-emergency-intakes-${id}`}>
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this emergency intake?</AlertDialogTitle>
          <AlertDialogDescription>
            {label ? `"${label}" ` : ""}This permanently removes the record and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => m.mutate()} data-testid={`button-confirm-delete-emergency-intakes-${id}`}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Shared body used by both the mobile Sheet and desktop Dialog. Keeping it as
// one component means field ordering, labels, and auto-format behavior stay
// perfectly aligned across surfaces — no drift between mobile and desktop.
const LOSS_TILES: Array<{ key: string; label: string; Icon: any; tint: string }> = [
  { key: "water",     label: "Water",     Icon: Droplets,      tint: "text-blue-600 dark:text-blue-400" },
  { key: "fire",      label: "Fire",      Icon: Flame,         tint: "text-red-600 dark:text-red-400" },
  { key: "storm",     label: "Storm",     Icon: Wind,          tint: "text-slate-600 dark:text-slate-300" },
  { key: "mold",      label: "Mold",      Icon: Home,          tint: "text-emerald-700 dark:text-emerald-400" },
  { key: "biohazard", label: "Biohazard", Icon: Skull,         tint: "text-purple-700 dark:text-purple-400" },
  { key: "other",     label: "Other",     Icon: Zap,           tint: "text-amber-600 dark:text-amber-400" },
];

function IntakeFormBody({ form, setForm }: { form: any; setForm: (fn: any) => void }) {
  return (
    <>
      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Phone *</Label>
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(706) 555-0101"
          className="h-12 text-lg tracking-tight"
          value={form.callerPhone}
          onChange={e => setForm((f: any) => ({ ...f, callerPhone: formatPhoneInput(e.target.value) }))}
          data-testid="input-caller-phone"
        />
      </div>
      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Caller name</Label>
        <Input autoComplete="name" placeholder="Homeowner or contact" className="h-11" value={form.callerName} onChange={e => setForm((f: any) => ({ ...f, callerName: e.target.value }))} data-testid="input-caller-name" />
      </div>
      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Property address</Label>
        <Input autoComplete="street-address" placeholder="123 Main St, Augusta, GA" className="h-11" value={form.address} onChange={e => setForm((f: any) => ({ ...f, address: e.target.value }))} data-testid="input-address" />
      </div>

      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Loss type</Label>
        <div className="grid grid-cols-3 gap-2 mt-1">
          {LOSS_TILES.map(({ key, label, Icon, tint }) => {
            const active = form.lossType === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setForm((f: any) => ({ ...f, lossType: key }))}
                className={`flex flex-col items-center justify-center gap-1 h-20 rounded-lg border-2 transition-colors ${
                  active
                    ? "border-[hsl(var(--titan-red))] bg-[hsl(var(--titan-red))]/10"
                    : "border-border hover:bg-muted"
                }`}
                data-testid={`tile-loss-${key}`}
              >
                <Icon className={`w-6 h-6 ${active ? "text-[hsl(var(--titan-red))]" : tint}`} />
                <span className={`text-xs font-medium ${active ? "text-[hsl(var(--titan-red))]" : ""}`}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {form.lossType === "water" && (
        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Water category</Label>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {([
              { key: "category1", short: "Cat 1", long: "Clean" },
              { key: "category2", short: "Cat 2", long: "Gray"  },
              { key: "category3", short: "Cat 3", long: "Black" },
            ] as const).map(c => {
              const active = form.waterCategory === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setForm((f: any) => ({ ...f, waterCategory: c.key }))}
                  className={`h-14 rounded-lg border-2 transition-colors ${active ? "border-[hsl(var(--titan-blue))] bg-[hsl(var(--titan-blue))]/10" : "border-border hover:bg-muted"}`}
                  data-testid={`tile-water-${c.key}`}
                >
                  <div className={`text-sm font-semibold ${active ? "text-[hsl(var(--titan-blue))]" : ""}`}>{c.short}</div>
                  <div className="text-[10px] text-muted-foreground">{c.long}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Rooms affected</Label>
        <Input type="number" inputMode="numeric" min={0} placeholder="e.g. 2" className="h-11" value={form.roomCount} onChange={e => setForm((f: any) => ({ ...f, roomCount: e.target.value }))} data-testid="input-room-count" />
      </div>

      <div className="grid grid-cols-1 gap-2">
        <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${form.activeFlow ? "border-orange-500 bg-orange-50 dark:bg-orange-950/30" : "border-border hover:bg-muted"}`}>
          <input type="checkbox" className="w-5 h-5" checked={form.activeFlow} onChange={e => setForm((f: any) => ({ ...f, activeFlow: e.target.checked }))} data-testid="checkbox-active-flow" />
          <div>
            <div className="font-semibold text-orange-700 dark:text-orange-300">Active water flow</div>
            <div className="text-[11px] text-muted-foreground">Water still running — elevate urgency</div>
          </div>
        </label>
        <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${form.electricalExposure ? "border-red-500 bg-red-50 dark:bg-red-950/30" : "border-border hover:bg-muted"}`}>
          <input type="checkbox" className="w-5 h-5" checked={form.electricalExposure} onChange={e => setForm((f: any) => ({ ...f, electricalExposure: e.target.checked }))} data-testid="checkbox-electrical" />
          <div>
            <div className="font-semibold text-red-700 dark:text-red-300">Electrical exposure</div>
            <div className="text-[11px] text-muted-foreground">Water near outlets/panels — SAFETY FIRST</div>
          </div>
        </label>
      </div>
    </>
  );
}

export default function EmergencyIntake() {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [showNew, setShowNew] = useState(false);
  const [dispatchId, setDispatchId] = useState<number | null>(null);
  const [dispatchForm, setDispatchForm] = useState({ tech: "" });
  const [form, setForm] = useState({
    callerName: "", callerPhone: "", address: "", lossType: "water",
    waterCategory: "category1", activeFlow: false, roomCount: "", electricalExposure: false,
  });

  const { data: intakes = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/emergency-intakes"], queryFn: () => apiRequest("/api/emergency-intakes").then(r => r.json()) });

  const createIntake = useMutation({
    mutationFn: (d: any) => apiRequest("/api/emergency-intakes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/emergency-intakes"] }); setShowNew(false); },
  });
  const dispatch = useMutation({
    mutationFn: ({ id, tech }: any) => apiRequest(`/api/emergency-intakes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dispatchedTech: tech, status: "dispatched" }) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/emergency-intakes"] }); setDispatchId(null); },
  });

  const urgencyColor = (score: number) => score >= 8 ? "text-red-500" : score >= 5 ? "text-orange-500" : "text-yellow-500";
  const urgencyLabel = (score: number) => score >= 8 ? "CRITICAL" : score >= 5 ? "HIGH" : "MODERATE";
  const statusBadge = (s: string) => s === "dispatched" ? "secondary" : s === "converted" ? "outline" : s === "cancelled" ? "destructive" : "outline";

  const pendingCount = intakes.filter(i => i.status === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Emergency Intake & Dispatch</h1>
          <p className="text-sm text-muted-foreground">AI-scored triage, urgency ranking, and crew dispatch — 24/7</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && <Badge variant="destructive" className="animate-pulse">{pendingCount} pending</Badge>}
          {/* --------------------------------------------------------------
              MOBILE-FIRST INTAKE — nearly every emergency lead is entered
              from a phone. On <768px we render a full-height bottom Sheet
              with big loss-type tiles, single-column fields, phone
              auto-format, and a sticky bottom Create button. Desktop keeps
              the classic modal Dialog.
              -------------------------------------------------------------- */}
          {isMobile ? (
            <Sheet open={showNew} onOpenChange={setShowNew}>
              <SheetTrigger asChild>
                <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white" data-testid="button-new-intake"><Phone className="w-4 h-4 mr-2" />New Call</Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="h-[95vh] p-0 flex flex-col">
                <SheetHeader className="px-4 py-3 border-b sticky top-0 bg-background z-10">
                  <SheetTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="w-5 h-5 text-red-500" />Emergency Intake
                  </SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 pb-24">
                  <IntakeFormBody form={form} setForm={setForm} />
                </div>
                <div className="border-t px-4 py-3 bg-background sticky bottom-0 pb-[env(safe-area-inset-bottom)]">
                  <Button
                    className="w-full h-12 text-base bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
                    onClick={() => createIntake.mutate({ callerName: form.callerName, callerPhone: form.callerPhone, address: form.address, lossType: form.lossType, waterCategory: form.lossType === "water" ? form.waterCategory : undefined, activeFlow: form.activeFlow, roomCount: form.roomCount ? Number(form.roomCount) : undefined, electricalExposure: form.electricalExposure })}
                    disabled={!form.callerPhone || createIntake.isPending}
                    data-testid="button-create-intake"
                  >
                    {createIntake.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Logging…</> : "Log Emergency Call"}
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          ) : (
            <Dialog open={showNew} onOpenChange={setShowNew}>
              <DialogTrigger asChild>
                <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white" data-testid="button-new-intake"><Phone className="w-4 h-4 mr-2" />New Emergency Call</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-500" />Emergency Intake — Triage Form</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <IntakeFormBody form={form} setForm={setForm} />
                  <Button
                    className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
                    onClick={() => createIntake.mutate({ callerName: form.callerName, callerPhone: form.callerPhone, address: form.address, lossType: form.lossType, waterCategory: form.lossType === "water" ? form.waterCategory : undefined, activeFlow: form.activeFlow, roomCount: form.roomCount ? Number(form.roomCount) : undefined, electricalExposure: form.electricalExposure })}
                    disabled={!form.callerPhone || createIntake.isPending}
                    data-testid="button-create-intake"
                  >
                    {createIntake.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Logging…</> : "Log Emergency Call"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : intakes.length === 0 ? (
        <Card><CardContent className="p-8 text-center">
          <Phone className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">No emergency calls logged</p>
          <p className="text-sm text-muted-foreground mt-1">Log after-hours emergency calls here for AI triage scoring and crew dispatch</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {intakes.map((intake: any) => {
            const Icon = LOSS_ICONS[intake.loss_type] || Zap;
            return (
              <Card key={intake.id} className={`border-l-4 ${intake.status === "pending" ? "border-l-red-500" : intake.status === "dispatched" ? "border-l-[hsl(var(--titan-blue))]" : "border-l-green-500"}`} data-testid={`card-intake-${intake.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-muted rounded-lg shrink-0"><Icon className="w-5 h-5 text-muted-foreground" /></div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold">{intake.caller_name || intake.caller_phone}</p>
                          <Badge variant={statusBadge(intake.status) as any} className="text-xs">{intake.status}</Badge>
                          <span className={`text-xs font-bold uppercase ${urgencyColor(intake.urgency_score)}`}>{urgencyLabel(intake.urgency_score)} ({intake.urgency_score}/10)</span>
                        </div>
                        {intake.address && <p className="text-sm text-muted-foreground mt-0.5">{intake.address}</p>}
                        {intake.ai_notes && <p className="text-xs text-muted-foreground mt-1 bg-muted/40 rounded p-1.5">{intake.ai_notes}</p>}
                        {intake.dispatched_tech && <p className="text-xs text-[hsl(var(--titan-blue))] mt-1 font-medium">→ Dispatched to {intake.dispatched_tech}</p>}
                        <p className="text-xs text-muted-foreground mt-1">{new Date(intake.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {intake.status === "pending" && (
                        <Dialog open={dispatchId === intake.id} onOpenChange={v => setDispatchId(v ? intake.id : null)}>
                          <DialogTrigger asChild>
                            <Button size="sm" className="bg-[hsl(var(--titan-blue))] text-white shrink-0" data-testid={`button-dispatch-${intake.id}`}><Zap className="w-3 h-3 mr-1" />Dispatch</Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader><DialogTitle>Dispatch Crew</DialogTitle></DialogHeader>
                            <div className="space-y-3">
                              <p className="text-sm text-muted-foreground">Caller: <strong>{intake.caller_name || intake.caller_phone}</strong> · {intake.address}</p>
                              <Select value={dispatchForm.tech} onValueChange={v => setDispatchForm({ tech: v })}>
                                <SelectTrigger><SelectValue placeholder="Select technician" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Cody Brantley">Cody Brantley</SelectItem>
                                  <SelectItem value="John">John</SelectItem>
                                  <SelectItem value="Mason">Mason</SelectItem>
                                  <SelectItem value="Clint">Clint</SelectItem>
                                  <SelectItem value="Blake">Blake</SelectItem>
                                  <SelectItem value="Blake Foster">Blake Foster</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button className="w-full bg-[hsl(var(--titan-red))] text-white" onClick={() => dispatch.mutate({ id: intake.id, tech: dispatchForm.tech })} disabled={!dispatchForm.tech}>Confirm Dispatch</Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                      <DeleteIntakeBtn id={intake.id} label={intake.caller_name || intake.caller_phone} onDone={() => qc.invalidateQueries({ queryKey: ["/api/emergency-intakes"] })} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
