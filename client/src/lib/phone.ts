/**
 * Phone number formatter — US-centric display formatting.
 *
 * Contacts data has five different phone formats in production ("706-555-0101",
 * raw "tel:..." leaks, "1706-799-5941", "8033345349", "706.305.0502"). Fixed
 * 2026-08-14 by normalizing every phone through this helper on render.
 *
 * - Strips non-digits.
 * - Drops a leading US country code "1" when the remainder is 10 digits.
 * - Renders as "(xxx) xxx-xxxx" when 10 digits; falls back to raw input otherwise.
 * - Never throws; returns the input string on any weirdness so callers can
 *   always drop this into JSX safely.
 */
export function formatPhone(input: string | null | undefined): string {
  if (!input) return "";
  const raw = String(input).trim();
  // Strip any "tel:" prefix (some rows accidentally stored the full URI).
  const cleaned = raw.replace(/^tel:/i, "");
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  // Give up gracefully — return the cleaned string with tel: stripped.
  return cleaned;
}

/**
 * Return the tel: href safe for anchor tags. Uses E.164 when we can construct
 * it, otherwise falls back to the digits-only string.
 */
export function phoneHref(input: string | null | undefined): string {
  if (!input) return "";
  const digits = String(input).replace(/^tel:/i, "").replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return `tel:${digits}`;
}
