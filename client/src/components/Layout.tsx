import { Link, useLocation } from "wouter";
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
  FileSpreadsheet, ArrowRightLeft, QrCode, Handshake,
} from "lucide-react";
import { useState, useEffect } from "react";
import GlobalSearch from "@/components/GlobalSearch";
import { useAuth } from "@/lib/auth";

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
      { href: "/contacts", label: "Contacts", icon: Users, permission: "contacts" },
      { href: "/estimates", label: "Estimates", icon: FileText, permission: "estimates" },
      { href: "/invoices", label: "Invoices", icon: Receipt, permission: "invoices" },
      { href: "/payments", label: "Payments", icon: DollarSign, permission: "payments" },
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
      { href: "/photos", label: "Photos", icon: Camera, permission: "photos" },
      { href: "/inspections", label: "Pre-Job Inspections", icon: ClipboardList, permission: "technician" },
      { href: "/multilingual", label: "Multilingual Crew", icon: Languages, permission: "technician" },
      { href: "/drone-lidar", label: "Drone + LiDAR", icon: Radio, permission: "technician" },
      { href: "/voice-note", label: "Voice-to-Note", icon: Mic, permission: "technician" },
      { href: "/photo-classifier", label: "AI Photo Classifier", icon: Camera, permission: "photos" },
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
      { href: "/line-items", label: "Line Item Library", icon: BookOpen, permission: "supplements" },
      { href: "/claim-explainer", label: "Claim Explainer", icon: BookOpen, permission: "supplements" },
      { href: "/invoice-escalation", label: "Invoice Escalation", icon: Scale, permission: "supplements" },
      { href: "/claim-file-checker", label: "Claim File Checker", icon: ShieldCheck, permission: "supplements" },
      { href: "/op-rebuttal", label: "O&P Rebuttal Builder", icon: Scale, permission: "supplements" },
      { href: "/general-conditions", label: "General Conditions", icon: ClipboardCheck, permission: "supplements" },
      { href: "/approved-claims", label: "Approved Claims Library", icon: Library, permission: "supplements" },
      { href: "/subrogation", label: "Subrogation Tracker", icon: Gavel, permission: "supplements" },
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
      { href: "/ramp-import", label: "Ramp Import", icon: CreditCard, permission: "ramp" },
      { href: "/qb-sync", label: "QuickBooks Sync", icon: BookMarked, permission: "finance" },
      { href: "/command-bi", label: "Command BI", icon: Brain, permission: "finance" },
      { href: "/nps-surveys", label: "NPS Surveys", icon: Star, permission: "finance" },
      { href: "/predictive-model", label: "Predictive Model", icon: TrendingUp, permission: "finance" },
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
      { href: "/lead-attribution", label: "Lead Attribution", icon: BarChart3, permission: "business-dev" },
      { href: "/partner-portal-setup", label: "Partner Portal Setup", icon: KeyRound, permission: "partner-portal" },
      { href: "/follow-ups", label: "Follow-Ups", icon: Bell, permission: "follow-ups" },
      { href: "/reviews", label: "Review Requests", icon: Star, permission: "follow-ups" },
      { href: "/emergency-intake", label: "Emergency Intake", icon: LifeBuoy, permission: "business-dev" },
      { href: "/fnol-chatbot", label: "FNOL Intake Bot", icon: Bot, permission: "business-dev" },
      { href: "/route-planner", label: "Route Planner", icon: RouteIcon, permission: "route-planner" },
      { href: "/bd-calendar", label: "BD Calendar", icon: CalendarDays, permission: "business-dev" },
      { href: "/coi-tracker", label: "COI & License Tracker", icon: Shield, permission: "business-dev" },
      { href: "/bid-intel", label: "Competitive Bid Intel", icon: Target, permission: "business-dev" },
      // — Builder, Migration & Reports —
      { href: "/document-builder", label: "Document Builder", icon: FileSpreadsheet, permission: "reports" },
      { href: "/migration-center", label: "Migration Center", icon: ArrowRightLeft, permission: "finance" },
      { href: "/reports", label: "Reports", icon: BarChart3, permission: "reports" },
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

  // ─── 9. ADMIN & TOOLS ─────────────────────────────────────────────────────
  {
    label: "Admin & Tools",
    icon: ShieldCheck,
    description: "Audit logs, integrations & settings",
    items: [
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
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout, can } = useAuth();
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
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-[hsl(var(--sidebar-border))]">
        <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center shrink-0 p-1 shadow-sm">
          <img src={titanLogo} alt="Titan Restoration" className="w-full h-full object-contain" />
        </div>
        <div>
          <p className="font-bold text-sm text-[hsl(var(--sidebar-fg))] leading-tight">Titan Pro</p>
          <p className="text-xs text-[hsl(var(--sidebar-fg))] opacity-60 leading-tight">Restoration CRM</p>
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
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all ${
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
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-all ${
                          active
                            ? "bg-[hsl(var(--titan-red))] text-white font-medium shadow-sm"
                            : "text-[hsl(var(--sidebar-fg))] opacity-75 hover:opacity-100 hover:bg-[hsl(var(--sidebar-border))]"
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
            <div className="w-7 h-7 rounded-full bg-[hsl(var(--titan-red))] flex items-center justify-center text-white text-xs font-bold shrink-0">
              {user.avatarInitials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold leading-tight truncate text-[hsl(var(--sidebar-fg))]">{user.name}</p>
              <p className="text-[10px] text-[hsl(var(--sidebar-fg))] opacity-50 capitalize leading-tight">{user.position || user.role}</p>
            </div>
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
      <aside className="print-hide hidden lg:flex flex-col w-52 shrink-0 bg-[hsl(var(--sidebar-bg))] border-r border-[hsl(var(--sidebar-border))]">
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
        <header className="print-hide flex items-center gap-3 px-4 py-2.5 border-b bg-background">
          <button onClick={() => setMobileOpen(true)} className="p-1.5 rounded hover:bg-muted lg:hidden">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 lg:hidden">
            <div className="w-6 h-6 rounded bg-[hsl(var(--titan-red))] flex items-center justify-center">
              <span className="text-white font-black text-xs">T</span>
            </div>
            <span className="font-bold text-sm">Titan Pro</span>
          </div>
          <div className="flex-1 flex justify-end lg:justify-start">
            <GlobalSearch />
          </div>
          {/* Auth user chip — desktop only (sidebar already shows user) */}
          {user && (
            <div className="flex items-center gap-2 shrink-0">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-semibold leading-tight">{user.name}</span>
                <span className="text-[10px] text-muted-foreground capitalize leading-tight">{user.position || user.role}</span>
              </div>
              <div className="w-8 h-8 rounded-full bg-[hsl(var(--titan-red))] flex items-center justify-center text-white text-xs font-bold shrink-0 cursor-pointer" title={user.name}>
                {user.avatarInitials}
              </div>
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

        {/* Offline banner */}
        {isOffline && (
          <div className="bg-yellow-500 text-yellow-950 text-xs font-semibold px-4 py-1.5 flex items-center justify-center gap-2 shrink-0">
            <span>⚠️</span>
            <span>You are offline — some features may not work until your connection is restored.</span>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}

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
    </div>
  );
}
