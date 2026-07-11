/**
 * PartnerPortalSetup.tsx — Business Dev › Partner Portal Setup
 *
 * Staff-facing screen to activate partner (sub / referral) logins to the
 * Partner Portal. For each partner you can set or generate a 4-digit access
 * PIN, then hand the partner their login details (name to select + PIN +
 * portal link). Partners with a PIN show as "Active".
 *
 * The PIN is stored on the contact's `portalPin` field. The partner login
 * endpoint enforces this PIN when one is set.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ExternalLink, KeyRound, Copy, RefreshCw, Check, ShieldCheck, Search,
  Users, Handshake, X, UserPlus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Contact } from "@shared/schema";

const TYPE_LABELS: Record<string, string> = { sub: "Subcontractor", referral: "Referral Partner" };

/**
 * AddPartnerForm — create a brand-new partner login without leaving this page.
 * Creates the contact (type sub/referral) and, if a 4-digit PIN is supplied,
 * activates portal access in the same step. Falls back to creating the partner
 * "Not set up" so a PIN can be added from their row afterwards.
 */
function AddPartnerForm({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<"sub" | "referral">("sub");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");

  const pinValid = pin === "" || /^\d{4}$/.test(pin);
  const canSubmit = name.trim().length > 0 && pinValid;

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = {
        name: name.trim(),
        type,
        company: company.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
      };
      if (/^\d{4}$/.test(pin)) body.portalPin = pin;
      const res = await apiRequest("POST", "/api/contacts", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({
        title: "Partner created",
        description: /^\d{4}$/.test(pin)
          ? `${name.trim()} can now log in with their PIN.`
          : `${name.trim()} added. Set an access PIN on their row to activate login.`,
      });
      onDone();
    },
    onError: () => toast({ title: "Could not create partner", description: "Please try again.", variant: "destructive" }),
  });

  const genPin = () => setPin(String(Math.floor(1000 + Math.random() * 9000)));

  return (
    <Card className="border-[hsl(var(--titan-blue))]/40" data-testid="card-add-partner">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-[hsl(var(--titan-blue))]" />
          New Partner Login
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Name <span className="text-destructive">*</span></Label>
            <Input className="mt-1" value={name} placeholder="e.g. Coastal Roofing"
              onChange={e => setName(e.target.value)} data-testid="input-newpartner-name" />
          </div>
          <div>
            <Label className="text-xs">Partner type</Label>
            <select
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={type}
              onChange={e => setType(e.target.value as "sub" | "referral")}
              data-testid="select-newpartner-type"
            >
              <option value="sub">Subcontractor</option>
              <option value="referral">Referral Partner</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">Company</Label>
            <Input className="mt-1" value={company} placeholder="Company name"
              onChange={e => setCompany(e.target.value)} data-testid="input-newpartner-company" />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input className="mt-1" type="email" value={email} placeholder="name@company.com"
              onChange={e => setEmail(e.target.value)} data-testid="input-newpartner-email" />
          </div>
          <div>
            <Label className="text-xs">Phone</Label>
            <Input className="mt-1" value={phone} placeholder="(555) 555-5555"
              onChange={e => setPhone(e.target.value)} data-testid="input-newpartner-phone" />
          </div>
          <div>
            <Label className="text-xs">Access PIN (optional, 4 digits)</Label>
            <div className="mt-1 flex gap-2">
              <Input
                value={pin}
                maxLength={4}
                inputMode="numeric"
                placeholder="e.g. 5193"
                onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                data-testid="input-newpartner-pin"
              />
              <Button type="button" variant="outline" size="sm" onClick={genPin} data-testid="button-newpartner-genpin">
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
        {!pinValid && <p className="text-xs text-destructive">PIN must be exactly 4 digits (or left blank).</p>}
        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)] text-white"
            disabled={!canSubmit || create.isPending}
            onClick={() => create.mutate()}
            data-testid="button-newpartner-create"
          >
            <Check className="w-3.5 h-3.5 mr-1" />{create.isPending ? "Creating…" : "Create partner login"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDone} data-testid="button-newpartner-cancel">
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PartnerRow({ partner, portalUrl }: { partner: Contact; portalUrl: string }) {
  const { toast } = useToast();
  const [pin, setPin] = useState(partner.portalPin || "");
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const isActive = !!partner.portalPin;
  const validPin = /^\d{4}$/.test(pin);

  const save = useMutation({
    mutationFn: (portalPin: string) =>
      apiRequest("PATCH", `/api/contacts/${partner.id}`, { portalPin }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Partner portal activated", description: `${partner.name} can now log in with their PIN.` });
      setExpanded(true);
    },
    onError: () => toast({ title: "Could not save", description: "Please try again.", variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/contacts/${partner.id}`, { portalPin: null }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setPin("");
      toast({ title: "Portal access revoked", description: `${partner.name} can no longer log in.` });
    },
  });

  const genPin = () => setPin(String(Math.floor(1000 + Math.random() * 9000)));
  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  const credentialBlock =
    `Titan Restoration — Partner Portal\n` +
    `Link: ${portalUrl}\n` +
    `Log in as: ${partner.name}${partner.company ? ` (${partner.company})` : ""}\n` +
    `Access PIN: ${partner.portalPin || pin}`;

  return (
    <Card className="border-border" data-testid={`partner-row-${partner.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold truncate">{partner.name}</p>
              <Badge className={isActive ? "bg-green-100 text-green-800" : "bg-muted text-muted-foreground"}>
                {isActive ? "Active" : "Not set up"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {TYPE_LABELS[partner.type] || partner.type}{partner.company ? ` · ${partner.company}` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs">Access PIN (4 digits)</Label>
            <Input
              className="mt-1"
              value={pin}
              maxLength={4}
              inputMode="numeric"
              placeholder="e.g. 5193"
              onChange={e => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              data-testid={`input-partner-pin-${partner.id}`}
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={genPin} data-testid={`button-partner-genpin-${partner.id}`}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" />Generate
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)] text-white"
            disabled={!validPin || save.isPending}
            onClick={() => save.mutate(pin)}
            data-testid={`button-partner-savepin-${partner.id}`}
          >
            <Check className="w-3.5 h-3.5 mr-1" />{isActive ? "Update" : "Activate"}
          </Button>
        </div>

        {isActive && (
          <>
            <button
              className="text-xs text-[hsl(var(--titan-blue))] hover:underline font-medium"
              onClick={() => setExpanded(v => !v)}
              data-testid={`button-partner-toggle-${partner.id}`}
            >
              {expanded ? "Hide login details" : "Show login details"}
            </button>
            {expanded && (
              <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
                  Login details to share with {partner.name.split(" ")[0]}
                </p>
                <div className="grid gap-1.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-xs">Portal link</span>
                    <button className="flex items-center gap-1 text-[hsl(var(--titan-blue))] hover:underline text-xs font-medium" onClick={() => copy("link", portalUrl)}>
                      <Copy className="w-3 h-3" />{copied === "link" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-xs">Log in as</span>
                    <span className="font-medium">{partner.name}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-xs">Access PIN</span>
                    <span className="font-mono font-semibold tracking-widest" data-testid={`text-partner-pin-${partner.id}`}>{partner.portalPin}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => copy("all", credentialBlock)} data-testid={`button-partner-copyall-${partner.id}`}>
                    <Copy className="w-3.5 h-3.5 mr-1" />{copied === "all" ? "Copied" : "Copy all details"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => revoke.mutate()} data-testid={`button-partner-revoke-${partner.id}`}>
                    Revoke
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function PartnerPortalSetup() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "sub" | "referral">("all");
  const [showAdd, setShowAdd] = useState(false);
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const portalUrl = `${window.location.origin}/#/partner-portal`;

  const partners = contacts.filter(c => c.type === "sub" || c.type === "referral");
  const q = search.trim().toLowerCase();
  const filtered = partners.filter(p =>
    (typeFilter === "all" || p.type === typeFilter) &&
    (q === "" || [p.name, p.company, p.email, p.phone].some(v => String(v ?? "").toLowerCase().includes(q)))
  );
  const activeCount = partners.filter(p => !!p.portalPin).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Handshake className="w-5 h-5 text-[hsl(var(--titan-red))]" />
            Partner Portal Setup
          </h1>
          <p className="text-sm text-muted-foreground">
            Activate logins for subcontractors and referral partners. Set an access PIN, then share their login details.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)] text-white"
            onClick={() => setShowAdd(v => !v)}
            data-testid="button-toggle-add-partner"
          >
            <UserPlus className="w-3.5 h-3.5 mr-1" />New Partner Login
          </Button>
          <Link href="/partner-portal">
            <Button variant="outline" size="sm"><ExternalLink className="w-3.5 h-3.5 mr-1" />Open Partner Portal</Button>
          </Link>
        </div>
      </div>

      {showAdd && <AddPartnerForm onDone={() => setShowAdd(false)} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" />Partners</p>
          <p className="text-xl font-bold">{partners.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><KeyRound className="w-3 h-3" />Portal active</p>
          <p className="text-xl font-bold text-green-600">{activeCount}</p>
        </CardContent></Card>
        <Card className="col-span-2 sm:col-span-1"><CardContent className="p-3">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><X className="w-3 h-3" />Not set up</p>
          <p className="text-xl font-bold text-muted-foreground">{partners.length - activeCount}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Partners</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search partners…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="input-partner-search"
              />
            </div>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value as any)}
              data-testid="select-partner-type"
            >
              <option value="all">All types</option>
              <option value="sub">Subcontractors</option>
              <option value="referral">Referral partners</option>
            </select>
          </div>

          {partners.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No partners yet. Add subcontractors or referral partners on the Contacts page.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No partners match your search.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filtered.map(p => <PartnerRow key={p.id} partner={p} portalUrl={portalUrl} />)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
