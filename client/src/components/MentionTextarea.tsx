// ─────────────────────────────────────────────────────────────────────────────
// MentionTextarea
//
// A drop-in replacement for shadcn's <Textarea> that pops an autocomplete
// dropdown when the user types "@" — the dropdown lists active teammates and
// tab/enter completes the mention as "@First Last ".
//
// Fetches its own roster from /api/employees (once, on mount). If the fetch
// fails (e.g. permission issues on the tech surface), the component silently
// degrades to a plain textarea — the note still submits, just without the
// autocomplete UI.
//
// The server-side @-mention parser (server/notify_bell.ts) matches both first
// name and full name, so both forms trigger email + bell.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { AtSign } from "lucide-react";

interface Employee { id: number; name: string; role?: string; }

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
  disabled?: boolean;
  testId?: string;
}

export function MentionTextarea({
  value, onChange, placeholder, className, minHeight = "100px", disabled, testId,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [roster, setRoster] = useState<Employee[]>([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [openAt, setOpenAt] = useState<number | null>(null); // caret index where "@" starts
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  // Load the roster once. If it fails, keep the component functional as a
  // plain textarea — the autocomplete just won't fire.
  useEffect(() => {
    let cancelled = false;
    apiRequest("GET", "/api/employees")
      .then(r => r.json())
      .then((rows: any[]) => {
        if (cancelled) return;
        setRoster(
          (rows || [])
            .filter(e => e.isActive !== false && e.is_active !== 0)
            .map(e => ({ id: e.id, name: e.name, role: e.role }))
        );
        setRosterLoaded(true);
      })
      .catch(() => { if (!cancelled) setRosterLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Filtered candidates for the current @query. Match on first name, full name,
  // or "first last" contains — cap to 6 entries to keep the dropdown tidy.
  const candidates = useMemo(() => {
    if (openAt === null) return [];
    const q = query.trim().toLowerCase();
    if (!q) return roster.slice(0, 6);
    return roster
      .filter(e => {
        const n = e.name.toLowerCase();
        const first = n.split(/\s+/)[0];
        return first.startsWith(q) || n.startsWith(q) || n.includes(q);
      })
      .slice(0, 6);
  }, [roster, query, openAt]);

  // Reset the highlight whenever the candidate set changes.
  useEffect(() => { setHighlight(0); }, [query, openAt]);

  function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    onChange(next);
    // Detect whether the caret is currently inside an "@word" mention token.
    const el = e.target;
    const caret = el.selectionStart ?? next.length;
    updateMentionState(next, caret);
  }

  function updateMentionState(text: string, caret: number) {
    // Walk backward from the caret to find an unclosed "@".
    let i = caret - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === "@") {
        // Only treat as a mention if @ is at start or preceded by whitespace/punct.
        const prev = i > 0 ? text[i - 1] : " ";
        if (/[\s\n\r(\[.,;:!?]/.test(prev) || i === 0) {
          const q = text.slice(i + 1, caret);
          // Cancel if the query contains a newline or too many chars.
          if (/[\n\r]/.test(q) || q.length > 30) { setOpenAt(null); return; }
          setOpenAt(i);
          setQuery(q);
          return;
        }
      }
      if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") break;
      i -= 1;
    }
    setOpenAt(null);
    setQuery("");
  }

  function commit(emp: Employee) {
    if (openAt === null) return;
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;
    // Replace the @query with @<Full Name><space>.
    const before = value.slice(0, openAt);
    const after = value.slice(caret);
    const replacement = `@${emp.name} `;
    const next = before + replacement + after;
    onChange(next);
    setOpenAt(null);
    setQuery("");
    // Restore focus + place caret right after the inserted mention.
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = (before + replacement).length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (openAt === null || candidates.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => (h + 1) % candidates.length); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setHighlight(h => (h - 1 + candidates.length) % candidates.length); return; }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commit(candidates[highlight]);
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOpenAt(null); setQuery(""); }
  }

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        className={className}
        style={{ minHeight }}
        placeholder={placeholder}
        value={value}
        onChange={onInput}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpenAt(null), 120)}
        onClick={e => {
          const el = e.currentTarget;
          updateMentionState(el.value, el.selectionStart ?? el.value.length);
        }}
        disabled={disabled}
        data-testid={testId}
      />

      {openAt !== null && candidates.length > 0 && (
        <div
          className="absolute z-30 mt-1 w-72 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
          style={{ top: "100%", left: 12 }}
          onMouseDown={e => e.preventDefault() /* keep textarea focus for onBlur timing */}
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/60 flex items-center gap-1">
            <AtSign className="w-3 h-3" />
            Tag a teammate
          </div>
          {candidates.map((e, idx) => (
            <button
              key={e.id}
              type="button"
              onClick={() => commit(e)}
              onMouseEnter={() => setHighlight(idx)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 border-b border-border/40 last:border-0 ${
                idx === highlight ? "bg-accent" : "hover:bg-accent/60"
              }`}
            >
              <div className="w-6 h-6 rounded-full bg-[hsl(var(--titan-blue))] text-white text-[10px] font-bold flex items-center justify-center">
                {initials(e.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{e.name}</div>
                {e.role && <div className="text-[10px] text-muted-foreground capitalize">{e.role.replace("_", " ")}</div>}
              </div>
            </button>
          ))}
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
