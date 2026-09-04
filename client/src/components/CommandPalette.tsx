import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import {
  Briefcase, FileText, Users, DollarSign, Calendar, LayoutDashboard,
  Camera, Wrench, ShieldCheck, Package, Truck, MessageSquare, BarChart3,
  Settings, MapPin, Clock, PhoneCall, ArrowRight, History,
} from "lucide-react";

/**
 * Global ⌘K / Ctrl-K command palette.
 *
 * Design goals:
 *  - Keyboard-first jump-to for people who know the app. Never blocks
 *    click-based navigation.
 *  - Search across pages, jobs, contacts, invoices, estimates in one
 *    prompt (debounced), so users don't have to remember which page
 *    holds what.
 *  - Recent items surface first when the input is empty so power users
 *    can bounce between the same 5 jobs quickly.
 *
 * Recent items live in localStorage under `titanpro:recent-items` and
 * are shared with any future component that wants to record a jump.
 */

type PageEntry = { id: string; label: string; href: string; icon: any; hint?: string };

const PAGES: PageEntry[] = [
  { id: "page:dashboard",   label: "Dashboard",           href: "/",              icon: LayoutDashboard, hint: "Command center" },
  { id: "page:jobs",        label: "Jobs",                href: "/jobs",          icon: Briefcase,        hint: "Active + pipeline" },
  { id: "page:closed",      label: "Closed Jobs",         href: "/jobs/closed",   icon: Briefcase,        hint: "Archive" },
  { id: "page:estimates",   label: "Estimates",           href: "/estimates",     icon: FileText,         hint: "Xactimate-style lines" },
  { id: "page:invoices",    label: "Invoices",            href: "/invoices",      icon: DollarSign,       hint: "Billing + A/R" },
  { id: "page:payments",    label: "Payments",            href: "/payments",      icon: DollarSign },
  { id: "page:contacts",    label: "Contacts",            href: "/contacts",      icon: Users },
  { id: "page:scheduling",  label: "Scheduling",          href: "/scheduling",    icon: Calendar,         hint: "Shifts + events" },
  { id: "page:photos",      label: "Photos Hub",          href: "/photos-hub",    icon: Camera },
  { id: "page:equipment",   label: "Equipment Hub",       href: "/equipment-hub", icon: Package },
  { id: "page:safety",      label: "Safety Hub",          href: "/safety-hub",    icon: ShieldCheck },
  { id: "page:reports",     label: "Reports Hub",         href: "/reports-hub",   icon: BarChart3 },
  { id: "page:inspections", label: "Inspections",         href: "/inspections",   icon: Wrench },
  { id: "page:vehicles",    label: "Vehicles",            href: "/vehicles",      icon: Truck },
  { id: "page:messages",    label: "Messages",            href: "/messages",      icon: MessageSquare },
  { id: "page:map",         label: "Service Area Map",    href: "/service-map",   icon: MapPin },
  { id: "page:timeclock",   label: "Time Clock",          href: "/time-clock",    icon: Clock },
  { id: "page:calls",       label: "Call Log",            href: "/call-log",      icon: PhoneCall },
  { id: "page:settings",    label: "Settings",            href: "/settings",      icon: Settings },
  { id: "page:users",       label: "User Management",     href: "/user-management", icon: Users },
  { id: "page:integrations", label: "Integrations",       href: "/integrations",  icon: Settings },
  { id: "page:line-items",  label: "Line Item Library",   href: "/line-items",    icon: FileText },
];

type SearchHit = {
  id: string;                       // stable id like "job:123"
  kind: "job" | "contact" | "invoice" | "estimate";
  label: string;
  sublabel?: string;
  href: string;
};

const RECENTS_KEY = "titanpro:recent-items";
const MAX_RECENTS = 6;

function readRecents(): (SearchHit | PageEntry)[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : [];
  } catch { return []; }
}

function pushRecent(item: SearchHit | PageEntry) {
  try {
    const cur = readRecents();
    const next = [item, ...cur.filter((r: any) => r.id !== (item as any).id)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch { /* noop */ }
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [, navigate] = useLocation();
  const debounce = useRef<number | null>(null);

  // Global keyboard: ⌘K on Mac, Ctrl+K on Windows/Linux.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Search across content types when the query is >=2 chars. We hit
  // existing list endpoints and filter client-side — cheaper than
  // adding a new /api/search route, and each list is already indexed
  // in memory on the server. Debounced 220ms.
  useEffect(() => {
    if (query.trim().length < 2) { setHits([]); return; }
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(async () => {
      const q = query.trim().toLowerCase();
      try {
        const [jobsR, contactsR, invoicesR, estimatesR] = await Promise.all([
          fetch("/api/jobs?limit=200", { credentials: "include" }).then(r => r.ok ? r.json() : []),
          fetch("/api/contacts?limit=200", { credentials: "include" }).then(r => r.ok ? r.json() : []),
          fetch("/api/invoices?limit=200", { credentials: "include" }).then(r => r.ok ? r.json() : []),
          fetch("/api/estimates?limit=200", { credentials: "include" }).then(r => r.ok ? r.json() : []),
        ]);
        const asArray = (x: any) => Array.isArray(x) ? x : (x?.items || x?.jobs || x?.data || []);
        const jobs = asArray(jobsR)
          .filter((j: any) => `${j.jobNumber || j.job_number || ""} ${j.address || ""} ${j.customerName || j.customer_name || ""} ${j.status || ""}`.toLowerCase().includes(q))
          .slice(0, 8)
          .map((j: any): SearchHit => ({
            id: `job:${j.id}`,
            kind: "job",
            label: `${j.jobNumber || j.job_number || `Job #${j.id}`} — ${j.address || j.customerName || j.customer_name || "unknown"}`,
            sublabel: [j.status, j.customerName || j.customer_name].filter(Boolean).join(" · "),
            href: `/jobs/${j.id}`,
          }));
        const contacts = asArray(contactsR)
          .filter((c: any) => `${c.name || ""} ${c.email || ""} ${c.phone || ""}`.toLowerCase().includes(q))
          .slice(0, 6)
          .map((c: any): SearchHit => ({
            id: `contact:${c.id}`,
            kind: "contact",
            label: c.name || c.email || `Contact #${c.id}`,
            sublabel: [c.email, c.phone].filter(Boolean).join(" · "),
            href: `/contacts?highlight=${c.id}`,
          }));
        const invoices = asArray(invoicesR)
          .filter((i: any) => `${i.invoiceNumber || i.invoice_number || ""} ${i.customerName || i.customer_name || ""} ${i.status || ""}`.toLowerCase().includes(q))
          .slice(0, 6)
          .map((i: any): SearchHit => ({
            id: `invoice:${i.id}`,
            kind: "invoice",
            label: `Invoice ${i.invoiceNumber || i.invoice_number || i.id}`,
            sublabel: [i.status, i.customerName || i.customer_name, i.total ? `$${Number(i.total).toFixed(2)}` : null].filter(Boolean).join(" · "),
            href: `/invoices?highlight=${i.id}`,
          }));
        const estimates = asArray(estimatesR)
          .filter((e: any) => `${e.estimateNumber || e.estimate_number || ""} ${e.title || ""} ${e.status || ""}`.toLowerCase().includes(q))
          .slice(0, 6)
          .map((e: any): SearchHit => ({
            id: `estimate:${e.id}`,
            kind: "estimate",
            label: `Estimate ${e.estimateNumber || e.estimate_number || e.id}${e.title ? ` — ${e.title}` : ""}`,
            sublabel: [e.status, e.total ? `$${Number(e.total).toFixed(2)}` : null].filter(Boolean).join(" · "),
            href: `/estimates/${e.id}`,
          }));
        setHits([...jobs, ...contacts, ...invoices, ...estimates]);
      } catch {
        setHits([]);
      }
    }, 220);
    return () => { if (debounce.current) window.clearTimeout(debounce.current); };
  }, [query]);

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PAGES;
    return PAGES.filter(p => p.label.toLowerCase().includes(q) || (p.hint || "").toLowerCase().includes(q));
  }, [query]);

  const recents = readRecents();

  const go = (item: SearchHit | PageEntry) => {
    pushRecent(item);
    setOpen(false);
    setQuery("");
    navigate((item as any).href);
  };

  const iconFor = (kind: SearchHit["kind"]) =>
    kind === "job" ? Briefcase :
    kind === "contact" ? Users :
    kind === "invoice" ? DollarSign :
    FileText;

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search jobs, contacts, invoices, estimates, or jump to a page…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No results. Try a job number, address, invoice #, or page name.</CommandEmpty>

          {!query && recents.length > 0 && (
            <>
              <CommandGroup heading="Recent">
                {recents.map((r: any) => {
                  const Icon = r.kind ? iconFor(r.kind) : (r.icon || ArrowRight);
                  return (
                    <CommandItem key={`recent-${r.id}`} value={`recent-${r.id}`} onSelect={() => go(r)}>
                      <History className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 truncate">{r.label}</span>
                      <Icon className="ml-2 h-4 w-4 text-muted-foreground" />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {hits.length > 0 && (
            <>
              <CommandGroup heading="Records">
                {hits.map((h) => {
                  const Icon = iconFor(h.kind);
                  return (
                    <CommandItem key={h.id} value={h.id} onSelect={() => go(h)}>
                      <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{h.label}</span>
                        {h.sublabel && <span className="text-xs text-muted-foreground truncate">{h.sublabel}</span>}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          <CommandGroup heading="Jump to a page">
            {filteredPages.map((p) => {
              const Icon = p.icon;
              return (
                <CommandItem key={p.id} value={p.id} onSelect={() => go(p)}>
                  <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="flex-1">{p.label}</span>
                  {p.hint && <span className="text-xs text-muted-foreground">{p.hint}</span>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
