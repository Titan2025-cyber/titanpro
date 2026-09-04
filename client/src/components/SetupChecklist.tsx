import { useEffect, useState } from "react";
import { CheckCircle2, Circle, X, ArrowRight, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";

/**
 * First-run setup checklist shown on the Dashboard for owner/admin users.
 *
 * The intent is to give a brand-new tenant a tour of the concrete steps that
 * make Titan Pro actually useful (invite team, connect Gmail, add a job,
 * import a price list, etc.) instead of dropping them on an empty
 * dashboard with no idea what to do next.
 *
 * Rules:
 *  - Only shown to owner/admin/general_manager (endpoint enforces role).
 *  - Dismissible per-browser via localStorage. Reappears if the user
 *    clears storage or changes device — that's intentional. It also
 *    hides automatically once every required item is done.
 *  - Fetches lazily; if the endpoint 403s or 404s (older backend, tech
 *    role), the card silently renders nothing.
 */

type ChecklistItem = {
  key: string;
  title: string;
  description: string;
  cta: { label: string; href: string };
  status: "done" | "todo" | "optional";
  detail?: string;
};

type ChecklistResponse = {
  items: ChecklistItem[];
  doneCount: number;
  total: number;
  complete: boolean;
};

const DISMISS_KEY = "titanpro:setup-checklist-dismissed";

export default function SetupChecklist() {
  const [data, setData] = useState<ChecklistResponse | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/setup/checklist", { credentials: "include" });
        if (!res.ok) { setLoaded(true); return; }
        const json = await res.json();
        if (!cancelled) { setData(json); setLoaded(true); }
      } catch {
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [dismissed]);

  if (dismissed || !loaded || !data) return null;
  if (data.complete) return null; // Auto-hide once nothing required remains.

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* noop */ }
    setDismissed(true);
  };

  const pct = data.total ? Math.round((data.doneCount / data.total) * 100) : 0;
  const requiredRemaining = data.items.filter(i => i.status === "todo").length;
  const optionalRemaining = data.items.filter(i => i.status === "optional").length;

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 mt-0.5">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">Finish setting up Titan Pro</h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {data.doneCount}/{data.total} complete
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {requiredRemaining > 0
                  ? `${requiredRemaining} required step${requiredRemaining === 1 ? "" : "s"} to go`
                  : `Just ${optionalRemaining} optional step${optionalRemaining === 1 ? "" : "s"} left`}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={dismiss}
            title="Dismiss for this browser"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="mt-3">
          <Progress value={pct} className="h-1.5" />
        </div>

        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {data.items.map((item) => {
            const done = item.status === "done";
            const optional = item.status === "optional";
            return (
              <li
                key={item.key}
                className={`flex items-start gap-3 rounded-md border p-3 ${
                  done ? "border-border/40 bg-muted/30" : "border-border/60 bg-card"
                }`}
              >
                <div className="shrink-0 mt-0.5">
                  {done
                    ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                    : <Circle className={`w-4 h-4 ${optional ? "text-muted-foreground/60" : "text-muted-foreground"}`} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                      {item.title}
                    </span>
                    {optional && !done && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        Optional
                      </span>
                    )}
                  </div>
                  {!done && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>
                  )}
                  {item.detail && (
                    <p className="text-[11px] text-muted-foreground/80 mt-1 tabular-nums">{item.detail}</p>
                  )}
                  {!done && (
                    <Link href={item.cta.href.replace(/^\/#/, "")}>
                      <a className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                        {item.cta.label} <ArrowRight className="w-3 h-3" />
                      </a>
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
