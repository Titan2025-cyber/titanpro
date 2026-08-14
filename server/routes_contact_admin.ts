// server/routes_contact_admin.ts
//
// Two features bundled into one module because they both hang off /api/contacts:
//   1) Safe delete + archive for contacts (customers, referral partners, adjusters,
//      subs, property managers). Overrides the plain DELETE handler that used to
//      cascade-orphan jobs.
//   2) Marketing / relationship details (birthday, favorite team, kids, etc.)
//      per contact for referral cultivation.
//
// Register in server/routes.ts:
//   import { registerContactAdminRoutes } from "./routes_contact_admin";
//   registerContactAdminRoutes(app, sqlite, requireStaffAuth);
//
// It MUST be registered BEFORE the existing DELETE /api/contacts/:id handler
// so the safer one wins (Express matches first-registered).

import type { Express, Request, Response } from "express";
import type Database from "better-sqlite3";

type Sqlite = Database.Database;
type AuthMw = (req: Request, res: Response, next: any) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Schema migrations
// ─────────────────────────────────────────────────────────────────────────────

function ensureSchema(sqlite: Sqlite) {
  // Contact status column: 'active' | 'archived'
  const cols = sqlite.prepare("PRAGMA table_info(contacts)").all() as Array<{ name: string }>;
  const has = (n: string) => cols.some(c => c.name === n);
  if (!has("status")) {
    try { sqlite.exec("ALTER TABLE contacts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"); } catch (_) {}
  }
  if (!has("archived_at")) {
    try { sqlite.exec("ALTER TABLE contacts ADD COLUMN archived_at TEXT"); } catch (_) {}
  }
  if (!has("archived_reason")) {
    try { sqlite.exec("ALTER TABLE contacts ADD COLUMN archived_reason TEXT"); } catch (_) {}
  }

  // Marketing profile — one row per contact (created lazily on first PUT)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS contact_marketing (
      contact_id INTEGER PRIMARY KEY,
      birthday TEXT,                     -- ISO 'YYYY-MM-DD' or 'MM-DD' if year unknown
      anniversary TEXT,
      spouse_name TEXT,
      kids_names TEXT,                   -- freeform, e.g. "Ella (8), Jacob (5)"
      favorite_color TEXT,
      favorite_drink TEXT,               -- "black coffee", "Miller Lite", "Buffalo Trace"
      favorite_food TEXT,                -- "steak", "sushi"
      favorite_restaurant TEXT,
      football_team TEXT,
      basketball_team TEXT,
      baseball_team TEXT,
      other_team TEXT,
      alma_mater TEXT,
      hobbies TEXT,
      dietary_restrictions TEXT,         -- "gluten-free", "vegetarian"
      gift_preferences TEXT,             -- notes for holiday gifts
      pet_names TEXT,
      notes TEXT,                        -- freeform relationship notes
      updated_at TEXT NOT NULL DEFAULT '',
      updated_by TEXT
    )
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Blocker inspection — what would break if we deleted this contact?
// ─────────────────────────────────────────────────────────────────────────────

type Blocker = {
  jobs_open: number;
  jobs_total: number;
  invoices_total: number;
  invoices_outstanding: number;
  payments_total: number;
  payout_requests_pending: number;
  portal_active: boolean;
  child_referral_techs: number; // if this is a referral company
};

function inspectBlockers(sqlite: Sqlite, id: number): Blocker {
  const q = (sql: string, ...args: any[]) => {
    try { return (sqlite.prepare(sql).get(...args) as any)?.n ?? 0; } catch { return 0; }
  };
  const jobs_total = q("SELECT COUNT(*) AS n FROM jobs WHERE contact_id = ? OR referral_partner_id = ?", id, id);
  const jobs_open = q(
    "SELECT COUNT(*) AS n FROM jobs WHERE (contact_id = ? OR referral_partner_id = ?) AND status NOT IN ('closed','archived','cancelled')",
    id, id
  );
  const invoices_total = q("SELECT COUNT(*) AS n FROM invoices WHERE contact_id = ?", id);
  const invoices_outstanding = q(
    "SELECT COUNT(*) AS n FROM invoices WHERE contact_id = ? AND status NOT IN ('paid','void','cancelled')", id
  );
  const payments_total = q("SELECT COUNT(*) AS n FROM payments WHERE contact_id = ?", id);
  const payout_requests_pending = q(
    "SELECT COUNT(*) AS n FROM payout_requests WHERE contact_id = ? AND status IN ('pending','approved')", id
  );
  const child_referral_techs = q("SELECT COUNT(*) AS n FROM contacts WHERE parent_company_id = ?", id);

  const c = sqlite.prepare("SELECT portal_pin FROM contacts WHERE id = ?").get(id) as any;
  const portal_active = !!(c && c.portal_pin);

  return { jobs_open, jobs_total, invoices_total, invoices_outstanding, payments_total, payout_requests_pending, portal_active, child_referral_techs };
}

function blockerReasons(b: Blocker): string[] {
  const r: string[] = [];
  if (b.jobs_open > 0) r.push(`${b.jobs_open} open job${b.jobs_open === 1 ? "" : "s"}`);
  if (b.invoices_outstanding > 0) r.push(`${b.invoices_outstanding} unpaid invoice${b.invoices_outstanding === 1 ? "" : "s"}`);
  if (b.payout_requests_pending > 0) r.push(`${b.payout_requests_pending} pending payout${b.payout_requests_pending === 1 ? "" : "s"}`);
  if (b.child_referral_techs > 0) r.push(`${b.child_referral_techs} referral tech${b.child_referral_techs === 1 ? "" : "s"} still linked to this company`);
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// Route registration
// ─────────────────────────────────────────────────────────────────────────────

export function registerContactAdminRoutes(app: Express, sqlite: Sqlite, requireStaffAuth: AuthMw) {
  ensureSchema(sqlite);

  const audit = (action: string, actor: string, details: any) => {
    try {
      sqlite.prepare(
        "INSERT INTO job_events (job_id, action, actor_name, details, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(0, action, actor, JSON.stringify(details), new Date().toISOString());
    } catch { /* audit is best-effort */ }
  };

  // ── Impact preview (used by the delete dialog before user confirms) ─────
  app.get("/api/contacts/:id/delete-impact", requireStaffAuth, (req, res) => {
    const id = Number(req.params.id);
    const c = sqlite.prepare("SELECT id, name, type FROM contacts WHERE id = ?").get(id) as any;
    if (!c) return res.status(404).json({ error: "Not found" });
    const blockers = inspectBlockers(sqlite, id);
    const reasons = blockerReasons(blockers);
    res.json({
      contact: c,
      blockers,
      reasons,
      can_soft_delete: reasons.length === 0,
    });
  });

  // ── Archive (soft delete) ───────────────────────────────────────────────
  app.post("/api/contacts/:id/archive", requireStaffAuth, (req, res) => {
    const id = Number(req.params.id);
    const c = sqlite.prepare("SELECT id, name FROM contacts WHERE id = ?").get(id) as any;
    if (!c) return res.status(404).json({ error: "Not found" });
    const reason = String(req.body?.reason || "").slice(0, 500);
    const actor = (req as any).user?.name || "system";
    sqlite.prepare(
      "UPDATE contacts SET status = 'archived', archived_at = ?, archived_reason = ? WHERE id = ?"
    ).run(new Date().toISOString(), reason || null, id);
    audit("contact.archived", actor, { contact_id: id, name: c.name, reason });
    res.json({ success: true });
  });

  app.post("/api/contacts/:id/unarchive", requireStaffAuth, (req, res) => {
    const id = Number(req.params.id);
    sqlite.prepare(
      "UPDATE contacts SET status = 'active', archived_at = NULL, archived_reason = NULL WHERE id = ?"
    ).run(id);
    audit("contact.unarchived", (req as any).user?.name || "system", { contact_id: id });
    res.json({ success: true });
  });

  // ── Safe delete (overrides the existing DELETE /api/contacts/:id) ───────
  //
  // Behaviour:
  //   - no blockers → hard-delete, null out FKs on soft references, done
  //   - blockers    → 409 unless ?force=true (owner override)
  //   - force=true  → null out contact_id on jobs/invoices/payments, delete
  //                   portal sessions, delete payout data, then delete contact
  app.delete("/api/contacts/:id", requireStaffAuth, (req, res) => {
    const id = Number(req.params.id);
    const c = sqlite.prepare("SELECT id, name, type FROM contacts WHERE id = ?").get(id) as any;
    if (!c) return res.status(404).json({ error: "Not found" });

    const blockers = inspectBlockers(sqlite, id);
    const reasons = blockerReasons(blockers);
    const force = String(req.query.force || "").toLowerCase() === "true";
    const actor = (req as any).user?.name || "system";
    const role = (req as any).user?.role || "unknown";

    if (reasons.length > 0 && !force) {
      return res.status(409).json({
        error: "Contact has active references",
        blockers,
        reasons,
        hint: "Use ?force=true (owner-only) to override and null out related job/invoice references, or archive the contact instead.",
      });
    }

    if (force && role !== "owner" && role !== "admin") {
      return res.status(403).json({ error: "Force delete requires owner or admin role" });
    }

    // Run everything in a transaction so partial failure doesn't strand data.
    const tx = sqlite.transaction(() => {
      const exec = (sql: string, ...args: any[]) => { try { sqlite.prepare(sql).run(...args); } catch { /* table may not exist */ } };

      // Null out soft references so history stays but the pointer is dead.
      exec("UPDATE jobs SET contact_id = NULL WHERE contact_id = ?", id);
      exec("UPDATE jobs SET referral_partner_id = NULL WHERE referral_partner_id = ?", id);
      exec("UPDATE invoices SET contact_id = NULL WHERE contact_id = ?", id);
      exec("UPDATE payments SET contact_id = NULL WHERE contact_id = ?", id);
      exec("UPDATE estimates SET contact_id = NULL WHERE contact_id = ?", id);
      exec("UPDATE customer_messages SET contact_id = 0 WHERE contact_id = ?", id); // NOT NULL col
      exec("UPDATE contacts SET parent_company_id = NULL WHERE parent_company_id = ?", id);

      // Delete rows that only make sense while the contact exists.
      exec("DELETE FROM portal_sessions WHERE contact_id = ?", id);
      exec("DELETE FROM adjuster_portal_sessions WHERE contact_id = ?", id);
      exec("DELETE FROM payout_methods WHERE contact_id = ?", id);
      exec("DELETE FROM payout_requests WHERE contact_id = ?", id);
      exec("DELETE FROM contact_marketing WHERE contact_id = ?", id);

      // Finally the contact itself.
      sqlite.prepare("DELETE FROM contacts WHERE id = ?").run(id);
    });

    try { tx(); } catch (e: any) {
      return res.status(500).json({ error: "Delete failed", detail: e?.message || String(e) });
    }

    audit(force ? "contact.force_deleted" : "contact.deleted", actor, {
      contact_id: id, name: c.name, type: c.type, blockers, force,
    });
    res.json({ success: true, force });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Marketing profile
  // ─────────────────────────────────────────────────────────────────────────

  const MARKETING_FIELDS = [
    "birthday", "anniversary", "spouse_name", "kids_names",
    "favorite_color", "favorite_drink", "favorite_food", "favorite_restaurant",
    "football_team", "basketball_team", "baseball_team", "other_team",
    "alma_mater", "hobbies", "dietary_restrictions", "gift_preferences",
    "pet_names", "notes",
  ] as const;

  app.get("/api/contacts/:id/marketing", requireStaffAuth, (req, res) => {
    const id = Number(req.params.id);
    const row = sqlite.prepare("SELECT * FROM contact_marketing WHERE contact_id = ?").get(id) as any;
    if (!row) {
      const empty: any = { contact_id: id };
      for (const f of MARKETING_FIELDS) empty[f] = null;
      return res.json(empty);
    }
    res.json(row);
  });

  app.put("/api/contacts/:id/marketing", requireStaffAuth, (req, res) => {
    const id = Number(req.params.id);
    const c = sqlite.prepare("SELECT id FROM contacts WHERE id = ?").get(id) as any;
    if (!c) return res.status(404).json({ error: "Contact not found" });

    const body = req.body || {};
    const values: any = { contact_id: id };
    for (const f of MARKETING_FIELDS) {
      const v = body[f];
      values[f] = v == null || v === "" ? null : String(v).slice(0, 2000);
    }
    values.updated_at = new Date().toISOString();
    values.updated_by = (req as any).user?.name || null;

    const cols = ["contact_id", ...MARKETING_FIELDS, "updated_at", "updated_by"];
    const placeholders = cols.map(() => "?").join(",");
    const updates = cols.filter(c => c !== "contact_id").map(c => `${c} = excluded.${c}`).join(", ");
    const sql = `
      INSERT INTO contact_marketing (${cols.join(",")}) VALUES (${placeholders})
      ON CONFLICT(contact_id) DO UPDATE SET ${updates}
    `;
    sqlite.prepare(sql).run(...cols.map(c => values[c]));
    res.json(values);
  });

  // Birthday / anniversary radar — powers the "upcoming celebrations" widget.
  // Returns contacts whose birthday or anniversary falls within N days from today.
  app.get("/api/contacts/marketing/upcoming", requireStaffAuth, (req, res) => {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const rows = sqlite.prepare(`
      SELECT c.id, c.name, c.type, c.company, c.phone, c.email,
             m.birthday, m.anniversary
      FROM contact_marketing m
      JOIN contacts c ON c.id = m.contact_id
      WHERE (m.birthday IS NOT NULL OR m.anniversary IS NOT NULL)
        AND (c.status IS NULL OR c.status = 'active')
    `).all() as any[];

    const today = new Date();
    const upcoming: any[] = [];
    for (const r of rows) {
      for (const kind of ["birthday", "anniversary"] as const) {
        const raw = r[kind];
        if (!raw) continue;
        // Accept 'YYYY-MM-DD' or 'MM-DD'
        const parts = String(raw).split("-").map((s: string) => s.trim());
        let mm: number, dd: number;
        if (parts.length === 3) { mm = parseInt(parts[1], 10); dd = parseInt(parts[2], 10); }
        else if (parts.length === 2) { mm = parseInt(parts[0], 10); dd = parseInt(parts[1], 10); }
        else continue;
        if (!mm || !dd) continue;
        // Compute next occurrence
        let year = today.getFullYear();
        let next = new Date(year, mm - 1, dd);
        if (next < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
          next = new Date(year + 1, mm - 1, dd);
        }
        const diff = Math.round((next.getTime() - today.getTime()) / 86_400_000);
        if (diff <= days) {
          upcoming.push({
            contact_id: r.id, name: r.name, type: r.type, company: r.company,
            phone: r.phone, email: r.email,
            kind, date_iso: next.toISOString().slice(0, 10), days_until: diff,
          });
        }
      }
    }
    upcoming.sort((a, b) => a.days_until - b.days_until);
    res.json(upcoming);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // List filter: honour ?status=active|archived|all on GET /api/contacts
  // is handled client-side (the raw list endpoint returns all). Easier and
  // avoids intercepting the existing handler.
  // ─────────────────────────────────────────────────────────────────────────
}
