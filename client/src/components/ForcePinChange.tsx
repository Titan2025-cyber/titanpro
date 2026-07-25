import { useState } from "react";
import titanLogo from "@/assets/titan-logo.png";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";

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

// Full-screen, non-dismissable gate. Defensive fallback for a logged-in user whose
// PIN is flagged must_change_pin but who reached the app without the forced-change
// login step (e.g. a cached session). Lower priority than the 2FA gate.
export default function ForcePinChange() {
  const { logout, refreshUser } = useAuth();
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = clientPinError(newPin);
    if (err) { setError(err); return; }
    if (newPin !== confirmPin) { setError("PINs do not match."); return; }
    setError(""); setLoading(true);
    try {
      await callJson("POST", "/api/auth/change-password", { newPin });
      await refreshUser(); // mustChangePin now false → gate clears
    } catch (e: any) {
      setError(e.message || "Could not update PIN");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 flex items-center justify-center mx-auto">
            <img src={titanLogo} alt="Titan Restoration" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Update your PIN</h1>
            <p className="text-xs text-muted-foreground">
              Your PIN is using an outdated default. Please set a new 6–8 digit PIN to continue.
            </p>
          </div>
        </div>

        <Card className="border shadow-md">
          <CardContent className="pt-6 space-y-4">
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="fp-new-pin" className="text-xs font-medium mb-1.5 block">New PIN</Label>
                <Input
                  id="fp-new-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="6–8 digits"
                  value={newPin}
                  onChange={e => setNewPin(e.target.value.replace(/\D/g, ""))}
                  className="text-center tracking-widest text-base h-10"
                  autoFocus
                  data-testid="input-force-new-pin"
                />
              </div>
              <div>
                <Label htmlFor="fp-confirm-pin" className="text-xs font-medium mb-1.5 block">Confirm new PIN</Label>
                <Input
                  id="fp-confirm-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="Re-enter PIN"
                  value={confirmPin}
                  onChange={e => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                  className="text-center tracking-widest text-base h-10"
                  data-testid="input-force-confirm-pin"
                />
              </div>

              {newPin && clientPinError(newPin) && (
                <p className="text-xs text-muted-foreground text-center">{clientPinError(newPin)}</p>
              )}
              {error && (
                <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2 text-center">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white font-semibold h-10"
                disabled={loading || !!clientPinError(newPin) || newPin !== confirmPin}
                data-testid="button-force-change-pin"
              >
                <Lock className="w-4 h-4 mr-1.5" /> {loading ? "Updating…" : "Update PIN"}
              </Button>
            </form>
            <div className="pt-2 border-t text-center">
              <button onClick={() => logout()} className="text-xs text-muted-foreground hover:underline">
                Sign out
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
