import { Link } from "wouter";
import {
  KeyRound, Bell, UserCog, Activity, ShieldCheck, CreditCard,
  Trash2, FileSpreadsheet, QrCode, Users as UsersIcon,
  ExternalLink, Settings as SettingsIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";

/**
 * Settings hub. Replaces the old "Admin & Tools" sidebar group.
 *
 * Every card here is a link into a page that already existed on its own
 * route — this page just consolidates them so the sidebar isn't a wall of
 * once-a-month admin rows. Grouped by intent:
 *
 *  - Account & Security  (Security & 2FA, Notifications, Portal QR)
 *  - People & Access     (Users, Team Activity)
 *  - System              (Integrations, Activity Log, Security Audit, Trash)
 *  - Templates & Setup   (Document Builder, Partner Portal Setup)
 *
 * Owner-only and admin-only cards are filtered here rather than at the
 * route layer so the destinations still work if someone deep-links (the
 * destination pages already gate themselves).
 */

type Card = {
  href: string;
  label: string;
  desc: string;
  icon: typeof KeyRound;
  ownerOnly?: boolean;
  adminOnly?: boolean;
};

type Section = {
  title: string;
  cards: Card[];
};

const SECTIONS: Section[] = [
  {
    title: "Account & Security",
    cards: [
      {
        href: "/security",
        label: "Security & 2FA",
        desc: "Password, PIN, and two-factor authentication for your account.",
        icon: KeyRound,
      },
      {
        href: "/notification-settings",
        label: "Notifications",
        desc: "Email, push, and SMS preferences for every alert type — including tech-specific alerts.",
        icon: Bell,
      },
      {
        href: "/portal-qr",
        label: "Portal QR Codes",
        desc: "Print or download QR codes that open the customer and partner portals on a phone.",
        icon: QrCode,
      },
    ],
  },
  {
    title: "People & Access",
    cards: [
      {
        href: "/user-management",
        label: "User Management",
        desc: "Add, remove, and set roles for employees, owners, techs, and office staff.",
        icon: UserCog,
      },
      {
        href: "/team-activity",
        label: "Team Activity",
        desc: "Owner view of what each person on the team is doing across the app.",
        icon: UsersIcon,
        ownerOnly: true,
      },
    ],
  },
  {
    title: "System",
    cards: [
      {
        href: "/integrations",
        label: "Integrations",
        desc: "Connect Gmail, Google Maps, QuickBooks, Stripe, and other third-party services.",
        icon: CreditCard,
      },
      {
        href: "/activity",
        label: "Activity Log",
        desc: "Chronological log of user actions across jobs, estimates, documents, and payments.",
        icon: Activity,
      },
      {
        href: "/audit-log",
        label: "Security Audit",
        desc: "Sign-in attempts, permission changes, and other security-relevant events.",
        icon: ShieldCheck,
      },
      {
        href: "/trash",
        label: "Trash",
        desc: "Restore or permanently delete jobs, contacts, and documents that were removed.",
        icon: Trash2,
        adminOnly: true,
      },
    ],
  },
  {
    title: "Templates & Setup",
    cards: [
      {
        href: "/document-builder",
        label: "Document Templates",
        desc: "Author and edit the templates used for invoices, work authorizations, and reports.",
        icon: FileSpreadsheet,
      },
      {
        href: "/partner-portal-setup",
        label: "Partner Portal Setup",
        desc: "Configure branding, invite links, and access rules for the referral-partner portal.",
        icon: ExternalLink,
      },
    ],
  },
];

export default function Settings() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const isAdminish = isOwner || user?.role === "admin";

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
          <SettingsIcon className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Account, security, users, integrations, and admin tools.
          </p>
        </div>
      </div>

      {SECTIONS.map((section) => {
        // Filter cards by role. If a whole section has no visible cards, hide
        // the section header too rather than leaving an empty label.
        const visible = section.cards.filter((card) => {
          if (card.ownerOnly && !isOwner) return false;
          if (card.adminOnly && !isAdminish) return false;
          return true;
        });
        if (visible.length === 0) return null;

        return (
          <section key={section.title} className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {section.title}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {visible.map((card) => {
                const Icon = card.icon;
                return (
                  <Link key={card.href} href={card.href}>
                    <Card className="cursor-pointer hover:border-primary transition-colors h-full">
                      <CardContent className="p-4 flex gap-3">
                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-sm">{card.label}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
                            {card.desc}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
