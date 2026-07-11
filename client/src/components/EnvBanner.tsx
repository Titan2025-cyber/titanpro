// EnvBanner — a highly visible bar shown on every non-production environment
// so users can never confuse a test/staging deployment with the live site.
//
// Detection is based on the standard NODE_ENV environment variable:
//   - NODE_ENV === "production"  -> banner hidden
//   - anything else (staging, test, development, qa, demo, unset) -> banner shown
//
// NODE_ENV is set automatically by Vite for the two common cases:
//   - `npm run dev`   -> NODE_ENV=development  (banner shown)
//   - `npm run build` -> NODE_ENV=production   (banner hidden)
// For staging/test builds on Railway, set NODE_ENV=staging (or any non-
// "production" value) as a build-time env var and the banner will appear.

import { AlertTriangle } from "lucide-react";

// import.meta.env.MODE is Vite's canonical way to read NODE_ENV on the client;
// it is a build-time constant so tree-shaking removes the banner from
// production bundles entirely.
const NODE_ENV = import.meta.env.MODE;

export default function EnvBanner() {
  if (NODE_ENV === "production") return null;

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
