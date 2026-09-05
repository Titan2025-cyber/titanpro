import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, GitMerge, AlertTriangle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * CarrierMergeDialog — reassign scorecard rows for typo-split carriers.
 *
 * Fixes rows like "State Farm" / "Statefarm" / "State Farm Ins" that showed
 * up as three separate carriers on the scorecard because different
 * adjusters typed the name differently.
 *
 * Flow:
 *   1. Operator picks the CANONICAL name (typed or picked from the list).
 *   2. Operator checks every alias to fold into it.
 *   3. Preview endpoint reports how many jobs will be reassigned.
 *   4. Confirm → server updates jobs.insurance_carrier + soft-deletes
 *      the alias rows in insurance_carriers.
 */

type CarrierRow = { name: string; totalJobs?: number };

export function CarrierMergeDialog({
  open,
  onOpenChange,
  carriers,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Rows visible on the scorecard, used as the alias source list. */
  carriers: CarrierRow[];
  /** Called after a successful merge so the parent can refetch. */
  onDone?: () => void;
}) {
  const { toast } = useToast();
  const [canonical, setCanonical] = useState<string>("");
  const [aliases, setAliases] = useState<Set<string>>(new Set());

  // Directory of active carriers — used to seed the canonical name
  // dropdown so operators can pick from a curated list rather than typing.
  const { data: directory = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/insurance-carriers"],
    queryFn: () => apiRequest("GET", "/api/insurance-carriers").then((r) => r.json()),
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) {
      setCanonical("");
      setAliases(new Set());
    }
  }, [open]);

  // Aliases we can offer: every scorecard name that isn't the canonical.
  // Case-insensitive filter so picking "State Farm" hides itself.
  const aliasOptions = useMemo(() => {
    const c = canonical.trim().toLowerCase();
    return carriers
      .filter((r) => r.name.trim().toLowerCase() !== c)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [carriers, canonical]);

  const toggleAlias = (name: string) => {
    setAliases((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const preview = useQuery<{
    canonical: string;
    aliases: string[];
    perAlias: { alias: string; jobs: number }[];
    totalJobs: number;
  }>({
    queryKey: [
      "/api/insurance-carriers/merge/preview",
      canonical,
      Array.from(aliases).sort().join("|"),
    ],
    queryFn: () =>
      apiRequest("POST", "/api/insurance-carriers/merge/preview", {
        canonical: canonical.trim(),
        aliases: Array.from(aliases),
      }).then((r) => r.json()),
    enabled: open && !!canonical.trim() && aliases.size > 0,
    staleTime: 5_000,
  });

  const mergeMut = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/insurance-carriers/merge", {
        canonical: canonical.trim(),
        aliases: Array.from(aliases),
      }).then((r) => r.json()),
    onSuccess: (data: any) => {
      toast({
        title: "Merge complete",
        description: `Moved ${data.jobsMoved} job(s) to "${data.canonical}".`,
      });
      // Bust every downstream cache that reads carrier data.
      queryClient.invalidateQueries({ queryKey: ["/api/insurance-carriers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-scorecard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      onDone?.();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({
        title: "Merge failed",
        description: String(err?.message || err),
        variant: "destructive",
      });
    },
  });

  const canPreview = !!canonical.trim() && aliases.size > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4" />
            Merge duplicate carriers
          </DialogTitle>
          <DialogDescription>
            Fold typo-split names (e.g. "Statefarm", "State Farm Ins") into
            one canonical name. Jobs are reassigned in place — nothing is
            deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Canonical picker — free text OR quick-select from the directory. */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Keep this name (canonical)
            </label>
            <Input
              value={canonical}
              onChange={(e) => setCanonical(e.target.value)}
              placeholder="e.g. State Farm"
              className="mt-1"
              data-testid="input-canonical-name"
            />
            {directory.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {directory.slice(0, 12).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="rounded-full border px-2 py-0.5 text-[11px] hover:bg-muted"
                    onClick={() => setCanonical(d.name)}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Alias checklist. */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Merge these into it
            </label>
            <div className="mt-1 max-h-60 overflow-y-auto rounded-md border p-2 space-y-1">
              {aliasOptions.length === 0 && (
                <div className="text-xs text-muted-foreground py-4 text-center">
                  {canonical.trim()
                    ? "No other carrier rows to merge."
                    : "Enter a canonical name above to see mergeable rows."}
                </div>
              )}
              {aliasOptions.map((r) => {
                const checked = aliases.has(r.name);
                return (
                  <label
                    key={r.name}
                    className={`flex items-center gap-2 rounded px-2 py-1 text-sm cursor-pointer ${checked ? "bg-muted" : "hover:bg-muted/60"}`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleAlias(r.name)}
                    />
                    <span className="flex-1 truncate">{r.name}</span>
                    {typeof r.totalJobs === "number" && (
                      <Badge variant="secondary" className="text-[10px]">
                        {r.totalJobs} job{r.totalJobs === 1 ? "" : "s"}
                      </Badge>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Preview strip — count of jobs about to move. */}
          {canPreview && (
            <div className="rounded-md border bg-blue-50/60 p-3 text-sm">
              {preview.isFetching ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Counting jobs…
                </div>
              ) : preview.data ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">
                      {preview.data.totalJobs} job
                      {preview.data.totalJobs === 1 ? "" : "s"}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 opacity-60" />
                    <span className="font-medium text-[hsl(var(--titan-blue))]">
                      {canonical.trim()}
                    </span>
                  </div>
                  {preview.data.perAlias.length > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      {preview.data.perAlias
                        .map((p) => `${p.alias} (${p.jobs})`)
                        .join(" · ")}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* Safety copy — merging is one-way here (undo would need a manual
              re-merge back). */}
          {canPreview && (
            <div className="flex items-start gap-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                This rewrites the insurance carrier on every affected job.
                To undo, run a merge in the other direction.
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canPreview || mergeMut.isPending}
            onClick={() => mergeMut.mutate()}
            data-testid="button-confirm-merge"
          >
            {mergeMut.isPending ? "Merging…" : `Merge ${aliases.size} → 1`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
