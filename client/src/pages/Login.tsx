import { useState } from "react";
import titanLogo from "@/assets/titan-logo.png";
import { useAuth } from "@/lib/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, Smartphone, Eye, EyeOff } from "lucide-react";
import { SiGmail, SiQuickbooks, SiStripe, SiIntuit } from "react-icons/si";

// Field crews who use the quick 4-digit PIN kiosk flow instead of typing an email
const FIELD_TEAM = ["Cody Brantley", "John Eisenhower", "Justin Maddox", "Kalobe Hedden", "Blake Foster"];

// ── Integration "constellation" — the tools Titan Pro unifies. Rendered faded &
//    desaturated, drifting slowly behind the login card (Command Center style).
//    Icons where a brand glyph exists; clean wordmarks for the niche vendors.
type Mark = { node: React.ReactNode; label: string };
const IntegrationMarks: Mark[] = [
  { label: "Gmail", node: <SiGmail /> },
  { label: "QuickBooks", node: <SiQuickbooks /> },
  { label: "Stripe", node: <SiStripe /> },
  { label: "Intuit", node: <SiIntuit /> },
  { label: "Xactimate", node: <span className="tp-wordmark">Xactimate</span> },
  { label: "CompanyCam", node: <span className="tp-wordmark">CompanyCam</span> },
  { label: "Ramp", node: <span className="tp-wordmark">ramp</span> },
  { label: "Slack", node: <span className="tp-wordmark">slack</span> },
  { label: "DocuSketch", node: <span className="tp-wordmark">DocuSketch</span> },
];

// Fixed positions + per-mark drift/scale/delay so the field feels organic, not gridded.
const MARK_LAYOUT = [
  { top: "12%", left: "10%", size: 46, dur: 17, delay: 0,   drift: 14 },
  { top: "20%", left: "78%", size: 40, dur: 21, delay: 2.5, drift: 18 },
  { top: "68%", left: "8%",  size: 52, dur: 19, delay: 1.2, drift: 16 },
  { top: "80%", left: "72%", size: 44, dur: 23, delay: 3.1, drift: 20 },
  { top: "38%", left: "88%", size: 38, dur: 20, delay: 0.8, drift: 12 },
  { top: "58%", left: "90%", size: 42, dur: 24, delay: 2.0, drift: 22 },
  { top: "86%", left: "40%", size: 40, dur: 18, delay: 1.7, drift: 14 },
  { top: "8%",  left: "44%", size: 44, dur: 22, delay: 3.4, drift: 18 },
  { top: "48%", left: "4%",  size: 46, dur: 20, delay: 0.4, drift: 16 },
];

function LoginBackdrop() {
  return (
    <div className="tp-backdrop" aria-hidden="true">
      {/* Aurora accent blobs (Titan red + blue) */}
      <div className="tp-aurora tp-aurora-red" />
      <div className="tp-aurora tp-aurora-blue" />
      {/* Fine grid for a "control room" texture */}
      <div className="tp-grid" />
      {/* Integration constellation */}
      <div className="tp-constellation">
        {MARK_LAYOUT.map((p, i) => {
          const m = IntegrationMarks[i % IntegrationMarks.length];
          return (
            <div
              key={m.label}
              className="tp-mark"
              title={m.label}
              style={{
                top: p.top,
                left: p.left,
                fontSize: p.size,
                // custom props consumed by the keyframes
                ["--drift" as any]: `${p.drift}px`,
                ["--dur" as any]: `${p.dur}s`,
                ["--delay" as any]: `${p.delay}s`,
              }}
            >
              {m.node}
            </div>
          );
        })}
      </div>
      {/* Vignette to focus the eye on the card */}
      <div className="tp-vignette" />
    </div>
  );
}

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
    <div className="tp-login-root">
      <LoginStyles />
      <LoginBackdrop />

      <div className="tp-login-shell">
        {/* Logo / Brand */}
        <div className="text-center" style={{ marginBottom: 22 }}>
          <div className="tp-logo-halo">
            <img src={titanLogo} alt="Titan Restoration" className="tp-logo-img" />
          </div>
          <h1 className="tp-title">Titan Pro</h1>
          <p className="tp-subtitle">Titan Restoration LLC · Command Center</p>
        </div>

        {/* Glass login card */}
        <div className="tp-card">
          <div className="tp-card-inner">
            {/* Mode toggle: Web login (default) vs Quick PIN for field crews */}
            <div className="tp-toggle">
              <button
                type="button"
                onClick={() => { setMode("web"); setError(""); }}
                className={`tp-toggle-btn ${mode === "web" ? "is-active" : ""}`}
                data-testid="tab-web-login"
              >
                <Mail className="w-3.5 h-3.5" /> Email login
              </button>
              <button
                type="button"
                onClick={() => { setMode("pin"); setError(""); }}
                className={`tp-toggle-btn ${mode === "pin" ? "is-active" : ""}`}
                data-testid="tab-pin-login"
              >
                <Smartphone className="w-3.5 h-3.5" /> Quick PIN
              </button>
            </div>

            {mode === "web" ? (
              <form onSubmit={handleWebSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="login-email" className="tp-label">Email</Label>
                  <div className="relative">
                    <Mail className="w-4 h-4 tp-input-icon" />
                    <Input
                      id="login-email"
                      type="email"
                      autoComplete="username"
                      placeholder="you@titanaugusta.com"
                      value={identifier}
                      onChange={e => setIdentifier(e.target.value)}
                      className="tp-input pl-9 h-10"
                      data-testid="input-login-email"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="login-password" className="tp-label">Password</Label>
                  <div className="relative">
                    <Lock className="w-4 h-4 tp-input-icon" />
                    <Input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="tp-input pl-9 pr-9 h-10"
                      data-testid="input-login-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(s => !s)}
                      className="tp-eye"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      data-testid="button-toggle-password"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="tp-error" data-testid="text-login-error">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  className="tp-cta"
                  disabled={loading || !identifier.trim() || !password.trim()}
                  data-testid="button-login"
                >
                  {loading ? "Signing in…" : "Sign In"}
                </button>
              </form>
            ) : (
              <form onSubmit={handlePinSubmit} className="space-y-4">
                <div>
                  <Label className="tp-label" style={{ marginBottom: 8 }}>Select your name</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {FIELD_TEAM.map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPinName(n)}
                        className={`tp-name-btn ${pinName === n ? "is-active" : ""}`}
                        data-testid={`select-name-${n.replace(/\s/g, "-")}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <Input
                    className="tp-input mt-2 h-8 text-xs"
                    placeholder="Or type a name…"
                    value={pinName}
                    onChange={e => setPinName(e.target.value)}
                    data-testid="input-login-name"
                  />
                </div>

                <div>
                  <Label htmlFor="login-pin" className="tp-label">4-Digit PIN</Label>
                  <Input
                    id="login-pin"
                    type="password"
                    maxLength={6}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="••••"
                    value={pin}
                    onChange={e => setPin(e.target.value)}
                    className="tp-input text-center tracking-widest text-base h-10"
                    data-testid="input-login-pin"
                    autoComplete="current-password"
                  />
                  <p className="tp-hint">Field crews — quick kiosk sign-in. Change your PIN in Settings.</p>
                </div>

                {error && (
                  <div className="tp-error" data-testid="text-login-error">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  className="tp-cta"
                  disabled={loading || !pinName.trim() || !pin.trim()}
                  data-testid="button-login-pin"
                >
                  {loading ? "Signing in…" : "Sign In"}
                </button>
              </form>
            )}

            <div className="tp-contact">
              <p>
                Need access? Contact Cody at{" "}
                <a href="tel:7069220154">706-922-0154</a>
              </p>
            </div>
          </div>
        </div>

        {/* "Runs on" integration strip — quietly sells the connected-tools story */}
        <div className="tp-runson" aria-hidden="true">
          <span className="tp-runson-label">Unifies</span>
          <SiGmail /><SiQuickbooks /><SiStripe />
          <span className="tp-runson-word">Xactimate</span>
          <span className="tp-runson-word">CompanyCam</span>
          <span className="tp-runson-word">Ramp</span>
        </div>

        {/* Proprietary / copyright footer */}
        <p className="tp-footer">
          © 2026 Titan Restoration LLC. All rights reserved.<br />
          Proprietary and confidential software.{" "}
          <a href="#/terms">Terms of Service</a> · <a href="#/privacy">Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}

// All styles scoped to the login screen only — nothing here touches the global
// theme or any other page. Kept in-component so the file is fully self-contained.
function LoginStyles() {
  return (
    <style>{`
      .tp-login-root {
        position: fixed; inset: 0; overflow: hidden;
        display: flex; align-items: center; justify-content: center;
        padding: 24px;
        background:
          radial-gradient(1200px 800px at 50% -10%, #12203a 0%, transparent 60%),
          linear-gradient(180deg, #0a0f1c 0%, #070a13 55%, #05070e 100%);
        color: #e8edf6;
      }

      /* ── Backdrop ─────────────────────────────────────────────────────── */
      .tp-backdrop { position: absolute; inset: 0; z-index: 0; }

      .tp-aurora {
        position: absolute; border-radius: 50%;
        filter: blur(90px); opacity: 0.42;
        will-change: transform;
      }
      .tp-aurora-red {
        width: 620px; height: 620px; top: -180px; left: -140px;
        background: radial-gradient(circle at 30% 30%, hsl(0 80% 52% / 0.9), transparent 70%);
        animation: tp-float-a 26s ease-in-out infinite;
      }
      .tp-aurora-blue {
        width: 680px; height: 680px; bottom: -220px; right: -160px;
        background: radial-gradient(circle at 60% 60%, hsl(215 82% 54% / 0.9), transparent 70%);
        animation: tp-float-b 30s ease-in-out infinite;
      }
      @keyframes tp-float-a {
        0%,100% { transform: translate(0,0) scale(1); }
        50%     { transform: translate(60px,40px) scale(1.08); }
      }
      @keyframes tp-float-b {
        0%,100% { transform: translate(0,0) scale(1); }
        50%     { transform: translate(-50px,-30px) scale(1.1); }
      }

      .tp-grid {
        position: absolute; inset: 0; opacity: 0.5;
        background-image:
          linear-gradient(hsl(215 40% 60% / 0.05) 1px, transparent 1px),
          linear-gradient(90deg, hsl(215 40% 60% / 0.05) 1px, transparent 1px);
        background-size: 46px 46px;
        mask-image: radial-gradient(circle at 50% 45%, #000 0%, transparent 75%);
        -webkit-mask-image: radial-gradient(circle at 50% 45%, #000 0%, transparent 75%);
      }

      .tp-constellation { position: absolute; inset: 0; }
      .tp-mark {
        position: absolute;
        color: #9fb4d6;
        opacity: 0.09;
        filter: grayscale(1) brightness(1.6);
        animation: tp-drift var(--dur, 20s) ease-in-out infinite;
        animation-delay: var(--delay, 0s);
        will-change: transform, opacity;
        display: flex; align-items: center; justify-content: center;
        user-select: none;
      }
      .tp-mark .tp-wordmark {
        font-weight: 800; letter-spacing: -0.02em;
        font-size: 0.42em; white-space: nowrap;
      }
      @keyframes tp-drift {
        0%,100% { transform: translateY(0) translateX(0); opacity: 0.06; }
        50%     { transform: translateY(calc(var(--drift) * -1)) translateX(calc(var(--drift) / 2)); opacity: 0.13; }
      }

      .tp-vignette {
        position: absolute; inset: 0; pointer-events: none;
        background: radial-gradient(680px 520px at 50% 46%, transparent 40%, rgba(3,5,10,0.55) 100%);
      }

      /* ── Shell / brand ────────────────────────────────────────────────── */
      .tp-login-shell {
        position: relative; z-index: 1;
        width: 100%; max-width: 380px;
        animation: tp-rise 0.7s cubic-bezier(0.16,1,0.3,1) both;
      }
      @keyframes tp-rise {
        from { opacity: 0; transform: translateY(16px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      .tp-logo-halo {
        width: 88px; height: 88px; margin: 0 auto 12px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 22px;
        background: radial-gradient(circle at 50% 40%, hsl(215 82% 54% / 0.18), transparent 70%);
        box-shadow: 0 0 44px hsl(215 82% 54% / 0.35), 0 0 22px hsl(0 80% 52% / 0.25);
        animation: tp-pulse 4.5s ease-in-out infinite;
      }
      @keyframes tp-pulse {
        0%,100% { box-shadow: 0 0 40px hsl(215 82% 54% / 0.30), 0 0 20px hsl(0 80% 52% / 0.20); }
        50%     { box-shadow: 0 0 60px hsl(215 82% 54% / 0.45), 0 0 30px hsl(0 80% 52% / 0.32); }
      }
      .tp-logo-img { width: 62px; height: 62px; object-fit: contain; filter: drop-shadow(0 2px 10px rgba(0,0,0,0.5)); }

      .tp-title {
        font-size: 26px; font-weight: 800; letter-spacing: -0.02em;
        background: linear-gradient(90deg, #fff 0%, #cfe0ff 60%, #ffd7d7 100%);
        -webkit-background-clip: text; background-clip: text; color: transparent;
        margin: 0;
      }
      .tp-subtitle { font-size: 12px; color: #8aa0c4; margin-top: 4px; letter-spacing: 0.02em; }

      /* ── Glass card ───────────────────────────────────────────────────── */
      .tp-card {
        position: relative; border-radius: 20px; padding: 1.4px;
        background: linear-gradient(135deg, hsl(0 80% 55% / 0.55), hsl(215 82% 55% / 0.55), transparent 80%);
        box-shadow: 0 24px 70px rgba(0,0,0,0.55);
      }
      .tp-card-inner {
        border-radius: 19px; padding: 24px;
        background: rgba(14, 20, 34, 0.72);
        backdrop-filter: blur(18px) saturate(140%);
        -webkit-backdrop-filter: blur(18px) saturate(140%);
        border: 1px solid rgba(255,255,255,0.06);
      }

      .tp-toggle {
        display: flex; border-radius: 12px; overflow: hidden;
        border: 1px solid rgba(255,255,255,0.09);
        background: rgba(255,255,255,0.03);
        margin-bottom: 18px;
      }
      .tp-toggle-btn {
        flex: 1; padding: 9px 0; font-size: 12px; font-weight: 600;
        display: flex; align-items: center; justify-content: center; gap: 6px;
        color: #8aa0c4; transition: all 0.18s ease; cursor: pointer;
        background: transparent; border: none;
      }
      .tp-toggle-btn:hover { color: #cfe0ff; background: rgba(255,255,255,0.04); }
      .tp-toggle-btn.is-active {
        color: #fff;
        background: linear-gradient(135deg, hsl(215 82% 50%), hsl(215 82% 44%));
        box-shadow: 0 4px 16px hsl(215 82% 50% / 0.4);
      }

      .tp-label { font-size: 12px; font-weight: 600; color: #a9bcda; margin-bottom: 6px; display: block; }
      .tp-input-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #6f86ab; z-index: 1; }
      .tp-eye {
        position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
        color: #6f86ab; background: none; border: none; cursor: pointer;
      }
      .tp-eye:hover { color: #cfe0ff; }

      /* Input restyle scoped to login (shadcn Input keeps its base + we override colors) */
      .tp-login-root .tp-input {
        background: rgba(255,255,255,0.05) !important;
        border: 1px solid rgba(255,255,255,0.10) !important;
        color: #eef3fb !important;
        transition: border-color 0.18s ease, box-shadow 0.18s ease;
      }
      .tp-login-root .tp-input::placeholder { color: #5f748f !important; }
      .tp-login-root .tp-input:focus,
      .tp-login-root .tp-input:focus-visible {
        border-color: hsl(215 82% 58%) !important;
        box-shadow: 0 0 0 3px hsl(215 82% 55% / 0.22) !important;
        outline: none !important;
      }

      .tp-name-btn {
        font-size: 12px; padding: 8px 10px; border-radius: 10px; text-align: left;
        font-weight: 600; cursor: pointer;
        color: #b8c8e2;
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(255,255,255,0.03);
        transition: all 0.16s ease;
      }
      .tp-name-btn:hover { border-color: hsl(215 82% 55% / 0.6); background: hsl(215 82% 55% / 0.08); }
      .tp-name-btn.is-active {
        color: #fff; border-color: hsl(215 82% 55%);
        background: linear-gradient(135deg, hsl(215 82% 50%), hsl(215 82% 44%));
      }

      .tp-hint { font-size: 11px; color: #7c90b2; margin-top: 6px; text-align: center; }

      .tp-error {
        font-size: 12px; text-align: center; border-radius: 10px; padding: 8px 12px;
        color: #ffb4b4; background: hsl(0 70% 55% / 0.12); border: 1px solid hsl(0 70% 55% / 0.35);
      }

      /* Gradient CTA with sheen */
      .tp-cta {
        position: relative; width: 100%; height: 44px; border: none; border-radius: 12px;
        font-weight: 700; font-size: 14px; color: #fff; cursor: pointer; overflow: hidden;
        background: linear-gradient(120deg, hsl(0 80% 52%) 0%, hsl(0 74% 46%) 40%, hsl(215 82% 50%) 100%);
        box-shadow: 0 10px 28px hsl(0 74% 46% / 0.35), 0 6px 20px hsl(215 82% 50% / 0.28);
        transition: transform 0.14s ease, box-shadow 0.14s ease, filter 0.14s ease;
      }
      .tp-cta::after {
        content: ""; position: absolute; top: 0; left: -60%; width: 40%; height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
        transform: skewX(-20deg); transition: left 0.5s ease;
      }
      .tp-cta:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
      .tp-cta:hover:not(:disabled)::after { left: 120%; }
      .tp-cta:active:not(:disabled) { transform: translateY(0); }
      .tp-cta:disabled { opacity: 0.5; cursor: not-allowed; }

      .tp-contact { padding-top: 14px; margin-top: 16px; border-top: 1px solid rgba(255,255,255,0.07); text-align: center; }
      .tp-contact p { font-size: 12px; color: #8aa0c4; margin: 0; }
      .tp-contact a { color: hsl(0 80% 62%); font-weight: 600; text-decoration: none; }
      .tp-contact a:hover { text-decoration: underline; }

      /* "Runs on" strip */
      .tp-runson {
        display: flex; align-items: center; justify-content: center; gap: 16px;
        margin-top: 20px; opacity: 0.55; color: #7c90b2; font-size: 18px;
        flex-wrap: wrap;
      }
      .tp-runson-label { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: #5f748f; }
      .tp-runson-word { font-size: 11px; font-weight: 700; letter-spacing: -0.01em; }

      .tp-footer { margin-top: 18px; text-align: center; font-size: 10px; line-height: 1.6; color: #5f748f; }
      .tp-footer a { color: #7c90b2; text-decoration: none; }
      .tp-footer a:hover { text-decoration: underline; }

      /* Respect reduced-motion */
      @media (prefers-reduced-motion: reduce) {
        .tp-aurora, .tp-mark, .tp-logo-halo, .tp-login-shell { animation: none !important; }
      }
    `}</style>
  );
}
