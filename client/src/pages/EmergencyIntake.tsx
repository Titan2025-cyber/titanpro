import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useState } from "react";
import { Phone, AlertTriangle, CheckCircle, Zap, Plus, Flame, Droplets, Wind, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

export default function EmergencyIntake() {
  const qc = useQueryClient();
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
          <Dialog open={showNew} onOpenChange={setShowNew}>
            <DialogTrigger asChild>
              <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white" data-testid="button-new-intake"><Phone className="w-4 h-4 mr-2" />New Emergency Call</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-500" />Emergency Intake — Triage Form</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Caller name" value={form.callerName} onChange={e => setForm(f => ({ ...f, callerName: e.target.value }))} data-testid="input-caller-name" />
                  <Input placeholder="Phone number *" value={form.callerPhone} onChange={e => setForm(f => ({ ...f, callerPhone: e.target.value }))} data-testid="input-caller-phone" />
                </div>
                <Input placeholder="Property address" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} data-testid="input-address" />
                <div className="grid grid-cols-2 gap-2">
                  <Select value={form.lossType} onValueChange={v => setForm(f => ({ ...f, lossType: v }))}>
                    <SelectTrigger><SelectValue placeholder="Loss type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="water">Water</SelectItem>
                      <SelectItem value="fire">Fire / Smoke</SelectItem>
                      <SelectItem value="mold">Mold</SelectItem>
                      <SelectItem value="storm">Storm</SelectItem>
                      <SelectItem value="biohazard">Biohazard</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.lossType === "water" && (
                    <Select value={form.waterCategory} onValueChange={v => setForm(f => ({ ...f, waterCategory: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="category1">Category 1 — Clean</SelectItem>
                        <SelectItem value="category2">Category 2 — Gray</SelectItem>
                        <SelectItem value="category3">Category 3 — Black</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <Input placeholder="Number of rooms affected" type="number" value={form.roomCount} onChange={e => setForm(f => ({ ...f, roomCount: e.target.value }))} data-testid="input-room-count" />
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={form.activeFlow} onChange={e => setForm(f => ({ ...f, activeFlow: e.target.checked }))} data-testid="checkbox-active-flow" />
                    <span className="font-medium text-orange-600">Active water flow</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={form.electricalExposure} onChange={e => setForm(f => ({ ...f, electricalExposure: e.target.checked }))} data-testid="checkbox-electrical" />
                    <span className="font-medium text-red-600">Electrical exposure</span>
                  </label>
                </div>
                <Button className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white" onClick={() => createIntake.mutate({ callerName: form.callerName, callerPhone: form.callerPhone, address: form.address, lossType: form.lossType, waterCategory: form.lossType === "water" ? form.waterCategory : undefined, activeFlow: form.activeFlow, roomCount: form.roomCount ? Number(form.roomCount) : undefined, electricalExposure: form.electricalExposure })} disabled={!form.callerPhone} data-testid="button-create-intake">Log Emergency Call</Button>
              </div>
            </DialogContent>
          </Dialog>
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
