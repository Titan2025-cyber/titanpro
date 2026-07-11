/**
 * TechScorecard.tsx — #17 Technician Performance Scorecard
 * Photos per job, drying record compliance, callback rate, NPS attributed
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Camera, Droplets, Star, TrendingUp, Award } from "lucide-react";

const TEAM = ["John", "Mason", "Clint", "Blake", "Blake Foster", "Cody Brantley"];

function ScoreBadge({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? score / max : 0;
  const color = pct >= 0.8 ? "bg-green-100 text-green-700" : pct >= 0.5 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700";
  return <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${color}`}>{score}/{max}</span>;
}

export default function TechScorecard() {
  const { data: scorecard = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/tech-scorecard"],
    queryFn: () => apiRequest("GET", "/api/tech-scorecard").then(r => r.json()),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Award className="w-6 h-6 text-[hsl(var(--titan-blue))]" />
        <h1 className="text-xl font-bold">Technician Scorecard</h1>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-28 bg-muted animate-pulse rounded" />)}</div>
      ) : scorecard.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground"><Award className="w-10 h-10 mx-auto mb-2 opacity-30" /><p>No scorecard data yet. Jobs needed.</p></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {scorecard.map((tech: any, idx: number) => (
            <Card key={tech.name} className="border-l-4 border-[hsl(var(--titan-blue))]">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[hsl(var(--titan-blue)/0.15)] flex items-center justify-center">
                      <User className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
                    </div>
                    <div>
                      <p className="font-semibold">{tech.name}</p>
                      <p className="text-xs text-muted-foreground">{tech.jobsCompleted} jobs completed</p>
                    </div>
                  </div>
                  {idx === 0 && (
                    <Badge className="bg-yellow-100 text-yellow-700 gap-1">
                      <Star className="w-3 h-3" />Top Performer
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                  <div className="bg-muted/40 rounded p-2">
                    <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
                      <Camera className="w-3 h-3" />Photos/Job
                    </div>
                    <p className="font-bold text-sm">{tech.avgPhotosPerJob?.toFixed(1) || "0"}</p>
                    <p className="text-xs text-muted-foreground">{tech.avgPhotosPerJob >= 10 ? "✅ Good" : "⚠️ Low"}</p>
                  </div>
                  <div className="bg-muted/40 rounded p-2">
                    <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
                      <Droplets className="w-3 h-3" />Drying Logs
                    </div>
                    <p className="font-bold text-sm">{tech.dryingCompliance}%</p>
                    <p className="text-xs text-muted-foreground">{tech.dryingCompliance >= 80 ? "✅ Good" : "⚠️ Review"}</p>
                  </div>
                  <div className="bg-muted/40 rounded p-2">
                    <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
                      <TrendingUp className="w-3 h-3" />Jobs/Month
                    </div>
                    <p className="font-bold text-sm">{tech.jobsPerMonth?.toFixed(1) || "0"}</p>
                  </div>
                  <div className="bg-muted/40 rounded p-2">
                    <div className="flex items-center gap-1 text-muted-foreground text-xs mb-1">
                      <Star className="w-3 h-3" />Avg NPS
                    </div>
                    <p className="font-bold text-sm">{tech.avgNps !== null ? tech.avgNps?.toFixed(1) : "—"}</p>
                    <p className="text-xs text-muted-foreground">{tech.npsCount} survey{tech.npsCount !== 1 ? "s" : ""}</p>
                  </div>
                </div>

                {/* Progress bars */}
                <div className="mt-3 space-y-1.5">
                  {[
                    { label: "Photo Compliance", value: Math.min((tech.avgPhotosPerJob / 15) * 100, 100) },
                    { label: "Drying Log Compliance", value: tech.dryingCompliance },
                    { label: "NPS Score", value: tech.avgNps !== null ? (tech.avgNps / 10) * 100 : 0 },
                  ].map(bar => (
                    <div key={bar.label}>
                      <div className="flex justify-between text-xs text-muted-foreground mb-0.5">
                        <span>{bar.label}</span><span>{Math.round(bar.value)}%</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${bar.value >= 80 ? "bg-green-500" : bar.value >= 50 ? "bg-yellow-400" : "bg-[hsl(var(--titan-red))]"}`} style={{ width: `${bar.value}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
