// MarketingGoals.tsx (Push 6 #7)
//
// Set weekly targets per marketing metric. The Today tab reads these to
// render pace indicators (green / amber / red) on each KPI card.
//
// Design: one row per metric, one number field, one save button. That's it.
// No sliders, no complicated onboarding. Targets are per-week and reset
// weekly automatically (Monday is the anchor).

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Target, Save, Star, Percent, MessageSquare, Handshake } from "lucide-react";

const METRICS = [
  {
    key: "jobs_sold",
    label: "Jobs sold this week",
    icon: Star,
    help: "How many closed-won jobs you want to book Mon–Sun.",
    suggested: 5,
  },
  {
    key: "conversion_pct",
    label: "Conversion % this week",
    icon: Percent,
    help: "Sold jobs ÷ opportunities closed. 25–50% is healthy in restoration.",
    suggested: 40,
  },
  {
    key: "reviews_sent",
    label: "Reviews sent this week",
    icon: MessageSquare,
    help: "Manual review requests sent from Marketing → Reviews.",
    suggested: 10,
  },
  {
    key: "active_partners",
    label: "Active referral partners",
    icon: Handshake,
    help: "Partners you've touched in the last 90 days.",
    suggested: 20,
  },
];

// Monday of current week, YYYY-MM-DD
const weekStartISO = () => {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - (day === 0 ? 6 : day - 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

export default function MarketingGoals() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const weekStart = weekStartISO();

  const { data: goals = [] } = useQuery<any[]>({
    queryKey: ["/api/marketing-goals", { weekStart }],
    queryFn: () =>
      apiRequest("GET", `/api/marketing-goals?weekStart=${weekStart}`).then((r) => r.json()),
  });

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Seed drafts from server data on first load
  useEffect(() => {
    if (goals.length > 0) {
      const seed: Record<string, string> = {};
      for (const g of goals) {
        const m = g.metric ?? g;
        const t = g.target ?? 0;
        if (m) seed[m] = String(t);
      }
      setDrafts((prev) => ({ ...seed, ...prev }));
    }
  }, [goals]);

  const saveMutation = useMutation({
    mutationFn: ({ metric, target }: { metric: string; target: number }) =>
      apiRequest("POST", "/api/marketing-goals", {
        metric,
        target,
        weekStart,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketing-goals"] });
      toast({ title: "Goal saved" });
    },
    onError: (e: any) =>
      toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-4 flex items-start gap-3">
          <Target className="w-5 h-5 mt-0.5 text-primary shrink-0" />
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Weekly goals drive pace tracking.</span>{" "}
            Set targets here and the Today tab shows green / amber / red pace
            indicators on each KPI card so you know if you're on track by
            Wednesday. Goals reset every Monday.
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground">
        Week of {weekStart} · Monday to Sunday
      </div>

      <div className="space-y-3">
        {METRICS.map((m) => {
          const current = goals.find((g: any) => (g.metric ?? "") === m.key);
          const currentTarget = current?.target ?? 0;
          const draft = drafts[m.key] ?? String(currentTarget || "");
          const changed = draft !== String(currentTarget || "");
          const Icon = m.icon;
          return (
            <Card key={m.key} data-testid={`goal-${m.key}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <Icon className="w-5 h-5 mt-1 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <Label className="text-sm font-medium">{m.label}</Label>
                    <p className="text-xs text-muted-foreground mt-1">{m.help}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Input
                      type="number"
                      min={0}
                      className="w-24 h-9"
                      value={draft}
                      onChange={(e) => setDrafts({ ...drafts, [m.key]: e.target.value })}
                      placeholder={String(m.suggested)}
                      data-testid={`input-${m.key}`}
                    />
                    <Button
                      size="sm"
                      className="h-9"
                      disabled={!changed || saveMutation.isPending}
                      onClick={() =>
                        saveMutation.mutate({ metric: m.key, target: Number(draft) || 0 })
                      }
                      data-testid={`save-${m.key}`}
                    >
                      <Save className="w-3.5 h-3.5 mr-1" />
                      {changed ? "Save" : "Saved"}
                    </Button>
                  </div>
                </div>
                {currentTarget > 0 && (
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-2 pl-8">
                    Current target: {currentTarget}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
