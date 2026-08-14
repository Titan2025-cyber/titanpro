import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import {
  Plus, Phone, Mail, Building2, KeyRound, Users, UserPlus,
  ChevronDown, ChevronRight, MoreVertical, Archive, Trash2,
  Heart, Cake, Sparkles, Edit,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Contact, Job } from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Marketing profile shape — mirrors server/routes_contact_admin.ts fields.
// ─────────────────────────────────────────────────────────────────────────────
type Marketing = {
  birthday?: string | null;
  anniversary?: string | null;
  spouse_name?: string | null;
  kids_names?: string | null;
  favorite_color?: string | null;
  favorite_drink?: string | null;
  favorite_food?: string | null;
  favorite_restaurant?: string | null;
  football_team?: string | null;
  basketball_team?: string | null;
  baseball_team?: string | null;
  other_team?: string | null;
  alma_mater?: string | null;
  hobbies?: string | null;
  dietary_restrictions?: string | null;
  gift_preferences?: string | null;
  pet_names?: string | null;
  notes?: string | null;
};

const EMPTY_MARKETING: Marketing = {};

// ─────────────────────────────────────────────────────────────────────────────
// Marketing details form — used inline in new-contact dialogs and standalone.
// ─────────────────────────────────────────────────────────────────────────────
function MarketingFields({
  value, onChange,
}: {
  value: Marketing;
  onChange: (patch: Partial<Marketing>) => void;
}) {
  const set = (k: keyof Marketing) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ [k]: e.target.value } as any);

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="marketing" className="border rounded-md">
        <AccordionTrigger className="px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-pink-500" />
            <span>Marketing & relationship details</span>
            <span className="text-xs text-muted-foreground font-normal">— optional but powerful</span>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-3 pb-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Anything you capture here powers birthday reminders, holiday gifts, personalized outreach,
            and thank-you touches. Nothing is required — fill in what you know.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Birthday</Label>
              <Input type="date" value={value.birthday || ""} onChange={set("birthday")} data-testid="input-birthday" />
            </div>
            <div>
              <Label className="text-xs">Anniversary</Label>
              <Input type="date" value={value.anniversary || ""} onChange={set("anniversary")} data-testid="input-anniversary" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Spouse / partner</Label><Input value={value.spouse_name || ""} onChange={set("spouse_name")} placeholder="Name" /></div>
            <div><Label className="text-xs">Kids</Label><Input value={value.kids_names || ""} onChange={set("kids_names")} placeholder="Ella (8), Jacob (5)" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Pets</Label><Input value={value.pet_names || ""} onChange={set("pet_names")} placeholder="Charlie the lab" /></div>
            <div><Label className="text-xs">Alma mater</Label><Input value={value.alma_mater || ""} onChange={set("alma_mater")} placeholder="Georgia, Clemson, etc." /></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Favorite color</Label><Input value={value.favorite_color || ""} onChange={set("favorite_color")} placeholder="Navy blue" /></div>
            <div><Label className="text-xs">Favorite drink</Label><Input value={value.favorite_drink || ""} onChange={set("favorite_drink")} placeholder="Black coffee, Miller Lite, Buffalo Trace" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Favorite food</Label><Input value={value.favorite_food || ""} onChange={set("favorite_food")} placeholder="Steak, sushi" /></div>
            <div><Label className="text-xs">Favorite restaurant</Label><Input value={value.favorite_restaurant || ""} onChange={set("favorite_restaurant")} placeholder="Local spot" /></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Football team</Label><Input value={value.football_team || ""} onChange={set("football_team")} placeholder="Dawgs" /></div>
            <div><Label className="text-xs">Basketball team</Label><Input value={value.basketball_team || ""} onChange={set("basketball_team")} placeholder="Hawks" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Baseball team</Label><Input value={value.baseball_team || ""} onChange={set("baseball_team")} placeholder="Braves" /></div>
            <div><Label className="text-xs">Other team / sport</Label><Input value={value.other_team || ""} onChange={set("other_team")} placeholder="Masters golf, NASCAR, etc." /></div>
          </div>

          <div><Label className="text-xs">Hobbies</Label><Input value={value.hobbies || ""} onChange={set("hobbies")} placeholder="Hunting, golf, fishing…" /></div>
          <div><Label className="text-xs">Dietary restrictions / allergies</Label><Input value={value.dietary_restrictions || ""} onChange={set("dietary_restrictions")} placeholder="Gluten-free, no shellfish" /></div>
          <div><Label className="text-xs">Gift ideas</Label><Textarea rows={2} value={value.gift_preferences || ""} onChange={set("gift_preferences")} placeholder="Loves bourbon; monogrammed anything for spouse" /></div>
          <div><Label className="text-xs">Relationship notes</Label><Textarea rows={2} value={value.notes || ""} onChange={set("notes")} placeholder="Anything else worth remembering" /></div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete-impact dialog + hook
// ─────────────────────────────────────────────────────────────────────────────
type DeleteImpact = {
  contact: { id: number; name: string; type: string };
  blockers: {
    jobs_open: number; jobs_total: number;
    invoices_total: number; invoices_outstanding: number;
    payments_total: number; payout_requests_pending: number;
    portal_active: boolean; child_referral_techs: number;
  };
  reasons: string[];
  can_soft_delete: boolean;
};

function DeleteContactDialog({
  contact, open, onOpenChange,
}: {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { toast } = useToast();
  const [confirmName, setConfirmName] = useState("");
  const [reason, setReason] = useState("");

  const { data: impact } = useQuery<DeleteImpact>({
    queryKey: ["/api/contacts", contact?.id, "delete-impact"],
    queryFn: () => apiRequest("GET", `/api/contacts/${contact!.id}/delete-impact`).then(r => r.json()),
    enabled: !!contact && open,
  });

  const archive = useMutation({
    mutationFn: () => apiRequest("POST", `/api/contacts/${contact!.id}/archive`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({ title: "Contact archived", description: "Hidden from lists but history preserved." });
      onOpenChange(false); setConfirmName(""); setReason("");
    },
  });

  const del = useMutation({
    mutationFn: (force: boolean) => apiRequest("DELETE", `/api/contacts/${contact!.id}${force ? "?force=true" : ""}`),
    onSuccess: (_res, force) => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      toast({
        title: force ? "Contact force-deleted" : "Contact deleted",
        description: force ? "Related jobs/invoices now show as 'unassigned'." : undefined,
      });
      onOpenChange(false); setConfirmName(""); setReason("");
    },
    onError: async (e: any) => {
      let msg = e?.message || "Delete failed";
      try {
        const parsed = JSON.parse(msg.replace(/^\d+:\s*/, ""));
        if (parsed?.error) msg = parsed.error;
      } catch { /* ignore */ }
      toast({ title: "Cannot delete", description: msg, variant: "destructive" });
    },
  });

  if (!contact) return null;
  const hasBlockers = (impact?.reasons.length || 0) > 0;
  const nameMatches = confirmName.trim().toLowerCase() === contact.name.trim().toLowerCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {contact.name}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!impact ? (
            <p className="text-sm text-muted-foreground">Checking references…</p>
          ) : hasBlockers ? (
            <div className="space-y-2">
              <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-sm">
                <p className="font-semibold text-amber-900 mb-1">This contact is still in use:</p>
                <ul className="list-disc pl-5 text-amber-800 text-xs space-y-0.5">
                  {impact.reasons.map(r => <li key={r}>{r}</li>)}
                </ul>
              </div>
              <p className="text-sm text-muted-foreground">
                Recommended: <strong>Archive</strong> instead — the contact hides from lists but all job/invoice history stays intact.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No active jobs or invoices reference this contact. Safe to delete.
            </p>
          )}

          <div>
            <Label className="text-xs">Reason (optional, saved to audit log)</Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Duplicate, no longer with company, etc." />
          </div>

          {hasBlockers && (
            <div>
              <Label className="text-xs">Type <strong>{contact.name}</strong> to force-delete anyway</Label>
              <Input value={confirmName} onChange={e => setConfirmName(e.target.value)} placeholder={contact.name} data-testid="input-confirm-delete-name" />
              <p className="text-xs text-muted-foreground mt-1">
                Force-delete removes the contact and marks related jobs/invoices as "unassigned". Owner/admin only.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2 pt-2">
            <Button variant="outline" onClick={() => archive.mutate()} disabled={archive.isPending} data-testid="button-archive-contact">
              <Archive className="w-4 h-4 mr-2" />
              {archive.isPending ? "Archiving…" : "Archive (recommended)"}
            </Button>
            <Button
              variant="destructive"
              disabled={del.isPending || (hasBlockers && !nameMatches)}
              onClick={() => del.mutate(hasBlockers)}
              data-testid="button-confirm-delete"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {del.isPending ? "Deleting…" : hasBlockers ? "Force delete" : "Delete permanently"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Marketing details dialog — used for editing after creation.
// ─────────────────────────────────────────────────────────────────────────────
function MarketingDialog({
  contact, open, onOpenChange,
}: {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { toast } = useToast();
  const { data: initial } = useQuery<Marketing>({
    queryKey: ["/api/contacts", contact?.id, "marketing"],
    queryFn: () => apiRequest("GET", `/api/contacts/${contact!.id}/marketing`).then(r => r.json()),
    enabled: !!contact && open,
  });
  const [form, setForm] = useState<Marketing>({});
  // Sync form when dialog opens with fresh data
  const [lastLoadedId, setLastLoadedId] = useState<number | null>(null);
  if (open && contact && initial && lastLoadedId !== contact.id) {
    setForm(initial);
    setLastLoadedId(contact.id);
  }

  const save = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/contacts/${contact!.id}/marketing`, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contact!.id, "marketing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/marketing/upcoming"] });
      toast({ title: "Marketing details saved" });
      onOpenChange(false);
      setLastLoadedId(null);
    },
  });

  if (!contact) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setLastLoadedId(null); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-pink-500" />
            Marketing details — {contact.name}
          </DialogTitle>
        </DialogHeader>
        <MarketingFields value={form} onChange={patch => setForm(f => ({ ...f, ...patch }))} />
        <div className="flex justify-end gap-2 pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white">
            {save.isPending ? "Saving…" : "Save details"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Contacts main page
// ─────────────────────────────────────────────────────────────────────────────
export default function Contacts() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "customer", email: "", phone: "", address: "", company: "", referralRate: "", portalPin: "" });
  const [marketing, setMarketing] = useState<Marketing>({});

  const [showArchived, setShowArchived] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [marketingTarget, setMarketingTarget] = useState<Contact | null>(null);

  const { data: contacts = [], isLoading } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const goToPortalSetup = (c: Contact) => {
    if (c.type === "customer") {
      const theirJobs = jobs.filter(j => j.contactId === c.id);
      const target = theirJobs.length
        ? theirJobs.reduce((a, b) => ((b.id || 0) > (a.id || 0) ? b : a))
        : null;
      if (target) setLocation(`/jobs/${target.id}?portal=1`);
      else toast({ title: "No job on file", description: `${c.name} has no job yet. Create a job to set up their portal.` });
    } else {
      setLocation("/partner-portal-setup");
    }
  };

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/contacts", data);
      const created = await res.json();
      // If marketing details were filled, save them alongside the new contact.
      const hasAny = Object.values(marketing).some(v => v && String(v).trim() !== "");
      if (hasAny && created?.id) {
        await apiRequest("PUT", `/api/contacts/${created.id}/marketing`, marketing);
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setOpen(false);
      setForm({ name: "", type: "customer", email: "", phone: "", address: "", company: "", referralRate: "", portalPin: "" });
      setMarketing({});
    },
  });

  // Filter by status. Backend still returns everything; we hide archived unless toggled.
  const visible = contacts.filter(c => showArchived || (c as any).status !== "archived");
  const customers = visible.filter(c => c.type === "customer");
  const subs = visible.filter(c => c.type === "sub");
  const referrals = visible.filter(c => c.type === "referral");
  const referralCompanies = referrals.filter(c => c.isReferralCompany);
  const soloReferrals = referrals.filter(c => !c.isReferralCompany && !c.parentCompanyId);

  const ContactCard = ({ c }: { c: Contact }) => {
    const isArchived = (c as any).status === "archived";
    const unarchive = useMutation({
      mutationFn: () => apiRequest("POST", `/api/contacts/${c.id}/unarchive`),
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/contacts"] }); toast({ title: "Contact restored" }); },
    });
    return (
      <Card data-testid={`contact-card-${c.id}`} className={isArchived ? "opacity-60" : ""}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 ${
              c.type === "customer" ? "bg-[hsl(var(--titan-blue))]" : c.type === "sub" ? "bg-purple-500" : "bg-green-600"
            }`}>
              {c.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-sm">{c.name}</p>
                {isArchived && <Badge variant="outline" className="text-xs">Archived</Badge>}
                {c.portalPin && !isArchived && (
                  <Badge
                    role="link"
                    tabIndex={0}
                    title="Open portal setup"
                    onClick={() => goToPortalSetup(c)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") goToPortalSetup(c); }}
                    className="text-xs bg-green-100 text-green-800 border border-green-200 gap-1 cursor-pointer hover:bg-green-200 transition-colors"
                    data-testid={`badge-portal-active-${c.id}`}
                  >
                    <KeyRound className="w-2.5 h-2.5" />Portal active
                  </Badge>
                )}
              </div>
              {c.company && <p className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="w-3 h-3" />{c.company}</p>}
              {c.phone && <a href={`tel:${c.phone}`} className="text-xs text-[hsl(var(--titan-blue))] flex items-center gap-1 hover:underline"><Phone className="w-3 h-3" />{c.phone}</a>}
              {c.email && <a href={`mailto:${c.email}`} className="text-xs text-[hsl(var(--titan-blue))] flex items-center gap-1 hover:underline"><Mail className="w-3 h-3" />{c.email}</a>}
              {c.referralRate && <p className="text-xs text-green-600 font-medium mt-1">Referral Rate: {c.referralRate}%</p>}
              {c.portalPin && !isArchived && <p className="text-xs text-muted-foreground mt-0.5">Portal PIN: {c.portalPin}</p>}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" data-testid={`menu-contact-${c.id}`}>
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setMarketingTarget(c)} data-testid={`menu-marketing-${c.id}`}>
                  <Sparkles className="w-4 h-4 mr-2 text-pink-500" />Marketing details
                </DropdownMenuItem>
                {isArchived ? (
                  <DropdownMenuItem onClick={() => unarchive.mutate()}>
                    <Archive className="w-4 h-4 mr-2" />Restore from archive
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setDeleteTarget(c)} className="text-red-600" data-testid={`menu-delete-${c.id}`}>
                  <Trash2 className="w-4 h-4 mr-2" />Archive or delete…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Contacts</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={showArchived ? "default" : "outline"}
            onClick={() => setShowArchived(v => !v)}
            data-testid="toggle-show-archived"
          >
            <Archive className="w-3.5 h-3.5 mr-1" />
            {showArchived ? "Hide archived" : "Show archived"}
          </Button>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setMarketing({}); }}>
            <DialogTrigger asChild>
              <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white" data-testid="button-add-contact">
                <Plus className="w-4 h-4 mr-2" />Add Contact
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Add Contact</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                    <SelectTrigger data-testid="select-contact-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer">Customer</SelectItem>
                      <SelectItem value="sub">Subcontractor</SelectItem>
                      <SelectItem value="referral">Referral Partner</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} data-testid="input-contact-name" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} data-testid="input-contact-phone" /></div>
                  <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} data-testid="input-contact-email" /></div>
                </div>
                <div><Label>Company</Label><Input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} data-testid="input-contact-company" /></div>
                <div><Label>Address</Label><Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
                {form.type === "referral" && <div><Label>Referral Rate (%)</Label><Input type="number" value={form.referralRate} onChange={e => setForm(f => ({ ...f, referralRate: e.target.value }))} /></div>}
                {form.type === "customer" && <div><Label>Portal PIN (4 digits)</Label><Input maxLength={4} value={form.portalPin} onChange={e => setForm(f => ({ ...f, portalPin: e.target.value }))} placeholder="e.g. 1234" /></div>}

                {form.type === "referral" && (
                  <MarketingFields value={marketing} onChange={patch => setMarketing(m => ({ ...m, ...patch }))} />
                )}

                <Button
                  className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
                  disabled={createMutation.isPending || !form.name}
                  data-testid="button-save-contact"
                  onClick={() => createMutation.mutate({ ...form, referralRate: form.referralRate ? Number(form.referralRate) : null })}
                >{createMutation.isPending ? "Saving…" : "Add Contact"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers">Customers ({customers.length})</TabsTrigger>
          <TabsTrigger value="subs">Subs ({subs.length})</TabsTrigger>
          <TabsTrigger value="referrals" data-testid="tab-referrals">Referral ({referrals.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="customers" className="mt-3 space-y-2">
          {customers.map(c => <ContactCard key={c.id} c={c} />)}
        </TabsContent>
        <TabsContent value="subs" className="mt-3 space-y-2">
          {subs.map(c => <ContactCard key={c.id} c={c} />)}
        </TabsContent>
        <TabsContent value="referrals" className="mt-3 space-y-3">
          <ReferralCompaniesSection
            companies={referralCompanies}
            allReferrals={referrals}
            soloReferrals={soloReferrals}
            ContactCard={ContactCard}
          />
        </TabsContent>
      </Tabs>

      <DeleteContactDialog contact={deleteTarget} open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} />
      <MarketingDialog contact={marketingTarget} open={!!marketingTarget} onOpenChange={(o) => !o && setMarketingTarget(null)} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Referral Companies section
// ─────────────────────────────────────────────────────────────────────────────
function ReferralCompaniesSection({
  companies, allReferrals, soloReferrals, ContactCard,
}: {
  companies: Contact[];
  allReferrals: Contact[];
  soloReferrals: Contact[];
  ContactCard: (props: { c: Contact }) => JSX.Element;
}) {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [companyForm, setCompanyForm] = useState({ name: "", email: "", phone: "", portalPin: "" });
  const [companyMarketing, setCompanyMarketing] = useState<Marketing>({});

  const createCompany = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/contacts", data);
      const created = await res.json();
      const hasAny = Object.values(companyMarketing).some(v => v && String(v).trim() !== "");
      if (hasAny && created?.id) {
        await apiRequest("PUT", `/api/contacts/${created.id}/marketing`, companyMarketing);
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setCreateOpen(false);
      setCompanyForm({ name: "", email: "", phone: "", portalPin: "" });
      setCompanyMarketing({});
      toast({ title: "Referral company created" });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-green-600" />
          <h2 className="text-sm font-bold">Referral Companies ({companies.length})</h2>
        </div>
        <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setCompanyMarketing({}); }}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="border-green-600 text-green-700 hover:bg-green-50" data-testid="button-create-referral-company">
              <Plus className="w-3.5 h-3.5 mr-1" />New Company
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New Referral Company</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Create the company, then attach techs to it below. Set a portal PIN so the company can log into the Partner Portal and see everything you've paid them across all their techs.
              </p>
              <div><Label>Company Name</Label><Input value={companyForm.name} onChange={e => setCompanyForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. State Farm — Augusta" data-testid="input-company-name" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Phone</Label><Input value={companyForm.phone} onChange={e => setCompanyForm(f => ({ ...f, phone: e.target.value }))} data-testid="input-company-phone" /></div>
                <div><Label>Email</Label><Input type="email" value={companyForm.email} onChange={e => setCompanyForm(f => ({ ...f, email: e.target.value }))} data-testid="input-company-email" /></div>
              </div>
              <div>
                <Label>Portal PIN (4 digits)</Label>
                <Input maxLength={4} value={companyForm.portalPin} onChange={e => setCompanyForm(f => ({ ...f, portalPin: e.target.value }))} placeholder="e.g. 4321" data-testid="input-company-pin" />
              </div>

              <MarketingFields value={companyMarketing} onChange={patch => setCompanyMarketing(m => ({ ...m, ...patch }))} />

              <Button
                className="w-full bg-green-600 hover:bg-green-700 text-white"
                disabled={createCompany.isPending || !companyForm.name}
                data-testid="button-save-company"
                onClick={() => createCompany.mutate({
                  name: companyForm.name,
                  type: "referral",
                  isReferralCompany: true,
                  company: companyForm.name,
                  email: companyForm.email || null,
                  phone: companyForm.phone || null,
                  portalPin: companyForm.portalPin || null,
                })}
              >{createCompany.isPending ? "Saving…" : "Create Company"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {companies.length === 0 && (
        <p className="text-xs text-muted-foreground border border-dashed rounded-md p-4 text-center">
          No referral companies yet. Create one to group techs and give them a partner portal login.
        </p>
      )}

      {companies.map(company => (
        <CompanyCard key={company.id} company={company} allReferrals={allReferrals} />
      ))}

      {soloReferrals.length > 0 && (
        <div className="pt-2 space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Individual Referral Partners</h3>
          {soloReferrals.map(c => <ContactCard key={c.id} c={c} />)}
        </div>
      )}
    </div>
  );
}

function CompanyCard({ company, allReferrals }: { company: Contact; allReferrals: Contact[] }) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(true);
  const [attachOpen, setAttachOpen] = useState(false);
  const [selectedTechId, setSelectedTechId] = useState("");
  const [newTech, setNewTech] = useState({ name: "", phone: "", email: "" });
  const [newTechMarketing, setNewTechMarketing] = useState<Marketing>({});
  const [mode, setMode] = useState<"existing" | "new">("new");

  const techs = allReferrals.filter(c => c.parentCompanyId === company.id);
  const attachable = allReferrals.filter(c => !c.isReferralCompany && !c.parentCompanyId && c.id !== company.id);

  const attachExisting = useMutation({
    mutationFn: (techId: number) => apiRequest("PATCH", `/api/contacts/${techId}`, { parentCompanyId: company.id }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/contacts"] }); setAttachOpen(false); setSelectedTechId(""); toast({ title: "Tech attached" }); },
  });
  const createTech = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/contacts", data);
      const created = await res.json();
      const hasAny = Object.values(newTechMarketing).some(v => v && String(v).trim() !== "");
      if (hasAny && created?.id) {
        await apiRequest("PUT", `/api/contacts/${created.id}/marketing`, newTechMarketing);
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setAttachOpen(false);
      setNewTech({ name: "", phone: "", email: "" });
      setNewTechMarketing({});
      toast({ title: "Tech added to company" });
    },
  });
  const detach = useMutation({
    mutationFn: (techId: number) => apiRequest("PATCH", `/api/contacts/${techId}`, { parentCompanyId: null }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/contacts"] }); toast({ title: "Tech removed from company" }); },
  });

  return (
    <Card className="border-green-200" data-testid={`company-card-${company.id}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <button onClick={() => setExpanded(e => !e)} className="mt-0.5 text-muted-foreground" data-testid={`toggle-company-${company.id}`}>
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <div className="w-9 h-9 rounded-lg bg-green-600 flex items-center justify-center text-white shrink-0"><Building2 className="w-5 h-5" /></div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm" data-testid={`text-company-name-${company.id}`}>{company.name}</p>
              <Badge className="text-xs bg-green-100 text-green-800 border border-green-200">Company</Badge>
              {company.portalPin && (
                <Badge className="text-xs bg-green-100 text-green-800 border border-green-200 gap-1">
                  <KeyRound className="w-2.5 h-2.5" />Portal PIN: {company.portalPin}
                </Badge>
              )}
            </div>
            {company.phone && <a href={`tel:${company.phone}`} className="text-xs text-[hsl(var(--titan-blue))] flex items-center gap-1 hover:underline"><Phone className="w-3 h-3" />{company.phone}</a>}
            {company.email && <a href={`mailto:${company.email}`} className="text-xs text-[hsl(var(--titan-blue))] flex items-center gap-1 hover:underline"><Mail className="w-3 h-3" />{company.email}</a>}
            <p className="text-xs text-muted-foreground mt-1">{techs.length} tech{techs.length === 1 ? "" : "s"} attached</p>
          </div>
          <Dialog open={attachOpen} onOpenChange={(o) => { setAttachOpen(o); if (!o) setNewTechMarketing({}); }}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="shrink-0" data-testid={`button-attach-tech-${company.id}`}>
                <UserPlus className="w-3.5 h-3.5 mr-1" />Add Tech
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Attach Tech to {company.name}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button size="sm" variant={mode === "new" ? "default" : "outline"} onClick={() => setMode("new")} data-testid="mode-new-tech">New Tech</Button>
                  <Button size="sm" variant={mode === "existing" ? "default" : "outline"} onClick={() => setMode("existing")} data-testid="mode-existing-tech">Existing Referral</Button>
                </div>
                {mode === "new" ? (
                  <div className="space-y-3">
                    <div><Label>Tech Name</Label><Input value={newTech.name} onChange={e => setNewTech(f => ({ ...f, name: e.target.value }))} data-testid="input-tech-name" /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Phone</Label><Input value={newTech.phone} onChange={e => setNewTech(f => ({ ...f, phone: e.target.value }))} data-testid="input-tech-phone" /></div>
                      <div><Label>Email</Label><Input type="email" value={newTech.email} onChange={e => setNewTech(f => ({ ...f, email: e.target.value }))} data-testid="input-tech-email" /></div>
                    </div>

                    <MarketingFields value={newTechMarketing} onChange={patch => setNewTechMarketing(m => ({ ...m, ...patch }))} />

                    <Button
                      className="w-full bg-green-600 hover:bg-green-700 text-white"
                      disabled={createTech.isPending || !newTech.name}
                      data-testid="button-save-tech"
                      onClick={() => createTech.mutate({
                        name: newTech.name, type: "referral", parentCompanyId: company.id,
                        company: company.name, phone: newTech.phone || null, email: newTech.email || null,
                      })}
                    >{createTech.isPending ? "Saving…" : "Add Tech to Company"}</Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {attachable.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No unattached referral partners available. Use "New Tech" to create one.</p>
                    ) : (
                      <>
                        <div>
                          <Label>Select Referral Partner</Label>
                          <Select value={selectedTechId} onValueChange={setSelectedTechId}>
                            <SelectTrigger data-testid="select-existing-tech"><SelectValue placeholder="Choose a partner" /></SelectTrigger>
                            <SelectContent>{attachable.map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <Button
                          className="w-full bg-green-600 hover:bg-green-700 text-white"
                          disabled={attachExisting.isPending || !selectedTechId}
                          data-testid="button-attach-existing"
                          onClick={() => attachExisting.mutate(Number(selectedTechId))}
                        >{attachExisting.isPending ? "Attaching…" : "Attach"}</Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {expanded && (
          <div className="pl-10 space-y-1.5">
            {techs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No techs attached yet.</p>
            ) : techs.map(t => (
              <div key={t.id} className="flex items-center justify-between text-sm border rounded-md px-3 py-2 bg-muted/30" data-testid={`tech-row-${t.id}`}>
                <div>
                  <p className="font-medium">{t.name}</p>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    {t.phone && <span>{t.phone}</span>}
                    {t.email && <span>{t.email}</span>}
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 text-xs" onClick={() => detach.mutate(t.id)} data-testid={`button-detach-${t.id}`}>Remove</Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
