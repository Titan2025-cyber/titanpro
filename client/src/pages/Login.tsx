import { useState } from "react";
import titanLogo from "@/assets/titan-logo.png";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, Smartphone, Eye, EyeOff } from "lucide-react";

// Field crews who use the quick 4-digit PIN kiosk flow instead of typing an email
const FIELD_TEAM = ["Cody Brantley", "John Eisenhower", "Justin Maddox", "Kalobe Hedden", "Blake Foster"];

export default function Login() {
  const { loginWeb, login } = useAuth();
  const [mode, setMode] = useState<"web" | "pin">("web");

  // Web (email/username + password) state
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Quick PIN state (field crews)
  const [pinName, setPinName] = useState("");
  const [pin, setPin] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleWebSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await loginWeb(identifier.trim(), password.trim());
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
      await login(pinName.trim(), pin.trim(), true);
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
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
                    {FIELD_TEAM.map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPinName(n)}
                        className={`text-xs px-2.5 py-2 rounded-lg border text-left font-medium transition-colors ${
                          pinName === n
                            ? "bg-[hsl(var(--titan-blue))] text-white border-[hsl(var(--titan-blue))]"
                            : "border-border hover:border-[hsl(var(--titan-blue)/0.5)] hover:bg-[hsl(var(--titan-blue)/0.05)]"
                        }`}
                        data-testid={`select-name-${n.replace(/\s/g, "-")}`}
                      >
                        {n}
                      </button>
                    ))}
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
                  <Label htmlFor="login-pin" className="text-xs font-medium mb-1.5 block">4-Digit PIN</Label>
                  <Input
                    id="login-pin"
                    type="password"
                    maxLength={6}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="••••"
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

            <div className="pt-2 border-t text-center">
              <p className="text-xs text-muted-foreground">
                Need access? Contact Cody at{" "}
                <a href="tel:7069220154" className="text-[hsl(var(--titan-red))] hover:underline font-medium">706-922-0154</a>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Proprietary / copyright footer */}
        <p className="mt-5 text-center text-[10px] leading-relaxed text-muted-foreground">
          © 2026 Titan Restoration LLC. All rights reserved.<br />
          Proprietary and confidential software. <a href="#/terms" className="hover:underline">Terms of Service</a>
        </p>
      </div>
    </div>
  );
}
