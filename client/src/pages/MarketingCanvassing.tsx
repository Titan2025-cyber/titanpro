// MarketingCanvassing.tsx (Push 6 #13)
//
// Neighborhood canvassing tool. After a big job (water/fire/storm),
// generate a mailing list of every address within a radius of the loss
// property. Rep prints letters, doorknob hangers, or postcards and works
// the list door-by-door / mail-drop.
//
// Address generation: pulls jobs / contacts within N ft of the anchor job
// using Haversine distance (server-side). For a production build, this
// would ideally hit a parcel-data API (RealEstateAPI, Melissa, PropStream);
// for now, uses your own historical customer base as the seed list — you
// still get value from your own prior-customer network before spending
// money on external parcel data.
//
// Outcome tracking per address: sent / knocked / responded / booked / no_op.

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Map, Plus, Download, MapPin, CheckCircle2, XCircle, Home, Ruler,
} from "lucide-react";

const OUTCOMES = [
  { value: "pending", label: "Pending", color: "bg-muted" },
  { value: "sent", label: "Mailed", color: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
  { value: "knocked", label: "Knocked", color: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  { value: "responded", label: "Responded", color: "bg-purple-500/15 text-purple-700 dark:text-purple-400" },
  { value: "booked", label: "Booked!", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  { value: "no_op", label: "No answer / decline", color: "bg-muted text-muted-foreground" },
];

export default function MarketingCanvassing() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState({
    jobId: "",
    radiusFt: "500",
    campaignName: "",
  });

  const { data: lists = [] } = useQuery<any[]>({ queryKey: ["/api/canvassing-lists"] });
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ["/api/jobs"] });

  // Only jobs with lat/lng are eligible as anchor
  const eligibleJobs = (jobs as any[]).filter(
    (j) => typeof j.latitude === "number" && typeof j.longitude === "number",
  );

  const activeList = lists.find((l) => l.id === activeListId);
  const { data: addresses = [] } = useQuery<any[]>({
    queryKey: ["/api/canvassing-lists", activeListId, "addresses"],
    queryFn: () =>
      apiRequest("GET", `/api/canvassing-lists/${activeListId}/addresses`).then((r) => r.json()),
    enabled: activeListId !== null,
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => apiRequest("POST", "/api/canvassing-lists", payload).then((r) => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/canvassing-lists"] });
      toast({
        title: "Canvassing list generated",
        description: `${data.addressCount || 0} addresses found within ${draft.radiusFt}ft`,
      });
      setCreateOpen(false);
      if (data.id) setActiveListId(data.id);
    },
    onError: (e: any) =>
      toast({ title: "Couldn't create list", description: e.message, variant: "destructive" }),
  });

  const outcomeMutation = useMutation({
    mutationFn: ({ id, outcome }: { id: number; outcome: string }) =>
      apiRequest("PATCH", `/api/canvassing-addresses/${id}`, { outcome, updatedAt: new Date().toISOString() }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["/api/canvassing-lists", activeListId, "addresses"],
      }),
  });

  const stats = useMemo(() => {
    const total = addresses.length;
    const byOutcome: Record<string, number> = {};
    for (const a of addresses) {
      const o = a.outcome || "pending";
      byOutcome[o] = (byOutcome[o] || 0) + 1;
    }
    return { total, byOutcome };
  }, [addresses]);

  const exportCsv = () => {
    if (addresses.length === 0) return;
    const header = "address,city,state,zip,distance_ft,outcome,notes\n";
    const rows = addresses
      .map((a) => {
        const cells = [
          a.address || "",
          a.city || "",
          a.state || "",
          a.zip || "",
          a.distance_ft ?? a.distanceFt ?? "",
          a.outcome || "pending",
          (a.notes || "").replace(/"/g, '""'),
        ].map((c) => `"${c}"`);
        return cells.join(",");
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `canvassing-${activeList?.name || activeListId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-4 flex items-start gap-3">
          <Map className="w-5 h-5 mt-0.5 text-primary shrink-0" />
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              Neighborhood canvassing after big jobs.
            </span>{" "}
            When you finish a water or fire loss, generate a list of every
            address within 500 ft — neighbors often had the same storm, the same
            plumbing age, or the same tree that fell. Mail them a "we just
            helped a neighbor" postcard. Cheapest lead source in restoration.
          </div>
        </CardContent>
      </Card>

      {/* Header + generate button */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">Canvassing lists ({lists.length})</h2>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-generate-list">
              <Plus className="w-4 h-4 mr-1.5" /> Generate list from job
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New canvassing list</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Anchor job</Label>
                <Select value={draft.jobId} onValueChange={(v) => setDraft({ ...draft, jobId: v })}>
                  <SelectTrigger><SelectValue placeholder="Pick a job with an address on file" /></SelectTrigger>
                  <SelectContent>
                    {eligibleJobs.length === 0 && (
                      <div className="p-3 text-sm text-muted-foreground">
                        No jobs with coordinates yet. Enter latitude/longitude on a job first.
                      </div>
                    )}
                    {eligibleJobs.slice(0, 50).map((j: any) => (
                      <SelectItem key={j.id} value={String(j.id)}>
                        {j.jobNumber} — {j.propertyAddress}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Radius (feet)</Label>
                <Select value={draft.radiusFt} onValueChange={(v) => setDraft({ ...draft, radiusFt: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="250">250 ft — immediate neighbors</SelectItem>
                    <SelectItem value="500">500 ft — city block</SelectItem>
                    <SelectItem value="1000">1000 ft — neighborhood</SelectItem>
                    <SelectItem value="2500">2500 ft — subdivision</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Campaign name (optional)</Label>
                <Input
                  value={draft.campaignName}
                  onChange={(e) => setDraft({ ...draft, campaignName: e.target.value })}
                  placeholder="e.g. Peach Orchard water hit — postcard drop"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                disabled={!draft.jobId || createMutation.isPending}
                onClick={() =>
                  createMutation.mutate({
                    jobId: Number(draft.jobId),
                    radiusFt: Number(draft.radiusFt),
                    name: draft.campaignName || undefined,
                  })
                }
                data-testid="button-create-list"
              >
                Generate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Lists picker */}
      {lists.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {lists.map((l: any) => (
            <Button
              key={l.id}
              size="sm"
              variant={activeListId === l.id ? "default" : "outline"}
              onClick={() => setActiveListId(l.id)}
              data-testid={`list-${l.id}`}
            >
              {l.name || `List #${l.id}`}
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {l.address_count ?? l.addressCount ?? 0}
              </Badge>
            </Button>
          ))}
        </div>
      )}

      {/* Active list detail */}
      {activeList ? (
        <>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold">
                    {activeList.name || `List #${activeList.id}`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                    <Ruler className="w-3 h-3" />
                    <span>{activeList.radius_ft ?? activeList.radiusFt}ft radius</span>
                    <span>·</span>
                    <span>{stats.total} addresses</span>
                    {stats.byOutcome.booked > 0 && (
                      <>
                        <span>·</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                          {stats.byOutcome.booked} booked
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={exportCsv} disabled={addresses.length === 0}>
                  <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
                </Button>
              </div>
            </CardContent>
          </Card>

          {addresses.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No addresses in this list yet. In a production setup this would
                be populated from parcel data around the anchor job.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-1.5">
              {addresses.map((a: any) => (
                <Card key={a.id} data-testid={`addr-${a.id}`}>
                  <CardContent className="p-3 flex items-center gap-3 flex-wrap">
                    <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{a.address}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.city || ""} {a.state || ""} {a.zip || ""}
                        {(a.distance_ft ?? a.distanceFt) && (
                          <> · {a.distance_ft ?? a.distanceFt}ft away</>
                        )}
                      </div>
                    </div>
                    <Select
                      value={a.outcome || "pending"}
                      onValueChange={(v) => outcomeMutation.mutate({ id: a.id, outcome: v })}
                    >
                      <SelectTrigger className="w-[180px] h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {OUTCOMES.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : lists.length > 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Pick a list above to see its addresses.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No canvassing lists yet. After you finish a big job, generate a list
            of nearby addresses to work the neighborhood.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
