import type { Express } from "express";
import Database from "better-sqlite3";

const now = () => new Date().toISOString();

export function registerRoutePlannerRoutes(app: Express, sqlite: Database.Database) {

  // ── Bootstrap tables ────────────────────────────────────────────────────────
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS saved_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'dedicated',
      description TEXT,
      assigned_to TEXT,
      color TEXT NOT NULL DEFAULT '#3b82f6',
      is_active INTEGER NOT NULL DEFAULT 1,
      estimated_duration INTEGER,
      estimated_miles REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS route_stops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      job_id INTEGER,
      contact_id INTEGER,
      label TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL,
      lng REAL,
      stop_type TEXT NOT NULL DEFAULT 'visit',
      priority INTEGER NOT NULL DEFAULT 1,
      order_index INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS route_trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL,
      assigned_to TEXT,
      scheduled_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      started_at TEXT,
      completed_at TEXT,
      actual_miles REAL,
      stop_results TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT ''
    );
  `);

  // ── Saved Routes ─────────────────────────────────────────────────────────────

  // GET /api/routes — list all routes with stop count
  app.get("/api/routes", (_req, res) => {
    try {
      const routes = sqlite.prepare(`SELECT * FROM saved_routes ORDER BY created_at DESC`).all() as any[];
      const enriched = routes.map(r => {
        const stops = sqlite.prepare(`SELECT COUNT(*) as cnt FROM route_stops WHERE route_id = ?`).get(r.id) as any;
        const trips = sqlite.prepare(`SELECT COUNT(*) as cnt FROM route_trips WHERE route_id = ?`).get(r.id) as any;
        const lastTrip = sqlite.prepare(`SELECT scheduled_date, status FROM route_trips WHERE route_id = ? ORDER BY scheduled_date DESC LIMIT 1`).get(r.id) as any;
        return { ...r, stopCount: stops.cnt, tripCount: trips.cnt, lastTrip };
      });
      res.json(enriched);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/routes/:id — single route with stops
  app.get("/api/routes/:id", (req, res) => {
    try {
      const route = sqlite.prepare(`SELECT * FROM saved_routes WHERE id = ?`).get(req.params.id) as any;
      if (!route) return res.status(404).json({ error: "Not found" });
      const stops = sqlite.prepare(`SELECT * FROM route_stops WHERE route_id = ? ORDER BY order_index ASC`).all(req.params.id) as any[];
      // Enrich stops with job/contact data if linked
      const enrichedStops = stops.map(s => {
        let jobData = null, contactData = null;
        if (s.job_id) {
          jobData = sqlite.prepare(`SELECT job_number, address, loss_type, status FROM jobs WHERE id = ?`).get(s.job_id);
        }
        if (s.contact_id) {
          contactData = sqlite.prepare(`SELECT name, phone, company FROM contacts WHERE id = ?`).get(s.contact_id);
        }
        return { ...s, job: jobData, contact: contactData };
      });
      res.json({ ...route, stops: enrichedStops });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/routes — create route
  app.post("/api/routes", (req, res) => {
    try {
      const { name, type = "dedicated", description, assigned_to, color = "#3b82f6",
              estimated_duration, estimated_miles, notes } = req.body;
      if (!name) return res.status(400).json({ error: "name required" });
      const ts = now();
      const result = sqlite.prepare(`
        INSERT INTO saved_routes (name, type, description, assigned_to, color, is_active,
          estimated_duration, estimated_miles, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
      `).run(name, type, description ?? null, assigned_to ?? null, color,
             estimated_duration ?? null, estimated_miles ?? null, notes ?? null, ts, ts);
      const created = sqlite.prepare(`SELECT * FROM saved_routes WHERE id = ?`).get(result.lastInsertRowid) as any;
      res.status(201).json(created);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/routes/:id — update route
  app.patch("/api/routes/:id", (req, res) => {
    try {
      const fields = ["name","type","description","assigned_to","color","is_active",
                      "estimated_duration","estimated_miles","notes"];
      const sets: string[] = [];
      const vals: any[] = [];
      for (const f of fields) {
        if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
      }
      if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
      sets.push("updated_at = ?"); vals.push(now()); vals.push(req.params.id);
      sqlite.prepare(`UPDATE saved_routes SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
      const updated = sqlite.prepare(`SELECT * FROM saved_routes WHERE id = ?`).get(req.params.id);
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/routes/:id — delete route + stops + trips
  app.delete("/api/routes/:id", (req, res) => {
    try {
      sqlite.prepare(`DELETE FROM route_stops WHERE route_id = ?`).run(req.params.id);
      sqlite.prepare(`DELETE FROM route_trips WHERE route_id = ?`).run(req.params.id);
      sqlite.prepare(`DELETE FROM saved_routes WHERE id = ?`).run(req.params.id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Stops ────────────────────────────────────────────────────────────────────

  // GET /api/routes/:id/stops
  app.get("/api/routes/:id/stops", (req, res) => {
    try {
      const stops = sqlite.prepare(`SELECT * FROM route_stops WHERE route_id = ? ORDER BY order_index ASC`).all(req.params.id);
      res.json(stops);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/routes/:id/stops — add stop
  app.post("/api/routes/:id/stops", (req, res) => {
    try {
      const { label, address, lat, lng, stop_type = "visit", priority = 2,
              order_index = 0, notes, job_id, contact_id } = req.body;
      if (!label || !address) return res.status(400).json({ error: "label and address required" });
      const result = sqlite.prepare(`
        INSERT INTO route_stops (route_id, job_id, contact_id, label, address, lat, lng,
          stop_type, priority, order_index, notes, completed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(req.params.id, job_id ?? null, contact_id ?? null, label, address,
             lat ?? null, lng ?? null, stop_type, priority, order_index, notes ?? null);
      const created = sqlite.prepare(`SELECT * FROM route_stops WHERE id = ?`).get(result.lastInsertRowid);
      res.status(201).json(created);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/route-stops/:id — update stop (reorder, complete, edit)
  app.patch("/api/route-stops/:id", (req, res) => {
    try {
      const fields = ["label","address","lat","lng","stop_type","priority","order_index",
                      "notes","completed","completed_at","job_id","contact_id"];
      const sets: string[] = [];
      const vals: any[] = [];
      for (const f of fields) {
        if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
      }
      // auto-set completed_at when marking complete
      if (req.body.completed === true || req.body.completed === 1) {
        sets.push("completed_at = ?"); vals.push(now());
      }
      if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
      vals.push(req.params.id);
      sqlite.prepare(`UPDATE route_stops SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
      const updated = sqlite.prepare(`SELECT * FROM route_stops WHERE id = ?`).get(req.params.id);
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/routes/:id/stops/reorder — bulk reorder
  app.patch("/api/routes/:id/stops/reorder", (req, res) => {
    try {
      const { order } = req.body; // [{id, order_index}]
      if (!Array.isArray(order)) return res.status(400).json({ error: "order array required" });
      const stmt = sqlite.prepare(`UPDATE route_stops SET order_index = ? WHERE id = ? AND route_id = ?`);
      for (const item of order) stmt.run(item.order_index, item.id, req.params.id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/route-stops/:id
  app.delete("/api/route-stops/:id", (req, res) => {
    try {
      sqlite.prepare(`DELETE FROM route_stops WHERE id = ?`).run(req.params.id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Trips ────────────────────────────────────────────────────────────────────

  // GET /api/routes/:id/trips
  app.get("/api/routes/:id/trips", (req, res) => {
    try {
      const trips = sqlite.prepare(`SELECT * FROM route_trips WHERE route_id = ? ORDER BY scheduled_date DESC`).all(req.params.id);
      res.json(trips);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/trips — all trips (for calendar/schedule view)
  app.get("/api/trips", (req, res) => {
    try {
      const { date, status } = req.query;
      let sql = `SELECT t.*, r.name as route_name, r.type as route_type, r.color as route_color
                 FROM route_trips t JOIN saved_routes r ON r.id = t.route_id WHERE 1=1`;
      const args: any[] = [];
      if (date) { sql += ` AND t.scheduled_date = ?`; args.push(date); }
      if (status) { sql += ` AND t.status = ?`; args.push(status); }
      sql += ` ORDER BY t.scheduled_date DESC`;
      res.json(sqlite.prepare(sql).all(...args));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/routes/:id/trips — schedule a trip
  app.post("/api/routes/:id/trips", (req, res) => {
    try {
      const { assigned_to, scheduled_date, notes } = req.body;
      if (!scheduled_date) return res.status(400).json({ error: "scheduled_date required" });
      const ts = now();
      const result = sqlite.prepare(`
        INSERT INTO route_trips (route_id, assigned_to, scheduled_date, status, notes, created_at)
        VALUES (?, ?, ?, 'scheduled', ?, ?)
      `).run(req.params.id, assigned_to ?? null, scheduled_date, notes ?? null, ts);
      const created = sqlite.prepare(`SELECT * FROM route_trips WHERE id = ?`).get(result.lastInsertRowid);
      res.status(201).json(created);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/trips/:id — update trip status / results
  app.patch("/api/trips/:id", (req, res) => {
    try {
      const fields = ["assigned_to","scheduled_date","status","started_at","completed_at",
                      "actual_miles","stop_results","notes"];
      const sets: string[] = [];
      const vals: any[] = [];
      for (const f of fields) {
        if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
      }
      if (req.body.status === "complete" && !req.body.completed_at) {
        sets.push("completed_at = ?"); vals.push(now());
      }
      if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
      vals.push(req.params.id);
      sqlite.prepare(`UPDATE route_trips SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
      const updated = sqlite.prepare(`SELECT * FROM route_trips WHERE id = ?`).get(req.params.id);
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/trips/:id
  app.delete("/api/trips/:id", (req, res) => {
    try {
      sqlite.prepare(`DELETE FROM route_trips WHERE id = ?`).run(req.params.id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });


  // ── Route stop suggestions by route type ──────────────────────────────
  //
  // Route Planner is a marketing tool. Each route type maps to a different
  // segment of the referral-partner pipeline:
  //
  //   follow_up  -> active partners we've earned at least one job from.
  //                 Route = periodic "thanks, keep 'em coming" visits.
  //   hot_leads  -> partners with zero referred jobs BUT recent touch
  //                 (open follow-up sequence in the last 60 days).
  //                 Route = new prospects showing signal, worth the drive.
  //   cold_leads -> partners with zero referred jobs AND no recent touch.
  //                 Route = cold-canvassing plan.
  //
  // Each endpoint returns route-stop candidates:
  //   { contact_id, label, address, phone, company, sub_label }
  // Frontend renders as a checkbox list and POSTs selections to
  // /api/routes/:id/stops.

  const referredJobCount = (contactId: number) =>
    (sqlite.prepare(
      "SELECT COUNT(*) AS c FROM jobs WHERE referral_partner_id = ?"
    ).get(contactId) as any)?.c ?? 0;

  const recentTouchCount = (contactId: number, days = 60) =>
    (sqlite.prepare(
      `SELECT COUNT(*) AS c FROM follow_up_sequences
       WHERE contact_id = ? AND scheduled_at >= date('now', ?)`
    ).get(contactId, `-${days} days`) as any)?.c ?? 0;

  const partnerAddresses = () =>
    sqlite.prepare(
      `SELECT id, name, address, phone, company FROM contacts
       WHERE type = 'referral' AND (address IS NOT NULL AND TRIM(address) != '')`
    ).all() as any[];

  const partnerLabel = (p: any) => (p.company ? `${p.name} - ${p.company}` : p.name);

  app.get("/api/routes/suggestions/follow-up", (_req, res) => {
    try {
      const rows = partnerAddresses()
        .map((p) => ({ ...p, jobs_referred: referredJobCount(p.id) }))
        .filter((p) => p.jobs_referred > 0)
        .sort((a, b) => b.jobs_referred - a.jobs_referred)
        .map((p) => ({
          contact_id: p.id,
          label: partnerLabel(p),
          address: p.address,
          phone: p.phone,
          company: p.company,
          sub_label: `${p.jobs_referred} referred job${p.jobs_referred === 1 ? "" : "s"}`,
        }));
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/routes/suggestions/hot-leads", (_req, res) => {
    try {
      const rows = partnerAddresses()
        .map((p) => ({
          ...p,
          jobs_referred: referredJobCount(p.id),
          recent_touches: recentTouchCount(p.id, 60),
        }))
        .filter((p) => p.jobs_referred === 0 && p.recent_touches > 0)
        .sort((a, b) => b.recent_touches - a.recent_touches)
        .map((p) => ({
          contact_id: p.id,
          label: partnerLabel(p),
          address: p.address,
          phone: p.phone,
          company: p.company,
          sub_label: `${p.recent_touches} recent touch${p.recent_touches === 1 ? "" : "es"} - 0 jobs yet`,
        }));
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/routes/suggestions/cold-leads", (_req, res) => {
    try {
      const rows = partnerAddresses()
        .map((p) => ({
          ...p,
          jobs_referred: referredJobCount(p.id),
          recent_touches: recentTouchCount(p.id, 60),
        }))
        .filter((p) => p.jobs_referred === 0 && p.recent_touches === 0)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({
          contact_id: p.id,
          label: partnerLabel(p),
          address: p.address,
          phone: p.phone,
          company: p.company,
          sub_label: "No jobs - no recent touch - cold canvass",
        }));
      res.json(rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Priority Follow-Up routes (quick pull from follow-ups) ───────────────────
  app.get("/api/routes/priority-followups/suggestions", (_req, res) => {
    try {
      // Pull open follow-ups with job addresses — perfect for a priority follow-up route
      const followups = sqlite.prepare(`
        SELECT f.*, j.address, j.job_number, j.loss_type, j.status as job_status,
               c.name as contact_name, c.phone as contact_phone
        FROM follow_up_sequences f
        LEFT JOIN jobs j ON j.id = f.job_id
        LEFT JOIN contacts c ON c.id = f.contact_id
        WHERE f.status = 'pending'
        ORDER BY f.scheduled_at ASC
        LIMIT 20
      `).all();
      res.json(followups);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Summary stats ────────────────────────────────────────────────────────────
  app.get("/api/routes/stats/summary", (_req, res) => {
    try {
      const totalRoutes = (sqlite.prepare(`SELECT COUNT(*) as c FROM saved_routes WHERE is_active = 1`).get() as any).c;
      const totalTrips = (sqlite.prepare(`SELECT COUNT(*) as c FROM route_trips`).get() as any).c;
      const tripsThisMonth = (sqlite.prepare(`SELECT COUNT(*) as c FROM route_trips WHERE scheduled_date >= date('now','start of month')`).get() as any).c;
      const completedTrips = (sqlite.prepare(`SELECT COUNT(*) as c FROM route_trips WHERE status = 'complete'`).get() as any).c;
      const pendingTrips = (sqlite.prepare(`SELECT COUNT(*) as c FROM route_trips WHERE status = 'scheduled'`).get() as any).c;
      const byType = sqlite.prepare(`SELECT type, COUNT(*) as cnt FROM saved_routes WHERE is_active = 1 GROUP BY type`).all();
      res.json({ totalRoutes, totalTrips, tripsThisMonth, completedTrips, pendingTrips, byType });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
