/*
 * InstallPrompt — "Add to Home Screen" banner for phones.
 *
 * Two paths:
 *   1. Chrome/Edge/Android/Samsung Internet fire `beforeinstallprompt`. We
 *      capture the event, hide the browser's default mini-infobar, and show
 *      our own Install button in the bottom-right. Clicking calls
 *      prompt() → returns userChoice; we log and dismiss.
 *   2. iOS Safari never fires that event. We detect iOS + non-standalone
 *      and show a small instruction card ("Tap Share → Add to Home Screen").
 *
 * Dismissal is remembered in localStorage so techs aren't nagged. They can
 * re-open the banner from My Account (future) or by clearing storage.
 *
 * Never shows when already running as an installed app (display-mode:
 * standalone or navigator.standalone === true on iOS).
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, X, Share } from "lucide-react";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "titanpro.installPrompt.dismissedAt";
// Re-show 14 days after a "Not now" dismiss. If they clicked Install and
// accepted, the standalone check will suppress it going forward.
const RENAG_MS = 14 * 24 * 60 * 60 * 1000;

function isStandalone() {
  if (typeof window === "undefined") return false;
  if ((window.navigator as any).standalone === true) return true; // iOS
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ reports as Mac; sniff touch to catch it.
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
}

function recentlyDismissed() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < RENAG_MS;
  } catch {
    return false;
  }
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [showIOS, setShowIOS] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;

    // Android / Chrome / Edge path.
    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", onBIP);

    // iOS Safari path — no event; check UA + not already installed.
    if (isIOS()) {
      // Small delay so it doesn't flash during page load.
      const t = setTimeout(() => setShowIOS(true), 1500);
      return () => {
        clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onBIP);
      };
    }

    // Log successful install so the browser stops showing our banner.
    const onInstalled = () => {
      setDeferred(null);
      setShowIOS(false);
    };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setDismissed(true);
  };

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {}
    setDeferred(null);
  };

  if (dismissed) return null;

  // Android / desktop-Chrome install button
  if (deferred) {
    return (
      <div className="fixed bottom-4 right-4 z-50 max-w-sm print-hide">
        <div className="bg-white dark:bg-slate-900 border-2 border-[hsl(var(--titan-red))] rounded-lg shadow-xl p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[hsl(var(--titan-red))] text-white flex items-center justify-center shrink-0">
            <Download className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight">Add Titan Pro to your phone</p>
            <p className="text-xs text-muted-foreground leading-tight mt-0.5">
              One-tap access from your home screen — works in the field.
            </p>
          </div>
          <Button
            size="sm"
            className="bg-[hsl(var(--titan-red))] hover:bg-[hsl(var(--titan-red))]/90 text-white shrink-0"
            onClick={install}
            data-testid="btn-install-pwa"
          >
            Install
          </Button>
          <button
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground shrink-0"
            onClick={dismiss}
            data-testid="btn-install-dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // iOS Safari instruction card
  if (showIOS) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:max-w-sm print-hide">
        <div className="bg-white dark:bg-slate-900 border-2 border-[hsl(var(--titan-red))] rounded-lg shadow-xl p-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-md bg-[hsl(var(--titan-red))] text-white flex items-center justify-center shrink-0">
              <Download className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm leading-tight">Add Titan Pro to your home screen</p>
              <p className="text-xs text-muted-foreground leading-snug mt-1">
                In Safari, tap <Share className="inline w-3.5 h-3.5 mx-0.5 -mt-0.5" />
                <span className="font-medium">Share</span> then
                <span className="font-medium"> Add to Home Screen</span>.
              </p>
            </div>
            <button
              aria-label="Dismiss"
              className="text-muted-foreground hover:text-foreground shrink-0"
              onClick={dismiss}
              data-testid="btn-install-dismiss-ios"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
