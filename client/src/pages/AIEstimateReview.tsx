import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Bot, AlertTriangle, CheckCircle2, Shield, ChevronDown, ChevronUp, Zap, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import type { Estimate, Job } from "@shared/schema";

export default function AIEstimateReview() {
  const { toast } = useToast();
  const [selectedEstimateId, setSelectedEstimateId] = useState<string>("");
  const [result, setResult] = useState<any>(null);
  const [expandedFlags, setExpandedFlags] = useState<Set<number>>(new Set());

  const { data: estimates = [] } = useQuery<Estimate[]>({ queryKey: ["/api/estimates"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  const reviewMutation = useMutation({
    mutationFn: (estimateId: string) =>
      apiRequest("POST", `/api/estimates/${estimateId}/ai-review`, {}).then(r => r.json()),
    onSuccess: (data) => {
      setResult(data);
      toast({ title: "Review complete", description: `Score: ${data.overallScore}/100` });
    },
    onError: () => toast({ title: "Review failed", variant: "destructive" }),
  });

  const toggleFlag = (i: number) => {
    setExpandedFlags(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const getEstimateJob = (estimate: Estimate) => jobs.find(j => j.id === estimate.jobId);

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBg = (score: number) => {
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Bot className="w-5 h-5 text-[hsl(var(--titan-blue))]" />AI Estimate Review
        </h1>
        <p className="text-sm text-muted-foreground">Analyze estimates for carrier-specific denial risk and strengthen documentation before submission</p>
      </div>

      {/* Selector */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Select Estimate to Review</label>
              <Select value={selectedEstimateId} onValueChange={setSelectedEstimateId}>
                <SelectTrigger data-testid="select-estimate">
                  <SelectValue placeholder="Choose an estimate..." />
                </SelectTrigger>
                <SelectContent>
                  {estimates.map(e => {
                    const job = getEstimateJob(e);
                    return (
                      <SelectItem key={e.id} value={String(e.id)}>
                        {e.title} {job ? `— ${job.jobNumber}` : ""} (${(e.total || 0).toLocaleString()})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => { setResult(null); reviewMutation.mutate(selectedEstimateId); }}
                disabled={!selectedEstimateId || reviewMutation.isPending}
                className="w-full bg-[hsl(var(--titan-blue))] text-white"
                data-testid="button-run-review"
              >
                {reviewMutation.isPending ? (
                  <><div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin mr-2" />Analyzing...</>
                ) : (
                  <><Zap className="w-4 h-4 mr-2" />Run AI Review</>
                )}
              </Button>
            </div>
          </div>

          {/* How it works */}
          {!result && !reviewMutation.isPending && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              {[
                { icon: "🔍", title: "Carrier Pattern Analysis", desc: "Checks each line item against carrier-specific denial history for State Farm, Allstate, Nationwide, and USAA" },
                { icon: "⚖️", title: "State Law Integration", desc: "Automatically detects GA vs SC job location and cites relevant insurance statutes to defend disputed items" },
                { icon: "📊", title: "Pricing Risk Flags", desc: "Flags line items priced above Xactimate regional benchmarks for Augusta/CSRA that may trigger carrier review" },
              ].map(s => (
                <div key={s.title} className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xl mb-1">{s.icon}</p>
                  <p className="text-xs font-semibold text-foreground">{s.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Score Card */}
          <Card className={`border-l-4 ${result.overallScore >= 80 ? "border-l-green-500" : result.overallScore >= 60 ? "border-l-yellow-500" : "border-l-red-500"}`}>
            <CardContent className="p-4">
              <div className="flex items-start gap-4 flex-wrap">
                <div className="text-center">
                  <p className={`text-5xl font-black ${getScoreColor(result.overallScore)}`}>{result.overallScore}</p>
                  <p className="text-xs text-muted-foreground font-medium">APPROVAL SCORE</p>
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{result.carrier || "Unknown Carrier"}</Badge>
                    <Badge variant="outline">{result.state} Law Applied</Badge>
                    <Badge variant={result.flags.filter((f: any) => f.risk === "high").length > 0 ? "destructive" : "default"}>
                      {result.flags.filter((f: any) => f.risk === "high").length} high-risk items
                    </Badge>
                    <Badge variant="secondary">
                      {result.flags.filter((f: any) => f.risk === "medium").length} medium-risk items
                    </Badge>
                  </div>
                  <Progress value={result.overallScore} className="h-2" />
                  <p className="text-sm text-foreground">{result.summary}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Flags */}
          {result.flags.length > 0 ? (
            <div className="space-y-3">
              <h3 className="font-semibold text-foreground">Flagged Line Items</h3>
              {result.flags.map((flag: any, i: number) => (
                <Card key={i} className={`border-l-4 ${flag.risk === "high" ? "border-l-red-500" : "border-l-yellow-500"}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1">
                        {flag.risk === "high" ? (
                          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-foreground">{flag.lineItem}</span>
                            <Badge variant={flag.risk === "high" ? "destructive" : "secondary"} className="text-xs">
                              {flag.risk} risk
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => toggleFlag(i)}>
                        {expandedFlags.has(i) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </div>

                    {expandedFlags.has(i) && (
                      <div className="mt-3 space-y-3 pl-8">
                        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-1">💡 Recommendation</p>
                          <p className="text-xs text-amber-800 dark:text-amber-200">{flag.suggestion}</p>
                        </div>
                        {flag.statute && (
                          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                            <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">⚖️ {result.state} Insurance Law</p>
                            <p className="text-xs text-blue-800 dark:text-blue-200">{flag.statute}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="border-l-4 border-l-green-500">
              <CardContent className="p-4 flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-green-500" />
                <div>
                  <p className="font-semibold text-foreground">No high-risk items detected</p>
                  <p className="text-sm text-muted-foreground">{result.summary}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Reviewed at */}
          <p className="text-xs text-muted-foreground text-right">
            Reviewed {new Date(result.reviewedAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}
