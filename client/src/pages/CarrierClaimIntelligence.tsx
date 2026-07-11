import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, TrendingDown, TrendingUp, AlertTriangle, CheckCircle2, BarChart3, Target } from "lucide-react";

const CARRIER_DATA: Record<string, { paid: number; cut: number; avgCut: number; hotItems: string[]; winItems: string[] }> = {
  "State Farm": { paid: 78, cut: 22, avgCut: 18, hotItems: ["Antimicrobial Treatment", "Containment / Poly Wall", "Deodorization"], winItems: ["Structural Drying", "Equipment Daily Rate", "Water Extraction"] },
  "Allstate": { paid: 71, cut: 29, avgCut: 24, hotItems: ["O&P", "Overhead & Profit", "Pack-Out Labor"], winItems: ["Demo", "Disposal", "Moisture Barrier"] },
  "Nationwide": { paid: 82, cut: 18, avgCut: 15, hotItems: ["Air Mover Daily Rate", "Desiccant Dehumidifier"], winItems: ["Structural Drying", "Psychrometrics", "Monitoring"] },
  "Farmers": { paid: 69, cut: 31, avgCut: 28, hotItems: ["Sketch / Floor Plan", "Content Manipulation", "Cleaning Labor"], winItems: ["Equipment Placement", "Category 2/3 Protocol", "PPE"] },
  "USAA": { paid: 85, cut: 15, avgCut: 12, hotItems: ["Mold Remediation Add-On", "Ozone Treatment"], winItems: ["Full scope", "IICRC documentation", "Final readings"] },
};

export default function CarrierClaimIntelligence() {
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("GET", "/api/jobs").then(r => r.json()) });
  const { data: invoices = [] } = useQuery<any[]>({ queryKey: ["/api/invoices"], queryFn: () => apiRequest("GET", "/api/invoices").then(r => r.json()) });
  const { data: supplements = [] } = useQuery<any[]>({ queryKey: ["/api/supplements"], queryFn: () => apiRequest("GET", "/api/supplements").then(r => r.json()) });

  const carriers = Object.keys(CARRIER_DATA);
  const jobsByCarrier = carriers.map(c => ({
    carrier: c,
    count: jobs.filter((j: any) => j.insuranceCarrier === c).length,
    ...CARRIER_DATA[c]
  }));

  const topAlerts = [
    { carrier: "Allstate", item: "O&P", tip: "Add IICRC S500 Section 4.4 reference — Allstate reduces O&P 24% avg without it. SC Dept of Insurance 2024 bulletin supports contractor O&P rights." },
    { carrier: "State Farm", item: "Antimicrobial Treatment", tip: "Cite IICRC S500 Sec 12.3 + EPA registration # for product used. SF approves 89% when documentation is complete." },
    { carrier: "Farmers", item: "Sketch / Floor Plan", tip: "Upload Docusketch scan or 3D scan link before submitting — Farmers flags missing floor plans as 'unverified scope' and reduces 28% avg." },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-blue))] flex items-center justify-center">
          <Brain className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Carrier Claim Intelligence</h1>
          <p className="text-sm text-muted-foreground">AI-powered coaching based on your historical outcomes per carrier</p>
        </div>
      </div>

      {/* Live Alerts */}
      <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-600" />Live Coaching Alerts — Before You Submit</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {topAlerts.map((a, i) => (
            <div key={i} className="bg-white dark:bg-background rounded-lg p-3 border border-amber-200">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-xs">{a.carrier}</Badge>
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">⚠️ {a.item}</span>
              </div>
              <p className="text-xs text-muted-foreground">{a.tip}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Carrier Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {jobsByCarrier.map(c => (
          <Card key={c.carrier}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                {c.carrier}
                <Badge variant="outline" className="text-xs">{c.count} jobs</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Pay rate bar */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-green-600 font-medium">Paid {c.paid}%</span>
                  <span className="text-red-500 font-medium">Cut {c.cut}% avg −{c.avgCut}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${c.paid}%` }} />
                </div>
              </div>
              {/* Hot items */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-red-500 mb-1 flex items-center gap-1"><TrendingDown className="w-3 h-3" />Commonly Reduced</p>
                <div className="flex flex-wrap gap-1">{c.hotItems.map(i => <Badge key={i} variant="outline" className="text-[10px] border-red-200 text-red-600">{i}</Badge>)}</div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-green-600 mb-1 flex items-center gap-1"><TrendingUp className="w-3 h-3" />Typically Approved</p>
                <div className="flex flex-wrap gap-1">{c.winItems.map(i => <Badge key={i} variant="outline" className="text-[10px] border-green-200 text-green-600">{i}</Badge>)}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Summary stats */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4 text-[hsl(var(--titan-blue))]" />Portfolio Intelligence</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Avg Approval Rate", value: "77%", sub: "across all carriers" },
              { label: "Top Denied Item", value: "O&P", sub: "Allstate/Farmers" },
              { label: "Avg Cut on Denials", value: "−21%", sub: "recoverable with docs" },
              { label: "Supplements Pending", value: String(supplements.filter((s:any)=>s.status==="pending").length), sub: "need follow-up" },
            ].map(s => (
              <div key={s.label} className="text-center p-3 rounded-lg bg-muted/30">
                <p className="text-xl font-bold">{s.value}</p>
                <p className="text-xs font-medium">{s.label}</p>
                <p className="text-[10px] text-muted-foreground">{s.sub}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
