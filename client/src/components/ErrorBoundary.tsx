import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props { children: ReactNode; name?: string; }
interface State { hasError: boolean; error: string; errorInfo: string; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: "", errorInfo: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error: error?.message || "Unknown error" };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name || "page"}]`, error, info.componentStack);
    this.setState({ errorInfo: info.componentStack?.slice(0, 300) ?? "" });
  }

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
            <Button
              variant="outline"
              size="sm"
              onClick={() => this.setState({ hasError: false, error: "", errorInfo: "" })}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Try again
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { window.location.hash = "/"; this.setState({ hasError: false, error: "", errorInfo: "" }); }}
            >
              <Home className="w-3.5 h-3.5 mr-1.5" /> Dashboard
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
