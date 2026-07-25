import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Library, Plus, Search, Trash2, Copy, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ApprovedClaim {
  id: number; carrier: string; claimNumber: string; jobId: number;
  lossType: string; lineItemCode: string; lineItemDescription: string;
  approvedAmount: number; approvedDate: string; adjusterName: string; notes: string;
}

const CARRIERS = ["State Farm", "Allstate", "Nationwide", "Travelers", "USAA", "Liberty Mutual", "Farmers", "Progressive", "Erie", "Auto-Owners", "Other"];
const LOSS_TYPES = ["water", "fire", "mold", "storm", "biohazard", "reconstruction"];

export default function ApprovedClaimsLibrary() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    carrier: "", claimNumber: "", lossType: "", lineItemCode: "",
    lineItemDescription: "", approvedAmount: "", approvedDate: "",
    adjusterName: "", notes: "",
  });
  const [search, setSearch] = useState("");
  const [filterCarrier, setFilterCarrier] = useState("all");
  const [filterLoss, setFilterLoss] = useState("all");
  const [form, setForm] = useState({
    carrier: "", claimNumber: "", lossType: "", lineItemCode: "",
    lineItemDescription: "", approvedAmount: "", approvedDate: "",
    adjusterName: "", notes: "",
  });

  const { data: claims = [], isLoading } = useQuery<ApprovedClaim[]>({
    queryKey: ["/api/approved-claims", filterCarrier, filterLoss],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterCarrier !== "all") params.set("carrier", filterCarrier);
      if (filterLoss !== "all") params.set("lossType", filterLoss);
      return apiRequest(`/api/approved-claims?${params}`).then(r => r.json());
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("/api/approved-claims", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approved-claims"] });
      setOpen(false);
      setForm({ carrier: "", claimNumber: "", lossType: "", lineItemCode: "", lineItemDescription: "", approvedAmount: "", approvedDate: "", adjusterName: "", notes: "" });
      toast({ title: "Approved Line Item Saved to Library" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/approved-claims/${id}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/approved-claims"] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/approved-claims/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approved-claims"] });
      setEditingId(null);
      toast({ title: "Approved Line Item Updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const openEdit = (claim: ApprovedClaim) => {
    setEditForm({
      carrier: claim.carrier || "", claimNumber: claim.claimNumber || "", lossType: claim.lossType || "",
      lineItemCode: claim.lineItemCode || "", lineItemDescription: claim.lineItemDescription || "",
      approvedAmount: claim.approvedAmount != null ? String(claim.approvedAmount) : "",
      approvedDate: claim.approvedDate ? claim.approvedDate.slice(0, 10) : "",
      adjusterName: claim.adjusterName || "", notes: claim.notes || "",
    });
    setEditingId(claim.id);
  };

  const filtered = claims.filter(c =>
    !search ||
    c.lineItemCode?.toLowerCase().includes(search.toLowerCase()) ||
    c.lineItemDescription?.toLowerCase().includes(search.toLowerCase()) ||
    c.carrier?.toLowerCase().includes(search.toLowerCase())
  );

  const uniqueCarriers = [...new Set(claims.map(c => c.carrier))].length;

  const copyPrecedent = (claim: ApprovedClaim) => {
    const text = `PRECEDENT: ${claim.carrier} approved "${claim.lineItemCode} — ${claim.lineItemDescription}" ($${claim.approvedAmount?.toLocaleString()}) on claim ${claim.claimNumber || "N/A"} dated ${claim.approvedDate ? new Date(claim.approvedDate).toLocaleDateString() : "N/A"}${claim.adjusterName ? `, Adjuster: ${claim.adjusterName}` : ""}.`;
    navigator.clipboard.writeText(text);
    toast({ title: "Precedent Copied", description: "Paste into your supplement letter." });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Library className="w-7 h-7 text-purple-600" />
          <div>
            <h1 className="text-xl font-bold">Past Approved Claims Library</h1>
            <p className="text-sm text-muted-foreground">Search previously approved line items to cite as precedent when carriers dispute the same scope</p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-red-600 hover:bg-red-700 text-white" data-testid="button-add-approved">
              <Plus className="w-4 h-4 mr-2" />Add Approved Item
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Log Approved Line Item</DialogTitle></DialogHeader>
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Carrier</Label>
                  <Select onValueChange={v => setForm(f => ({ ...f, carrier: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select carrier..." /></SelectTrigger>
                    <SelectContent>{CARRIERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Claim #</Label><Input value={form.claimNumber} onChange={e => setForm(f => ({ ...f, claimNumber: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Loss Type</Label>
                  <Select onValueChange={v => setForm(f => ({ ...f, lossType: v }))}>
                    <SelectTrigger><SelectValue placeholder="Loss type..." /></SelectTrigger>
                    <SelectContent>{LOSS_TYPES.map(l => <SelectItem key={l} value={l} className="capitalize">{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Approved Date</Label><Input type="date" value={form.approvedDate} onChange={e => setForm(f => ({ ...f, approvedDate: e.target.value }))} /></div>
              </div>
              <div><Label>Xactimate Code</Label><Input data-testid="input-line-item-code" value={form.lineItemCode} onChange={e => setForm(f => ({ ...f, lineItemCode: e.target.value.toUpperCase() }))} placeholder="WTREQ" /></div>
              <div><Label>Description</Label><Input value={form.lineItemDescription} onChange={e => setForm(f => ({ ...f, lineItemDescription: e.target.value }))} placeholder="Equipment monitoring labor" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Approved Amount ($)</Label><Input type="number" value={form.approvedAmount} onChange={e => setForm(f => ({ ...f, approvedAmount: e.target.value }))} /></div>
                <div><Label>Adjuster Name</Label><Input value={form.adjusterName} onChange={e => setForm(f => ({ ...f, adjusterName: e.target.value }))} /></div>
              </div>
              <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
              <Button onClick={() => createMutation.mutate({ ...form, approvedAmount: parseFloat(form.approvedAmount) || null })} disabled={!form.carrier || !form.lineItemCode || createMutation.isPending} className="w-full bg-purple-600 hover:bg-purple-700 text-white">
                Save to Library
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Approved Items Logged</p><p className="text-2xl font-bold">{claims.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Carriers Covered</p><p className="text-2xl font-bold text-purple-600">{uniqueCarriers}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Approved Value</p><p className="text-2xl font-bold text-green-600">${claims.reduce((s, c) => s + (c.approvedAmount || 0), 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}</p></CardContent></Card>
      </div>

      {/* Search + Filter */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search code, description, carrier..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterCarrier} onValueChange={setFilterCarrier}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All carriers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Carriers</SelectItem>
            {CARRIERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterLoss} onValueChange={setFilterLoss}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All losses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {LOSS_TYPES.map(l => <SelectItem key={l} value={l} className="capitalize">{l}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Claims List */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Library className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No approved claims logged yet. Add items as you get approvals from carriers.</p>
              <p className="text-xs mt-1 opacity-70">Over time, this becomes your most powerful negotiation tool.</p>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map(claim => (
                <div key={claim.id} data-testid={`approved-claim-${claim.id}`} className="p-4 flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-sm bg-muted px-2 py-0.5 rounded">{claim.lineItemCode}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">{claim.carrier}</span>
                      {claim.lossType && <span className="text-xs capitalize text-muted-foreground">{claim.lossType}</span>}
                      {claim.approvedAmount && <span className="text-xs text-green-600 font-medium">${claim.approvedAmount.toLocaleString()}</span>}
                    </div>
                    <p className="text-sm">{claim.lineItemDescription}</p>
                    <p className="text-xs text-muted-foreground">
                      Claim {claim.claimNumber || "N/A"}{claim.adjusterName ? ` · ${claim.adjusterName}` : ""}{claim.approvedDate ? ` · ${new Date(claim.approvedDate).toLocaleDateString()}` : ""}
                    </p>
                    {claim.notes && <p className="text-xs text-muted-foreground italic">{claim.notes}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => copyPrecedent(claim)} className="text-xs">
                      <Copy className="w-3 h-3 mr-1" />Copy Precedent
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(claim)} className="text-muted-foreground hover:text-foreground" data-testid={`button-edit-approved-claims-${claim.id}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(claim.id)} className="text-red-500 hover:text-red-700">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editingId !== null} onOpenChange={v => { if (!v) setEditingId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Approved Line Item</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Carrier</Label>
                <Select value={editForm.carrier} onValueChange={v => setEditForm(f => ({ ...f, carrier: v }))}>
                  <SelectTrigger data-testid={`input-carrier-${editingId}`}><SelectValue placeholder="Select carrier..." /></SelectTrigger>
                  <SelectContent>{CARRIERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Claim #</Label><Input data-testid={`input-claimNumber-${editingId}`} value={editForm.claimNumber} onChange={e => setEditForm(f => ({ ...f, claimNumber: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Loss Type</Label>
                <Select value={editForm.lossType} onValueChange={v => setEditForm(f => ({ ...f, lossType: v }))}>
                  <SelectTrigger data-testid={`input-lossType-${editingId}`}><SelectValue placeholder="Loss type..." /></SelectTrigger>
                  <SelectContent>{LOSS_TYPES.map(l => <SelectItem key={l} value={l} className="capitalize">{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Approved Date</Label><Input type="date" data-testid={`input-approvedDate-${editingId}`} value={editForm.approvedDate} onChange={e => setEditForm(f => ({ ...f, approvedDate: e.target.value }))} /></div>
            </div>
            <div><Label>Xactimate Code</Label><Input data-testid={`input-lineItemCode-${editingId}`} value={editForm.lineItemCode} onChange={e => setEditForm(f => ({ ...f, lineItemCode: e.target.value.toUpperCase() }))} placeholder="WTREQ" /></div>
            <div><Label>Description</Label><Input data-testid={`input-lineItemDescription-${editingId}`} value={editForm.lineItemDescription} onChange={e => setEditForm(f => ({ ...f, lineItemDescription: e.target.value }))} placeholder="Equipment monitoring labor" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Approved Amount ($)</Label><Input type="number" data-testid={`input-approvedAmount-${editingId}`} value={editForm.approvedAmount} onChange={e => setEditForm(f => ({ ...f, approvedAmount: e.target.value }))} /></div>
              <div><Label>Adjuster Name</Label><Input data-testid={`input-adjusterName-${editingId}`} value={editForm.adjusterName} onChange={e => setEditForm(f => ({ ...f, adjusterName: e.target.value }))} /></div>
            </div>
            <div><Label>Notes</Label><Textarea data-testid={`input-notes-${editingId}`} value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
            <Button
              onClick={() => editingId !== null && updateMutation.mutate({ id: editingId, data: { ...editForm, approvedAmount: parseFloat(editForm.approvedAmount) || null } })}
              disabled={!editForm.carrier || !editForm.lineItemCode || updateMutation.isPending}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white"
              data-testid={`button-save-approved-claims-${editingId}`}
            >
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
