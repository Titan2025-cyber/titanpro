import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { UserPlus, Pencil, Power, ShieldCheck, Key, RefreshCw, Trash2, Mail, Link2, LogOut, CheckCircle, ShieldOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { fmtDate } from "@/lib/dates";

// apiRequest throws Error(`<status>: <body>`) where <body> is usually JSON like
// {"error":"..."}. Pull out the human message.
async function errMsg(err: any): Promise<string> {
  const raw = typeof err?.message === "string" ? err.message : "";
  const m = raw.match(/^\d+:\s*([\s\S]*)$/);
  const body = (m ? m[1] : raw).trim();
  if (body.startsWith("{")) {
    try { const j = JSON.parse(body); return j.error || j.message || body; } catch { /* fall through */ }
  }
  return body || "Something went wrong. Please try again.";
}

interface StaffMember {
  id: number;
  name: string;
  role: string;
  position: string | null;
  gmailEmail: string | null;
  gmailConnected: boolean;
  gmailConnectedAt: string | null;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  permissions: string;
  avatarInitials: string;
  createdAt: string;
  twoFactorEnabled?: boolean;
}

const ROLE_LABELS: Record<string, { label: string; color: string; desc: string }> = {
  owner:  { label: "Owner",  color: "bg-[hsl(var(--titan-red))] text-white",  desc: "Full access to everything" },
  admin:  { label: "Admin",  color: "bg-[hsl(var(--titan-blue))] text-white", desc: "All access except user management settings" },
  general_manager: { label: "General Manager", color: "bg-indigo-600 text-white", desc: "Operational oversight + AI Agent Center" },
  tech:   { label: "Tech",   color: "bg-orange-500 text-white",               desc: "Field ops: jobs, photos, equipment, scheduling" },
  sales:  { label: "Sales",  color: "bg-purple-600 text-white",               desc: "Business dev, estimates, contacts, marketing" },
  office: { label: "Office", color: "bg-green-600 text-white",                desc: "Finance, invoices, payments, reports" },
};

const POSITIONS = [
  "Owner", "General Manager", "Project Manager", "Office Manager",
  "Lead Technician", "Field Technician", "Sales Rep", "Estimator",
  "Accounts Payable", "Receptionist", "Subcontractor",
];

const blank = { name: "", role: "tech", position: "", phone: "", gmailEmail: "", password: "titan1234", pin: "1234", isActive: true };

export default function UserManagement() {
  const { user: me, can } = useAuth();
  const { toast } = useToast();
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<typeof blank>({ ...blank });
  const [resetPasswordId, setResetPasswordId] = useState<number | null>(null);
  const [newPw, setNewPw] = useState("");
  const [newPin, setNewPin] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<StaffMember | null>(null);
  const [reset2FATarget, setReset2FATarget] = useState<StaffMember | null>(null);
  const canReset2FA = me?.role === "owner" || me?.role === "admin";

  const { data: staff = [], isLoading } = useQuery<StaffMember[]>({
    queryKey: ["/api/staff"],
    queryFn: () => apiRequest("GET", "/api/staff").then(r => r.json()),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/staff"] });
    queryClient.invalidateQueries({ queryKey: ["/api/staff/assignable"] });
    // Login page "Quick PIN" name picker also reads from the employees table
    // (via /api/auth/pin-users). Any add/edit/deactivate/delete must refresh
    // that list so deactivated or removed users can no longer be selected.
    queryClient.invalidateQueries({ queryKey: ["/api/auth/pin-users"] });
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/staff", data),
    onSuccess: () => { refresh(); setCreating(false); setForm({ ...blank }); toast({ title: "Staff member created" }); },
    onError: async (err) => toast({ title: "Couldn't create user", description: await errMsg(err), variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/staff/${id}`, data),
    onSuccess: () => { refresh(); setEditing(null); setResetPasswordId(null); setNewPw(""); setNewPin(""); toast({ title: "Changes saved" }); },
    onError: async (err) => toast({ title: "Couldn't save changes", description: await errMsg(err), variant: "destructive" }),
  });

  const toggleActive = (emp: StaffMember) =>
    updateMutation.mutate({ id: emp.id, data: { isActive: !emp.isActive } });

  // ── Gmail integration (per-employee) ────────────────────────────────────────
  // configured = server has Google credentials. When not configured, no Gmail
  // controls are shown (dormant / test-safe).
  const { data: gmailAdmin } = useQuery<{ configured: boolean; employees: any[] }>({
    queryKey: ["/api/gmail/admin/status"],
    queryFn: () => apiRequest("GET", "/api/gmail/admin/status").then(r => r.json()),
  });
  const gmailConfigured = !!gmailAdmin?.configured;

  // Connect MY OWN Gmail (each person must connect their own Google account —
  // Google issues tokens to whoever completes the consent screen).
  const connectMyGmail = async () => {
    try {
      const res = await apiRequest("GET", "/api/gmail/oauth/start");
      const { authUrl, error } = await res.json();
      if (error || !authUrl) { toast({ title: "Cannot connect", description: error || "No auth URL returned.", variant: "destructive" }); return; }
      const popup = window.open(authUrl, "gmail_oauth", "width=520,height=680");
      const timer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(timer);
          refresh();
          queryClient.invalidateQueries({ queryKey: ["/api/gmail/admin/status"] });
          queryClient.invalidateQueries({ queryKey: ["/api/gmail/status"] });
        }
      }, 800);
    } catch (e: any) {
      toast({ title: "Cannot connect", description: String(e?.message || e), variant: "destructive" });
    }
  };

  const disconnectGmail = useMutation({
    mutationFn: (employeeId: number) => apiRequest("POST", `/api/gmail/admin/disconnect/${employeeId}`),
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/admin/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gmail/status"] });
      toast({ title: "Gmail disconnected" });
    },
    onError: async (err) => toast({ title: "Couldn't disconnect", description: await errMsg(err), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/staff/${id}?hard=true`),
    onSuccess: () => { refresh(); setDeleteTarget(null); toast({ title: "Account deleted" }); },
    onError: async (err) => toast({ title: "Couldn't delete user", description: await errMsg(err), variant: "destructive" }),
  });

  const reset2FAMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/staff/${id}/reset-2fa`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/staff"] }); setReset2FATarget(null); },
  });

  if (!can("user-management")) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
        <ShieldCheck className="w-12 h-12 text-muted-foreground/40" />
        <p className="font-semibold text-muted-foreground">Access Restricted</p>
        <p className="text-sm text-muted-foreground">Only Owners can manage user accounts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">User Management</h1>
          <p className="text-sm text-muted-foreground">{staff.filter(s => s.isActive).length} active staff members</p>
        </div>
        <Button
          className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white"
          size="sm"
          onClick={() => { setCreating(true); setEditing(null); setForm({ ...blank }); }}
          data-testid="button-add-staff"
        >
          <UserPlus className="w-4 h-4 mr-1.5" />Add Staff
        </Button>
      </div>

      {/* Role legend */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(ROLE_LABELS).map(([key, { label, color, desc }]) => (
          <div key={key} className="flex items-center gap-1.5 text-xs">
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>{label}</span>
            <span className="text-muted-foreground hidden sm:inline">— {desc}</span>
          </div>
        ))}
      </div>

      {/* Create form */}
      {creating && (
        <Card className="border-[hsl(var(--titan-blue)/0.4)] border-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-[hsl(var(--titan-blue))]" />New Staff Member
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <StaffForm
              form={form}
              setForm={setForm}
              onSave={() => createMutation.mutate(form)}
              onCancel={() => setCreating(false)}
              isPending={createMutation.isPending}
              isNew
            />
          </CardContent>
        </Card>
      )}

      {/* Staff list */}
      {isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Loading staff…</p>}
      <div className="space-y-3">
        {staff.map(emp => {
          const rl = ROLE_LABELS[emp.role] || ROLE_LABELS.tech;
          const isMe = emp.id === me?.id;
          const isEditingThis = editing?.id === emp.id;
          const isResettingThis = resetPasswordId === emp.id;

          return (
            <Card key={emp.id} className={`transition-opacity ${!emp.isActive ? "opacity-50" : ""}`}>
              <CardContent className="p-4">
                {isEditingThis ? (
                  <StaffForm
                    form={form}
                    setForm={setForm}
                    onSave={() => updateMutation.mutate({ id: emp.id, data: form })}
                    onCancel={() => setEditing(null)}
                    isPending={updateMutation.isPending}
                  />
                ) : isResettingThis ? (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold">Reset credentials for {emp.name}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">New Password</Label>
                        <Input className="h-8 text-xs mt-1" type="password" placeholder="Leave blank to keep" value={newPw} onChange={e => setNewPw(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs">New PIN</Label>
                        <Input className="h-8 text-xs mt-1" type="password" maxLength={6} placeholder="4–6 digits" value={newPin} onChange={e => setNewPin(e.target.value)} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="bg-[hsl(var(--titan-blue))] text-white" onClick={() => updateMutation.mutate({ id: emp.id, data: { password: newPw || undefined, pin: newPin || undefined } })} disabled={updateMutation.isPending}>
                        <Key className="w-3 h-3 mr-1" />Save Credentials
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setResetPasswordId(null); setNewPw(""); setNewPin(""); }}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${rl.color}`}>
                      {emp.avatarInitials}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{emp.name} {isMe && <span className="text-xs text-muted-foreground">(you)</span>}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${rl.color}`}>{rl.label}</span>
                        {emp.twoFactorEnabled && (
                          <Badge variant="outline" className="text-xs text-green-700 border-green-300" data-testid={`badge-2fa-${emp.id}`}>2FA ✓</Badge>
                        )}
                        {!emp.isActive && <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {emp.position || "No position set"}
                        {emp.phone && <span className="ml-2">· {emp.phone}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground" data-testid={`text-staff-email-${emp.id}`}>
                        <Key className="w-3 h-3 inline mr-1 opacity-60" />
                        {emp.gmailEmail || <span className="italic">signs in by name: {emp.name}</span>}
                      </p>
                      {/* Gmail connection status + controls (only when configured) */}
                      {gmailConfigured && (
                        <div className="mt-1 flex items-center gap-2 flex-wrap" data-testid={`gmail-status-${emp.id}`}>
                          {emp.gmailConnected ? (
                            <>
                              <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                                <CheckCircle className="w-3 h-3" /> Gmail connected
                              </span>
                              <button
                                onClick={() => disconnectGmail.mutate(emp.id)}
                                disabled={disconnectGmail.isPending}
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                                data-testid={`button-gmail-disconnect-${emp.id}`}
                              >
                                <LogOut className="w-3 h-3" /> Disconnect
                              </button>
                            </>
                          ) : isMe ? (
                            <button
                              onClick={connectMyGmail}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-[hsl(var(--titan-blue))] hover:underline"
                              data-testid={`button-gmail-connect-${emp.id}`}
                            >
                              <Link2 className="w-3 h-3" /> Connect Gmail
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Mail className="w-3 h-3 opacity-60" /> Gmail not connected
                              <span className="opacity-60">— {emp.name.split(" ")[0]} connects from their own login</span>
                            </span>
                          )}
                        </div>
                      )}
                      {emp.lastLoginAt && (
                        <p className="text-xs text-muted-foreground">
                          Last login: {fmtDate(emp.lastLoginAt, { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      )}
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          setEditing(emp);
                          setCreating(false);
                          setResetPasswordId(null);
                          setForm({
                            name: emp.name, role: emp.role, position: emp.position || "",
                            phone: emp.phone || "", gmailEmail: emp.gmailEmail || "",
                            password: "", pin: "", isActive: emp.isActive,
                          });
                        }}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Edit"
                        data-testid={`button-edit-staff-${emp.id}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => { setResetPasswordId(emp.id); setEditing(null); setCreating(false); setNewPw(""); setNewPin(""); }}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Reset password/PIN"
                        data-testid={`button-reset-creds-${emp.id}`}
                      >
                        <Key className="w-3.5 h-3.5" />
                      </button>
                      {!isMe && (
                        <button
                          onClick={() => toggleActive(emp)}
                          className={`p-1.5 rounded transition-colors ${emp.isActive ? "hover:bg-destructive/10 text-muted-foreground hover:text-destructive" : "hover:bg-green-50 text-muted-foreground hover:text-green-600"}`}
                          title={emp.isActive ? "Deactivate" : "Reactivate"}
                          data-testid={`button-toggle-active-${emp.id}`}
                        >
                          {emp.isActive ? <Power className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      {canReset2FA && emp.twoFactorEnabled && (
                        <button
                          onClick={() => setReset2FATarget(emp)}
                          className="p-1.5 rounded transition-colors hover:bg-orange-50 text-muted-foreground hover:text-orange-600"
                          title="Reset 2FA"
                          data-testid={`button-reset-2fa-${emp.id}`}
                        >
                          <ShieldOff className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {!isMe && emp.role !== "owner" && (
                        <button
                          onClick={() => setDeleteTarget(emp)}
                          className="p-1.5 rounded transition-colors hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          title="Permanently delete"
                          data-testid={`button-delete-staff-${emp.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Permanent delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {deleteTarget?.name}'s account and login access. This cannot be undone.
              If you only want to revoke their login temporarily, use Deactivate instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red))]/90 text-white"
              onClick={(e) => { e.preventDefault(); if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting\u2026" : "Delete Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset 2FA confirmation */}
      <AlertDialog open={!!reset2FATarget} onOpenChange={(open) => { if (!open) setReset2FATarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset 2FA for {reset2FATarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears {reset2FATarget?.name}'s authenticator secret, backup codes, and trusted devices.
              They will be required to set up two-factor authentication again on their next password login.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reset2FAMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-orange-600 hover:bg-orange-600/90 text-white"
              onClick={(e) => { e.preventDefault(); if (reset2FATarget) reset2FAMutation.mutate(reset2FATarget.id); }}
              disabled={reset2FAMutation.isPending}
            >
              {reset2FAMutation.isPending ? "Resetting\u2026" : "Reset 2FA"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StaffForm({ form, setForm, onSave, onCancel, isPending, isNew }: {
  form: any; setForm: any; onSave: () => void; onCancel: () => void; isPending: boolean; isNew?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        <Label className="text-xs">Full Name *</Label>
        <Input className="h-8 text-xs mt-1" value={form.name} onChange={e => setForm((f: any) => ({ ...f, name: e.target.value }))} placeholder="e.g. John Smith" />
      </div>
      <div>
        <Label className="text-xs">Role *</Label>
        <Select value={form.role} onValueChange={v => setForm((f: any) => ({ ...f, role: v }))}>
          <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="owner">Owner — Full access</SelectItem>
            <SelectItem value="admin">Admin — All access</SelectItem>
            <SelectItem value="general_manager">General Manager — Ops + AI Agent Center</SelectItem>
            <SelectItem value="tech">Tech — Field ops only</SelectItem>
            <SelectItem value="sales">Sales — BD + estimates</SelectItem>
            <SelectItem value="office">Office — Finance + reports</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Position Title</Label>
        <Select value={form.position} onValueChange={v => setForm((f: any) => ({ ...f, position: v }))}>
          <SelectTrigger className="h-8 text-xs mt-1"><SelectValue placeholder="Select position" /></SelectTrigger>
          <SelectContent>
            {["Owner", "General Manager", "Project Manager", "Office Manager",
              "Lead Technician", "Field Technician", "Sales Rep", "Estimator",
              "Accounts Payable", "Receptionist", "Subcontractor"].map(p => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Phone</Label>
        <Input className="h-8 text-xs mt-1" value={form.phone} onChange={e => setForm((f: any) => ({ ...f, phone: e.target.value }))} placeholder="706-555-0101" />
      </div>
      <div className="sm:col-span-2">
        <Label className="text-xs">Login Email <span className="text-muted-foreground">(used to sign in + for Email module)</span></Label>
        <Input className="h-8 text-xs mt-1" value={form.gmailEmail} onChange={e => setForm((f: any) => ({ ...f, gmailEmail: e.target.value }))} placeholder="name@company.com" data-testid="input-staff-email" />
      </div>
      {isNew ? (
        <>
          <div>
            <Label className="text-xs">Password <span className="text-muted-foreground">(default: titan1234)</span></Label>
            <Input className="h-8 text-xs mt-1" type="password" value={form.password} onChange={e => setForm((f: any) => ({ ...f, password: e.target.value }))} placeholder="titan1234" data-testid="input-staff-password" />
          </div>
          <div>
            <Label className="text-xs">PIN <span className="text-muted-foreground">(default: 1234)</span></Label>
            <Input className="h-8 text-xs mt-1" type="password" maxLength={8} value={form.pin} onChange={e => setForm((f: any) => ({ ...f, pin: e.target.value }))} placeholder="1234" data-testid="input-staff-pin" />
          </div>
        </>
      ) : (
        <>
          <div>
            <Label className="text-xs">New Password <span className="text-muted-foreground">(leave blank to keep)</span></Label>
            <Input className="h-8 text-xs mt-1" type="password" value={form.password} onChange={e => setForm((f: any) => ({ ...f, password: e.target.value }))} placeholder="••••••••" data-testid="input-staff-password" />
          </div>
          <div>
            <Label className="text-xs">New PIN <span className="text-muted-foreground">(4–8 digits, blank keeps)</span></Label>
            <Input className="h-8 text-xs mt-1" type="password" maxLength={8} value={form.pin} onChange={e => setForm((f: any) => ({ ...f, pin: e.target.value }))} placeholder="••••" data-testid="input-staff-pin" />
          </div>
        </>
      )}
      <div className="flex items-center gap-2 sm:col-span-2">
        <Switch checked={form.isActive} onCheckedChange={v => setForm((f: any) => ({ ...f, isActive: v }))} />
        <Label className="text-xs">{form.isActive ? "Active" : "Inactive (cannot log in)"}</Label>
      </div>
      <div className="sm:col-span-2 flex gap-2 pt-1">
        <Button size="sm" className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue-dark))] text-white" onClick={onSave} disabled={isPending || !form.name || !form.role}>
          {isPending ? "Saving…" : isNew ? "Create Account" : "Save Changes"}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
