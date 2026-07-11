/**
 * Integrations Settings — Ramp (bill pay) + QuickBooks (invoicing)
 * Owner/Admin only.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  CreditCard, CheckCircle2, AlertCircle, ExternalLink, Save,
  RefreshCw, Eye, EyeOff, Lock, Building2, Zap,
} from "lucide-react";

function MaskedInput({ value, onChange, placeholder, testId }: any) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10"
        data-testid={testId}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function RampSection() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({ apiKey: "", entityId: "", bankAccountId: "" });

  const { data: cfg } = useQuery<any>({
    queryKey: ["/api/integrations/ramp"],
    queryFn: () => apiRequest("GET", "/api/integrations/ramp").then(r => r.json()),
    staleTime: 0,
  });

  const { data: payments = [] } = useQuery<any[]>({
    queryKey: ["/api/ramp/payments"],
    queryFn: () => apiRequest("/api/ramp/payments").then(r => r.json()),
    staleTime: 30000,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", "/api/integrations/ramp", form).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/ramp"] });
      toast({ title: "Ramp credentials saved" });
      setForm({ apiKey: "", entityId: "", bankAccountId: "" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const recent = payments.slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <div className="w-7 h-7 bg-orange-500 rounded-lg flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          Ramp — Partner & Sub Payouts
          {cfg?.configured ? (
            <Badge className="bg-green-100 text-green-700 ml-auto"><CheckCircle2 className="w-3 h-3 mr-1" />Connected</Badge>
          ) : (
            <Badge className="bg-gray-100 text-gray-600 ml-auto"><AlertCircle className="w-3 h-3 mr-1" />Not Connected</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Ramp Bill Pay lets you push approved payouts directly from Titan Pro to your partners and subs via ACH, check, or wire — no manual bank transfers needed.
          Get your API key from{" "}
          <a href="https://app.ramp.com/developer" target="_blank" rel="noreferrer" className="text-[hsl(var(--titan-blue))] underline">
            app.ramp.com/developer
          </a>.
        </p>

        {cfg?.configured && (
          <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2 space-y-0.5">
            <p>API Key: <span className="font-mono">{cfg.apiKeyMasked || "configured"}</span></p>
            {cfg.entityId && <p>Entity ID: <span className="font-mono">{cfg.entityId}</span></p>}
            {cfg.bankAccountId && <p>Bank Account ID: <span className="font-mono">{cfg.bankAccountId}</span></p>}
            <p className="text-[10px] text-muted-foreground/60">Last updated: {cfg.updatedAt ? new Date(cfg.updatedAt).toLocaleDateString() : "—"}</p>
          </div>
        )}

        <div className="space-y-3 p-3 border rounded-lg bg-muted/20">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {cfg?.configured ? "Update Credentials" : "Enter Credentials"}
          </p>
          <div className="space-y-2">
            <div>
              <Label className="text-xs">Ramp API Key</Label>
              <MaskedInput
                value={form.apiKey}
                onChange={(v: string) => setForm(f => ({ ...f, apiKey: v }))}
                placeholder="ramp_key_..."
                testId="input-ramp-api-key"
              />
            </div>
            <div>
              <Label className="text-xs">Entity ID <span className="text-muted-foreground font-normal">(from GET /entities)</span></Label>
              <Input
                value={form.entityId}
                onChange={e => setForm(f => ({ ...f, entityId: e.target.value }))}
                placeholder="ent_..."
                data-testid="input-ramp-entity-id"
              />
            </div>
            <div>
              <Label className="text-xs">Bank Account ID <span className="text-muted-foreground font-normal">(Bill Pay bank account)</span></Label>
              <Input
                value={form.bankAccountId}
                onChange={e => setForm(f => ({ ...f, bankAccountId: e.target.value }))}
                placeholder="bac_..."
                data-testid="input-ramp-bank-id"
              />
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.apiKey}
            className="bg-orange-500 hover:bg-orange-600 text-white"
            data-testid="button-save-ramp"
          >
            <Save className="w-3 h-3 mr-1" />
            {saveMutation.isPending ? "Saving..." : "Save Ramp Credentials"}
          </Button>
        </div>

        {recent.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Recent Payments</p>
            <div className="space-y-1.5">
              {recent.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between text-xs p-2 rounded bg-muted/30">
                  <span className="font-medium">{p.contact_name}</span>
                  <span>${(p.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                  <Badge className={p.status === "submitted" ? "bg-green-100 text-green-700" : p.status === "failed" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}>
                    {p.status}
                  </Badge>
                  <span className="text-muted-foreground">{p.submitted_at ? new Date(p.submitted_at).toLocaleDateString() : "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <a href="https://app.ramp.com/developer" target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline"><ExternalLink className="w-3 h-3 mr-1" />Ramp Developer Portal</Button>
          </a>
          <a href="https://docs.ramp.com/llms-guides/bill-payments.txt" target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost" className="text-xs text-muted-foreground">API Docs</Button>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function QuickBooksSection() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({ clientId: "", clientSecret: "" });

  const { data: cfg } = useQuery<any>({
    queryKey: ["/api/integrations/quickbooks"],
    queryFn: () => apiRequest("GET", "/api/integrations/quickbooks").then(r => r.json()),
    staleTime: 0,
  });

  const { data: qbInvoices = [] } = useQuery<any[]>({
    queryKey: ["/api/qb/invoices"],
    queryFn: () => apiRequest("/api/qb/invoices").then(r => r.json()),
    staleTime: 30000,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", "/api/integrations/quickbooks", form).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/quickbooks"] });
      toast({ title: "QuickBooks credentials saved. Now click Connect to authorize." });
      setForm({ clientId: "", clientSecret: "" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const connectMutation = useMutation({
    mutationFn: () =>
      apiRequest("GET", "/api/qb/oauth/start").then(r => r.json()),
    onSuccess: (data: any) => {
      if (data.authUrl) window.open(data.authUrl, "_blank", "width=600,height=700");
      else toast({ title: "Error", description: data.error, variant: "destructive" });
    },
  });

  const recent = qbInvoices.slice(0, 5);
  const isConnected = cfg?.configured && cfg?.connectedAt;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <div className="w-7 h-7 bg-green-600 rounded-lg flex items-center justify-center">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          QuickBooks Online — Customer Invoicing
          {isConnected ? (
            <Badge className="bg-green-100 text-green-700 ml-auto"><CheckCircle2 className="w-3 h-3 mr-1" />Connected</Badge>
          ) : cfg?.configured ? (
            <Badge className="bg-yellow-100 text-yellow-700 ml-auto"><AlertCircle className="w-3 h-3 mr-1" />Needs Authorization</Badge>
          ) : (
            <Badge className="bg-gray-100 text-gray-600 ml-auto"><AlertCircle className="w-3 h-3 mr-1" />Not Connected</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Sync invoices from Titan Pro to QuickBooks Online so customers can pay via the QBO payment portal (credit card, ACH). Payment status auto-updates in QuickBooks.
          Create your app at{" "}
          <a href="https://developer.intuit.com" target="_blank" rel="noreferrer" className="text-[hsl(var(--titan-blue))] underline">
            developer.intuit.com
          </a>.
        </p>

        {cfg?.configured && (
          <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2 space-y-0.5">
            <p>Client ID: <span className="font-mono">{cfg.clientIdMasked || (cfg.configured ? "configured" : "—")}</span></p>
            {cfg.realmId && <p>Realm ID: <span className="font-mono">{cfg.realmId}</span></p>}
            {cfg.connectedAt && <p className="text-green-600">Authorized: {new Date(cfg.connectedAt).toLocaleDateString()}</p>}
          </div>
        )}

        <div className="space-y-3 p-3 border rounded-lg bg-muted/20">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Step 1 — Enter App Credentials
          </p>
          <div className="space-y-2">
            <div>
              <Label className="text-xs">Client ID</Label>
              <Input
                value={form.clientId}
                onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
                placeholder="ABc1234..."
                data-testid="input-qb-client-id"
              />
            </div>
            <div>
              <Label className="text-xs">Client Secret</Label>
              <MaskedInput
                value={form.clientSecret}
                onChange={(v: string) => setForm(f => ({ ...f, clientSecret: v }))}
                placeholder="••••••••"
                testId="input-qb-client-secret"
              />
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || (!form.clientId && !form.clientSecret)}
            className="bg-green-600 hover:bg-green-700 text-white"
            data-testid="button-save-qb"
          >
            <Save className="w-3 h-3 mr-1" />
            {saveMutation.isPending ? "Saving..." : "Save Credentials"}
          </Button>
        </div>

        {cfg?.configured && (
          <div className="p-3 border rounded-lg bg-muted/20 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Step 2 — Authorize with QuickBooks</p>
            <p className="text-xs text-muted-foreground">Click Connect to open the QuickBooks authorization page. Log in with your QuickBooks account to grant access.</p>
            <Button
              size="sm"
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
              className="bg-[#2CA01C] hover:bg-[#238c15] text-white"
              data-testid="button-connect-qb"
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${connectMutation.isPending ? "animate-spin" : ""}`} />
              {isConnected ? "Re-authorize QuickBooks" : "Connect to QuickBooks"}
            </Button>
          </div>
        )}

        {recent.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Synced Invoices</p>
            <div className="space-y-1.5">
              {recent.map((qi: any) => (
                <div key={qi.id} className="flex items-center justify-between text-xs p-2 rounded bg-muted/30">
                  <span className="font-mono font-medium">{qi.invoice_number}</span>
                  <span>${(qi.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                  <Badge className="bg-green-100 text-green-700">Synced</Badge>
                  {qi.qb_link && (
                    <a href={qi.qb_link} target="_blank" rel="noreferrer">
                      <ExternalLink className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          <a href="https://developer.intuit.com/app/developer/qbo/docs/get-started" target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline"><ExternalLink className="w-3 h-3 mr-1" />QBO Developer Docs</Button>
          </a>
          <a href="https://developer.intuit.com" target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost" className="text-xs text-muted-foreground">Create App</Button>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Integrations() {
  const { user } = useAuth();

  if (!user || !["owner", "admin"].includes(user.role)) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Lock className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">Access Restricted</p>
        <p className="text-sm">Integrations are available to owners and admins only.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 mb-2">
        <CreditCard className="w-5 h-5 text-[hsl(var(--titan-blue))]" />
        <h1 className="text-lg font-bold">Integrations</h1>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <RampSection />
        <QuickBooksSection />
      </div>
    </div>
  );
}
