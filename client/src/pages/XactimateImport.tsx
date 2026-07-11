import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Upload, FileText, CheckCircle2, AlertCircle, ArrowRight, Clipboard, Wand2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { Job } from "@shared/schema";

// Parse Xactimate-style tab-delimited or pipe-delimited line items
function parseXactimate(text: string): any[] {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const items: any[] = [];

  for (const line of lines) {
    // Skip header lines
    if (/^(item|description|code|category|qty|#)/i.test(line)) continue;
    if (line.startsWith("//") || line.startsWith("--")) continue;

    // Try tab-delimited
    let parts = line.split("\t");
    if (parts.length < 3) parts = line.split("|");
    if (parts.length < 3) parts = line.split(",");

    if (parts.length >= 3) {
      const desc = parts[0]?.trim().replace(/^"(.*)"$/, "$1") || "";
      const qty = parseFloat(parts[1]?.replace(/[^0-9.]/g, "") || "1") || 1;
      const unitStr = parts[2]?.trim() || "EA";
      const unitPrice = parseFloat(parts[3]?.replace(/[^0-9.]/g, "") || parts[2]?.replace(/[^0-9.]/g, "") || "0") || 0;
      const unit = unitStr.match(/^[0-9.]+$/) ? (parts[4]?.trim() || "EA") : unitStr;

      if (desc.length > 2) {
        items.push({ description: desc, qty, unit: unit.substring(0, 10), unitPrice, total: qty * unitPrice, category: "imported" });
      }
    } else {
      // Single line with price at end: "Demolition – Drywall 1,200 SF @ $1.25 = $1,500"
      const match = line.match(/^(.+?)\s+([\d,]+)\s+(SF|LF|SY|EA|LS|CY|HR|GAL|LB|CF|days?)\s*@?\s*\$?([\d.]+)/i);
      if (match) {
        const [, desc, qtyStr, unit, priceStr] = match;
        const qty = parseFloat(qtyStr.replace(",", "")) || 1;
        const unitPrice = parseFloat(priceStr) || 0;
        items.push({ description: desc.trim(), qty, unit: unit.toUpperCase(), unitPrice, total: qty * unitPrice, category: "imported" });
      }
    }
  }

  return items;
}

export default function XactimateImport() {
  const { toast } = useToast();
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<any[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [estTitle, setEstTitle] = useState("Imported Xactimate Estimate");
  const [importing, setImporting] = useState(false);

  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  const parseText = () => {
    const items = parseXactimate(rawText);
    if (items.length === 0) {
      toast({ title: "No items found", description: "Paste tab-delimited Xactimate export or use the format: Description | Qty | Unit | Unit Price", variant: "destructive" });
    } else {
      setParsed(items);
      toast({ title: `${items.length} line items parsed`, description: "Review below and click Import to create the estimate." });
    }
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      const subtotal = parsed.reduce((s, i) => s + (i.total || 0), 0);
      return apiRequest("POST", "/api/estimates", {
        jobId: Number(selectedJobId),
        title: estTitle,
        status: "draft",
        lineItems: parsed,
        subtotal,
        tax: 0,
        total: subtotal,
        notes: "Imported from Xactimate",
      }).then(r => r.json());
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activity-log"] });
      toast({ title: "Estimate created!", description: `${parsed.length} line items imported successfully.` });
      setRawText(""); setParsed([]); setSelectedJobId(""); setEstTitle("Imported Xactimate Estimate");
    },
    onError: () => toast({ title: "Import failed", variant: "destructive" }),
  });

  const totalValue = parsed.reduce((s, i) => s + (i.total || 0), 0);

  const SAMPLE = `Water Extraction\t800\tSF\t0.45\nStructural Drying - LGR Dehumidifier\t5\tdays\t85.00\nAir Mover - Commercial\t8\tdays\t25.00\nAntimicrobial Application\t800\tSF\t0.35\nEmergency Response\t1\tLS\t450.00`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Upload className="w-5 h-5 text-[hsl(var(--titan-blue))]" />Xactimate Import
        </h1>
        <p className="text-sm text-muted-foreground">Paste or upload an Xactimate export to auto-populate estimate line items</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clipboard className="w-4 h-4" />Paste Xactimate Data
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted/50 border border-border rounded-lg p-3 text-xs text-muted-foreground">
              <p className="font-semibold mb-1">Accepted formats:</p>
              <ul className="space-y-0.5 list-disc ml-3">
                <li>Tab-delimited: Description | Qty | Unit | Unit Price</li>
                <li>Pipe-delimited: Description | Qty | Unit | Unit Price</li>
                <li>Natural language: "Water Extraction 800 SF @ $0.45"</li>
              </ul>
            </div>
            <Textarea
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              placeholder={`Paste Xactimate line items here...\n\nExample:\n${SAMPLE}`}
              rows={10}
              className="font-mono text-xs"
              data-testid="input-xactimate-paste"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRawText(SAMPLE)}
                className="text-xs"
              >
                Load Sample
              </Button>
              <Button
                onClick={parseText}
                disabled={!rawText.trim()}
                className="bg-[hsl(var(--titan-blue))] text-white flex-1"
                data-testid="button-parse-xactimate"
              >
                <Wand2 className="w-4 h-4 mr-2" />Parse Line Items
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2"><FileText className="w-4 h-4" />Parsed Items ({parsed.length})</span>
              {parsed.length > 0 && (
                <span className="text-sm font-bold text-green-600">${totalValue.toLocaleString()}</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {parsed.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm text-center">
                <div>
                  <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  Parsed line items will appear here
                </div>
              </div>
            ) : (
              <>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {parsed.map((item, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 px-2 bg-muted/30 rounded text-xs">
                      <span className="flex-1 min-w-0 truncate font-medium">{item.description}</span>
                      <span className="text-muted-foreground mx-2 shrink-0">{item.qty} {item.unit} × ${item.unitPrice}</span>
                      <span className="font-bold text-foreground shrink-0">${(item.total || 0).toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                <div className="border-t pt-3 space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Estimate Title</label>
                    <input
                      value={estTitle}
                      onChange={e => setEstTitle(e.target.value)}
                      className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background"
                      data-testid="input-est-title"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Attach to Job</label>
                    <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                      <SelectTrigger data-testid="select-job">
                        <SelectValue placeholder="Select a job..." />
                      </SelectTrigger>
                      <SelectContent>
                        {jobs.map(j => (
                          <SelectItem key={j.id} value={String(j.id)}>
                            {j.jobNumber} — {j.address}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => importMutation.mutate()}
                    disabled={!selectedJobId || importMutation.isPending}
                    className="w-full bg-[hsl(var(--titan-red))] text-white"
                    data-testid="button-import-estimate"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Import {parsed.length} Items → Create Estimate
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
