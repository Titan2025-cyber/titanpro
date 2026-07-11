// EnvBanner — a highly visible bar shown on every non-production environment
// so users can never confuse a test/staging deployment with the live site.
//
// Detection: the VITE_APP_ENV build-time environment variable.
//   - VITE_APP_ENV === "production"  -> banner hidden
//   - VITE_APP_ENV === anything else ("staging", "test", "qa", "demo", etc.)
//     -> red "Staging Site" banner shown
//   - VITE_APP_ENV is unset -> banner shown (safe default: any deploy that
//     forgot to configure this variable is treated as non-production)
//
// The VITE_ prefix is required — Vite only exposes environment variables
// beginning with VITE_ to the client bundle. Plain NODE_ENV will NOT work
// here because Vite reserves NODE_ENV/MODE for its own build machinery
// (vite build hardcodes MODE=production regardless of the shell NODE_ENV).
//
// Railway configuration:
//   Production service : do not set VITE_APP_ENV (or set it to "production")
//   Staging/test        : set VITE_APP_ENV=staging (or "test", etc.)

import { AlertTriangle } from "lucide-react";

// import.meta.env.VITE_APP_ENV is inlined at build time by Vite, so the
// banner is either fully present or fully tree-shaken out of the bundle.
const APP_ENV = import.meta.env.VITE_APP_ENV;

export default function EnvBanner() {
  if (APP_ENV === "production") return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="w-full bg-red-600 text-white border-b-2 border-red-800 px-4 py-2 flex items-center justify-center gap-2 text-sm font-semibold shadow-sm z-50"
      data-testid="env-banner"
    >
      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>
        Staging Site — this is not production. Do not enter real customer data.
      </span>
    </div>
  );
}
