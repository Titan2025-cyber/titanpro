import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./index.css";
import { installCopyDeterrent } from "./lib/copyDeterrent";

// Sentry — opt-in via VITE_SENTRY_DSN. Set in Railway env to enable.
// When unset, this is a no-op and adds ~0 KB runtime cost (dead code
// eliminated by Vite in production builds).
const SENTRY_DSN = (import.meta as any).env?.VITE_SENTRY_DSN as string | undefined;
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: (import.meta as any).env?.MODE || "production",
    // Session replay + traces are off by default — flip on when needed.
    tracesSampleRate: 0.1,
    // Trim noisy errors from third-party embeds (Maps, DocuSketch iframes).
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "Non-Error promise rejection captured",
    ],
  });
}

if (!window.location.hash) {
  window.location.hash = "#/";
}

// Command Center theme — the app runs in a single cinematic dark theme so every
// page inherits the dark surfaces, glass cards, and glowing accents defined in
// index.css. Applied on <html> so shadcn/ui components (which read the .dark
// token set) render correctly everywhere without touching individual pages.
document.documentElement.classList.add("dark");

// Lightweight anti-copy deterrent (production only; no-op in dev).
installCopyDeterrent();

// Register the offline app-shell service worker so the app loads without signal
// (field techs in basements/crawlspaces). Data writes are handled separately by
// the IndexedDB outbox; this only caches the shell + built assets. Best-effort —
// failures are non-fatal and the app runs identically without it.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* SW unsupported / blocked (e.g. some preview iframes) — app still works */
    });

    // Self-heal from a stale bundle. If the SW notices the server handed us
    // HTML for a .js/.css URL (old chunk hash from a cached index.html), it
    // posts "titan-stale-bundle" and we reload ONCE so the browser pulls the
    // fresh index.html + new chunk hashes. The sessionStorage flag prevents
    // a reload loop if something else is truly broken.
    navigator.serviceWorker.addEventListener("message", (evt) => {
      const data = (evt && (evt as MessageEvent).data) as { type?: string } | undefined;
      if (data && data.type === "titan-stale-bundle") {
        try {
          if (sessionStorage.getItem("titan-reloaded-for-stale") === "1") return;
          sessionStorage.setItem("titan-reloaded-for-stale", "1");
        } catch { /* ignore */ }
        location.reload();
      }
    });
  });
}

createRoot(document.getElementById("root")!).render(<App />);
