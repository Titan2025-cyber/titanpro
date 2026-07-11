/**
 * SessionTimeout — auto-logout after inactivity
 * Warns at 2 minutes before expiry, then forces logout.
 * Session length: 8 hours (matches server). Warning fires at 7h58m.
 */
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { ShieldAlert } from "lucide-react";

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;  // 8 hours
const WARN_BEFORE_MS = 2 * 60 * 1000;             // warn 2 min before expiry
const INACTIVITY_RESET_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"];

export default function SessionTimeout() {
  const { user, logout } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(120);
  const lastActivityRef = useRef(Date.now());
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function resetTimers() {
    lastActivityRef.current = Date.now();
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setShowWarning(false);

    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      setCountdown(120);
      countdownRef.current = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) {
            clearInterval(countdownRef.current!);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    }, SESSION_DURATION_MS - WARN_BEFORE_MS);

    logoutTimerRef.current = setTimeout(() => {
      logout();
    }, SESSION_DURATION_MS);
  }

  useEffect(() => {
    if (!user) return;
    resetTimers();

    const handleActivity = () => {
      if (!showWarning) resetTimers();
    };

    INACTIVITY_RESET_EVENTS.forEach(e => window.addEventListener(e, handleActivity, { passive: true }));
    return () => {
      INACTIVITY_RESET_EVENTS.forEach(e => window.removeEventListener(e, handleActivity));
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [user]);

  if (!user || !showWarning) return null;

  return (
    <AlertDialog open={showWarning}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
            <ShieldAlert className="w-5 h-5" />
            Session Expiring Soon
          </AlertDialogTitle>
          <AlertDialogDescription>
            For security, your session will automatically end in{" "}
            <span className="font-bold text-foreground">{countdown}s</span> due to inactivity.
            Click "Stay Logged In" to continue.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => logout()}
            className="border-red-200 text-red-600 hover:bg-red-50"
          >
            Log Out Now
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => resetTimers()}
            className="bg-[hsl(var(--titan-blue))] hover:bg-[hsl(var(--titan-blue)/0.85)] text-white"
          >
            Stay Logged In
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
