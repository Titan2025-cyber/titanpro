// ─────────────────────────────────────────────────────────────────────────────
// NotifyPicker
//
// A compact chip-based multi-select for choosing which teammates should
// receive a note via email + bell. Renders as a horizontal row of avatar
// chips; clicking a chip toggles it on/off. Selected teammates highlight
// in Titan blue.
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
import { Mail, X } from "lucide-react";

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
  const [expanded, setExpanded] = useState(false);

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

  // Show everyone except the author. Sort selected first, then by name.
  const list = useMemo(() => {
    const filtered = roster.filter(e => e.name.toLowerCase() !== excludeLower);
    return filtered.sort((a, b) => {
      const aSel = selectedIds.includes(a.id) ? 0 : 1;
      const bSel = selectedIds.includes(b.id) ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
      return a.name.localeCompare(b.name);
    });
  }, [roster, selectedIds, excludeLower]);

  const selectedList = list.filter(e => selectedIds.includes(e.id));

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

  const sizeClasses = compact
    ? { chip: "h-6 px-2 text-[10px] gap-1", avatar: "w-4 h-4 text-[8px]", label: "text-[11px]" }
    : { chip: "h-7 px-2.5 text-xs gap-1.5", avatar: "w-5 h-5 text-[9px]", label: "text-xs" };

  return (
    <div className="border border-border rounded-md bg-muted/30 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className={`flex items-center gap-1.5 ${sizeClasses.label} font-medium text-foreground`}>
          <Mail className="w-3.5 h-3.5 text-[hsl(var(--titan-blue))]" />
          Notify
          {selectedList.length > 0 && (
            <span className="ml-1 text-muted-foreground font-normal">
              · {selectedList.length} selected
            </span>
          )}
        </div>
        {selectedList.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-[10px] text-muted-foreground hover:text-foreground underline"
          >
            Clear
          </button>
        )}
      </div>

      {/* Selected chips row (always visible) */}
      {selectedList.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedList.map(e => (
            <button
              key={e.id}
              type="button"
              onClick={() => toggle(e.id)}
              title={e.gmailEmail || "No Gmail on file — bell only"}
              className={`inline-flex items-center rounded-full bg-[hsl(var(--titan-blue))] text-white ${sizeClasses.chip} font-medium hover:bg-[hsl(var(--titan-blue-dark))] transition-colors`}
            >
              <span className={`inline-flex items-center justify-center rounded-full bg-white/25 ${sizeClasses.avatar} font-bold`}>
                {initials(e.name)}
              </span>
              <span className="truncate max-w-[120px]">{e.name}</span>
              <X className="w-3 h-3 opacity-70" />
            </button>
          ))}
        </div>
      )}

      {/* Add-more row: toggles a full list. Kept collapsed by default so the
          composer stays compact — click "Add teammate" to expand. */}
      {!expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={`w-full text-left ${sizeClasses.label} text-muted-foreground hover:text-foreground border border-dashed border-border rounded px-2 py-1.5 hover:bg-background transition-colors`}
        >
          + {selectedList.length === 0 ? "Notify teammates on save" : "Add another teammate"}
        </button>
      )}

      {expanded && (
        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pt-1">
          {list
            .filter(e => !selectedIds.includes(e.id))
            .map(e => (
              <button
                key={e.id}
                type="button"
                onClick={() => toggle(e.id)}
                title={e.gmailEmail ? `Will email ${e.gmailEmail}` : "No Gmail on file — will only send bell"}
                className={`inline-flex items-center rounded-full bg-background border border-border ${sizeClasses.chip} font-medium hover:bg-[hsl(var(--titan-blue))]/10 hover:border-[hsl(var(--titan-blue))] transition-colors ${
                  !e.gmailEmail ? "text-muted-foreground" : ""
                }`}
              >
                <span className={`inline-flex items-center justify-center rounded-full bg-[hsl(var(--titan-blue))] text-white ${sizeClasses.avatar} font-bold`}>
                  {initials(e.name)}
                </span>
                <span className="truncate max-w-[120px]">{e.name}</span>
                {!e.gmailEmail && <span className="text-[9px] text-muted-foreground/70">(bell only)</span>}
              </button>
            ))}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className={`inline-flex items-center rounded-full ${sizeClasses.chip} text-muted-foreground hover:text-foreground`}
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
