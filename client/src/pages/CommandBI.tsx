import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { Brain, TrendingUp, DollarSign, AlertTriangle, BarChart3, Search } from "lucide-react";

const COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4"];

const QUICK_QUESTIONS = [
  "Which loss type generates the most revenue?",
  "Which carrier has the most outstanding A/R?",
  "How many jobs are currently open?",
  "What is my total collected revenue?",
  "How many jobs were completed this month?",
  "What is my outstanding A/R total?",
];

function answerQuestion(q: string, data: any): string {
  if (!data) return "Loading data...";
  const q2 = q.toLowerCase();

  if (q2.includes("loss type") && q2.includes("revenue")) {
    const sorted = Object.entries(data.revenueByLossType || {}).sort((a: any, b: any) => b[1] - a[1]);
    if (!sorted.length) return "No revenue data yet.";
    const [type, amount] = sorted[0];
    return `${type.charAt(0).toUpperCase() + type.slice(1)} loss generates the most revenue at $${(amount as number).toLocaleString("en-US", { minimumFractionDigits: 2 })}.`;
  }
  if (q2.includes("carrier") && (q2.includes("a/r") || q2.includes("outstanding"))) {
    const sorted = Object.entries(data.carrierAging || {}).sort((a: any, b: any) => b[1].total - a[1].total);
    if (!sorted.length) return "No outstanding A/R by carrier.";
    const [carrier, info] = sorted[0] as [string, any];
    return `${carrier} has the most outstanding A/R at $${info.total.toLocaleString("en-US", { minimumFractionDigits: 2 })} across ${info.count} invoice(s).`;
  }
  if (q2.includes("open")) {
    return `There are currently ${data.openJobs} open jobs in the pipeline.`;
  }
  if (q2.includes("collected") || (q2.includes("total") && q2.includes("revenue"))) {
    return `Total collected revenue is $${(data.totalRevenue || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}.`;
  }
  if (q2.includes("completed") && q2.includes("month")) {
    const thisMonth = new Date().toISOString().slice(0, 7);
    return `Revenue collected this month (${thisMonth}): $${((data.monthlyRevenue || []).find((m: any) => m.month.toLowerCase().includes(new Date().toLocaleString("default", { month: "short" }).toLowerCase()))?.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}.`;
  }
  if (q2.includes("outstanding") || q2.includes("a/r")) {
    return `Total outstanding A/R is $${(data.outstandingAR || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}.`;
  }
  return `I found ${data.totalJobs} total jobs with $${(data.totalRevenue || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} in collected revenue and $${(data.outstandingAR || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} in outstanding A/R. Try asking about a specific metric above.`;
}

export default function CommandBI() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/reports/bi-overview"],
    queryFn: () => apiRequest("/api/reports/bi-overview").then(r => r.json()),
  });

  function ask(q: string) {
    setQuestion(q);
    setAnswer(answerQuestion(q, data));
  }

  const lossTypeData = Object.entries(data?.revenueByLossType || {}).map(([name, value]) => ({ name, value: Math.round(value as number) }));
  const statusData = Object.entries(data?.jobsByStatus || {}).map(([name, value]) => ({ name, value: value as number }));
  const carrierData = Object.entries(data?.carrierAging || {}).map(([name, info]: [string, any]) => ({ name, total: Math.round(info.total), count: info.count })).slice(0, 6);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" /> Owner Command Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Ask plain-English questions about your business — instant answers from live Titan Pro data</p>
      </div>

      {/* BI Question Bar */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4 space-y-3">
          <div className="flex gap-2">
            <Input
              data-testid="input-bi-question"
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="Ask anything — e.g. 'Which carrier has the most outstanding A/R?'"
              onKeyDown={e => e.key === "Enter" && ask(question)}
              className="flex-1"
            />
            <Button onClick={() => ask(question)} disabled={!question || isLoading} data-testid="button-ask">
              <Search className="w-4 h-4 mr-2" />Ask
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {QUICK_QUESTIONS.map(q => (
              <button key={q} className="text-xs px-2 py-1 rounded-full border border-primary/30 text-primary hover:bg-primary/10 transition-colors" onClick={() => ask(q)} data-testid={`quick-q-${q.slice(0, 10).replace(/ /g, "-")}`}>
                {q}
              </button>
            ))}
          </div>
          {answer && (
            <div className="bg-background rounded-lg p-3 border border-border" data-testid="bi-answer">
              <p className="text-sm font-semibold flex items-center gap-2"><Brain className="w-4 h-4 text-primary" />Answer</p>
              <p className="text-sm mt-1">{answer}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPI Row */}
      {isLoading ? <p className="text-center py-8 text-muted-foreground">Loading analytics...</p> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Jobs", value: data?.totalJobs ?? 0, icon: BarChart3, color: "text-primary" },
              { label: "Open Jobs", value: data?.openJobs ?? 0, icon: TrendingUp, color: "text-blue-500" },
              { label: "Total Revenue", value: `$${(data?.totalRevenue || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`, icon: DollarSign, color: "text-green-500" },
              { label: "Outstanding A/R", value: `$${(data?.outstandingAR || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`, icon: AlertTriangle, color: data?.outstandingAR > 0 ? "text-yellow-500" : "text-green-500" },
            ].map(kpi => (
              <Card key={kpi.label}><CardContent className="p-4 flex items-center gap-3"><kpi.icon className={`w-8 h-8 ${kpi.color}`} /><div><p className="text-xs text-muted-foreground">{kpi.label}</p><p className="text-lg font-bold" data-testid={`kpi-${kpi.label.toLowerCase().replace(/ /g, "-")}`}>{kpi.value}</p></div></CardContent></Card>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Monthly Revenue */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Monthly Revenue (Last 6 Months)</CardTitle></CardHeader>
              <CardContent>
                {(data?.monthlyRevenue || []).every((m: any) => m.amount === 0) ? (
                  <p className="text-center py-6 text-muted-foreground text-sm">No payment data yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={data?.monthlyRevenue || []}>
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: any) => [`$${v.toLocaleString()}`, "Revenue"]} />
                      <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Revenue by Loss Type */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Revenue by Loss Type</CardTitle></CardHeader>
              <CardContent>
                {lossTypeData.length === 0 ? (
                  <p className="text-center py-6 text-muted-foreground text-sm">No revenue data yet</p>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={lossTypeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                        {lossTypeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => [`$${v.toLocaleString()}`, "Revenue"]} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Job Pipeline */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Job Pipeline by Status</CardTitle></CardHeader>
              <CardContent>
                {statusData.length === 0 ? (
                  <p className="text-center py-6 text-muted-foreground text-sm">No job data</p>
                ) : (
                  <div className="space-y-2">
                    {statusData.map((s, i) => (
                      <div key={s.name} className="flex items-center gap-3">
                        <span className="text-xs w-24 capitalize truncate">{s.name}</span>
                        <div className="flex-1 bg-muted rounded-full h-2">
                          <div className="h-2 rounded-full" style={{ width: `${(s.value / (data?.totalJobs || 1)) * 100}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                        </div>
                        <span className="text-xs font-bold w-6 text-right">{s.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Carrier A/R */}
            <Card>
              <CardHeader><CardTitle className="text-sm">Outstanding A/R by Carrier</CardTitle></CardHeader>
              <CardContent>
                {carrierData.length === 0 ? (
                  <p className="text-center py-6 text-muted-foreground text-sm">No outstanding A/R</p>
                ) : (
                  <div className="space-y-2">
                    {carrierData.map((c, i) => (
                      <div key={c.name} className="flex items-center justify-between gap-2">
                        <span className="text-xs truncate flex-1">{c.name}</span>
                        <Badge variant="outline" className="text-xs">{c.count} inv</Badge>
                        <span className="text-xs font-bold text-right">${c.total.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
