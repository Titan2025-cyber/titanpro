/**
 * auditAndTrash.ts — Cross-cutting concerns
 *
 * (1) Audit log helper. Writes to the *existing* audit_log table
 *     (created by server/routes_auth.ts with columns
 *      employee_id, employee_name, action, entity, entity_id, detail,
 *      ip, created_at). The GET endpoint is already served by
 *      routes_auth.ts — we don't add a duplicate.
 *
 * (2) Soft delete: jobs / estimates / invoices / photos gain a
 *     deleted_at column. Set to ISO timestamp to hide. A background
 *     sweep hard-deletes anything trashed more than 30 days ago.
 *     Restore endpoint clears deleted_at. The storage layer already
 *     filters WHERE deleted_at IS NULL from list/read queries.
 *
 * Import this file from server/routes.ts and call
 * `initAuditAndTrash(app, sqlite, requireStaffAuth)` once during route
 * registration. Returns { logAudit, softDelete } for use in write
 * handlers.
 */
import type { Express, Request, Response } from "express";
import type Database from "better-sqlite3";

type Sqlite = Database.Database;
type Actor = { id?: number; name?: string; role?: string } | null;

/** Tables that participate in soft-delete + trash restore. */
export const TRASH_TABLES = [
  { name: "jobs",      label: "Jobs",      identify: (r: any) => r.job_number || r.title || `Job #${r.id}` },
  { name: "estimates", label: "Estimates", identify: (r: any) => r.title || `Estimate #${r.id}` },
  { name: "invoices",  label: "Invoices",  identify: (r: any) => r.invoice_number || `Invoice #${r.id}` },
  { name: "photos",    label: "Photos",    identify: (r: any) => r.caption || r.filename || `Photo #${r.id}` },
] as const;

export function initAuditAndTrash(
  app: Express,
  sqlite: Sqlite,
  requireStaffAuth: any,
) {
  // ── Add deleted_at column to each trash table (idempotent) ─────────
  for (const t of TRASH_TABLES) {
    try { sqlite.exec(`ALTER TABLE ${t.name} ADD COLUMN deleted_at TEXT`); } catch (_) { /* already exists */ }
  }
  // Index the trash sweep query.
  try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_estimates_deleted_at ON estimates(deleted_at)`); } catch (_) {}
  try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_invoices_deleted_at ON invoices(deleted_at)`); } catch (_) {}
  try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_deleted_at ON jobs(deleted_at)`); } catch (_) {}
  try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_photos_deleted_at ON photos(deleted_at)`); } catch (_) {}

  // ── logAudit: writes to the existing audit_log table ───────────────
  // Existing schema (from routes_auth.ts):
  //   employee_id, employee_name, action, entity, entity_id, detail, ip, created_at
  const insertAudit = sqlite.prepare(`
    INSERT INTO audit_log (employee_id, employee_name, action, entity, entity_id, detail, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function logAudit(
    req: Request | null,
    action: "create" | "update" | "delete" | "restore" | "purge",
    entity: string,
    entityId: number | null,
    detail: unknown,
  ) {
    const actor: Actor = (req as any)?.employee || null;
    const ip = req?.ip || (req?.socket as any)?.remoteAddress || null;
    try {
      insertAudit.run(
        actor?.id ?? null,
        actor?.name ?? null,
        action,
        entity,
        entityId != null ? String(entityId) : null,
        detail == null ? null : JSON.stringify(detail),
        ip,
        new Date().toISOString(),
      );
    } catch (_) { /* swallow — audit failure must never break a request */ }
  }

  // ── Trash listing ──────────────────────────────────────────────────
  // Returns an array of { table, label, items[] } that the UI renders.
  app.get("/api/trash", requireStaffAuth, (_req, res) => {
    const tables = TRASH_TABLES.map(t => {
      try {
        const rows = sqlite.prepare(
          `SELECT * FROM ${t.name} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500`
        ).all() as any[];
        return {
          table: t.name,
          label: t.label,
          items: rows.map(r => ({
            id: r.id,
            label: t.identify(r),
            deleted_at: r.deleted_at,
            deleted_by: r.deleted_by ?? null,
          })),
        };
      } catch (_) {
        return { table: t.name, label: t.label, items: [] };
      }
    });
    res.json({ tables });
  });

  app.post("/api/trash/:table/:id/restore", requireStaffAuth, (req, res) => {
    const table = String(req.params.table);
    const id = Number(req.params.id);
    if (!TRASH_TABLES.find(t => t.name === table)) return res.status(400).json({ error: "Unknown table" });
    const result = sqlite.prepare(`UPDATE ${table} SET deleted_at = NULL WHERE id = ?`).run(id);
    if (result.changes === 0) return res.status(404).json({ error: "Not found" });
    logAudit(req as any, "restore", table, id, null);
    res.json({ ok: true, table, id });
  });

  app.delete("/api/trash/:table/:id", requireStaffAuth, (req, res) => {
    const actor: Actor = (req as any).employee;
    if (!actor || !["owner", "admin"].includes(actor.role || "")) {
      return res.status(403).json({ error: "Only owner/admin can permanently delete" });
    }
    const table = String(req.params.table);
    const id = Number(req.params.id);
    if (!TRASH_TABLES.find(t => t.name === table)) return res.status(400).json({ error: "Unknown table" });
    sqlite.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    logAudit(req as any, "purge", table, id, null);
    res.json({ ok: true, table, id });
  });

  // ── Background retention sweep: hard-delete rows older than 30 days ─
  const RETENTION_DAYS = 30;
  function sweep() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
    for (const t of TRASH_TABLES) {
      try {
        const rows = sqlite.prepare(
          `SELECT id FROM ${t.name} WHERE deleted_at IS NOT NULL AND deleted_at < ?`
        ).all(cutoff) as any[];
        for (const r of rows) {
          sqlite.prepare(`DELETE FROM ${t.name} WHERE id = ?`).run(r.id);
          logAudit(null, "purge", t.name, r.id, { reason: "retention_expired" });
        }
      } catch (_) { /* ignore per-table errors */ }
    }
  }
  setTimeout(sweep, 30_000);
  setInterval(sweep, 6 * 3600 * 1000);

  return {
    logAudit,
    softDelete(table: string, id: number, req: Request | null) {
      sqlite.prepare(`UPDATE ${table} SET deleted_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), id);
      logAudit(req, "delete", table, id, null);
    },
  };
}
