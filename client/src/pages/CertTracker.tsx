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
import { useToast } from "@/hooks/use-toast";
import { Plus, AlertTriangle, CheckCircle, Clock, Trash2, GraduationCap } from "lucide-react";

const CERT_TYPES = [
  { value: "WRT", label: "WRT — Water Restoration Technician" },
  { value: "ASD", label: "ASD — Applied Structural Drying" },
  { value: "AMRT", label: "AMRT — Applied Microbial Remediation" },
  { value: "FSRT", label: "FSRT — Fire & Smoke Restoration" },
  { value: "OCT", label: "OCT — Odor Control Technician" },
  { value: "CCT", label: "CCT — Carpet Cleaning Technician" },
  { value: "RCT", label: "RCT — Rug Cleaning Technician" },
  { value: "OSHA10", label: "OSHA 10 — General Industry Safety" },
  { value: "OSHA30", label: "OSHA 30 — General Industry Safety" },
  { value: "other", label: "Other" },
];

const EMPLOYEES = ["Cody Brantley", "John", "Mason", "Clint", "Blake", "Blake Foster"];

function daysUntil(dateStr: string) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
}

function certStatus(exp: string | null) {
  if (!exp) return "active";
  const days = daysUntil(exp);
  if (days === null) return "active";
  if (days < 0) return "expired";
  if (days <= 30) return "expiring_soon";
  if (days <= 60) return "expiring_soon";
  return "active";
}

const STATUS_META: Record<string, { label: string; color: string; badge: string }> = {
  active: { label: "Active", color: "text-green-600", badge: "bg-green-100 text-green-800" },
  expiring_soon: { label: "Expiring Soon", color: "text-yellow-600", badge: "bg-yellow-100 text-yellow-800" },
  expired: { label: "Expired", color: "text-red-600", badge: "bg-red-100 text-red-800" },
};

export default function CertTracker() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employeeName: "", certType: "", certNumber: "", issuedBy: "IICRC", issuedDate: "", expirationDate: "" });

  const { data: certs = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/certifications"] });

  const saveMutation = useMutation({
    mutationFn: (d: any) => apiRequest("POST", "/api/certifications", d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/certifications"] }); setOpen(false); toast({ title: "Certification added" }); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/certifications/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/certifications"] }); toast({ title: "Certification removed" }); },
  });

  // Group by employee
  const byEmployee: Record<string, any[]> = {};
  (certs as any[]).forEach((c: any) => {
    if (!byEmployee[c.employeeName]) byEmployee[c.employeeName] = [];
    byEmployee[c.employeeName].push(c);
  });

  const expiringSoon = (certs as any[]).filter((c: any) => certStatus(c.expirationDate) === "expiring_soon");
  const expired = (certs as any[]).filter((c: any) => certStatus(c.expirationDate) === "expired");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">IICRC Certification Tracker</h1>
          <p className="text-sm text-muted-foreground">Track certifications, expiration dates, and renewal alerts</p>
        </div>
        <Button className="bg-primary text-primary-foreground" onClick={() => setOpen(true)} data-testid="button-add-cert">
          <Plus className="w-4 h-4 mr-2" /> Add Certification
        </Button>
      </div>

      {/* Alerts */}
      {(expiringSoon.length > 0 || expired.length > 0) && (
        <div className="space-y-2">
          {expired.length > 0 && (
            <Card className="border-red-400 bg-red-50 dark:bg-red-950">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-800 dark:text-red-200">{expired.length} expired certification{expired.length > 1 ? "s" : ""}</p>
                  <p className="text-xs text-red-700 dark:text-red-300">{expired.map((c: any) => `${c.employeeName} (${c.certType})`).join(", ")}</p>
                </div>
              </CardContent>
            </Card>
          )}
          {expiringSoon.length > 0 && (
            <Card className="border-yellow-400 bg-yellow-50 dark:bg-yellow-950">
              <CardContent className="p-4 flex items-start gap-3">
                <Clock className="w-5 h-5 text-yellow-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">{expiringSoon.length} certification{expiringSoon.length > 1 ? "s" : ""} expiring within 60 days</p>
                  <p className="text-xs text-yellow-700 dark:text-yellow-300">{expiringSoon.map((c: any) => `${c.employeeName} — ${c.certType} (${daysUntil(c.expirationDate)}d)`).join(", ")}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Certs</p><p className="text-xl font-bold">{(certs as any[]).length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Active</p><p className="text-xl font-bold text-green-600">{(certs as any[]).filter((c: any) => certStatus(c.expirationDate) === "active").length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Needs Renewal</p><p className="text-xl font-bold text-red-600">{expired.length + expiringSoon.length}</p></CardContent></Card>
      </div>

      {/* By Employee */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-muted rounded animate-pulse" />)}</div>
      ) : Object.keys(byEmployee).length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <GraduationCap className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
          <p>No certifications tracked yet.</p>
          <p className="text-xs mt-1">Add IICRC certs for each technician to track expiration dates and compliance.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(byEmployee).map(([emp, empCerts]) => (
            <Card key={emp}>
              <CardHeader className="pb-2"><CardTitle className="text-sm">{emp}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {empCerts.map((cert: any) => {
                  const status = certStatus(cert.expirationDate);
                  const meta = STATUS_META[status];
                  const days = cert.expirationDate ? daysUntil(cert.expirationDate) : null;
                  const certLabel = CERT_TYPES.find(ct => ct.value === cert.certType)?.label || cert.certType;
                  return (
                    <div key={cert.id} className="flex items-center justify-between p-2 rounded bg-muted/30" data-testid={`row-cert-${cert.id}`}>
                      <div>
                        <p className="text-sm font-medium">{certLabel}</p>
                        <p className="text-xs text-muted-foreground">
                          {cert.issuedBy}{cert.certNumber ? ` · #${cert.certNumber}` : ""}
                          {cert.issuedDate ? ` · Issued ${cert.issuedDate}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {cert.expirationDate && (
                          <div className="text-right">
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${meta.badge}`}>{meta.label}</span>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {days !== null && days >= 0 ? `Expires ${cert.expirationDate} (${days}d)` : days !== null ? `Expired ${Math.abs(days)}d ago` : ""}
                            </p>
                          </div>
                        )}
                        {!cert.expirationDate && <span className="text-xs px-2 py-0.5 rounded font-medium bg-green-100 text-green-800">No Expiry</span>}
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate(cert.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Certification</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Technician</Label>
              <Select value={form.employeeName} onValueChange={v => setForm(f => ({ ...f, employeeName: v }))}>
                <SelectTrigger data-testid="select-emp"><SelectValue placeholder="Select technician" /></SelectTrigger>
                <SelectContent>{EMPLOYEES.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Certification Type</Label>
              <Select value={form.certType} onValueChange={v => setForm(f => ({ ...f, certType: v }))}>
                <SelectTrigger data-testid="select-cert-type"><SelectValue placeholder="Select certification" /></SelectTrigger>
                <SelectContent>{CERT_TYPES.map(ct => <SelectItem key={ct.value} value={ct.value}>{ct.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Issued By</Label><Input value={form.issuedBy} onChange={e => setForm(f => ({ ...f, issuedBy: e.target.value }))} /></div>
              <div><Label>Cert Number</Label><Input value={form.certNumber} onChange={e => setForm(f => ({ ...f, certNumber: e.target.value }))} placeholder="Optional" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Issue Date</Label><Input type="date" value={form.issuedDate} onChange={e => setForm(f => ({ ...f, issuedDate: e.target.value }))} /></div>
              <div><Label>Expiration Date</Label><Input type="date" value={form.expirationDate} onChange={e => setForm(f => ({ ...f, expirationDate: e.target.value }))} /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending || !form.employeeName || !form.certType} data-testid="button-save-cert">Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
