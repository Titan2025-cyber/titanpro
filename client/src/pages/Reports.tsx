/**
 * Reports — print-friendly report views. Owner only (weekly billing is owner-gated).
 * Opened normally from the nav, or in print mode via the Print Friendly button
 * in Weekly Billing: /reports?report=weekly-billing&print=1[&from=&to=&groupBy=]
 * In print mode it renders a clean branded layout and auto-opens the print dialog.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, FileText, BarChart3 } from "lucide-react";

const money = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;
const pct = (n: number) => `${(n || 0).toFixed(1)}%`;

function useQueryParams() {
  // hash routing: params live after "?" in the hash
  const hash = window.location.hash || "";
  const q = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return new URLSearchParams(q);
}

export default function Reports() {
  const { user, token } = useAuth();
  const params = useQueryParams();
  const printMode = params.get("print") === "1";
  const [report, setReport] = useState(params.get("report") || "weekly-billing");
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const groupBy = params.get("groupBy") || "week";

  const isOwner = user?.role === "owner";

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (groupBy) p.set("groupBy", groupBy);
    return p.toString();
  }, [from, to, groupBy]);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/reports/weekly-billing", "report-view", from, to, groupBy],
    queryFn: () => apiRequest("GET", `/api/reports/weekly-billing${qs ? "?" + qs : ""}`).then(r => r.json()).catch(() => null),
    enabled: isOwner,
  });

  // Auto-open the print dialog once data is ready in print mode
  useEffect(() => {
    if (printMode && data && !isLoading) {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
  }, [printMode, data, isLoading]);

  if (!isOwner) {
    return <div className="p-8 text-center text-muted-foreground">Reports are available to the owner only.</div>;
  }

  const rangeLabel = from || to ? `${from || "start"} to ${to || "today"}` : "All time";

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Toolbar — hidden when printing */}
      <div className="print-hide flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="w-6 h-6 text-[hsl(var(--titan-blue))]" /> Reports</h1>
          <p className="text-sm text-muted-foreground">Print-friendly executive reports. Choose a report, then print or export.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={report} onValueChange={setReport}>
            <SelectTrigger className="w-56" data-testid="select-report"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly-billing">Weekly Billing Summary</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => window.print()} data-testid="btn-print-report"><Printer className="w-4 h-4 mr-1.5" /> Print</Button>
        </div>
      </div>

      {isLoading && <div className="print-hide text-sm text-muted-foreground py-10 text-center">Loading report…</div>}

      {data && (
        <Card className="print-hide-shadow">
          <CardContent className="p-0">
            <div className="print-report p-6" data-testid="print-report">
              {/* Branded header */}
              <div className="pr-band-red rounded-t-md px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-lg font-black tracking-tight">TITAN RESTORATION LLC</p>
                  <p className="text-[11px] opacity-90">Recover · Restore · Rebuild</p>
                </div>
                <div className="text-right text-[10px] leading-tight opacity-90">
                  <p>706-922-0154 · titanrestorationllc.com</p>
                  <p>Chapin, SC · Augusta, GA · Licensed &amp; Insured</p>
                </div>
              </div>
              <div className="pr-band-blue px-5 py-2 flex items-center justify-between">
                <p className="font-bold text-sm">Weekly Billing Summary</p>
                <p className="text-[11px] opacity-90">{rangeLabel} · {groupBy === "month" ? "Monthly" : "Weekly"}</p>
              </div>

              <div className="px-1 py-4 space-y-6">
                {/* KPI strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { l: "Total Billed", v: money(data.totals.billed) },
                    { l: "Settled", v: money(data.totals.settled) },
                    { l: "Collected", v: money(data.totals.collected) },
                    { l: "Outstanding", v: money((data.totals.settled || 0) - (data.totals.collected || 0)) },
                  ].map(k => (
                    <div key={k.l} className="border rounded-md p-3 border-l-4 border-l-[hsl(var(--titan-blue))]">
                      <p className="text-[10px] uppercase tracking-wide text-neutral-500 font-semibold">{k.l}</p>
                      <p className="text-xl font-bold text-neutral-900">{k.v}</p>
                    </div>
                  ))}
                </div>

                {/* Period breakdown */}
                <div>
                  <h2 className="text-sm font-bold mb-2 text-neutral-800">{groupBy === "month" ? "Monthly" : "Weekly"} Breakdown</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>{groupBy === "month" ? "Month" : "Week Of"}</th>
                        <th style={{ textAlign: "right" }}>Billed</th>
                        <th style={{ textAlign: "right" }}>Settled</th>
                        <th style={{ textAlign: "right" }}>Collected</th>
                        <th style={{ textAlign: "right" }}>Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.periods || []).map((p: any) => (
                        <tr key={p.periodStart}>
                          <td>{p.periodStart}</td>
                          <td style={{ textAlign: "right" }}>{money(p.billed)}</td>
                          <td style={{ textAlign: "right" }}>{money(p.settled)}</td>
                          <td style={{ textAlign: "right" }}>{money(p.collected)}</td>
                          <td style={{ textAlign: "right" }}>{money((p.settled || 0) - (p.collected || 0))}</td>
                        </tr>
                      ))}
                      <tr style={{ fontWeight: 700 }}>
                        <td>Total</td>
                        <td style={{ textAlign: "right" }}>{money(data.totals.billed)}</td>
                        <td style={{ textAlign: "right" }}>{money(data.totals.settled)}</td>
                        <td style={{ textAlign: "right" }}>{money(data.totals.collected)}</td>
                        <td style={{ textAlign: "right" }}>{money((data.totals.settled || 0) - (data.totals.collected || 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Division profitability */}
                <div>
                  <h2 className="text-sm font-bold mb-2 text-neutral-800">Division Profitability</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>Division</th>
                        <th style={{ textAlign: "right" }}>Collected</th>
                        <th style={{ textAlign: "right" }}>Cost</th>
                        <th style={{ textAlign: "right" }}>Net</th>
                        <th style={{ textAlign: "right" }}>Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.divisions || []).map((d: any) => (
                        <tr key={d.division}>
                          <td style={{ textTransform: "capitalize" }}>{d.division}</td>
                          <td style={{ textAlign: "right" }}>{money(d.collected)}</td>
                          <td style={{ textAlign: "right" }}>{money(d.cost)}</td>
                          <td style={{ textAlign: "right" }}>{money(d.net)}</td>
                          <td style={{ textAlign: "right" }}>{pct(d.marginPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-[10px] text-neutral-500 leading-relaxed pt-2 border-t">
                  Outstanding = settled amount minus collected payments. Figures reflect data in Titan Pro as of {new Date().toLocaleString()}.
                  Confidential — for owner use only.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
