/**
 * Migration Center — Business Dev
 * Live-API import from Slack, CompanyCam, and Dash into Titan Pro.
 * Connect (save token) → Test connection → Select scopes → Sync.
 * Owner/Admin only. Credentials stored server-side (masked on read).
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { fmtDateShort } from "@/lib/dates";
import {
  ArrowRightLeft, CheckCircle2, AlertCircle, Eye, EyeOff, Save, Plug, RefreshCw,
  MessageSquare, Camera, LayoutDashboard, Loader2, History, Users, Database,
} from "lucide-react";

function MaskedInput({ value, onChange, placeholder, testId }: any) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="pr-10" data-testid={testId} />
      <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

interface SourceDef {
  key: string; name: string; icon: any; color: string; docsUrl: string; tokenHelp: string;
  scopes: { id: string; label: string }[]; hasBaseUrl?: boolean;
}

const SOURCES: SourceDef[] = [
  {
    key: "slack", name: "Slack", icon: MessageSquare, color: "bg-[#4A154B]",
    docsUrl: "https://api.slack.com/apps", tokenHelp: "Create an app at api.slack.com, add a Bot Token (xoxb-…) with channels:read, channels:history, files:read, users:read scopes.",
    scopes: [
      { id: "channels", label: "Channels" },
      { id: "messages", label: "Messages" },
      { id: "files", label: "Files" },
      { id: "contacts", label: "Contacts / People" },
    ],
  },
  {
    key: "companycam", name: "CompanyCam", icon: Camera, color: "bg-[#00A9E0]",
    docsUrl: "https://app.companycam.com/access_tokens", tokenHelp: "Generate a personal access token in CompanyCam under Account → Integrations → API.",
    scopes: [
      { id: "photos", label: "Job Photos" },
      { id: "documents", label: "Documents" },
      { id: "contacts", label: "Contacts / People" },
    ],
  },
  {
    key: "dash", name: "Dash", icon: LayoutDashboard, color: "bg-[#0F172A]",
    docsUrl: "#", tokenHelp: "Enter your Dash API token and (optionally) the API base URL for your Dash instance.", hasBaseUrl: true,
    scopes: [
      { id: "jobs", label: "Jobs" },
      { id: "estimates", label: "Estimates" },
      { id: "financials", label: "Financials" },
      { id: "contacts", label: "Customers / Contacts" },
    ],
  },
];

export default function MigrationCenter() {
  const { user } = useAuth();
  const isOwnerAdmin = user?.role === "owner" || user?.role === "admin";
  if (!isOwnerAdmin) return <div className="p-8 text-center text-muted-foreground">This module is available to owners and admins only.</div>;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5" data-testid="page-migration-center">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ArrowRightLeft className="w-6 h-6 text-[hsl(var(--titan-blue))]" /> Migration Center
        </h1>
        <p className="text-sm text-muted-foreground">Import everything from Slack, CompanyCam & Dash into Titan Pro via live API connections.</p>
      </div>

      <SummaryStrip />

      <div className="space-y-4">
        {SOURCES.map(s => <SourceCard key={s.key} src={s} />)}
      </div>

      <SyncHistory />
    </div>
  );
}

function SummaryStrip() {
  const { token } = useAuth();
  const { data } = useQuery<any>({
    queryKey: ["/api/migration/summary"],
    queryFn: () => apiRequest("GET", "/api/migration/summary").then(r => r.json()).catch(() => null),
    refetchInterval: 8000,
  });
  if (!data) return null;
  const cards = [
    { label: "Slack channels", value: data.slack.channels, icon: MessageSquare },
    { label: "Slack messages", value: data.slack.messages, icon: MessageSquare },
    { label: "CompanyCam photos", value: data.companycam.photos, icon: Camera },
    { label: "Dash jobs", value: data.dash.jobs, icon: LayoutDashboard },
    { label: "Dash estimates", value: data.dash.estimates, icon: Database },
    { label: "Contacts imported", value: data.contactsImported, icon: Users },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3" data-testid="migration-summary">
      {cards.map(c => (
        <Card key={c.label}><CardContent className="p-3">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide"><c.icon className="w-3 h-3" /> {c.label}</div>
          <p className="text-2xl font-bold mt-1">{c.value}</p>
        </CardContent></Card>
      ))}
    </div>
  );
}

function SourceCard({ src }: { src: SourceDef }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [selected, setSelected] = useState<string[]>(src.scopes.map(s => s.id));
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const { data: cfg } = useQuery<any>({
    queryKey: [`/api/integrations/${src.key}`],
    queryFn: () => apiRequest("GET", `/api/integrations/${src.key}`).then(r => r.json()),
    staleTime: 0,
  });

  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/integrations/${src.key}`, { apiKey, ...(src.hasBaseUrl && baseUrl ? { baseUrl } : {}) }).then(r => r.json()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [`/api/integrations/${src.key}`] }); toast({ title: `${src.name} credentials saved` }); setApiKey(""); },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const test = useMutation({
    mutationFn: () => apiRequest("POST", `/api/migration/${src.key}/test`, {})
      .then(async r => ({ status: r.status, body: await r.json() }))
      .catch(async (e: any) => ({ status: e?.status ?? 500, body: e?.body ?? { ok: false, error: e?.message || "Failed" } })),
    onSuccess: (res) => setTestResult(res.body.ok ? { ok: true, msg: res.body.detail || "Connection OK" } : { ok: false, msg: res.body.error || "Failed" }),
    onError: (e: any) => setTestResult({ ok: false, msg: e.message }),
  });

  const sync = useMutation({
    mutationFn: () => apiRequest("POST", `/api/migration/${src.key}/sync`, { scopes: selected })
      .then(async r => ({ status: r.status, body: await r.json() }))
      .catch(async (e: any) => ({ status: e?.status ?? 500, body: e?.body ?? { ok: false, error: e?.message || "Failed" } })),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["/api/migration/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/migration/history"] });
      if (res.status === 200 && res.body.ok) toast({ title: `${src.name} synced`, description: `${res.body.totalRecords} records imported.` });
      else toast({ title: `${src.name} sync completed with issues`, description: res.body.error || `${res.body.totalRecords || 0} records; some scopes failed. See history.`, variant: "destructive" });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const configured = cfg?.configured;

  return (
    <Card data-testid={`source-${src.key}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <div className={`w-8 h-8 ${src.color} rounded-lg flex items-center justify-center`}><src.icon className="w-4 h-4 text-white" /></div>
          {src.name}
          {configured
            ? <Badge className="bg-green-100 text-green-700 ml-auto"><CheckCircle2 className="w-3 h-3 mr-1" />Connected</Badge>
            : <Badge className="bg-gray-100 text-gray-600 ml-auto"><AlertCircle className="w-3 h-3 mr-1" />Not Connected</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{src.tokenHelp}{src.docsUrl !== "#" && <> <a href={src.docsUrl} target="_blank" rel="noreferrer" className="text-[hsl(var(--titan-blue))] underline">Open docs</a>.</>}</p>

        {configured && (
          <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2 space-y-0.5">
            <p>API Token: <span className="font-mono">{cfg.apiKeyMasked || "configured"}</span></p>
            {cfg.baseUrl && <p>Base URL: <span className="font-mono">{cfg.baseUrl}</span></p>}
            <p className="text-[10px] text-muted-foreground/60">Updated {cfg.updatedAt ? fmtDateShort(cfg.updatedAt) : "—"}</p>
          </div>
        )}

        {/* Step 1: credentials */}
        <div className="space-y-2 p-3 border rounded-lg bg-muted/20">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1"><Plug className="w-3 h-3" /> 1 · {configured ? "Update" : "Connect"} credentials</p>
          <div><Label className="text-xs">{src.name} API Token</Label><MaskedInput value={apiKey} onChange={setApiKey} placeholder="Paste token…" testId={`input-token-${src.key}`} /></div>
          {src.hasBaseUrl && <div><Label className="text-xs">API Base URL (optional)</Label><Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.dashsolution.com" data-testid={`input-baseurl-${src.key}`} /></div>}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={!apiKey || save.isPending} data-testid={`btn-save-${src.key}`}><Save className="w-4 h-4 mr-1" /> Save</Button>
            <Button size="sm" variant="outline" onClick={() => { setTestResult(null); test.mutate(); }} disabled={!configured || test.isPending} data-testid={`btn-test-${src.key}`}>
              {test.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plug className="w-4 h-4 mr-1" />} Test Connection
            </Button>
          </div>
          {testResult && (
            <div className={`text-xs flex items-center gap-1.5 ${testResult.ok ? "text-green-700" : "text-red-600"}`} data-testid={`test-result-${src.key}`}>
              {testResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />} {testResult.msg}
            </div>
          )}
        </div>

        {/* Step 2: scopes + sync */}
        <div className="space-y-2 p-3 border rounded-lg bg-muted/20">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide"><RefreshCw className="w-3 h-3 inline mr-1" /> 2 · Choose what to import & sync</p>
          <div className="flex flex-wrap gap-2">
            {src.scopes.map(sc => (
              <label key={sc.id} className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border cursor-pointer transition ${selected.includes(sc.id) ? "bg-[hsl(var(--titan-blue))]/10 border-[hsl(var(--titan-blue))] text-[hsl(var(--titan-blue))]" : "bg-background"}`} data-testid={`scope-${src.key}-${sc.id}`}>
                <input type="checkbox" className="accent-[hsl(var(--titan-blue))]" checked={selected.includes(sc.id)} onChange={() => toggle(sc.id)} /> {sc.label}
              </label>
            ))}
          </div>
          <Button size="sm" className="w-full bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue))]/90" onClick={() => sync.mutate()} disabled={!configured || selected.length === 0 || sync.isPending} data-testid={`btn-sync-${src.key}`}>
            {sync.isPending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Syncing…</> : <><RefreshCw className="w-4 h-4 mr-1.5" /> Sync {selected.length} {selected.length === 1 ? "type" : "types"} now</>}
          </Button>
          <p className="text-[10px] text-muted-foreground">Runs a live pull from {src.name}. Contacts are deduplicated by name. Existing Titan data is preserved.</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SyncHistory() {
  const { token } = useAuth();
  const { data: rows = [] } = useQuery<any[]>({
    queryKey: ["/api/migration/history"],
    queryFn: () => apiRequest("GET", "/api/migration/history").then(r => r.json()).catch(() => []),
    refetchInterval: 8000,
  });
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><History className="w-4 h-4" /> Sync History</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? <p className="text-xs text-muted-foreground">No syncs run yet.</p> : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto" data-testid="sync-history">
            {rows.map(r => (
              <div key={r.id} className="flex items-center gap-2 text-xs border-b pb-1.5">
                <Badge variant="secondary" className="text-[10px] capitalize shrink-0">{r.source}</Badge>
                <span className="capitalize text-muted-foreground shrink-0">{r.scope}</span>
                {r.status === "success"
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
                  : <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                <span className="truncate flex-1">{r.status === "success" ? r.detail : (r.error || "failed")}</span>
                <span className="text-[10px] text-muted-foreground/60 shrink-0">{r.created_at ? new Date(r.created_at).toLocaleTimeString() : ""}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
