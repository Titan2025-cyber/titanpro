import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HardHat, AlertTriangle, CheckCircle2, Droplets, Wind, Camera, FileText, Zap } from "lucide-react";

const CARRIER_REQUIREMENTS: Record<string, string[]> = {
  "State Farm": ["Source-of-loss photo (required)", "Moisture meter visible in all readings", "Equipment serial numbers logged", "Daily drying log entries"],
  "Allstate": ["Before/after per room", "Wide + close-up for each affected area", "Baseline moisture reading in unaffected room", "O&P justification note"],
  "Nationwide": ["Psychrometric readings per room", "Category classification documentation", "IICRC S500 protocol reference", "Equipment placement photos"],
  "Farmers": ["3D sketch or floor plan required", "Contents inventory before pack-out", "Signed deviation form if any scope deviation", "Adjuster inspection request logged"],
  "General": ["Source-of-loss photo", "Arrival condition photos", "Moisture readings with meter visible", "Equipment placement", "Daily readings"],
};

export default function TechCoach() {
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("GET", "/api/jobs").then(r => r.json()) });
  const [selectedJob, setSelectedJob] = useState<string>("");

  const activeJobs = (jobs as any[]).filter(j => ["mitigation","drying","active"].includes(j.status));
  const job = activeJobs.find((j: any) => String(j.id) === selectedJob);
  const carrier = job?.insuranceCarrier || "General";
  const requirements = CARRIER_REQUIREMENTS[carrier] || CARRIER_REQUIREMENTS["General"];

  const checks = [
    { label: "Source-of-loss photo uploaded", icon: Camera, status: job ? "pending" : "na" },
    { label: "Moisture baseline in unaffected area", icon: Droplets, status: job ? "warning" : "na" },
    { label: "Equipment log complete", icon: Wind, status: job ? "ok" : "na" },
    { label: "Drying records updated today", icon: FileText, status: job ? "warning" : "na" },
    { label: "IICRC S500 protocol documented", icon: CheckCircle2, status: job ? "ok" : "na" },
    { label: "Signed work authorization on file", icon: FileText, status: job ? "ok" : "na" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-red))] flex items-center justify-center">
          <HardHat className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">In-Field Tech Coach</h1>
          <p className="text-sm text-muted-foreground">Pre-departure AI checklist combining carrier TPA + IICRC + live readings</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Select Job to Check</CardTitle></CardHeader>
        <CardContent>
          <Select value={selectedJob} onValueChange={setSelectedJob}>
            <SelectTrigger><SelectValue placeholder="Choose an active job…" /></SelectTrigger>
            <SelectContent>
              {activeJobs.map((j: any) => (
                <SelectItem key={j.id} value={String(j.id)}>TP-{String(j.id).padStart(4,"0")} — {j.address} ({j.insuranceCarrier || "No carrier"})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {job && (
        <>
          <Card className="border-[hsl(var(--titan-blue))] bg-[hsl(var(--titan-blue)/0.04)]">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4 text-[hsl(var(--titan-blue))]" />{carrier} TPA Requirements</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {requirements.map((r, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--titan-blue))] shrink-0" />
                    {r}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" />Pre-Departure Checklist</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {checks.map((c, i) => {
                const Icon = c.icon;
                return (
                  <div key={i} className={`flex items-center gap-3 p-2.5 rounded-lg border ${c.status === "ok" ? "border-green-200 bg-green-50 dark:bg-green-950/20" : c.status === "warning" ? "border-amber-200 bg-amber-50 dark:bg-amber-950/20" : "border-border bg-muted/20"}`}>
                    <Icon className={`w-4 h-4 shrink-0 ${c.status === "ok" ? "text-green-600" : c.status === "warning" ? "text-amber-500" : "text-muted-foreground"}`} />
                    <span className="text-sm flex-1">{c.label}</span>
                    <Badge variant="outline" className={`text-[10px] ${c.status === "ok" ? "border-green-300 text-green-600" : c.status === "warning" ? "border-amber-300 text-amber-600" : ""}`}>
                      {c.status === "ok" ? "✓ Done" : c.status === "warning" ? "⚠ Action needed" : "N/A"}
                    </Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button className="bg-[hsl(var(--titan-red))] text-white hover:opacity-90">Mark Job Site Ready</Button>
            <Button variant="outline">Send Briefing to Tech</Button>
          </div>
        </>
      )}

      {!selectedJob && (
        <div className="text-center py-12 text-muted-foreground">
          <HardHat className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">Select an active job to run the pre-departure coach check</p>
        </div>
      )}
    </div>
  );
}
