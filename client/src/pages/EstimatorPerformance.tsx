import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { BarChart3, TrendingUp, FileText, DollarSign, Award, AlertCircle } from "lucide-react";

interface EstimatorStat {
  estimatorName: string;
  totalEstimates: number;
  totalValue: number;
  avgValue: number;
  approvedCount: number;
  approvalRate: number;
  supplementCount: number;
  supplementRate: number;
  byLossType: Record<string, number>;
}

interface EstimatorPerformanceData {
  estimators: EstimatorStat[];
  totalEstimates: number;
  totalValue: number;
  avgApprovalRate: number;
}

const COLORS = ["#dc2626", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];

function StatCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${color || "bg-blue-100 dark:bg-blue-900/30"}`}>
            {icon}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-bold">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EstimatorPerformance() {
  const { data, isLoading, isError } = useQuery<EstimatorPerformanceData>({
    queryKey: ["/api/reports/estimator-performance"],
    queryFn: () =>
      apiRequest("/api/reports/estimator-performance").then((r) => r.json()),
  });

  const topEstimator =
    data?.estimators?.slice().sort((a, b) => b.approvalRate - a.approvalRate)[0] ?? null;

  const barData =
    data?.estimators?.map((e) => ({
      name: e.estimatorName.split(" ")[0],
      estimates: e.totalEstimates,
      approved: e.approvedCount,
      value: Math.round(e.avgValue),
    })) ?? [];

  const lossTypeAggregate: Record<string, number> = {};
  data?.estimators?.forEach((e) => {
    Object.entries(e.byLossType || {}).forEach(([type, count]) => {
      lossTypeAggregate[type] = (lossTypeAggregate[type] || 0) + (count as number);
    });
  });
  const pieData = Object.entries(lossTypeAggregate).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value,
  }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="w-7 h-7 text-blue-600" />
        <div>
          <h1 className="text-xl font-bold">Estimator Performance</h1>
          <p className="text-sm text-muted-foreground">
            Approval rates, supplement frequency, and value by estimator
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-red-500" />
            <p>Failed to load estimator data.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={<FileText className="w-5 h-5 text-blue-600" />}
              label="Total Estimates"
              value={String(data?.totalEstimates ?? 0)}
              color="bg-blue-100 dark:bg-blue-900/30"
            />
            <StatCard
              icon={<DollarSign className="w-5 h-5 text-green-600" />}
              label="Total Estimate Value"
              value={`$${((data?.totalValue ?? 0) / 1000).toFixed(1)}k`}
              color="bg-green-100 dark:bg-green-900/30"
            />
            <StatCard
              icon={<TrendingUp className="w-5 h-5 text-red-600" />}
              label="Avg Approval Rate"
              value={`${(data?.avgApprovalRate ?? 0).toFixed(1)}%`}
              color="bg-red-100 dark:bg-red-900/30"
            />
            <StatCard
              icon={<Award className="w-5 h-5 text-yellow-600" />}
              label="Top Performer"
              value={topEstimator?.estimatorName?.split(" ")[0] ?? "—"}
              sub={topEstimator ? `${topEstimator.approvalRate.toFixed(1)}% approval` : undefined}
              color="bg-yellow-100 dark:bg-yellow-900/30"
            />
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Bar Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Estimates by Estimator</CardTitle>
              </CardHeader>
              <CardContent>
                {barData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No estimate data yet.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={barData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="estimates" name="Total" fill="#2563eb" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="approved" name="Approved" fill="#16a34a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Pie Chart — Loss Type Mix */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Estimates by Loss Type</CardTitle>
              </CardHeader>
              <CardContent>
                {pieData.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No loss type data yet.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        dataKey="value"
                        label={({ name, percent }) =>
                          `${name} ${(percent * 100).toFixed(0)}%`
                        }
                        labelLine={false}
                      >
                        {pieData.map((_, index) => (
                          <Cell key={index} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Per-Estimator Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Individual Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(data?.estimators?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No estimators found. Estimates with assigned contacts will appear here.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-left px-4 py-2.5 font-medium">Estimator</th>
                        <th className="text-right px-4 py-2.5 font-medium">Estimates</th>
                        <th className="text-right px-4 py-2.5 font-medium">Avg Value</th>
                        <th className="text-right px-4 py-2.5 font-medium">Approval %</th>
                        <th className="text-right px-4 py-2.5 font-medium">Supplement %</th>
                        <th className="text-left px-4 py-2.5 font-medium">Top Loss Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.estimators?.map((est, i) => {
                        const topLoss =
                          Object.entries(est.byLossType || {}).sort(
                            ([, a], [, b]) => (b as number) - (a as number)
                          )[0]?.[0] ?? "—";
                        const approvalBadge =
                          est.approvalRate >= 75
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : est.approvalRate >= 50
                            ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
                        return (
                          <tr
                            key={i}
                            className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                          >
                            <td className="px-4 py-3 font-medium">{est.estimatorName}</td>
                            <td className="px-4 py-3 text-right">{est.totalEstimates}</td>
                            <td className="px-4 py-3 text-right">
                              ${est.avgValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${approvalBadge}`}
                              >
                                {est.approvalRate.toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {est.supplementRate.toFixed(1)}%
                            </td>
                            <td className="px-4 py-3 capitalize">{topLoss}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
