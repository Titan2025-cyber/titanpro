import type { Express, RequestHandler } from "express";
import type { Database } from "better-sqlite3";
import { sendEventTagEmails, newlyAddedAttendees } from "./notify_tags";

type SuiteAuth = { requireRole: (...roles: string[]) => RequestHandler };
const suite5Passthrough: RequestHandler = (_req, _res, next) => next();

export function registerSuite5Routes(app: Express, sqlite: Database, auth?: SuiteAuth) {
  // Manager-level gate for lien waivers, QB sync, and other back-office mutations.
  const requireManage: RequestHandler = auth ? auth.requireRole("owner", "admin", "office", "general_manager") : suite5Passthrough;

  // ── Create Suite 5 tables ──────────────────────────────────────────────────
  sqlite.exec(`CREATE TABLE IF NOT EXISTS qb_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    qb_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  sqlite.exec(`CREATE TABLE IF NOT EXISTS ar_followup_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_days INTEGER NOT NULL,
    channel TEXT NOT NULL DEFAULT 'sms',
    message_template TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  sqlite.exec(`CREATE TABLE IF NOT EXISTS ar_followup_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    rule_id INTEGER NOT NULL,
    sent_at TEXT NOT NULL,
    channel TEXT NOT NULL,
    message_body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent'
  )`);

  sqlite.exec(`CREATE TABLE IF NOT EXISTS lien_waivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    waiver_type TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'GA',
    through_date TEXT,
    amount REAL,
    signer_name TEXT,
    signer_title TEXT,
    signed_at TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  sqlite.exec(`CREATE TABLE IF NOT EXISTS time_clock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER,
    employee_name TEXT NOT NULL,
    job_id INTEGER,
    clock_in_at TEXT NOT NULL,
    clock_out_at TEXT,
    clock_in_lat REAL,
    clock_in_lng REAL,
    clock_out_lat REAL,
    clock_out_lng REAL,
    duration_minutes INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  sqlite.exec(`CREATE TABLE IF NOT EXISTS departure_checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    employee_name TEXT NOT NULL,
    loss_type TEXT,
    items TEXT NOT NULL DEFAULT '[]',
    completed_at TEXT,
    all_required_complete INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  sqlite.exec(`CREATE TABLE IF NOT EXISTS appointment_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    scheduled_for TEXT NOT NULL,
    contact_name TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    reminder_type TEXT NOT NULL DEFAULT '24h',
    channel TEXT NOT NULL DEFAULT 'sms',
    status TEXT NOT NULL DEFAULT 'scheduled',
    sent_at TEXT,
    message_body TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  sqlite.exec(`CREATE TABLE IF NOT EXISTS hazmat_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    flag_type TEXT NOT NULL,
    risk_level TEXT NOT NULL DEFAULT 'low',
    year_built INTEGER,
    auto_detected INTEGER DEFAULT 1,
    acknowledged INTEGER DEFAULT 0,
    acknowledged_by TEXT,
    acknowledged_at TEXT,
    documentation_required TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  // Seed default AR follow-up rules if none exist
  const ruleCount = (sqlite.prepare("SELECT COUNT(*) as c FROM ar_followup_rules").get() as any).c;
  if (ruleCount === 0) {
    const now = new Date().toISOString();
    const defaults = [
      { days: 15, channel: "sms", template: "Hi, this is Titan Restoration LLC. Invoice INV-{invoice_id} for ${amount} is 15 days past due. Please call 706-922-0154 or reply to arrange payment. Thank you." },
      { days: 30, channel: "both", template: "REMINDER: Titan Restoration LLC — Invoice INV-{invoice_id} (${amount}) is now 30 days overdue. Please contact us immediately at 706-922-0154 to avoid further collection action." },
      { days: 45, channel: "both", template: "FINAL NOTICE: Titan Restoration LLC — Invoice INV-{invoice_id} (${amount}) is 45 days past due. Account will be referred to collections if not resolved within 7 days. 706-922-0154" },
    ];
    for (const d of defaults) {
      sqlite.prepare("INSERT INTO ar_followup_rules (trigger_days, channel, message_template, is_active, created_at) VALUES (?,?,?,1,?)").run(d.days, d.channel, d.template, now);
    }
  }

  // ── QB Sync Log ─────────────────────────────────────────────────────────────
  app.get("/api/qb-sync-log", (req, res) => {
    try {
      const rows = sqlite.prepare("SELECT * FROM qb_sync_log ORDER BY id DESC").all();
      res.json(rows);
    } catch { res.json([]); }
  });

  app.post("/api/qb-sync-log", (req, res) => {
    try {
      const { entityType, entityId, qbId, status, errorMessage, syncedAt } = req.body;
      const now = new Date().toISOString();
      const row = sqlite.prepare(
        "INSERT INTO qb_sync_log (entity_type, entity_id, qb_id, status, error_message, synced_at, created_at) VALUES (?,?,?,?,?,?,?) RETURNING *"
      ).get(entityType, entityId, qbId || null, status || "pending", errorMessage || null, syncedAt || null, now);
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/qb-sync-log/:id", (req, res) => {
    try {
      const { status, qbId, errorMessage, syncedAt } = req.body;
      const row = sqlite.prepare(
        "UPDATE qb_sync_log SET status=COALESCE(?,status), qb_id=COALESCE(?,qb_id), error_message=COALESCE(?,error_message), synced_at=COALESCE(?,synced_at) WHERE id=? RETURNING *"
      ).get(status || null, qbId || null, errorMessage || null, syncedAt || null, parseInt(req.params.id));
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // QB Sync — simulate batch sync of invoices/payments
  app.post("/api/qb-sync/run", requireManage, (req, res) => {
    try {
      const invoices = sqlite.prepare("SELECT * FROM invoices").all() as any[];
      const payments = sqlite.prepare("SELECT * FROM payments WHERE type='received'").all() as any[];
      const now = new Date().toISOString();
      let synced = 0;
      for (const inv of invoices) {
        const existing = (sqlite.prepare("SELECT id FROM qb_sync_log WHERE entity_type='invoice' AND entity_id=?").get(inv.id) as any);
        if (!existing) {
          sqlite.prepare("INSERT INTO qb_sync_log (entity_type, entity_id, qb_id, status, synced_at, created_at) VALUES (?,?,?,?,?,?)").run(
            "invoice", inv.id, `QB-INV-${inv.id}`, "synced", now, now
          );
          synced++;
        }
      }
      for (const pay of payments) {
        const existing = (sqlite.prepare("SELECT id FROM qb_sync_log WHERE entity_type='payment' AND entity_id=?").get(pay.id) as any);
        if (!existing) {
          sqlite.prepare("INSERT INTO qb_sync_log (entity_type, entity_id, qb_id, status, synced_at, created_at) VALUES (?,?,?,?,?,?)").run(
            "payment", pay.id, `QB-PAY-${pay.id}`, "synced", now, now
          );
          synced++;
        }
      }
      res.json({ synced, total: invoices.length + payments.length, timestamp: now });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/qb-sync/summary", (req, res) => {
    try {
      const total = (sqlite.prepare("SELECT COUNT(*) as c FROM qb_sync_log").get() as any).c;
      const synced = (sqlite.prepare("SELECT COUNT(*) as c FROM qb_sync_log WHERE status='synced'").get() as any).c;
      const errors = (sqlite.prepare("SELECT COUNT(*) as c FROM qb_sync_log WHERE status='error'").get() as any).c;
      const pending = (sqlite.prepare("SELECT COUNT(*) as c FROM qb_sync_log WHERE status='pending'").get() as any).c;
      const lastSync = (sqlite.prepare("SELECT synced_at FROM qb_sync_log WHERE status='synced' ORDER BY synced_at DESC LIMIT 1").get() as any)?.synced_at || null;
      res.json({ total, synced, errors, pending, lastSync });
    } catch { res.json({ total: 0, synced: 0, errors: 0, pending: 0, lastSync: null }); }
  });

  // ── AR Follow-Up Rules ───────────────────────────────────────────────────────
  app.get("/api/ar-followup-rules", (req, res) => {
    try {
      const rows = sqlite.prepare("SELECT * FROM ar_followup_rules ORDER BY trigger_days ASC").all();
      res.json(rows);
    } catch { res.json([]); }
  });

  app.post("/api/ar-followup-rules", (req, res) => {
    try {
      const { triggerDays, channel, messageTemplate, isActive } = req.body;
      const now = new Date().toISOString();
      const row = sqlite.prepare(
        "INSERT INTO ar_followup_rules (trigger_days, channel, message_template, is_active, created_at) VALUES (?,?,?,?,?) RETURNING *"
      ).get(triggerDays, channel || "sms", messageTemplate, isActive !== false ? 1 : 0, now);
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/ar-followup-rules/:id", (req, res) => {
    try {
      const { triggerDays, channel, messageTemplate, isActive } = req.body;
      const row = sqlite.prepare(
        "UPDATE ar_followup_rules SET trigger_days=COALESCE(?,trigger_days), channel=COALESCE(?,channel), message_template=COALESCE(?,message_template), is_active=COALESCE(?,is_active) WHERE id=? RETURNING *"
      ).get(triggerDays ?? null, channel ?? null, messageTemplate ?? null, isActive !== undefined ? (isActive ? 1 : 0) : null, parseInt(req.params.id));
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/ar-followup-rules/:id", (req, res) => {
    try {
      sqlite.prepare("DELETE FROM ar_followup_rules WHERE id=?").run(parseInt(req.params.id));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/ar-followup-log", (req, res) => {
    try {
      const rows = sqlite.prepare("SELECT * FROM ar_followup_log ORDER BY id DESC LIMIT 100").all();
      res.json(rows);
    } catch { res.json([]); }
  });

  // Run AR follow-up engine — finds overdue invoices and fires rules
  app.post("/api/ar-followup/run", (req, res) => {
    try {
      const rules = sqlite.prepare("SELECT * FROM ar_followup_rules WHERE is_active=1 ORDER BY trigger_days ASC").all() as any[];
      const invoices = sqlite.prepare("SELECT * FROM invoices WHERE status != 'paid'").all() as any[];
      const now = new Date();
      let fired = 0;
      for (const inv of invoices) {
        const createdAt = new Date(inv.createdAt || inv.created_at || now.toISOString());
        const ageDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
        for (const rule of rules) {
          if (ageDays >= rule.trigger_days) {
            const alreadySent = (sqlite.prepare(
              "SELECT id FROM ar_followup_log WHERE invoice_id=? AND rule_id=?"
            ).get(inv.id, rule.id) as any);
            if (!alreadySent) {
              const body = (rule.message_template || "")
                .replace("{invoice_id}", `INV-${String(inv.id).padStart(4, "0")}`)
                .replace("{amount}", `$${(inv.total || 0).toLocaleString()}`)
                .replace("{days}", String(ageDays));
              sqlite.prepare(
                "INSERT INTO ar_followup_log (invoice_id, rule_id, sent_at, channel, message_body, status) VALUES (?,?,?,?,?,?)"
              ).run(inv.id, rule.id, now.toISOString(), rule.channel, body, "sent");
              fired++;
            }
          }
        }
      }
      res.json({ fired, checked: invoices.length, timestamp: now.toISOString() });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Lien Waivers ─────────────────────────────────────────────────────────────
  // Supports an optional ?jobId=N filter so JobDetail’s Lien Waivers tab
  // can render only the waivers for the job it’s displaying, instead of
  // pulling every waiver in the system and filtering client-side.
  app.get("/api/lien-waivers", (req, res) => {
    try {
      const jobIdParam = req.query.jobId;
      const jobId = jobIdParam ? parseInt(String(jobIdParam), 10) : NaN;
      const rows = Number.isFinite(jobId)
        ? sqlite.prepare("SELECT * FROM lien_waivers WHERE job_id=? ORDER BY id DESC").all(jobId)
        : sqlite.prepare("SELECT * FROM lien_waivers ORDER BY id DESC").all();
      res.json(rows);
    } catch { res.json([]); }
  });

  app.post("/api/lien-waivers", (req, res) => {
    try {
      const { jobId, waiverType, state, throughDate, amount, signerName, signerTitle, status, notes } = req.body;
      const now = new Date().toISOString();
      const row = sqlite.prepare(
        "INSERT INTO lien_waivers (job_id, waiver_type, state, through_date, amount, signer_name, signer_title, status, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *"
      ).get(jobId, waiverType, state || "GA", throughDate || null, amount || null, signerName || null, signerTitle || null, status || "draft", notes || null, now);
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/lien-waivers/:id", requireManage, (req, res) => {
    try {
      const fields = req.body;
      const existing = sqlite.prepare("SELECT * FROM lien_waivers WHERE id=?").get(parseInt(req.params.id)) as any;
      if (!existing) return res.status(404).json({ error: "Not found" });
      const signedAt = fields.status === "signed" && !existing.signed_at ? new Date().toISOString() : existing.signed_at;
      const row = sqlite.prepare(
        "UPDATE lien_waivers SET waiver_type=COALESCE(?,waiver_type), state=COALESCE(?,state), through_date=COALESCE(?,through_date), amount=COALESCE(?,amount), signer_name=COALESCE(?,signer_name), signer_title=COALESCE(?,signer_title), signed_at=COALESCE(?,signed_at), status=COALESCE(?,status), notes=COALESCE(?,notes) WHERE id=? RETURNING *"
      ).get(fields.waiverType ?? null, fields.state ?? null, fields.throughDate ?? null, fields.amount ?? null, fields.signerName ?? null, fields.signerTitle ?? null, signedAt ?? null, fields.status ?? null, fields.notes ?? null, parseInt(req.params.id));
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/lien-waivers/:id", requireManage, (req, res) => {
    try {
      sqlite.prepare("DELETE FROM lien_waivers WHERE id=?").run(parseInt(req.params.id));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── GPS Time Clock ────────────────────────────────────────────────────────────
  app.get("/api/time-clock", (req, res) => {
    try {
      const { employeeName, jobId } = req.query;
      let q = "SELECT * FROM time_clock WHERE 1=1";
      const params: any[] = [];
      if (employeeName) { q += " AND employee_name=?"; params.push(employeeName); }
      if (jobId) { q += " AND job_id=?"; params.push(parseInt(jobId as string)); }
      q += " ORDER BY clock_in_at DESC LIMIT 200";
      res.json(sqlite.prepare(q).all(...params));
    } catch { res.json([]); }
  });

  app.post("/api/time-clock/clock-in", (req, res) => {
    try {
      const { employeeId, employeeName, jobId, lat, lng, notes } = req.body;
      // Auto-close any open entry for this employee
      const open = sqlite.prepare("SELECT id FROM time_clock WHERE employee_name=? AND clock_out_at IS NULL").get(employeeName) as any;
      if (open) {
        sqlite.prepare("UPDATE time_clock SET clock_out_at=? WHERE id=?").run(new Date().toISOString(), open.id);
      }
      const now = new Date().toISOString();
      const row = sqlite.prepare(
        "INSERT INTO time_clock (employee_id, employee_name, job_id, clock_in_at, clock_in_lat, clock_in_lng, notes, created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING *"
      ).get(employeeId || null, employeeName, jobId || null, now, lat || null, lng || null, notes || null, now);
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/time-clock/clock-out", (req, res) => {
    try {
      const { employeeName, lat, lng } = req.body;
      const open = sqlite.prepare("SELECT * FROM time_clock WHERE employee_name=? AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1").get(employeeName) as any;
      if (!open) return res.status(404).json({ error: "No open clock-in found" });
      const now = new Date();
      const clockIn = new Date(open.clock_in_at);
      const durationMinutes = Math.round((now.getTime() - clockIn.getTime()) / 60000);
      const row = sqlite.prepare(
        "UPDATE time_clock SET clock_out_at=?, clock_out_lat=?, clock_out_lng=?, duration_minutes=? WHERE id=? RETURNING *"
      ).get(now.toISOString(), lat || null, lng || null, durationMinutes, open.id);

      // Drop the live-map pin the moment the tech clocks out so the owner's
      // map doesn't show stale positions. The tech_locations table is a
      // "currently on shift" cache, not a history log.
      try {
        if (open.employee_id) {
          sqlite.prepare("DELETE FROM tech_locations WHERE employee_id = ?").run(open.employee_id);
        }
        sqlite.prepare("DELETE FROM tech_locations WHERE employee_name = ?").run(open.employee_name);
      } catch(_) {}

      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/time-clock/open", (req, res) => {
    try {
      const rows = sqlite.prepare("SELECT * FROM time_clock WHERE clock_out_at IS NULL").all();
      res.json(rows);
    } catch { res.json([]); }
  });

  // Manual edit / delete of a time_clock entry. Techs asked for the
  // ability to fix their own clock-in / clock-out timestamps when GPS
  // missed the punch, they forgot to clock out at end of day, etc.
  //
  // Auth model:
  //   - Manager roles (owner, admin, office, general_manager) can edit
  //     or delete anyone's entry.
  //   - Everyone else can only touch their OWN rows (matched by
  //     employee_id when present, else case-insensitive employee_name).
  //
  // Every edit stamps `edited_at`, `edited_by`, and (if provided) a
  // short `edit_reason` so payroll has a paper trail if a dispute comes
  // up later. The columns are added lazily below if the DB was created
  // before this feature landed.
  try {
    const cols = sqlite.prepare("PRAGMA table_info(time_clock)").all() as any[];
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("edited_at"))     sqlite.exec("ALTER TABLE time_clock ADD COLUMN edited_at TEXT");
    if (!colNames.has("edited_by"))     sqlite.exec("ALTER TABLE time_clock ADD COLUMN edited_by TEXT");
    if (!colNames.has("edit_reason"))   sqlite.exec("ALTER TABLE time_clock ADD COLUMN edit_reason TEXT");
  } catch { /* older sqlite w/o pragma or first-run — ignore */ }

  const managerRoles = new Set(["owner", "admin", "office", "general_manager"]);
  const canEditEntry = (req: any, row: any) => {
    const u = req.user;
    if (!u) return true; // no auth wired — permissive (dev/pass-through)
    if (u.role && managerRoles.has(String(u.role).toLowerCase())) return true;
    // Fall back to owner-matches-employee. Employee IDs win over name.
    if (u.employeeId && row.employee_id && Number(u.employeeId) === Number(row.employee_id)) return true;
    if (u.name && row.employee_name && String(u.name).toLowerCase() === String(row.employee_name).toLowerCase()) return true;
    return false;
  };

  app.patch("/api/time-clock/:id", (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const row = sqlite.prepare("SELECT * FROM time_clock WHERE id = ?").get(id) as any;
      if (!row) return res.status(404).json({ error: "Time entry not found." });
      if (!canEditEntry(req, row)) return res.status(403).json({ error: "You can only edit your own time entries." });

      const { clockInAt, clockOutAt, notes, jobId, editReason } = req.body || {};

      // Normalize incoming ISO strings; reject malformed dates outright so
      // we don't stuff "Invalid Date" into the DB.
      const parseIso = (v: any): string | null => {
        if (v === null) return null;
        if (v === undefined) return undefined as any;
        const d = new Date(v);
        if (isNaN(d.getTime())) throw new Error("invalid date");
        return d.toISOString();
      };

      let nextIn: any = row.clock_in_at;
      let nextOut: any = row.clock_out_at;
      try {
        if (clockInAt !== undefined)  nextIn  = parseIso(clockInAt) ?? row.clock_in_at;
        if (clockOutAt !== undefined) nextOut = parseIso(clockOutAt);
      } catch {
        return res.status(400).json({ error: "Invalid clock-in / clock-out date." });
      }
      if (nextOut && new Date(nextOut).getTime() < new Date(nextIn).getTime()) {
        return res.status(400).json({ error: "Clock-out must be after clock-in." });
      }

      const nextDuration = nextOut
        ? Math.round((new Date(nextOut).getTime() - new Date(nextIn).getTime()) / 60000)
        : null;

      const now = new Date().toISOString();
      const editor = req.user?.name || req.user?.email || "self";

      const updated = sqlite.prepare(
        `UPDATE time_clock
           SET clock_in_at   = ?,
               clock_out_at  = ?,
               duration_minutes = ?,
               notes         = COALESCE(?, notes),
               job_id        = COALESCE(?, job_id),
               edited_at     = ?,
               edited_by     = ?,
               edit_reason   = COALESCE(?, edit_reason)
         WHERE id = ?
         RETURNING *`
      ).get(nextIn, nextOut, nextDuration, notes ?? null, jobId ?? null, now, editor, editReason ?? null, id);

      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/time-clock/:id", (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const row = sqlite.prepare("SELECT * FROM time_clock WHERE id = ?").get(id) as any;
      if (!row) return res.status(404).json({ error: "Time entry not found." });
      if (!canEditEntry(req, row)) return res.status(403).json({ error: "You can only delete your own time entries." });
      sqlite.prepare("DELETE FROM time_clock WHERE id = ?").run(id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/reports/labor-by-job", (req, res) => {
    try {
      const rows = sqlite.prepare(`
        SELECT job_id, SUM(duration_minutes) as total_minutes, COUNT(*) as sessions
        FROM time_clock WHERE duration_minutes IS NOT NULL GROUP BY job_id
      `).all();
      res.json(rows);
    } catch { res.json([]); }
  });

  // ── Pre-Departure Checklists ──────────────────────────────────────────────────
  app.get("/api/departure-checklists", (req, res) => {
    try {
      const { jobId } = req.query;
      if (jobId) {
        res.json(sqlite.prepare("SELECT * FROM departure_checklists WHERE job_id=? ORDER BY id DESC").all(parseInt(jobId as string)));
      } else {
        res.json(sqlite.prepare("SELECT * FROM departure_checklists ORDER BY id DESC LIMIT 100").all());
      }
    } catch { res.json([]); }
  });

  app.post("/api/departure-checklists", (req, res) => {
    try {
      const { jobId, employeeName, lossType, items, notes } = req.body;
      const now = new Date().toISOString();
      const itemsStr = JSON.stringify(items || []);
      const allComplete = (items || []).filter((i: any) => i.required).every((i: any) => i.checked);
      const row = sqlite.prepare(
        "INSERT INTO departure_checklists (job_id, employee_name, loss_type, items, all_required_complete, notes, created_at) VALUES (?,?,?,?,?,?,?) RETURNING *"
      ).get(jobId, employeeName, lossType || null, itemsStr, allComplete ? 1 : 0, notes || null, now);
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/departure-checklists/:id", (req, res) => {
    try {
      const { items, completedAt, notes } = req.body;
      const itemsStr = items ? JSON.stringify(items) : null;
      const allComplete = items ? items.filter((i: any) => i.required).every((i: any) => i.checked) : null;
      const row = sqlite.prepare(
        "UPDATE departure_checklists SET items=COALESCE(?,items), completed_at=COALESCE(?,completed_at), all_required_complete=COALESCE(?,all_required_complete), notes=COALESCE(?,notes) WHERE id=? RETURNING *"
      ).get(itemsStr, completedAt ?? null, allComplete !== null ? (allComplete ? 1 : 0) : null, notes ?? null, parseInt(req.params.id));
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Appointment Reminders ─────────────────────────────────────────────────────
  app.get("/api/appointment-reminders", (req, res) => {
    try {
      const rows = sqlite.prepare("SELECT * FROM appointment_reminders ORDER BY scheduled_for DESC LIMIT 200").all();
      res.json(rows);
    } catch { res.json([]); }
  });

  app.post("/api/appointment-reminders", (req, res) => {
    try {
      const { jobId, scheduledFor, contactName, contactPhone, contactEmail, reminderType, channel, messageBody } = req.body;
      const now = new Date().toISOString();
      const row = sqlite.prepare(
        "INSERT INTO appointment_reminders (job_id, scheduled_for, contact_name, contact_phone, contact_email, reminder_type, channel, status, message_body, created_at) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *"
      ).get(jobId, scheduledFor, contactName || null, contactPhone || null, contactEmail || null, reminderType || "24h", channel || "sms", "scheduled", messageBody || null, now);
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/appointment-reminders/:id", (req, res) => {
    try {
      const { status, sentAt, messageBody } = req.body;
      const row = sqlite.prepare(
        "UPDATE appointment_reminders SET status=COALESCE(?,status), sent_at=COALESCE(?,sent_at), message_body=COALESCE(?,message_body) WHERE id=? RETURNING *"
      ).get(status ?? null, sentAt ?? null, messageBody ?? null, parseInt(req.params.id));
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/appointment-reminders/:id", (req, res) => {
    try {
      sqlite.prepare("DELETE FROM appointment_reminders WHERE id=?").run(parseInt(req.params.id));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Send reminder (mark as sent)
  app.post("/api/appointment-reminders/:id/send", (req, res) => {
    try {
      const now = new Date().toISOString();
      const row = sqlite.prepare("UPDATE appointment_reminders SET status='sent', sent_at=? WHERE id=? RETURNING *").get(now, parseInt(req.params.id));
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Hazmat Flags ──────────────────────────────────────────────────────────────
  app.get("/api/hazmat-flags", (req, res) => {
    try {
      const { jobId } = req.query;
      if (jobId) {
        res.json(sqlite.prepare("SELECT * FROM hazmat_flags WHERE job_id=? ORDER BY id DESC").all(parseInt(jobId as string)));
      } else {
        res.json(sqlite.prepare("SELECT * FROM hazmat_flags ORDER BY id DESC").all());
      }
    } catch { res.json([]); }
  });

  app.post("/api/hazmat-flags", (req, res) => {
    try {
      const { jobId, flagType, riskLevel, yearBuilt, autoDetected, documentationRequired, notes } = req.body;
      const now = new Date().toISOString();
      const row = sqlite.prepare(
        "INSERT INTO hazmat_flags (job_id, flag_type, risk_level, year_built, auto_detected, acknowledged, documentation_required, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?) RETURNING *"
      ).get(jobId, flagType, riskLevel || "medium", yearBuilt || null, autoDetected !== false ? 1 : 0, 0, documentationRequired || null, notes || null, now);
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/hazmat-flags/:id", (req, res) => {
    try {
      const { acknowledged, acknowledgedBy, riskLevel, notes } = req.body;
      const acknowledgedAt = acknowledged ? new Date().toISOString() : null;
      const row = sqlite.prepare(
        "UPDATE hazmat_flags SET acknowledged=COALESCE(?,acknowledged), acknowledged_by=COALESCE(?,acknowledged_by), acknowledged_at=COALESCE(?,acknowledged_at), risk_level=COALESCE(?,risk_level), notes=COALESCE(?,notes) WHERE id=? RETURNING *"
      ).get(acknowledged !== undefined ? (acknowledged ? 1 : 0) : null, acknowledgedBy ?? null, acknowledgedAt, riskLevel ?? null, notes ?? null, parseInt(req.params.id));
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Auto-scan job for hazmat risks based on year built
  app.post("/api/hazmat-flags/auto-scan/:jobId", (req, res) => {
    try {
      const jobId = parseInt(req.params.jobId);
      const job = sqlite.prepare("SELECT * FROM jobs WHERE id=?").get(jobId) as any;
      if (!job) return res.status(404).json({ error: "Job not found" });
      const yearBuilt = job.yearBuilt || req.body.yearBuilt;
      const lossType = (job.lossType || "").toLowerCase();
      const now = new Date().toISOString();
      const flags: any[] = [];

      if (yearBuilt && yearBuilt <= 1978) {
        const existing = sqlite.prepare("SELECT id FROM hazmat_flags WHERE job_id=? AND flag_type='lead_rp'").get(jobId);
        if (!existing) {
          const r = sqlite.prepare("INSERT INTO hazmat_flags (job_id, flag_type, risk_level, year_built, auto_detected, acknowledged, documentation_required, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?) RETURNING *")
            .get(jobId, "lead_rp", yearBuilt <= 1960 ? "high" : "medium", yearBuilt, 1, 0, "EPA RRP Form 8516, Lead Test Report, Certified Renovator on-site documentation", `Structure built ${yearBuilt} — EPA RRP lead paint rule applies to all renovation, repair, and painting work.`, now);
          flags.push(r);
        }
      }
      if (yearBuilt && yearBuilt <= 1980) {
        const existing = sqlite.prepare("SELECT id FROM hazmat_flags WHERE job_id=? AND flag_type='asbestos'").get(jobId);
        if (!existing) {
          const r = sqlite.prepare("INSERT INTO hazmat_flags (job_id, flag_type, risk_level, year_built, auto_detected, acknowledged, documentation_required, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?) RETURNING *")
            .get(jobId, "asbestos", yearBuilt <= 1970 ? "high" : "medium", yearBuilt, 1, 0, "Asbestos Survey Report, AHERA Inspector Certification, Abatement Contractor License", `Structure built ${yearBuilt} — asbestos assessment required before any demolition per OSHA 1926.1101.`, now);
          flags.push(r);
        }
      }
      if (lossType === "mold") {
        const existing = sqlite.prepare("SELECT id FROM hazmat_flags WHERE job_id=? AND flag_type='mold'").get(jobId);
        if (!existing) {
          const r = sqlite.prepare("INSERT INTO hazmat_flags (job_id, flag_type, risk_level, year_built, auto_detected, acknowledged, documentation_required, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?) RETURNING *")
            .get(jobId, "mold", "medium", yearBuilt || null, 1, 0, "Pre-remediation Air Sampling, Post-clearance Report (IICRC S520 §6.2)", "Mold loss type — IICRC S520 documentation required.", now);
          flags.push(r);
        }
      }
      res.json({ flags, scannedJobId: jobId });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── BI / Analytics ────────────────────────────────────────────────────────────
  app.get("/api/reports/bi-overview", (req, res) => {
    try {
      const jobs = sqlite.prepare("SELECT * FROM jobs").all() as any[];
      const invoices = sqlite.prepare("SELECT * FROM invoices").all() as any[];
      const payments = sqlite.prepare("SELECT * FROM payments WHERE type='received'").all() as any[];
      const estimates = sqlite.prepare("SELECT * FROM estimates").all() as any[];
      const laborRows = sqlite.prepare("SELECT job_id, SUM(duration_minutes) as total_minutes FROM time_clock WHERE duration_minutes IS NOT NULL GROUP BY job_id").all() as any[];
      const laborByJob: Record<number, number> = {};
      for (const r of laborRows) laborByJob[r.job_id] = r.total_minutes;

      // Revenue by loss type
      const revByType: Record<string, number> = {};
      for (const job of jobs) {
        const lt = job.loss_type || "unknown";
        const jobInvoices = invoices.filter((i: any) => i.job_id === job.id);
        const jobRevenue = jobInvoices.reduce((s: number, i: any) => s + (i.total || 0), 0);
        revByType[lt] = (revByType[lt] || 0) + jobRevenue;
      }

      // Jobs by status
      const statusCount: Record<string, number> = {};
      for (const job of jobs) {
        const s = job.status || "unknown";
        statusCount[s] = (statusCount[s] || 0) + 1;
      }

      // Carrier AR aging
      const carrierAging: Record<string, { total: number; count: number }> = {};
      for (const inv of invoices) {
        if (inv.status !== "paid") {
          const job = jobs.find((j: any) => j.id === inv.job_id);
          const carrier = job?.insurance_carrier || "Unknown";
          if (!carrierAging[carrier]) carrierAging[carrier] = { total: 0, count: 0 };
          carrierAging[carrier].total += (inv.total || 0);
          carrierAging[carrier].count += 1;
        }
      }

      // Monthly revenue (last 6 months)
      const now = new Date();
      const monthlyRevenue: { month: string; amount: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = d.toLocaleString("default", { month: "short", year: "2-digit" });
        const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
        const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).toISOString();
        const amount = payments
          .filter((p: any) => p.paid_at && p.paid_at >= monthStart && p.paid_at <= monthEnd)
          .reduce((s: number, p: any) => s + (p.amount || 0), 0);
        monthlyRevenue.push({ month: label, amount });
      }

      // Estimator performance
      const estByJob: Record<number, any[]> = {};
      for (const e of estimates) {
        if (!estByJob[e.job_id]) estByJob[e.job_id] = [];
        estByJob[e.job_id].push(e);
      }

      res.json({
        totalJobs: jobs.length,
        openJobs: jobs.filter((j: any) => j.status !== "complete").length,
        totalRevenue: payments.reduce((s: number, p: any) => s + (p.amount || 0), 0),
        outstandingAR: invoices.filter((i: any) => i.status !== "paid").reduce((s: number, i: any) => s + (i.total || 0), 0),
        avgJobValue: invoices.length ? invoices.reduce((s: number, i: any) => s + (i.total || 0), 0) / invoices.length : 0,
        revenueByLossType: revByType,
        jobsByStatus: statusCount,
        carrierAging,
        monthlyRevenue,
        totalEstimates: estimates.length,
        totalLabor: Object.values(laborByJob).reduce((s, v) => s + v, 0),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Estimator performance
  app.get("/api/reports/estimator-performance", (req, res) => {
    try {
      const estimates = sqlite.prepare("SELECT * FROM estimates").all() as any[];
      const supplements = sqlite.prepare("SELECT * FROM supplements").all() as any[];
      const jobs = sqlite.prepare("SELECT * FROM jobs").all() as any[];

      const byJob: Record<number, { estimates: any[]; supplements: any[]; job: any }> = {};
      for (const j of jobs) {
        byJob[j.id] = { estimates: [], supplements: [], job: j };
      }
      for (const e of estimates) {
        if (byJob[e.job_id]) byJob[e.job_id].estimates.push(e);
      }
      for (const s of supplements) {
        if (byJob[s.job_id]) byJob[s.job_id].supplements.push(s);
      }

      const stats = {
        totalEstimates: estimates.length,
        totalValue: estimates.reduce((s: number, e: any) => s + (e.total || 0), 0),
        avgEstimateValue: estimates.length ? estimates.reduce((s: number, e: any) => s + (e.total || 0), 0) / estimates.length : 0,
        supplementCount: supplements.length,
        supplementRate: estimates.length ? (supplements.length / estimates.length * 100).toFixed(1) : "0",
        totalSupplementValue: supplements.reduce((s: number, sup: any) => s + (sup.amount_requested || 0), 0),
        approvedSupplements: supplements.filter((s: any) => s.status === "approved").length,
        approvalRate: supplements.length ? (supplements.filter((s: any) => s.status === "approved").length / supplements.length * 100).toFixed(1) : "0",
        byLossType: {} as Record<string, { count: number; totalValue: number; supplementCount: number }>,
      };

      for (const jobId of Object.keys(byJob)) {
        const { estimates: jobEsts, supplements: jobSupps, job } = byJob[parseInt(jobId)];
        const lt = job?.loss_type || "unknown";
        if (!stats.byLossType[lt]) stats.byLossType[lt] = { count: 0, totalValue: 0, supplementCount: 0 };
        stats.byLossType[lt].count += jobEsts.length;
        stats.byLossType[lt].totalValue += jobEsts.reduce((s: number, e: any) => s + (e.total || 0), 0);
        stats.byLossType[lt].supplementCount += jobSupps.length;
      }

      res.json(stats);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── CALENDAR EVENTS ───────────────────────────────────────────
  // Standalone entries on the schedule that are NOT tied to a job. Used
  // for internal meetings, training, PTO days someone wants visible on
  // dispatch, vendor visits, etc. Attendees are optional — stored as a
  // JSON array of names so anyone (system user, subcontractor, or an
  // ad-hoc "Homeowner Bob") can be tagged without needing to exist as a
  // real record. Rendered by the Scheduling page alongside shifts.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    location TEXT,
    notes TEXT,
    attendees TEXT NOT NULL DEFAULT '[]',
    color TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  function parseAttendees(v: any): string[] {
    if (Array.isArray(v)) return v.map(x => String(x || "").trim()).filter(Boolean);
    if (typeof v === "string" && v.trim()) {
      // Accept comma-separated strings too so the client can be lazy.
      try { const j = JSON.parse(v); if (Array.isArray(j)) return j.map(x => String(x || "").trim()).filter(Boolean); } catch {}
      return v.split(",").map(s => s.trim()).filter(Boolean);
    }
    return [];
  }
  function hydrateEvent(row: any) {
    if (!row) return row;
    let attendees: string[] = [];
    try { attendees = JSON.parse(row.attendees || "[]"); } catch { attendees = []; }
    return {
      id: row.id,
      title: row.title,
      eventDate: row.event_date,
      startTime: row.start_time || null,
      endTime: row.end_time || null,
      location: row.location || null,
      notes: row.notes || null,
      color: row.color || null,
      attendees: Array.isArray(attendees) ? attendees : [],
      createdBy: row.created_by || null,
      createdAt: row.created_at,
    };
  }

  app.get("/api/calendar-events", (req, res) => {
    try {
      const { start, end } = req.query as { start?: string; end?: string };
      let rows: any[];
      if (start && end) {
        rows = sqlite.prepare("SELECT * FROM calendar_events WHERE event_date >= ? AND event_date <= ? ORDER BY event_date, COALESCE(start_time,'')").all(start, end) as any[];
      } else {
        rows = sqlite.prepare("SELECT * FROM calendar_events ORDER BY event_date DESC, COALESCE(start_time,'') LIMIT 500").all() as any[];
      }
      res.json(rows.map(hydrateEvent));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/calendar-events", (req, res) => {
    try {
      const b = req.body || {};
      if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: "title required" });
      if (!b.eventDate) return res.status(400).json({ error: "eventDate required" });
      const attendees = JSON.stringify(parseAttendees(b.attendees));
      const createdBy = (req as any).user?.name || null;
      const info = sqlite.prepare(`INSERT INTO calendar_events
        (title, event_date, start_time, end_time, location, notes, attendees, color, created_by)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
        String(b.title).trim(),
        b.eventDate,
        b.startTime || null,
        b.endTime || null,
        b.location || null,
        b.notes || null,
        attendees,
        b.color || null,
        createdBy,
      );
      const row = sqlite.prepare("SELECT * FROM calendar_events WHERE id=?").get(info.lastInsertRowid) as any;
      const hydrated = hydrateEvent(row);
      // Fire-and-forget email to every initial attendee. Best-effort; if
      // SMTP/Gmail isn't configured or the tagged name isn't a real
      // employee (e.g. a homeowner), we quietly skip.
      void sendEventTagEmails(sqlite, {
        eventId: hydrated.id,
        title: hydrated.title,
        eventDate: hydrated.eventDate,
        startTime: hydrated.startTime,
        endTime: hydrated.endTime,
        location: hydrated.location,
        notes: hydrated.notes,
        createdBy: hydrated.createdBy,
        attendeeNames: hydrated.attendees,
      });
      res.json(hydrated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/calendar-events/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      const cur = sqlite.prepare("SELECT * FROM calendar_events WHERE id=?").get(id) as any;
      if (!cur) return res.status(404).json({ error: "not found" });
      const b = req.body || {};
      const attendees = b.attendees !== undefined ? JSON.stringify(parseAttendees(b.attendees)) : cur.attendees;
      sqlite.prepare(`UPDATE calendar_events SET
        title = COALESCE(?, title),
        event_date = COALESCE(?, event_date),
        start_time = ?,
        end_time = ?,
        location = ?,
        notes = ?,
        attendees = ?,
        color = ?
        WHERE id = ?`).run(
        b.title ?? null,
        b.eventDate ?? null,
        b.startTime !== undefined ? (b.startTime || null) : cur.start_time,
        b.endTime   !== undefined ? (b.endTime   || null) : cur.end_time,
        b.location  !== undefined ? (b.location  || null) : cur.location,
        b.notes     !== undefined ? (b.notes     || null) : cur.notes,
        attendees,
        b.color     !== undefined ? (b.color     || null) : cur.color,
        id,
      );
      const row = sqlite.prepare("SELECT * FROM calendar_events WHERE id=?").get(id) as any;
      const hydrated = hydrateEvent(row);
      // If new attendees were added on this update, notify only the
      // new names — don't re-email existing attendees every save.
      if (b.attendees !== undefined) {
        let prevList: string[] = [];
        try { prevList = JSON.parse(cur.attendees || "[]"); } catch { prevList = []; }
        const added = newlyAddedAttendees(prevList, hydrated.attendees);
        if (added.length > 0) {
          void sendEventTagEmails(sqlite, {
            eventId: hydrated.id,
            title: hydrated.title,
            eventDate: hydrated.eventDate,
            startTime: hydrated.startTime,
            endTime: hydrated.endTime,
            location: hydrated.location,
            notes: hydrated.notes,
            createdBy: hydrated.createdBy,
            attendeeNames: added,
          });
        }
      }
      res.json(hydrated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/calendar-events/:id", (req, res) => {
    try {
      const id = Number(req.params.id);
      const info = sqlite.prepare("DELETE FROM calendar_events WHERE id=?").run(id);
      res.json({ ok: true, deleted: info.changes });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
