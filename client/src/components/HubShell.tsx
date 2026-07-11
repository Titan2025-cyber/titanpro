import { useState, useEffect, ComponentType } from "react";
import { useSearch } from "wouter";

export interface HubTab {
  value: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  component: ComponentType<any>;
}

interface HubShellProps {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  tabs: HubTab[];
}

/**
 * HubShell — renders a consolidated workspace: a compact header plus a
 * horizontal tab bar. Each tab mounts an existing full-page component, so no
 * underlying feature logic changes. The active tab can be deep-linked via the
 * `?tab=<value>` hash query (used by legacy-route redirects).
 */
export default function HubShell({ title, description, icon: Icon, tabs }: HubShellProps) {
  const search = useSearch();
  const initial = (() => {
    const params = new URLSearchParams(search);
    const t = params.get("tab");
    return tabs.some((x) => x.value === t) ? (t as string) : tabs[0].value;
  })();

  const [active, setActive] = useState(initial);

  // Keep active tab in sync if the query changes (e.g. clicking a redirect link)
  useEffect(() => {
    const params = new URLSearchParams(search);
    const t = params.get("tab");
    if (t && tabs.some((x) => x.value === t)) setActive(t);
  }, [search, tabs]);

  const Active = tabs.find((t) => t.value === active)?.component ?? tabs[0].component;

  return (
    <div data-testid={`hub-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      {/* Hub header */}
      <div className="px-6 pt-6 pb-3 border-b bg-background sticky top-0 z-10">
        <div className="flex items-center gap-2 mb-1">
          <Icon className="w-6 h-6 text-[hsl(var(--titan-blue))]" />
          <h1 className="text-2xl font-bold">{title}</h1>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>

        {/* Tab bar */}
        <div className="mt-3 flex flex-wrap gap-1">
          {tabs.map((t) => {
            const TabIcon = t.icon;
            const isActive = t.value === active;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setActive(t.value)}
                data-testid={`hubtab-${t.value}`}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                  isActive
                    ? "bg-[hsl(var(--titan-blue))] text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {TabIcon && <TabIcon className="w-3.5 h-3.5" />}
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active module */}
      <div data-testid={`hubpanel-${active}`}>
        <Active />
      </div>
    </div>
  );
}
