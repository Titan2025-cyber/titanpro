// AddressAutocomplete
// -------------------
// Free, key-less address suggestions backed by Nominatim (OpenStreetMap)
// via /api/address-suggest. Drops in wherever an <Input> for a service
// address is expected. Deliberately kept dependency-free so it can live
// inside the New Job dialog without pulling in a full combobox library.
//
// Behaviour:
//   - Debounced 350ms after the last keystroke.
//   - Shows a compact popover of suggestions under the input.
//   - Arrow keys / Enter to pick, Escape to dismiss.
//   - Mouse click still works for stylus/touch use in the field.
//   - Never blocks free-typing: if no suggestion matches, the raw string
//     you typed is submitted.
//
// When a suggestion is picked we hand back both the formatted label and
// the structured parts (city, state, zip, lat, lng) so callers can prefill
// downstream fields without a second geocode round-trip.

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export type AddressSuggestion = {
  id: string;
  label: string;
  display: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
};

type Props = {
  value: string;
  onChange: (raw: string) => void;
  onSelect?: (s: AddressSuggestion) => void;
  placeholder?: string;
  className?: string;
  testId?: string;
  disabled?: boolean;
};

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
  testId,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Track the last suggestion the operator picked so a matching keystroke
  // (e.g. re-picking after clearing) doesn't refire a network fetch for
  // the same string.
  const lastPickedRef = useRef<string>("");

  // Debounced fetch: 350ms after last keystroke.
  useEffect(() => {
    const raw = value.trim();
    if (raw.length < 4 || raw === lastPickedRef.current) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/address-suggest?q=${encodeURIComponent(raw)}`, {
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(String(resp.status));
        const rows = (await resp.json()) as AddressSuggestion[];
        setSuggestions(rows);
        setHighlightIdx(0);
        if (rows.length > 0) setOpen(true);
      } catch (_e) {
        // silent — falls back to free-typed address, which is what the
        // operator sees anyway when Nominatim rate-limits or errors.
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [value]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(s: AddressSuggestion) {
    lastPickedRef.current = s.label;
    onChange(s.label);
    onSelect?.(s);
    setOpen(false);
    setSuggestions([]);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlightIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const s = suggestions[highlightIdx];
            if (s) pick(s);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        className={className}
        data-testid={testId}
        disabled={disabled}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border border-border bg-popover shadow-lg max-h-64 overflow-y-auto"
          role="listbox"
        >
          {suggestions.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => {
                // Prevent the input blur firing before we get the click.
                e.preventDefault();
                pick(s);
              }}
              className={`w-full text-left px-3 py-2 text-sm border-b border-border last:border-b-0 transition-colors ${
                i === highlightIdx ? "bg-accent" : "hover:bg-accent/60"
              }`}
              data-testid={`suggest-${i}`}
            >
              <div className="font-medium truncate">{s.street || s.label}</div>
              {(s.city || s.state || s.zip) && (
                <div className="text-[11px] text-muted-foreground truncate">
                  {[s.city, s.state, s.zip].filter(Boolean).join(", ")}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
      {loading && !open && value.trim().length >= 4 && (
        <p className="text-[10px] text-muted-foreground mt-1">Looking up address…</p>
      )}
    </div>
  );
}
