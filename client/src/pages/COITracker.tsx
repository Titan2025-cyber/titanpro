import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { Shield, Plus, AlertTriangle, CheckCircle, Clock, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const DOC_TYPES = [
  { value: "coi", label: "Certificate of Insurance (COI)" },
  { value: "ga_license", label: "Georgia Contractor License" },
  { value: "sc_license", label: "South Carolina Contractor License" },
  { value: "policy", label: "Insurance Policy" },
  { value: "bond", label: "Contractor Bond" },
  { value: "other", label: "Other Document" },
];

export default function COITracker() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ document_type: "", document_number: "", issuer: "", expires_at: "", notes: "", contact_id: "" });

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["/api/coi-records"],
    queryFn: () => apiRequest("/api/coi-records").then(r => r.json()),
  });
  const { data: contacts = [] } = useQuery({ queryKey: ["/api/contacts"], queryFn: () => apiRequest("/api/contacts").then(r => r.json()) });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/coi-records", { method: "POST", body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/coi-records"] });
      setShowForm(false);
      setForm({ document_type: "", document_number: "", issuer: "", expires_at: "", notes: "", contact_id: "" });
      toast({ title: "Document added" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/coi-records/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/coi-records"] }),
  });

  const getStatus = (expiresAt: string) => {
    const now = new Date();
    const exp = new Date(expiresAt);
    const daysLeft = Math.floor((exp.getTime() - now.getTime()) / 86400000);
    if (daysLeft < 0) return { label: "Expired", color: "bg-red-100 text-red-700", icon: "❌", daysLeft };
    if (daysLeft <= 30) return { label: "Expiring Soon", color: "bg-orange-100 text-orange-700", icon: "⚠️", daysLeft };
    if (daysLeft <= 90) return { label: "Watch", color: "bg-yellow-100 text-yellow-700", icon: "👀", daysLeft };
    return { label: "Active", color: "bg-green-100 text-green-700", icon: "✅", daysLeft };
  };

  const getContact = (id: any) => contacts.find((c: any) => c.id === Number(id));

  const expired = docs.filter((d: any) => getStatus(d.expires_at).daysLeft < 0).length;
  const expiringSoon = docs.filter((d: any) => { const s = getStatus(d.expires_at); return s.daysLeft >= 0 && s.daysLeft <= 30; }).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-blue-500" />
            COI &amp; License Renewal Tracker
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track COIs, GA/SC contractor licenses, bonds. 30 &amp; 7-day expiry alerts.
          </p>
        </div>
        <Button onClick={() => setShowForm(true)} className="bg-red-600 hover:bg-red-700 text-white" data-testid="button-add-doc">
          <Plus className="h-4 w-4 mr-2" /> Add Document
        </Button>
      </div>

      {/* Alerts Banner */}
      {(expired > 0 || expiringSoon > 0) && (
        <Card className="bg-red-50 border-red-300">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <div>
                {expired > 0 && <p className="font-semibold text-red-700">{expired} document{expired > 1 ? "s" : ""} EXPIRED — dispatch lock active</p>}
                {expiringSoon > 0 && <p className="text-orange-700">{expiringSoon} document{expiringSoon > 1 ? "s" : ""} expiring within 30 days</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Documents", val: docs.length, color: "text-foreground" },
          { label: "Active", val: docs.filter((d: any) => getStatus(d.expires_at).daysLeft >= 90).length, color: "text-green-600" },
          { label: "Expiring Soon", val: expiringSoon, color: "text-orange-600" },
          { label: "Expired", val: expired, color: "text-red-600" },
        ].map(({ label, val, color }) => (
          <Card key={label}><CardContent className="pt-3 pb-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{val}</p>
          </CardContent></Card>
        ))}
      </div>

      {/* Document List */}
      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded animate-pulse" />)}</div>
      ) : docs.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="font-semibold">No documents tracked yet</p>
          <p className="text-sm text-muted-foreground">Add your COIs, licenses, and bonds to track expiration</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {docs
            .map((d: any) => ({ ...d, status: getStatus(d.expires_at) }))
            .sort((a: any, b: any) => a.status.daysLeft - b.status.daysLeft)
            .map((doc: any) => {
              const contact = getContact(doc.contact_id);
              return (
                <Card key={doc.id} className={`border-l-4 ${doc.status.daysLeft < 0 ? "border-l-red-500" : doc.status.daysLeft <= 30 ? "border-l-orange-400" : "border-l-green-400"}`} data-testid={`card-doc-${doc.id}`}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1 flex-wrap">
                          <span className="font-bold text-sm">{DOC_TYPES.find(t => t.value === doc.document_type)?.label || doc.document_type}</span>
                          <Badge className={`text-xs ${doc.status.color}`}>{doc.status.icon} {doc.status.label}</Badge>
                          {doc.status.daysLeft >= 0 && <span className="text-xs text-muted-foreground">{doc.status.daysLeft} days remaining</span>}
                          {doc.status.daysLeft < 0 && <span className="text-xs text-red-600 font-semibold">{Math.abs(doc.status.daysLeft)} days OVERDUE</span>}
                        </div>
                        {doc.document_number && <p className="text-xs text-muted-foreground">Doc #: {doc.document_number}</p>}
                        {doc.issuer && <p className="text-xs text-muted-foreground">Issuer: {doc.issuer}</p>}
                        {contact && <p className="text-xs text-muted-foreground">Sub/Partner: {contact.name}</p>}
                        <p className="text-xs text-muted-foreground mt-1">
                          Expires: <span className="font-medium">{new Date(doc.expires_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</span>
                        </p>
                        {doc.notes && <p className="text-xs text-muted-foreground mt-1 italic">{doc.notes}</p>}
                        {doc.status.daysLeft < 0 && (
                          <div className="mt-2 flex items-center gap-1 p-2 bg-red-50 rounded">
                            <AlertTriangle className="h-3 w-3 text-red-500" />
                            <span className="text-xs text-red-700 font-semibold">DISPATCH LOCK — Renew before assigning new jobs</span>
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-red-500"
                        onClick={() => deleteMutation.mutate(doc.id)}
                        data-testid={`button-delete-${doc.id}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add COI / License Document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Document Type *</label>
              <Select value={form.document_type} onValueChange={v => setForm(f => ({ ...f, document_type: v }))}>
                <SelectTrigger data-testid="select-type"><SelectValue placeholder="Select type..." /></SelectTrigger>
                <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Document Number</label>
              <Input value={form.document_number} onChange={e => setForm(f => ({ ...f, document_number: e.target.value }))} placeholder="Policy or license number" data-testid="input-doc-number" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Issuing Authority / Insurer</label>
              <Input value={form.issuer} onChange={e => setForm(f => ({ ...f, issuer: e.target.value }))} placeholder="e.g. Hartford, State of Georgia" data-testid="input-issuer" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Expiration Date *</label>
              <Input type="date" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} data-testid="input-expires" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Sub / Partner (optional)</label>
              <Select value={form.contact_id} onValueChange={v => setForm(f => ({ ...f, contact_id: v }))}>
                <SelectTrigger data-testid="select-contact"><SelectValue placeholder="Link to contact..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {contacts.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Notes</label>
              <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any notes..." data-testid="input-notes" />
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={() => createMutation.mutate({ ...form, contact_id: form.contact_id ? Number(form.contact_id) : null, status: "active", created_at: new Date().toISOString() })} disabled={createMutation.isPending} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-submit">
                {createMutation.isPending ? "Adding..." : "Add Document"}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)} data-testid="button-cancel">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
