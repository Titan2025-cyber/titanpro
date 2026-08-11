/*
 * Timezone-safe date helpers.
 *
 * The bug we're fixing:
 *   <Input type="date"> gives us "2026-08-11". Feed that to `new Date(...)`
 *   and JavaScript parses it as *UTC midnight* (2026-08-11T00:00:00Z). In
 *   America/New_York (UTC-4/-5), that's Aug 10 at 8pm the previous day.
 *   Every .toLocaleDateString() call across the app then displayed the
 *   wrong day. Same story on the PDF signature/authorization dates.
 *
 * The rule:
 *   - Bare "YYYY-MM-DD" strings are calendar dates, not timestamps.
 *     Parse them as local midnight so the day never shifts.
 *   - Full ISO strings ("...T...Z" or with an offset) are actual moments in
 *     time; the standard Date parser is correct for those.
 *
 * Use these helpers everywhere we render a date the user typed or a stored
 * "date-only" field (sales_date, pre_production_date, completion_date, etc).
 * Do NOT use them for real timestamps like createdAt / signedAt \u2014 those
 * carry a time-of-day and should format normally.
 */

/** True when a string looks like a bare YYYY-MM-DD calendar date. */
export function isDateOnly(s: string | null | undefined): boolean {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Parse a value as a local Date without any UTC drift.
 * - "YYYY-MM-DD"          \u2192 local midnight of that calendar day
 * - Date | number | full ISO \u2192 pass through to `new Date`
 * - null / undefined / bad input \u2192 null
 */
export function parseLocalDate(input: string | number | Date | null | undefined): Date | null {
  if (input == null || input === "") return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === "number") {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(input);
  if (isDateOnly(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);   // local midnight, no drift
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format any date-ish value for the user's local calendar. Never shifts
 * days for bare YYYY-MM-DD inputs. Returns "" for empty / unparseable
 * so callers can concat safely.
 */
export function fmtDate(
  input: string | number | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" },
): string {
  const d = parseLocalDate(input);
  return d ? d.toLocaleDateString("en-US", opts) : "";
}

/** Long format, e.g. "August 11, 2026". */
export function fmtDateLong(input: string | number | Date | null | undefined): string {
  return fmtDate(input, { year: "numeric", month: "long", day: "numeric" });
}

/** Short numeric, e.g. "8/11/2026". */
export function fmtDateShort(input: string | number | Date | null | undefined): string {
  return fmtDate(input, {});
}

/**
 * Today as "YYYY-MM-DD" in the user's local timezone. Use this when
 * defaulting a <input type="date">, NEVER `new Date().toISOString().slice(0,10)`
 * (which is UTC and drops a day for anyone west of the prime meridian in
 * the evening).
 */
export function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
