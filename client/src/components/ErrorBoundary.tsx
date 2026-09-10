/*
 * ErrorBoundary.tsx — render-error boundary for page-level trees.
 *
 * Root causes of "failed to load, clears on refresh" were fixed at the
 * source (null-safe field access, defensive JSON.parse, guarded array reads).
 * We deliberately do NOT auto-retry here — silent retries hide bugs; if a
 * page throws we want the fallback UI and a phone-home so the exact stack
 * lands in /api/client-errors instead of vanishing on a background remount.
 *
 * "Try again" invalidates every React Query cache entry so the retry
 * actually re-fetches instead of rendering the same stale state.
 */

import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { queryClient } from "@/lib/queryClient";

interface Props { children: ReactNode; name?: string; }
interface State {
  hasError: boolean;
  error: string;
  errorInfo: string;
  attempt: number; // remount counter — bumping re-renders the subtree on Try again
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: "", errorInfo: "", attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error: error?.message || "Unknown error" };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const stack = info.componentStack?.slice(0, 500) ?? "";
    console.error(`[ErrorBoundary:${this.props.name || "page"}]`, error, stack);
    this.setState({ errorInfo: stack });

    // Best-effort phone-home so we can debug without waiting for the user
    // to open devtools. Silently ignored if the server rejects.
    try {
      const payload = {
        page: this.props.name || "unknown",
        message: error?.message || "Unknown error",
        stack: (error as any)?.stack?.slice(0, 2000) || "",
        componentStack: stack,
        url: typeof window !== "undefined" ? window.location.href : "",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        at: new Date().toISOString(),
        attempt: this.state.attempt,
      };
      // fetch, not apiRequest, so we don't loop through the error path.
      fetch("/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true, // fire during unload/navigation
      }).catch(() => { /* swallow */ });
    } catch { /* swallow */ }
  }

  handleTryAgain = () => {
    // "Try again" bumps attempt AND clears the query cache for this page so
    // a stale/failed query doesn't just replay the same broken state.
    queryClient.invalidateQueries().catch(() => { /* swallow */ });
    this.setState((s) => ({
      hasError: false,
      error: "",
      errorInfo: "",
      attempt: s.attempt + 1,
    }));
  };

  handleGoHome = () => {
    window.location.hash = "/";
    this.setState({ hasError: false, error: "", errorInfo: "" });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 text-center px-6">
          <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-950/40 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>
          <div className="max-w-sm">
            <h2 className="text-lg font-semibold mb-1 text-foreground">
              {this.props.name ? `${this.props.name} failed to load` : "Something went wrong"}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {this.state.error}
            </p>
            {this.state.errorInfo && (
              <details className="mt-3 text-left">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                  Technical details
                </summary>
                <pre className="mt-2 text-[10px] text-muted-foreground bg-muted p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap">
                  {this.state.errorInfo}
                </pre>
              </details>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={this.handleTryAgain}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Try again
            </Button>
            <Button variant="ghost" size="sm" onClick={this.handleGoHome}>
              <Home className="w-3.5 h-3.5 mr-1.5" /> Dashboard
            </Button>
          </div>
        </div>
      );
    }
    // The `key` remounts the entire subtree whenever "Try again" bumps
    // `attempt`, so the retry starts from a fresh mount rather than
    // rendering the same broken state.
    return <div key={this.state.attempt}>{this.props.children}</div>;
  }
}
