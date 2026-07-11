import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "wouter";
import { Plus, Phone, Mail, Building2, KeyRound, Users, UserPlus, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Contact, Job } from "@shared/schema";

export default function Contacts() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "customer", email: "", phone: "", address: "", company: "", referralRate: "", portalPin: "" });

  const { data: contacts = [], isLoading } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Jump to portal setup for this contact. Customers set up their portal on a
  // job's Activity tab; subs/referrals use the Partner Portal Setup page.
  const goToPortalSetup = (c: Contact) => {
    if (c.type === "customer") {
      const theirJobs = jobs.filter(j => j.contactId === c.id);
      const target = theirJobs.length
        ? theirJobs.reduce((a, b) => ((b.id || 0) > (a.id || 0) ? b : a))
        : null;
      if (target) {
        setLocation(`/jobs/${target.id}?portal=1`);
      } else {
        toast({ title: "No job on file", description: `${c.name} has no job yet. Create a job to set up their portal.` });
      }
    } else {
      setLocation("/partner-portal-setup");
    }
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/contacts", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/contacts"] }); setOpen(false); },
  });

  const customers = contacts.filter(c => c.type === "customer");
  const subs = contacts.filter(c => c.type === "sub");
  const referrals = contacts.filter(c => c.type === "referral");
  // Referral companies group individual techs/reps. Standalone referral contacts
  // (no parent company, not marked as a company) still show in the flat list.
  const referralCompanies = referrals.filter(c => c.isReferralCompany);
  const soloReferrals = referrals.filter(c => !c.isReferralCompany && !c.parentCompanyId);

  const ContactCard = ({ c }: { c: Contact }) => (
    <Card data-testid={`contact-card-${c.id}`}>
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
              {c.portalPin && (
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
            {c.portalPin && <p className="text-xs text-muted-foreground mt-0.5">Portal PIN: {c.portalPin}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Contacts</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white" data-testid="button-add-contact">
              <Plus className="w-4 h-4 mr-2" />Add Contact
            </Button>
          </DialogTrigger>
          <DialogContent>
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
              <Button
                className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white"
                disabled={createMutation.isPending}
                data-testid="button-save-contact"
                onClick={() => createMutation.mutate({ ...form, referralRate: form.referralRate ? Number(form.referralRate) : null })}
              >{createMutation.isPending ? "Saving…" : "Add Contact"}</Button>
            </div>
          </DialogContent>
        </Dialog>
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
    </div>
  );
}

// ── Referral Companies ────────────────────────────────────────────────────────
// A referral company groups multiple techs/reps. Each company can have a partner
// portal PIN so it can log in and see everything Titan has paid it (aggregated
// across all its attached techs).
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

  const createCompany = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/contacts", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      setCreateOpen(false);
      setCompanyForm({ name: "", email: "", phone: "", portalPin: "" });
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
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="border-green-600 text-green-700 hover:bg-green-50" data-testid="button-create-referral-company">
              <Plus className="w-3.5 h-3.5 mr-1" />New Company
            </Button>
          </DialogTrigger>
          <DialogContent>
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
  const [mode, setMode] = useState<"existing" | "new">("new");

  const techs = allReferrals.filter(c => c.parentCompanyId === company.id);
  // Referral contacts that are neither companies nor already attached anywhere.
  const attachable = allReferrals.filter(c => !c.isReferralCompany && !c.parentCompanyId && c.id !== company.id);

  const attachExisting = useMutation({
    mutationFn: (techId: number) => apiRequest("PATCH", `/api/contacts/${techId}`, { parentCompanyId: company.id }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/contacts"] }); setAttachOpen(false); setSelectedTechId(""); toast({ title: "Tech attached" }); },
  });
  const createTech = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/contacts", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/contacts"] }); setAttachOpen(false); setNewTech({ name: "", phone: "", email: "" }); toast({ title: "Tech added to company" }); },
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
          <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="shrink-0" data-testid={`button-attach-tech-${company.id}`}>
                <UserPlus className="w-3.5 h-3.5 mr-1" />Add Tech
              </Button>
            </DialogTrigger>
            <DialogContent>
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
