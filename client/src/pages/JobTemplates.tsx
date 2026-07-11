import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LayoutTemplate, Plus, Trash2, Copy, ChevronRight, BookOpen, Pencil, Save, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const LOSS_COLORS: Record<string, string> = {
  water: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  fire: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  mold: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  storm: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  biohazard: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  reconstruction: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
};

const LOSS_ICONS: Record<string, string> = {
  water: "💧", fire: "🔥", mold: "🍄", storm: "⛈️", biohazard: "☣️", reconstruction: "🏗️"
};

export default function JobTemplates() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [newName, setNewName] = useState("");
  const [newLossType, setNewLossType] = useState("water");
  const [newDesc, setNewDesc] = useState("");
  const [newProtocol, setNewProtocol] = useState("");
  const [newDays, setNewDays] = useState("");

  const { data: templates = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/job-templates"],
    queryFn: () => apiRequest("GET", "/api/job-templates").then(r => r.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/job-templates/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/job-templates"] });
      setSelected(null);
      toast({ title: "Template deleted" });
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/job-templates", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/job-templates"] });
      setShowCreate(false);
      setNewName(""); setNewLossType("water"); setNewDesc(""); setNewProtocol(""); setNewDays("");
      toast({ title: "Template created" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PUT", `/api/job-templates/${id}`, data).then(r => r.json()),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/job-templates"] });
      // Reflect saved changes in the detail pane immediately.
      setSelected((prev: any) => prev && prev.id === vars.id ? {
        ...prev,
        name: vars.data.name,
        loss_type: vars.data.lossType,
        description: vars.data.description,
        iicrc_protocol: vars.data.iicrcProtocol,
        estimated_days: vars.data.estimatedDays,
        default_scope: JSON.stringify(vars.data.defaultScope || []),
        default_equipment: JSON.stringify(vars.data.defaultEquipment || []),
      } : prev);
      setEditing(null);
      toast({ title: "Template updated" });
    },
    onError: () => toast({ title: "Could not save changes", variant: "destructive" }),
  });

  const groupedTemplates = templates.reduce((acc: Record<string, any[]>, t) => {
    if (!acc[t.loss_type]) acc[t.loss_type] = [];
    acc[t.loss_type].push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <LayoutTemplate className="w-5 h-5 text-[hsl(var(--titan-blue))]" />Job Templates
          </h1>
          <p className="text-sm text-muted-foreground">Pre-built scopes for common loss types with IICRC protocols</p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
          data-testid="button-create-template"
        >
          <Plus className="w-4 h-4 mr-2" />New Template
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Template List */}
        <div className="lg:col-span-1 space-y-4">
          {isLoading ? (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}
            </div>
          ) : (
            Object.entries(groupedTemplates).map(([lossType, group]) => (
              <div key={lossType}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  {LOSS_ICONS[lossType]} {lossType}
                </p>
                <div className="space-y-2">
                  {group.map((t: any) => (
                    <Card
                      key={t.id}
                      className={`cursor-pointer hover:shadow-sm transition-shadow ${selected?.id === t.id ? "border-[hsl(var(--titan-blue))] shadow-sm" : ""}`}
                      onClick={() => setSelected(t)}
                      data-testid={`template-card-${t.id}`}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-foreground">{t.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{t.estimated_days} days · {JSON.parse(t.default_scope || "[]").length} line items</p>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${LOSS_COLORS[t.loss_type]}`}>{t.loss_type}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Template Detail */}
        <div className="lg:col-span-2">
          {selected ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{selected.name}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">{selected.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(selected)} data-testid="button-edit-template">
                      <Pencil className="w-4 h-4 mr-1.5" />Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => deleteMutation.mutate(selected.id)} data-testid="button-delete-template">
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* IICRC Protocol */}
                {selected.iicrc_protocol && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide mb-1 flex items-center gap-1">
                      <BookOpen className="w-3 h-3" />IICRC Protocol
                    </p>
                    <p className="text-xs text-blue-800 dark:text-blue-200">{selected.iicrc_protocol}</p>
                  </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground">{selected.estimated_days || "—"}</p>
                    <p className="text-xs text-muted-foreground">Est. Days</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground">{JSON.parse(selected.default_scope || "[]").length}</p>
                    <p className="text-xs text-muted-foreground">Line Items</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground">{JSON.parse(selected.default_equipment || "[]").length}</p>
                    <p className="text-xs text-muted-foreground">Equipment</p>
                  </div>
                </div>

                {/* Scope */}
                <div>
                  <p className="text-sm font-semibold text-foreground mb-2">Default Scope</p>
                  <div className="space-y-2">
                    {JSON.parse(selected.default_scope || "[]").map((item: any, i: number) => (
                      <div key={i} className="flex items-center justify-between py-2 px-3 bg-muted/30 rounded-lg text-sm">
                        <span className="text-foreground">{item.description}</span>
                        <span className="text-muted-foreground font-mono text-xs">{item.qty} {item.unit} × ${item.unitPrice}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Equipment */}
                {JSON.parse(selected.default_equipment || "[]").length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-2">Default Equipment</p>
                    <div className="flex flex-wrap gap-2">
                      {JSON.parse(selected.default_equipment || "[]").map((eq: any, i: number) => (
                        <Badge key={i} variant="secondary">{eq.qty}x {eq.type}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="h-full flex items-center justify-center min-h-64">
              <div className="text-center p-8">
                <LayoutTemplate className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Select a template to view details</p>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Job Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Template Name</label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Cat 3 Water Loss – Sewage" data-testid="input-template-name" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Loss Type</label>
              <Select value={newLossType} onValueChange={setNewLossType}>
                <SelectTrigger data-testid="select-loss-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["water","fire","mold","storm","biohazard","reconstruction"].map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
              <Textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={2} placeholder="Brief description of when to use this template" data-testid="input-template-desc" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">IICRC Protocol Reference</label>
              <Textarea value={newProtocol} onChange={e => setNewProtocol(e.target.value)} rows={2} placeholder="e.g. IICRC S500 Category 3, Class 3 — Refer to Section 14 for black water protocols." data-testid="input-iicrc-protocol" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Estimated Days</label>
              <Input type="number" value={newDays} onChange={e => setNewDays(e.target.value)} placeholder="5" data-testid="input-estimated-days" />
            </div>
            <Button
              onClick={() => createMutation.mutate({ name: newName, lossType: newLossType, description: newDesc, iicrcProtocol: newProtocol, estimatedDays: newDays ? Number(newDays) : null, defaultScope: [], defaultEquipment: [] })}
              disabled={!newName || createMutation.isPending}
              className="w-full bg-[hsl(var(--titan-red))] text-white"
              data-testid="button-save-template"
            >
              Create Template
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <EditTemplateDialog
        template={editing}
        onClose={() => setEditing(null)}
        onSave={(data) => updateMutation.mutate({ id: editing.id, data })}
        saving={updateMutation.isPending}
      />
    </div>
  );
}

// ── Edit Template Dialog ──────────────────────────────────────────────────────
type ScopeItem = { description: string; qty: number | string; unit: string; unitPrice: number | string };
type EquipItem = { type: string; qty: number | string };

function EditTemplateDialog({
  template, onClose, onSave, saving,
}: {
  template: any | null;
  onClose: () => void;
  onSave: (data: any) => void;
  saving: boolean;
}) {
  const [name, setName] = useState("");
  const [lossType, setLossType] = useState("water");
  const [description, setDescription] = useState("");
  const [protocol, setProtocol] = useState("");
  const [days, setDays] = useState("");
  const [scope, setScope] = useState<ScopeItem[]>([]);
  const [equipment, setEquipment] = useState<EquipItem[]>([]);

  // Seed the form whenever a new template is opened for editing.
  useEffect(() => {
    if (!template) return;
    setName(template.name || "");
    setLossType(template.loss_type || "water");
    setDescription(template.description || "");
    setProtocol(template.iicrc_protocol || "");
    setDays(template.estimated_days != null ? String(template.estimated_days) : "");
    try { setScope(JSON.parse(template.default_scope || "[]")); } catch { setScope([]); }
    try { setEquipment(JSON.parse(template.default_equipment || "[]")); } catch { setEquipment([]); }
  }, [template]);

  const updateScope = (i: number, key: keyof ScopeItem, val: string) =>
    setScope(s => s.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  const addScope = () => setScope(s => [...s, { description: "", qty: 1, unit: "ea", unitPrice: 0 }]);
  const removeScope = (i: number) => setScope(s => s.filter((_, idx) => idx !== i));

  const updateEquip = (i: number, key: keyof EquipItem, val: string) =>
    setEquipment(e => e.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  const addEquip = () => setEquipment(e => [...e, { type: "", qty: 1 }]);
  const removeEquip = (i: number) => setEquipment(e => e.filter((_, idx) => idx !== i));

  const handleSave = () => {
    // Normalise numeric fields and drop empty rows before saving.
    const cleanScope = scope
      .filter(r => String(r.description).trim() !== "")
      .map(r => ({
        description: String(r.description).trim(),
        qty: Number(r.qty) || 0,
        unit: String(r.unit).trim() || "ea",
        unitPrice: Number(r.unitPrice) || 0,
      }));
    const cleanEquip = equipment
      .filter(r => String(r.type).trim() !== "")
      .map(r => ({ type: String(r.type).trim(), qty: Number(r.qty) || 0 }));
    onSave({
      name: name.trim(),
      lossType,
      description: description.trim(),
      iicrcProtocol: protocol.trim(),
      estimatedDays: days ? Number(days) : null,
      defaultScope: cleanScope,
      defaultEquipment: cleanEquip,
    });
  };

  return (
    <Dialog open={!!template} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-[hsl(var(--titan-blue))]" />Edit Template
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Template Name</label>
              <Input value={name} onChange={e => setName(e.target.value)} data-testid="input-edit-name" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Loss Type</label>
              <Select value={lossType} onValueChange={setLossType}>
                <SelectTrigger data-testid="select-edit-loss-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["water","fire","mold","storm","biohazard","reconstruction"].map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Estimated Days</label>
              <Input type="number" value={days} onChange={e => setDays(e.target.value)} data-testid="input-edit-days" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} data-testid="input-edit-desc" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">IICRC Protocol Reference</label>
            <Textarea value={protocol} onChange={e => setProtocol(e.target.value)} rows={2} data-testid="input-edit-protocol" />
          </div>

          {/* Scope line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-foreground">Default Scope</label>
              <Button type="button" variant="outline" size="sm" className="text-xs h-7" onClick={addScope} data-testid="button-add-scope">
                <Plus className="w-3.5 h-3.5 mr-1" />Add Item
              </Button>
            </div>
            <div className="space-y-2">
              {scope.length === 0 && <p className="text-xs text-muted-foreground italic">No scope items. Click “Add Item” to add one.</p>}
              {scope.map((item, i) => (
                <div key={i} className="flex items-center gap-2" data-testid={`scope-row-${i}`}>
                  <Input className="flex-1 h-8 text-sm" placeholder="Description" value={item.description}
                    onChange={e => updateScope(i, "description", e.target.value)} data-testid={`input-scope-desc-${i}`} />
                  <Input className="w-16 h-8 text-sm" type="number" placeholder="Qty" value={item.qty}
                    onChange={e => updateScope(i, "qty", e.target.value)} data-testid={`input-scope-qty-${i}`} />
                  <Input className="w-16 h-8 text-sm" placeholder="Unit" value={item.unit}
                    onChange={e => updateScope(i, "unit", e.target.value)} data-testid={`input-scope-unit-${i}`} />
                  <div className="relative w-24">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                    <Input className="h-8 text-sm pl-5" type="number" placeholder="Price" value={item.unitPrice}
                      onChange={e => updateScope(i, "unitPrice", e.target.value)} data-testid={`input-scope-price-${i}`} />
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => removeScope(i)} data-testid={`button-remove-scope-${i}`}>
                    <X className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Equipment */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-foreground">Default Equipment</label>
              <Button type="button" variant="outline" size="sm" className="text-xs h-7" onClick={addEquip} data-testid="button-add-equip">
                <Plus className="w-3.5 h-3.5 mr-1" />Add Equipment
              </Button>
            </div>
            <div className="space-y-2">
              {equipment.length === 0 && <p className="text-xs text-muted-foreground italic">No equipment. Click “Add Equipment” to add one.</p>}
              {equipment.map((eq, i) => (
                <div key={i} className="flex items-center gap-2" data-testid={`equip-row-${i}`}>
                  <Input className="flex-1 h-8 text-sm" placeholder="Equipment type (e.g. Air Mover)" value={eq.type}
                    onChange={e => updateEquip(i, "type", e.target.value)} data-testid={`input-equip-type-${i}`} />
                  <Input className="w-20 h-8 text-sm" type="number" placeholder="Qty" value={eq.qty}
                    onChange={e => updateEquip(i, "qty", e.target.value)} data-testid={`input-equip-qty-${i}`} />
                  <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => removeEquip(i)} data-testid={`button-remove-equip-${i}`}>
                    <X className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose} data-testid="button-cancel-edit">Cancel</Button>
            <Button
              className="flex-1 bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
              onClick={handleSave}
              disabled={!name.trim() || saving}
              data-testid="button-save-edit"
            >
              <Save className="w-4 h-4 mr-1.5" />{saving ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
