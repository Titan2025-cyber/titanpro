import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ScanLine, ExternalLink, Link2, CheckCircle2, Clock, AlertCircle, Eye, Download, Pencil, X, Save } from "lucide-react";
import { fmtDateShort } from "@/lib/dates";

interface DocuSketchPanelProps {
  jobId: number;
  job: any;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  none:     { label: "Not Started",  color: "bg-gray-100 text-gray-600",   icon: AlertCircle  },
  pending:  { label: "Scan Pending", color: "bg-yellow-100 text-yellow-700", icon: Clock        },
  complete: { label: "Complete",     color: "bg-green-100 text-green-700",  icon: CheckCircle2 },
};

export default function DocuSketchPanel({ jobId, job }: DocuSketchPanelProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    docusketchUrl: job?.docusketch_url || "",
    docusketchProjectName: job?.docusketch_project_name || "",
    docusketchStatus: job?.docusketch_status || "none",
    docusketchSketchUrl: job?.docusketch_sketch_url || "",
    docusketchNotes: job?.docusketch_notes || "",
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/api/jobs/${jobId}/docusketch`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId] });
      queryClient.invalidateQueries({ queryKey: [`/api/jobs/${jobId}`] });
      setEditing(false);
      toast({ title: "DocuSketch info saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const statusCfg = STATUS_CONFIG[form.docusketchStatus] || STATUS_CONFIG.none;
  const StatusIcon = statusCfg.icon;

  // Derive embeddable URL from a DocuSketch share link
  // DocuSketch share URLs look like: https://app.docusketch.com/tour/share/XXXX
  // We embed them directly in an iframe
  const embedUrl = form.docusketchUrl?.trim() || "";
  const hasEmbed = embedUrl.length > 0;

  return (
    <Card className="border-2 border-[hsl(var(--titan-blue)/0.2)]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
            DocuSketch 360° Scan
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge className={statusCfg.color}>
              <StatusIcon className="w-3 h-3 mr-1" />
              {statusCfg.label}
            </Badge>
            {!editing && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="button-edit-docusketch">
                <Pencil className="w-3 h-3 mr-1" />Edit
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Edit Form ── */}
        {editing && (
          <div className="space-y-3 p-3 bg-muted/40 rounded-lg border">
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">DocuSketch Project Name</Label>
                <Input
                  placeholder="e.g. Smith Residence — Water Damage"
                  value={form.docusketchProjectName}
                  onChange={e => setForm(f => ({ ...f, docusketchProjectName: e.target.value }))}
                  data-testid="input-docusketch-project-name"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <Link2 className="w-3 h-3" />
                  360° Tour Share URL
                  <span className="text-muted-foreground font-normal ml-1">(paste from DocuSketch → Share)</span>
                </Label>
                <Input
                  placeholder="https://app.docusketch.com/tour/share/..."
                  value={form.docusketchUrl}
                  onChange={e => setForm(f => ({ ...f, docusketchUrl: e.target.value }))}
                  data-testid="input-docusketch-url"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <Download className="w-3 h-3" />
                  Sketch / ESX Download URL
                  <span className="text-muted-foreground font-normal ml-1">(optional — link to PDF or ESX file)</span>
                </Label>
                <Input
                  placeholder="https://app.docusketch.com/..."
                  value={form.docusketchSketchUrl}
                  onChange={e => setForm(f => ({ ...f, docusketchSketchUrl: e.target.value }))}
                  data-testid="input-docusketch-sketch-url"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Scan Status</Label>
                <Select
                  value={form.docusketchStatus}
                  onValueChange={v => setForm(f => ({ ...f, docusketchStatus: v }))}
                >
                  <SelectTrigger data-testid="select-docusketch-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not Started</SelectItem>
                    <SelectItem value="pending">Scan Pending / In Progress</SelectItem>
                    <SelectItem value="complete">Complete</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Internal Notes</Label>
                <Textarea
                  placeholder="e.g. Requested sketch 6/28, estimated delivery 7/1..."
                  value={form.docusketchNotes}
                  onChange={e => setForm(f => ({ ...f, docusketchNotes: e.target.value }))}
                  rows={2}
                  data-testid="input-docusketch-notes"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} data-testid="button-cancel-docusketch">
                <X className="w-3 h-3 mr-1" />Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue)/0.85)] text-white"
                data-testid="button-save-docusketch"
              >
                <Save className="w-3 h-3 mr-1" />
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        )}

        {/* ── Info display when not editing ── */}
        {!editing && (
          <div className="space-y-2 text-sm">
            {form.docusketchProjectName && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs w-24 shrink-0">Project Name</span>
                <span className="font-medium">{form.docusketchProjectName}</span>
              </div>
            )}
            {job?.docusketch_completed_at && form.docusketchStatus === "complete" && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs w-24 shrink-0">Completed</span>
                <span>{fmtDateShort(job.docusketch_completed_at)}</span>
              </div>
            )}
            {form.docusketchNotes && (
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground text-xs w-24 shrink-0 pt-0.5">Notes</span>
                <span className="text-muted-foreground italic">{form.docusketchNotes}</span>
              </div>
            )}
            {!form.docusketchUrl && !form.docusketchProjectName && (
              <p className="text-muted-foreground text-xs text-center py-2">
                No DocuSketch scan linked yet. Click Edit to add the tour URL from DocuSketch.
              </p>
            )}
          </div>
        )}

        {/* ── Action buttons ── */}
        {(form.docusketchUrl || form.docusketchSketchUrl) && !editing && (
          <div className="flex flex-wrap gap-2 pt-1">
            {form.docusketchUrl && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(form.docusketchUrl, "_blank")}
                data-testid="button-open-docusketch-tour"
              >
                <ExternalLink className="w-3 h-3 mr-1" />
                Open 360° Tour
              </Button>
            )}
            {form.docusketchSketchUrl && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(form.docusketchSketchUrl, "_blank")}
                data-testid="button-download-sketch"
              >
                <Download className="w-3 h-3 mr-1" />
                Download Sketch
              </Button>
            )}
          </div>
        )}

        {/* ── Embedded 360° Viewer ── */}
        {hasEmbed && !editing && (
          <div className="rounded-lg overflow-hidden border bg-black">
            <div className="flex items-center justify-between px-3 py-2 bg-gray-900 text-white">
              <span className="text-xs flex items-center gap-1.5">
                <Eye className="w-3 h-3 text-[hsl(var(--titan-blue))]" />
                360° Tour — {form.docusketchProjectName || "DocuSketch"}
              </span>
              <button
                onClick={() => window.open(embedUrl, "_blank")}
                className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
                data-testid="button-fullscreen-tour"
              >
                <ExternalLink className="w-3 h-3" /> Open Full Screen
              </button>
            </div>
            <iframe
              src={embedUrl}
              className="w-full"
              style={{ height: "420px", border: "none" }}
              allow="fullscreen; xr-spatial-tracking"
              loading="lazy"
              title="DocuSketch 360° Tour"
            />
          </div>
        )}

        {/* ── Sketch complete banner ── */}
        {form.docusketchStatus === "complete" && !hasEmbed && !editing && (
          <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-400">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Scan marked complete. Add the tour share URL from DocuSketch to enable the embedded viewer.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
