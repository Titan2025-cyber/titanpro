// ─────────────────────────────────────────────────────────────────────────────
// NotifyPicker
//
// Multi-select checklist for choosing which teammates should receive a note
// via email + bell. Renders as an always-open list of rows with a checkbox
// on the left — no expand step, no chip UI. Click a row (or its checkbox)
// to toggle it; the count and a "Clear" affordance sit in the header.
//
// Fetches its own roster from /api/employees. If the fetch fails, renders
// nothing (the note still saves — just nobody gets emailed). The author
// (passed as excludeName) is filtered out so you can't email yourself.
//
// Emits selection changes via `onChange(newIds)`. The parent owns the
// selectedIds state so it can clear the list after a successful save.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Mail, Check } from "lucide-react";

interface Employee {
  id: number;
  name: string;
  role?: string;
  gmailEmail?: string | null;
}

interface Props {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  excludeName?: string;          // author's name — filtered out of the list
  compact?: boolean;             // smaller footprint for mobile Technician surface
}

export function NotifyPicker({ selectedIds, onChange, excludeName, compact }: Props) {
  const [roster, setRoster] = useState<Employee[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiRequest("GET", "/api/employees")
      .then(r => r.json())
      .then((rows: any[]) => {
        if (cancelled) return;
        setRoster(
          (rows || [])
            .filter(e => (e.isActive !== false && e.is_active !== 0))
            .map(e => ({
              id: e.id,
              name: e.name,
              role: e.role,
              gmailEmail: e.gmailEmail ?? e.gmail_email ?? null,
            }))
        );
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const excludeLower = (excludeName || "").toLowerCase();

  // Show everyone except the author, sorted alphabetically. We deliberately
  // do NOT re-sort selected teammates to the top — the list needs to feel
  // stable so checking a box doesn't make the row you just clicked jump.
  const list = useMemo(() => {
    return roster
      .filter(e => e.name.toLowerCase() !== excludeLower)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [roster, excludeLower]);

  function toggle(id: number) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(x => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  if (!loaded) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-1.5 py-1">
        <Mail className="w-3 h-3" />
        Loading teammates…
      </div>
    );
  }

  if (list.length === 0) return null;

  const rowText = compact ? "text-[11px]" : "text-xs";
  const rowPad = compact ? "px-2 py-1" : "px-2 py-1.5";

  return (
    <div className="border border-border rounded-md bg-muted/30 overflow-hidden">
      {/* Header — label + count + clear */}
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-border bg-background/50">
        <div className={`flex items-center gap-1.5 ${rowText} font-medium text-foreground`}>
          <Mail className="w-3.5 h-3.5 text-[hsl(var(--titan-blue))]" />
          Notify teammates
          {selectedIds.length > 0 && (
            <span className="ml-1 text-muted-foreground font-normal">
              · {selectedIds.length} selected
            </span>
          )}
        </div>
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[10px] text-muted-foreground hover:text-foreground underline"
          >
            Clear
          </button>
        )}
      </div>

      {/* Always-open checklist. Each row: checkbox + name + optional
          "(no email)" hint. Clicking anywhere on the row toggles. */}
      <div className="max-h-56 overflow-y-auto divide-y divide-border">
        {list.map(e => {
          const checked = selectedIds.includes(e.id);
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => toggle(e.id)}
              title={e.gmailEmail ? `Will email ${e.gmailEmail}` : "No Gmail on file — will only send bell"}
              className={`w-full flex items-center gap-2 ${rowPad} text-left transition-colors ${
                checked
                  ? "bg-[hsl(var(--titan-blue))]/10 hover:bg-[hsl(var(--titan-blue))]/15"
                  : "hover:bg-background"
              }`}
            >
              {/* Checkbox */}
              <span
                className={`shrink-0 inline-flex items-center justify-center w-4 h-4 rounded border transition-colors ${
                  checked
                    ? "bg-[hsl(var(--titan-blue))] border-[hsl(var(--titan-blue))] text-white"
                    : "bg-background border-border"
                }`}
                aria-hidden
              >
                {checked && <Check className="w-3 h-3" strokeWidth={3} />}
              </span>

              <span className={`${rowText} font-medium text-foreground flex-1 min-w-0 truncate`}>
                {e.name}
                {e.role && <span className="ml-1.5 text-muted-foreground font-normal">· {e.role}</span>}
              </span>

              {!e.gmailEmail && (
                <span className="text-[10px] text-muted-foreground/80 shrink-0">bell only</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
