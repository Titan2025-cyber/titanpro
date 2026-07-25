import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, KeyRound, Smartphone, Trash2, RefreshCw, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";

async function callJson(method: string, url: string, body?: unknown): Promise<any> {
  try {
    const res = await apiRequest(method, url, body);
    return await res.json();
  } catch (e: any) {
    const raw = (e?.message || "").toString();
    const colon = raw.indexOf(":");
    let msg = raw;
    if (colon >= 0) {
      try { msg = JSON.parse(raw.slice(colon + 1).trim()).error || raw; } catch { /* keep raw */ }
    }
    throw new Error(msg);
  }
}

interface TrustedDevice {
  id: number;
  label: string | null;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
}

// Client-side PIN check mirroring server validatePinStrength (server is authoritative).
function clientPinError(pin: string): string | null {
  if (!/^\d*$/.test(pin)) return "PIN must contain digits only.";
  if (pin.length < 6) return "PIN must be at least 6 digits.";
  if (pin.length > 8) return "PIN must be at most 8 digits.";
  const weak = "Avoid repeated or sequential digits.";
  if (/^(\d)\1+$/.test(pin)) return weak;
  const n = pin.length;
  for (let blk = 1; blk <= 4; blk++) {
    if (blk < n && n % blk === 0 && pin.slice(0, blk).repeat(n / blk) === pin) return weak;
  }
  const isSeq = (dir: number) => {
    for (let i = 1; i < n; i++) {
      const p = pin.charCodeAt(i - 1) - 48, c = pin.charCodeAt(i) - 48;
      if (c !== (p + dir + 10) % 10) return false;
    }
    return true;
  };
  if (isSeq(1) || isSeq(-1)) return weak;
  return null;
}

function fmt(d: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return d; }
}

export default function Security() {
  const { user, refreshUser } = useAuth();

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">Security</h1>
        <p className="text-sm text-muted-foreground">Manage two-factor authentication, trusted devices, and your credentials.</p>
      </div>
      <TwoFactorSection user={user} refreshUser={refreshUser} />
      <TrustedDevicesSection />
      <CredentialsSection mustChangePin={!!user?.mustChangePin} refreshUser={refreshUser} />
    </div>
  );
}

function TwoFactorSection({ user, refreshUser }: { user: any; refreshUser: () => Promise<void> }) {
  const enabled = !!user?.twoFactorEnabled;
  const remaining = user?.backupCodesRemaining ?? 0;

  const [showReset, setShowReset] = useState(false);
  const [resetPw, setResetPw] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [showRegen, setShowRegen] = useState(false);
  const [regenCode, setRegenCode] = useState("");
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const doReset = async () => {
    setError(""); setBusy(true);
    try {
      await callJson("POST", "/api/auth/2fa/disable", { currentPassword: resetPw, code: resetCode });
      setShowReset(false); setResetPw(""); setResetCode("");
      // twoFactorEnabled → false triggers the force-enrollment gate.
      await refreshUser();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const doRegen = async () => {
    setError(""); setBusy(true);
    try {
      const data = await callJson("POST", "/api/auth/2fa/backup-codes/regenerate", { code: regenCode });
      setNewBackupCodes(data.backupCodes);
      setShowRegen(false); setRegenCode("");
      await refreshUser();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[hsl(var(--titan-blue))]" /> Two-factor authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="flex items-center gap-2">
          {enabled
            ? <Badge className="bg-green-600 text-white">Enabled</Badge>
            : <Badge variant="outline" className="text-muted-foreground">Not enabled</Badge>}
          {enabled && user?.twoFactorEnrolledAt && (
            <span className="text-xs text-muted-foreground">since {fmt(user.twoFactorEnrolledAt)}</span>
          )}
        </div>

        {enabled && (
          <p className="text-xs text-muted-foreground">
            Backup codes remaining: <span className="font-semibold">{remaining} of 10</span>
          </p>
        )}

        {newBackupCodes && (
          <div className="space-y-2">
            <p className="text-xs font-semibold">Your new backup codes (shown once):</p>
            <div className="grid grid-cols-2 gap-2 bg-muted rounded-lg p-3 font-mono text-sm">
              {newBackupCodes.map(c => <div key={c} className="text-center py-1 tracking-wider">{c}</div>)}
            </div>
            <Button size="sm" variant="outline" onClick={() => setNewBackupCodes(null)}>Done</Button>
          </div>
        )}

        {error && <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">{error}</div>}

        {enabled && !showReset && !showRegen && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => { setShowRegen(true); setError(""); }} data-testid="button-regen-backup">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Regenerate backup codes
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => { setShowReset(true); setError(""); }} data-testid="button-reset-2fa">
              <KeyRound className="w-3.5 h-3.5 mr-1.5" /> Reset & re-enroll
            </Button>
          </div>
        )}

        {showRegen && (
          <div className="space-y-2 border rounded-lg p-3">
            <p className="text-xs font-semibold">Enter a current authenticator code to regenerate</p>
            <Input className="h-9 text-sm" inputMode="numeric" maxLength={6} placeholder="000000" value={regenCode} onChange={e => setRegenCode(e.target.value.replace(/\D/g, ""))} />
            <div className="flex gap-2">
              <Button size="sm" className="bg-[hsl(var(--titan-blue))] text-white" disabled={busy || regenCode.length < 6} onClick={doRegen}>Regenerate</Button>
              <Button size="sm" variant="outline" onClick={() => { setShowRegen(false); setRegenCode(""); }}>Cancel</Button>
            </div>
          </div>
        )}

        {showReset && (
          <div className="space-y-2 border rounded-lg p-3">
            <p className="text-xs font-semibold">Reset 2FA — you'll be required to re-enroll immediately.</p>
            <div>
              <Label className="text-xs">Current password</Label>
              <Input className="h-9 text-sm mt-1" type="password" value={resetPw} onChange={e => setResetPw(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Authenticator code</Label>
              <Input className="h-9 text-sm mt-1" inputMode="numeric" maxLength={6} placeholder="000000" value={resetCode} onChange={e => setResetCode(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="bg-[hsl(var(--titan-red))] text-white" disabled={busy || !resetPw || resetCode.length < 6} onClick={doReset}>Reset 2FA</Button>
              <Button size="sm" variant="outline" onClick={() => { setShowReset(false); setResetPw(""); setResetCode(""); }}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TrustedDevicesSection() {
  const [busy, setBusy] = useState(false);
  const { data: devices = [], isLoading } = useQuery<TrustedDevice[]>({
    queryKey: ["/api/auth/2fa/trusted-devices"],
    queryFn: () => apiRequest("GET", "/api/auth/2fa/trusted-devices").then(r => r.json()),
  });

  const revoke = async (id: number) => {
    setBusy(true);
    try { await apiRequest("DELETE", `/api/auth/2fa/trusted-devices/${id}`); }
    finally { setBusy(false); queryClient.invalidateQueries({ queryKey: ["/api/auth/2fa/trusted-devices"] }); }
  };
  const revokeAll = async () => {
    setBusy(true);
    try { await apiRequest("DELETE", "/api/auth/2fa/trusted-devices"); }
    finally { setBusy(false); queryClient.invalidateQueries({ queryKey: ["/api/auth/2fa/trusted-devices"] }); }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Smartphone className="w-4 h-4 text-[hsl(var(--titan-blue))]" /> Trusted devices
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <p className="text-xs text-muted-foreground">
          Devices where you chose "Remember this device for 30 days" skip the 2FA code at login.
        </p>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No trusted devices.</p>
        ) : (
          <div className="border rounded-lg divide-y">
            {devices.map(d => (
              <div key={d.id} className="flex items-center gap-3 p-3 text-xs">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{d.label || "Unknown device"}</p>
                  <p className="text-muted-foreground">
                    {d.ip || "—"} · added {fmt(d.createdAt)} · expires {fmt(d.expiresAt)}
                  </p>
                </div>
                <button
                  onClick={() => revoke(d.id)}
                  disabled={busy}
                  className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  title="Revoke"
                  data-testid={`button-revoke-device-${d.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {devices.length > 0 && (
          <Button size="sm" variant="outline" className="text-destructive" disabled={busy} onClick={revokeAll} data-testid="button-revoke-all-devices">
            Sign out of all trusted devices
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function CredentialsSection({ mustChangePin, refreshUser }: { mustChangePin: boolean; refreshUser: () => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const pinErr = newPin ? clientPinError(newPin) : null;

  const save = async () => {
    if (newPin && pinErr) { setError(pinErr); return; }
    setMsg(""); setError(""); setBusy(true);
    try {
      await callJson("POST", "/api/auth/change-password", {
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
        newPin: newPin || undefined,
      });
      setMsg("Credentials updated.");
      setCurrentPassword(""); setNewPassword(""); setNewPin("");
      await refreshUser();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Lock className="w-4 h-4 text-[hsl(var(--titan-blue))]" /> Change password / PIN
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {mustChangePin && (
          <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Your PIN is using an outdated default. Please set a new 6–8 digit PIN below.
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Current password</Label>
            <Input className="h-9 text-sm mt-1" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">New password</Label>
            <Input className="h-9 text-sm mt-1" type="password" placeholder="Min 8, letters + numbers" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">New PIN</Label>
            <Input className="h-9 text-sm mt-1" type="password" maxLength={8} placeholder="6–8 digits" value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, ""))} />
            {pinErr && <p className="text-[11px] text-muted-foreground mt-1">{pinErr}</p>}
          </div>
        </div>
        {msg && <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{msg}</div>}
        {error && <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">{error}</div>}
        <Button size="sm" className="bg-[hsl(var(--titan-blue))] text-white" disabled={busy || (!newPassword && !newPin) || (!!newPin && !!pinErr)} onClick={save}>
          Save changes
        </Button>
      </CardContent>
    </Card>
  );
}
