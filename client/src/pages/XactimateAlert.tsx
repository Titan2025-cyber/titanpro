import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { AlertTriangle, CheckCircle, TrendingDown, FileText, RefreshCw, DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function XactimateAlert() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [threshold, setThreshold] = useState(10);

  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then(r => r.json()),
  });

  const { data: estimates = [], isLoading: estLoading } = useQuery({
    queryKey: ["/api/estimates"],
    queryFn: () => apiRequest("/api/estimates").then(r => r.json()),
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["/api/invoices"],
    queryFn: () => apiRequest("/api/invoices").then(r => r.json()),
  });

  const { data: supplements = [] } = useQuery({
    queryKey: ["/api/supplements"],
    queryFn: () => apiRequest("/api/supplements").then(r => r.json()),
  });

  // Build comparison: estimate vs invoice vs supplements
  const alerts = jobs.filter((j: any) => {
    const jobEst = estimates.filter((e: any) => e.job_id === j.id && e.status !== "rejected");
    const jobInv = invoices.filter((i: any) => i.job_id === j.id);
    const jobSupp = supplements.filter((s: any) => s.job_id === j.id);
    const estTotal = jobEst.reduce((s: number, e: any) => s + (e.total || 0), 0);
    const invTotal = jobInv.reduce((s: number, i: any) => s + (i.total || 0), 0);
    const suppApproved = jobSupp.filter((s: any) => ["approved","partial"].includes(s.status)).reduce((s: number, x: any) => s + (x.amount_approved || 0), 0);
    if (estTotal === 0) return false;
    const carrierOffer = invTotal; // what carrier paid / invoice
    const variance = ((estTotal - carrierOffer) / estTotal) * 100;
    return variance > threshold;
  }).map((j: any) => {
    const jobEst = estimates.filter((e: any) => e.job_id === j.id && e.status !== "rejected");
    const jobInv = invoices.filter((i: any) => i.job_id === j.id);
    const jobSupp = supplements.filter((s: any) => s.job_id === j.id);
    const estTotal = jobEst.reduce((s: number, e: any) => s + (e.total || 0), 0);
    const invTotal = jobInv.reduce((s: number, i: any) => s + (i.total || 0), 0);
    const suppApproved = jobSupp.filter((s: any) => ["approved","partial"].includes(s.status)).reduce((s: number, x: any) => s + (x.amount_approved || 0), 0);
    const variance = ((estTotal - invTotal) / estTotal) * 100;
    const gap = estTotal - invTotal;
    return { ...j, estTotal, invTotal, suppApproved, variance: Math.round(variance * 10) / 10, gap };
  });

  const filtered = alerts.filter((j: any) =>
    !searchTerm ||
    j.job_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    j.address?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    j.insurance_carrier?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalGap = filtered.reduce((s: number, j: any) => s + j.gap, 0);

  const getSeverity = (v: number) => {
    if (v >= 30) return { label: "Critical", color: "bg-red-100 text-red-700 border-red-200" };
    if (v >= 20) return { label: "High", color: "bg-orange-100 text-orange-700 border-orange-200" };
    return { label: "Moderate", color: "bg-yellow-100 text-yellow-700 border-yellow-200" };
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-red-500" />
            Xactimate Line-Item Alert
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Flags jobs where the carrier's offer is {threshold}%+ below your scope estimate
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Alert threshold:</span>
            <Input
              type="number"
              value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              className="w-20 h-8 text-sm"
              min={1}
              max={99}
              data-testid="input-threshold"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/jobs"] })}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-50 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Jobs Flagged</p>
                <p className="text-xl font-bold text-red-600" data-testid="text-flagged-count">{filtered.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-50 rounded-lg">
                <TrendingDown className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Revenue Gap</p>
                <p className="text-xl font-bold text-orange-600" data-testid="text-total-gap">
                  ${totalGap.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <DollarSign className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Gap per Job</p>
                <p className="text-xl font-bold text-blue-600" data-testid="text-avg-gap">
                  ${filtered.length > 0 ? Math.round(totalGap / filtered.length).toLocaleString() : 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Input
        placeholder="Search by job #, address, or carrier..."
        value={searchTerm}
        onChange={e => setSearchTerm(e.target.value)}
        className="max-w-md"
        data-testid="input-search"
      />

      {/* Alert List */}
      {jobsLoading || estLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
            <p className="font-semibold text-foreground">No alerts above {threshold}% threshold</p>
            <p className="text-sm text-muted-foreground mt-1">All carrier offers are within acceptable range</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((job: any) => {
            const sev = getSeverity(job.variance);
            return (
              <Card key={job.id} className="border-l-4 border-l-red-400" data-testid={`card-alert-${job.id}`}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-bold text-foreground">{job.job_number}</span>
                        <Badge className={`text-xs ${sev.color}`}>{sev.label} — {job.variance}% below scope</Badge>
                        <Badge variant="outline" className="text-xs">{job.loss_type}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{job.address}</p>
                      {job.insurance_carrier && (
                        <p className="text-xs text-muted-foreground mt-1">Carrier: {job.insurance_carrier}</p>
                      )}
                      <div className="grid grid-cols-3 gap-4 mt-3">
                        <div className="text-center p-2 bg-blue-50 rounded">
                          <p className="text-xs text-muted-foreground">Your Scope</p>
                          <p className="font-semibold text-blue-700">${job.estTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div className="text-center p-2 bg-red-50 rounded">
                          <p className="text-xs text-muted-foreground">Carrier Offer</p>
                          <p className="font-semibold text-red-700">${job.invTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div className="text-center p-2 bg-orange-50 rounded">
                          <p className="text-xs text-muted-foreground">Revenue Gap</p>
                          <p className="font-semibold text-orange-700">${job.gap.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                        </div>
                      </div>
                      {job.suppApproved > 0 && (
                        <p className="text-xs text-green-600 mt-2">
                          ✓ Supplements approved: ${job.suppApproved.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs"
                        onClick={() => window.location.hash = `/jobs/${job.id}`}
                        data-testid={`button-view-job-${job.id}`}
                      >
                        View Job
                      </Button>
                      <Button
                        size="sm"
                        className="text-xs bg-red-600 hover:bg-red-700 text-white"
                        onClick={() => window.location.hash = `/supplements`}
                        data-testid={`button-supplement-${job.id}`}
                      >
                        File Supplement
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* IICRC / State Law Reference */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-blue-800 flex items-center gap-2">
            <FileText className="h-4 w-4" />
            SC & GA Statutory Reference — Underpayment
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-blue-700 space-y-1">
          <p><strong>SC § 38-59-20:</strong> Insurer must acknowledge, investigate within 10 days. Bad faith = 25% penalty + attorney fees.</p>
          <p><strong>SC § 38-59-40:</strong> Carrier must provide itemized explanation of denial/reduction within 15 days.</p>
          <p><strong>GA § 33-4-6:</strong> Bad faith refusal = up to 50% of liability + attorney fees. File complaint with OCI after 60 days.</p>
          <p><strong>GA § 33-6-31:</strong> Unfair claims settlement practices — failure to promptly settle when liability clear.</p>
        </CardContent>
      </Card>
    </div>
  );
}
