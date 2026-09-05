import { useEffect, useMemo, ComponentType } from "react";
import { useLocation, useSearch } from "wouter";
import {
  KeyRound, Bell, UserCog, Activity, ShieldCheck, CreditCard,
  Trash2, FileSpreadsheet, QrCode, Users as UsersIcon,
  ExternalLink, Settings as SettingsIcon,
  RefreshCw, ListChecks, ClipboardList,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

// Every settings destination is an existing full-page component. This hub
// mounts them inline in a right-hand pane instead of shipping the user off
// to a separate route each time.
import Security from "@/pages/Security";
import NotificationSettings from "@/pages/NotificationSettings";
import PortalQR from "@/pages/PortalQR";
import UserManagement from "@/pages/UserManagement";
import TeamActivity from "@/pages/TeamActivity";
import Integrations from "@/pages/Integrations";
import ActivityLog from "@/pages/ActivityLog";
import AuditLog from "@/pages/AuditLog";
import TrashPage from "@/pages/Trash";
import DocumentBuilder from "@/pages/DocumentBuilder";
import PartnerPortalSetup from "@/pages/PartnerPortalSetup";
import QBSync from "@/pages/QBSync";
import LineItemLibrary from "@/pages/LineItemLibrary";
import JobTemplates from "@/pages/JobTemplates";

/**
 * Settings hub — left-rail sub-navigation.
 *
 * Every entry mounts an existing full-page component inline in the right
 * pane. The standalone routes (/security, /notification-settings, …) are
 * kept alive so bookmarks and deep links still work; this hub is just a
 * single home for all of them.
 *
 * State lives in the URL as `?section=<value>` so a browser back/refresh
 * lands the user on the same panel and deep links from other pages work.
 * Owner-only and admin-only items are filtered by role; individual
 * destination pages already gate themselves, so this is UI-only.
 */

type SectionKey =
  | "security"
  | "notifications"
  | "portal-qr"
  | "users"
  | "team-activity"
  | "integrations"
  | "qb-sync"
  | "activity"
  | "audit"
  | "trash"
  | "document-builder"
  | "line-items"
  | "job-templates"
  | "partner-portal";

type Item = {
  key: SectionKey;
  label: string;
  desc: string;
  icon: ComponentType<{ className?: string }>;
  component: ComponentType<any>;
  ownerOnly?: boolean;
  adminOnly?: boolean;
};

type Group = {
  title: string;
  items: Item[];
};

const GROUPS: Group[] = [
  {
    title: "Account & Security",
    items: [
      {
        key: "security",
        label: "Security & 2FA",
        desc: "Password, PIN, and two-factor authentication.",
        icon: KeyRound,
        component: Security,
      },
      {
        key: "notifications",
        label: "Notifications",
        desc: "Inbox and per-event delivery preferences.",
        icon: Bell,
        component: NotificationSettings,
      },
      {
        key: "portal-qr",
        label: "Portal QR Codes",
        desc: "Codes that open the customer and partner portals on a phone.",
        icon: QrCode,
        component: PortalQR,
      },
    ],
  },
  {
    title: "People & Access",
    items: [
      {
        key: "users",
        label: "User Management",
        desc: "Add, remove, and set roles for the team.",
        icon: UserCog,
        component: UserManagement,
      },
      {
        key: "team-activity",
        label: "Team Activity",
        desc: "Owner view of what each teammate is doing.",
        icon: UsersIcon,
        component: TeamActivity,
        ownerOnly: true,
      },
    ],
  },
  {
    title: "System",
    items: [
      {
        key: "integrations",
        label: "Integrations",
        desc: "Gmail, Google Maps, QuickBooks, Stripe, and others.",
        icon: CreditCard,
        component: Integrations,
      },
      {
        key: "qb-sync",
        label: "QuickBooks Sync",
        desc: "Sync invoices, payments, and customers with QuickBooks Online.",
        icon: RefreshCw,
        component: QBSync,
        adminOnly: true,
      },
      {
        key: "activity",
        label: "Activity Log",
        desc: "Chronological log of user actions across the app.",
        icon: Activity,
        component: ActivityLog,
      },
      {
        key: "audit",
        label: "Security Audit",
        desc: "Sign-in attempts, permission changes, and other security events.",
        icon: ShieldCheck,
        component: AuditLog,
      },
      {
        key: "trash",
        label: "Trash",
        desc: "Restore or permanently delete removed records.",
        icon: Trash2,
        component: TrashPage,
        adminOnly: true,
      },
    ],
  },
  {
    title: "Templates & Setup",
    items: [
      {
        key: "document-builder",
        label: "Document Templates",
        desc: "Author the templates used for invoices, WAs, and reports.",
        icon: FileSpreadsheet,
        component: DocumentBuilder,
      },
      {
        key: "line-items",
        label: "Line Item Library",
        desc: "Master price list of labor, materials, and Xactimate-style line items.",
        icon: ListChecks,
        component: LineItemLibrary,
      },
      {
        key: "job-templates",
        label: "Job Templates",
        desc: "Reusable job blueprints \u2014 phases, tasks, and defaults for common loss types.",
        icon: ClipboardList,
        component: JobTemplates,
      },
      {
        key: "partner-portal",
        label: "Partner Portal Setup",
        desc: "Branding, invite links, and access rules for the partner portal.",
        icon: ExternalLink,
        component: PartnerPortalSetup,
      },
    ],
  },
];

const DEFAULT_SECTION: SectionKey = "security";

export default function Settings() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const isAdminish = isOwner || user?.role === "admin";

  const [, navigate] = useLocation();
  const search = useSearch();

  // Build the visible groups/items based on role. We compute this once
  // rather than on every render so the "first visible item" fallback below
  // is stable.
  const groups = useMemo(() => {
    return GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((i) => {
        if (i.ownerOnly && !isOwner) return false;
        if (i.adminOnly && !isAdminish) return false;
        return true;
      }),
    })).filter((g) => g.items.length > 0);
  }, [isOwner, isAdminish]);

  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Resolve the active section from ?section=… falling back to Security
  // (or the first visible item, whichever is more useful).
  const activeKey: SectionKey = useMemo(() => {
    const params = new URLSearchParams(search);
    const raw = params.get("section") as SectionKey | null;
    if (raw && flatItems.some((i) => i.key === raw)) return raw;
    if (flatItems.some((i) => i.key === DEFAULT_SECTION)) return DEFAULT_SECTION;
    return flatItems[0]?.key ?? DEFAULT_SECTION;
  }, [search, flatItems]);

  const active = flatItems.find((i) => i.key === activeKey) ?? flatItems[0];

  // If we landed on Settings with no ?section=, normalize the URL so the
  // active item and the URL agree (browser back stays predictable).
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (!params.get("section") && active) {
      navigate(`/settings?section=${active.key}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (key: SectionKey) => {
    navigate(`/settings?section=${key}`);
  };

  if (!active) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No settings available for your role.
      </div>
    );
  }

  const ActiveIcon = active.icon;
  const ActiveComponent = active.component;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-4 md:mb-6">
        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
          <SettingsIcon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Account, security, users, integrations, and admin tools.
          </p>
        </div>
      </div>

      {/* Mobile: section picker at top. Desktop: hidden — the rail handles it. */}
      <div className="md:hidden mb-4">
        <Select value={active.key} onValueChange={(v) => go(v as SectionKey)}>
          <SelectTrigger data-testid="select-settings-section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <div key={g.title}>
                <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.title}
                </div>
                {g.items.map((i) => (
                  <SelectItem key={i.key} value={i.key}>
                    {i.label}
                  </SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid md:grid-cols-[240px,1fr] gap-6">
        {/* Left rail */}
        <nav className="hidden md:block sticky top-4 self-start space-y-5" aria-label="Settings sections">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {g.title}
              </div>
              <div className="space-y-0.5">
                {g.items.map((i) => {
                  const Icon = i.icon;
                  const isActive = i.key === active.key;
                  return (
                    <button
                      key={i.key}
                      type="button"
                      onClick={() => go(i.key)}
                      data-testid={`nav-${i.key}`}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-foreground/80 hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <Icon className={cn("w-4 h-4 shrink-0", isActive && "text-primary")} />
                      <span className="truncate">{i.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Right pane */}
        <div className="min-w-0">
          <Card>
            <CardContent className="p-0">
              {/* Section header inside the panel so the destination page's own
                  H1 isn't lonely and the user always knows where they are. */}
              <div className="flex items-start gap-3 px-4 md:px-6 py-4 border-b border-border/50">
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <ActiveIcon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-sm">{active.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
                    {active.desc}
                  </div>
                </div>
              </div>

              {/* The destination page renders inside. Each one is already a
                  standalone page that expects to own the viewport, so we
                  don't add extra padding here — the page brings its own. */}
              <div className="min-h-[400px]">
                <ActiveComponent />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
