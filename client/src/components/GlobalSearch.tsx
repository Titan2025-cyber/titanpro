import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X, Briefcase, User, FileText, DollarSign } from "lucide-react";
import { useLocation } from "wouter";
import type { Job, Contact, Invoice, Estimate } from "@shared/schema";

interface SearchResult {
  id: string;
  type: "job" | "contact" | "invoice" | "estimate";
  label: string;
  sublabel: string;
  href: string;
  icon: typeof Briefcase;
  color: string;
}

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();

  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });
  const { data: invoices = [] } = useQuery<Invoice[]>({ queryKey: ["/api/invoices"] });
  const { data: estimates = [] } = useQuery<Estimate[]>({ queryKey: ["/api/estimates"] });

  // CMD+K / CTRL+K handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
    }
  }, [open]);

  const q = query.toLowerCase().trim();

  const results: SearchResult[] = q.length < 2 ? [] : [
    ...jobs
      .filter(j =>
        j.jobNumber.toLowerCase().includes(q) ||
        (j.address || "").toLowerCase().includes(q) ||
        (j.insuranceCarrier || "").toLowerCase().includes(q) ||
        j.lossType.toLowerCase().includes(q) ||
        (j.assignedTech || "").toLowerCase().includes(q)
      )
      .slice(0, 4)
      .map(j => ({
        id: `job-${j.id}`,
        type: "job" as const,
        label: j.jobNumber,
        sublabel: `${j.lossType} · ${j.address || "No address"} · ${j.status}`,
        href: `/jobs/${j.id}`,
        icon: Briefcase,
        color: "text-[hsl(var(--titan-blue))] bg-[hsl(var(--titan-blue)/0.1)]",
      })),
    ...contacts
      .filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.phone || "").includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.company || "").toLowerCase().includes(q)
      )
      .slice(0, 3)
      .map(c => ({
        id: `contact-${c.id}`,
        type: "contact" as const,
        label: c.name,
        sublabel: `${c.type} · ${c.phone || c.email || "No contact info"}`,
        href: "/contacts",
        icon: User,
        color: "text-green-600 bg-green-100",
      })),
    ...invoices
      .filter(i =>
        i.invoiceNumber.toLowerCase().includes(q) ||
        String(i.total).includes(q)
      )
      .slice(0, 3)
      .map(i => ({
        id: `inv-${i.id}`,
        type: "invoice" as const,
        label: i.invoiceNumber,
        sublabel: `$${(i.total || 0).toLocaleString()} · ${i.status}`,
        href: "/invoices",
        icon: DollarSign,
        color: "text-orange-600 bg-orange-100",
      })),
    ...estimates
      .filter(e =>
        e.title.toLowerCase().includes(q)
      )
      .slice(0, 2)
      .map(e => ({
        id: `est-${e.id}`,
        type: "estimate" as const,
        label: e.title,
        sublabel: `$${(e.total || 0).toLocaleString()} · ${e.status}`,
        href: `/estimates/${e.id}`,
        icon: FileText,
        color: "text-purple-600 bg-purple-100",
      })),
  ];

  const handleSelect = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/60 hover:bg-muted border border-border text-sm text-muted-foreground transition-colors w-48 lg:w-64"
        data-testid="button-global-search"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="flex-1 text-left text-xs">Search everything...</span>
        <span className="text-xs font-mono bg-background border border-border rounded px-1">⌘K</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-5 h-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search jobs, contacts, invoices..."
            className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground outline-none text-sm"
            data-testid="input-global-search"
          />
          <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto">
          {q.length < 2 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search jobs, contacts, invoices, and estimates
            </div>
          ) : results.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No results for "{query}"
            </div>
          ) : (
            <div className="py-2">
              {results.map(r => {
                const Icon = r.icon;
                return (
                  <button
                    key={r.id}
                    onClick={() => handleSelect(r.href)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/60 transition-colors text-left"
                    data-testid={`search-result-${r.id}`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${r.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{r.label}</p>
                      <p className="text-xs text-muted-foreground truncate">{r.sublabel}</p>
                    </div>
                    <span className="text-xs text-muted-foreground capitalize">{r.type}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border bg-muted/30 flex gap-4 text-xs text-muted-foreground">
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>ESC Close</span>
        </div>
      </div>
    </div>
  );
}
