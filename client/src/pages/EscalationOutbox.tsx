// The Escalation Outbox: review & one-click send drafts created by the
// scheduler. Feeds features #1 (adjuster silence), #2 (AR stalled + weekly
// digest), #16 (COI/W9 nag), and #18 (cert expiry).

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AlertCircle, Send, X, RefreshCw, Inbox, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtDateShort } from "@/lib/dates";

type DraftType = "all" | "adjuster_silence" | "ar_stalled" | "coi_expiring" | "cert_expiring" | "weekly_ar_digest";

const TYPE_LABEL: Record<string, string> = {
  adjuster_silence: "Adjuster silence",
  ar_stalled: "AR stalled",
  coi_expiring: "COI/W9 expiring",
  cert_expiring: "Cert expiring",
  weekly_ar_digest: "Weekly AR digest",
};

const TYPE_TINT: Record<string, string> = {
  adjuster_silence: "border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/30",
  ar_stalled: "border-red-300 text-red-700 bg-red-50 dark:bg-red-950/30",
  coi_expiring: "border-orange-300 text-orange-700 bg-orange-50 dark:bg-orange-950/30",
  cert_expiring: "border-blue-300 text-blue-700 bg-blue-50 dark:bg-blue-950/30",
  weekly_ar_digest: "border-purple-300 text-purple-700 bg-purple-50 dark:bg-purple-950/30",
};

export default function EscalationOutbox() {
  const [typeFilter, setTypeFilter] = useState<DraftType>("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: drafts = [], refetch, isFetching } = useQuery<any[]>({
    queryKey: ["/api/escalation-drafts", typeFilter],
    queryFn: () => {
      const suffix = typeFilter === "all" ? "" : `&type=${typeFilter}`;
      return apiRequest("GET", `/api/escalation-drafts?status=draft${suffix}`).then(r => r.json());
    },
    refetchInterval: 60_000,
  });

  const runNowMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/scheduler/run-now", {}),
    onSuccess: () => { toast({ title: "Scheduler ran", description: "Drafts refreshed" }); qc.invalidateQueries({ queryKey: ["/api/escalation-drafts"] }); },
    onError: (e: any) => toast({ title: "Run failed", description: e?.message || String(e), variant: "destructive" }),
  });

  const sendMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/escalation-drafts/${id}/send`, {}),
    onSuccess: () => { toast({ title: "Marked sent" }); qc.invalidateQueries({ queryKey: ["/api/escalation-drafts"] }); },
  });

  const dismissMut = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/escalation-drafts/${id}/dismiss`, {}),
    onSuccess: () => { toast({ title: "Dismissed" }); qc.invalidateQueries({ queryKey: ["/api/escalation-drafts"] }); },
  });

  function openMailto(d: any) {
    const to = d.recipient_email || "";
    const url = `mailto:${to}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(editingId === d.id ? editBody : d.body)}`;
    window.open(url, "_blank");
  }

  function copyToClipboard(text: string) {
    navigator.clipboard?.writeText(text);
    toast({ title: "Copied to clipboard" });
  }

  const types: DraftType[] = ["all", "adjuster_silence", "ar_stalled", "coi_expiring", "cert_expiring", "weekly_ar_digest"];
  const counts: Record<string, number> = {};
  for (const d of drafts) counts[d.type] = (counts[d.type] || 0) + 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[hsl(var(--titan-blue))] flex items-center justify-center">
            <Inbox className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Escalation Outbox</h1>
            <p className="text-sm text-muted-foreground">
              Draft messages generated automatically \u2014 review, edit, and one-click send.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="default" size="sm" onClick={() => runNowMut.mutate()} disabled={runNowMut.isPending}>
            Run checks now
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-muted-foreground" />
        {types.map(t => (
          <Button
            key={t}
            variant={typeFilter === t ? "default" : "outline"}
            size="sm"
            className="text-xs h-7"
            onClick={() => setTypeFilter(t)}
          >
            {t === "all" ? `All (${drafts.length})` : `${TYPE_LABEL[t] || t} (${counts[t] || 0})`}
          </Button>
        ))}
      </div>

      {drafts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No drafts right now. The scheduler runs hourly \u2014 or click "Run checks now" to force one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {drafts.map((d: any) => {
            const editing = editingId === d.id;
            return (
              <Card key={d.id} className={editing ? "ring-2 ring-blue-400" : ""}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className={`text-[10px] ${TYPE_TINT[d.type] || ""}`}>
                        {TYPE_LABEL[d.type] || d.type}
                      </Badge>
                      <span className="truncate">{d.subject}</span>
                    </div>
                    <span className="text-xs font-normal text-muted-foreground whitespace-nowrap">
                      {fmtDateShort(d.created_at)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {d.recipient_name || d.recipient_email ? (
                    <div className="text-xs text-muted-foreground">
                      To: <span className="font-medium">{d.recipient_name || "\u2014"}</span>
                      {d.recipient_email && <span> &lt;{d.recipient_email}&gt;</span>}
                      {d.recipient_phone && <span> \u2022 {d.recipient_phone}</span>}
                    </div>
                  ) : null}
                  {editing ? (
                    <>
                      <Input
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                        className="text-sm"
                      />
                      <Textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        className="text-xs font-mono min-h-[160px]"
                      />
                    </>
                  ) : (
                    <pre className="text-xs whitespace-pre-wrap bg-muted/40 rounded p-3 max-h-48 overflow-y-auto">{d.body}</pre>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {editing ? (
                      <>
                        <Button size="sm" onClick={() => setEditingId(null)} variant="outline">Done</Button>
                        <Button size="sm" onClick={() => copyToClipboard(editBody)} variant="outline">Copy body</Button>
                        {d.recipient_email && (
                          <Button size="sm" onClick={() => openMailto(d)}>Send in email client</Button>
                        )}
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" onClick={() => { setEditingId(d.id); setEditSubject(d.subject); setEditBody(d.body); }}>
                          Edit
                        </Button>
                        {d.recipient_email && (
                          <Button size="sm" onClick={() => openMailto(d)}>
                            <Send className="w-3 h-3 mr-1" /> Send via email
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => copyToClipboard(d.body)}>Copy body</Button>
                      </>
                    )}
                    <div className="ml-auto flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => sendMut.mutate(d.id)}>Mark sent</Button>
                      <Button size="sm" variant="ghost" onClick={() => dismissMut.mutate(d.id)}>
                        <X className="w-3 h-3 mr-1" /> Dismiss
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
