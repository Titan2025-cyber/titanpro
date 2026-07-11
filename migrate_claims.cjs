// Migration: add insurance-claim advocacy tables + columns (customer-safe figures only)
const db = require('better-sqlite3')('data.db');

function hasCol(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

// ── job_claims: one row per job — the insurance-side financial picture ──────
// All values are CLAIM figures the homeowner is entitled to see (carrier estimate,
// deductible, RCV/ACV, recoverable depreciation). NO Titan internal cost/margin data.
db.exec(`
CREATE TABLE IF NOT EXISTS job_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  claim_status TEXT DEFAULT 'open',        -- open | inspected | approved | supplement_pending | closed
  date_of_loss TEXT,
  reported_date TEXT,
  deductible REAL DEFAULT 0,
  rcv REAL DEFAULT 0,                       -- Replacement Cost Value (total scope)
  acv REAL DEFAULT 0,                       -- Actual Cash Value (RCV minus depreciation)
  recoverable_depreciation REAL DEFAULT 0,  -- released once repairs are complete
  supplement_total REAL DEFAULT 0,          -- approved supplement additions
  coverage_notes TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_claims_job ON job_claims(job_id);
`);

// ── claim_payments: the money milestones from the carrier ───────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS claim_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  label TEXT NOT NULL,          -- e.g. "ACV Payment", "Recoverable Depreciation", "Supplement"
  kind TEXT DEFAULT 'carrier',  -- carrier | deductible | depreciation | supplement
  amount REAL DEFAULT 0,
  status TEXT DEFAULT 'expected', -- expected | issued | received
  expected_date TEXT,
  received_date TEXT,
  note TEXT,
  sort_order INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_claim_payments_job ON claim_payments(job_id);
`);

console.log('Tables ensured: job_claims, claim_payments');

// ── Seed demo claim data for jobs 1 & 2 (Hayes / State Farm) ────────────────
const upsertClaim = db.prepare(`
  INSERT INTO job_claims (job_id, claim_status, date_of_loss, reported_date, deductible, rcv, acv, recoverable_depreciation, supplement_total, coverage_notes, updated_at)
  VALUES (@job_id, @claim_status, @date_of_loss, @reported_date, @deductible, @rcv, @acv, @recoverable_depreciation, @supplement_total, @coverage_notes, @updated_at)
`);
const clearClaim = db.prepare('DELETE FROM job_claims WHERE job_id = ?');
const clearPays = db.prepare('DELETE FROM claim_payments WHERE job_id = ?');
const insPay = db.prepare(`
  INSERT INTO claim_payments (job_id, label, kind, amount, status, expected_date, received_date, note, sort_order)
  VALUES (@job_id, @label, @kind, @amount, @status, @expected_date, @received_date, @note, @sort_order)
`);

const now = new Date().toISOString();

// JOB 1 — water loss, mitigation stage. Carrier approved ACV, depreciation still recoverable.
clearClaim.run(1); clearPays.run(1);
upsertClaim.run({
  job_id: 1, claim_status: 'approved',
  date_of_loss: '2026-06-18', reported_date: '2026-06-18',
  deductible: 1000, rcv: 15915, acv: 13215, recoverable_depreciation: 1700, supplement_total: 0,
  coverage_notes: 'Dwelling (Coverage A) covers structural water damage. Deductible applies once per claim. Recoverable depreciation is released after repairs are verified complete.',
  updated_at: now,
});
[
  { job_id:1, label:'Deductible (your responsibility)', kind:'deductible', amount:1000, status:'expected', expected_date:null, received_date:null, note:'Paid by you toward the total. Titan applies this to your final balance.', sort_order:1 },
  { job_id:1, label:'ACV Payment (initial carrier check)', kind:'carrier', amount:13215, status:'received', expected_date:'2026-06-25', received_date:'2026-06-27', note:'First payment from State Farm — actual cash value of approved scope, less depreciation and deductible.', sort_order:2 },
  { job_id:1, label:'Recoverable Depreciation', kind:'depreciation', amount:1700, status:'expected', expected_date:null, received_date:null, note:'Released by the carrier once repairs are completed and invoiced. Titan files this for you.', sort_order:3 },
].forEach(p => insPay.run(p));

// JOB 2 — fire loss, reconstruction stage. Depreciation released, supplement approved.
clearClaim.run(2); clearPays.run(2);
upsertClaim.run({
  job_id: 2, claim_status: 'closed',
  date_of_loss: '2026-05-02', reported_date: '2026-05-03',
  deductible: 2500, rcv: 41150, acv: 33650, recoverable_depreciation: 7500, supplement_total: 2500,
  coverage_notes: 'Fire loss covered under Dwelling (Coverage A) plus Contents (Coverage C). A supplement was approved for additional smoke remediation discovered during rebuild.',
  updated_at: now,
});
[
  { job_id:2, label:'Deductible (your responsibility)', kind:'deductible', amount:2500, status:'received', expected_date:null, received_date:'2026-05-10', note:'Applied to your balance.', sort_order:1 },
  { job_id:2, label:'ACV Payment (initial carrier check)', kind:'carrier', amount:33650, status:'received', expected_date:'2026-05-12', received_date:'2026-05-14', note:'Initial actual cash value payment.', sort_order:2 },
  { job_id:2, label:'Recoverable Depreciation', kind:'depreciation', amount:7500, status:'received', expected_date:null, received_date:'2026-06-28', note:'Released after final repairs were verified.', sort_order:3 },
  { job_id:2, label:'Approved Supplement (smoke remediation)', kind:'supplement', amount:2500, status:'received', expected_date:null, received_date:'2026-06-30', note:'Titan documented additional damage and the carrier approved the supplement.', sort_order:4 },
].forEach(p => insPay.run(p));

console.log('Seeded claim data for jobs 1 & 2');
console.log('job_claims:', db.prepare('SELECT job_id, claim_status, deductible, rcv, acv, recoverable_depreciation FROM job_claims').all());
console.log('claim_payments count:', db.prepare('SELECT COUNT(*) c FROM claim_payments').get());
