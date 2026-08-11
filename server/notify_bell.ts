// ─────────────────────────────────────────────────────────────────────────────
// In-app notification helper for the header bell.
//
// Wraps the `tech_notifications` table with a small, safe API:
//   • notify({ employeeId, ... })        → insert one row targeted at a user
//   • notifyMany([ids], { ... })         → insert one row per user (bulk)
//   • notifyRoles(['owner','admin'], …)  → target every active user in a role
//   • notifyOwnersAndAdmins(…)           → shortcut used by most job events
//   • extractMentions(body, employees)   → parse "@Cody Brantley" / "@cody" from
//                                          free-text and return matched IDs
//
// Every insert is best-effort: failures are logged and swallowed so a broken
// notification never fails the primary write (creating a job, saving a note…).
// ─────────────────────────────────────────────────────────────────────────────
import type { Database } from "better-sqlite3";

export interface NotifyInput {
  employeeId: number;
  type: string;          // e.g. "job_created" | "note_mentioned" | "estimate_approved"
  title: string;
  body: string;
  jobId?: number | null;
  link?: string | null;  // /jobs/123, /estimates/45 — the bell dropdown deep-links to this
}

export function makeNotifier(sqlite: Database) {
  const insertStmt = sqlite.prepare(
    `INSERT INTO tech_notifications
       (tech_name, type, title, body, job_id, employee_id, link, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // Resolve an employee id → display name for the legacy tech_name column so
  // the old TechNotifications page still shows these rows for that tech.
  const nameByIdStmt = sqlite.prepare(
    "SELECT name FROM employees WHERE id = ? AND is_active = 1"
  );

  function notify(input: NotifyInput): void {
    try {
      const nameRow: any = nameByIdStmt.get(input.employeeId);
      const techName = nameRow?.name || "Titan Team";
      insertStmt.run(
        techName,
        input.type,
        input.title.slice(0, 200),
        input.body.slice(0, 500),
        input.jobId ?? null,
        input.employeeId,
        input.link ?? null,
        new Date().toISOString(),
      );
    } catch (e: any) {
      console.error("[notify_bell] insert failed:", e?.message || e);
    }
  }

  function notifyMany(employeeIds: number[], payload: Omit<NotifyInput, "employeeId">): void {
    // Dedupe — a user tagged twice in the same note only gets one alert.
    const uniq = Array.from(new Set(employeeIds.filter(id => Number.isFinite(id) && id > 0)));
    for (const id of uniq) notify({ ...payload, employeeId: id });
  }

  const roleIdsStmt = sqlite.prepare(
    "SELECT id FROM employees WHERE is_active = 1 AND role IN (SELECT value FROM json_each(?))"
  );

  function notifyRoles(roles: string[], payload: Omit<NotifyInput, "employeeId">): void {
    try {
      const rows = roleIdsStmt.all(JSON.stringify(roles)) as any[];
      notifyMany(rows.map(r => r.id), payload);
    } catch (e: any) {
      console.error("[notify_bell] role lookup failed:", e?.message || e);
    }
  }

  function notifyOwnersAndAdmins(payload: Omit<NotifyInput, "employeeId">): void {
    notifyRoles(["owner", "admin", "general_manager"], payload);
  }

  // ── @mention parsing ──────────────────────────────────────────────────────
  //
  // Recognizes:
  //   @cody              → matches employee whose first name (lowercased) is 'cody'
  //   @Cody Brantley     → matches full name (case-insensitive)
  //   @cody.brantley     → matches full name with dot separator
  //
  // The `employees` argument is the active-employee roster the caller already
  // has in scope; we don't hit the DB from here.
  interface Employee { id: number; name: string; }

  function extractMentions(body: string, employees: Employee[]): number[] {
    if (!body || employees.length === 0) return [];
    const matches = new Set<number>();
    // Grab everything after an @ up to whitespace or common punctuation.
    // Allow spaces so "@Cody Brantley" resolves as one mention, then re-check
    // if a shorter prefix matches uniquely too.
    const rx = /@([\p{L}][\p{L}\p{N}._-]*(?:\s+[\p{L}][\p{L}\p{N}._-]*)?)/gu;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(body)) !== null) {
      const raw = m[1].trim().toLowerCase().replace(/\./g, " ");
      // Try full match first (e.g. "cody brantley"), then first token only.
      const attempts = [raw, raw.split(/\s+/)[0]];
      for (const attempt of attempts) {
        const hit = employees.find(e => {
          const n = e.name.toLowerCase();
          const first = n.split(/\s+/)[0];
          return n === attempt || first === attempt;
        });
        if (hit) { matches.add(hit.id); break; }
      }
    }
    return Array.from(matches);
  }

  function activeEmployeeRoster(): { id: number; name: string; role: string }[] {
    return sqlite
      .prepare("SELECT id, name, role FROM employees WHERE is_active = 1")
      .all() as any[];
  }

  return {
    notify,
    notifyMany,
    notifyRoles,
    notifyOwnersAndAdmins,
    extractMentions,
    activeEmployeeRoster,
  };
}

export type Notifier = ReturnType<typeof makeNotifier>;
