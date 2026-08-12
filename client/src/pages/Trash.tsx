/**
 * Trash — soft-deleted items with 30-day restore window.
 *
 * Reads GET /api/trash and shows the four trashable tables (jobs,
 * estimates, invoices, photos) in tabs. Owners and admins can restore
 * or permanently delete; everyone else sees a read-only view.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { RotateCcw, Trash2 } from "lucide-react";

type TrashPayload = {
  tables: Array<{
    table: string;
    label: string;
    items: Array<{ id: number; label: string; deleted_at: string; deleted_by: string | null }>;
  }>;
};

export default function TrashPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<string>("jobs");

  const { data, isLoading } = useQuery<TrashPayload>({
    queryKey: ["/api/trash"],
    queryFn: async () => {
      const r = await fetch("/api/trash", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load trash");
      return r.json();
    },
  });

  const restoreMut = useMutation({
    mutationFn: async ({ table, id }: { table: string; id: number }) => {
      const r = await fetch(`/api/trash/${table}/${id}/restore`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (_, v) => {
      toast({ title: "Restored", description: `${v.table} #${v.id} is back.` });
      qc.invalidateQueries();
    },
    onError: (e: any) => {
      toast({ variant: "destructive", title: "Restore failed", description: e?.message || "" });
    },
  });

  const purgeMut = useMutation({
    mutationFn: async ({ table, id }: { table: string; id: number }) => {
      const r = await fetch(`/api/trash/${table}/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (_, v) => {
      toast({ title: "Permanently deleted", description: `${v.table} #${v.id} is gone for good.` });
      qc.invalidateQueries({ queryKey: ["/api/trash"] });
    },
    onError: (e: any) => {
      toast({ variant: "destructive", title: "Delete failed", description: e?.message || "" });
    },
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Trash</h1>
        <p className="text-muted-foreground">Restore deleted items within 30 days. After that, they're purged automatically.</p>
      </div>

      {isLoading || !data ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {data.tables.map(t => (
              <TabsTrigger key={t.table} value={t.table}>
                {t.label}
                <Badge variant="secondary" className="ml-2">{t.items.length}</Badge>
              </TabsTrigger>
            ))}
          </TabsList>
          {data.tables.map(t => (
            <TabsContent key={t.table} value={t.table} className="mt-4">
              <Card>
                <CardHeader><CardTitle>{t.label}</CardTitle></CardHeader>
                <CardContent>
                  {t.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing here — the trash is empty.</p>
                  ) : (
                    <div className="divide-y">
                      {t.items.map(it => (
                        <div key={it.id} className="flex items-center justify-between py-3">
                          <div>
                            <div className="font-medium">{it.label}</div>
                            <div className="text-xs text-muted-foreground">
                              Deleted {new Date(it.deleted_at).toLocaleString()}
                              {it.deleted_by ? ` by ${it.deleted_by}` : ""}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={restoreMut.isPending}
                              onClick={() => restoreMut.mutate({ table: t.table, id: it.id })}
                            >
                              <RotateCcw className="h-3 w-3 mr-1" /> Restore
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={purgeMut.isPending}
                              onClick={() => {
                                if (!confirm(`Permanently delete this ${t.label.toLowerCase()}? This cannot be undone.`)) return;
                                purgeMut.mutate({ table: t.table, id: it.id });
                              }}
                            >
                              <Trash2 className="h-3 w-3 mr-1" /> Purge
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
