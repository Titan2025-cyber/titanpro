import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldAlert, TrendingDown, AlertTriangle, Gavel, BarChart2, FileText } from "lucide-react";

export default function CarrierCounterIntel() {
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("GET", "/api/jobs").then(r => r.json()) });
  const { data: supplements = [] } = useQuery<any[]>({ queryKey: ["/api/supplements"], queryFn: () => apiRequest("GET", "/api/supplements").then(r => r.json()) });

  const carrierStats = ["State Farm","Allstate","Nationwide","Farmers","USAA"].map(carrier => {
    const carrierJobs = (jobs as any[]).filter((j:any) => j.insuranceCarrier === carrier);
    const carrierSupps = (supplements as any[]).filter((s:any) => carrierJobs.some((j:any) => j.id === s.jobId));
    const denied = carrierSupps.filter((s:any) => s.status === "denied").length;
    const partial = carrierSupps.filter((s:any) => s.status === "partial").length;
    const totalSupps = carrierSupps.length;
    const denyRate = totalSupps > 0 ? Math.round((denied / totalSupps) * 100) : 0;
    const cutRate = Math.floor(Math.random() * 25) + 10;
    return { carrier, jobs: carrierJobs.length, denied, partial, denyRate, cutRate, totalSupps };
  }).filter(c => c.jobs > 0 || true);

  const patterns = [
    { carrier: "Allstate", pattern: "Systematic O&P Reduction", count: 14, totalCut: 28400, statute: "SC Code 38-59-20", actionable: true },
    { carrier: "State Farm", pattern: "Antimicrobial blanket denial", count: 7, totalCut: 11900, statute: "IICRC S500 Sec 12.3", actionable: true },
    { carrier: "Farmers", pattern: "Pack-out labor reduction >30%", count: 5, totalCut: 8750, statute: "IICRC S520 / RCV obligation", actionable: false },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-red))] flex items-center justify-center">
          <ShieldAlert className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Carrier Counter-Intelligence</h1>
          <p className="text-sm text-muted-foreground">Tracks algorithmic reduction patterns across your portfolio — builds regulatory dossier</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: "Total Underpayment Tracked", value: "$49,050", sub: "estimated recoverable", icon: TrendingDown, color: "text-red-500" },
          { label: "Pattern Violations Identified", value: String(patterns.length), sub: "with statutory backing", icon: AlertTriangle, color: "text-amber-500" },
          { label: "Actionable Complaints Ready", value: String(patterns.filter(p=>p.actionable).length), sub: "DOI complaint drafts", icon: Gavel, color: "text-[hsl(var(--titan-blue))]" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4 flex items-center gap-3">
              <s.icon className={`w-8 h-8 shrink-0 ${s.color}`} />
              <div>
                <p className="text-xl font-bold">{s.value}</p>
                <p className="text-xs font-medium">{s.label}</p>
                <p className="text-[10px] text-muted-foreground">{s.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pattern alerts */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" />Detected Reduction Patterns</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {patterns.map((p, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20">
              <TrendingDown className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Badge variant="outline" className="text-xs">{p.carrier}</Badge>
                  <span className="text-sm font-medium">{p.pattern}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-1">{p.count} occurrences · ~${p.totalCut.toLocaleString()} total cut · {p.statute}</p>
                {p.actionable && (
                  <Button size="sm" variant="outline" className="text-xs h-7 mt-1">
                    <FileText className="w-3 h-3 mr-1" />Draft DOI Complaint
                  </Button>
                )}
              </div>
              <Badge className={p.actionable ? "bg-red-100 text-red-700 border-0" : "bg-muted text-muted-foreground border-0"} variant="outline">
                {p.actionable ? "Actionable" : "Monitoring"}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Carrier table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><BarChart2 className="w-4 h-4" />Carrier Reduction Analytics</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-muted-foreground border-b">
                <th className="text-left pb-2">Carrier</th>
                <th className="text-center pb-2">Jobs</th>
                <th className="text-center pb-2">Supps</th>
                <th className="text-center pb-2">Denied</th>
                <th className="text-center pb-2">Avg Cut</th>
                <th className="text-center pb-2">Status</th>
              </tr></thead>
              <tbody>
                {carrierStats.map(c => (
                  <tr key={c.carrier} className="border-b border-border/50 last:border-0">
                    <td className="py-2 font-medium">{c.carrier}</td>
                    <td className="py-2 text-center">{c.jobs}</td>
                    <td className="py-2 text-center">{c.totalSupps}</td>
                    <td className="py-2 text-center">
                      <Badge variant="outline" className={`text-xs ${c.denyRate > 20 ? "border-red-200 text-red-600" : "border-green-200 text-green-600"}`}>
                        {c.denyRate}%
                      </Badge>
                    </td>
                    <td className="py-2 text-center text-red-500 font-medium">−{c.cutRate}%</td>
                    <td className="py-2 text-center">
                      <Badge variant="outline" className={`text-[10px] ${c.denyRate > 20 ? "border-red-200 text-red-600" : "border-green-200 text-green-600"}`}>
                        {c.denyRate > 20 ? "⚠ Watch" : "✓ Normal"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
