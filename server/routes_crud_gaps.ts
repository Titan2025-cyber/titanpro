// ─────────────────────────────────────────────────────────────────────────────
// Generic edit/delete for resources that had create-only (or partial) coverage.
//
// User requirement: "If I add anything in the app I would like to be able to edit
// or delete it in all modules." This registrar fills the missing PATCH (edit) and
// DELETE endpoints for raw-SQL tables that previously only supported create.
//
// Design:
//  - Column-safe: we read the real columns via PRAGMA table_info and only allow
//    UPDATE on columns that actually exist (ignoring id / created_at). This makes
//    the generic handler safe against arbitrary keys in the request body.
//  - Hard delete with the caller confirming on the frontend (per user's choice).
//  - Append-only logs (audit_log, activity_log, iot_readings, emails, sms_messages,
//    qb_sync_log) are gated behind owner/admin so history can't be quietly rewritten
//    by lower roles. Everything else is available to any authenticated staff member.
//  - camelCase request keys are converted to snake_case to match column names.
//
// NOTE: Resources backed by the Drizzle storage layer (estimates, invoices,
// employees, channels, emails*, payout_requests, review_requests) are handled via
// their existing storage.update*/delete* methods in routes.ts — NOT here — to keep
// a single source of truth for those tables. (*emails create is Drizzle but the
// raw fallback below is harmless because we only register a route if one isn't
// already defined; see skipIfExists.)
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, RequestHandler } from "express";
import type Database from "better-sqlite3";

type Auth = {
  requireRole: (...roles: string[]) => RequestHandler;
  requireStaffAuth: RequestHandler;
};

const camelToSnake = (s: string) => s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());

// resource path -> { table, adminOnly }
// adminOnly = true for append-only / audit-style logs (owner+admin only).
const MAP: Array<{ path: string; table: string; adminOnly?: boolean }> = [
  { path: "activity-log", table: "activity_log", adminOnly: true },
  { path: "audit-log", table: "audit_log", adminOnly: true },
  { path: "qb-sync-log", table: "qb_sync_log", adminOnly: true },
  { path: "iot-readings", table: "iot_readings", adminOnly: true },
  { path: "sms", table: "sms_messages", adminOnly: true },
  { path: "approved-claims", table: "approved_claims" },
  { path: "carrier-ar", table: "carrier_ar_events" },
  { path: "channels", table: "channels" },
  { path: "coi-records", table: "coi_records" },
  { path: "comm-timeline", table: "comm_timeline" },
  { path: "compliance-checklists", table: "compliance_checklists" },
  { path: "departure-checklists", table: "departure_checklists" },
  { path: "emergency-intakes", table: "emergency_intakes" },
  { path: "equipment-maintenance", table: "equipment_maintenance_logs" },
  { path: "hazmat-flags", table: "hazmat_flags" },
  { path: "iot-sensors", table: "iot_sensors" },
  { path: "lms-courses", table: "lms_courses" },
  { path: "lms-enrollments", table: "lms_enrollments" },
  { path: "nps-surveys", table: "nps_surveys" },
  { path: "payment-plans", table: "payment_plans" },
  { path: "payout-requests", table: "payout_requests" },
  { path: "review-requests", table: "review_requests" },
  { path: "safety-checklists", table: "safety_checklists" },
  { path: "supplement-tracker", table: "supplement_trackers" },
  { path: "tech-notifications", table: "tech_notifications" },
  { path: "tpa-programs", table: "tpa_programs" },
  { path: "withdrawal-requests", table: "withdrawal_requests" },
  { path: "adjuster-courses", table: "adjuster_courses" },
  { path: "adjuster-enrollments", table: "adjuster_enrollments" },
];

export function registerCrudGapRoutes(app: Express, sqlite: Database.Database, auth: Auth) {
  const { requireRole, requireStaffAuth } = auth;

  // Track which METHOD+PATH pairs already exist so we never double-register and
  // clobber a hand-written handler (e.g. estimates/invoices delete added elsewhere).
  const existing = new Set<string>();
  const stack = (app as any)._router?.stack || [];
  for (const layer of stack) {
    if (layer?.route?.path && layer.route.methods) {
      for (const m of Object.keys(layer.route.methods)) {
        existing.add(`${m.toUpperCase()} ${layer.route.path}`);
      }
    }
  }
  const has = (method: string, path: string) => existing.has(`${method} ${path}`);

  const columnsOf = (table: string): string[] => {
    try {
      const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[];
      return rows.map((r) => r.name);
    } catch {
      return [];
    }
  };

  for (const { path, table, adminOnly } of MAP) {
    const cols = new Set(columnsOf(table));
    if (cols.size === 0) continue; // table not present in this DB build — skip silently
    const gate: RequestHandler = adminOnly ? requireRole("owner", "admin") : requireStaffAuth;
    const editable = [...cols].filter((c) => c !== "id" && c !== "created_at");
    const routePath = `/api/${path}/:id`;

    // ---- EDIT (PATCH) ----
    if (!has("PATCH", routePath) && !has("PUT", routePath)) {
      app.patch(routePath, gate, (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
        const body = req.body || {};
        const sets: string[] = [];
        const vals: any[] = [];
        for (const [k, v] of Object.entries(body)) {
          const col = cols.has(k) ? k : camelToSnake(k);
          if (!editable.includes(col)) continue; // ignore unknown / protected cols
          sets.push(`${col} = ?`);
          // store booleans as 0/1 to match SQLite integer flags
          vals.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
        }
        if (sets.length === 0) return res.status(400).json({ error: "No editable fields provided." });
        vals.push(id);
        try {
          const info = sqlite.prepare(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
          if (info.changes === 0) return res.status(404).json({ error: "Not found" });
          const row = sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
          res.json(row);
        } catch (e: any) {
          res.status(500).json({ error: `Update failed: ${e?.message || "unknown"}` });
        }
      });
    }

    // ---- DELETE ----
    if (!has("DELETE", routePath)) {
      app.delete(routePath, gate, (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
        try {
          const info = sqlite.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
          if (info.changes === 0) return res.status(404).json({ error: "Not found" });
          res.json({ deleted: true, id });
        } catch (e: any) {
          res.status(500).json({ error: `Delete failed: ${e?.message || "unknown"}` });
        }
      });
    }
  }
}
