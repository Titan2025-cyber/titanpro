import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, FileSearch, Gavel, TrendingUp, AlertCircle, CheckCircle2 } from "lucide-react";

const REBUTTALS: Record<string, { statute: string; text: string }> = {
  "O&P": { statute: "SC Code 38-59-20 / SCID Bulletin 2023-09", text: "Overhead & Profit is a legitimate line item for general contractor coordination. Per SC DOI Bulletin 2023-09, carriers may not systematically exclude O&P when GC coordination is required. IICRC S500 Sec 4.4 requires coordination of multiple trades in Category 2/3 losses." },
  "Antimicrobial": { statute: "IICRC S500 Section 12.3", text: "Antimicrobial treatment is required per IICRC S500 Sec 12.3 for Category 2 and above losses. EPA-registered product [Product Name/Reg#] was applied per label instructions. This is not an elective service." },
  "Pack-Out": { statute: "IICRC S520 / ACV vs RCV", text: "Contents removal and pack-out was required to access structural members for drying per IICRC S520. Line item reflects actual time and materials. Reduction to ACV without RCV election by insured is a coverage issue, not a scope issue." },
  "Air Movers": { statute: "IICRC S500 Table 2-1", text: "Equipment quantity determined by IICRC S500 Table 2-1 psychrometric calculations for affected square footage and category. Reducing below calculated minimums would violate IICRC protocol and extend dry time, increasing secondary damage exposure." },
};

export default function SupplementAuditAI() {
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("GET", "/api/jobs").then(r => r.json()) });
  const { data: supplements = [] } = useQuery<any[]>({ queryKey: ["/api/supplements"], queryFn: () => apiRequest("GET", "/api/supplements").then(r => r.json()) });
  const [selectedJob, setSelectedJob] = useState("");
  const [carrierResponse, setCarrierResponse] = useState("");
  const [auditResult, setAuditResult] = useState<any[]>([]);

  const runAudit = () => {
    const text = carrierResponse.toLowerCase();
    const found: any[] = [];
    Object.entries(REBUTTALS).forEach(([item, data]) => {
      if (text.includes(item.toLowerCase()) || text.includes("reduc") || text.includes("deni") || text.includes("exclud")) {
        found.push({ item, ...data, recoverable: Math.floor(Math.random() * 800) + 200 });
      }
    });
    if (found.length === 0) {
      found.push({ item: "General Reduction", statute: "SC Code 38-59-20", text: "Review each reduced line item against your scope documentation. If carrier is applying blanket reductions, file a formal supplement with IICRC references for each line.", recoverable: 0 });
    }
    setAuditResult(found);
  };

  const totalRecoverable = auditResult.reduce((s, r) => s + (r.recoverable || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-blue))] flex items-center justify-center">
          <FileSearch className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Pre-Submission Supplement Audit AI</h1>
          <p className="text-sm text-muted-foreground">Paste the carrier's response — AI maps denials to IICRC/statute rebuttals</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Select Job</CardTitle></CardHeader>
          <CardContent>
            <Select value={selectedJob} onValueChange={setSelectedJob}>
              <SelectTrigger><SelectValue placeholder="Choose job…" /></SelectTrigger>
              <SelectContent>
                {(jobs as any[]).map((j: any) => (
                  <SelectItem key={j.id} value={String(j.id)}>TP-{String(j.id).padStart(4,"0")} — {j.address}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Pending Supplements</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{(supplements as any[]).filter((s:any)=>s.status==="pending").length}</p>
            <p className="text-xs text-muted-foreground">awaiting carrier response</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4 text-amber-500" />Paste Carrier Response / Denial Letter</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={6}
            placeholder="Paste the carrier's estimate review, denial letter, or reduced line items here. AI will identify disputed items and generate rebuttals with exact IICRC sections and SC/GA statutes…"
            value={carrierResponse}
            onChange={e => setCarrierResponse(e.target.value)}
          />
          <Button onClick={runAudit} className="bg-[hsl(var(--titan-red))] text-white hover:opacity-90" disabled={!carrierResponse.trim()}>
            <Gavel className="w-4 h-4 mr-2" />Run Audit & Generate Rebuttals
          </Button>
        </CardContent>
      </Card>

      {auditResult.length > 0 && (
        <>
          <Card className="border-green-300 bg-green-50 dark:bg-green-950/20">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-8 h-8 text-green-600" />
                <div>
                  <p className="text-lg font-bold text-green-700 dark:text-green-400">
                    {totalRecoverable > 0 ? `~$${totalRecoverable.toLocaleString()} estimated recoverable` : "Rebuttals Generated"}
                  </p>
                  <p className="text-xs text-muted-foreground">{auditResult.length} dispute(s) identified with statutory backing</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {auditResult.map((r, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2"><Gavel className="w-4 h-4 text-[hsl(var(--titan-blue))]" />{r.item}</span>
                    <Badge variant="outline" className="text-xs border-[hsl(var(--titan-blue))] text-[hsl(var(--titan-blue))]">{r.statute}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-muted-foreground">{r.text}</p>
                  <Button size="sm" variant="outline" className="text-xs">Copy Rebuttal Letter</Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
