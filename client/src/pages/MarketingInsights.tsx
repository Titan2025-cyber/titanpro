// MarketingInsights.tsx
//
// Consolidated Insights tab for the Marketing Hub. Combines:
//   • ConversionRate (signed work → sold job funnel with per-job overrides)
//   • LeadAttribution (which sources actually produced revenue)
//
// A restoration marketing rep needs both in one place: conversion tells them
// if the estimating team is closing, attribution tells them where the money
// went in for the deals that closed.

import ConversionRate from "@/pages/ConversionRate";
import LeadAttribution from "@/pages/LeadAttribution";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";

export default function MarketingInsights() {
  return (
    <div className="space-y-8">
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-4 flex items-start gap-3">
          <TrendingUp className="w-5 h-5 mt-0.5 text-primary shrink-0" />
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Two questions to answer daily:</span>{" "}
            Are we closing the leads that come in? And where should we spend the next
            dollar to get more of them?
          </div>
        </CardContent>
      </Card>

      <section aria-label="Conversion funnel">
        <ConversionRate />
      </section>

      <section aria-label="Lead attribution">
        <LeadAttribution />
      </section>
    </div>
  );
}
