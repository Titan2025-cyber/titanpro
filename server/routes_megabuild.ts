// Mega-build (2026-07-30): unified route registration for the 11-feature build.
// Groups: escalation drafts outbox (#1/#2/#16/#18), adjuster contacts (#1),
// invoice touches + AR follow-up (#2), partner metrics (#9), consolidated P&L
// (#13), bulk endpoints (#22), geofence + nearest-job (#5), W9/dispatch-lock
// (#16), e-sign hardening (#17), cert PDF export (#18), storm ingest (#12).

import type { Express, Request, Response, NextFunction } from "express";
import type Database from "better-sqlite3";
import { runSchedulerNow } from "./scheduler";

type Sqlite = Database.Database;
type Middleware = (req: any, res: any, next: any) => any;
type Handler = (req: any, res: any, next?: any) => any;

interface Deps {
  requireRole: (...roles: string[]) => Middleware;
  requireStaffAuth: Middleware;
  wrapAsync: (fn: Handler) => Handler;
}

// Utility: haversine distance in meters between two lat/lng.
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Utility: safe query with a fallback (routes that touch tables that may not
// exist on all deployments should degrade gracefully).
function safeAll(sqlite: Sqlite, sql: string, ...params: any[]): any[] {
  try { return sqlite.prepare(sql).all(...params) as any[]; } catch { return []; }
}
function safeGet(sqlite: Sqlite, sql: string, ...params: any[]): any {
  try { return sqlite.prepare(sql).get(...params); } catch { return null; }
}
function safeRun(sqlite: Sqlite, sql: string, ...params: any[]) {
  try { sqlite.prepare(sql).run(...params); } catch {}
}

export function registerMegaBuildRoutes(app: Express, sqlite: Sqlite, deps: Deps) {
  const { requireRole, requireStaffAuth, wrapAsync } = deps;

  // ────────────────────────────────────────────────────────────────────────
  // Escalation drafts outbox (#1, #2, #16, #18)
  // ────────────────────────────────────────────────────────────────────────

  // List drafts (default: draft status). Owner/admin only.
  app.get("/api/escalation-drafts", requireRole("owner", "admin", "office"), (req, res) => {
    const status = String(req.query.status || "draft");
    const type = req.query.type ? String(req.query.type) : null;
    let sql = `SELECT * FROM escalation_drafts WHERE status = ?`;
    const params: any[] = [status];
    if (type) { sql += ` AND type = ?`; params.push(type); }
    sql += ` ORDER BY created_at DESC LIMIT 500`;
    res.json(safeAll(sqlite, sql, ...params));
  });

  // Mark as sent (records who sent it).
  app.post("/api/escalation-drafts/:id/send", requireRole("owner", "admin", "office"), (req: any, res) => {
    const id = Number(req.params.id);
    const by = req.employee?.name || "unknown";
    try {
      sqlite.prepare(
        `UPDATE escalation_drafts SET status = 'sent', sent_at = ?, sent_by = ? WHERE id = ?`
      ).run(new Date().toISOString(), by, id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "send failed" });
    }
  });

  app.post("/api/escalation-drafts/:id/dismiss", requireRole("owner", "admin", "office"), (req, res) => {
    try {
      sqlite.prepare(`UPDATE escalation_drafts SET status = 'dismissed' WHERE id = ?`).run(Number(req.params.id));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "dismiss failed" });
    }
  });

  // Manual scheduler kick (owner) \u2014 useful for smoke tests and demos.
  app.post("/api/scheduler/run-now", requireRole("owner"), wrapAsync(async (_req: any, res: any) => {
    await runSchedulerNow(sqlite);
    const runs = safeAll(sqlite, `SELECT * FROM scheduler_runs`);
    res.json({ ok: true, runs });
  }));

  app.get("/api/scheduler/status", requireRole("owner", "admin"), (_req, res) => {
    res.json(safeAll(sqlite, `SELECT * FROM scheduler_runs ORDER BY job_name`));
  });

  // ────────────────────────────────────────────────────────────────────────
  // #1 Adjuster contact log
  // ────────────────────────────────────────────────────────────────────────

  // List contacts for a job (newest first).
  app.get("/api/jobs/:id/adjuster-contacts", requireStaffAuth, (req, res) => {
    const id = Number(req.params.id);
    res.json(safeAll(sqlite,
      `SELECT * FROM adjuster_contacts WHERE job_id = ? ORDER BY contacted_at DESC`, id));
  });

  // Log a new contact. Any authed employee can log.
  app.post("/api/jobs/:id/adjuster-contacts", requireStaffAuth, (req: any, res) => {
    const jobId = Number(req.params.id);
    const b = req.body || {};
    const method = String(b.method || "").toLowerCase();
    if (!["call", "email", "text", "in_person", "other"].includes(method)) {
      return res.status(400).json({ error: "method required (call|email|text|in_person|other)" });
    }
    const now = new Date().toISOString();
    try {
      const info = sqlite.prepare(
        `INSERT INTO adjuster_contacts (job_id, adjuster_name, contacted_by, method, direction, notes, contacted_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        jobId,
        b.adjuster_name || null,
        req.employee?.name || "unknown",
        method,
        (b.direction === "inbound") ? "inbound" : "outbound",
        b.notes || null,
        b.contacted_at || now,
        now
      );
      // If this touches a "silence" draft for that job today, auto-dismiss it.
      try {
        const day = now.slice(0, 10);
        sqlite.prepare(
          `UPDATE escalation_drafts SET status = 'dismissed'
           WHERE type = 'adjuster_silence' AND related_job_id = ? AND status = 'draft'
             AND dedupe_key LIKE ?`
        ).run(jobId, `adjuster_silence:job=${jobId}:%:day=${day}`);
      } catch {}
      res.json({ ok: true, id: info.lastInsertRowid });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "log failed" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // #2 Invoice touch log + promise-to-pay + AR status
  // ────────────────────────────────────────────────────────────────────────

  app.get("/api/invoices/:id/touches", requireStaffAuth, (req, res) => {
    const id = Number(req.params.id);
    res.json(safeAll(sqlite,
      `SELECT * FROM invoice_touches WHERE invoice_id = ? ORDER BY touched_at DESC`, id));
  });

  app.post("/api/invoices/:id/touches", requireStaffAuth, (req: any, res) => {
    const invoiceId = Number(req.params.id);
    const b = req.body || {};
    const outcome = b.outcome ? String(b.outcome) : null;
    const method = String(b.method || "").toLowerCase();
    if (!["call", "email", "text", "portal", "other"].includes(method)) {
      return res.status(400).json({ error: "method required (call|email|text|portal|other)" });
    }
    if (outcome && !["promise_to_pay", "disputed", "no_answer", "paid", "other"].includes(outcome)) {
      return res.status(400).json({ error: "invalid outcome" });
    }
    const now = new Date().toISOString();
    try {
      sqlite.prepare(
        `INSERT INTO invoice_touches (invoice_id, touched_by, method, outcome, promise_date, promise_amount, notes, touched_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        invoiceId,
        req.employee?.name || "unknown",
        method,
        outcome,
        b.promise_date || null,
        b.promise_amount != null ? Number(b.promise_amount) : null,
        b.notes || null,
        b.touched_at || now,
        now
      );
      // Roll up onto invoice
      const followupStatus =
        outcome === "promise_to_pay" ? "promised" :
        outcome === "disputed" ? "disputed" :
        "contacted";
      const promiseDate = outcome === "promise_to_pay" ? (b.promise_date || null) : null;
      const promiseAmount = outcome === "promise_to_pay" ? (b.promise_amount != null ? Number(b.promise_amount) : null) : null;
      try {
        sqlite.prepare(
          `UPDATE invoices SET last_touched_at = ?, followup_status = ?, promise_to_pay_date = COALESCE(?, promise_to_pay_date), promise_to_pay_amount = COALESCE(?, promise_to_pay_amount) WHERE id = ?`
        ).run(now, followupStatus, promiseDate, promiseAmount, invoiceId);
      } catch {}
      // If this was a stalled draft for this invoice, auto-dismiss.
      try {
        const day = now.slice(0, 10);
        sqlite.prepare(
          `UPDATE escalation_drafts SET status = 'dismissed'
           WHERE type = 'ar_stalled' AND related_invoice_id = ? AND status = 'draft' AND dedupe_key = ?`
        ).run(invoiceId, `ar_stalled:inv=${invoiceId}:day=${day}`);
      } catch {}
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "touch failed" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // #9 Partner scorecard: extend the ROI report with last-touch + margin
  // (kept as a separate endpoint so we don't break the existing report).
  // ────────────────────────────────────────────────────────────────────────

  app.get("/api/reports/partner-scorecard", requireRole("owner", "admin", "sales"), (_req, res) => {
    const rows: any[] = safeAll(sqlite, `
      SELECT c.id, c.name, c.email, c.phone, c.partner_since, c.last_touched_at,
             COUNT(DISTINCT j.id) AS jobs_referred,
             COALESCE(SUM(i.total_amount), 0) AS revenue_produced,
             COALESCE(SUM(i.paid_amount), 0) AS revenue_collected,
             COALESCE(SUM(jc.amount), 0) AS total_costs
      FROM contacts c
      LEFT JOIN jobs j ON j.referral_partner_id = c.id
      LEFT JOIN invoices i ON i.job_id = j.id
      LEFT JOIN job_costs jc ON jc.job_id = j.id
      WHERE c.type IN ('referral_partner','partner','adjuster','property_manager')
         OR c.partner_since IS NOT NULL
      GROUP BY c.id
    `);
    // Compute avg margin per partner
    const now = new Date();
    const withMetrics = rows.map(r => {
      const revenue = Number(r.revenue_produced || 0);
      const costs = Number(r.total_costs || 0);
      const gross_profit = revenue - costs;
      const avg_margin_pct = revenue > 0 ? (gross_profit / revenue) * 100 : null;
      const lastTouch = r.last_touched_at ? new Date(r.last_touched_at) : null;
      const days_since_touch = lastTouch && !Number.isNaN(lastTouch.getTime())
        ? Math.floor((now.getTime() - lastTouch.getTime()) / (24 * 3600 * 1000))
        : null;
      return { ...r, gross_profit, avg_margin_pct, days_since_touch };
    });
    res.json(withMetrics);
  });

  // Log a partner touch (updates contacts.last_touched_at).
  app.post("/api/contacts/:id/touch", requireStaffAuth, (req: any, res) => {
    const id = Number(req.params.id);
    const now = new Date().toISOString();
    try {
      sqlite.prepare(`UPDATE contacts SET last_touched_at = ? WHERE id = ?`).run(now, id);
      res.json({ ok: true, last_touched_at: now });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "touch failed" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // #13 Consolidated P&L per job
  // ────────────────────────────────────────────────────────────────────────

  app.get("/api/jobs/:id/pnl", requireStaffAuth, (req: any, res) => {
    const id = Number(req.params.id);
    const job: any = safeGet(sqlite, `SELECT * FROM jobs WHERE id = ?`, id);
    if (!job) return res.status(404).json({ error: "job not found" });

    // Sold amount from most recent estimate/approved amount, fallback to invoice totals.
    const est: any = safeGet(sqlite,
      `SELECT COALESCE(SUM(total_amount),0) AS total FROM estimates WHERE job_id = ? AND (status IS NULL OR status != 'draft')`, id);
    const inv: any = safeGet(sqlite,
      `SELECT COALESCE(SUM(total_amount),0) AS total, COALESCE(SUM(paid_amount),0) AS paid FROM invoices WHERE job_id = ?`, id);
    const soldAmount = Number(est?.total || inv?.total || 0);
    const collected = Number(inv?.paid || 0);
    const invoicedTotal = Number(inv?.total || 0);

    // Costs by category
    const costsByCategory: any[] = safeAll(sqlite,
      `SELECT COALESCE(category, 'uncategorized') AS category, COALESCE(SUM(amount), 0) AS amount
       FROM job_costs WHERE job_id = ? GROUP BY category`, id);
    // Labor from time_clock rows (if hourly_rate set on employees)
    const laborRow: any = safeGet(sqlite, `
      SELECT COALESCE(SUM(
        CASE WHEN tc.clock_out_at IS NOT NULL AND e.hourly_rate IS NOT NULL
          THEN ((julianday(tc.clock_out_at) - julianday(tc.clock_in_at)) * 24 * e.hourly_rate)
          ELSE 0 END
      ), 0) AS labor_cost,
      COALESCE(SUM(CASE WHEN tc.clock_out_at IS NOT NULL
        THEN (julianday(tc.clock_out_at) - julianday(tc.clock_in_at)) * 24
        ELSE 0 END), 0) AS labor_hours
      FROM time_clock tc
      LEFT JOIN employees e ON e.id = tc.employee_id
      WHERE tc.job_id = ?`, id);

    const laborCost = Number(laborRow?.labor_cost || 0);
    const laborHours = Number(laborRow?.labor_hours || 0);
    const materialsCost = costsByCategory
      .filter(c => /material|supply|part/i.test(c.category))
      .reduce((s, c) => s + Number(c.amount || 0), 0);
    const subCost = costsByCategory
      .filter(c => /sub|contractor/i.test(c.category))
      .reduce((s, c) => s + Number(c.amount || 0), 0);
    const otherCost = costsByCategory
      .filter(c => !/material|supply|part|sub|contractor|labor/i.test(c.category))
      .reduce((s, c) => s + Number(c.amount || 0), 0);
    // If job_costs has a labor category, we prefer that over derived labor.
    const bookedLabor = costsByCategory
      .filter(c => /labor/i.test(c.category))
      .reduce((s, c) => s + Number(c.amount || 0), 0);
    const totalLabor = bookedLabor > 0 ? bookedLabor : laborCost;

    const totalCost = totalLabor + materialsCost + subCost + otherCost;
    const grossProfit = soldAmount - totalCost;
    const grossMarginPct = soldAmount > 0 ? (grossProfit / soldAmount) * 100 : null;
    // Configurable floor: job override > org default (env or 35%)
    const orgFloor = Number(process.env.MARGIN_FLOOR_PCT || 35);
    const marginFloor = job.margin_floor_pct != null ? Number(job.margin_floor_pct) : orgFloor;
    const belowFloor = grossMarginPct != null && grossMarginPct < marginFloor;

    res.json({
      job_id: id,
      job_number: job.job_number,
      sold_amount: soldAmount,
      invoiced_total: invoicedTotal,
      collected,
      costs: {
        labor: totalLabor,
        materials: materialsCost,
        subs: subCost,
        other: otherCost,
        total: totalCost,
      },
      labor_hours: laborHours,
      gross_profit: grossProfit,
      gross_margin_pct: grossMarginPct,
      margin_floor_pct: marginFloor,
      below_floor: belowFloor,
    });
  });

  // Set/override job margin floor.
  app.patch("/api/jobs/:id/margin-floor", requireRole("owner", "admin"), (req, res) => {
    const id = Number(req.params.id);
    const v = req.body?.margin_floor_pct;
    const value = (v === null || v === undefined || v === "") ? null : Number(v);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) {
      return res.status(400).json({ error: "invalid margin_floor_pct" });
    }
    try {
      sqlite.prepare(`UPDATE jobs SET margin_floor_pct = ? WHERE id = ?`).run(value, id);
      res.json({ ok: true, margin_floor_pct: value });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "update failed" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // #5 Geofence: nearest job to a lat/lng within radius
  // ────────────────────────────────────────────────────────────────────────

  app.get("/api/jobs/nearest", requireStaffAuth, (req, res) => {
    const lat = parseFloat(String(req.query.lat));
    const lng = parseFloat(String(req.query.lng));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "lat and lng required" });
    }
    const rows: any[] = safeAll(sqlite,
      `SELECT id, job_number, address, latitude, longitude, geofence_radius_m, status
       FROM jobs
       WHERE latitude IS NOT NULL AND longitude IS NOT NULL
         AND status IN ('new','mitigation','drying','reconstruction')`
    );
    let best: any = null;
    let bestDist = Infinity;
    for (const j of rows) {
      const d = haversineMeters(lat, lng, Number(j.latitude), Number(j.longitude));
      const radius = Number(j.geofence_radius_m || 61);
      if (d <= radius && d < bestDist) {
        best = { ...j, distance_m: Math.round(d), inside: true };
        bestDist = d;
      }
    }
    if (!best) {
      // Also return the closest job overall (may be outside radius) so client can
      // display "closest job is X ft away, still outside geofence" if useful.
      let closest: any = null;
      let closestDist = Infinity;
      for (const j of rows) {
        const d = haversineMeters(lat, lng, Number(j.latitude), Number(j.longitude));
        if (d < closestDist) { closest = { ...j, distance_m: Math.round(d), inside: false }; closestDist = d; }
      }
      return res.json({ inside: false, closest });
    }
    res.json({ inside: true, job: best });
  });

  // ────────────────────────────────────────────────────────────────────────
  // #16 W9 tracking + dispatch-lock enforcement
  // ────────────────────────────────────────────────────────────────────────

  // Return contacts (subs) with their dispatch-block status.
  app.get("/api/subs/dispatch-status", requireRole("owner", "admin", "office"), (_req, res) => {
    res.json(safeAll(sqlite, `
      SELECT c.id, c.name, c.dispatch_blocked, c.dispatch_block_reason,
             (SELECT MIN(expiration_date) FROM coi_records r WHERE r.contact_id = c.id AND r.document_type = 'coi') AS coi_next_expiry,
             (SELECT MIN(expiration_date) FROM coi_records r WHERE r.contact_id = c.id AND r.document_type = 'w9') AS w9_next_expiry
      FROM contacts c
      WHERE c.type IN ('subcontractor','sub','vendor')
      ORDER BY c.name
    `));
  });

  // Manually unblock a sub (owner). Auto-block still fires on next scheduler run.
  app.post("/api/subs/:id/unblock", requireRole("owner", "admin"), (req, res) => {
    try {
      sqlite.prepare(`UPDATE contacts SET dispatch_blocked = 0, dispatch_block_reason = NULL WHERE id = ?`).run(Number(req.params.id));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "unblock failed" });
    }
  });

  // Dispatch check: is this sub assignable to a job right now?
  app.get("/api/subs/:id/can-dispatch", requireStaffAuth, (req, res) => {
    const c: any = safeGet(sqlite, `SELECT id, name, dispatch_blocked, dispatch_block_reason FROM contacts WHERE id = ?`, Number(req.params.id));
    if (!c) return res.status(404).json({ error: "not found" });
    res.json({ can_dispatch: !c.dispatch_blocked, reason: c.dispatch_block_reason });
  });

  // ────────────────────────────────────────────────────────────────────────
  // #17 E-sign hardening \u2014 capture IP + UA on signature submission
  // (This is a helper endpoint; the actual signing UI already writes the row.
  // Clients POST here with the job_document id to attach IP metadata after
  // creation, or we can PATCH into the record directly.)
  // ────────────────────────────────────────────────────────────────────────

  app.post("/api/job-documents/:id/attest", requireStaffAuth, (req: any, res) => {
    const id = Number(req.params.id);
    const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0].trim()) || req.ip || null;
    const ua = req.headers["user-agent"]?.toString().slice(0, 500) || null;
    try {
      sqlite.prepare(
        `UPDATE job_documents SET signer_ip = COALESCE(signer_ip, ?), signer_user_agent = COALESCE(signer_user_agent, ?) WHERE id = ?`
      ).run(ip, ua, id);
      res.json({ ok: true, ip, user_agent: ua });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "attest failed" });
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // #6 Drying log CSV export (per job)
  // ────────────────────────────────────────────────────────────────────────

  app.get("/api/jobs/:id/drying-log.csv", requireStaffAuth, (req, res) => {
    const id = Number(req.params.id);
    const rows: any[] = safeAll(sqlite,
      `SELECT * FROM drying_records WHERE job_id = ? ORDER BY reading_date, COALESCE(reading_time,'')`, id);
    const job: any = safeGet(sqlite, `SELECT job_number, address FROM jobs WHERE id = ?`, id);
    const header = [
      "job_number", "address", "day", "date", "time", "tech", "water_category", "water_class",
      "ambient_temp_f", "ambient_rh_pct", "ambient_gpp", "dew_point_f",
      "room", "material", "moisture_reading", "target", "goal_met"
    ].join(",") + "\n";
    const escCsv = (v: any) => v == null ? "" : `"${String(v).replace(/"/g, '""')}"`;
    const lines: string[] = [];
    for (const r of rows) {
      let readings: any[] = [];
      try { readings = JSON.parse(r.moisture_readings || "[]"); } catch {}
      if (readings.length === 0) {
        lines.push([
          job?.job_number, job?.address, r.day_number, r.reading_date, r.reading_time, r.tech_name,
          r.water_category, r.water_class, r.temp_f, r.rh_pct, r.gpp, r.dew_point_f,
          "", "", "", "", ""
        ].map(escCsv).join(","));
        continue;
      }
      for (const rd of readings) {
        const goalMet = (rd.reading != null && rd.target != null) ? (Number(rd.reading) <= Number(rd.target) ? "yes" : "no") : "";
        lines.push([
          job?.job_number, job?.address, r.day_number, r.reading_date, r.reading_time, r.tech_name,
          r.water_category, r.water_class, r.temp_f, r.rh_pct, r.gpp, r.dew_point_f,
          rd.location, rd.material, rd.reading, rd.target, goalMet
        ].map(escCsv).join(","));
      }
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="drying-log-${job?.job_number || id}.csv"`);
    res.send(header + lines.join("\n"));
  });

  // ────────────────────────────────────────────────────────────────────────
  // #18 Cert compliance report (CSV export)
  // ────────────────────────────────────────────────────────────────────────

  app.get("/api/reports/cert-compliance.csv", requireRole("owner", "admin"), (_req, res) => {
    const rows: any[] = safeAll(sqlite,
      `SELECT employee_name, cert_type, cert_number, issued_date, expiration_date, status FROM certifications ORDER BY employee_name, cert_type`);
    const today = new Date();
    const header = "employee_name,cert_type,cert_number,issued_date,expiration_date,days_until_expiry,status\n";
    const lines = rows.map(r => {
      const exp = r.expiration_date ? new Date(r.expiration_date) : null;
      const days = exp && !Number.isNaN(exp.getTime())
        ? Math.floor((exp.getTime() - today.getTime()) / (24 * 3600 * 1000))
        : "";
      const esc = (v: any) => v == null ? "" : `"${String(v).replace(/"/g, '""')}"`;
      return [r.employee_name, r.cert_type, r.cert_number, r.issued_date, r.expiration_date, days, r.status].map(esc).join(",");
    }).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="cert-compliance-${today.toISOString().slice(0,10)}.csv"`);
    res.send(header + lines);
  });

  // ────────────────────────────────────────────────────────────────────────
  // #22 Bulk actions
  // ────────────────────────────────────────────────────────────────────────

  // Bulk update job status.
  app.patch("/api/jobs/bulk", requireRole("owner", "admin", "office"), (req, res) => {
    const b = req.body || {};
    const ids: number[] = Array.isArray(b.ids) ? b.ids.map((n: any) => Number(n)).filter(Number.isFinite) : [];
    if (ids.length === 0) return res.status(400).json({ error: "ids required" });
    const updates: string[] = [];
    const params: any[] = [];
    if (b.status !== undefined)    { updates.push("status = ?"); params.push(String(b.status)); }
    if (b.assigned_tech !== undefined) { updates.push("assigned_tech = ?"); params.push(String(b.assigned_tech)); }
    if (b.priority !== undefined)  { updates.push("priority = ?"); params.push(String(b.priority)); }
    if (updates.length === 0) return res.status(400).json({ error: "no updatable fields" });
    const placeholders = ids.map(() => "?").join(",");
    try {
      sqlite.prepare(`UPDATE jobs SET ${updates.join(", ")} WHERE id IN (${placeholders})`).run(...params, ...ids);
      res.json({ ok: true, updated: ids.length });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "bulk update failed" });
    }
  });

  // Bulk update invoice status.
  app.patch("/api/invoices/bulk", requireRole("owner", "admin", "office"), (req, res) => {
    const b = req.body || {};
    const ids: number[] = Array.isArray(b.ids) ? b.ids.map((n: any) => Number(n)).filter(Number.isFinite) : [];
    if (ids.length === 0) return res.status(400).json({ error: "ids required" });
    const updates: string[] = [];
    const params: any[] = [];
    if (b.status !== undefined) { updates.push("status = ?"); params.push(String(b.status)); }
    if (b.followup_status !== undefined) { updates.push("followup_status = ?"); params.push(String(b.followup_status)); }
    if (updates.length === 0) return res.status(400).json({ error: "no updatable fields" });
    const placeholders = ids.map(() => "?").join(",");
    try {
      sqlite.prepare(`UPDATE invoices SET ${updates.join(", ")} WHERE id IN (${placeholders})`).run(...params, ...ids);
      res.json({ ok: true, updated: ids.length });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "bulk update failed" });
    }
  });

  // Bulk close jobs (convenience wrapper).
  app.patch("/api/jobs/bulk-close", requireRole("owner", "admin"), (req, res) => {
    const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map((n: any) => Number(n)).filter(Number.isFinite) : [];
    if (ids.length === 0) return res.status(400).json({ error: "ids required" });
    const placeholders = ids.map(() => "?").join(",");
    try {
      sqlite.prepare(`UPDATE jobs SET status = 'complete' WHERE id IN (${placeholders})`).run(...ids);
      res.json({ ok: true, closed: ids.length });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "bulk close failed" });
    }
  });

  // Bulk generate invoices from jobs: creates one invoice per job with a
  // simple pass-through of estimate total. Used by Jobs page bulk action.
  app.post("/api/jobs/bulk-invoice", requireRole("owner", "admin", "office"), (req, res) => {
    const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map((n: any) => Number(n)).filter(Number.isFinite) : [];
    if (ids.length === 0) return res.status(400).json({ error: "ids required" });
    let created = 0;
    const now = new Date().toISOString();
    const dueDate = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    for (const id of ids) {
      try {
        const job: any = safeGet(sqlite, `SELECT job_number, customer_id FROM jobs WHERE id = ?`, id);
        if (!job) continue;
        const est: any = safeGet(sqlite,
          `SELECT COALESCE(SUM(total_amount),0) AS total FROM estimates WHERE job_id = ? AND (status IS NULL OR status != 'draft')`, id);
        const already: any = safeGet(sqlite, `SELECT COUNT(*) AS c FROM invoices WHERE job_id = ?`, id);
        if (already && Number(already.c) > 0) continue; // don't double-invoice
        const total = Number(est?.total || 0);
        if (total <= 0) continue;
        const invNum = `INV-${job.job_number || id}-${Date.now().toString().slice(-4)}`;
        sqlite.prepare(
          `INSERT INTO invoices (invoice_number, job_id, customer_id, total_amount, due_date, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'sent', ?)`
        ).run(invNum, id, job.customer_id, total, dueDate, now);
        created++;
      } catch {}
    }
    res.json({ ok: true, created, requested: ids.length });
  });
}
