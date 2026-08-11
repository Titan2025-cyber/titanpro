import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  CreditCard, Upload, CheckCircle2, AlertCircle, Link2, RefreshCw,
  DollarSign, Package, Zap, Search, ChevronDown, ChevronUp, FileText,
  TrendingUp, Wifi, WifiOff
} from "lucide-react";
import { fmtDate } from "@/lib/dates";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────
interface RampTransaction {
  id: number;
  ramp_id: string | null;
  job_id: number | null;
  card_holder: string | null;
  merchant_name: string | null;
  merchant_category: string | null;
  amount: number;
  currency: string;
  transaction_date: string;
  memo: string | null;
  cost_category: string | null;
  match_status: string;
  imported_at: string;
  notes: string | null;
  job_number?: string;
  job_address?: string;
}

interface RampSummary {
  totalTransactions: number;
  totalSpend: number;
  unmatchedCount: number;
  unmatchedSpend: number;
  byCategory: Array<{ cost_category: string | null; count: number; total: number }>;
  byJob: Array<{ job_id: number; job_number: string; address: string; txn_count: number; total_spent: number }>;
}

interface Job {
  id: number;
  jobNumber: string;
  address: string;
  lossType: string;
}

// ── CSV Parser ────────────────────────────────────────────────────────────────
function parseRampCSV(text: string): any[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const values: string[] = [];
    let inQuote = false;
    let current = "";
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === "," && !inQuote) { values.push(current); current = ""; }
      else { current += ch; }
    }
    values.push(current);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (values[i] || "").trim().replace(/^"|"$/g, ""); });
    return row;
  });
}

// ── Category color map ────────────────────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  fuel: "#ef4444",
  materials: "#3b82f6",
  equipment: "#8b5cf6",
  lodging: "#f59e0b",
  meals: "#10b981",
  disposal: "#6b7280",
  insurance: "#06b6d4",
  supplies: "#f97316",
  communications: "#84cc16",
  other: "#9ca3af",
};

// ── Match status badge ────────────────────────────────────────────────────────
function MatchBadge({ status }: { status: string }) {
  if (status === "auto") return <Badge className="bg-green-600 text-white text-xs">Auto-matched</Badge>;
  if (status === "manual") return <Badge className="bg-blue-600 text-white text-xs">Manual</Badge>;
  return <Badge variant="outline" className="text-yellow-600 border-yellow-600 text-xs">Unmatched</Badge>;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function RampImport() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [previewMode, setPreviewMode] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showByJob, setShowByJob] = useState(false);

  // ── Data queries ──────────────────────────────────────────────────────────
  const { data: summary, isLoading: summaryLoading } = useQuery<RampSummary>({
    queryKey: ["/api/ramp-transactions/summary"],
    queryFn: () => apiRequest("/api/ramp-transactions/summary").then(r => r.json()),
  });

  const { data: transactions = [], isLoading: txLoading } = useQuery<RampTransaction[]>({
    queryKey: ["/api/ramp-transactions"],
    queryFn: () => apiRequest("/api/ramp-transactions").then(r => r.json()),
  });

  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs"],
    queryFn: () => apiRequest("/api/jobs").then(r => r.json()),
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const importMutation = useMutation({
    mutationFn: (rows: any[]) =>
      apiRequest("/api/ramp-transactions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactions: rows }),
      }).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ramp-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ramp-transactions/summary"] });
      setParsedRows([]);
      setPreviewMode(false);
      toast({
        title: "Import complete",
        description: `${data.imported ?? 0} transactions imported · ${data.auto_matched ?? 0} auto-matched · ${data.duplicates ?? 0} skipped (duplicate)`,
      });
    },
    onError: () => toast({ title: "Import failed", description: "Check CSV format and try again.", variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, job_id }: { id: number; job_id: number | null }) =>
      apiRequest(`/api/ramp-transactions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id, match_status: job_id ? "manual" : "unmatched" }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ramp-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ramp-transactions/summary"] });
    },
  });

  // ── File handling ─────────────────────────────────────────────────────────
  const handleFile = (file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast({ title: "CSV files only", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseRampCSV(text);
      if (!rows.length) {
        toast({ title: "No data found in CSV", variant: "destructive" });
        return;
      }
      setParsedRows(rows);
      setPreviewMode(true);
    };
    reader.readAsText(file);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  // ── Filtered transactions ──────────────────────────────────────────────────
  const filtered = transactions.filter(tx => {
    const matchSearch = !searchTerm ||
      (tx.merchant_name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (tx.memo || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (tx.job_number || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (tx.card_holder || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = statusFilter === "all" || tx.match_status === statusFilter;
    return matchSearch && matchStatus;
  });

  // ── Category chart data ────────────────────────────────────────────────────
  const chartData = summary
    ? (summary.byCategory ?? [])
        .map(c => ({ name: c.cost_category ?? "Uncategorized", value: c.total }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8)
    : [];

  // Matched counts derived from the transactions list (API summary doesn't split auto/manual)
  const autoMatched = transactions.filter(t => t.match_status === "auto" || t.match_status === "auto_matched").length;
  const manualMatched = transactions.filter(t => t.match_status === "manual" || t.match_status === "manual_matched").length;

  // ── Format helpers ─────────────────────────────────────────────────────────
  const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d: string) => fmtDate(d, { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-600/10">
            <CreditCard className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Ramp Import</h1>
            <p className="text-sm text-muted-foreground">Import card spend and match to job costs</p>
          </div>
        </div>
        {/* Live Sync Banner */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30">
          <WifiOff className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Live API sync available — connect Ramp to enable</span>
          <Badge variant="outline" className="text-xs">Coming Soon</Badge>
        </div>
      </div>

      {/* Summary Cards */}
      {!summaryLoading && summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="col-span-1">
            <CardContent className="p-4 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Total Spend</span>
              <span className="text-xl font-bold text-foreground">{fmt(summary.totalSpend)}</span>
              <span className="text-xs text-muted-foreground">{summary.totalTransactions} transactions</span>
            </CardContent>
          </Card>
          <Card className="col-span-1">
            <CardContent className="p-4 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Auto-Matched</span>
              <span className="text-xl font-bold text-green-600">{autoMatched}</span>
              <span className="text-xs text-muted-foreground">linked to jobs</span>
            </CardContent>
          </Card>
          <Card className="col-span-1">
            <CardContent className="p-4 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Manual</span>
              <span className="text-xl font-bold text-blue-600">{manualMatched}</span>
              <span className="text-xs text-muted-foreground">manually assigned</span>
            </CardContent>
          </Card>
          <Card className="col-span-1">
            <CardContent className="p-4 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Unmatched</span>
              <span className="text-xl font-bold text-yellow-600">{summary.unmatchedCount}</span>
              <span className="text-xs text-muted-foreground">need assignment</span>
            </CardContent>
          </Card>
          <Card className="col-span-1">
            <CardContent className="p-4 flex flex-col gap-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Jobs Covered</span>
              <span className="text-xl font-bold text-foreground">{summary.byJob?.length ?? 0}</span>
              <span className="text-xs text-muted-foreground">active job files</span>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Spend by Category Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-600" />
              Spend by Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} className="capitalize" />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} width={50} />
                <Tooltip formatter={(v: any) => fmt(v)} labelFormatter={l => l.charAt(0).toUpperCase() + l.slice(1)} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={CAT_COLORS[entry.name] ?? "#6b7280"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* CSV Drop Zone */}
      {!previewMode && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Upload className="h-4 w-4 text-blue-600" />
              Import Ramp CSV
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              data-testid="drop-zone"
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors
                ${dragging ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20" : "border-muted-foreground/30 hover:border-blue-400 hover:bg-muted/30"}`}
            >
              <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium text-foreground mb-1">Drop your Ramp export here</p>
              <p className="text-sm text-muted-foreground mb-4">or click to browse — CSV format only</p>
              <div className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
                <span className="px-2 py-1 rounded bg-muted">Transaction ID</span>
                <span className="px-2 py-1 rounded bg-muted">Amount</span>
                <span className="px-2 py-1 rounded bg-muted">Merchant Name</span>
                <span className="px-2 py-1 rounded bg-muted">Card Holder</span>
                <span className="px-2 py-1 rounded bg-muted">Memo</span>
                <span className="px-2 py-1 rounded bg-muted">Date</span>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              data-testid="input-file"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <p className="text-xs text-muted-foreground mt-3 text-center">
              Job numbers in memo (e.g. "TP-0012") are auto-matched. Remaining transactions can be assigned manually below.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Preview Mode */}
      {previewMode && parsedRows.length > 0 && (
        <Card className="border-blue-500">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                Preview — {parsedRows.length} rows parsed
              </CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setParsedRows([]); setPreviewMode(false); }}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  data-testid="button-import-confirm"
                  disabled={importMutation.isPending}
                  onClick={() => importMutation.mutate(parsedRows)}
                >
                  {importMutation.isPending ? <><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Importing...</> : <><Upload className="h-3 w-3 mr-1" />Confirm Import</>}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    {Object.keys(parsedRows[0] || {}).slice(0, 8).map(h => (
                      <th key={h} className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 10).map((row, i) => (
                    <tr key={i} className="border-b hover:bg-muted/20">
                      {Object.values(row).slice(0, 8).map((v: any, j) => (
                        <td key={j} className="p-2 text-foreground whitespace-nowrap max-w-[160px] truncate">{String(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedRows.length > 10 && (
                <p className="text-xs text-muted-foreground p-2 text-center">+ {parsedRows.length - 10} more rows</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transactions Table */}
      {transactions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm font-semibold">All Transactions</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    data-testid="input-search"
                    placeholder="Search merchant, memo, job..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="pl-7 h-8 text-xs w-52"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 text-xs w-36" data-testid="select-status-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="auto">Auto-matched</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="unmatched">Unmatched</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-import-more"
                >
                  <Upload className="h-3 w-3 mr-1" />Import More
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50 border-b border-t">
                    <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Merchant</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Card Holder</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Category</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Memo</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">Amount</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Job</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(tx => (
                    <tr key={tx.id} className="border-b hover:bg-muted/20 transition-colors" data-testid={`row-transaction-${tx.id}`}>
                      <td className="p-3 text-muted-foreground whitespace-nowrap">{fmtDate(tx.transaction_date)}</td>
                      <td className="p-3 font-medium text-foreground max-w-[140px]">
                        <div className="truncate">{tx.merchant_name || "—"}</div>
                        {tx.merchant_category && (
                          <div className="text-muted-foreground text-[10px] truncate">{tx.merchant_category}</div>
                        )}
                      </td>
                      <td className="p-3 text-foreground">{tx.card_holder || "—"}</td>
                      <td className="p-3">
                        {tx.cost_category ? (
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-medium text-white capitalize"
                            style={{ background: CAT_COLORS[tx.cost_category] ?? "#6b7280" }}
                          >
                            {tx.cost_category}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="p-3 text-muted-foreground max-w-[160px]">
                        <div className="truncate">{tx.memo || "—"}</div>
                      </td>
                      <td className="p-3 text-right font-semibold text-foreground whitespace-nowrap">
                        {fmt(tx.amount)}
                      </td>
                      <td className="p-3">
                        <MatchBadge status={tx.match_status} />
                      </td>
                      <td className="p-3 min-w-[160px]">
                        {tx.match_status === "auto" || tx.match_status === "manual" ? (
                          <div className="flex items-center gap-1">
                            <Link2 className="h-3 w-3 text-green-600 flex-shrink-0" />
                            <span className="font-medium text-foreground text-[11px]">{tx.job_number || `Job #${tx.job_id}`}</span>
                          </div>
                        ) : (
                          <Select
                            value={tx.job_id ? String(tx.job_id) : ""}
                            onValueChange={val => assignMutation.mutate({ id: tx.id, job_id: val ? Number(val) : null })}
                          >
                            <SelectTrigger className="h-7 text-[11px] w-full" data-testid={`select-job-${tx.id}`}>
                              <SelectValue placeholder="Assign to job..." />
                            </SelectTrigger>
                            <SelectContent>
                              {jobs.map(j => (
                                <SelectItem key={j.id} value={String(j.id)}>
                                  {j.jobNumber} — {j.address?.substring(0, 25)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-muted-foreground">
                        {transactions.length > 0 ? "No transactions match your filters" : "No transactions imported yet"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Spend by Job (collapsible) */}
      {summary && summary.byJob && summary.byJob.length > 0 && (
        <Card>
          <CardHeader
            className="pb-2 cursor-pointer"
            onClick={() => setShowByJob(!showByJob)}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Package className="h-4 w-4 text-blue-600" />
                Spend by Job ({summary.byJob.length} jobs)
              </CardTitle>
              {showByJob ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </CardHeader>
          {showByJob && (
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50 border-b border-t">
                    <th className="text-left p-3 font-medium text-muted-foreground">Job #</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Address</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">Total Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byJob.map(j => (
                    <tr key={j.job_id} className="border-b hover:bg-muted/20" data-testid={`row-job-spend-${j.job_id}`}>
                      <td className="p-3 font-semibold text-blue-600">{j.job_number}</td>
                      <td className="p-3 text-foreground">{j.address}</td>
                      <td className="p-3 text-right font-semibold text-foreground">{fmt(j.total_spent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          )}
        </Card>
      )}

      {/* Empty state */}
      {!txLoading && transactions.length === 0 && !previewMode && (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <CreditCard className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
            <h3 className="font-semibold text-foreground mb-2">No transactions yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Export a CSV from your Ramp dashboard and drop it above to get started.
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Zap className="h-3 w-3" />
              <span>Transactions with job numbers in the memo (e.g. "TP-0012 — materials") are matched automatically</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
