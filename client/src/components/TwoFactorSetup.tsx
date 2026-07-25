import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { AuthUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Check, ShieldCheck, Smartphone } from "lucide-react";

// Extracts the server's `{ error }` message out of the string apiRequest throws
// ("<status>: <raw body>") so we can surface a friendly message.
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

export default function TwoFactorSetup({
  setupToken,
  onComplete,
}: {
  setupToken: string;
  onComplete: (token: string, employee: AuthUser) => void;
}) {
  const [secret, setSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [session, setSession] = useState<{ token: string; employee: AuthUser } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await callJson("POST", "/api/auth/2fa/setup/start", { setupToken });
        if (cancelled) return;
        setSecret(data.secret);
        setQrDataUrl(data.qrDataUrl);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Could not start setup.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [setupToken]);

  const copySecret = async () => {
    try { await navigator.clipboard.writeText(secret); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 6) { setError("Enter the 6-digit code from your app."); return; }
    setError("");
    setVerifying(true);
    try {
      const data = await callJson("POST", "/api/auth/2fa/setup/verify", { setupToken, code: code.trim() });
      setBackupCodes(data.backupCodes);
      setSession({ token: data.token, employee: data.employee });
    } catch (e: any) {
      setError(e.message || "Verification failed.");
    } finally {
      setVerifying(false);
    }
  };

  // Step 2 — show backup codes once, then finish.
  if (backupCodes && session) {
    return (
      <div className="space-y-4">
        <div className="text-center space-y-1">
          <ShieldCheck className="w-8 h-8 text-green-600 mx-auto" />
          <h2 className="text-lg font-bold">Save your backup codes</h2>
          <p className="text-xs text-muted-foreground">
            Each code works once if you lose your phone. Store them somewhere safe — they won't be shown again.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 bg-muted rounded-lg p-3 font-mono text-sm" data-testid="backup-codes">
          {backupCodes.map((c) => (
            <div key={c} className="text-center py-1 tracking-wider">{c}</div>
          ))}
        </div>
        <Button
          className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white font-semibold"
          onClick={() => onComplete(session.token, session.employee)}
          data-testid="button-backup-continue"
        >
          I've saved these — continue
        </Button>
      </div>
    );
  }

  // Step 1 — QR + secret + code entry.
  return (
    <div className="space-y-4">
      <div className="text-center space-y-1">
        <Smartphone className="w-8 h-8 text-[hsl(var(--titan-blue))] mx-auto" />
        <h2 className="text-lg font-bold">Set up two-factor authentication</h2>
        <p className="text-xs text-muted-foreground">
          Scan this QR code with Google Authenticator or Microsoft Authenticator, then enter the 6-digit code.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-6">Generating your secret…</p>
      ) : (
        <>
          {qrDataUrl && (
            <div className="flex justify-center">
              <img src={qrDataUrl} alt="2FA QR code" className="w-44 h-44 border rounded-lg" data-testid="qr-code" />
            </div>
          )}
          <div>
            <Label className="text-xs font-medium mb-1 block">Or enter this key manually</Label>
            <div className="flex gap-2">
              <Input readOnly value={secret} className="h-9 text-xs font-mono" data-testid="secret-text" />
              <Button type="button" variant="outline" size="sm" onClick={copySecret} className="h-9 shrink-0" data-testid="button-copy-secret">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          <form onSubmit={verify} className="space-y-3">
            <div>
              <Label htmlFor="setup-code" className="text-xs font-medium mb-1 block">6-digit code</Label>
              <Input
                id="setup-code"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="text-center tracking-[0.5em] text-lg h-11"
                data-testid="input-setup-code"
              />
            </div>
            {error && (
              <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2 text-center" data-testid="text-setup-error">
                {error}
              </div>
            )}
            <Button
              type="submit"
              className="w-full bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red-dark))] text-white font-semibold h-10"
              disabled={verifying || code.length < 6}
              data-testid="button-verify-setup"
            >
              {verifying ? "Verifying…" : "Verify & enable"}
            </Button>
          </form>
        </>
      )}
      {error && !loading && !qrDataUrl && (
        <div className="text-xs text-destructive text-center" data-testid="text-setup-error">{error}</div>
      )}
    </div>
  );
}
