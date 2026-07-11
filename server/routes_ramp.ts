import type { Express } from "express";
import type Database from "better-sqlite3";

// Cost category inference from merchant name / category
function inferCostCategory(merchant: string, category: string, memo: string): string {
  const m = (merchant + " " + category + " " + memo).toLowerCase();
  if (/fuel|gas|shell|bp |exxon|chevron|speedway|pilot|loves |marathon|circle k/.test(m)) return "fuel";
  if (/home depot|lowes|menards|fastenal|grainger|supply|lumber|hardware|material|plywood|drywall|pipe|pvc/.test(m)) return "materials";
  if (/equipment|rent|sunbelt|united rental|blueline|tool|air mover|dehumid/.test(m)) return "equipment";
  if (/hotel|motel|marriott|hilton|hampton|airbnb|lodging/.test(m)) return "lodging";
  if (/food|restaurant|mcdonald|subway|chick-fil|domino|pizza|starbucks|dunkin|meal/.test(m)) return "meals";
  if (/dump|disposal|waste|trash|haul/.test(m)) return "disposal";
  if (/insurance|liability|workers comp/.test(m)) return "insurance";
  if (/office|staples|amazon|fedex|ups|shipping/.test(m)) return "supplies";
  if (/phone|verizon|at&t|t-mobile|sprint/.test(m)) return "communications";
  return "other";
}

// Auto-match a transaction to a job by memo / description keyword (e.g. TP-0042)
function inferJobId(memo: string, merchant: string, jobs: any[]): number | null {
  const text = (memo + " " + merchant).toUpperCase();
  // Match job number pattern: TP-XXXX or TP XXXX
  const match = text.match(/TP[-\s]?(\d{3,5})/);
  if (match) {
    const num = match[1];
    const job = jobs.find((j: any) => j.job_number && j.job_number.replace(/\D/g, "").endsWith(num));
    if (job) return job.id;
  }
  // Match by address keyword (first word of address)
  for (const job of jobs) {
    if (!job.address) continue;
    const firstWord = job.address.split(" ")[0]?.toUpperCase();
    if (firstWord && firstWord.length > 4 && text.includes(firstWord)) return job.id;
  }
  return null;
}

export function registerRampRoutes(app: Express, sqlite: Database.Database) {

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ramp_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ramp_id TEXT,
      job_id INTEGER,
      card_holder TEXT,
      merchant_name TEXT,
      merchant_category TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      transaction_date TEXT NOT NULL,
      memo TEXT,
      cost_category TEXT,
      match_status TEXT NOT NULL DEFAULT 'unmatched',
      imported_at TEXT NOT NULL DEFAULT '',
      notes TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ramp_id ON ramp_transactions(ramp_id) WHERE ramp_id IS NOT NULL;
  `);

  // GET all ramp transactions (optionally filtered by job or match status)
  app.get("/api/ramp-transactions", (req, res) => {
    try {
      const { jobId, matchStatus, limit } = req.query;
      let q = "SELECT * FROM ramp_transactions WHERE 1=1";
      const params: any[] = [];
      if (jobId) { q += " AND job_id = ?"; params.push(jobId); }
      if (matchStatus) { q += " AND match_status = ?"; params.push(matchStatus); }
      q += " ORDER BY transaction_date DESC LIMIT ?";
      params.push(limit ? parseInt(limit as string) : 500);
      res.json(sqlite.prepare(q).all(...params));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/ramp-transactions/import  — bulk import parsed CSV rows
  app.post("/api/ramp-transactions/import", (req, res) => {
    try {
      const { rows } = req.body as { rows: any[] };
      if (!rows || !Array.isArray(rows)) return res.status(400).json({ error: "rows array required" });

      const jobs = sqlite.prepare("SELECT id, job_number, address FROM jobs").all() as any[];
      const now = new Date().toISOString();

      let imported = 0, dupes = 0, autoMatched = 0;
      const insert = sqlite.prepare(`
        INSERT OR IGNORE INTO ramp_transactions
          (ramp_id, job_id, card_holder, merchant_name, merchant_category, amount, currency, transaction_date, memo, cost_category, match_status, imported_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const row of rows) {
        const rampId = row.id || row.ramp_id || null;
        const merchant = row.merchant_name || row.Merchant || row.merchant || "";
        const category = row.merchant_category || row.Category || row.category || "";
        const memo = row.memo || row.Memo || row.description || row.Description || "";
        const cardHolder = row.card_holder || row["Card Holder"] || row.cardholder || "";
        const amount = Math.abs(parseFloat(row.amount || row.Amount || "0"));
        const currency = row.currency || row.Currency || "USD";
        const date = row.transaction_date || row["Transaction Date"] || row.date || row.Date || now.split("T")[0];

        if (isNaN(amount) || amount === 0) continue;

        const costCategory = inferCostCategory(merchant, category, memo);
        const jobId = inferJobId(memo, merchant, jobs);
        const matchStatus = jobId ? "auto" : "unmatched";

        const result = insert.run(rampId, jobId, cardHolder, merchant, category, amount, currency, date, memo, costCategory, matchStatus, now);
        if (result.changes > 0) {
          imported++;
          if (jobId) autoMatched++;
        } else {
          dupes++;
        }
      }

      res.json({ imported, dupes, autoMatched, total: rows.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/ramp-transactions/:id — update job assignment or category
  app.patch("/api/ramp-transactions/:id", (req, res) => {
    try {
      const { jobId, costCategory, matchStatus, notes } = req.body;
      const status = matchStatus || (jobId ? "manual" : "skipped");
      sqlite.prepare(`
        UPDATE ramp_transactions SET job_id = ?, cost_category = ?, match_status = ?, notes = ? WHERE id = ?
      `).run(jobId || null, costCategory || null, status, notes || null, req.params.id);
      res.json(sqlite.prepare("SELECT * FROM ramp_transactions WHERE id = ?").get(req.params.id));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE a single transaction
  app.delete("/api/ramp-transactions/:id", (req, res) => {
    try {
      sqlite.prepare("DELETE FROM ramp_transactions WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET summary stats for dashboard
  app.get("/api/ramp-transactions/summary", (req, res) => {
    try {
      const total = (sqlite.prepare("SELECT COUNT(*) as c, SUM(amount) as s FROM ramp_transactions").get() as any);
      const unmatched = (sqlite.prepare("SELECT COUNT(*) as c, SUM(amount) as s FROM ramp_transactions WHERE match_status = 'unmatched'").get() as any);
      const byCategory = sqlite.prepare("SELECT cost_category, COUNT(*) as count, SUM(amount) as total FROM ramp_transactions GROUP BY cost_category ORDER BY total DESC").all();
      const byJob = sqlite.prepare(`
        SELECT rt.job_id, j.job_number, j.address, COUNT(*) as txn_count, SUM(rt.amount) as total_spent
        FROM ramp_transactions rt
        LEFT JOIN jobs j ON j.id = rt.job_id
        WHERE rt.job_id IS NOT NULL
        GROUP BY rt.job_id ORDER BY total_spent DESC LIMIT 20
      `).all();
      res.json({ totalTransactions: total.c, totalSpend: total.s || 0, unmatchedCount: unmatched.c, unmatchedSpend: unmatched.s || 0, byCategory, byJob });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET all spend for a specific job (used by Job Detail page)
  app.get("/api/ramp-transactions/by-job/:jobId", (req, res) => {
    try {
      const rows = sqlite.prepare("SELECT * FROM ramp_transactions WHERE job_id = ? ORDER BY transaction_date DESC").all(req.params.jobId);
      const total = (sqlite.prepare("SELECT SUM(amount) as s FROM ramp_transactions WHERE job_id = ?").get(req.params.jobId) as any)?.s || 0;
      res.json({ transactions: rows, totalSpend: total });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
