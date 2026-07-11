import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Shield, Plus, Copy, Trash2, Eye, ExternalLink, CheckCircle, Clock, FileText, Droplets } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { Job } from "@shared/schema";

export default function AdjusterPortal() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [adjName, setAdjName] = useState("");
  const [adjCarrier, setAdjCarrier] = useState("");
  const [selectedJobIds, setSelectedJobIds] = useState<number[]>([]);
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const { data: sessions = [] } = useQuery<any[]>({
    queryKey: ["/api/adjuster-portal/sessions"],
    queryFn: () => apiRequest("GET", "/api/adjuster-portal/sessions").then(r => r.json()),
  });

  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/adjuster-portal/sessions", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/adjuster-portal/sessions"] });
      setShowCreate(false);
      setAdjName(""); setAdjCarrier(""); setSelectedJobIds([]); setExpiresInDays("30");
      toast({ title: "Access link created", description: "Share the link with the adjuster for read-only job access." });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/adjuster-portal/sessions/${id}`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/adjuster-portal/sessions"] });
      toast({ title: "Access revoked" });
    },
  });

  const getPortalUrl = (token: string) =>
    `${window.location.origin}${window.location.pathname}#/adjuster-portal-view/${token}`;

  const copyLink = (token: string) => {
    navigator.clipboard.writeText(getPortalUrl(token));
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
    toast({ title: "Link copied to clipboard" });
  };

  const isExpired = (expiresAt: string) => new Date(expiresAt) < new Date();

  const toggleJob = (jobId: number) => {
    setSelectedJobIds(prev => prev.includes(jobId) ? prev.filter(id => id !== jobId) : [...prev, jobId]);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Shield className="w-5 h-5 text-[hsl(var(--titan-blue))]" />Adjuster Portal
          </h1>
          <p className="text-sm text-muted-foreground">Create secure read-only access links for insurance adjusters</p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
          data-testid="button-create-access"
        >
          <Plus className="w-4 h-4 mr-2" />Create Access Link
        </Button>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: "1️⃣", title: "Select Jobs", desc: "Choose which jobs the adjuster can view" },
          { icon: "2️⃣", title: "Generate Link", desc: "A secure token link is generated — no login required" },
          { icon: "3️⃣", title: "Adjuster Views", desc: "They see job status, drying records, and photo count in real time" },
        ].map(s => (
          <Card key={s.title}>
            <CardContent className="p-4 flex items-start gap-3">
              <span className="text-2xl">{s.icon}</span>
              <div>
                <p className="font-semibold text-sm text-foreground">{s.title}</p>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Active Sessions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Active Access Links ({sessions.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sessions.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              <Shield className="w-10 h-10 mx-auto mb-2 opacity-40" />
              No active access links. Create one above to share with an adjuster.
            </div>
          ) : (
            <div className="divide-y">
              {sessions.map((s: any) => {
                const expired = isExpired(s.expires_at);
                const jobIds: number[] = JSON.parse(s.job_ids || "[]");
                return (
                  <div key={s.id} className="flex items-start gap-4 p-4">
                    <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${expired ? "bg-red-500" : "bg-green-500"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground">{s.adjuster_name}</span>
                        <Badge variant="outline">{s.carrier}</Badge>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${expired ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                          {expired ? "Expired" : "Active"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {jobIds.length} job(s) shared · Expires {new Date(s.expires_at).toLocaleDateString()}
                        {s.last_accessed_at && ` · Last viewed ${new Date(s.last_accessed_at).toLocaleDateString()}`}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyLink(s.access_token)}
                          data-testid={`button-copy-link-${s.id}`}
                        >
                          {copiedToken === s.access_token ? <CheckCircle className="w-3 h-3 mr-1 text-green-600" /> : <Copy className="w-3 h-3 mr-1" />}
                          {copiedToken === s.access_token ? "Copied!" : "Copy Link"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(getPortalUrl(s.access_token), "_blank")}
                        >
                          <Eye className="w-3 h-3 mr-1" />Preview
                        </Button>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(s.id)}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      data-testid={`button-revoke-${s.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Adjuster Access Link</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Adjuster Name</label>
                <Input value={adjName} onChange={e => setAdjName(e.target.value)} placeholder="John Smith" data-testid="input-adj-name" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Insurance Carrier</label>
                <Input value={adjCarrier} onChange={e => setAdjCarrier(e.target.value)} placeholder="State Farm" data-testid="input-adj-carrier" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Link Expires In (days)</label>
              <Input type="number" value={expiresInDays} onChange={e => setExpiresInDays(e.target.value)} placeholder="30" data-testid="input-expires" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Select Jobs to Share</label>
              <div className="space-y-2 max-h-48 overflow-y-auto border border-border rounded-lg p-2">
                {jobs.map(j => (
                  <label key={j.id} className="flex items-center gap-3 p-2 hover:bg-muted/50 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedJobIds.includes(j.id)}
                      onChange={() => toggleJob(j.id)}
                      className="w-4 h-4"
                      data-testid={`check-job-${j.id}`}
                    />
                    <div>
                      <p className="text-sm font-medium">{j.jobNumber}</p>
                      <p className="text-xs text-muted-foreground">{j.address} · {j.status}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <Button
              onClick={() => createMutation.mutate({ adjusterName: adjName, carrier: adjCarrier, jobIds: selectedJobIds, expiresInDays: Number(expiresInDays) })}
              disabled={!adjName || !adjCarrier || selectedJobIds.length === 0 || createMutation.isPending}
              className="w-full bg-[hsl(var(--titan-blue))] text-white"
              data-testid="button-generate-link"
            >
              Generate Access Link
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
