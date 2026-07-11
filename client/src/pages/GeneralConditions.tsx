import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardCheck, DollarSign, AlertTriangle, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface GCItem { code: string; label: string; category: string; estimatedValue: number; billed: boolean; notes: string; }
interface GCChecklist { id: number; jobId: number; items: string; totalMissed: number; totalBilled: number; completedBy: string; completedAt: string; }
interface Job { id: number; jobNumber: string; address: string; }

const CATEGORY_ORDER = ["Labor", "Site", "Documentation", "Cleaning", "CAT"];
const CATEGORY_COLORS: Record<string, string> = {
  Labor: "text-blue-600", Site: "text-orange-600", Documentation: "text-purple-600",
  Cleaning: "text-green-600", CAT: "text-red-600",
};

export default function GeneralConditions() {
  const { toast } = useToast();
  const [selectedJobId, setSelectedJobId] = useState("");
  const [items, setItems] = useState<GCItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then(r => r.json()),
  });

  const { data: checklist, isLoading } = useQuery<GCChecklist>({
    queryKey: ["/api/general-conditions", selectedJobId],
    queryFn: () => apiRequest(`/api/general-conditions/${selectedJobId}`).then(r => r.json()),
    enabled: !!selectedJobId,
    onSuccess: (data: GCChecklist) => {
      const parsed: GCItem[] = typeof data.items === "string" ? JSON.parse(data.items) : data.items;
      setItems(parsed);
      setLoaded(true);
    },
  } as any);

  const saveMutation = useMutation({
    mutationFn: (data: { items: GCItem[]; completedBy: string }) =>
      apiRequest(`/api/general-conditions/${selectedJobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: JSON.stringify(data.items), completedBy: data.completedBy }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/general-conditions"] });
      toast({ title: "Checklist Saved" });
    },
  });

  const toggleItem = (code: string) => {
    setItems(prev => prev.map(i => i.code === code ? { ...i, billed: !i.billed } : i));
  };

  const totalBilled = items.filter(i => i.billed).reduce((s, i) => s + i.estimatedValue, 0);
  const totalMissed = items.filter(i => !i.billed).reduce((s, i) => s + i.estimatedValue, 0);
  const billedCount = items.filter(i => i.billed).length;

  const grouped = CATEGORY_ORDER.reduce((acc, cat) => {
    acc[cat] = items.filter(i => i.category === cat);
    return acc;
  }, {} as Record<string, GCItem[]>);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <ClipboardCheck className="w-7 h-7 text-green-600" />
        <div>
          <h1 className="text-xl font-bold">General Conditions Checklist</h1>
          <p className="text-sm text-muted-foreground">22-item pre-invoice checklist — every legitimate Xactimate soft cost, verified before billing</p>
        </div>
      </div>

      {/* Job Selector */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-3 items-center flex-wrap">
            <Select value={selectedJobId} onValueChange={v => { setSelectedJobId(v); setLoaded(false); }}>
              <SelectTrigger className="w-80" data-testid="select-gc-job">
                <SelectValue placeholder="Select a job to review..." />
              </SelectTrigger>
              <SelectContent>
                {jobs.map(j => <SelectItem key={j.id} value={String(j.id)}>{j.jobNumber} — {j.address?.split(",")[0]}</SelectItem>)}
              </SelectContent>
            </Select>
            {selectedJobId && loaded && (
              <p className="text-sm text-muted-foreground">{billedCount} of {items.length} items billed</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {loaded && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Items Billed</p>
            <p className="text-2xl font-bold text-green-600">{billedCount}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Value Billed</p>
            <p className="text-2xl font-bold text-green-600">${totalBilled.toLocaleString()}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Not Yet Billed</p>
            <p className="text-2xl font-bold text-orange-600">{items.length - billedCount}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Potential Missed</p>
            <p className="text-2xl font-bold text-red-600">${totalMissed.toLocaleString()}</p>
          </CardContent></Card>
        </div>
      )}

      {/* Checklist */}
      {!selectedJobId ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">
          <ClipboardCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Select a job above to load its General Conditions checklist.</p>
        </CardContent></Card>
      ) : isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <>
          {CATEGORY_ORDER.map(cat => (
            <Card key={cat}>
              <CardHeader className="pb-2">
                <CardTitle className={`text-sm font-bold uppercase tracking-wide ${CATEGORY_COLORS[cat]}`}>{cat}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {grouped[cat]?.map(item => (
                    <div key={item.code} className={`flex items-center gap-4 px-4 py-3 transition-colors ${item.billed ? "bg-green-50/50 dark:bg-green-900/10" : ""}`}>
                      <Checkbox
                        data-testid={`checkbox-gc-${item.code}`}
                        checked={item.billed}
                        onCheckedChange={() => toggleItem(item.code)}
                        className="shrink-0"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{item.code}</span>
                          <span className="text-sm font-medium">{item.label}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-medium ${item.billed ? "text-green-600" : "text-muted-foreground"}`}>
                          ~${item.estimatedValue.toLocaleString()}
                        </p>
                        {!item.billed && <p className="text-xs text-red-500">Not billed</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}

          <div className="flex gap-3 justify-end">
            <Button
              data-testid="button-save-gc"
              onClick={() => saveMutation.mutate({ items, completedBy: "Cody Brantley" })}
              disabled={saveMutation.isPending}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <ClipboardCheck className="w-4 h-4 mr-2" />
              {saveMutation.isPending ? "Saving..." : "Save Checklist"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
