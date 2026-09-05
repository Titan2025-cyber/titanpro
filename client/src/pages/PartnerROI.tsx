import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { ChevronDown, ChevronUp, Users, DollarSign, TrendingUp, Percent, Wrench, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReferredJob {
  id: number;
  jobNumber: string;
  address: string;
  revenue: number;
  status: string;
  createdAt: string;
}

interface PartnerROIData {
  partnerId: number;
  partnerName: string;
  company: string;
  referralRate: number; // percentage
  jobsReferred: number;
  totalRevenueGenerated: number;
  totalPaidOut: number;
  totalPending: number;
  roiRatio: number; // e.g. 21 means 21x
  warrantyCost: number;
  warrantyCount: number;
  netValue: number;
  referredJobs: ReferredJob[];
  warrantyCalls: any[];
  courtesyJobsCount: number;
  courtesyValue: number;
  courtesyJobs: {
    jobId: number;
    jobNumber: string;
    address: string;
    lossType?: string;
    reason?: string;
    value: number;
    createdAt?: string;
  }[];
}

type SortKey = "revenue" | "roi" | "jobs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function roiBadgeClass(roi: number): string {
  if (roi >= 10) return "bg-green-100 text-green-800 border-green-200";
  if (roi >= 5) return "bg-yellow-100 text-yellow-800 border-yellow-200";
  return "bg-red-100 text-red-800 border-red-200";
}

function roiLabel(roi: number): string {
  return `${roi.toFixed(1)}x`;
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: boolean;
}

function SummaryCard({ label, value, icon, accent }: SummaryCardProps) {
  return (
    <Card className={accent ? "border-[hsl(var(--titan-red))] border-2" : ""}>
      <CardContent className="flex items-center gap-4 p-5">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
          style={{ background: "hsl(var(--titan-blue) / 0.1)" }}
        >
          <span style={{ color: "hsl(var(--titan-blue))" }}>{icon}</span>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-xl font-bold tracking-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Partner Card ─────────────────────────────────────────────────────────────

function PartnerCard({ partner }: { partner: PartnerROIData }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold">
              {partner.partnerName}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{partner.company}</p>
          </div>
          <Badge
            variant="outline"
            className={`text-lg font-bold px-3 py-1 ${roiBadgeClass(partner.roiRatio)}`}
            data-testid={`roi-badge-${partner.partnerId}`}
          >
            {roiLabel(partner.roiRatio)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 mb-4">
          <div>
            <p className="text-xs text-muted-foreground">Referral Rate</p>
            <p className="font-semibold">{partner.referralRate.toFixed(1)}%</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Jobs Referred</p>
            <p className="font-semibold">{partner.jobsReferred}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Revenue Generated</p>
            <p
              className="text-lg font-bold"
              style={{ color: "hsl(var(--titan-blue))" }}
            >
              {formatCurrency(partner.totalRevenueGenerated)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Paid Out</p>
            <p className="font-semibold text-red-600">
              {formatCurrency(partner.totalPaidOut)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pending</p>
            <p className="font-semibold text-yellow-600">
              {formatCurrency(partner.totalPending)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Warranty Calls</p>
            <p className="font-semibold text-orange-600">{partner.warrantyCount}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Warranty Cost Absorbed</p>
            <p className="font-semibold text-red-600">{formatCurrency(partner.warrantyCost)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Net Value to Titan</p>
            <p className={`font-bold ${partner.netValue >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatCurrency(partner.netValue)}
            </p>
          </div>
        </div>

        {/* Courtesy / incidental work delivered to this partner. Not counted
            in Net Value (that's real Titan P&L) — shown as goodwill dollars
            the partner should know we absorb on their behalf. */}
        {partner.courtesyJobsCount > 0 && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">🤝 Courtesy work delivered</p>
                <p className="text-xs text-amber-800 dark:text-amber-200/80">
                  {partner.courtesyJobsCount} incidental job{partner.courtesyJobsCount === 1 ? "" : "s"} covered at no charge
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-amber-800 dark:text-amber-200/80">Fair-market value</p>
                <p className="font-bold text-amber-900 dark:text-amber-100">{formatCurrency(partner.courtesyValue)}</p>
              </div>
            </div>
            {partner.courtesyJobs.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {partner.courtesyJobs.map((cj) => (
                  <li key={cj.jobId} className="flex items-center justify-between gap-2">
                    <a href={`/jobs/${cj.jobId}`} className="truncate text-amber-900 dark:text-amber-100 hover:underline">
                      <span className="font-mono">{cj.jobNumber}</span>
                      {cj.address ? <> · <span className="text-amber-800 dark:text-amber-200/80">{cj.address}</span></> : null}
                      {cj.reason ? <> · <span className="italic text-amber-700 dark:text-amber-300">{cj.reason}</span></> : null}
                    </a>
                    <span className="font-medium text-amber-900 dark:text-amber-100 shrink-0">{formatCurrency(cj.value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Referred jobs collapsible */}
        {partner.referredJobs.length > 0 && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => setExpanded((v) => !v)}
              data-testid={`toggle-jobs-${partner.partnerId}`}
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" /> Hide Jobs
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" /> Show {partner.referredJobs.length} Jobs
                </>
              )}
            </Button>

            {expanded && (
              <div className="mt-2 rounded-md border divide-y overflow-hidden">
                {partner.referredJobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/50"
                    data-testid={`referred-job-${job.id}`}
                  >
                    <div>
                      <span className="font-medium">{job.jobNumber}</span>
                      <span className="ml-2 text-muted-foreground truncate max-w-[180px] inline-block align-bottom">
                        {job.address}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Badge variant="secondary" className="text-xs">{job.status}</Badge>
                      {(job.warrantyCalls ?? 0) > 0 && (
                        <Badge className="bg-orange-100 text-orange-700 text-xs border-orange-300">
                          <Wrench className="w-3 h-3 mr-1" />{job.warrantyCalls} warranty
                        </Badge>
                      )}
                      <span className="font-semibold">{formatCurrency(job.revenue)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PartnerROI() {
  const [sortBy, setSortBy] = useState<SortKey>("revenue");

  const { data: rawPartners = [], isLoading, isError } = useQuery<any[]>({
    queryKey: ["/api/reports/partner-roi"],
    queryFn: () => apiRequest("GET", "/api/reports/partner-roi").then((r) => r.json()),
  });

  // Normalize API response to PartnerROIData shape
  const partners: PartnerROIData[] = rawPartners.map((p: any, i: number) => ({
    partnerId: p.partnerId ?? i,
    partnerName: p.partnerName ?? p.partner ?? "Unknown",
    company: p.company ?? "",
    referralRate: p.referralRate ?? 0,
    jobsReferred: p.jobsReferred ?? 0,
    totalRevenueGenerated: p.totalRevenueGenerated ?? p.totalRevenue ?? 0,
    totalPaidOut: p.totalPaidOut ?? p.totalPaid ?? 0,
    totalPending: p.totalPending ?? 0,
    roiRatio: p.roiRatio ?? p.roi ?? 0,
    warrantyCost: p.warrantyCost ?? 0,
    warrantyCount: p.warrantyCount ?? 0,
    netValue: p.netValue ?? (p.totalRevenue - p.totalPaid) ?? 0,
    referredJobs: (p.referredJobs ?? p.jobs ?? []).map((j: any) => ({
      id: j.id ?? 0,
      jobNumber: j.jobNumber ?? "",
      address: j.address ?? "",
      revenue: j.revenue ?? 0,
      status: j.status ?? "",
      createdAt: j.createdAt ?? "",
      warrantyCalls: j.warrantyCalls ?? 0,
      warrantyCost: j.warrantyCost ?? 0,
    })),
    warrantyCalls: p.warrantyCalls ?? [],
    courtesyJobsCount: p.courtesyJobsCount ?? 0,
    courtesyValue: p.courtesyValue ?? 0,
    courtesyJobs: p.courtesyJobs ?? [],
  }));

  // Derived summary
  const summary = useMemo(() => {
    const totalPartners = partners.length;
    const totalRevenue = partners.reduce((s, p) => s + p.totalRevenueGenerated, 0);
    const totalPaidOut = partners.reduce((s, p) => s + p.totalPaidOut, 0);
    const totalWarrantyCost = partners.reduce((s, p) => s + p.warrantyCost, 0);
    const totalWarrantyCalls = partners.reduce((s, p) => s + p.warrantyCount, 0);
    const blendedROI = totalPaidOut > 0 ? totalRevenue / totalPaidOut : 0;
    return { totalPartners, totalRevenue, totalPaidOut, blendedROI, totalWarrantyCost, totalWarrantyCalls };
  }, [partners]);

  // Sorted list
  const sorted = useMemo(() => {
    return [...partners].sort((a, b) => {
      if (sortBy === "revenue") return b.totalRevenueGenerated - a.totalRevenueGenerated;
      if (sortBy === "roi") return b.roiRatio - a.roiRatio;
      return b.jobsReferred - a.jobsReferred;
    });
  }, [partners, sortBy]);

  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Partner ROI</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Revenue generated vs. payouts made per referral partner
        </p>
      </div>

      {/* Summary row */}
      {!isLoading && !isError && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCard
            label="Total Partners"
            value={summary.totalPartners.toString()}
            icon={<Users className="h-5 w-5" />}
          />
          <SummaryCard
            label="Revenue via Referrals"
            value={formatCurrency(summary.totalRevenue)}
            icon={<DollarSign className="h-5 w-5" />}
          />
          <SummaryCard
            label="Total Paid Out"
            value={formatCurrency(summary.totalPaidOut)}
            icon={<DollarSign className="h-5 w-5" />}
          />
          <SummaryCard
            label="Blended ROI"
            value={`${summary.blendedROI.toFixed(1)}x`}
            icon={<TrendingUp className="h-5 w-5" />}
            accent
          />
          <SummaryCard
            label="Warranty Calls"
            value={summary.totalWarrantyCalls.toString()}
            icon={<Wrench className="h-5 w-5" />}
          />
          <SummaryCard
            label="Warranty Cost Absorbed"
            value={formatCurrency(summary.totalWarrantyCost)}
            icon={<AlertTriangle className="h-5 w-5" />}
          />
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {isLoading ? "Loading…" : `${partners.length} partner${partners.length !== 1 ? "s" : ""}`}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Sort by</span>
          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as SortKey)}
          >
            <SelectTrigger
              className="w-36 h-8 text-sm"
              data-testid="sort-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="revenue">Revenue</SelectItem>
              <SelectItem value="roi">ROI</SelectItem>
              <SelectItem value="jobs">Jobs</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="h-48 p-5">
                <div className="space-y-3">
                  <div className="h-4 w-1/2 rounded bg-muted" />
                  <div className="h-3 w-1/3 rounded bg-muted" />
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {[1, 2, 3, 4, 5, 6].map((j) => (
                      <div key={j} className="h-8 rounded bg-muted" />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <Card className="border-destructive">
          <CardContent className="p-6 text-center text-sm text-destructive">
            Failed to load partner ROI data. Please try again.
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !isError && partners.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full"
              style={{ background: "hsl(var(--titan-blue) / 0.1)" }}
            >
              <Percent
                className="h-7 w-7"
                style={{ color: "hsl(var(--titan-blue))" }}
              />
            </div>
            <p className="font-semibold">No partner ROI data yet</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Add referral partners in Contacts and tag jobs with lead source to
              see ROI data.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Partner cards grid */}
      {!isLoading && !isError && sorted.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((partner) => (
            <PartnerCard key={partner.partnerId} partner={partner} />
          ))}
        </div>
      )}
    </div>
  );
}
