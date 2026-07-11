import io
path = "client/src/pages/PartnerPortal.tsx"
with io.open(path, encoding="utf-8") as f:
    src = f.read()

anchor = "function PartnerAccount({ partner }: { partner: Contact }) {"
assert src.count(anchor) == 1, f"anchor count={src.count(anchor)}"

component = r'''const LEAD_STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  submitted: { label: "Submitted",  cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" },
  contacted: { label: "Contacted",  cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
  scheduled: { label: "Scheduled",  cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300" },
  converted: { label: "Converted",  cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  declined:  { label: "Declined",   cls: "bg-muted text-muted-foreground" },
};
const leadDate = (s?: string | null) => s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "\u2014";

function ReferJob({ partner }: { partner: Contact }) {
  const { toast } = useToast();
  const empty = {
    customerName: "", customerPhone: "", customerEmail: "", lossAddress: "",
    lossType: "water", insuranceCarrier: "", claimNumber: "", urgency: "standard", description: "",
  };
  const [form, setForm] = useState(empty);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const { data: leads = [], refetch } = useQuery<any[]>({
    queryKey: ["/api/partner/leads", partner.id],
    queryFn: () => apiRequest("GET", `/api/partner/${partner.id}/leads`).then(r => r.json()),
    staleTime: 0,
  });

  const submit = useMutation({
    mutationFn: () => apiRequest("POST", `/api/partner/${partner.id}/leads`, form).then(r => r.json()),
    onSuccess: () => {
      setForm(empty);
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/partner/leads", partner.id] });
      toast({ title: "Job sent to Titan", description: "Our team will reach out to the customer shortly. Thank you for the referral!" });
    },
    onError: (err: any) => {
      toast({ title: "Could not submit", description: err?.message || "Please check the form and try again.", variant: "destructive" });
    },
  });

  const canSubmit = form.customerName.trim() && (form.customerPhone.trim() || form.lossAddress.trim());

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Send className="w-4 h-4 text-[hsl(var(--titan-red))]" />Refer a Job to Titan</CardTitle>
          <p className="text-xs text-muted-foreground">Send us a new customer and we'll take it from here. You'll earn your referral bonus when the job converts.</p>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Customer name <span className="text-[hsl(var(--titan-red))]">*</span></Label>
              <Input value={form.customerName} onChange={e => set("customerName", e.target.value)} placeholder="e.g. Jane Doe" data-testid="input-lead-name" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Customer phone</Label>
              <Input value={form.customerPhone} onChange={e => set("customerPhone", e.target.value)} placeholder="706-555-0000" data-testid="input-lead-phone" />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Customer email</Label>
              <Input value={form.customerEmail} onChange={e => set("customerEmail", e.target.value)} placeholder="optional" data-testid="input-lead-email" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Loss address</Label>
              <Input value={form.lossAddress} onChange={e => set("lossAddress", e.target.value)} placeholder="Street, City, GA" data-testid="input-lead-address" />
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Loss type</Label>
              <Select value={form.lossType} onValueChange={v => set("lossType", v)}>
                <SelectTrigger data-testid="select-lead-losstype"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="water">Water</SelectItem>
                  <SelectItem value="fire">Fire / Smoke</SelectItem>
                  <SelectItem value="mold">Mold</SelectItem>
                  <SelectItem value="storm">Storm / Wind</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Urgency</Label>
              <Select value={form.urgency} onValueChange={v => set("urgency", v)}>
                <SelectTrigger data-testid="select-lead-urgency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="emergency">Emergency (24hr)</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="scheduled">Not urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Insurance carrier</Label>
              <Input value={form.insuranceCarrier} onChange={e => set("insuranceCarrier", e.target.value)} placeholder="optional" data-testid="input-lead-carrier" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">What happened?</Label>
            <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3}
              placeholder="Brief description of the damage so our team can prioritize the response." data-testid="input-lead-description" />
          </div>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />Include at least a phone number or address so we can reach the customer.</p>
          <Button className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red)/0.85)] text-white"
            disabled={!canSubmit || submit.isPending} onClick={() => submit.mutate()} data-testid="button-submit-lead">
            <Send className="w-4 h-4 mr-2" />{submit.isPending ? "Sending\u2026" : "Send Job to Titan"}
          </Button>
        </CardContent>
      </Card>

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">My Referrals ({leads.length})</p>
        {leads.length === 0 ? (
          <div className="text-center py-8 border rounded-xl bg-muted/20">
            <Send className="w-7 h-7 mx-auto mb-2 text-muted-foreground opacity-40" />
            <p className="text-sm font-medium text-muted-foreground">No referrals yet</p>
            <p className="text-xs text-muted-foreground mt-1">Jobs you send will show up here with live status.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {leads.map((l: any) => {
              const st = LEAD_STATUS_STYLE[l.status] || LEAD_STATUS_STYLE.submitted;
              return (
                <div key={l.id} className="border rounded-xl p-3 bg-card" data-testid={`lead-row-${l.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-tight">{l.customer_name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {[l.loss_type && l.loss_type.charAt(0).toUpperCase() + l.loss_type.slice(1), l.loss_address, l.insurance_carrier].filter(Boolean).join(" \u00b7 ") || "\u2014"}
                      </p>
                    </div>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${st.cls}`}>{st.label}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[11px] text-muted-foreground">Sent {leadDate(l.created_at)}</span>
                    {l.urgency === "emergency" && <span className="text-[11px] font-medium text-[hsl(var(--titan-red))] flex items-center gap-1"><AlertCircle className="w-3 h-3" />Emergency</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

'''

src = src.replace(anchor, component + anchor, 1)
with io.open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("inserted ReferJob before PartnerAccount")
