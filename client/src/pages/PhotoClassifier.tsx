import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Camera, Sparkles, AlertTriangle, CheckCircle2, Upload, Eye, Tag } from "lucide-react";

const SAMPLE_CLASSIFICATIONS = [
  { filename: "IMG_001.jpg", room: "Living Room", type: "Source of Loss", severity: "Moderate", iicrc: "Category 2", carrierReq: "✓ Meets State Farm requirement", status: "ok" },
  { filename: "IMG_002.jpg", room: "Living Room", type: "Wide Shot", severity: "N/A", iicrc: "Required", carrierReq: "✓ Wide angle confirmed", status: "ok" },
  { filename: "IMG_003.jpg", room: "Bedroom 1", type: "Moisture Reading", severity: "High (28% WME)", iicrc: "Category 2", carrierReq: "⚠ Meter not visible in frame", status: "warning" },
  { filename: "IMG_004.jpg", room: "Unknown", type: "Unclassified", severity: "Unknown", iicrc: "Needs review", carrierReq: "⚠ Missing room label", status: "warning" },
  { filename: "IMG_005.jpg", room: "Bathroom", type: "Equipment Placement", severity: "N/A", iicrc: "Required", carrierReq: "✓ Equipment serial visible", status: "ok" },
];

export default function PhotoClassifier() {
  const { data: photos = [] } = useQuery<any[]>({ queryKey: ["/api/photos"], queryFn: () => apiRequest("GET", "/api/photos").then(r => r.json()) });
  const [analyzed, setAnalyzed] = useState(false);

  const issues = SAMPLE_CLASSIFICATIONS.filter(p => p.status === "warning");
  const passed = SAMPLE_CLASSIFICATIONS.filter(p => p.status === "ok");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-blue))] flex items-center justify-center">
          <Camera className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">AI Photo Damage Classifier</h1>
          <p className="text-sm text-muted-foreground">Auto-classifies photos by room, damage type, severity — flags missing carrier requirements</p>
        </div>
      </div>

      {!analyzed ? (
        <Card className="border-dashed border-2 border-[hsl(var(--titan-blue)/0.4)]">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[hsl(var(--titan-blue)/0.08)] flex items-center justify-center">
              <Upload className="w-8 h-8 text-[hsl(var(--titan-blue))]" />
            </div>
            <div>
              <p className="font-semibold">Upload Photos for AI Classification</p>
              <p className="text-sm text-muted-foreground mt-1">Or classify photos already in your job library</p>
            </div>
            <div className="flex gap-3">
              <Button onClick={() => setAnalyzed(true)} className="bg-[hsl(var(--titan-blue))] text-white hover:opacity-90">
                <Sparkles className="w-4 h-4 mr-2" />Analyze Job Photos
              </Button>
              <Button variant="outline">Upload New Photos</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="border-green-200"><CardContent className="pt-4 text-center"><p className="text-2xl font-bold text-green-600">{passed.length}</p><p className="text-xs">Photos Classified ✓</p></CardContent></Card>
            <Card className="border-amber-200"><CardContent className="pt-4 text-center"><p className="text-2xl font-bold text-amber-500">{issues.length}</p><p className="text-xs">Issues Found ⚠</p></CardContent></Card>
            <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">{SAMPLE_CLASSIFICATIONS.length}</p><p className="text-xs">Total Analyzed</p></CardContent></Card>
          </div>

          {issues.length > 0 && (
            <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-amber-600"><AlertTriangle className="w-4 h-4" />Documentation Issues — Fix Before Submitting</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {issues.map((p,i) => (
                  <div key={i} className="flex items-center justify-between bg-white dark:bg-background p-2 rounded border border-amber-200 text-sm">
                    <div><span className="font-medium">{p.filename}</span> — {p.room}</div>
                    <Badge variant="outline" className="text-xs border-amber-300 text-amber-600 shrink-0">{p.carrierReq}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            {SAMPLE_CLASSIFICATIONS.map((p, i) => (
              <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${p.status === "ok" ? "border-green-200 bg-green-50 dark:bg-green-950/10" : "border-amber-200 bg-amber-50 dark:bg-amber-950/10"}`}>
                <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                  <Camera className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{p.filename}</span>
                    <Badge variant="outline" className="text-[10px]">{p.room}</Badge>
                    <Badge variant="outline" className="text-[10px]">{p.type}</Badge>
                    {p.severity !== "N/A" && <Badge variant="outline" className="text-[10px]">{p.severity}</Badge>}
                  </div>
                  <p className={`text-xs mt-0.5 ${p.status === "warning" ? "text-amber-600" : "text-muted-foreground"}`}>{p.carrierReq}</p>
                </div>
                {p.status === "ok" ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />}
              </div>
            ))}
          </div>
          <Button variant="outline" onClick={() => setAnalyzed(false)}>Re-analyze</Button>
        </>
      )}
    </div>
  );
}
