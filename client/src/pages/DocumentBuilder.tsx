/**
 * Document Builder — Business Dev
 * Customizable branded PDF + Excel builder. Owner/Admin only.
 * Build a document from blocks (headings, text, KPIs, tables, signatures),
 * customize the title/accent, save reusable templates, and export to PDF or Excel.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, FileSpreadsheet, Eye, Plus, Trash2, Save, FolderOpen,
  Heading, AlignLeft, LayoutGrid, Table as TableIcon, PenLine, ArrowUp, ArrowDown, Palette,
} from "lucide-react";
import type { DocConfig, DocBlock } from "@/lib/documentBuilder";
import { fmtDateShort, todayLocalISO } from "@/lib/dates";

const BLOCK_META: Record<string, { label: string; icon: any }> = {
  heading: { label: "Heading", icon: Heading },
  paragraph: { label: "Text", icon: AlignLeft },
  kpis: { label: "KPI Cards", icon: LayoutGrid },
  table: { label: "Table", icon: TableIcon },
  signature: { label: "Signature", icon: PenLine },
};

function newBlock(type: string): DocBlock {
  switch (type) {
    case "heading": return { type: "heading", text: "Section Heading" };
    case "paragraph": return { type: "paragraph", text: "Enter your text here." };
    case "kpis": return { type: "kpis", items: [{ label: "Metric", value: "0" }] };
    case "table": return { type: "table", columns: ["Column A", "Column B"], rows: [["", ""]] };
    case "signature": return { type: "signature", label: "Authorized Signature", name: "" };
    default: return { type: "spacer" };
  }
}

const STARTER: DocConfig = {
  title: "Company Report",
  subtitle: "Titan Restoration LLC",
  docId: `DOC-${new Date().getFullYear()}`,
  accent: "blue",
  showHeader: true,
  showFooter: true,
  confidential: false,
  blocks: [
    { type: "heading", text: "Overview" },
    { type: "paragraph", text: "Summary of the reporting period for Titan Restoration LLC." },
    { type: "kpis", items: [
      { label: "Total Billed", value: "$0" },
      { label: "Collected", value: "$0" },
      { label: "Jobs", value: "0" },
    ]},
    { type: "heading", text: "Detail" },
    { type: "table", columns: ["Item", "Amount", "Status"], rows: [["", "", ""]] },
  ],
};

export default function DocumentBuilder() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [cfg, setCfg] = useState<DocConfig>(STARTER);
  const [tplName, setTplName] = useState("");
  const [busy, setBusy] = useState(false);

  const isOwnerAdmin = user?.role === "owner" || user?.role === "admin";

  const { data: templates = [] } = useQuery<any[]>({
    queryKey: ["/api/doc-templates"],
    queryFn: () => apiRequest("GET", "/api/doc-templates").then(r => r.json()).catch(() => []),
    enabled: isOwnerAdmin,
  });

  const saveTpl = useMutation({
    mutationFn: () => apiRequest("POST", "/api/doc-templates", { name: tplName || cfg.title || "Untitled", kind: "pdf", config: cfg }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/doc-templates"] }); toast({ title: "Template saved" }); setTplName(""); },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const deleteTpl = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/doc-templates/${id}`).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/doc-templates"] }); toast({ title: "Template deleted" }); },
  });

  if (!isOwnerAdmin) {
    return <div className="p-8 text-center text-muted-foreground">This module is available to owners and admins only.</div>;
  }

  const update = (fn: (c: DocConfig) => void) => setCfg(c => { const copy = structuredClone(c); fn(copy); return copy; });
  const addBlock = (type: string) => update(c => c.blocks.push(newBlock(type)));
  const removeBlock = (i: number) => update(c => c.blocks.splice(i, 1));
  const moveBlock = (i: number, dir: number) => update(c => {
    const j = i + dir; if (j < 0 || j >= c.blocks.length) return;
    [c.blocks[i], c.blocks[j]] = [c.blocks[j], c.blocks[i]];
  });

  async function exportPDF(preview = false) {
    setBusy(true);
    try {
      const { buildBrandedPDF, downloadDataUri, previewDataUri } = await import("@/lib/documentBuilder");
      const uri = buildBrandedPDF(cfg);
      const fname = `${(cfg.title || "Titan_Document").replace(/[^\w-]+/g, "_")}_${todayLocalISO()}.pdf`;
      if (preview) previewDataUri(uri); else downloadDataUri(uri, fname);
    } catch (e: any) { toast({ title: "PDF failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  }
  async function exportExcel() {
    setBusy(true);
    try {
      const { buildBrandedExcel } = await import("@/lib/excelBuilder");
      buildBrandedExcel(cfg);
      toast({ title: "Excel downloaded" });
    } catch (e: any) { toast({ title: "Excel failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5" data-testid="page-document-builder">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-6 h-6 text-[hsl(var(--titan-red))]" /> Document Builder
          </h1>
          <p className="text-sm text-muted-foreground">Build branded PDF & Excel documents. Customize, save templates, export.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => exportPDF(true)} disabled={busy} data-testid="btn-preview-pdf">
            <Eye className="w-4 h-4 mr-1.5" /> Preview
          </Button>
          <Button onClick={() => exportPDF(false)} disabled={busy} className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red))]/90" data-testid="btn-export-pdf">
            <FileText className="w-4 h-4 mr-1.5" /> {busy ? "Working…" : "Export PDF"}
          </Button>
          <Button onClick={exportExcel} disabled={busy} className="bg-green-700 hover:bg-green-800" data-testid="btn-export-excel">
            <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Export Excel
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* ── Left: document settings + blocks ── */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Palette className="w-4 h-4" /> Document Settings</CardTitle></CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-3">
              <div><Label className="text-xs">Title</Label><Input value={cfg.title} onChange={e => update(c => { c.title = e.target.value; })} data-testid="input-doc-title" /></div>
              <div><Label className="text-xs">Subtitle</Label><Input value={cfg.subtitle || ""} onChange={e => update(c => { c.subtitle = e.target.value; })} data-testid="input-doc-subtitle" /></div>
              <div><Label className="text-xs">Document ID</Label><Input value={cfg.docId || ""} onChange={e => update(c => { c.docId = e.target.value; })} data-testid="input-doc-id" /></div>
              <div>
                <Label className="text-xs">Accent Color</Label>
                <Select value={cfg.accent || "blue"} onValueChange={(v: any) => update(c => { c.accent = v; })}>
                  <SelectTrigger data-testid="select-accent"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="blue">Titan Blue</SelectItem>
                    <SelectItem value="red">Titan Red</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={cfg.showHeader !== false} onChange={e => update(c => { c.showHeader = e.target.checked; })} /> Branded header</label>
              <label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={cfg.showFooter !== false} onChange={e => update(c => { c.showFooter = e.target.checked; })} /> Branded footer</label>
              <label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={!!cfg.confidential} onChange={e => update(c => { c.confidential = e.target.checked; })} data-testid="check-confidential" /> Mark confidential</label>
            </CardContent>
          </Card>

          {/* Block editor */}
          <Card>
            <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">Content Blocks</CardTitle>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(BLOCK_META).map(([type, m]) => (
                  <Button key={type} size="sm" variant="outline" className="h-7 text-xs" onClick={() => addBlock(type)} data-testid={`add-${type}`}>
                    <m.icon className="w-3 h-3 mr-1" /> {m.label}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {cfg.blocks.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No blocks yet. Add one above.</p>}
              {cfg.blocks.map((block, i) => (
                <div key={i} className="border rounded-lg p-3 bg-muted/20" data-testid={`block-${i}`}>
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="secondary" className="text-[10px]">{BLOCK_META[block.type]?.label || block.type}</Badge>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveBlock(i, -1)}><ArrowUp className="w-3 h-3" /></Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveBlock(i, 1)}><ArrowDown className="w-3 h-3" /></Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-red-600" onClick={() => removeBlock(i)} data-testid={`remove-block-${i}`}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </div>
                  <BlockEditor block={block} onChange={(nb) => update(c => { c.blocks[i] = nb; })} />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* ── Right: templates ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Save className="w-4 h-4" /> Save as Template</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Input placeholder="Template name" value={tplName} onChange={e => setTplName(e.target.value)} data-testid="input-tpl-name" />
              <Button className="w-full" size="sm" onClick={() => saveTpl.mutate()} disabled={saveTpl.isPending} data-testid="btn-save-template">
                <Save className="w-4 h-4 mr-1.5" /> Save Template
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><FolderOpen className="w-4 h-4" /> Saved Templates</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {templates.length === 0 && <p className="text-xs text-muted-foreground">No saved templates yet.</p>}
              {templates.map((t) => (
                <div key={t.id} className="flex items-center justify-between border rounded p-2 text-xs" data-testid={`template-${t.id}`}>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{t.name}</p>
                    <p className="text-[10px] text-muted-foreground">{t.updated_at ? fmtDateShort(t.updated_at) : ""}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => { try { setCfg(JSON.parse(t.config)); toast({ title: `Loaded "${t.name}"` }); } catch {} }} data-testid={`load-template-${t.id}`}>Load</Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600" onClick={() => deleteTpl.mutate(t.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="bg-muted/30">
            <CardContent className="pt-4 text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground">Tips</p>
              <p>· PDF and Excel both use the same content blocks.</p>
              <p>· Table blocks each become their own Excel sheet.</p>
              <p>· Use Preview to open the PDF in a new tab before downloading.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── Per-block editors ──────────────────────────────────────────────────────
function BlockEditor({ block, onChange }: { block: DocBlock; onChange: (b: DocBlock) => void }) {
  if (block.type === "heading" || block.type === "paragraph") {
    const multi = block.type === "paragraph";
    return multi
      ? <Textarea rows={3} value={block.text} onChange={e => onChange({ ...block, text: e.target.value })} data-testid="block-text" />
      : <Input value={block.text} onChange={e => onChange({ ...block, text: e.target.value })} data-testid="block-text" />;
  }
  if (block.type === "signature") {
    return (
      <div className="grid sm:grid-cols-2 gap-2">
        <div><Label className="text-[10px]">Label</Label><Input value={block.label} onChange={e => onChange({ ...block, label: e.target.value })} /></div>
        <div><Label className="text-[10px]">Signer name (optional)</Label><Input value={block.name || ""} onChange={e => onChange({ ...block, name: e.target.value })} /></div>
      </div>
    );
  }
  if (block.type === "kpis") {
    return (
      <div className="space-y-2">
        {block.items.map((it, k) => (
          <div key={k} className="flex gap-2">
            <Input placeholder="Label" value={it.label} onChange={e => { const items = [...block.items]; items[k] = { ...it, label: e.target.value }; onChange({ ...block, items }); }} />
            <Input placeholder="Value" value={it.value} onChange={e => { const items = [...block.items]; items[k] = { ...it, value: e.target.value }; onChange({ ...block, items }); }} />
            <Button size="icon" variant="ghost" className="h-9 w-9 text-red-600 shrink-0" onClick={() => onChange({ ...block, items: block.items.filter((_, x) => x !== k) })}><Trash2 className="w-3 h-3" /></Button>
          </div>
        ))}
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onChange({ ...block, items: [...block.items, { label: "Metric", value: "0" }] })}><Plus className="w-3 h-3 mr-1" /> Add KPI</Button>
      </div>
    );
  }
  if (block.type === "table") {
    const setCol = (ci: number, v: string) => { const columns = [...block.columns]; columns[ci] = v; onChange({ ...block, columns }); };
    const setCell = (ri: number, ci: number, v: string) => { const rows = block.rows.map(r => [...r]); rows[ri][ci] = v; onChange({ ...block, rows }); };
    return (
      <div className="space-y-2 overflow-x-auto">
        <div className="flex gap-1 items-center">
          {block.columns.map((c, ci) => (
            <Input key={ci} className="h-7 text-xs font-semibold min-w-[100px]" value={c} onChange={e => setCol(ci, e.target.value)} />
          ))}
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Add column" onClick={() => onChange({ ...block, columns: [...block.columns, `Col ${block.columns.length + 1}`], rows: block.rows.map(r => [...r, ""]) })}><Plus className="w-3 h-3" /></Button>
        </div>
        {block.rows.map((row, ri) => (
          <div key={ri} className="flex gap-1 items-center">
            {row.map((cell, ci) => (
              <Input key={ci} className="h-7 text-xs min-w-[100px]" value={cell} onChange={e => setCell(ri, ci, e.target.value)} />
            ))}
            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600 shrink-0" onClick={() => onChange({ ...block, rows: block.rows.filter((_, x) => x !== ri) })}><Trash2 className="w-3 h-3" /></Button>
          </div>
        ))}
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onChange({ ...block, rows: [...block.rows, block.columns.map(() => "")] })}><Plus className="w-3 h-3 mr-1" /> Add Row</Button>
      </div>
    );
  }
  return <p className="text-xs text-muted-foreground">Spacer</p>;
}
