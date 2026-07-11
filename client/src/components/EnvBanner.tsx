// EnvBanner — a highly visible bar shown on every non-production environment
// so users can never confuse a test/staging deployment with the live site.
//
// Detection logic (first match wins):
//   1. VITE_ENV_LABEL env var — an explicit override, wins over everything.
//        Examples: "staging", "preview", "qa", "local", "test", "production"
//        Set to "production" (case-insensitive) to hide the banner even in dev.
//   2. Hostname heuristics — if the browser is on localhost / *.local / an IP
//        address / a domain containing "staging", "preview", "test", "dev",
//        or "railway.app", we assume non-production.
//   3. Vite dev mode (import.meta.env.DEV) — always considered non-production.
//   4. Otherwise assume production and render nothing.
//
// The banner appears at the very top of the viewport and pushes content down;
// it is rendered from App.tsx above every route, and also stands alone on the
// login screen (which is rendered before AuthGate).

import { AlertTriangle } from "lucide-react";

function detectEnvironment(): { isProd: boolean; label: string } {
  // 1. Explicit override
  const override = (import.meta.env.VITE_ENV_LABEL as string | undefined)?.trim();
  if (override) {
    const isProd = override.toLowerCase() === "production" || override.toLowerCase() === "prod";
    return { isProd, label: override.toUpperCase() };
  }

  // 2. Hostname heuristics (only runs in the browser)
  if (typeof window !== "undefined") {
    const host = window.location.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
      return { isProd: false, label: "LOCAL" };
    }
    // IP addresses are almost never production
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      return { isProd: false, label: "LOCAL" };
    }
    if (host.includes("staging")) return { isProd: false, label: "STAGING" };
    if (host.includes("preview")) return { isProd: false, label: "PREVIEW" };
    if (host.includes("test")) return { isProd: false, label: "TEST" };
    if (host.includes("dev")) return { isProd: false, label: "DEV" };
    // Railway preview / non-custom-domain deploys — flag them so nobody mistakes
    // the auto-generated *.up.railway.app URL for the real customer site.
    if (host.endsWith(".railway.app") || host.endsWith(".up.railway.app")) {
      return { isProd: false, label: "RAILWAY PREVIEW" };
    }
  }

  // 3. Vite dev mode
  if (import.meta.env.DEV) {
    return { isProd: false, label: "DEV" };
  }

  // 4. Default: assume production
  return { isProd: true, label: "PRODUCTION" };
}

export default function EnvBanner() {
  const { isProd, label } = detectEnvironment();
  if (isProd) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="w-full bg-amber-400 text-amber-950 border-b-2 border-amber-600 px-4 py-2 flex items-center justify-center gap-2 text-sm font-semibold shadow-sm z-50"
      data-testid="env-banner"
    >
      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>
        {label} SITE — this is not production. Do not enter real customer data.
      </span>
    </div>
  );
}
