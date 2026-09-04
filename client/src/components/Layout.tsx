import { Link, useLocation } from "wouter";
import { motion, useReducedMotion } from "framer-motion";
import titanLogo from "@/assets/titan-logo.png";
import { prefetchRoute } from "@/lib/prefetch";
import {
  LayoutDashboard, Briefcase, FileText, Receipt, DollarSign,
  MessageSquare, Mail, Camera, Users, Megaphone, Calendar,
  ExternalLink, Home, HardHat, Menu, X, Phone,
  Wrench, TrendingUp, FileCheck, Star, BarChart3,
  UserCheck, Bell, ShieldAlert, ChevronDown, ChevronRight,
  BookOpen, PieChart, ClipboardList, Clock, Search, GraduationCap, Award,
  Activity, MessageCircle, LayoutTemplate, Shield, ShieldCheck, Upload, Bot, GitBranch,
  Zap, CloudLightning, Wifi, CheckSquare, Globe, Gavel, Radio,
  CreditCard, Target, LifeBuoy, Languages, History, Cpu,
  BookMarked, TrendingDown, ClipboardCheck, CalendarClock,
  AlertTriangle, Brain, BarChart2,
  ScanLine, Scale, Library, GraduationCap as GradCap, Truck, Route as RouteIcon, CalendarDays,
  Timer, User, Grid3X3, Building2, Banknote, HardDriveUpload,
  Droplets, Mic, FileSearch, UserRound, Trophy, UserCog, KeyRound,
  FileSpreadsheet, ArrowRightLeft, QrCode, Handshake, ArrowLeft, LayoutDashboard as DashIcon,
  Package, Lock, Inbox,
  Trash2,
} from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";
import GlobalSearch from "@/components/GlobalSearch";
import MyAccountDialog from "@/components/MyAccountDialog";
import InstallPrompt from "@/components/InstallPrompt";
import { useAuth } from "@/lib/auth";
import { NotificationBell } from "@/components/NotificationBell";
import { PendingSignaturesBadge } from "@/components/PendingSignaturesBadge";

interface NavItem {
  href: string;
  label: string;
  icon: any;
  permission?: string;
  badge?: string; // optional badge text
  ownerOnly?: boolean; // strictly role === "owner" (excludes GM/admin/etc.)
}

interface NavGroup {
  label: string;
  icon: any;           // group-level icon shown in header
  description: string; // short subtitle shown under group label
  items: NavItem[];
  defaultOpen?: boolean;
}

const navGroups: NavGroup[] = [
  // ─── 0. AI AGENT CENTER (owner + general manager) ─────────────────────────
  {
    label: "AI Agent Center",
    icon: Bot,
    description: "Autonomous job-file agents",
    defaultOpen: true,
    items: [
      { href: "/ai-agent", label: "AI Agent Center", icon: Bot, permission: "ai-agent" },
    ],
  },

  // ─── 1. CORE ──────────────────────────────────────────────────────────────
  {
    label: "Core",
    icon: LayoutDashboard,
    description: "Dashboard & daily ops",
    defaultOpen: true,
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard" },
      { href: "/jobs", label: "Jobs", icon: Briefcase, permission: "jobs" },
      { href: "/jobs/closed", label: "Closed Jobs", icon: Lock, permission: "jobs", adminOnly: true },
      { href: "/contacts", label: "Contacts", icon: Users, permission: "contacts" },
      { href: "/estimates", label: "Estimates", icon: FileText, permission: "estimates" },
      { href: "/invoices", label: "Invoices", icon: Receipt, permission: "invoices" },
      { href: "/payments", label: "Payments", icon: DollarSign, permission: "payments" },
      { href: "/escalation-outbox", label: "Escalation Outbox", icon: Inbox, permission: "admin", adminOnly: true },
      // Global Search is a universal utility — available to any signed-in user.
      { href: "/global-search", label: "Global Search", icon: Search },
    ],
  },

  // ─── 2. FIELD OPS ─────────────────────────────────────────────────────────
  {
    label: "Field Ops",
    icon: HardHat,
    description: "Techs, scheduling & mitigation",
    items: [
      // — Consolidated hubs (each combines several tools as tabs) —
      { href: "/scheduling-hub", label: "Scheduling & Dispatch", icon: Calendar, permission: "scheduling" },
      { href: "/technician-hub", label: "Technicians", icon: HardHat, permission: "technician" },
      { href: "/safety-hub", label: "Safety", icon: ShieldAlert, permission: "safety" },
      { href: "/drying-hub", label: "Drying & Compliance", icon: Droplets, permission: "technician" },
      // — Standalone field tools —
      { href: "/time-clock", label: "GPS Time Clock", icon: ClipboardCheck, permission: "time-clock" },
      // Photos Hub (capture + search + AI classify) replaces three separate items.
      { href: "/photos-hub", label: "Photos", icon: Camera, permission: "photos" },
      { href: "/inspections", label: "Pre-Job Inspections", icon: ClipboardList, permission: "technician" },
      { href: "/multilingual", label: "Multilingual Crew", icon: Languages, permission: "technician" },
      { href: "/drone-lidar", label: "Drone + LiDAR", icon: Radio, permission: "technician" },
      { href: "/job-age-alerts", label: "Job Age Alerts", icon: Clock, permission: "jobs" },
    ],
  },

  // ─── 3. EQUIPMENT & FLEET ─────────────────────────────────────────────────
  {
    label: "Equipment & Fleet",
    icon: Wrench,
    description: "Gear, vehicles & ROI",
    items: [
      { href: "/equipment-hub", label: "Equipment", icon: Wrench, permission: "equipment" },
      { href: "/inventory", label: "Consumables Inventory", icon: Package, permission: "equipment" },
      { href: "/fleet", label: "Fleet Manager", icon: Truck, permission: "equipment" },
    ],
  },

  // ─── 4. INSURANCE & CLAIMS ────────────────────────────────────────────────
  {
    label: "Insurance & Claims",
    icon: Shield,
    description: "Supplements, carriers & AI tools",
    items: [
      // — Consolidated Hubs (each hub combines several tools as tabs) —
      { href: "/supplement-hub", label: "Supplements", icon: FileCheck, permission: "supplements" },
      { href: "/xactimate-hub", label: "Xactimate", icon: ScanLine, permission: "supplements" },
      { href: "/carrier-hub", label: "Carrier Intelligence", icon: Shield, permission: "supplements" },
      { href: "/adjuster-hub", label: "Adjusters", icon: UserRound, permission: "supplements" },
      // — Standalone claim tools —
      // Supplement Hub now hosts: O&P Rebuttal, General Conditions,
      // Approved Claims Library, Claim File Checker, Customer Claim Explainer,
      // Subrogation Tracker, and Competitive Bid Intel as tabs. Only Invoice
      // Escalation, Price Lists, and Job Costing remain top-level here.
      { href: "/line-items", label: "Price Lists", icon: BookOpen, permission: "supplements" },
      { href: "/invoice-escalation", label: "Invoice Escalation", icon: Scale, permission: "supplements" },
      { href: "/job-costing", label: "Job Costing", icon: PieChart, permission: "job-costing" },
    ],
  },

  // ─── 5. FINANCE ───────────────────────────────────────────────────────────
  {
    label: "Finance",
    icon: Banknote,
    description: "Revenue, A/R, payouts & reporting",
    items: [
      // — Consolidated hubs (each combines several tools as tabs) —
      { href: "/profitability-hub", label: "Profitability", icon: TrendingUp, permission: "finance" },
      { href: "/ar-hub", label: "Accounts Receivable", icon: CreditCard, permission: "finance" },
      // — Standalone finance tools —
      { href: "/weekly-billing", label: "Weekly Billing", icon: CalendarDays, permission: "weekly-billing" },
      { href: "/lien-waivers", label: "Lien Waivers", icon: FileCheck, permission: "finance" },
      { href: "/cash-flow", label: "Cash Flow Calendar", icon: Calendar, permission: "finance" },
      { href: "/payment-plans", label: "Payment Plans", icon: DollarSign, permission: "finance" },
      { href: "/qb-sync", label: "QuickBooks Sync", icon: BookMarked, permission: "finance" },
      // Command BI, NPS, Predictive Model, Analytics, Lead Attribution, and
      // Reports are all consolidated into the Reports & BI Hub below.
      { href: "/reports-hub", label: "Reports & BI", icon: BarChart3, permission: "reports" },
    ],
  },

  // ─── 6. BUSINESS DEV ──────────────────────────────────────────────────────
  {
    label: "Business Dev",
    icon: Building2,
    description: "Marketing, referrals & growth",
    items: [
      // — Consolidated hubs (each combines several tools as tabs) —
      { href: "/partner-hub", label: "Referrals & Partners", icon: Handshake, permission: "partner-portal" },
      { href: "/marketing-hub", label: "Marketing", icon: Megaphone, permission: "marketing" },
      // — Standalone growth tools —
      { href: "/partner-portal-setup", label: "Partner Portal Setup", icon: KeyRound, permission: "partner-portal" },
      { href: "/follow-ups", label: "Follow-Ups", icon: Bell, permission: "follow-ups" },
      { href: "/reviews", label: "Review Requests", icon: Star, permission: "follow-ups" },
      // Intake Hub bundles Emergency Intake, FNOL Bot, and Voice-to-Note.
      { href: "/intake-hub", label: "Intake", icon: LifeBuoy, permission: "business-dev" },
      { href: "/route-planner", label: "Route Planner", icon: RouteIcon, permission: "route-planner" },
      { href: "/bd-calendar", label: "BD Calendar", icon: CalendarDays, permission: "business-dev" },
      // Subcontractors Hub bundles the roster + COI/License tracker.
      { href: "/subcontractors-hub", label: "Subcontractors", icon: HardHat, permission: "business-dev" },
      // — Builder & Migration —
      { href: "/document-builder", label: "Document Builder", icon: FileSpreadsheet, permission: "reports" },
      { href: "/migration-center", label: "Migration Center", icon: ArrowRightLeft, permission: "finance" },
      { href: "/trash", label: "Trash", icon: Trash2, permission: "admin", adminOnly: true },
    ],
  },

  // ─── 7. COMMS ─────────────────────────────────────────────────────────────
  {
    label: "Comms",
    icon: MessageSquare,
    description: "Messages, email & SMS",
    items: [
      { href: "/comms-hub", label: "Communications", icon: MessageSquare, permission: "messaging" },
    ],
  },

  // ─── 8. DOCUMENTS ─────────────────────────────────────────────────────────
  {
    label: "Documents",
    icon: FileText,
    description: "Templates & job documents",
    items: [
      { href: "/job-templates", label: "Job Templates", icon: LayoutTemplate, permission: "jobs" },
    ],
  },

  // ─── 8b. PEOPLE & HR ──────────────────────────────────────────────────────
  {
    label: "People & HR",
    icon: Users,
    description: "Employees, handbook, trainings & AI HR assistant",
    items: [
      { href: "/hr-hub", label: "HR Management", icon: Users, permission: "hr" },
    ],
  },

  // ─── 9. ADMIN & TOOLS ─────────────────────────────────────────────────────
  {
    label: "Admin & Tools",
    icon: ShieldCheck,
    description: "Audit logs, integrations & settings",
    items: [
      { href: "/security", label: "Security & 2FA", icon: KeyRound },
      { href: "/user-management", label: "User Management", icon: UserCog, permission: "user-management" },
      { href: "/team-activity", label: "Team Activity", icon: Activity, ownerOnly: true },
      { href: "/activity", label: "Activity Log", icon: Activity, permission: "activity-log" },
      { href: "/audit-log", label: "Security Audit", icon: ShieldCheck, permission: "activity-log" },
      { href: "/integrations", label: "Integrations", icon: CreditCard, permission: "settings" },
      { href: "/tech-notifications", label: "Tech Alerts", icon: Bell, permission: "technician" },
    ],
  },

  // ─── 10. PORTALS ──────────────────────────────────────────────────────────
  {
    label: "Portals",
    icon: ExternalLink,
    description: "Partner & customer portals",
    items: [
      { href: "/portal-qr", label: "Portal QR Codes", icon: QrCode, permission: "customer-portal" },
      { href: "/partner-portal", label: "Partner Portal", icon: ExternalLink, permission: "partner-portal" },
      { href: "/customer-portal", label: "Customer Portal", icon: Home, permission: "customer-portal" },
    ],
  },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // On the dashboard itself there is nowhere "back" to go and no need for a
  // Dashboard shortcut, so the quick-nav bar is hidden there.
  const isDashboard = location === "/";

  const goBack = () => {
    // Prefer real browser history so "Back" returns to the exact previous task
    // (e.g. the specific job or estimate the user came from). Fall back to the
    // Dashboard if there is no in-app history (e.g. deep-linked / fresh tab).
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigate("/");
    }
  };
  const { user, logout, can } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(typeof navigator !== 'undefined' ? !navigator.onLine : false);

  // Initialize collapsed state: defaultOpen groups start open, others collapsed
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    const state: Record<string, boolean> = {};
    navGroups.forEach(g => {
      state[g.label] = !g.defaultOpen; // collapsed = true means hidden
    });
    return state;
  });

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  // Close the mobile nav drawer on Escape. All other modals in the app respect
  // Escape; the drawer previously only closed on backdrop click (fixed 2026-08-14).
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // Auto-expand the group containing the active route
  useEffect(() => {
    navGroups.forEach(group => {
      const hasActive = group.items.some(item =>
        location === item.href || (item.href !== "/" && location.startsWith(item.href))
      );
      if (hasActive) {
        setCollapsedGroups(prev => ({ ...prev, [group.label]: false }));
      }
    });
  }, [location]);

  const toggleGroup = (label: string) => {
    setCollapsedGroups(prev => ({ ...prev, [label]: !prev[label] }));
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-[hsl(var(--sidebar-border))] relative overflow-hidden">
        {/* ambient glow behind the logo */}
        <div className="pointer-events-none absolute -top-8 -left-6 w-32 h-32 rounded-full blur-2xl"
             style={{ background: "radial-gradient(circle, hsl(var(--titan-red)/0.35), transparent 70%)" }} />
        <div className="pointer-events-none absolute -bottom-10 right-0 w-32 h-32 rounded-full blur-2xl"
             style={{ background: "radial-gradient(circle, hsl(var(--titan-blue)/0.28), transparent 70%)" }} />
        <div className="tp-logo-ring tp-logo-ring--live relative shrink-0">
          <div className="w-9 h-9 bg-white flex items-center justify-center p-1">
            <img src={titanLogo} alt="Titan Restoration" className="w-full h-full object-contain" />
          </div>
        </div>
        <div className="relative">
          <p className="font-bold text-sm leading-tight tp-gradient-text">Titan Pro</p>
          <p className="text-[0.68rem] font-semibold text-[hsl(var(--sidebar-fg))] opacity-60 leading-tight tracking-[0.14em] uppercase">Command Center</p>
        </div>
      </div>

      {/* Phone */}
      <div className="px-4 py-2 border-b border-[hsl(var(--sidebar-border))]">
        <a href="tel:7069220154" className="flex items-center gap-1.5 text-xs text-[hsl(var(--sidebar-fg))] opacity-70 hover:opacity-100 transition-opacity">
          <Phone className="w-3 h-3" />706-922-0154
        </a>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto py-2 pb-4 px-2 space-y-0.5">
        {navGroups.map((group, groupIdx) => {
          const GroupIcon = group.icon;
          const isCollapsed = collapsedGroups[group.label];
          const visibleItems = group.items.filter(item => {
            if (item.ownerOnly && user?.role !== "owner") return false;
            if ((item as any).adminOnly && user?.role !== "owner" && user?.role !== "admin") return false;
            return !item.permission || can(item.permission);
          });
          if (visibleItems.length === 0) return null;

          const hasActive = visibleItems.some(item =>
            location === item.href || (item.href !== "/" && location.startsWith(item.href))
          );

          return (
            <div key={group.label} className={`${groupIdx > 0 ? "mt-1" : ""}`}>
              {/* Group header button */}
              <button
                onClick={() => toggleGroup(group.label)}
                className={`w-full flex items-center gap-2 px-2 py-3 lg:py-1.5 rounded-lg transition-all ${
                  hasActive
                    ? "text-[hsl(var(--titan-red))] bg-[hsl(var(--titan-red)/0.06)]"
                    : "text-[hsl(var(--sidebar-fg))] opacity-60 hover:opacity-90 hover:bg-[hsl(var(--sidebar-border)/0.5)]"
                }`}
              >
                <GroupIcon className={`w-3.5 h-3.5 shrink-0 ${hasActive ? "text-[hsl(var(--titan-red))]" : ""}`} />
                <div className="flex-1 text-left min-w-0">
                  <p className={`text-xs font-bold uppercase tracking-wider leading-tight truncate ${hasActive ? "text-[hsl(var(--titan-red))]" : ""}`}>
                    {group.label}
                  </p>
                </div>
                {isCollapsed
                  ? <ChevronRight className="w-3 h-3 shrink-0 opacity-60" />
                  : <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
                }
              </button>

              {/* Nav items */}
              {!isCollapsed && (
                <div className="space-y-0.5 mt-0.5 ml-1 pl-2 border-l border-[hsl(var(--sidebar-border))]">
                  {visibleItems.map(({ href, label, icon: Icon, badge }) => {
                    const active = location === href || (href !== "/" && location.startsWith(href));
                    return (
                      <Link
                        key={href}
                        href={href}
                        onClick={() => setMobileOpen(false)}
                        onMouseEnter={() => prefetchRoute(href)}
                        onFocus={() => prefetchRoute(href)}
                        className={`flex items-center gap-2 px-2.5 py-3 lg:py-1.5 rounded-md text-sm transition-all min-h-[44px] lg:min-h-0 ${
                          active
                            ? "bg-gradient-to-r from-[hsl(var(--titan-red))] to-[hsl(var(--titan-red-dark))] text-white font-medium shadow-[0_0_16px_-2px_hsl(var(--titan-red)/0.6)] ring-1 ring-white/10"
                            : "text-[hsl(var(--sidebar-fg))] opacity-75 hover:opacity-100 hover:bg-[hsl(var(--sidebar-border))] hover:translate-x-0.5"
                        }`}
                        data-testid={`nav-${href.replace(/\//g, "-").replace(/^-/, "") || "dashboard"}`}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="flex-1 truncate">{label}</span>
                        {badge && (
                          <span className="text-[10px] font-bold bg-[hsl(var(--titan-red))] text-white rounded-full px-1.5 py-0.5 leading-none">
                            {badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User + footer */}
      <div className="px-3 py-3 border-t border-[hsl(var(--sidebar-border))] space-y-1">
        {user && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAccountOpen(true)}
              className="flex items-center gap-2 flex-1 min-w-0 text-left rounded hover:bg-[hsl(var(--sidebar-border)/0.4)] px-1 py-0.5 -mx-1 transition-colors"
              title="My Account — change email, password, PIN"
              data-testid="button-open-my-account"
            >
              <div className="w-7 h-7 rounded-full bg-[hsl(var(--titan-red))] flex items-center justify-center text-white text-xs font-bold shrink-0">
                {user.avatarInitials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold leading-tight truncate text-[hsl(var(--sidebar-fg))]">{user.name}</p>
                <p className="text-[10px] text-[hsl(var(--sidebar-fg))] opacity-50 capitalize leading-tight">{user.position || user.role}</p>
              </div>
            </button>
            <button
              onClick={() => logout()}
              className="text-[10px] text-[hsl(var(--sidebar-fg))] opacity-40 hover:opacity-80 hover:text-[hsl(var(--titan-red))] transition-colors shrink-0 font-medium"
              title="Sign out"
            >
              Out
            </button>
          </div>
        )}
        <p className="text-[10px] text-[hsl(var(--sidebar-fg))] opacity-30 leading-tight">Titan Restoration · Augusta, GA</p>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside
        className="print-hide hidden lg:flex flex-col w-52 shrink-0 border-r border-[hsl(var(--sidebar-border))] relative z-10"
        style={{
          backgroundImage:
            "linear-gradient(180deg, hsl(var(--sidebar-bg)), hsl(224 42% 5%))",
          boxShadow: "1px 0 0 0 hsl(214 60% 60% / 0.06), 12px 0 40px -24px hsl(220 60% 2% / 0.9)",
        }}
      >
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-[hsl(var(--sidebar-bg))] z-50 shadow-xl">
            <div className="flex justify-end p-2">
              <button onClick={() => setMobileOpen(false)} className="p-1.5 rounded hover:bg-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="print-hide flex items-center gap-3 px-4 py-2.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--background)/0.7)] backdrop-blur-md supports-[backdrop-filter]:bg-[hsl(var(--background)/0.55)] relative z-20">
          <button onClick={() => setMobileOpen(true)} className="p-1.5 rounded hover:bg-muted lg:hidden">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 lg:hidden">
            <div className="tp-logo-ring shrink-0">
              <div className="w-6 h-6 bg-white flex items-center justify-center p-0.5">
                <img src={titanLogo} alt="Titan Restoration" className="w-full h-full object-contain" />
              </div>
            </div>
            <span className="font-bold text-sm tp-gradient-text">Titan Pro</span>
          </div>
          <div className="flex-1 flex justify-end lg:justify-start">
            <GlobalSearch />
          </div>
          {/* Pending-signatures counter — outstanding customer signatures across all jobs. */}
          {user && <PendingSignaturesBadge />}
          {/* Notification bell — available whenever a user is signed in. */}
          {user && <NotificationBell />}
          {/* Auth user chip — desktop only (sidebar already shows user) */}
          {user && (
            <div className="flex items-center gap-2 shrink-0">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-semibold leading-tight">{user.name}</span>
                <span className="text-[10px] text-muted-foreground capitalize leading-tight">{user.position || user.role}</span>
              </div>
              <button
                onClick={() => setAccountOpen(true)}
                className="w-8 h-8 rounded-full bg-[hsl(var(--titan-red))] flex items-center justify-center text-white text-xs font-bold shrink-0 cursor-pointer hover:ring-2 hover:ring-[hsl(var(--titan-red)/0.4)] transition"
                title="My Account — change email, password, PIN"
                data-testid="button-open-my-account-topbar"
              >
                {user.avatarInitials}
              </button>
              <button
                onClick={() => logout()}
                className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors hidden sm:block"
                title="Sign out"
              >
                Sign out
              </button>
            </div>
          )}
        </header>

        {/* Quick-nav bar — persistent "Back" + "Dashboard" available in every
            module. Hidden on the Dashboard itself (nothing to go back to). */}
        {!isDashboard && (
          <div className="print-hide flex items-center gap-2 px-4 py-1.5 border-b bg-muted/40 shrink-0">
            <button
              onClick={goBack}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-md hover:bg-background border border-transparent hover:border-border transition-colors"
              title="Go back to the previous task"
              data-testid="button-nav-back"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-md hover:bg-background border border-transparent hover:border-border transition-colors"
              title="Return to the Dashboard"
              data-testid="button-nav-dashboard"
            >
              <DashIcon className="w-3.5 h-3.5" />
              Dashboard
            </button>
          </div>
        )}

        {/* Offline banner — superseded by the global <OfflineIndicator/> which
            shows an accurate offline-first message plus live sync/queue status.
            Kept intentionally empty here to avoid two stacked offline bars. */}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <RouteReveal location={location}>{children}</RouteReveal>

          {/* Proprietary / copyright footer */}
          <footer className="print-hide mt-8 pt-4 border-t text-center text-[10px] leading-relaxed text-muted-foreground">
            <p>© 2026 Titan Restoration LLC. All rights reserved.</p>
            <p>Titan Pro is proprietary and confidential software. Unauthorized copying, distribution, or reverse-engineering is prohibited.</p>
            <p className="mt-1">
              <a href="#/terms" className="hover:underline hover:text-foreground">Terms of Service</a>
            </p>
          </footer>
        </main>
      </div>

      <MyAccountDialog open={accountOpen} onOpenChange={setAccountOpen} />

      {/* Add-to-home-screen banner for phones. Only renders when the browser
          fires beforeinstallprompt (Android/Chrome) or when running iOS
          Safari not already in standalone mode. Auto-hidden once installed. */}
      <InstallPrompt />
    </div>
  );
}

// Subtle per-route fade-up. Keyed on wouter location so it re-triggers on navigation.
function RouteReveal({ location, children }: { location: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  if (reduced) return <>{children}</>;
  return (
    <motion.div
      key={location}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}
