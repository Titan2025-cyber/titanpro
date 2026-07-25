import { useEffect, useState } from "react";
import titanLogo from "@/assets/titan-logo.png";
import { apiRequest } from "@/lib/queryClient";
import { useAuth, AuthUser } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import TwoFactorSetup from "@/components/TwoFactorSetup";

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

// Full-screen, non-dismissable enrollment gate. Shown when a logged-in user has no
// 2FA configured (e.g. a cached session from before 2FA became mandatory).
export default function ForceEnroll2FA() {
  const { applySession, logout } = useAuth();
  const [setupToken, setSetupToken] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await callJson("POST", "/api/auth/2fa/enroll/token");
        if (!cancelled) setSetupToken(data.setupToken);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Could not start enrollment.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onComplete = (token: string, employee: AuthUser) => applySession(token, employee);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 flex items-center justify-center mx-auto">
            <img src={titanLogo} alt="Titan Restoration" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Two-factor required</h1>
            <p className="text-xs text-muted-foreground">
              Titan Pro now requires two-factor authentication for all staff. Set it up to continue.
            </p>
          </div>
        </div>

        <Card className="border shadow-md">
          <CardContent className="pt-6 space-y-4">
            {error ? (
              <p className="text-sm text-destructive text-center">{error}</p>
            ) : setupToken ? (
              <TwoFactorSetup setupToken={setupToken} onComplete={onComplete} />
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">Preparing enrollment…</p>
            )}
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
