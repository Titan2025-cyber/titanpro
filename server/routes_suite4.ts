// Suite 4 routes — injected into registerRoutes() by routes.ts

import { Express, RequestHandler } from "express";
import Database from "better-sqlite3";

type Suite4Auth = { requireRole: (...roles: string[]) => RequestHandler };
const suite4Passthrough: RequestHandler = (_req, _res, next) => next();

export function registerSuite4Routes(app: Express, sqlite: InstanceType<typeof Database>, auth?: Suite4Auth) {
  // Manager-level gate for carrier-AR and subrogation back-office mutations.
  const requireManage: RequestHandler = auth ? auth.requireRole("owner", "admin", "office", "general_manager") : suite4Passthrough;

  // ────────────────────────────────────────────────────────────────────────────
  // 1. CARRIER AR INTELLIGENCE
  // ────────────────────────────────────────────────────────────────────────────
  sqlite.exec(`CREATE TABLE IF NOT EXISTS carrier_ar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    invoice_id INTEGER,
    carrier TEXT NOT NULL,
    event_type TEXT NOT NULL,
    amount REAL,
    days_outstanding INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  app.get("/api/carrier-ar", (_req, res) => {
    const events = sqlite.prepare("SELECT * FROM carrier_ar_events ORDER BY created_at DESC").all();
    res.json(events);
  });

  app.post("/api/carrier-ar", requireManage, (req, res) => {
    const { jobId, invoiceId, carrier, eventType, amount, daysOutstanding, notes } = req.body;
    if (!jobId || !carrier || !eventType) return res.status(400).json({ error: "jobId, carrier, eventType required" });
    const now = new Date().toISOString();
    const row = sqlite.prepare(
      `INSERT INTO carrier_ar_events (job_id, invoice_id, carrier, event_type, amount, days_outstanding, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).get(jobId, invoiceId || null, carrier, eventType, amount || null, daysOutstanding || null, notes || null, now);
    res.json(row);
  });

  // AR Aging report: per carrier, buckets 0-30, 31-60, 61-90, 90+
  app.get("/api/reports/carrier-ar-aging", (_req, res) => {
    const invoices = sqlite.prepare("SELECT * FROM invoices WHERE status != 'paid'").all() as any[];
    const jobs = sqlite.prepare("SELECT id, insurance_carrier, job_number FROM jobs").all() as any[];
    const jobMap: Record<number, any> = {};
    jobs.forEach(j => { jobMap[j.id] = j; });

    const now = Date.now();
    const carriers: Record<string, { carrier: string; bucket0: number; bucket30: number; bucket60: number; bucket90: number; total: number; avgDays: number; invoices: number }> = {};

    invoices.forEach((inv: any) => {
      const job = jobMap[inv.job_id];
      const carrier = job?.insurance_carrier || "Direct / Unknown";
      const created = inv.created_at ? new Date(inv.created_at).getTime() : now;
      const daysOut = Math.floor((now - created) / (1000 * 60 * 60 * 24));
      const amount = inv.total || 0;

      if (!carriers[carrier]) carriers[carrier] = { carrier, bucket0: 0, bucket30: 0, bucket60: 0, bucket90: 0, total: 0, avgDays: 0, invoices: 0 };
      carriers[carrier].total += amount;
      carriers[carrier].invoices += 1;
      carriers[carrier].avgDays = ((carriers[carrier].avgDays * (carriers[carrier].invoices - 1)) + daysOut) / carriers[carrier].invoices;

      if (daysOut <= 30) carriers[carrier].bucket0 += amount;
      else if (daysOut <= 60) carriers[carrier].bucket30 += amount;
      else if (daysOut <= 90) carriers[carrier].bucket60 += amount;
      else carriers[carrier].bucket90 += amount;
    });

    // Also pull historical payment speed per carrier
    const payments = sqlite.prepare("SELECT p.*, j.insurance_carrier FROM payments p LEFT JOIN jobs j ON p.job_id = j.id WHERE p.type = 'received'").all() as any[];
    const carrierSpeed: Record<string, number[]> = {};
    payments.forEach((p: any) => {
      const carrier = p.insurance_carrier || "Direct / Unknown";
      if (!carrierSpeed[carrier]) carrierSpeed[carrier] = [];
      // days from job creation to payment (approx)
      if (p.paid_at) carrierSpeed[carrier].push(p.days_outstanding || 30);
    });

    const result = Object.values(carriers).map(c => ({
      ...c,
      avgDays: Math.round(c.avgDays),
      historicalAvgDaysToPay: carrierSpeed[c.carrier]
        ? Math.round(carrierSpeed[c.carrier].reduce((a, b) => a + b, 0) / carrierSpeed[c.carrier].length)
        : null,
    }));
    res.json(result);
  });

  // Carrier scorecard (payment speed, dispute rate)
  app.get("/api/reports/carrier-scorecard-detail", (_req, res) => {
    const jobs = sqlite.prepare("SELECT * FROM jobs").all() as any[];
    const invoices = sqlite.prepare("SELECT * FROM invoices").all() as any[];
    const supplements = sqlite.prepare("SELECT * FROM supplements").all() as any[];

    const carrierMap: Record<string, { carrier: string; jobCount: number; totalInvoiced: number; totalPaid: number; disputeCount: number; supplementCount: number; supplementApproved: number; daysToPayList: number[] }> = {};

    jobs.forEach((j: any) => {
      const c = j.insurance_carrier || "Direct / Unknown";
      if (!carrierMap[c]) carrierMap[c] = { carrier: c, jobCount: 0, totalInvoiced: 0, totalPaid: 0, disputeCount: 0, supplementCount: 0, supplementApproved: 0, daysToPayList: [] };
      carrierMap[c].jobCount += 1;
    });

    invoices.forEach((inv: any) => {
      const job = jobs.find((j: any) => j.id === inv.job_id);
      const c = job?.insurance_carrier || "Direct / Unknown";
      if (!carrierMap[c]) return;
      carrierMap[c].totalInvoiced += inv.total || 0;
      if (inv.status === "paid") {
        carrierMap[c].totalPaid += inv.total || 0;
        if (inv.created_at && inv.paid_at) {
          const days = Math.floor((new Date(inv.paid_at).getTime() - new Date(inv.created_at).getTime()) / (1000 * 60 * 60 * 24));
          carrierMap[c].daysToPayList.push(days);
        }
      }
    });

    supplements.forEach((s: any) => {
      const job = jobs.find((j: any) => j.id === s.job_id);
      const c = job?.insurance_carrier || "Direct / Unknown";
      if (!carrierMap[c]) return;
      carrierMap[c].supplementCount += 1;
      if (s.status === "denied" || s.status === "disputed") carrierMap[c].disputeCount += 1;
      if (s.status === "approved" || s.status === "partial") carrierMap[c].supplementApproved += 1;
    });

    const result = Object.values(carrierMap).map(c => ({
      carrier: c.carrier,
      jobCount: c.jobCount,
      totalInvoiced: c.totalInvoiced,
      totalPaid: c.totalPaid,
      collectionRate: c.totalInvoiced > 0 ? Math.round((c.totalPaid / c.totalInvoiced) * 100) : 0,
      avgDaysToPay: c.daysToPayList.length > 0 ? Math.round(c.daysToPayList.reduce((a, b) => a + b, 0) / c.daysToPayList.length) : null,
      disputeRate: c.supplementCount > 0 ? Math.round((c.disputeCount / c.supplementCount) * 100) : 0,
      supplementApprovalRate: c.supplementCount > 0 ? Math.round((c.supplementApproved / c.supplementCount) * 100) : 0,
    }));
    res.json(result);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. TPA PROGRAM SCORECARD
  // ────────────────────────────────────────────────────────────────────────────
  sqlite.exec(`CREATE TABLE IF NOT EXISTS tpa_programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    carrier TEXT,
    threshold_response_hrs INTEGER DEFAULT 2,
    threshold_cycle_days INTEGER DEFAULT 30,
    threshold_csat_min REAL DEFAULT 4.0,
    threshold_doc_pct INTEGER DEFAULT 95,
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS tpa_job_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tpa_program_id INTEGER NOT NULL,
    job_id INTEGER NOT NULL,
    response_hrs REAL,
    cycle_days INTEGER,
    csat_score REAL,
    doc_complete INTEGER DEFAULT 0,
    disputed INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  app.get("/api/tpa-programs", (_req, res) => {
    const programs = sqlite.prepare("SELECT * FROM tpa_programs ORDER BY name ASC").all();
    res.json(programs);
  });
  app.post("/api/tpa-programs", (req, res) => {
    const { name, carrier, thresholdResponseHrs, thresholdCycleDays, thresholdCsatMin, thresholdDocPct, notes } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });
    const now = new Date().toISOString();
    const row = sqlite.prepare(
      `INSERT INTO tpa_programs (name, carrier, threshold_response_hrs, threshold_cycle_days, threshold_csat_min, threshold_doc_pct, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).get(name, carrier || null, thresholdResponseHrs || 2, thresholdCycleDays || 30, thresholdCsatMin || 4.0, thresholdDocPct || 95, notes || null, now);
    res.json(row);
  });
  app.delete("/api/tpa-programs/:id", (req, res) => {
    sqlite.prepare("DELETE FROM tpa_programs WHERE id = ?").run(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/tpa-programs/:id/metrics", (req, res) => {
    const metrics = sqlite.prepare("SELECT * FROM tpa_job_metrics WHERE tpa_program_id = ? ORDER BY created_at DESC").all(Number(req.params.id));
    res.json(metrics);
  });
  app.post("/api/tpa-programs/:id/metrics", (req, res) => {
    const { jobId, responseHrs, cycleDays, csatScore, docComplete, disputed, notes } = req.body;
    if (!jobId) return res.status(400).json({ error: "jobId required" });
    const now = new Date().toISOString();
    const row = sqlite.prepare(
      `INSERT INTO tpa_job_metrics (tpa_program_id, job_id, response_hrs, cycle_days, csat_score, doc_complete, disputed, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).get(Number(req.params.id), jobId, responseHrs || null, cycleDays || null, csatScore || null, docComplete ? 1 : 0, disputed ? 1 : 0, notes || null, now);
    res.json(row);
  });

  app.get("/api/reports/tpa-scorecard", (_req, res) => {
    const programs = sqlite.prepare("SELECT * FROM tpa_programs WHERE status = 'active'").all() as any[];
    const result = programs.map((prog: any) => {
      const metrics = sqlite.prepare("SELECT * FROM tpa_job_metrics WHERE tpa_program_id = ?").all(prog.id) as any[];
      const n = metrics.length;
      if (n === 0) return { ...prog, metrics: [], score: null, status: "no_data", summary: "No job metrics recorded yet" };

      const avgResponseHrs = metrics.filter(m => m.response_hrs != null).reduce((s: number, m: any) => s + m.response_hrs, 0) / (metrics.filter(m => m.response_hrs != null).length || 1);
      const avgCycleDays = metrics.filter(m => m.cycle_days != null).reduce((s: number, m: any) => s + m.cycle_days, 0) / (metrics.filter(m => m.cycle_days != null).length || 1);
      const avgCsat = metrics.filter(m => m.csat_score != null).reduce((s: number, m: any) => s + m.csat_score, 0) / (metrics.filter(m => m.csat_score != null).length || 1);
      const docPct = Math.round((metrics.filter(m => m.doc_complete).length / n) * 100);
      const disputeRate = Math.round((metrics.filter(m => m.disputed).length / n) * 100);

      const responseOk = avgResponseHrs <= prog.threshold_response_hrs;
      const cycleOk = avgCycleDays <= prog.threshold_cycle_days;
      const csatOk = avgCsat >= prog.threshold_csat_min;
      const docOk = docPct >= prog.threshold_doc_pct;

      const passCount = [responseOk, cycleOk, csatOk, docOk].filter(Boolean).length;
      const score = Math.round((passCount / 4) * 100);
      const trafficLight = score >= 75 ? "green" : score >= 50 ? "yellow" : "red";

      return {
        id: prog.id, name: prog.name, carrier: prog.carrier, score, trafficLight,
        metrics: { avgResponseHrs: Math.round(avgResponseHrs * 10) / 10, avgCycleDays: Math.round(avgCycleDays), avgCsat: Math.round(avgCsat * 10) / 10, docPct, disputeRate },
        thresholds: { responseHrs: prog.threshold_response_hrs, cycleDays: prog.threshold_cycle_days, csatMin: prog.threshold_csat_min, docPct: prog.threshold_doc_pct },
        checks: { responseOk, cycleOk, csatOk, docOk },
        jobCount: n,
      };
    });
    res.json(result);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. UNIFIED COMMUNICATIONS TIMELINE
  // ────────────────────────────────────────────────────────────────────────────
  sqlite.exec(`CREATE TABLE IF NOT EXISTS comm_timeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    contact_id INTEGER,
    channel TEXT NOT NULL,
    direction TEXT DEFAULT 'inbound',
    "from" TEXT,
    "to" TEXT,
    subject TEXT,
    body TEXT NOT NULL,
    ai_tag TEXT,
    ai_summary TEXT,
    job_tag_confidence REAL DEFAULT 1.0,
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  app.get("/api/comm-timeline", (req, res) => {
    const { jobId, contactId } = req.query;
    let sql = "SELECT * FROM comm_timeline WHERE 1=1";
    const params: any[] = [];
    if (jobId) { sql += " AND job_id = ?"; params.push(Number(jobId)); }
    if (contactId) { sql += " AND contact_id = ?"; params.push(Number(contactId)); }
    sql += " ORDER BY created_at DESC LIMIT 200";
    res.json(sqlite.prepare(sql).all(...params));
  });

  app.post("/api/comm-timeline", (req, res) => {
    const { jobId, contactId, channel, direction, from, to, subject, body, aiTag, aiSummary } = req.body;
    if (!channel || !body) return res.status(400).json({ error: "channel and body required" });

    // Auto-tag with simple keyword matching
    const lowerBody = (body || "").toLowerCase();
    let tag = aiTag || "other";
    if (!aiTag) {
      if (lowerBody.includes("supplement") || lowerBody.includes("line item") || lowerBody.includes("scope")) tag = "supplement";
      else if (lowerBody.includes("payment") || lowerBody.includes("invoice") || lowerBody.includes("check")) tag = "payment";
      else if (lowerBody.includes("schedule") || lowerBody.includes("appointment") || lowerBody.includes("meeting")) tag = "scheduling";
      else if (lowerBody.includes("status") || lowerBody.includes("update") || lowerBody.includes("complete")) tag = "status_update";
      else if (lowerBody.includes("adjuster") || lowerBody.includes("carrier") || lowerBody.includes("claim")) tag = "insurance";
    }

    const now = new Date().toISOString();
    const summary = aiSummary || (body.length > 120 ? body.substring(0, 117) + "..." : body);
    const row = sqlite.prepare(
      `INSERT INTO comm_timeline (job_id, contact_id, channel, direction, "from", "to", subject, body, ai_tag, ai_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).get(jobId || null, contactId || null, channel, direction || "inbound", from || null, to || null, subject || null, body, tag, summary, now);
    res.json(row);
  });

  app.delete("/api/comm-timeline/:id", (req, res) => {
    sqlite.prepare("DELETE FROM comm_timeline WHERE id = ?").run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. IoT DRYING DASHBOARD
  // ────────────────────────────────────────────────────────────────────────────
  sqlite.exec(`CREATE TABLE IF NOT EXISTS iot_sensors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    sensor_id TEXT NOT NULL,
    brand TEXT DEFAULT 'manual',
    location TEXT NOT NULL,
    material TEXT DEFAULT 'drywall',
    target_wme REAL DEFAULT 16,
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT ''
  )`);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS iot_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sensor_id INTEGER NOT NULL,
    job_id INTEGER NOT NULL,
    wme REAL NOT NULL,
    temp_f REAL,
    rh_pct REAL,
    is_alert INTEGER DEFAULT 0,
    reading_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  app.get("/api/iot-sensors", (req, res) => {
    const { jobId } = req.query;
    const sql = jobId ? "SELECT * FROM iot_sensors WHERE job_id = ?" : "SELECT * FROM iot_sensors ORDER BY created_at DESC";
    res.json(jobId ? sqlite.prepare(sql).all(Number(jobId)) : sqlite.prepare(sql).all());
  });
  app.post("/api/iot-sensors", (req, res) => {
    const { jobId, sensorId, brand, location, material, targetWme } = req.body;
    if (!jobId || !sensorId || !location) return res.status(400).json({ error: "jobId, sensorId, location required" });
    const now = new Date().toISOString();
    const row = sqlite.prepare(
      `INSERT INTO iot_sensors (job_id, sensor_id, brand, location, material, target_wme, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).get(jobId, sensorId, brand || "manual", location, material || "drywall", targetWme || 16, now);
    res.json(row);
  });
  app.delete("/api/iot-sensors/:id", (req, res) => {
    sqlite.prepare("DELETE FROM iot_sensors WHERE id = ?").run(Number(req.params.id));
    res.json({ ok: true });
  });

  app.get("/api/iot-readings", (req, res) => {
    const { sensorId, jobId } = req.query;
    let sql = "SELECT * FROM iot_readings WHERE 1=1";
    const params: any[] = [];
    if (sensorId) { sql += " AND sensor_id = ?"; params.push(Number(sensorId)); }
    if (jobId) { sql += " AND job_id = ?"; params.push(Number(jobId)); }
    sql += " ORDER BY reading_at DESC LIMIT 500";
    res.json(sqlite.prepare(sql).all(...params));
  });
  app.post("/api/iot-readings", (req, res) => {
    const { sensorId, jobId, wme, tempF, rhPct, readingAt } = req.body;
    if (!sensorId || !jobId || wme == null) return res.status(400).json({ error: "sensorId, jobId, wme required" });
    const sensor = sqlite.prepare("SELECT target_wme FROM iot_sensors WHERE id = ?").get(Number(sensorId)) as any;
    const isAlert = sensor && wme > sensor.target_wme ? 1 : 0;
    const now = new Date().toISOString();
    const row = sqlite.prepare(
      `INSERT INTO iot_readings (sensor_id, job_id, wme, temp_f, rh_pct, is_alert, reading_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).get(sensorId, jobId, wme, tempF || null, rhPct || null, isAlert, readingAt || now, now);
    res.json(row);
  });

  // Predict dry-out completion based on drying curve
  app.get("/api/iot-sensors/:id/predict", (req, res) => {
    const sensor = sqlite.prepare("SELECT * FROM iot_sensors WHERE id = ?").get(Number(req.params.id)) as any;
    if (!sensor) return res.status(404).json({ error: "Sensor not found" });
    const readings = sqlite.prepare("SELECT * FROM iot_readings WHERE sensor_id = ? ORDER BY reading_at ASC").all(Number(req.params.id)) as any[];
    if (readings.length < 2) return res.json({ prediction: null, message: "Need at least 2 readings to predict" });

    const first = readings[0];
    const last = readings[readings.length - 1];
    const hoursElapsed = (new Date(last.reading_at).getTime() - new Date(first.reading_at).getTime()) / (1000 * 60 * 60);
    const dryingRate = hoursElapsed > 0 ? (first.wme - last.wme) / hoursElapsed : 0;

    if (dryingRate <= 0 || last.wme <= sensor.target_wme) {
      return res.json({ prediction: "already_dry", currentWme: last.wme, targetWme: sensor.target_wme, message: last.wme <= sensor.target_wme ? "Target WME achieved" : "Drying not progressing — check equipment" });
    }

    const hoursRemaining = (last.wme - sensor.target_wme) / dryingRate;
    const predictedDate = new Date(Date.now() + hoursRemaining * 60 * 60 * 1000);
    res.json({
      currentWme: Math.round(last.wme * 10) / 10,
      targetWme: sensor.target_wme,
      dryingRatePerHour: Math.round(dryingRate * 100) / 100,
      hoursRemaining: Math.round(hoursRemaining),
      predictedDryDate: predictedDate.toISOString(),
      predictedDryDateFormatted: predictedDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
      confidence: readings.length >= 5 ? "high" : "moderate",
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. IICRC COMPLIANCE ENGINE
  // ────────────────────────────────────────────────────────────────────────────
  sqlite.exec(`CREATE TABLE IF NOT EXISTS compliance_checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    standard TEXT NOT NULL,
    loss_category TEXT NOT NULL,
    completed_items TEXT NOT NULL DEFAULT '[]',
    flagged_items TEXT NOT NULL DEFAULT '[]',
    overall_status TEXT DEFAULT 'incomplete',
    tech_name TEXT,
    pre_built_vintage INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
  )`);

  const IICRC_CHECKLISTS: Record<string, { id: string; item: string; required: boolean; standard: string }[]> = {
    S500_cat1_water: [
      { id: "s500_c1_01", item: "Identify and stop water source", required: true, standard: "S500 §4.1" },
      { id: "s500_c1_02", item: "Document initial moisture readings at all affected materials", required: true, standard: "S500 §5.2" },
      { id: "s500_c1_03", item: "Classify water category (Category 1 confirmed)", required: true, standard: "S500 §2.1" },
      { id: "s500_c1_04", item: "Classify water damage class (1–4)", required: true, standard: "S500 §2.2" },
      { id: "s500_c1_05", item: "Document affected areas with sketches/photos", required: true, standard: "S500 §5.3" },
      { id: "s500_c1_06", item: "Establish drying goals (target WME per material)", required: true, standard: "S500 §7.1" },
      { id: "s500_c1_07", item: "Place dehumidifiers per IICRC S500 equipment formula", required: true, standard: "S500 §8.3" },
      { id: "s500_c1_08", item: "Record daily psychrometric readings (Temp, RH, GPP)", required: true, standard: "S500 §7.2" },
      { id: "s500_c1_09", item: "Daily monitoring logs completed for all affected materials", required: true, standard: "S500 §7.3" },
      { id: "s500_c1_10", item: "Structural drying complete — final readings at target", required: true, standard: "S500 §9.1" },
      { id: "s500_c1_11", item: "Equipment removal documented", required: true, standard: "S500 §9.2" },
      { id: "s500_c1_12", item: "Final inspection report completed", required: true, standard: "S500 §9.3" },
    ],
    S500_cat2_water: [
      { id: "s500_c2_01", item: "Source identified — Category 2 (gray water) confirmed", required: true, standard: "S500 §2.1" },
      { id: "s500_c2_02", item: "PPE deployed: gloves, eye protection, disposable suits", required: true, standard: "S500 §3.1" },
      { id: "s500_c2_03", item: "Antimicrobial application documented (required for Cat 2)", required: true, standard: "S500 §6.4" },
      { id: "s500_c2_04", item: "Contaminated materials removed and documented", required: true, standard: "S500 §6.2" },
      { id: "s500_c2_05", item: "Initial moisture readings documented at all points", required: true, standard: "S500 §5.2" },
      { id: "s500_c2_06", item: "Daily drying logs with psychrometric data", required: true, standard: "S500 §7.2" },
      { id: "s500_c2_07", item: "Air scrubbers deployed with HEPA filtration", required: false, standard: "S500 §8.4" },
      { id: "s500_c2_08", item: "Post-remediation verification readings at goal WME", required: true, standard: "S500 §9.1" },
      { id: "s500_c2_09", item: "Waste disposal documented per local regulations", required: true, standard: "S500 §6.3" },
    ],
    S520_mold: [
      { id: "s520_01", item: "Mold visible confirmed — area/extent documented", required: true, standard: "S520 §4.1" },
      { id: "s520_02", item: "Moisture source identified and corrected", required: true, standard: "S520 §4.2" },
      { id: "s520_03", item: "Containment established (critical barriers)", required: true, standard: "S520 §5.1" },
      { id: "s520_04", item: "Negative air pressure maintained during remediation", required: true, standard: "S520 §5.2" },
      { id: "s520_05", item: "Full PPE: N95+, gloves, goggles, Tyvek suits", required: true, standard: "S520 §3.2" },
      { id: "s520_06", item: "Mold classification (Class 1–4) documented", required: true, standard: "S520 §2.3" },
      { id: "s520_07", item: "Contaminated materials removed, bagged, and disposed", required: true, standard: "S520 §6.1" },
      { id: "s520_08", item: "HEPA vacuuming of all surfaces in work area", required: true, standard: "S520 §6.3" },
      { id: "s520_09", item: "Antimicrobial agent applied per manufacturer specs", required: true, standard: "S520 §6.4" },
      { id: "s520_10", item: "Post-remediation verification (clearance testing)", required: true, standard: "S520 §7.1" },
      { id: "s520_11", item: "Clearance criteria met — third-party testing if required", required: false, standard: "S520 §7.2" },
      { id: "s520_12", item: "All waste manifests documented", required: true, standard: "S520 §6.5" },
    ],
    S700_fire_smoke: [
      { id: "s700_01", item: "Structural integrity assessed — safe to enter", required: true, standard: "S700 §4.1" },
      { id: "s700_02", item: "Fire damage extent documented — all rooms photographed", required: true, standard: "S700 §4.2" },
      { id: "s700_03", item: "Smoke/soot residue type identified (wet/dry/protein)", required: true, standard: "S700 §2.3" },
      { id: "s700_04", item: "Contents inventory and pack-out list completed", required: true, standard: "S700 §5.1" },
      { id: "s700_05", item: "Odor sources identified (HVAC, structural voids, attic)", required: true, standard: "S700 §6.1" },
      { id: "s700_06", item: "Dry cleaning/HEPA vacuuming of surfaces before wet cleaning", required: true, standard: "S700 §6.2" },
      { id: "s700_07", item: "Chemical sponge or appropriate product per soot type", required: true, standard: "S700 §6.3" },
      { id: "s700_08", item: "Thermal fogging or hydroxyl treatment documented", required: false, standard: "S700 §7.1" },
      { id: "s700_09", item: "HVAC system cleaned and filters replaced", required: true, standard: "S700 §7.2" },
      { id: "s700_10", item: "Odor elimination verified — post-treatment documentation", required: true, standard: "S700 §7.3" },
    ],
  };

  app.get("/api/iicrc-checklist-items", (req, res) => {
    const { standard, lossCategory } = req.query;
    const key = `${standard}_${lossCategory}`;
    const items = IICRC_CHECKLISTS[key] || IICRC_CHECKLISTS[`S500_cat1_water`];
    res.json({ key, items });
  });

  app.get("/api/compliance-checklists", (req, res) => {
    const { jobId } = req.query;
    const sql = jobId ? "SELECT * FROM compliance_checklists WHERE job_id = ? ORDER BY created_at DESC" : "SELECT * FROM compliance_checklists ORDER BY created_at DESC";
    res.json(jobId ? sqlite.prepare(sql).all(Number(jobId)) : sqlite.prepare(sql).all());
  });

  app.post("/api/compliance-checklists", (req, res) => {
    const { jobId, standard, lossCategory, techName, preBuiltVintage } = req.body;
    if (!jobId || !standard || !lossCategory) return res.status(400).json({ error: "jobId, standard, lossCategory required" });
    const now = new Date().toISOString();
    const row = sqlite.prepare(
      `INSERT INTO compliance_checklists (job_id, standard, loss_category, tech_name, pre_built_vintage, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).get(jobId, standard, lossCategory, techName || null, preBuiltVintage ? 1 : 0, now, now);
    res.json(row);
  });

  app.patch("/api/compliance-checklists/:id", (req, res) => {
    const { completedItems, flaggedItems, overallStatus, notes } = req.body;
    const now = new Date().toISOString();
    sqlite.prepare(
      `UPDATE compliance_checklists SET completed_items = ?, flagged_items = ?, overall_status = ?, notes = ?, updated_at = ? WHERE id = ?`
    ).run(JSON.stringify(completedItems || []), JSON.stringify(flaggedItems || []), overallStatus || "in_progress", notes || null, now, Number(req.params.id));
    res.json(sqlite.prepare("SELECT * FROM compliance_checklists WHERE id = ?").get(Number(req.params.id)));
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 6. EMERGENCY INTAKE
  // ────────────────────────────────────────────────────────────────────────────
  sqlite.exec(`CREATE TABLE IF NOT EXISTS emergency_intakes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caller_name TEXT,
    caller_phone TEXT NOT NULL,
    address TEXT,
    loss_type TEXT,
    water_category TEXT,
    active_flow INTEGER DEFAULT 0,
    room_count INTEGER,
    electrical_exposure INTEGER DEFAULT 0,
    urgency_score INTEGER DEFAULT 5,
    dispatched_tech TEXT,
    dispatched_at TEXT,
    linked_job_id INTEGER,
    ai_notes TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  app.get("/api/emergency-intakes", (_req, res) => {
    res.json(sqlite.prepare("SELECT * FROM emergency_intakes ORDER BY created_at DESC").all());
  });
  app.post("/api/emergency-intakes", (req, res) => {
    const { callerName, callerPhone, address, lossType, waterCategory, activeFlow, roomCount, electricalExposure } = req.body;
    if (!callerPhone) return res.status(400).json({ error: "callerPhone required" });

    // Calculate urgency score
    let urgency = 5;
    if (activeFlow) urgency += 2;
    if (electricalExposure) urgency += 3;
    if (waterCategory === "category3") urgency += 2;
    if (waterCategory === "category2") urgency += 1;
    if (lossType === "fire") urgency = Math.max(urgency, 9);
    urgency = Math.min(10, urgency);

    const aiNotes = [
      `${lossType || "Unknown"} loss${waterCategory ? ` — ${waterCategory}` : ""}`,
      activeFlow ? "⚠️ Active flow — immediate dispatch required" : null,
      electricalExposure ? "⚠️ Electrical exposure — safety hazard" : null,
      roomCount ? `${roomCount} rooms affected` : null,
      `Urgency: ${urgency}/10`,
    ].filter(Boolean).join(" | ");

    const now = new Date().toISOString();
    const row = sqlite.prepare(
      `INSERT INTO emergency_intakes (caller_name, caller_phone, address, loss_type, water_category, active_flow, room_count, electrical_exposure, urgency_score, ai_notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).get(callerName || null, callerPhone, address || null, lossType || null, waterCategory || null, activeFlow ? 1 : 0, roomCount || null, electricalExposure ? 1 : 0, urgency, aiNotes, now);
    res.json(row);
  });
  app.patch("/api/emergency-intakes/:id", (req, res) => {
    const { dispatchedTech, status, linkedJobId } = req.body;
    const now = new Date().toISOString();
    sqlite.prepare(
      `UPDATE emergency_intakes SET dispatched_tech = ?, status = ?, linked_job_id = ?, dispatched_at = ? WHERE id = ?`
    ).run(dispatchedTech || null, status || "dispatched", linkedJobId || null, now, Number(req.params.id));
    res.json(sqlite.prepare("SELECT * FROM emergency_intakes WHERE id = ?").get(Number(req.params.id)));
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 7. REFERRAL PROFITABILITY INTELLIGENCE
  // ────────────────────────────────────────────────────────────────────────────
  app.get("/api/reports/referral-profitability", (_req, res) => {
    const contacts = sqlite.prepare("SELECT * FROM contacts WHERE type = 'referral'").all() as any[];
    const jobs = sqlite.prepare("SELECT * FROM jobs").all() as any[];
    const invoices = sqlite.prepare("SELECT * FROM invoices").all() as any[];
    const payments = sqlite.prepare("SELECT p.*, j.contact_id as job_contact_id FROM payments p LEFT JOIN jobs j ON p.job_id = j.id").all() as any[];
    const supplements = sqlite.prepare("SELECT * FROM supplements").all() as any[];

    const result = contacts.map((contact: any) => {
      const referredJobs = jobs.filter((j: any) => j.lead_source === "referral" && j.lead_source_detail === contact.name);
      const jobIds = referredJobs.map((j: any) => j.id);
      const relatedInvoices = invoices.filter((inv: any) => jobIds.includes(inv.job_id));
      const totalInvoiced = relatedInvoices.reduce((s: number, inv: any) => s + (inv.total || 0), 0);
      const totalPaid = relatedInvoices.filter((inv: any) => inv.status === "paid").reduce((s: number, inv: any) => s + (inv.total || 0), 0);

      const relatedSupps = supplements.filter((s: any) => jobIds.includes(s.job_id));
      const suppCount = relatedSupps.length;
      const suppDisputed = relatedSupps.filter((s: any) => s.status === "denied" || s.status === "disputed").length;
      const suppApproved = relatedSupps.filter((s: any) => s.status === "approved" || s.status === "partial").length;

      // Days to collect
      const paidInvs = relatedInvoices.filter((inv: any) => inv.status === "paid" && inv.created_at && inv.paid_at);
      const avgDaysToPay = paidInvs.length > 0
        ? Math.round(paidInvs.reduce((s: number, inv: any) => s + Math.floor((new Date(inv.paid_at).getTime() - new Date(inv.created_at).getTime()) / (1000 * 60 * 60 * 24)), 0) / paidInvs.length)
        : null;

      // Quality score (0-100): collection rate + speed + supplement approval
      const collectionRate = totalInvoiced > 0 ? totalPaid / totalInvoiced : 0;
      const disputeRate = suppCount > 0 ? suppDisputed / suppCount : 0;
      const approvalRate = suppCount > 0 ? suppApproved / suppCount : 0.5;
      const speedScore = avgDaysToPay != null ? Math.max(0, 1 - (avgDaysToPay - 20) / 80) : 0.5;
      const qualityScore = Math.round(((collectionRate * 0.4) + (approvalRate * 0.3) + (speedScore * 0.3)) * 100);

      const recommendation = qualityScore >= 75
        ? "Top performer — invest in relationship maintenance"
        : qualityScore >= 50
        ? "Average — monitor for trends"
        : `Low quality score — consider scheduling a review meeting${avgDaysToPay && avgDaysToPay > 60 ? `: ${avgDaysToPay}-day avg collection is above target` : ""}`;

      return {
        id: contact.id, name: contact.name, company: contact.company, referralRate: contact.referralRate,
        jobCount: referredJobs.length, totalInvoiced, totalPaid, avgDaysToPay, qualityScore,
        disputeRate: Math.round(disputeRate * 100), supplementApprovalRate: Math.round(approvalRate * 100),
        collectionRate: Math.round(collectionRate * 100), recommendation,
      };
    });

    res.json(result.sort((a: any, b: any) => b.qualityScore - a.qualityScore));
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 8. EQUIPMENT LIFECYCLE + MAINTENANCE
  // ────────────────────────────────────────────────────────────────────────────
  sqlite.exec(`CREATE TABLE IF NOT EXISTS equipment_maintenance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id INTEGER NOT NULL,
    maintenance_type TEXT NOT NULL,
    performed_by TEXT,
    cost REAL DEFAULT 0,
    runtime_hours_at_service REAL,
    notes TEXT,
    next_service_due TEXT,
    performed_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  // Add lifecycle columns to equipment table if not present
  try {
    sqlite.exec("ALTER TABLE equipment ADD COLUMN purchase_cost REAL DEFAULT 0");
    sqlite.exec("ALTER TABLE equipment ADD COLUMN purchase_date TEXT");
    sqlite.exec("ALTER TABLE equipment ADD COLUMN runtime_hours REAL DEFAULT 0");
    sqlite.exec("ALTER TABLE equipment ADD COLUMN service_interval_hrs INTEGER DEFAULT 300");
    sqlite.exec("ALTER TABLE equipment ADD COLUMN last_service_at TEXT");
  } catch { /* columns already exist */ }

  app.get("/api/equipment-maintenance", (req, res) => {
    const { equipmentId } = req.query;
    const sql = equipmentId ? "SELECT * FROM equipment_maintenance_logs WHERE equipment_id = ? ORDER BY performed_at DESC" : "SELECT * FROM equipment_maintenance_logs ORDER BY performed_at DESC";
    res.json(equipmentId ? sqlite.prepare(sql).all(Number(equipmentId)) : sqlite.prepare(sql).all());
  });
  app.post("/api/equipment-maintenance", (req, res) => {
    const { equipmentId, maintenanceType, performedBy, cost, runtimeHoursAtService, notes, nextServiceDue } = req.body;
    if (!equipmentId || !maintenanceType) return res.status(400).json({ error: "equipmentId and maintenanceType required" });
    const now = new Date().toISOString();
    const row = sqlite.prepare(
      `INSERT INTO equipment_maintenance_logs (equipment_id, maintenance_type, performed_by, cost, runtime_hours_at_service, notes, next_service_due, performed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).get(equipmentId, maintenanceType, performedBy || null, cost || 0, runtimeHoursAtService || null, notes || null, nextServiceDue || null, now, now);
    // Update last_service_at on equipment
    sqlite.prepare("UPDATE equipment SET last_service_at = ? WHERE id = ?").run(now, equipmentId);
    res.json(row);
  });

  app.get("/api/reports/equipment-roi", (_req, res) => {
    const equip = sqlite.prepare("SELECT * FROM equipment").all() as any[];
    const deployments = sqlite.prepare("SELECT * FROM equipment_deployments").all() as any[];
    const maintenanceLogs = sqlite.prepare("SELECT * FROM equipment_maintenance_logs").all() as any[];

    const result = equip.map((e: any) => {
      const deps = deployments.filter((d: any) => d.equipment_id === e.id);
      const totalDaysDeployed = deps.reduce((s: number, d: any) => s + (d.days_out || 0), 0);
      const revenueGenerated = deps.reduce((s: number, d: any) => s + (d.billed_amount || 0), 0);
      const maintenanceCost = maintenanceLogs.filter((m: any) => m.equipment_id === e.id).reduce((s: number, m: any) => s + (m.cost || 0), 0);
      const totalCost = (e.purchase_cost || 0) + maintenanceCost;
      const roi = totalCost > 0 ? Math.round(((revenueGenerated - totalCost) / totalCost) * 100) : null;
      const utilizationRate = totalDaysDeployed > 0 ? Math.round((totalDaysDeployed / Math.max(1, Math.floor((Date.now() - new Date(e.created_at || Date.now()).getTime()) / (1000 * 60 * 60 * 24)))) * 100) : 0;

      // Service alert
      const serviceAlert = e.runtime_hours && e.service_interval_hrs
        ? e.runtime_hours >= e.service_interval_hrs ? "overdue" : e.runtime_hours >= e.service_interval_hrs * 0.85 ? "due_soon" : "ok"
        : null;

      return {
        id: e.id, name: e.name, category: e.category, status: e.status,
        purchaseCost: e.purchase_cost || 0, revenueGenerated, maintenanceCost, totalCost, roi,
        totalDaysDeployed, utilizationRate, runtimeHours: e.runtime_hours || 0,
        serviceIntervalHrs: e.service_interval_hrs || 300, serviceAlert,
        recommendation: utilizationRate < 20 && totalDaysDeployed > 30 ? "Low utilization — consider selling or redeploying" : null,
      };
    });
    res.json(result.sort((a: any, b: any) => (b.revenueGenerated || 0) - (a.revenueGenerated || 0)));
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 9. SUBROGATION CASES
  // ────────────────────────────────────────────────────────────────────────────
  sqlite.exec(`CREATE TABLE IF NOT EXISTS subrogation_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    potential_score TEXT DEFAULT 'low',
    cause_of_loss TEXT,
    responsible_party TEXT,
    liability_notes TEXT,
    status TEXT DEFAULT 'identified',
    package_built_at TEXT,
    submitted_at TEXT,
    recovery_amount REAL,
    recovery_date TEXT,
    carrier_contact TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  app.get("/api/subrogation", (_req, res) => {
    res.json(sqlite.prepare("SELECT sc.*, j.job_number, j.address, j.insurance_carrier FROM subrogation_cases sc LEFT JOIN jobs j ON sc.job_id = j.id ORDER BY sc.created_at DESC").all());
  });
  app.post("/api/subrogation", (req, res) => {
    const { jobId, potentialScore, causeOfLoss, responsibleParty, liabilityNotes, carrierContact, notes } = req.body;
    if (!jobId) return res.status(400).json({ error: "jobId required" });
    const now = new Date().toISOString();
    const row = sqlite.prepare(
      `INSERT INTO subrogation_cases (job_id, potential_score, cause_of_loss, responsible_party, liability_notes, carrier_contact, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).get(jobId, potentialScore || "low", causeOfLoss || null, responsibleParty || null, liabilityNotes || null, carrierContact || null, notes || null, now);
    res.json(row);
  });
  app.patch("/api/subrogation/:id", requireManage, (req, res) => {
    const { status, recoveryAmount, recoveryDate, notes, liabilityNotes, responsibleParty, potentialScore } = req.body;
    const now = new Date().toISOString();
    const updates: string[] = [];
    const params: any[] = [];
    if (status !== undefined) { updates.push("status = ?"); params.push(status); if (status === "package_built") { updates.push("package_built_at = ?"); params.push(now); } if (status === "submitted") { updates.push("submitted_at = ?"); params.push(now); } }
    if (recoveryAmount !== undefined) { updates.push("recovery_amount = ?"); params.push(recoveryAmount); }
    if (recoveryDate !== undefined) { updates.push("recovery_date = ?"); params.push(recoveryDate); }
    if (notes !== undefined) { updates.push("notes = ?"); params.push(notes); }
    if (liabilityNotes !== undefined) { updates.push("liability_notes = ?"); params.push(liabilityNotes); }
    if (responsibleParty !== undefined) { updates.push("responsible_party = ?"); params.push(responsibleParty); }
    if (potentialScore !== undefined) { updates.push("potential_score = ?"); params.push(potentialScore); }
    if (updates.length === 0) return res.status(400).json({ error: "No fields to update" });
    params.push(Number(req.params.id));
    sqlite.prepare(`UPDATE subrogation_cases SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    res.json(sqlite.prepare("SELECT * FROM subrogation_cases WHERE id = ?").get(Number(req.params.id)));
  });
  app.delete("/api/subrogation/:id", requireManage, (req, res) => {
    sqlite.prepare("DELETE FROM subrogation_cases WHERE id = ?").run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 10. STORM MARKETING CAMPAIGNS
  // ────────────────────────────────────────────────────────────────────────────
  sqlite.exec(`CREATE TABLE IF NOT EXISTS storm_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    trigger_date TEXT NOT NULL,
    affected_zip_codes TEXT NOT NULL DEFAULT '[]',
    severity TEXT DEFAULT 'moderate',
    status TEXT DEFAULT 'draft',
    google_ads_activated INTEGER DEFAULT 0,
    ads_budget_increase REAL,
    sms_contacts_count INTEGER DEFAULT 0,
    email_contacts_count INTEGER DEFAULT 0,
    gbp_updated INTEGER DEFAULT 0,
    leads_generated INTEGER DEFAULT 0,
    jobs_booked INTEGER DEFAULT 0,
    revenue_attributed REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  app.get("/api/storm-campaigns", (_req, res) => {
    res.json(sqlite.prepare("SELECT * FROM storm_campaigns ORDER BY created_at DESC").all());
  });
  app.post("/api/storm-campaigns", (req, res) => {
    const { eventType, triggerDate, affectedZips, severity, notes } = req.body;
    if (!eventType || !triggerDate) return res.status(400).json({ error: "eventType and triggerDate required" });
    const now = new Date().toISOString();
    const row = sqlite.prepare(
      `INSERT INTO storm_campaigns (event_type, trigger_date, affected_zip_codes, severity, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
    ).get(eventType, triggerDate, JSON.stringify(affectedZips || []), severity || "moderate", notes || null, now);
    res.json(row);
  });
  app.patch("/api/storm-campaigns/:id", (req, res) => {
    const { status, googleAdsActivated, adsBudgetIncrease, smsContactsCount, emailContactsCount, gbpUpdated, leadsGenerated, jobsBooked, revenueAttributed, notes } = req.body;
    sqlite.prepare(`UPDATE storm_campaigns SET status=COALESCE(?,status), google_ads_activated=COALESCE(?,google_ads_activated), ads_budget_increase=COALESCE(?,ads_budget_increase), sms_contacts_count=COALESCE(?,sms_contacts_count), email_contacts_count=COALESCE(?,email_contacts_count), gbp_updated=COALESCE(?,gbp_updated), leads_generated=COALESCE(?,leads_generated), jobs_booked=COALESCE(?,jobs_booked), revenue_attributed=COALESCE(?,revenue_attributed), notes=COALESCE(?,notes) WHERE id=?`)
      .run(status||null, googleAdsActivated!=null?googleAdsActivated:null, adsBudgetIncrease||null, smsContactsCount||null, emailContactsCount||null, gbpUpdated!=null?gbpUpdated:null, leadsGenerated||null, jobsBooked||null, revenueAttributed||null, notes||null, Number(req.params.id));
    res.json(sqlite.prepare("SELECT * FROM storm_campaigns WHERE id = ?").get(Number(req.params.id)));
  });
  app.delete("/api/storm-campaigns/:id", (req, res) => {
    sqlite.prepare("DELETE FROM storm_campaigns WHERE id = ?").run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 11. DRONE / LiDAR ASSESSMENTS
  // ────────────────────────────────────────────────────────────────────────────
  sqlite.exec(`CREATE TABLE IF NOT EXISTS drone_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    flight_date TEXT NOT NULL,
    pilot_name TEXT,
    equipment_used TEXT,
    damage_zones TEXT NOT NULL DEFAULT '[]',
    total_damaged_sqft REAL,
    structural_concerns TEXT,
    access_point_notes TEXT,
    ai_classification_notes TEXT,
    image_files TEXT NOT NULL DEFAULT '[]',
    model_file TEXT,
    status TEXT DEFAULT 'draft',
    xactimate_notes TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  )`);

  app.get("/api/drone-assessments", (req, res) => {
    const { jobId } = req.query;
    const sql = jobId ? "SELECT * FROM drone_assessments WHERE job_id = ? ORDER BY created_at DESC" : "SELECT * FROM drone_assessments ORDER BY created_at DESC";
    res.json(jobId ? sqlite.prepare(sql).all(Number(jobId)) : sqlite.prepare(sql).all());
  });
  app.post("/api/drone-assessments", (req, res) => {
    const { jobId, flightDate, pilotName, equipmentUsed, damageZones, totalDamagedSqft, structuralConcerns, accessPointNotes, aiClassificationNotes, xactimateNotes } = req.body;
    if (!jobId || !flightDate) return res.status(400).json({ error: "jobId and flightDate required" });
    const now = new Date().toISOString();
    const row = sqlite.prepare(
      `INSERT INTO drone_assessments (job_id, flight_date, pilot_name, equipment_used, damage_zones, total_damaged_sqft, structural_concerns, access_point_notes, ai_classification_notes, xactimate_notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).get(jobId, flightDate, pilotName||null, equipmentUsed||null, JSON.stringify(damageZones||[]), totalDamagedSqft||null, structuralConcerns||null, accessPointNotes||null, aiClassificationNotes||null, xactimateNotes||null, now);
    res.json(row);
  });
  app.patch("/api/drone-assessments/:id", (req, res) => {
    const { status, damageZones, totalDamagedSqft, structuralConcerns, accessPointNotes, aiClassificationNotes, xactimateNotes } = req.body;
    sqlite.prepare(`UPDATE drone_assessments SET status=COALESCE(?,status), damage_zones=COALESCE(?,damage_zones), total_damaged_sqft=COALESCE(?,total_damaged_sqft), structural_concerns=COALESCE(?,structural_concerns), access_point_notes=COALESCE(?,access_point_notes), ai_classification_notes=COALESCE(?,ai_classification_notes), xactimate_notes=COALESCE(?,xactimate_notes) WHERE id=?`)
      .run(status||null, damageZones?JSON.stringify(damageZones):null, totalDamagedSqft||null, structuralConcerns||null, accessPointNotes||null, aiClassificationNotes||null, xactimateNotes||null, Number(req.params.id));
    res.json(sqlite.prepare("SELECT * FROM drone_assessments WHERE id = ?").get(Number(req.params.id)));
  });
  app.delete("/api/drone-assessments/:id", (req, res) => {
    sqlite.prepare("DELETE FROM drone_assessments WHERE id = ?").run(Number(req.params.id));
    res.json({ ok: true });
  });
}
