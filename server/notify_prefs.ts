import type { Database } from "better-sqlite3";

/**
 * Per-employee notification preferences.
 *
 * Model: for each (employee, channel, event_type) we store a single row
 * with `enabled` = 0/1. Missing rows are treated as enabled — this is
 * important so existing installations keep their current (all-on)
 * behavior after migration.
 *
 * Channels: "bell" (in-app), "email", "sms" (SMS is future; safe to
 * pre-declare so the settings page renders it as coming soon).
 *
 * Event types:
 *  - "shift_assigned"  — you were put on a shift
 *  - "mentioned"       — someone @mentioned you in a note
 *  - "event_tagged"    — you were added to a calendar event
 *  - "invoice_paid"    — an invoice you own was paid (future hook)
 *  - "invoice_overdue" — an invoice you own is past due (future hook)
 *  - "drying_missed"   — a job you own missed a drying benchmark (future hook)
 */

export const NOTIF_CHANNELS = ["bell", "email", "sms"] as const;
export type NotifChannel = typeof NOTIF_CHANNELS[number];

export const NOTIF_EVENTS = [
  "shift_assigned",
  "mentioned",
  "event_tagged",
  "invoice_paid",
  "invoice_overdue",
  "drying_missed",
] as const;
export type NotifEvent = typeof NOTIF_EVENTS[number];

// Rare events default off; the noisy day-to-day ones default on.
const DEFAULT_ON: Record<NotifEvent, Record<NotifChannel, boolean>> = {
  shift_assigned:  { bell: true,  email: true,  sms: false },
  mentioned:       { bell: true,  email: true,  sms: false },
  event_tagged:    { bell: true,  email: true,  sms: false },
  invoice_paid:    { bell: true,  email: false, sms: false },
  invoice_overdue: { bell: true,  email: true,  sms: false },
  drying_missed:   { bell: true,  email: true,  sms: false },
};

export function ensureNotifPrefsTable(sqlite: Database) {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS notification_preferences (
    employee_id INTEGER NOT NULL,
    channel TEXT NOT NULL,
    event_type TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (employee_id, channel, event_type)
  )`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_notif_prefs_emp ON notification_preferences(employee_id)`);
}

/**
 * Should we send this event via this channel to this employee?
 * Look up an explicit row first; fall back to the sensible default.
 * Missing table is treated as "all defaults" — callers do NOT need to
 * guard against a fresh DB.
 */
export function isNotifEnabled(
  sqlite: Database,
  employeeId: number | null | undefined,
  channel: NotifChannel,
  event: NotifEvent,
): boolean {
  if (!employeeId) return true;
  try {
    const row: any = sqlite.prepare(
      "SELECT enabled FROM notification_preferences WHERE employee_id = ? AND channel = ? AND event_type = ?"
    ).get(employeeId, channel, event);
    if (row && typeof row.enabled === "number") return row.enabled === 1;
  } catch { /* table may not exist yet */ }
  return DEFAULT_ON[event]?.[channel] ?? true;
}

/**
 * Convenience for callers that only know the employee's *name* (the
 * scheduling code assigns shifts by tech name). Resolves via
 * employees.name.
 */
export function isNotifEnabledForName(
  sqlite: Database,
  employeeName: string | null | undefined,
  channel: NotifChannel,
  event: NotifEvent,
): boolean {
  if (!employeeName) return true;
  try {
    const emp: any = sqlite.prepare("SELECT id FROM employees WHERE name = ? AND is_active = 1").get(employeeName);
    if (emp?.id) return isNotifEnabled(sqlite, emp.id, channel, event);
  } catch { /* ignore */ }
  return true;
}

/**
 * Read all preferences for one employee, filled in with defaults so
 * the settings UI has a full matrix even before any row exists.
 */
export function getPrefsMatrix(sqlite: Database, employeeId: number) {
  const rows: any[] = (() => {
    try {
      return sqlite.prepare(
        "SELECT channel, event_type AS eventType, enabled FROM notification_preferences WHERE employee_id = ?"
      ).all(employeeId);
    } catch { return []; }
  })();
  const explicit = new Map<string, boolean>();
  for (const r of rows) explicit.set(`${r.channel}:${r.eventType}`, r.enabled === 1);

  return NOTIF_EVENTS.map((event) => ({
    event,
    channels: Object.fromEntries(
      NOTIF_CHANNELS.map((ch) => {
        const key = `${ch}:${event}`;
        const val = explicit.has(key) ? explicit.get(key)! : DEFAULT_ON[event][ch];
        return [ch, val];
      })
    ) as Record<NotifChannel, boolean>,
  }));
}

/**
 * Upsert a single preference cell.
 */
export function setPref(
  sqlite: Database,
  employeeId: number,
  channel: NotifChannel,
  event: NotifEvent,
  enabled: boolean,
) {
  ensureNotifPrefsTable(sqlite);
  sqlite.prepare(
    `INSERT INTO notification_preferences (employee_id, channel, event_type, enabled)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(employee_id, channel, event_type)
     DO UPDATE SET enabled = excluded.enabled`
  ).run(employeeId, channel, event, enabled ? 1 : 0);
}
