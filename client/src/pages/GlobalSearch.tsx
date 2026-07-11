import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Briefcase, Users, FileText, DollarSign, X, ArrowRight } from "lucide-react";

const ENTITY_ICONS: Record<string, any> = {
  job: <Briefcase className="h-4 w-4 text-blue-500" />,
  contact: <Users className="h-4 w-4 text-purple-500" />,
  invoice: <FileText className="h-4 w-4 text-green-500" />,
  estimate: <FileText className="h-4 w-4 text-orange-500" />,
  payment: <DollarSign className="h-4 w-4 text-teal-500" />,
};

const ENTITY_ROUTES: Record<string, string> = {
  job: "/jobs",
  contact: "/contacts",
  invoice: "/invoices",
  estimate: "/estimates",
  payment: "/invoices",
};

interface SearchResult {
  type: string;
  id: number;
  title: string;
  subtitle: string;
  badge?: string;
}

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: jobs = [] } = useQuery({ queryKey: ["/api/jobs"], queryFn: () => apiRequest("/api/jobs").then(r => r.json()) });
  const { data: contacts = [] } = useQuery({ queryKey: ["/api/contacts"], queryFn: () => apiRequest("/api/contacts").then(r => r.json()) });
  const { data: invoices = [] } = useQuery({ queryKey: ["/api/invoices"], queryFn: () => apiRequest("/api/invoices").then(r => r.json()) });
  const { data: estimates = [] } = useQuery({ queryKey: ["/api/estimates"], queryFn: () => apiRequest("/api/estimates").then(r => r.json()) });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    const q = query.toLowerCase();
    const found: SearchResult[] = [];

    // Search jobs
    for (const j of jobs) {
      if (
        j.job_number?.toLowerCase().includes(q) ||
        j.address?.toLowerCase().includes(q) ||
        j.insurance_carrier?.toLowerCase().includes(q) ||
        j.loss_type?.toLowerCase().includes(q) ||
        j.claim_number?.toLowerCase().includes(q)
      ) {
        found.push({
          type: "job",
          id: j.id,
          title: `${j.job_number} — ${j.address}`,
          subtitle: `${j.loss_type || "unknown"} | ${j.status} | ${j.insurance_carrier || "No carrier"}`,
          badge: j.status,
        });
      }
    }

    // Search contacts
    for (const c of contacts) {
      if (
        c.name?.toLowerCase().includes(q) ||
        c.phone?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q)
      ) {
        found.push({
          type: "contact",
          id: c.id,
          title: c.name,
          subtitle: `${c.type} | ${c.phone || ""} | ${c.email || ""}`,
          badge: c.type,
        });
      }
    }

    // Search invoices
    for (const inv of invoices) {
      if (
        inv.invoice_number?.toLowerCase().includes(q) ||
        String(inv.total).includes(q)
      ) {
        found.push({
          type: "invoice",
          id: inv.id,
          title: `Invoice #${inv.invoice_number || inv.id}`,
          subtitle: `$${(inv.total || 0).toLocaleString()} | ${inv.status}`,
          badge: inv.status,
        });
      }
    }

    // Search estimates
    for (const est of estimates) {
      if (
        est.estimate_number?.toLowerCase().includes(q) ||
        String(est.total).includes(q)
      ) {
        found.push({
          type: "estimate",
          id: est.id,
          title: `Estimate #${est.estimate_number || est.id}`,
          subtitle: `$${(est.total || 0).toLocaleString()} | ${est.status}`,
          badge: est.status,
        });
      }
    }

    setResults(found.slice(0, 20));
    setIsSearching(false);
  }, [query, jobs, contacts, invoices, estimates]);

  const navigate = (result: SearchResult) => {
    if (result.type === "job") {
      window.location.hash = `/jobs/${result.id}`;
    } else {
      window.location.hash = ENTITY_ROUTES[result.type] || "/";
    }
  };

  const grouped = results.reduce((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {} as Record<string, SearchResult[]>);

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Search className="h-6 w-6 text-blue-500" />
          Global Search
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Search jobs, contacts, invoices, estimates across all data</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by job #, address, carrier, contact name, claim #..."
          className="pl-9 pr-9 h-12 text-base"
          data-testid="input-global-search"
        />
        {query && (
          <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setQuery("")} data-testid="button-clear">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {query.length >= 2 && results.length === 0 && !isSearching && (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No results for "{query}"</CardContent></Card>
      )}

      {Object.entries(grouped).map(([type, items]) => (
        <div key={type}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
            {ENTITY_ICONS[type]} {type}s ({items.length})
          </p>
          <div className="space-y-1">
            {items.map(result => (
              <Card
                key={`${result.type}-${result.id}`}
                className="cursor-pointer hover:border-blue-400 transition-colors"
                onClick={() => navigate(result)}
                data-testid={`result-${result.type}-${result.id}`}
              >
                <CardContent className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="shrink-0">{ENTITY_ICONS[result.type]}</div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{result.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{result.subtitle}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {result.badge && <Badge variant="outline" className="text-xs">{result.badge}</Badge>}
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {query.length === 0 && (
        <Card className="bg-muted/30">
          <CardContent className="py-8 text-center">
            <Search className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="font-semibold text-foreground">Search across all data</p>
            <div className="text-xs text-muted-foreground mt-2 space-y-1">
              <p>Try: "TP-001", "State Farm", "John Smith", "water"</p>
              <p>Pro tip: Press ⌘K from anywhere to open quick search</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
