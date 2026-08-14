import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Compass, ArrowLeft } from "lucide-react";
import { Link } from "wouter";

/**
 * Branded 404 shown for any unrouted path. The prior dev-facing "Did you
 * forget to add the page to the router?" message leaked to production users
 * (e.g. anyone hitting /#/settings directly). Fixed 2026-08-14.
 */
export default function NotFound() {
  return (
    <div className="min-h-[70vh] w-full flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-[hsl(var(--titan-blue)/0.1)] flex items-center justify-center mb-4">
            <Compass className="h-7 w-7 text-[hsl(var(--titan-blue))]" />
          </div>
          <h1 className="text-2xl font-bold mb-1">Page not found</h1>
          <p className="text-sm text-muted-foreground mb-6">
            That URL doesn't lead anywhere in Titan Pro. Use the sidebar or head back to the dashboard.
          </p>
          <div className="flex gap-2 justify-center">
            <Link href="/">
              <Button variant="default" size="sm">
                <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to Dashboard
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
