import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Zap, CheckCircle, AlertTriangle, FileText, TrendingUp, Plus, RefreshCw } from "lucide-react";

// IICRC-based supplement gap library
const IICRC_LINE_ITEMS: Record<string, { category: string; items: { code: string; description: string; unit: string; tipicalCost: number }[] }> = {
  water: {
    category: "Water Damage (S500)",
    items: [
      { code: "WTR-DRY-001", description: "Air mover — daily rate per unit (S500 §12.4)", unit: "EA/day", tipicalCost: 45 },
      { code: "WTR-DRY-002", description: "Dehumidifier LGR — daily rate (S500 §12.5)", unit: "EA/day", tipicalCost: 85 },
      { code: "WTR-DRY-003", description: "Desiccant dehumidifier (large loss)", unit: "EA/day", tipicalCost: 250 },
      { code: "WTR-MON-001", description: "Moisture mapping — per room (S500 §9.1)", unit: "EA", tipicalCost: 75 },
      { code: "WTR-AQI-001", description: "Air quality monitoring — HEPA air scrubber/day", unit: "EA/day", tipicalCost: 65 },
      { code: "WTR-DEM-001", description: "Controlled demolition — wet drywall per SF", unit: "SF", tipicalCost: 3.5 },
      { code: "WTR-ANT-001", description: "Antimicrobial treatment per SF", unit: "SF", tipicalCost: 0.85 },
      { code: "WTR-PPE-001", description: "PPE and safety supplies (Cat 3 water)", unit: "LS", tipicalCost: 125 },
      { code: "WTR-DOC-001", description: "Drying documentation — daily log and IICRC report", unit: "EA", tipicalCost: 55 },
      { code: "WTR-INS-001", description: "Temporary power / generator (large loss)", unit: "day", tipicalCost: 175 },
    ],
  },
  fire: {
    category: "Fire & Smoke (S700)",
    items: [
      { code: "FIR-OZN-001", description: "Ozone treatment — per room (S700 §8.3)", unit: "EA", tipicalCost: 150 },
      { code: "FIR-TPC-001", description: "Thermal fogging — odor neutralization", unit: "EA", tipicalCost: 225 },
      { code: "FIR-HEPA-001", description: "HEPA vacuuming — soot/char per SF (S700 §7.1)", unit: "SF", tipicalCost: 1.25 },
      { code: "FIR-CHR-001", description: "Char removal — per SF (S700 §10.2)", unit: "SF", tipicalCost: 4.75 },
      { code: "FIR-CAB-001", description: "Cabinet interior clean/deodorize", unit: "EA", tipicalCost: 85 },
      { code: "FIR-HVA-001", description: "HVAC duct cleaning — per linear ft", unit: "LF", tipicalCost: 12 },
      { code: "FIR-CON-001", description: "Contents pack-out / inventory", unit: "HR", tipicalCost: 65 },
      { code: "FIR-STO-001", description: "Contents storage — per month", unit: "MO", tipicalCost: 250 },
      { code: "FIR-INS-001", description: "Insulation removal (smoke-saturated) per SF", unit: "SF", tipicalCost: 1.75 },
    ],
  },
  mold: {
    category: "Mold Remediation (S520)",
    items: [
      { code: "MLD-TEST-001", description: "Pre-remediation air sampling — 3 samples (S520 §6.2)", unit: "EA", tipicalCost: 350 },
      { code: "MLD-POST-001", description: "Post-remediation clearance sampling", unit: "EA", tipicalCost: 350 },
      { code: "MLD-CONT-001", description: "Containment — critical barriers per SF (S520 §9.1)", unit: "SF", tipicalCost: 2.5 },
      { code: "MLD-NEG-001", description: "Negative air machine — daily rate (S520 §9.3)", unit: "day", tipicalCost: 90 },
      { code: "MLD-REM-001", description: "Mold-affected drywall removal per SF", unit: "SF", tipicalCost: 5.25 },
      { code: "MLD-HEPA-001", description: "HEPA vacuuming — remediation area per SF", unit: "SF", tipicalCost: 1.5 },
      { code: "MLD-ANT-001", description: "Encapsulant application per SF", unit: "SF", tipicalCost: 1.1 },
      { code: "MLD-WAS-001", description: "Waste disposal — mold debris (bags)", unit: "EA", tipicalCost: 35 },
    ],
  },
  storm: {
    category: "Storm / Structural",
    items: [
      { code: "STM-TARPS-001", description: "Emergency tarp — roof per SQ (100SF)", unit: "SQ", tipicalCost: 95 },
      { code: "STM-BOARD-001", description: "Board-up — window/door per opening", unit: "EA", tipicalCost: 125 },
      { code: "STM-DEB-001", description: "Debris removal — per CY (cubic yard)", unit: "CY", tipicalCost: 75 },
      { code: "STM-TREE-001", description: "Emergency tree/limb removal per hour", unit: "HR", tipicalCost: 185 },
      { code: "STM-INV-001", description: "Structural assessment / photo documentation", unit: "LS", tipicalCost: 225 },
    ],
  },
};

export default function AISupplementEngine() {
  const { toast } = useToast();
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [selectedEstimateId, setSelectedEstimateId] = useState<string>("");
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const { data: jobs = [] } = useQuery<any[]>({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then((r) => r.json()),
  });

  const { data: estimates = [] } = useQuery<any[]>({
    queryKey: ["/api/estimates"],
    queryFn: () => apiRequest("/api/estimates").then((r) => r.json()),
  });

  const { data: lineItems = [] } = useQuery<any[]>({
    queryKey: ["/api/line-items"],
    queryFn: () => apiRequest("/api/line-items").then((r) => r.json()),
  });

  const addLineMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest("/api/line-items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/line-items"] });
      toast({ title: "Line item added to estimate" });
    },
  });

  const selectedJob = jobs.find((j: any) => String(j.id) === selectedJobId);
  const jobEstimates = estimates.filter((e: any) => String(e.jobId) === selectedJobId);
  const selectedEstimate = estimates.find((e: any) => String(e.id) === selectedEstimateId);

  // Existing line items for the selected estimate
  const existingLines = lineItems.filter((li: any) => String(li.estimateId) === selectedEstimateId);
  const existingDescriptions = existingLines.map((li: any) => (li.description || "").toLowerCase());

  function analyzeGaps() {
    if (!selectedJob || !selectedEstimateId) return;
    setIsAnalyzing(true);

    setTimeout(() => {
      const lossType = (selectedJob.lossType || "water").toLowerCase();
      const library = IICRC_LINE_ITEMS[lossType] || IICRC_LINE_ITEMS["water"];

      // Find missing items
      const missing = library.items.filter((item) => {
        const alreadyPresent = existingDescriptions.some(
          (d) => d.includes(item.code.toLowerCase()) || d.includes(item.description.toLowerCase().slice(0, 20))
        );
        return !alreadyPresent;
      });

      // Potential supplement value
      const potentialValue = missing.reduce((s, item) => s + item.tipicalCost, 0);

      setAnalysisResult({
        lossType,
        category: library.category,
        existingCount: existingLines.length,
        missingItems: missing,
        potentialValue,
        timestamp: new Date().toLocaleTimeString(),
      });
      setIsAnalyzing(false);
    }, 1200);
  }

  function addItem(item: any) {
    if (!selectedEstimateId) return;
    addLineMutation.mutate({
      estimateId: parseInt(selectedEstimateId),
      description: `${item.description} [${item.code}]`,
      unit: item.unit,
      quantity: 1,
      unitPrice: item.tipicalCost,
    });
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" /> AI Supplement Intelligence Engine
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Scan existing estimates against IICRC standards to detect missing line items and maximize supplement recovery
        </p>
      </div>

      {/* Job + Estimate Selectors */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Select Job</Label>
              <Select value={selectedJobId} onValueChange={(v) => { setSelectedJobId(v); setSelectedEstimateId(""); setAnalysisResult(null); }}>
                <SelectTrigger data-testid="select-job">
                  <SelectValue placeholder="Choose a job..." />
                </SelectTrigger>
                <SelectContent>
                  {jobs.map((j: any) => (
                    <SelectItem key={j.id} value={String(j.id)}>
                      TP-{String(j.id).padStart(4, "0")} — {j.address?.substring(0, 25) || "N/A"} ({j.lossType})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Select Estimate</Label>
              <Select value={selectedEstimateId} onValueChange={(v) => { setSelectedEstimateId(v); setAnalysisResult(null); }} disabled={!selectedJobId}>
                <SelectTrigger data-testid="select-estimate">
                  <SelectValue placeholder="Choose an estimate..." />
                </SelectTrigger>
                <SelectContent>
                  {jobEstimates.length === 0 ? (
                    <SelectItem value="none" disabled>No estimates for this job</SelectItem>
                  ) : (
                    jobEstimates.map((e: any) => (
                      <SelectItem key={e.id} value={String(e.id)}>EST-{String(e.id).padStart(4, "0")} — ${(e.totalAmount || 0).toLocaleString()}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                onClick={analyzeGaps}
                disabled={!selectedEstimateId || isAnalyzing}
                data-testid="button-analyze"
              >
                {isAnalyzing ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Analyzing...</>
                ) : (
                  <><Zap className="w-4 h-4 mr-2" />Scan for Gaps</>
                )}
              </Button>
            </div>
          </div>

          {selectedJob && (
            <div className="bg-muted/50 rounded-lg p-3 flex gap-4 text-sm flex-wrap">
              <span><b>Job:</b> TP-{String(selectedJob.id).padStart(4, "0")}</span>
              <span><b>Loss Type:</b> {selectedJob.lossType || "N/A"}</span>
              <span><b>Address:</b> {selectedJob.address || "N/A"}</span>
              <span><b>Carrier:</b> {selectedJob.insuranceCarrier || "N/A"}</span>
              <span><b>Current Lines:</b> {existingLines.length}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analysis Result */}
      {analysisResult && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Card className="border-green-200 dark:border-green-800">
              <CardContent className="p-4 text-center">
                <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
                <p className="text-2xl font-bold">{analysisResult.existingCount}</p>
                <p className="text-xs text-muted-foreground">Existing Line Items</p>
              </CardContent>
            </Card>
            <Card className="border-yellow-200 dark:border-yellow-800">
              <CardContent className="p-4 text-center">
                <AlertTriangle className="w-8 h-8 text-yellow-500 mx-auto mb-2" />
                <p className="text-2xl font-bold">{analysisResult.missingItems.length}</p>
                <p className="text-xs text-muted-foreground">Potential Missing Items</p>
              </CardContent>
            </Card>
            <Card className="border-blue-200 dark:border-blue-800">
              <CardContent className="p-4 text-center">
                <TrendingUp className="w-8 h-8 text-blue-500 mx-auto mb-2" />
                <p className="text-2xl font-bold">${analysisResult.potentialValue.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Potential Supplement Value</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Gap Analysis — {analysisResult.category}
                <Badge variant="outline" className="ml-auto text-xs">Scanned at {analysisResult.timestamp}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {analysisResult.missingItems.length === 0 ? (
                <div className="text-center py-8 text-green-600 dark:text-green-400">
                  <CheckCircle className="w-10 h-10 mx-auto mb-2" />
                  <p className="font-semibold">Estimate appears complete for {analysisResult.lossType} loss type</p>
                  <p className="text-sm text-muted-foreground mt-1">No standard IICRC line items appear to be missing</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {analysisResult.missingItems.map((item: any, i: number) => (
                    <div key={i} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/50 border border-border" data-testid={`gap-item-${i}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs text-muted-foreground">{item.code}</span>
                          <Badge variant="outline" className="text-xs">{item.unit}</Badge>
                        </div>
                        <p className="text-sm font-medium mt-0.5">{item.description}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-bold text-primary">${item.tipicalCost.toLocaleString()}</span>
                        <Button
                          size="sm"
                          onClick={() => addItem(item)}
                          disabled={addLineMutation.isPending}
                          data-testid={`button-add-item-${i}`}
                        >
                          <Plus className="w-3 h-3 mr-1" /> Add
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-2">IICRC Standards Reference</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-blue-700 dark:text-blue-400">
                <p>• <b>S500</b> — Water Damage Restoration Standard (2021)</p>
                <p>• <b>S520</b> — Mold Remediation Standard (2015)</p>
                <p>• <b>S700</b> — Fire & Smoke Restoration (2025)</p>
              </div>
              <p className="text-xs text-blue-600 dark:text-blue-500 mt-2">
                All suggested items are based on IICRC-recommended procedures for {analysisResult.lossType} loss scenarios. Quantities must be verified against the actual job scope before submission to carrier.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* No job selected state */}
      {!selectedJobId && (
        <Card>
          <CardContent className="py-16 text-center">
            <Zap className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-30" />
            <p className="font-semibold text-muted-foreground">Select a job and estimate to begin gap analysis</p>
            <p className="text-sm text-muted-foreground mt-1">The engine will scan your existing line items against IICRC standards and identify missed supplement opportunities</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
