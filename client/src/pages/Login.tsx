import { useEffect, useState } from "react";
import titanLogo from "@/assets/titan-logo.png";
import { useAuth, AuthUser, TRUSTED_DEVICE_KEY } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, Smartphone, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { SiGmail, SiQuickbooks, SiStripe } from "react-icons/si";
import TwoFactorSetup from "@/components/TwoFactorSetup";

// The Quick PIN kiosk fetches its name list live from /api/auth/pin-users so
// it mirrors User Management: adding, deactivating, or deleting a user there
// updates this picker instantly. Only names + initials are returned — no roles,
// emails, or 2FA state — so the endpoint is safe to expose unauthenticated.
type PinUser = { name: string; avatarInitials: string };

function readTrustedDeviceToken(): string {
  try { return localStorage.getItem(TRUSTED_DEVICE_KEY) || ""; } catch { return ""; }
}
function saveTrustedDeviceToken(tok: string) {
  try { localStorage.setItem(TRUSTED_DEVICE_KEY, tok); } catch { /* ignore */ }
}

// Extracts the server's `{ error }` message from the string apiRequest throws.
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

// Client-side PIN check mirroring server validatePinStrength. The server is the
// source of truth; this just gives quick inline feedback.
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

type Step = "credentials" | "2fa-setup" | "2fa-challenge" | "pin-change-required";

export default function Login() {
  const { applySession } = useAuth();
  const [mode, setMode] = useState<"web" | "pin">("web");
  const [step, setStep] = useState<Step>("credentials");

  // Web (email/username + password) state
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Quick PIN state (field crews)
  const [pinName, setPinName] = useState("");
  const [pin, setPin] = useState("");

  // Live PIN name list from /api/auth/pin-users. Refetched every 30s and each
  // time the user opens the PIN tab, so admin actions in User Management show
  // up here without a full-page reload.
  const [pinUsers, setPinUsers] = useState<PinUser[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiRequest("GET", "/api/auth/pin-users");
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) setPinUsers(data);
      } catch { /* silent — keeps last-known list visible */ }
    };
    load();
    const iv = window.setInterval(load, 30_000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, [mode]);

  // 2FA flow state
  const [setupToken, setSetupToken] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [twoFACode, setTwoFACode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);

  // Forced PIN-change flow state
  const [pinChangeToken, setPinChangeToken] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const finish = (token: string, employee: AuthUser) => applySession(token, employee);

  const handleWebSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const data = await callJson("POST", "/api/auth/login", {
        identifier: identifier.trim(),
        password: password.trim(),
        trustedDeviceToken: readTrustedDeviceToken(),
      });
      if (data.requires2FASetup) {
        setSetupToken(data.setupToken);
        setStep("2fa-setup");
      } else if (data.requires2FA) {
        setChallengeToken(data.challengeToken);
        setStep("2fa-challenge");
      } else if (data.token) {
        finish(data.token, data.employee);
      } else {
        setError("Unexpected login response.");
      }
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinName.trim() || !pin.trim()) {
      setError("Select your name and enter your PIN.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      // PIN logins skip 2FA entirely (field techs on shared tablets), but a stale
      // or weak PIN triggers a forced compliant-PIN reset before a session issues.
      const data = await callJson("POST", "/api/auth/login", {
        name: pinName.trim(),
        pin: pin.trim(),
      });
      if (data.requiresPinChange) {
        setPinChangeToken(data.pinChangeToken);
        setStep("pin-change-required");
      } else if (data.token) {
        finish(data.token, data.employee);
      } else {
        setError("Unexpected login response.");
      }
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleForcedPinChange = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = clientPinError(newPin);
    if (err) { setError(err); return; }
    if (newPin !== confirmPin) { setError("PINs do not match."); return; }
    setError("");
    setLoading(true);
    try {
      const data = await callJson("POST", "/api/auth/pin/change-forced", { pinChangeToken, newPin });
      finish(data.token, data.employee);
    } catch (err: any) {
      setError(err.message || "Could not update PIN");
    } finally {
      setLoading(false);
    }
  };

  const handle2FAVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFACode.trim()) { setError("Enter your code."); return; }
    setError("");
    setLoading(true);
    try {
      const data = await callJson("POST", "/api/auth/2fa/verify", {
        challengeToken,
        code: twoFACode.trim(),
        rememberDevice,
      });
      if (data.trustedDeviceToken) saveTrustedDeviceToken(data.trustedDeviceToken);
      finish(data.token, data.employee);
    } catch (err: any) {
      setError(err.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const backToCredentials = () => {
    setStep("credentials");
    setError("");
    setTwoFACode("");
    setUseBackupCode(false);
    setChallengeToken("");
    setSetupToken("");
    setPinChangeToken("");
    setNewPin("");
    setConfirmPin("");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo / Brand */}
        <div className="text-center space-y-2">
          <div className="w-20 h-20 flex items-center justify-center mx-auto">
            <img src={titanLogo} alt="Titan Restoration" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Titan Pro</h1>
            <p className="text-xs text-muted-foreground">Titan Restoration LLC · Sign in to your account</p>
          </div>
        </div>

        <Card className="border shadow-md">
          <CardContent className="pt-6 space-y-4">
            {step === "pin-change-required" ? (
              <form onSubmit={handleForcedPinChange} className="space-y-4">
                <div className="text-center space-y-1">
                  <Lock className="w-8 h-8 text-[hsl(var(--titan-blue))] mx-auto" />
                  <h2 className="text-lg font-bold">Update your PIN</h2>
                  <p className="text-xs text-muted-foreground">
                    Your PIN needs to be updated for security. Please choose a new 6–8 digit PIN.
                  </p>
                </div>

                <div>
                  <Label htmlFor="new-pin" className="text-xs font-medium mb-1.5 block">New PIN</Label>
                  <Input
                    id="new-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    placeholder="6–8 digits"
                    value={newPin}
                    onChange={e => setNewPin(e.target.value.replace(/\D/g, ""))}
                    className="text-center tracking-widest text-base h-10"
                    autoFocus
                    data-testid="input-new-pin"
                  />
                </div>

                <div>
                  <Label htmlFor="confirm-pin" className="text-xs font-medium mb-1.5 block">Confirm new PIN</Label>
                  <Input
                    id="confirm-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    placeholder="Re-enter PIN"
                    value={confirmPin}
                    onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                    className="text-center tracking-widest text-base h-10"
                    data-testid="input-confirm-pin"
                  />
                </div>

                {newPin && clientPinError(newPin) && (
                  <p className="text-xs text-muted-foreground text-center">{clientPinError(newPin)}</p>
                )}

                {error && (
                  <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2 text-center" data-testid="text-login-error">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white font-semibold h-10"
                  disabled={loading || !!clientPinError(newPin) || newPin !== confirmPin}
                  data-testid="button-change-pin"
                >
                  {loading ? "Updating…" : "Update PIN & sign in"}
                </Button>

                <div className="text-center text-xs">
                  <button
                    type="button"
                    onClick={() => { backToCredentials(); setMode("web"); }}
                    className="text-[hsl(var(--titan-blue))] hover:underline"
                  >
                    Sign in with password instead
                  </button>
                </div>
              </form>
            ) : step === "2fa-setup" ? (
              <TwoFactorSetup setupToken={setupToken} onComplete={finish} />
            ) : step === "2fa-challenge" ? (
              <form onSubmit={handle2FAVerify} className="space-y-4">
                <div className="text-center space-y-1">
                  <ShieldCheck className="w-8 h-8 text-[hsl(var(--titan-blue))] mx-auto" />
                  <h2 className="text-lg font-bold">Two-factor verification</h2>
                  <p className="text-xs text-muted-foreground">
                    {useBackupCode
                      ? "Enter one of your saved backup codes."
                      : "Enter the 6-digit code from your authenticator app."}
                  </p>
                </div>

                <div>
                  <Label htmlFor="twofa-code" className="text-xs font-medium mb-1.5 block">
                    {useBackupCode ? "Backup code" : "6-digit code"}
                  </Label>
                  <Input
                    id="twofa-code"
                    inputMode={useBackupCode ? "text" : "numeric"}
                    maxLength={useBackupCode ? 9 : 6}
                    placeholder={useBackupCode ? "xxxx-xxxx" : "000000"}
                    value={twoFACode}
                    onChange={e => setTwoFACode(useBackupCode ? e.target.value : e.target.value.replace(/\D/g, ""))}
                    className="text-center tracking-[0.4em] text-lg h-11"
                    autoFocus
                    data-testid="input-2fa-code"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={e => setRememberDevice(e.target.checked)}
                    className="rounded border-input"
                    data-testid="checkbox-remember-device"
                  />
                  Remember this device for 30 days
                </label>

                {error && (
                  <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2 text-center" data-testid="text-login-error">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white font-semibold h-10"
                  disabled={loading || !twoFACode.trim()}
                  data-testid="button-verify-2fa"
                >
                  {loading ? "Verifying…" : "Verify"}
                </Button>

                <div className="flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => { setUseBackupCode(v => !v); setTwoFACode(""); setError(""); }}
                    className="text-[hsl(var(--titan-blue))] hover:underline"
                    data-testid="button-toggle-backup"
                  >
                    {useBackupCode ? "Use authenticator code" : "Use a backup code instead"}
                  </button>
                  <button type="button" onClick={backToCredentials} className="text-muted-foreground hover:underline">
                    Back
                  </button>
                </div>
              </form>
            ) : (
              <>
                {/* Mode toggle: Web login (default) vs Quick PIN for field crews */}
                <div className="flex rounded-lg border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => { setMode("web"); setError(""); }}
                    className={`flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${mode === "web" ? "bg-[hsl(var(--titan-blue))] text-white" : "text-muted-foreground hover:bg-muted"}`}
                    data-testid="tab-web-login"
                  >
                    <Mail className="w-3.5 h-3.5" /> Email login
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode("pin"); setError(""); }}
                    className={`flex-1 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${mode === "pin" ? "bg-[hsl(var(--titan-blue))] text-white" : "text-muted-foreground hover:bg-muted"}`}
                    data-testid="tab-pin-login"
                  >
                    <Smartphone className="w-3.5 h-3.5" /> Quick PIN
                  </button>
                </div>

                {mode === "web" ? (
                  <form onSubmit={handleWebSubmit} className="space-y-4">
                    <div>
                      <Label htmlFor="login-email" className="text-xs font-medium mb-1.5 block">Email</Label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                        <Input
                          id="login-email"
                          type="email"
                          autoComplete="username"
                          placeholder="you@titanaugusta.com"
                          value={identifier}
                          onChange={e => setIdentifier(e.target.value)}
                          className="pl-9 h-10"
                          data-testid="input-login-email"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="login-password" className="text-xs font-medium mb-1.5 block">Password</Label>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                        <Input
                          id="login-password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          placeholder="Enter your password"
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          className="pl-9 pr-9 h-10"
                          data-testid="input-login-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(s => !s)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          data-testid="button-toggle-password"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {error && (
                      <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2 text-center" data-testid="text-login-error">
                        {error}
                      </div>
                    )}

                    <Button
                      type="submit"
                      className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white font-semibold h-10"
                      disabled={loading || !identifier.trim() || !password.trim()}
                      data-testid="button-login"
                    >
                      {loading ? "Signing in…" : "Sign In"}
                    </Button>
                  </form>
                ) : (
                  <form onSubmit={handlePinSubmit} className="space-y-4">
                    <div>
                      <Label className="text-xs font-medium mb-2 block">Select your name</Label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {pinUsers.length === 0 ? (
                          <div className="col-span-2 text-xs text-muted-foreground py-2">
                            No active team members. Ask an owner to add you in User Management.
                          </div>
                        ) : (
                          pinUsers.map(u => (
                            <button
                              key={u.name}
                              type="button"
                              onClick={() => setPinName(u.name)}
                              className={`text-xs px-2.5 py-2 rounded-lg border text-left font-medium transition-colors ${
                                pinName === u.name
                                  ? "bg-[hsl(var(--titan-blue))] text-white border-[hsl(var(--titan-blue))]"
                                  : "border-border hover:border-[hsl(var(--titan-blue)/0.5)] hover:bg-[hsl(var(--titan-blue)/0.05)]"
                              }`}
                              data-testid={`select-name-${u.name.replace(/\s/g, "-")}`}
                            >
                              {u.name}
                            </button>
                          ))
                        )}
                      </div>
                      <Input
                        className="mt-2 h-8 text-xs"
                        placeholder="Or type a name…"
                        value={pinName}
                        onChange={e => setPinName(e.target.value)}
                        data-testid="input-login-name"
                      />
                    </div>

                    <div>
                      <Label htmlFor="login-pin" className="text-xs font-medium mb-1.5 block">PIN</Label>
                      <Input
                        id="login-pin"
                        type="password"
                        maxLength={8}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="••••••"
                        value={pin}
                        onChange={e => setPin(e.target.value)}
                        className="text-center tracking-widest text-base h-10"
                        data-testid="input-login-pin"
                        autoComplete="current-password"
                      />
                      <p className="text-xs text-muted-foreground mt-1 text-center">Field crews — quick kiosk sign-in. Change your PIN in Settings.</p>
                    </div>

                    {error && (
                      <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2 text-center" data-testid="text-login-error">
                        {error}
                      </div>
                    )}

                    <Button
                      type="submit"
                      className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white font-semibold h-10"
                      disabled={loading || !pinName.trim() || !pin.trim()}
                      data-testid="button-login-pin"
                    >
                      {loading ? "Signing in…" : "Sign In"}
                    </Button>
                  </form>
                )}
              </>
            )}

            <div className="pt-2 border-t text-center">
              <p className="text-xs text-muted-foreground">
                Need access? Contact Cody at{" "}
                <a href="tel:7069220154" className="text-[hsl(var(--titan-red))] hover:underline font-medium">706-922-0154</a>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* "Runs on" integration strip — quietly sells the connected-tools story.
            Ported from the 2026-07-23 Command Center login. Purely decorative. */}
        <div className="titan-runson" aria-hidden="true">
          <span className="titan-runson-label">Unifies</span>
          <SiGmail /><SiQuickbooks /><SiStripe />
          <span className="titan-runson-word">Xactimate</span>
          <span className="titan-runson-word">CompanyCam</span>
          <span className="titan-runson-word">Ramp</span>
        </div>

        {/* Proprietary / copyright footer */}
        <p className="mt-5 text-center text-[10px] leading-relaxed text-muted-foreground">
          © 2026 Titan Restoration LLC. All rights reserved.<br />
          Proprietary and confidential software. <a href="#/terms" className="hover:underline">Terms of Service</a>
        </p>
      </div>

      {/* Scoped styles for the integration strip (ported from recovery Login) */}
      <style>{`
        .titan-runson {
          display: flex; align-items: center; justify-content: center; gap: 16px;
          margin-top: 20px; opacity: 0.55; color: #7c90b2; font-size: 18px;
          flex-wrap: wrap;
        }
        .titan-runson-label {
          font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: #5f748f;
        }
        .titan-runson-word {
          font-size: 11px; font-weight: 700; letter-spacing: -0.01em;
        }
      `}</style>
    </div>
  );
}
