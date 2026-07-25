import type { Express } from "express";
import type Database from "better-sqlite3";

// ─── Xactimate Audit Rules by loss type ──────────────────────────────────────
const AUDIT_RULES: Record<string, Array<{ code: string; description: string; estimatedValue: number }>> = {
  water: [
    { code: "WTREQ", description: "Equipment Monitoring Labor (setup, daily monitoring, teardown) — NOT included in equipment line items", estimatedValue: 400 },
    { code: "WTRNAFAN", description: "Air Filtration Device / HEPA Scrubber — IICRC S500 required, ~$71.54/day", estimatedValue: 215 },
    { code: "WTRBLK", description: "Block and Pad (furniture protection tabs) — bill whenever contents are moved", estimatedValue: 125 },
    { code: "WTRGRM", description: "Antimicrobial Application — required for Cat 2/3 losses", estimatedValue: 350 },
    { code: "WTRDHM", description: "Dehumidifiers — must be calculated per cubic footage per room, recalculate daily", estimatedValue: 600 },
    { code: "CON MANIP", description: "Contents Manipulation — photograph contents BEFORE moving with timestamps", estimatedValue: 750 },
    { code: "WTRINS", description: "Insulation Removal with Confined Space (C) add-on — commonly missed", estimatedValue: 280 },
    { code: "WTRTRI", description: "Trim and Baseboard Removal (bill separately from drywall demo)", estimatedValue: 180 },
    { code: "FEE SCAN", description: "3D Scan / Digital Sketch — Xactimate billable since June 2024", estimatedValue: 350 },
    { code: "SUPV", description: "Supervisory Hours — OSHA 1926.20(b)(2) required; separate from O&P", estimatedValue: 600 },
  ],
  fire: [
    { code: "FIRE FOG", description: "Thermal Fogging — separate line from generic deodorize; requires product + run duration photos", estimatedValue: 800 },
    { code: "FIRE OZN", description: "Ozone Treatment — requires equipment placement photos, sealed zone shots, re-entry timing", estimatedValue: 650 },
    { code: "FIRE HYD", description: "Hydroxyl Generation — where ozone occupancy restrictions apply; daily billing per unit", estimatedValue: 550 },
    { code: "HVC FRCLN", description: "HVAC Duct Cleaning — confirm smoke penetration with HVAC odor log", estimatedValue: 1200 },
    { code: "FIRE MIG", description: "Migration Room Odor Scope — remote rooms with smoke migration", estimatedValue: 2500 },
    { code: "FIRE SEA", description: "Sealant Application — after test-clean failure; requires before/after photos", estimatedValue: 900 },
    { code: "CLN DCTV+", description: "Duct Registers Cleaning — count per register, cross-reference with room odor log", estimatedValue: 480 },
    { code: "CON PKO", description: "Contents Pack-Out — inventory, box, transport; fire jobs add $10K-$30K", estimatedValue: 15000 },
    { code: "SUPV", description: "Supervisory Hours — ANSI S500 12.3.10.4 required for Cat 2/3", estimatedValue: 800 },
    { code: "FEE SCAN", description: "3D Scan / Digital Documentation — billable direct job cost", estimatedValue: 350 },
  ],
  mold: [
    { code: "HMR PPE", description: "PPE per Technician — formula: techs × changes/day × days (commonly $50-$200/day per tech)", estimatedValue: 400 },
    { code: "HMR PPERC", description: "Filter Changes for PPE — same formula as HMR PPE; always paired", estimatedValue: 200 },
    { code: "HMR BARRZ", description: "Peel-and-Seal Zipper for Containment Access — per zipper installed", estimatedValue: 150 },
    { code: "HMR HEPAVAS", description: "HEPA Vacuuming (Detailed) — per SF of affected area; commonly missed", estimatedValue: 350 },
    { code: "HMR NAFAN>", description: "Negative Air Fan / HEPA Scrubber (large) — bill daily, not per job", estimatedValue: 480 },
    { code: "HMR EQD", description: "Equipment Decontamination — per piece of equipment used on site", estimatedValue: 250 },
    { code: "HMR SANDW", description: "Sand Exposed Framing — after demo, before sealing", estimatedValue: 300 },
    { code: "WTR TEST+", description: "Post-Clearance Testing — clearance sampling cost; required on all mold jobs", estimatedValue: 550 },
    { code: "PNT S+++", description: "Anti-Microbial Sealant Coating — after sanding; separate from paint lines", estimatedValue: 420 },
    { code: "HMR BARR", description: "Containment Barrier Plastic — bill by SF of barrier erected", estimatedValue: 280 },
  ],
  storm: [
    { code: "RFG DRIP", description: "Drip Edge — IRC R905.2.8.5 required at eaves AND rakes; two separate lines", estimatedValue: 480 },
    { code: "RFG IWS", description: "Ice and Water Shield — IRC R905.1.2 required along eaves, valleys, penetrations", estimatedValue: 650 },
    { code: "RFG STRT", description: "Starter Strip — separate from field shingle; provides wind resistance at eaves", estimatedValue: 380 },
    { code: "RFG RIDGCAP", description: "Laminate-Specific Ridge Cap — must match laminate shingle; 3-tab cap is incorrect", estimatedValue: 420 },
    { code: "RFG SYNUND", description: "Synthetic Underlayment — most modern jobs require synthetic, not felt", estimatedValue: 550 },
    { code: "RFG FLSTP", description: "Step Flashing — linear feet; photograph failed step flashing explicitly", estimatedValue: 350 },
    { code: "RFG SWRAPP", description: "12-Mil Shrink Wrap (vs. standard tarp) — significantly higher billing when wind/pitch warrants", estimatedValue: 800 },
    { code: "STEEP CHG", description: "Pitch Add-On (7/12–9/12) — added on top of base shingle line item", estimatedValue: 700 },
    { code: "RFG VPJ", description: "Pipe Boots / Pipe Jacks — per penetration; missed on initial scopes", estimatedValue: 280 },
    { code: "RFG DCKRNL", description: "Decking Re-Nail or Replacement — IRC R908.3 code-triggered; photograph during tear-off", estimatedValue: 600 },
  ],
  general: [
    { code: "O&P", description: "Overhead & Profit (10+10) — owed whenever GC coordination is reasonably likely; cite Mee v. Safeco", estimatedValue: 0 },
    { code: "SUPV", description: "Supervision Hours (separate from O&P) — OSHA 1926.20(b)(2); bill at PM hourly rate", estimatedValue: 600 },
    { code: "FIN CLN", description: "Final Cleaning — separate from all trade work; residential ~$0.37/SF", estimatedValue: 450 },
    { code: "PERMIT", description: "Permit Fees — pass-through line item; attach receipt; code-triggered = mandatory", estimatedValue: 350 },
    { code: "FEE SCAN", description: "3D Scan / Digital Sketch — FEE SCAN added Xactimate June 2024; court-admissible", estimatedValue: 350 },
    { code: "DMO DTRUCK", description: "Debris Truck / Haul-Off — bill by volume (pickup, 12-yd, 20-yd, 30-yd, 40-yd)", estimatedValue: 500 },
    { code: "FLR PROT", description: "Floor Protection — all unaffected areas where crews walk", estimatedValue: 200 },
    { code: "CAB PROT", description: "Cabinet Protection — when demo occurs in adjacent rooms", estimatedValue: 150 },
  ],
};

// ─── O&P State-specific prompt-pay deadlines ─────────────────────────────────
const PROMPT_PAY = {
  GA: { days: 15, statute: "O.C.G.A. § 33-24-46", note: "Georgia requires written acknowledgment within 15 working days of supplement submission." },
  SC: { days: 15, statute: "S.C. Code Ann. § 38-59-20", note: "South Carolina requires acknowledgment within 15 working days and good-faith investigation within 45 days." },
};

export function registerSuite6Routes(app: Express, sqlite: Database.Database) {

  // ── Create tables ─────────────────────────────────────────────────────────
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS xact_audit_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      estimate_id INTEGER,
      loss_type TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT NOT NULL,
      estimated_value REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'flagged',
      dismissed_by TEXT,
      added_at TEXT,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS approved_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carrier TEXT NOT NULL,
      claim_number TEXT,
      job_id INTEGER,
      loss_type TEXT,
      line_item_code TEXT NOT NULL,
      line_item_description TEXT NOT NULL,
      approved_amount REAL,
      approved_date TEXT,
      adjuster_name TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS supplement_trackers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      carrier TEXT NOT NULL,
      claim_number TEXT,
      state TEXT NOT NULL DEFAULT 'GA',
      submitted_at TEXT NOT NULL,
      deadline_days INTEGER NOT NULL DEFAULT 15,
      deadline_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      responded_at TEXT,
      approved_amount REAL,
      denied_amount REAL,
      follow_up_sent_at TEXT,
      escalated_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS adjuster_courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      credit_hours REAL NOT NULL DEFAULT 1,
      description TEXT,
      content TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS adjuster_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL,
      adjuster_id INTEGER,
      adjuster_name TEXT NOT NULL,
      adjuster_email TEXT,
      carrier TEXT,
      completed_at TEXT,
      score INTEGER,
      certificate_issued INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS general_conditions_checklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      total_missed REAL DEFAULT 0,
      total_billed REAL DEFAULT 0,
      completed_by TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      make TEXT,
      model TEXT,
      year INTEGER,
      vin TEXT,
      license_plate TEXT,
      color TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      assigned_to TEXT,
      current_mileage INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS vehicle_maintenance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      performed_by TEXT,
      mileage_at_service INTEGER,
      cost REAL DEFAULT 0,
      invoice_number TEXT,
      service_date TEXT NOT NULL,
      next_service_mileage INTEGER,
      next_service_date TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT ''
    );
  `);

  // Seed default CE courses
  const courseCount = (sqlite.prepare("SELECT COUNT(*) as c FROM adjuster_courses").get() as any).c;
  if (courseCount === 0) {
    const now = new Date().toISOString();
    const courses = [
      { title: "Water Damage Drying Science (IICRC S500)", category: "water", creditHours: 1.0, description: "Psychrometrics, drying goals, equipment science, and documentation standards per IICRC S500.", status: "published" },
      { title: "Mold Remediation Standards (IICRC S520)", category: "mold", creditHours: 1.0, description: "Containment, clearance testing, and remediation scope documentation per IICRC S520.", status: "published" },
      { title: "Fire & Smoke Migration Scope Writing", category: "fire", creditHours: 1.0, description: "How smoke migrates through structures, odor treatment documentation, and HVAC scope.", status: "published" },
      { title: "O&P and Overhead in Xactimate: What Contractors Are Owed", category: "general", creditHours: 0.5, description: "Clarifies what Xactimate's unit pricing includes vs. excludes, and when O&P and supervision are billable.", status: "published" },
    ];
    const stmt = sqlite.prepare(`INSERT INTO adjuster_courses (title, category, credit_hours, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    courses.forEach(c => stmt.run(c.title, c.category, c.creditHours, c.description, c.status, now));
  }

  // ── XACT AUDIT ────────────────────────────────────────────────────────────

  // Auto-scan a job/estimate for missing line items
  app.post("/api/xact-audit/scan/:jobId", (req, res) => {
    try {
      const { jobId } = req.params;
      const { lossType, estimateId } = req.body;
      if (!lossType) return res.status(400).json({ error: "lossType required" });

      const rules = [
        ...(AUDIT_RULES[lossType.toLowerCase()] || []),
        ...(AUDIT_RULES.general || []),
      ];

      // Clear existing flagged items for this job+lossType
      sqlite.prepare("DELETE FROM xact_audit_flags WHERE job_id = ? AND status = 'flagged'").run(jobId);

      const now = new Date().toISOString();
      const insert = sqlite.prepare(`
        INSERT INTO xact_audit_flags (job_id, estimate_id, loss_type, code, description, estimated_value, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'flagged', ?)
      `);

      rules.forEach(rule => {
        insert.run(jobId, estimateId || null, lossType, rule.code, rule.description, rule.estimatedValue, now);
      });

      const flags = sqlite.prepare("SELECT * FROM xact_audit_flags WHERE job_id = ? ORDER BY estimated_value DESC").all(jobId);
      const totalMissed = rules.reduce((sum, r) => sum + r.estimatedValue, 0);
      res.json({ flagsCreated: rules.length, totalPotentialValue: totalMissed, flags });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/xact-audit/:jobId", (req, res) => {
    try {
      const flags = sqlite.prepare("SELECT * FROM xact_audit_flags WHERE job_id = ? ORDER BY estimated_value DESC").all(req.params.jobId);
      res.json(flags);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/xact-audit/:id", (req, res) => {
    try {
      const { status, dismissedBy } = req.body;
      const now = new Date().toISOString();
      sqlite.prepare("UPDATE xact_audit_flags SET status = ?, dismissed_by = ?, added_at = ? WHERE id = ?")
        .run(status, dismissedBy || null, now, req.params.id);
      res.json(sqlite.prepare("SELECT * FROM xact_audit_flags WHERE id = ?").get(req.params.id));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/xact-audit", (req, res) => {
    try {
      const flags = sqlite.prepare("SELECT * FROM xact_audit_flags ORDER BY created_at DESC LIMIT 200").all();
      res.json(flags);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── O&P REBUTTAL ──────────────────────────────────────────────────────────
  // Generates full O&P / Supervision rebuttal letter text
  app.post("/api/op-rebuttal/generate", (req, res) => {
    try {
      const { jobId, jobAddress, carrier, claimNumber, estimateSubtotal, disputedItems, state, supervisorHours, supervisorRate } = req.body;
      const opAmount = estimateSubtotal ? (estimateSubtotal * 0.205).toFixed(2) : "TBD";
      const supervisionTotal = supervisorHours && supervisorRate ? (supervisorHours * supervisorRate).toFixed(2) : null;
      const promptPay = PROMPT_PAY[state as "GA" | "SC"] || PROMPT_PAY.GA;

      const letter = `
RE: O&P AND SUPERVISION HOURS REBUTTAL
Claim: ${claimNumber || "N/A"} | Property: ${jobAddress || "N/A"} | Carrier: ${carrier || "N/A"}
Date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}

Dear ${carrier || "Claims Department"},

We are writing to formally dispute the denial of Overhead & Profit (O&P) and supervisory labor charges on the above-referenced claim. This letter provides the legal, regulatory, and industry-standard basis for these items.

────────────────────────────────────────────────────────
SECTION 1: OVERHEAD & PROFIT — BASIS FOR ENTITLEMENT
────────────────────────────────────────────────────────

The applicable legal standard for O&P entitlement is whether a general contractor is "reasonably likely" to be involved — not whether the insured has already hired one.

Supporting Case Law:
• Mee v. Safeco (PA, 2006): O&P must be included in the replacement cost estimate regardless of whether the homeowner has actually hired a GC.
• Tritschler v. Allstate (AZ, 2006): Replacement cost includes a GC's fee when one would reasonably be needed.
• Ghoman v. New Hampshire Insurance (TX, Federal): Replacement cost must include any cost "reasonably likely to incur" — O&P "clearly fits."

Xactimate's Own Documentation States:
"The unit prices in Xactimate reflect the cost of subcontractors performing the trade work. They do NOT include a general contractor's fee for managing those subcontractors. Overhead and Profit must be added separately."

The carrier is using Xactimate to write estimates. Xactimate's own documentation contradicts the O&P denial.

This project involves multiple trade disciplines requiring scheduling, sequencing, code compliance inspections, and material staging that a homeowner cannot reasonably self-manage. O&P at the standard 20.5% (10% overhead + 10% profit, compounded) on the estimate subtotal of $${estimateSubtotal?.toLocaleString() || "TBD"} = $${opAmount} is owed.

────────────────────────────────────────────────────────
SECTION 2: SUPERVISORY LABOR — SEPARATE FROM O&P
────────────────────────────────────────────────────────

Xactimate classifies supervision as "job-related overhead" — explicitly NOT part of the general O&P percentage. This classification is documented in Xactimate's own overhead framework:
• General overhead → built into O&P %
• Job-related overhead (supervision, PM, temporary facilities) → SEPARATE line items
• Job-personnel overhead → already in labor rates

Supervisory hours billed on this claim are required under:
• OSHA 1926.20(b)(2): Employer must designate a competent person to make "frequent and regular inspections of job sites, materials, and equipment."
• ANSI/IICRC S500 Section 15.1: Large projects require higher-level project management and administration.
• ANSI/IICRC S500 Section 12.3.10.4: Category 2 or 3 projects require post-remediation evaluation by a competent person.

${supervisionTotal ? `Supervisory hours claimed: ${supervisorHours} hours × $${supervisorRate}/hr = $${supervisionTotal}` : "Supervisory hours: See attached time log."}

────────────────────────────────────────────────────────
SECTION 3: DISPUTED ITEMS
────────────────────────────────────────────────────────
${disputedItems || "See attached itemized supplement."}

────────────────────────────────────────────────────────
SECTION 4: PROMPT-PAY NOTICE — ${state || "GA"}
────────────────────────────────────────────────────────

Per ${promptPay.statute}: ${promptPay.note}

We request a written response within 10 business days. If no response is received, we will escalate to the carrier's supervisor and, if necessary, invoke the appraisal clause under the insured's policy.

────────────────────────────────────────────────────────

Titan Restoration LLC
Cody Brantley, Owner | 706-922-0154 | cody@titanrestorationllc.com
License: [License Number] | Augusta, GA
      `.trim();

      res.json({ letter, promptPayStatute: promptPay.statute, opAmount, supervisionTotal });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── SUPPLEMENT TRACKER ────────────────────────────────────────────────────
  app.get("/api/supplement-tracker", (req, res) => {
    try {
      res.json(sqlite.prepare("SELECT * FROM supplement_trackers ORDER BY submitted_at DESC").all());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/supplement-tracker", (req, res) => {
    try {
      const { jobId, carrier, claimNumber, state, submittedAt } = req.body;
      const now = new Date().toISOString();
      const pp = PROMPT_PAY[state as "GA" | "SC"] || PROMPT_PAY.GA;
      const submitted = new Date(submittedAt || now);
      const deadline = new Date(submitted);
      deadline.setDate(deadline.getDate() + pp.days);
      const r = sqlite.prepare(`
        INSERT INTO supplement_trackers (job_id, carrier, claim_number, state, submitted_at, deadline_days, deadline_date, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run(jobId, carrier, claimNumber || null, state || "GA", submittedAt || now, pp.days, deadline.toISOString(), now);
      res.json(sqlite.prepare("SELECT * FROM supplement_trackers WHERE id = ?").get(r.lastInsertRowid));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/supplement-tracker/:id", (req, res) => {
    try {
      const fields = req.body || {};
      // Whitelist columns against the actual table schema so an attacker can't
      // inject arbitrary column names (or SQL) through JSON keys.
      const validCols = new Set(
        (sqlite.prepare("PRAGMA table_info(supplement_trackers)").all() as any[]).map((c: any) => c.name)
      );
      const setCols: string[] = [];
      const vals: any[] = [];
      for (const k of Object.keys(fields)) {
        const col = k.replace(/([A-Z])/g, "_$1").toLowerCase();
        if (col === "id" || col === "created_at") continue; // never allow overwriting these
        if (!validCols.has(col)) continue;                  // skip unknown columns
        setCols.push(`${col} = ?`);
        vals.push((fields as any)[k]);
      }
      if (setCols.length === 0) {
        return res.json(sqlite.prepare("SELECT * FROM supplement_trackers WHERE id = ?").get(req.params.id));
      }
      sqlite.prepare(`UPDATE supplement_trackers SET ${setCols.join(", ")} WHERE id = ?`)
        .run(...vals, req.params.id);
      res.json(sqlite.prepare("SELECT * FROM supplement_trackers WHERE id = ?").get(req.params.id));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Generate follow-up letter for overdue supplements
  app.post("/api/supplement-tracker/:id/followup", (req, res) => {
    try {
      const tracker = sqlite.prepare("SELECT * FROM supplement_trackers WHERE id = ?").get(req.params.id) as any;
      if (!tracker) return res.status(404).json({ error: "Not found" });
      const pp = PROMPT_PAY[tracker.state as "GA" | "SC"] || PROMPT_PAY.GA;
      const letter = `
RE: OVERDUE SUPPLEMENT RESPONSE — FORMAL FOLLOW-UP
Claim: ${tracker.claim_number || "N/A"} | Carrier: ${tracker.carrier}
Date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}

Dear ${tracker.carrier} Claims Department,

On ${new Date(tracker.submitted_at).toLocaleDateString()}, Titan Restoration LLC submitted a supplemental estimate for the above-referenced claim. As of today, we have not received a written acknowledgment or response.

Per ${pp.statute}: ${pp.note}

The statutory deadline of ${pp.days} working days has now passed. We formally request:
1. Written acknowledgment of our supplement submission
2. A revised estimate or written denial with specific reasons within 10 business days of this letter
3. If denied, citation of the specific policy language or industry standard supporting each denial

Failure to respond will result in:
• Escalation to your supervisor and the ${tracker.state} Department of Insurance
• Invocation of the appraisal clause under the insured's policy for amount-of-loss disputes
• Referral to legal counsel if necessary

Please respond in writing to:
Titan Restoration LLC
Cody Brantley, Owner
706-922-0154 | cody@titanrestorationllc.com

Titan Restoration LLC — License: [License Number] — Augusta, GA
      `.trim();

      sqlite.prepare("UPDATE supplement_trackers SET follow_up_sent_at = ? WHERE id = ?")
        .run(new Date().toISOString(), req.params.id);

      res.json({ letter, statute: pp.statute });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── APPROVED CLAIMS LIBRARY ───────────────────────────────────────────────
  app.get("/api/approved-claims", (req, res) => {
    try {
      const { carrier, code, lossType } = req.query;
      let q = "SELECT * FROM approved_claims WHERE 1=1";
      const params: any[] = [];
      if (carrier) { q += " AND LOWER(carrier) LIKE ?"; params.push(`%${carrier}%`.toLowerCase()); }
      if (code) { q += " AND LOWER(line_item_code) LIKE ?"; params.push(`%${code}%`.toLowerCase()); }
      if (lossType) { q += " AND LOWER(loss_type) = ?"; params.push((lossType as string).toLowerCase()); }
      q += " ORDER BY approved_date DESC LIMIT 500";
      res.json(sqlite.prepare(q).all(...params));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/approved-claims", (req, res) => {
    try {
      const { carrier, claimNumber, jobId, lossType, lineItemCode, lineItemDescription, approvedAmount, approvedDate, adjusterName, notes } = req.body;
      const r = sqlite.prepare(`
        INSERT INTO approved_claims (carrier, claim_number, job_id, loss_type, line_item_code, line_item_description, approved_amount, approved_date, adjuster_name, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(carrier, claimNumber || null, jobId || null, lossType || null, lineItemCode, lineItemDescription, approvedAmount || null, approvedDate || null, adjusterName || null, notes || null, new Date().toISOString());
      res.json(sqlite.prepare("SELECT * FROM approved_claims WHERE id = ?").get(r.lastInsertRowid));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/approved-claims/:id", (req, res) => {
    try {
      sqlite.prepare("DELETE FROM approved_claims WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── GENERAL CONDITIONS CHECKLIST ──────────────────────────────────────────
  const GC_DEFAULT_ITEMS = [
    // Labor
    { code: "SUPV", label: "Supervisory Hours (OSHA 1926.20)", category: "Labor", estimatedValue: 600, billed: false, notes: "" },
    { code: "PM", label: "Project Management Hours", category: "Labor", estimatedValue: 400, billed: false, notes: "" },
    { code: "PREINS", label: "Pre-Inspection Meeting with Homeowner", category: "Labor", estimatedValue: 150, billed: false, notes: "" },
    { code: "POSTEVAL", label: "Post-Remediation Evaluation Visit (Cat 2/3)", category: "Labor", estimatedValue: 200, billed: false, notes: "" },
    // Site Logistics
    { code: "DMO DTRUCK", label: "Debris Haul-Off (volume-based)", category: "Site", estimatedValue: 500, billed: false, notes: "" },
    { code: "FLR PROT", label: "Floor Protection (unaffected traffic areas)", category: "Site", estimatedValue: 200, billed: false, notes: "" },
    { code: "CAB PROT", label: "Cabinet Protection", category: "Site", estimatedValue: 150, billed: false, notes: "" },
    { code: "LAND PROT", label: "Landscape Protection", category: "Site", estimatedValue: 100, billed: false, notes: "" },
    { code: "TEMP REST", label: "Temporary Restroom", category: "Site", estimatedValue: 180, billed: false, notes: "" },
    { code: "TEMP PWR", label: "Temporary Power", category: "Site", estimatedValue: 250, billed: false, notes: "" },
    { code: "SITE SEC", label: "Site Security", category: "Site", estimatedValue: 300, billed: false, notes: "" },
    { code: "TEMP FEN", label: "Temporary Fencing / Barricades", category: "Site", estimatedValue: 350, billed: false, notes: "" },
    // Documentation
    { code: "FEE SCAN", label: "3D Scan / Digital Sketch (Xactimate June 2024)", category: "Documentation", estimatedValue: 350, billed: false, notes: "" },
    { code: "PERMIT", label: "Permit Fees (pass-through with receipt)", category: "Documentation", estimatedValue: 350, billed: false, notes: "" },
    { code: "INSP COORD", label: "Permit Inspection Coordination", category: "Documentation", estimatedValue: 150, billed: false, notes: "" },
    // Cleaning & Close-Out
    { code: "FIN CLN", label: "Final Cleaning (separate from all trade work)", category: "Cleaning", estimatedValue: 450, billed: false, notes: "" },
    { code: "HEPA VAC", label: "HEPA Vacuuming After Demo (mold/fire)", category: "Cleaning", estimatedValue: 300, billed: false, notes: "" },
    { code: "WTR TEST+", label: "Post-Remediation Verification Testing", category: "Cleaning", estimatedValue: 550, billed: false, notes: "" },
    // CAT / Large Loss
    { code: "FEE MOB", label: "Mobilization (FEE MOB — June 2024 Xactimate)", category: "CAT", estimatedValue: 800, billed: false, notes: "" },
    { code: "FEE LODG", label: "Lodging for Crew (FEE LODG)", category: "CAT", estimatedValue: 600, billed: false, notes: "" },
    { code: "FEE MEAL", label: "Meals (FEE MEAL)", category: "CAT", estimatedValue: 200, billed: false, notes: "" },
    { code: "VAULT STG", label: "Contents Vault Storage (per month)", category: "CAT", estimatedValue: 400, billed: false, notes: "" },
  ];

  app.get("/api/general-conditions/:jobId", (req, res) => {
    try {
      let row = sqlite.prepare("SELECT * FROM general_conditions_checklist WHERE job_id = ?").get(req.params.jobId) as any;
      if (!row) {
        // Auto-create for this job
        const r = sqlite.prepare(`
          INSERT INTO general_conditions_checklist (job_id, items, total_missed, total_billed, created_at)
          VALUES (?, ?, ?, 0, ?)
        `).run(req.params.jobId, JSON.stringify(GC_DEFAULT_ITEMS), GC_DEFAULT_ITEMS.reduce((s, i) => s + i.estimatedValue, 0), new Date().toISOString());
        row = sqlite.prepare("SELECT * FROM general_conditions_checklist WHERE id = ?").get(r.lastInsertRowid);
      }
      res.json(row);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/general-conditions/:jobId", (req, res) => {
    try {
      const { items, completedBy } = req.body;
      const parsed: any[] = typeof items === "string" ? JSON.parse(items) : items;
      const totalBilled = parsed.filter((i: any) => i.billed).reduce((s: number, i: any) => s + (i.estimatedValue || 0), 0);
      const totalMissed = parsed.filter((i: any) => !i.billed).reduce((s: number, i: any) => s + (i.estimatedValue || 0), 0);
      sqlite.prepare(`
        UPDATE general_conditions_checklist SET items = ?, total_billed = ?, total_missed = ?, completed_by = ?, completed_at = ? WHERE job_id = ?
      `).run(JSON.stringify(parsed), totalBilled, totalMissed, completedBy || null, new Date().toISOString(), req.params.jobId);
      res.json(sqlite.prepare("SELECT * FROM general_conditions_checklist WHERE job_id = ?").get(req.params.jobId));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── ADJUSTER CE PORTAL ────────────────────────────────────────────────────
  app.get("/api/adjuster-courses", (req, res) => {
    try {
      res.json(sqlite.prepare("SELECT * FROM adjuster_courses ORDER BY created_at DESC").all());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/adjuster-courses", (req, res) => {
    try {
      const { title, category, creditHours, description, content, status } = req.body;
      const r = sqlite.prepare(`
        INSERT INTO adjuster_courses (title, category, credit_hours, description, content, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(title, category, creditHours || 1, description || null, content || null, status || "draft", new Date().toISOString());
      res.json(sqlite.prepare("SELECT * FROM adjuster_courses WHERE id = ?").get(r.lastInsertRowid));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/adjuster-courses/:id", (req, res) => {
    try {
      const { title, category, creditHours, description, content, status } = req.body;
      sqlite.prepare(`UPDATE adjuster_courses SET title=?, category=?, credit_hours=?, description=?, content=?, status=? WHERE id=?`)
        .run(title, category, creditHours, description, content, status, req.params.id);
      res.json(sqlite.prepare("SELECT * FROM adjuster_courses WHERE id = ?").get(req.params.id));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/adjuster-enrollments", (req, res) => {
    try {
      const { courseId } = req.query;
      const q = courseId
        ? "SELECT * FROM adjuster_enrollments WHERE course_id = ? ORDER BY created_at DESC"
        : "SELECT * FROM adjuster_enrollments ORDER BY created_at DESC";
      res.json(courseId ? sqlite.prepare(q).all(courseId) : sqlite.prepare(q).all());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/adjuster-enrollments", (req, res) => {
    try {
      const { courseId, adjusterName, adjusterEmail, carrier, adjusterId } = req.body;
      const r = sqlite.prepare(`
        INSERT INTO adjuster_enrollments (course_id, adjuster_id, adjuster_name, adjuster_email, carrier, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(courseId, adjusterId || null, adjusterName, adjusterEmail || null, carrier || null, new Date().toISOString());
      res.json(sqlite.prepare("SELECT * FROM adjuster_enrollments WHERE id = ?").get(r.lastInsertRowid));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/adjuster-enrollments/:id", (req, res) => {
    try {
      const { completedAt, score, certificateIssued } = req.body;
      sqlite.prepare("UPDATE adjuster_enrollments SET completed_at=?, score=?, certificate_issued=? WHERE id=?")
        .run(completedAt || null, score || null, certificateIssued ? 1 : 0, req.params.id);
      res.json(sqlite.prepare("SELECT * FROM adjuster_enrollments WHERE id = ?").get(req.params.id));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── VEHICLES ──────────────────────────────────────────────────────────────
  app.get("/api/vehicles", (req, res) => {
    try {
      res.json(sqlite.prepare("SELECT * FROM vehicles ORDER BY name ASC").all());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/vehicles", (req, res) => {
    try {
      const { name, make, model, year, vin, licensePlate, color, status, assignedTo, currentMileage, notes } = req.body;
      const r = sqlite.prepare(`
        INSERT INTO vehicles (name, make, model, year, vin, license_plate, color, status, assigned_to, current_mileage, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, make || null, model || null, year || null, vin || null, licensePlate || null, color || null, status || "active", assignedTo || null, currentMileage || 0, notes || null, new Date().toISOString());
      res.json(sqlite.prepare("SELECT * FROM vehicles WHERE id = ?").get(r.lastInsertRowid));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/vehicles/:id", (req, res) => {
    try {
      const { name, make, model, year, vin, licensePlate, color, status, assignedTo, currentMileage, notes } = req.body;
      sqlite.prepare(`UPDATE vehicles SET name=?, make=?, model=?, year=?, vin=?, license_plate=?, color=?, status=?, assigned_to=?, current_mileage=?, notes=? WHERE id=?`)
        .run(name, make || null, model || null, year || null, vin || null, licensePlate || null, color || null, status, assignedTo || null, currentMileage || 0, notes || null, req.params.id);
      res.json(sqlite.prepare("SELECT * FROM vehicles WHERE id = ?").get(req.params.id));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/vehicles/:id", (req, res) => {
    try {
      sqlite.prepare("DELETE FROM vehicles WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── VEHICLE MAINTENANCE LOGS ──────────────────────────────────────────────
  app.get("/api/vehicle-maintenance", (req, res) => {
    try {
      const { vehicleId, upcoming } = req.query;
      let q = "SELECT * FROM vehicle_maintenance_logs WHERE 1=1";
      const params: any[] = [];
      if (vehicleId) { q += " AND vehicle_id = ?"; params.push(vehicleId); }
      if (upcoming === "true") { q += " AND status = 'scheduled' AND next_service_date IS NOT NULL"; }
      q += " ORDER BY service_date DESC";
      res.json(sqlite.prepare(q).all(...params));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/vehicle-maintenance", (req, res) => {
    try {
      const { vehicleId, type, description, performedBy, mileageAtService, cost, invoiceNumber, serviceDate, nextServiceMileage, nextServiceDate, status, notes } = req.body;
      const r = sqlite.prepare(`
        INSERT INTO vehicle_maintenance_logs (vehicle_id, type, description, performed_by, mileage_at_service, cost, invoice_number, service_date, next_service_mileage, next_service_date, status, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(vehicleId, type, description, performedBy || null, mileageAtService || null, cost || 0, invoiceNumber || null, serviceDate, nextServiceMileage || null, nextServiceDate || null, status || "completed", notes || null, new Date().toISOString());
      // Update vehicle mileage if higher
      if (mileageAtService) {
        sqlite.prepare("UPDATE vehicles SET current_mileage = MAX(current_mileage, ?) WHERE id = ?").run(mileageAtService, vehicleId);
      }
      res.json(sqlite.prepare("SELECT * FROM vehicle_maintenance_logs WHERE id = ?").get(r.lastInsertRowid));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/vehicle-maintenance/:id", (req, res) => {
    try {
      const { type, description, performedBy, mileageAtService, cost, invoiceNumber, serviceDate, nextServiceMileage, nextServiceDate, status, notes } = req.body;
      sqlite.prepare(`UPDATE vehicle_maintenance_logs SET type=?, description=?, performed_by=?, mileage_at_service=?, cost=?, invoice_number=?, service_date=?, next_service_mileage=?, next_service_date=?, status=?, notes=? WHERE id=?`)
        .run(type, description, performedBy || null, mileageAtService || null, cost || 0, invoiceNumber || null, serviceDate, nextServiceMileage || null, nextServiceDate || null, status, notes || null, req.params.id);
      res.json(sqlite.prepare("SELECT * FROM vehicle_maintenance_logs WHERE id = ?").get(req.params.id));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/vehicle-maintenance/:id", (req, res) => {
    try {
      sqlite.prepare("DELETE FROM vehicle_maintenance_logs WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Fleet summary — upcoming service due
  app.get("/api/vehicles/fleet-summary", (req, res) => {
    try {
      const vehicles = sqlite.prepare("SELECT * FROM vehicles ORDER BY name ASC").all() as any[];
      const now = new Date().toISOString().split("T")[0];
      const summary = vehicles.map(v => {
        const lastLog = sqlite.prepare("SELECT * FROM vehicle_maintenance_logs WHERE vehicle_id = ? ORDER BY service_date DESC LIMIT 1").get(v.id) as any;
        const upcoming = sqlite.prepare("SELECT * FROM vehicle_maintenance_logs WHERE vehicle_id = ? AND status = 'scheduled' ORDER BY next_service_date ASC LIMIT 3").all(v.id) as any[];
        const totalCost = (sqlite.prepare("SELECT SUM(cost) as total FROM vehicle_maintenance_logs WHERE vehicle_id = ?").get(v.id) as any)?.total || 0;
        const overdue = upcoming.filter((u: any) => u.next_service_date && u.next_service_date < now);
        return { ...v, lastService: lastLog?.service_date || null, upcomingCount: upcoming.length, overdueCount: overdue.length, totalMaintenanceCost: totalCost, upcoming };
      });
      res.json(summary);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Audit rules reference
  app.get("/api/xact-audit/rules/:lossType", (req, res) => {
    try {
      const rules = AUDIT_RULES[req.params.lossType.toLowerCase()] || [];
      res.json({ lossType: req.params.lossType, rules, generalRules: AUDIT_RULES.general });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
