// ─────────────────────────────────────────────────────────────────────────────
// GlobalSearch — top-nav command palette (⌘K / Ctrl+K).
//
// Searches the four core entities in one input, with a category dropdown so
// the user can narrow scope when a term is ambiguous:
//
//   All       — jobs + contacts + invoices + estimates (default)
//   Job #     — jobs by job number only
//   Name      — contacts by name; also matches jobs whose linked contact name matches
//   Phone     — contacts by phone digits; also matches jobs whose linked contact phone matches
//   Address   — jobs by address, city, or zip
//   Invoice   — invoices by number, PO, or dollar amount
//   Estimate  — estimates by title or dollar amount
//
// The category selector is a real <select> so it works on mobile without
// pulling a popover library into the top nav. Digits-only queries under a
// phone scope are normalized (strips (), -, spaces) before comparison.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X, Briefcase, User, FileText, DollarSign } from "lucide-react";
import { useLocation } from "wouter";
import type { Job, Contact, Invoice, Estimate } from "@shared/schema";

type Category = "all" | "job" | "name" | "phone" | "address" | "invoice" | "estimate";

interface CategoryOption {
  value: Category;
  label: string;
  hint: string;
}

const CATEGORIES: CategoryOption[] = [
  { value: "all",      label: "All",       hint: "Everything" },
  { value: "job",      label: "Job #",     hint: "e.g. 24-1082" },
  { value: "name",     label: "Name",      hint: "Customer or contact name" },
  { value: "phone",    label: "Phone",     hint: "Any digits" },
  { value: "address",  label: "Address",   hint: "Street, city, zip" },
  { value: "invoice",  label: "Invoice",   hint: "Number or amount" },
  { value: "estimate", label: "Estimate",  hint: "Title or amount" },
];

interface SearchResult {
  id: string;
  type: "job" | "contact" | "invoice" | "estimate";
  label: string;
  sublabel: string;
  href: string;
  icon: typeof Briefcase;
  color: string;
}

// Strip anything that isn't a digit — used for phone comparisons so
// "(803) 555-0102" and "8035550102" both match.
function digitsOnly(s: string): string {
  return (s || "").replace(/\D+/g, "");
}

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const [, navigate] = useLocation();

  // Global search must find EVERY job the user has ever entered — open,
  // closed, completed — not just active pipeline rows. /api/jobs excludes
  // closed jobs by default; /api/jobs/search-index returns all non-deleted
  // rows with customer hydrated. Only fetched when the palette is open so
  // it doesn't add weight to first paint.
  const { data: jobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/jobs/search-index"],
    enabled: open,
  });
  const { data: contacts = [] } = useQuery<Contact[]>({ queryKey: ["/api/contacts"], enabled: open });
  const { data: invoices = [] } = useQuery<Invoice[]>({ queryKey: ["/api/invoices"], enabled: open });
  const { data: estimates = [] } = useQuery<Estimate[]>({ queryKey: ["/api/estimates"], enabled: open });

  // Fast lookup from contactId → Contact so job results can carry the
  // customer's name/phone in the sublabel without an N×M scan per keystroke.
  const contactById = useMemo(() => {
    const m = new Map<number, Contact>();
    for (const c of contacts) m.set(c.id, c);
    return m;
  }, [contacts]);

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
      setCategory("all");
    }
  }, [open]);

  const q = query.toLowerCase().trim();
  const qDigits = digitsOnly(query);

  // ── Per-category predicates ─────────────────────────────────────────────
  const matchJobByNumber = (j: Job) => j.jobNumber.toLowerCase().includes(q);
  const matchJobByAddress = (j: Job) => (j.address || "").toLowerCase().includes(q);
  const matchJobByContactName = (j: Job) => {
    if (!j.contactId) return false;
    const c = contactById.get(j.contactId);
    return !!c && c.name.toLowerCase().includes(q);
  };
  const matchJobByContactPhone = (j: Job) => {
    if (!qDigits || !j.contactId) return false;
    const c = contactById.get(j.contactId);
    return !!c && digitsOnly(c.phone || "").includes(qDigits);
  };
  const matchJobAllFields = (j: Job) =>
    matchJobByNumber(j) ||
    matchJobByAddress(j) ||
    matchJobByContactName(j) ||
    matchJobByContactPhone(j) ||
    (j.insuranceCarrier || "").toLowerCase().includes(q) ||
    j.lossType.toLowerCase().includes(q) ||
    (j.assignedTech || "").toLowerCase().includes(q);

  const matchContactByName = (c: Contact) => c.name.toLowerCase().includes(q);
  const matchContactByPhone = (c: Contact) => !!qDigits && digitsOnly(c.phone || "").includes(qDigits);
  const matchContactAllFields = (c: Contact) =>
    matchContactByName(c) ||
    matchContactByPhone(c) ||
    (c.email || "").toLowerCase().includes(q) ||
    (c.company || "").toLowerCase().includes(q);

  const matchInvoice = (i: Invoice) =>
    i.invoiceNumber.toLowerCase().includes(q) || String(i.total).includes(q);
  const matchEstimate = (e: Estimate) => e.title.toLowerCase().includes(q);

  // ── Build results based on category ─────────────────────────────────────
  // Minimum: 2 chars for text, 3 digits for phone (avoids matching every job
  // whose customer's phone contains "5").
  const canRun = category === "phone" ? qDigits.length >= 3 : q.length >= 2;

  const results: SearchResult[] = !canRun ? [] : (() => {
    const out: SearchResult[] = [];

    const pushJob = (j: Job) => {
      const c = j.contactId ? contactById.get(j.contactId) : undefined;
      const isClosed = (j.status || "").toLowerCase() === "closed";
      const parts = [
        j.lossType,
        c?.name || null,
        j.address || null,
        isClosed ? "CLOSED" : j.status,
      ].filter(Boolean);
      out.push({
        id: `job-${j.id}`,
        type: "job",
        label: j.jobNumber,
        sublabel: parts.join(" · "),
        href: `/jobs/${j.id}`,
        icon: Briefcase,
        color: isClosed
          ? "text-muted-foreground bg-muted"
          : "text-[hsl(var(--titan-blue))] bg-[hsl(var(--titan-blue)/0.1)]",
      });
    };

    const pushContact = (c: Contact) => {
      out.push({
        id: `contact-${c.id}`,
        type: "contact",
        label: c.name,
        sublabel: `${c.type} · ${c.phone || c.email || "No contact info"}`,
        href: "/contacts",
        icon: User,
        color: "text-green-600 bg-green-100",
      });
    };

    const pushInvoice = (i: Invoice) => {
      out.push({
        id: `inv-${i.id}`,
        type: "invoice",
        label: i.invoiceNumber,
        sublabel: `$${(i.total || 0).toLocaleString()} · ${i.status}`,
        href: "/invoices",
        icon: DollarSign,
        color: "text-orange-600 bg-orange-100",
      });
    };

    const pushEstimate = (e: Estimate) => {
      out.push({
        id: `est-${e.id}`,
        type: "estimate",
        label: e.title,
        sublabel: `$${(e.total || 0).toLocaleString()} · ${e.status}`,
        href: `/estimates/${e.id}`,
        icon: FileText,
        color: "text-purple-600 bg-purple-100",
      });
    };

    if (category === "all") {
      jobs.filter(matchJobAllFields).slice(0, 5).forEach(pushJob);
      contacts.filter(matchContactAllFields).slice(0, 4).forEach(pushContact);
      invoices.filter(matchInvoice).slice(0, 3).forEach(pushInvoice);
      estimates.filter(matchEstimate).slice(0, 2).forEach(pushEstimate);
    } else if (category === "job") {
      jobs.filter(matchJobByNumber).slice(0, 12).forEach(pushJob);
    } else if (category === "name") {
      // Contacts first, then any jobs whose customer name matched.
      contacts.filter(matchContactByName).slice(0, 8).forEach(pushContact);
      jobs.filter(matchJobByContactName).slice(0, 6).forEach(pushJob);
    } else if (category === "phone") {
      contacts.filter(matchContactByPhone).slice(0, 8).forEach(pushContact);
      jobs.filter(matchJobByContactPhone).slice(0, 6).forEach(pushJob);
    } else if (category === "address") {
      jobs.filter(matchJobByAddress).slice(0, 12).forEach(pushJob);
    } else if (category === "invoice") {
      invoices.filter(matchInvoice).slice(0, 12).forEach(pushInvoice);
    } else if (category === "estimate") {
      estimates.filter(matchEstimate).slice(0, 12).forEach(pushEstimate);
    }

    return out;
  })();

  const handleSelect = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  const activeCategory = CATEGORIES.find(c => c.value === category)!;

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
      <div className="relative w-full max-w-xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Search input + category selector */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <Search className="w-5 h-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={activeCategory.hint}
            className="flex-1 min-w-0 bg-transparent text-foreground placeholder:text-muted-foreground outline-none text-sm"
            data-testid="input-global-search"
            inputMode={category === "phone" ? "tel" : "text"}
          />
          <select
            value={category}
            onChange={e => setCategory(e.target.value as Category)}
            className="shrink-0 bg-muted/60 border border-border rounded-md px-2 py-1 text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-[hsl(var(--titan-blue))] cursor-pointer"
            data-testid="select-global-search-category"
            title="Search category"
          >
            {CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <button
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground shrink-0"
            aria-label="Close search"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto">
          {!canRun ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {category === "phone"
                ? "Type at least 3 digits to search phone numbers"
                : `Type at least 2 characters. ${activeCategory.hint}.`}
            </div>
          ) : results.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No {category === "all" ? "results" : `${activeCategory.label.toLowerCase()} matches`} for "{query}"
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
                      <p className="text-sm font-medium text-foreground truncate">{r.label}</p>
                      <p className="text-xs text-muted-foreground truncate">{r.sublabel}</p>
                    </div>
                    <span className="text-xs text-muted-foreground capitalize shrink-0">{r.type}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border bg-muted/30 flex gap-4 text-xs text-muted-foreground">
          <span>↵ Select</span>
          <span>ESC Close</span>
          <span className="ml-auto">Category: <span className="font-medium text-foreground">{activeCategory.label}</span></span>
        </div>
      </div>
    </div>
  );
}
