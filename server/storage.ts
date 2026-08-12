import { encryptField, decryptField, maskField } from "./encryption";
import { Database } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import BetterSqlite3 from "better-sqlite3";
import { eq, desc } from "drizzle-orm";
import * as schema from "@shared/schema";
import fs from "fs";
import path from "path";

// DB file location: use DATABASE_PATH env var (set to a persistent volume path in
// production, e.g. Railway volume mounted at /data/data.db). Falls back to a local
// "data.db" file for development so nothing changes locally.
const DB_PATH = process.env.DATABASE_PATH || "data.db";
try {
  const dir = path.dirname(DB_PATH);
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
} catch (e) {
  console.warn("[storage] Could not ensure DB directory (non-fatal):", e);
}
// First-boot seed: when running against a fresh persistent volume (DATABASE_PATH
// set, target file missing) and a bundled seed-data.db exists, copy it into place
// once so existing data (jobs, contacts, invoices, employees) is carried over.
// After the first boot the file exists, so this never runs again.
try {
  if (
    process.env.DATABASE_PATH &&
    !fs.existsSync(DB_PATH) &&
    fs.existsSync("seed-data.db")
  ) {
    fs.copyFileSync("seed-data.db", DB_PATH);
    console.log("[storage] First-boot seed applied from seed-data.db -> " + DB_PATH);
  }
} catch (e) {
  console.warn("[storage] First-boot seed skipped (non-fatal):", e);
}

// Recovery seed (DANGEROUS — DISABLED BY DEFAULT):
//
// Historically: if the target DB existed but had no active employees, this
// would overwrite it with seed-data.db. That's a data-loss footgun — a
// migration or transient error that leaves employees.is_active = 0 for all
// users would clobber the entire production DB on the next boot. This was
// almost certainly the cause of the "lost job info after a redeploy"
// incident reported by the operator.
//
// Now: only runs when ALLOW_RECOVERY_SEED=1 is explicitly set. In every
// other case, an empty DB just stays empty and the operator restores from
// a backup via /api/admin/backups. The bundled seed-data.db is untouched
// on disk and available if you ever intentionally need to reset.
if (process.env.ALLOW_RECOVERY_SEED === "1") {
  try {
    if (fs.existsSync(DB_PATH) && fs.existsSync("seed-data.db")) {
      const probe = new BetterSqlite3(DB_PATH, { readonly: true });
      let hasUsers = false;
      try {
        const row: any = probe.prepare("SELECT COUNT(*) AS n FROM employees WHERE is_active = 1").get();
        hasUsers = Number(row?.n || 0) > 0;
      } catch { /* table missing = empty DB */ }
      probe.close();
      if (!hasUsers) {
        // Even when the operator opts in, make a safety copy of whatever
        // is currently on disk before overwriting it so nothing is ever
        // truly gone.
        try {
          const safety = DB_PATH + ".pre-recovery-" + Date.now() + ".bak";
          fs.copyFileSync(DB_PATH, safety);
          console.log("[storage] Pre-recovery safety copy: " + safety);
        } catch (safetyErr) {
          console.warn("[storage] Pre-recovery safety copy failed (aborting seed):", safetyErr);
          throw safetyErr;
        }
        fs.copyFileSync("seed-data.db", DB_PATH);
        console.log("[storage] Recovery seed applied (opt-in via ALLOW_RECOVERY_SEED) -> " + DB_PATH);
      }
    }
  } catch (e) {
    console.warn("[storage] Recovery seed skipped (non-fatal):", e);
  }
} else if (fs.existsSync(DB_PATH)) {
  // Log-only diagnostic — helps Cody see when the DB looks unusually empty
  // right after a boot without silently overwriting anything.
  try {
    const probe = new BetterSqlite3(DB_PATH, { readonly: true });
    try {
      const jobsRow: any = probe.prepare("SELECT COUNT(*) AS n FROM jobs").get();
      const empRow: any = probe.prepare("SELECT COUNT(*) AS n FROM employees WHERE is_active = 1").get();
      console.log(`[storage] DB opened at ${DB_PATH}: ${Number(jobsRow?.n||0)} jobs, ${Number(empRow?.n||0)} active employees`);
    } catch { /* tables may not exist yet on very first boot */ }
    probe.close();
  } catch { /* non-fatal */ }
}
export const sqlite: Database = new BetterSqlite3(DB_PATH);
const db = drizzle(sqlite, { schema });

// ── Automatic rotating DB backups ────────────────────────────────────────────
// Timestamped, retained snapshots written to <db-dir>/backups. Runs once on
// startup and then every BACKUP_INTERVAL_HOURS (default 24h). Uses SQLite's
// online backup API so snapshots are consistent even while the DB is being
// written (a raw file copy can corrupt a WAL database mid-write). Keeps the most
// recent BACKUP_KEEP files (default 14) and prunes older ones.
// Tunable via env: BACKUP_DIR, BACKUP_INTERVAL_HOURS, BACKUP_KEEP.
// Disable entirely with BACKUP_DISABLED=1.
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), "backups");
const BACKUP_KEEP = Math.max(1, parseInt(process.env.BACKUP_KEEP || "14", 10) || 14);
const BACKUP_INTERVAL_HOURS = Math.max(1, parseInt(process.env.BACKUP_INTERVAL_HOURS || "24", 10) || 24);

function runDbBackup(dbHandle: Database): void {
  if (process.env.BACKUP_DISABLED === "1") return;
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(BACKUP_DIR, `data-${stamp}.db`);
    // Online backup: consistent snapshot even under concurrent writes.
    // better-sqlite3 exposes .backup() which returns a promise; run it fire-and-forget
    // but log the outcome. Falls back to a checkpointed file copy if unavailable.
    const anyDb = dbHandle as any;
    if (typeof anyDb.backup === "function") {
      anyDb.backup(dest)
        .then(() => {
          console.log("[storage] DB backup written: " + dest);
          pruneBackups();
        })
        .catch((err: any) => console.warn("[storage] DB backup failed (non-fatal):", err));
    } else {
      dbHandle.pragma("wal_checkpoint(TRUNCATE)");
      fs.copyFileSync(DB_PATH, dest);
      console.log("[storage] DB backup (copy) written: " + dest);
      pruneBackups();
    }
  } catch (e) {
    console.warn("[storage] DB backup failed (non-fatal):", e);
  }
}

function pruneBackups(): void {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => /^data-.*\.db$/.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of files.slice(BACKUP_KEEP)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old.f));
      console.log("[storage] Pruned old backup: " + old.f);
    }
  } catch (e) {
    console.warn("[storage] Backup prune failed (non-fatal):", e);
  }
}

// ── PRAGMA hardening ─────────────────────────────────────────────────────────
sqlite.pragma("journal_mode = WAL");   // concurrent reads + writes
sqlite.pragma("foreign_keys = ON");    // referential integrity
sqlite.pragma("busy_timeout = 5000"); // wait up to 5s on lock instead of crashing

// Kick off automatic backups: one shortly after boot, then on a fixed interval.
if (process.env.BACKUP_DISABLED !== "1") {
  setTimeout(() => runDbBackup(sqlite), 10_000); // 10s after boot, once tables exist
  const intervalMs = BACKUP_INTERVAL_HOURS * 60 * 60 * 1000;
  const timer = setInterval(() => runDbBackup(sqlite), intervalMs);
  if (typeof (timer as any).unref === "function") (timer as any).unref();
  console.log(`[storage] Automatic backups on: every ${BACKUP_INTERVAL_HOURS}h, keeping ${BACKUP_KEEP}, dir=${BACKUP_DIR}`);
}

// Create all tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'customer',
    email TEXT,
    phone TEXT,
    address TEXT,
    company TEXT,
    referral_rate REAL,
    notes TEXT,
    portal_pin TEXT,
    parent_company_id INTEGER,
    is_referral_company INTEGER
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_number TEXT NOT NULL,
    contact_id INTEGER,
    loss_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    address TEXT,
    description TEXT,
    assigned_tech TEXT,
    insurance_carrier TEXT,
    claim_number TEXT,
    adjuster_name TEXT,
    adjuster_phone TEXT,
    adjuster_email TEXT,
    policy_number TEXT,
    mitigation_start TEXT,
    dry_out_complete TEXT,
    reconstruction_start TEXT,
    job_complete TEXT,
    partner_payout_applied REAL,
    partner_payout_date TEXT,
    notes TEXT DEFAULT '[]',
    -- Close / reopen tracking (see shared/schema.ts for details)
    previous_status TEXT,
    closed_at TEXT,
    closed_by TEXT,
    closed_reason TEXT,
    reopened_at TEXT,
    reopened_by TEXT,
    year_built INTEGER,
    square_feet INTEGER,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS estimates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    line_items TEXT NOT NULL DEFAULT '[]',
    subtotal REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    total REAL DEFAULT 0,
    notes TEXT,
    rebuttal_text TEXT,
    carrier_adjustment REAL,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    contact_id INTEGER,
    invoice_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    line_items TEXT NOT NULL DEFAULT '[]',
    subtotal REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    total REAL DEFAULT 0,
    due_date TEXT,
    paid_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER,
    job_id INTEGER,
    contact_id INTEGER,
    type TEXT NOT NULL DEFAULT 'received',
    amount REAL NOT NULL,
    method TEXT,
    reference TEXT,
    notes TEXT,
    paid_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    data_url TEXT NOT NULL,
    caption TEXT,
    category TEXT DEFAULT 'general',
    taken_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS customer_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    contact_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    author_name TEXT,
    body TEXT NOT NULL,
    read_by_staff INTEGER DEFAULT 0,
    read_by_customer INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder TEXT NOT NULL DEFAULT 'inbox',
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    tech_name TEXT NOT NULL,
    shift_date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    title TEXT,
    notes TEXT,
    notification_sent INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS payout_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL,
    method TEXT NOT NULL,
    handle TEXT,
    is_default INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS payout_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL,
    job_id INTEGER,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payout_method_id INTEGER,
    description TEXT,
    admin_notes TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS portal_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL,
    session_token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS drying_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    reading_date TEXT NOT NULL,
    reading_time TEXT,
    tech_name TEXT NOT NULL,
    day_number INTEGER DEFAULT 1,
    water_category TEXT NOT NULL DEFAULT 'category1',
    water_class TEXT NOT NULL DEFAULT 'class2',
    moisture_readings TEXT NOT NULL DEFAULT '[]',
    temp_f REAL,
    rh_pct REAL,
    gpp REAL,
    dew_point_f REAL,
    specific_humidity REAL,
    psychrometric_readings TEXT NOT NULL DEFAULT '[]',
    equipment TEXT NOT NULL DEFAULT '[]',
    affected_areas TEXT NOT NULL DEFAULT '[]',
    drying_goal_met INTEGER DEFAULT 0,
    structural_drying_complete INTEGER DEFAULT 0,
    observations TEXT,
    tech_signature TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'tech',
    gmail_email TEXT,
    phone TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS job_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    doc_type TEXT NOT NULL,
    title TEXT NOT NULL,
    form_data TEXT,
    signature_data TEXT,
    signer_name TEXT,
    signer_role TEXT,
    signed_at TEXT,
    file_data TEXT,
    file_name TEXT,
    file_mime_type TEXT,
    file_size INTEGER,
    status TEXT NOT NULL DEFAULT 'unsigned',
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS job_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    action TEXT NOT NULL,        -- e.g. 'closed', 'reopened'
    actor_name TEXT,             -- employee name from the auth session
    details TEXT,                -- JSON blob for action-specific context
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, created_at DESC);
`);

// ── New tables ────────────────────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    serial_number TEXT,
    model TEXT,
    daily_rate REAL DEFAULT 0,
    status TEXT DEFAULT 'available',
    current_job_id INTEGER,
    deployed_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS equipment_deployments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipment_id INTEGER NOT NULL,
    job_id INTEGER NOT NULL,
    deployed_at TEXT NOT NULL,
    returned_at TEXT,
    days_out INTEGER,
    billed_amount REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS job_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    quantity REAL DEFAULT 1,
    unit_cost REAL DEFAULT 0,
    total REAL DEFAULT 0,
    vendor TEXT,
    receipt_ref TEXT,
    entered_by TEXT,
    cost_date TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS supplements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    amount_requested REAL DEFAULT 0,
    amount_approved REAL,
    carrier TEXT,
    adjuster_name TEXT,
    submitted_at TEXT,
    response_at TEXT,
    follow_up_due TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    line_items TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS follow_up_sequences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    contact_id INTEGER NOT NULL,
    sequence_type TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    sent_at TEXT,
    status TEXT DEFAULT 'pending',
    email_subject TEXT,
    email_body TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS safety_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    incident_type TEXT NOT NULL,
    severity TEXT DEFAULT 'low',
    reported_by TEXT NOT NULL,
    incident_date TEXT NOT NULL,
    description TEXT NOT NULL,
    persons_involved TEXT,
    corrective_action TEXT,
    osha_recordable INTEGER DEFAULT 0,
    follow_up_date TEXT,
    closed_at TEXT,
    status TEXT DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS line_item_library (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    sub_category TEXT,
    code TEXT NOT NULL,
    description TEXT NOT NULL,
    unit TEXT NOT NULL,
    unit_price REAL NOT NULL,
    iicrc_ref TEXT,
    notes TEXT,
    is_custom INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS adjusters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    carrier TEXT NOT NULL,
    territory TEXT,
    email TEXT,
    phone TEXT,
    preferred_contact TEXT DEFAULT 'email',
    notes TEXT,
    claims_count INTEGER DEFAULT 0,
    avg_pay_days REAL,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS adjuster_meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    adjuster_id INTEGER,
    adjuster_name TEXT,
    meeting_date TEXT NOT NULL,
    meeting_time TEXT,
    location TEXT,
    purpose TEXT DEFAULT 'walkthrough',
    outcome TEXT,
    follow_up_required INTEGER DEFAULT 0,
    confirmation_sent INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS inspection_checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    inspected_by TEXT NOT NULL,
    inspection_date TEXT NOT NULL,
    moisture_readings TEXT DEFAULT '[]',
    pre_existing_damage TEXT DEFAULT '[]',
    scope_items TEXT DEFAULT '[]',
    checklist_items TEXT DEFAULT '[]',
    general_notes TEXT,
    signed_by TEXT,
    signature_data TEXT,
    signed_at TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS review_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    contact_id INTEGER NOT NULL,
    channel TEXT DEFAULT 'email',
    status TEXT DEFAULT 'pending',
    sent_at TEXT,
    review_url TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS certifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_name TEXT NOT NULL,
    cert_type TEXT NOT NULL,
    cert_number TEXT,
    issued_by TEXT DEFAULT 'IICRC',
    issued_date TEXT,
    expiration_date TEXT,
    status TEXT DEFAULT 'active',
    alert_sent_60 INTEGER DEFAULT 0,
    alert_sent_30 INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
  );
`);

// ── Migrations ────────────────────────────────────────────────────────────
// Add progress pipeline columns to jobs table if they don't exist
const jobCols = (sqlite.prepare("PRAGMA table_info(jobs)").all() as any[]).map((c: any) => c.name);
if (!jobCols.includes("progress_stage")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN progress_stage TEXT DEFAULT 'pending_sale'`);
}
if (!jobCols.includes("sales_date")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN sales_date TEXT`);
}
if (!jobCols.includes("pre_production_date")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN pre_production_date TEXT`);
}
if (!jobCols.includes("wip_date")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN wip_date TEXT`);
}
if (!jobCols.includes("invoice_sent_date")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN invoice_sent_date TEXT`);
}
if (!jobCols.includes("invoice_paid_date")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN invoice_paid_date TEXT`);
}
if (!jobCols.includes("lead_source")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN lead_source TEXT`);
}
if (!jobCols.includes("lead_source_detail")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN lead_source_detail TEXT`);
}
// Division tag: 'mitigation' | 'reconstruction' | 'both'. Used by the owner's
// Weekly Billing report to break profitability down by division (Mit vs Recon).
if (!jobCols.includes("division")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN division TEXT`);
  // Best-effort backfill from phase dates: has reconstruction_start => 'both'
  // (job ran through both mit + recon); otherwise default to 'mitigation'.
  try {
    sqlite.exec(`UPDATE jobs SET division = CASE
      WHEN reconstruction_start IS NOT NULL AND reconstruction_start != '' THEN 'both'
      ELSE 'mitigation' END
      WHERE division IS NULL`);
  } catch (_) {}
}
// Service market/branch: 'Augusta' | 'Columbia'. Backfill best-effort from the
// free-text address (SC or Columbia-area cities => Columbia; else Augusta).
if (!jobCols.includes("location")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN location TEXT`);
  try {
    sqlite.exec(`UPDATE jobs SET location = CASE
      WHEN address IS NOT NULL AND (
        lower(address) LIKE '%columbia%' OR lower(address) LIKE '%, sc%'
        OR lower(address) LIKE '% sc %' OR lower(address) LIKE '%lexington%'
        OR lower(address) LIKE '%irmo%' OR lower(address) LIKE '%chapin%'
        OR lower(address) LIKE '%west columbia%' OR lower(address) LIKE '%cayce%'
        OR lower(address) LIKE '%blythewood%' OR lower(address) LIKE '%northeast%'
      ) THEN 'Columbia'
      ELSE 'Augusta' END
      WHERE location IS NULL`);
  } catch (_) {}
}

// Close / reopen tracking. previous_status captures the phase at close so
// reopen restores the job to exactly where it was. closed_at/closed_by/
// closed_reason are set on close and nulled on reopen; reopened_at/reopened_by
// track the most recent reopen (full history is in the job_events audit log).
if (!jobCols.includes("previous_status")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN previous_status TEXT`);
}
if (!jobCols.includes("closed_at")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN closed_at TEXT`);
}
if (!jobCols.includes("closed_by")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN closed_by TEXT`);
}
if (!jobCols.includes("closed_reason")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN closed_reason TEXT`);
}
if (!jobCols.includes("reopened_at")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN reopened_at TEXT`);
}
if (!jobCols.includes("reopened_by")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN reopened_by TEXT`);
}
// Year the property was built — captured at intake so the AI lead/asbestos
// check (server/routes_aiagent.ts) can flag EPA RRP risk without a separate
// hazmat_flags lookup. Auto-prefilled from /api/property-lookup.
if (!jobCols.includes("year_built")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN year_built INTEGER`);
}
// Approx living area in square feet (from OSM building footprint * levels).
if (!jobCols.includes("square_feet")) {
  sqlite.exec(`ALTER TABLE jobs ADD COLUMN square_feet INTEGER`);
}

// Invoice settlement / insurance-reduction tracking (idempotent migration).
// original_total  = amount originally invoiced before any carrier reduction
// adjustment      = dollar reduction agreed at settlement (positive number)
// adjustment_reason = why the amount was reduced (e.g. depreciation, carrier settlement)
const invoiceCols = (sqlite.prepare("PRAGMA table_info(invoices)").all() as any[]).map((c: any) => c.name);
if (!invoiceCols.includes("original_total")) {
  sqlite.exec(`ALTER TABLE invoices ADD COLUMN original_total REAL`);
}
if (!invoiceCols.includes("adjustment")) {
  sqlite.exec(`ALTER TABLE invoices ADD COLUMN adjustment REAL DEFAULT 0`);
}
if (!invoiceCols.includes("adjustment_reason")) {
  sqlite.exec(`ALTER TABLE invoices ADD COLUMN adjustment_reason TEXT`);
}

// Phase tag ('mitigation' | 'reconstruction') on job child records so the
// JobDetail phase switch can show a separate data set per phase. Idempotent:
// existing rows default to 'mitigation'.
if (!invoiceCols.includes("phase")) {
  sqlite.exec(`ALTER TABLE invoices ADD COLUMN phase TEXT DEFAULT 'mitigation'`);
}
const estimatePhaseCols = (sqlite.prepare("PRAGMA table_info(estimates)").all() as any[]).map((c: any) => c.name);
if (!estimatePhaseCols.includes("phase")) {
  sqlite.exec(`ALTER TABLE estimates ADD COLUMN phase TEXT DEFAULT 'mitigation'`);
}
// Referral company hierarchy: a referral tech can belong to a parent referral company.
const contactParentCols = (sqlite.prepare("PRAGMA table_info(contacts)").all() as any[]).map((c: any) => c.name);
if (!contactParentCols.includes("parent_company_id")) {
  sqlite.exec(`ALTER TABLE contacts ADD COLUMN parent_company_id INTEGER`);
}
if (!contactParentCols.includes("is_referral_company")) {
  sqlite.exec(`ALTER TABLE contacts ADD COLUMN is_referral_company INTEGER`);
}
const photoPhaseCols = (sqlite.prepare("PRAGMA table_info(photos)").all() as any[]).map((c: any) => c.name);
if (!photoPhaseCols.includes("phase")) {
  sqlite.exec(`ALTER TABLE photos ADD COLUMN phase TEXT DEFAULT 'mitigation'`);
}
// AR follow-up engine: legacy tables shipped with trigger_days/channel/is_active,
// but the AR Follow-Up Engine routes expect days_threshold/action/assignee.
// Reconcile non-destructively by adding any missing columns to the existing table.
try { sqlite.exec(`CREATE TABLE IF NOT EXISTS ar_followup_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, days_threshold INTEGER NOT NULL DEFAULT 0, action TEXT NOT NULL DEFAULT '', message_template TEXT, assignee TEXT, created_at TEXT DEFAULT '')`); } catch (_) {}
const arRuleCols = (sqlite.prepare("PRAGMA table_info(ar_followup_rules)").all() as any[]).map((c: any) => c.name);
if (!arRuleCols.includes("days_threshold")) {
  sqlite.exec(`ALTER TABLE ar_followup_rules ADD COLUMN days_threshold INTEGER NOT NULL DEFAULT 0`);
  // Backfill from the legacy trigger_days column when present.
  if (arRuleCols.includes("trigger_days")) {
    try { sqlite.exec(`UPDATE ar_followup_rules SET days_threshold = trigger_days WHERE days_threshold = 0`); } catch (_) {}
  }
}
if (!arRuleCols.includes("action")) {
  sqlite.exec(`ALTER TABLE ar_followup_rules ADD COLUMN action TEXT NOT NULL DEFAULT 'reminder'`);
  if (arRuleCols.includes("channel")) {
    try { sqlite.exec(`UPDATE ar_followup_rules SET action = channel WHERE action = 'reminder'`); } catch (_) {}
  }
}
if (!arRuleCols.includes("assignee")) {
  sqlite.exec(`ALTER TABLE ar_followup_rules ADD COLUMN assignee TEXT`);
}
const jobDocPhaseCols = (sqlite.prepare("PRAGMA table_info(job_documents)").all() as any[]).map((c: any) => c.name);
if (!jobDocPhaseCols.includes("phase")) {
  sqlite.exec(`ALTER TABLE job_documents ADD COLUMN phase TEXT DEFAULT 'mitigation'`);
}
const jobCostPhaseCols = (sqlite.prepare("PRAGMA table_info(job_costs)").all() as any[]).map((c: any) => c.name);
if (!jobCostPhaseCols.includes("phase")) {
  sqlite.exec(`ALTER TABLE job_costs ADD COLUMN phase TEXT DEFAULT 'mitigation'`);
}

// Drying-record multi-location psychrometrics (Inside / Outside / Affected Area).
// Stored as JSON array of { location, tempF, rhPct, gpp, dewPointF } so the tech
// can log all three locations per visit. Legacy tempF/rhPct columns remain and
// mirror the Inside slot for back-compat with existing reports, PDFs, and the
// moisture-alert check that still keys off ambient temp/RH.
const dryingCols = (sqlite.prepare("PRAGMA table_info(drying_records)").all() as any[]).map((c: any) => c.name);
if (!dryingCols.includes("psychrometric_readings")) {
  sqlite.exec(`ALTER TABLE drying_records ADD COLUMN psychrometric_readings TEXT NOT NULL DEFAULT '[]'`);
}

// ── Object storage columns ────────────────────────────────────────────────
// Backfill storage_key columns onto every table that previously held image
// or file blobs as base64 data URLs. When Railway object storage is
// configured, new uploads populate storage_key and data_url stays empty;
// legacy rows still work because reads fall back to data_url.
const photoCols2 = (sqlite.prepare("PRAGMA table_info(photos)").all() as any[]).map((c: any) => c.name);
if (!photoCols2.includes("storage_key")) {
  sqlite.exec(`ALTER TABLE photos ADD COLUMN storage_key TEXT`);
}

// Notification bell: employee_id + link columns on tech_notifications so we
// can target any user by ID (not just tech_name) and deep-link the alert to
// a job / estimate / invoice page.
const techNotifCols = (sqlite.prepare("PRAGMA table_info(tech_notifications)").all() as any[]).map((c: any) => c.name);
if (!techNotifCols.includes("employee_id")) {
  sqlite.exec(`ALTER TABLE tech_notifications ADD COLUMN employee_id INTEGER`);
}
if (!techNotifCols.includes("link")) {
  sqlite.exec(`ALTER TABLE tech_notifications ADD COLUMN link TEXT`);
}
// Index for the hot query on the bell (unread for a specific employee).
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_tech_notif_emp_read ON tech_notifications(employee_id, read)`);

// Photo enrichment migration — EXIF + room + annotations + damage class +
// voice + AI-classification flag. All nullable so legacy photos load fine.
const photoCols3 = (sqlite.prepare("PRAGMA table_info(photos)").all() as any[]).map((c: any) => c.name);
const photoAdditions: [string, string][] = [
  ["latitude", "TEXT"],
  ["longitude", "TEXT"],
  ["original_taken_at", "TEXT"],
  ["device_make", "TEXT"],
  ["device_model", "TEXT"],
  ["room", "TEXT"],
  ["damage_type", "TEXT"],
  ["severity", "TEXT"],
  ["ai_classified", "INTEGER DEFAULT 0"],
  ["annotations_json", "TEXT"],
  ["voice_note_url", "TEXT"],
  ["voice_note_transcript", "TEXT"],
  ["floor_plan_room_id", "TEXT"],
];
for (const [col, type] of photoAdditions) {
  if (!photoCols3.includes(col)) sqlite.exec(`ALTER TABLE photos ADD COLUMN ${col} ${type}`);
}
// Hot indexes for the cross-job photo search page.
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_photos_job ON photos(job_id)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_photos_room ON photos(room)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_photos_damage ON photos(damage_type)`);

// Public share tokens table for photo reports (no login required to view).
sqlite.exec(`CREATE TABLE IF NOT EXISTS photo_share_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  job_id INTEGER NOT NULL,
  template TEXT NOT NULL DEFAULT 'adjuster',
  photo_ids TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  view_count INTEGER DEFAULT 0,
  last_viewed_at TEXT,
  revoked INTEGER DEFAULT 0
)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_share_tokens_token ON photo_share_tokens(token)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_share_tokens_job ON photo_share_tokens(job_id)`);

// Floor plans: one row per job holding a JSON sketch. Kept intentionally
// schemaless (`plan_json`) so we can iterate the sketch shape without more
// ALTER TABLEs. UNIQUE(job_id) enforces one plan per job — upserts overwrite.
sqlite.exec(`CREATE TABLE IF NOT EXISTS floor_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL UNIQUE,
  plan_json TEXT NOT NULL DEFAULT '{"rooms":[]}',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT
)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_photos_floor_room ON photos(floor_plan_room_id)`);
// data_url on photos was declared NOT NULL originally; SQLite can't drop that
// constraint in place, so we simply write empty string when the file lives in
// the bucket and the existing NOT NULL check passes.

const docCols = (sqlite.prepare("PRAGMA table_info(job_documents)").all() as any[]).map((c: any) => c.name);
if (!docCols.includes("storage_key")) {
  sqlite.exec(`ALTER TABLE job_documents ADD COLUMN storage_key TEXT`);
}
if (!docCols.includes("signature_storage_key")) {
  // Signatures on e-signed forms are also base64 blobs today.
  sqlite.exec(`ALTER TABLE job_documents ADD COLUMN signature_storage_key TEXT`);
}

// safety_checklists.photos_json holds an array of strings today; when the
// bucket is on, each entry becomes { storageKey } instead of a data URL. We
// don't need a new column — the JSON blob is polymorphic.

// ── Migrate legacy inline blobs to object storage ─────────────────────────
// Runs asynchronously on boot so it never blocks server startup. Iterates
// every photo / document row that still has a base64 data URL and no
// storage_key, uploads the bytes to the bucket, then null-outs data_url. Safe
// to interrupt: the next boot picks up where it left off since the loop only
// looks at un-migrated rows.
async function migrateLegacyBlobsToBucket() {
  const s3 = await import("./storage_s3");
  s3.logStatus();
  if (!s3.isConfigured()) {
    console.log("[storage] SKIPPING blob migration — object storage NOT configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY on the Railway service.");
    return;
  }
  console.log("[storage] starting legacy blob → bucket migration");
  let photoCount = 0;
  let docCount = 0;

  try {
    const photoRows = sqlite
      .prepare("SELECT id, data_url FROM photos WHERE (storage_key IS NULL OR storage_key = '') AND data_url LIKE 'data:%'")
      .all() as Array<{ id: number; data_url: string }>;
    for (const row of photoRows) {
      const parsed = s3.parseDataUrl(row.data_url);
      if (!parsed) continue;
      const key = s3.makeKey("photos", parsed.extension);
      await s3.putObject(key, parsed.buffer, parsed.contentType);
      sqlite
        .prepare("UPDATE photos SET storage_key = ?, data_url = '' WHERE id = ?")
        .run(key, row.id);
      photoCount++;
    }
  } catch (e) {
    console.error("[storage] photo migration error:", (e as any)?.message || e);
  }

  try {
    const docRows = sqlite
      .prepare("SELECT id, file_data FROM job_documents WHERE (storage_key IS NULL OR storage_key = '') AND file_data LIKE 'data:%'")
      .all() as Array<{ id: number; file_data: string }>;
    for (const row of docRows) {
      const parsed = s3.parseDataUrl(row.file_data);
      if (!parsed) continue;
      const key = s3.makeKey("documents", parsed.extension);
      await s3.putObject(key, parsed.buffer, parsed.contentType);
      sqlite
        .prepare("UPDATE job_documents SET storage_key = ?, file_data = '' WHERE id = ?")
        .run(key, row.id);
      docCount++;
    }
  } catch (e) {
    console.error("[storage] document migration error:", (e as any)?.message || e);
  }

  if (photoCount || docCount) {
    console.log(`[storage] migrated ${photoCount} photos and ${docCount} documents to bucket`);
  } else {
    console.log("[storage] no legacy blobs to migrate");
  }
}

// Fire and forget — do NOT await, and do NOT block startup on it. Individual
// row failures are swallowed above.
setTimeout(() => {
  migrateLegacyBlobsToBucket().catch((e) =>
    console.error("[storage] migration failed:", e?.message || e)
  );
}, 3000);

// One-time phase demo backfill for job 2 (fire loss — runs through BOTH mitigation
// and reconstruction). On databases seeded before phase support existed, job 2
// has only mitigation records, so the phase switch has nothing to show on the
// reconstruction side. This idempotently adds the reconstruction estimate,
// invoice, and per-phase job costs if they are not already present. Guarded by
// existence checks so it never duplicates on restart or redeploy.
try {
  const job2 = sqlite.prepare("SELECT id FROM jobs WHERE job_number = 'TP-2026-002'").get() as { id: number } | undefined;
  if (job2) {
    const nowISO = new Date().toISOString();
    const hasReconEst = sqlite.prepare("SELECT COUNT(*) c FROM estimates WHERE job_id = ? AND phase = 'reconstruction'").get(job2.id) as { c: number };
    if (hasReconEst.c === 0) {
      sqlite.prepare(`INSERT INTO estimates (job_id, title, status, line_items, subtotal, total, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(job2.id, "Fire – Reconstruction Estimate", "sent", JSON.stringify([{id:1,description:"Kitchen Cabinetry – Rebuild",category:"reconstruction",qty:1,unit:"LS",unitPrice:8500,total:8500},{id:2,description:"Drywall Replacement & Finish",category:"reconstruction",qty:1400,unit:"SF",unitPrice:2.75,total:3850},{id:3,description:"Paint – 3 Rooms",category:"finish",qty:1,unit:"LS",unitPrice:2200,total:2200},{id:4,description:"Flooring – LVP Install",category:"flooring",qty:650,unit:"SF",unitPrice:6.5,total:4225}]), 18775, 18775, "reconstruction", nowISO);
    }
    const hasReconInv = sqlite.prepare("SELECT COUNT(*) c FROM invoices WHERE job_id = ? AND phase = 'reconstruction'").get(job2.id) as { c: number };
    if (hasReconInv.c === 0) {
      const contact = sqlite.prepare("SELECT contact_id FROM jobs WHERE id = ?").get(job2.id) as { contact_id: number } | undefined;
      sqlite.prepare(`INSERT INTO invoices (job_id, contact_id, invoice_number, status, line_items, subtotal, total, due_date, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(job2.id, contact?.contact_id ?? null, "INV-2026-003", "draft", JSON.stringify([{description:"Fire Reconstruction – Rebuild",qty:1,unitPrice:18775,total:18775}]), 18775, 18775, "2026-08-30", "reconstruction", nowISO);
    }
    const hasCosts = sqlite.prepare("SELECT COUNT(*) c FROM job_costs WHERE job_id = ?").get(job2.id) as { c: number };
    if (hasCosts.c === 0) {
      const addCost = sqlite.prepare(`INSERT INTO job_costs (job_id, category, description, quantity, unit_cost, total, vendor, cost_date, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      addCost.run(job2.id, "labor", "Soot cleaning crew", 24, 45, 1080, "In-house", "2026-07-03", "mitigation", nowISO);
      addCost.run(job2.id, "material", "Cleaning chemicals & PPE", 1, 420, 420, "Supply Co", "2026-07-03", "mitigation", nowISO);
      addCost.run(job2.id, "subcontractor", "All-Pro Flooring – LVP install", 1, 2600, 2600, "All-Pro Flooring", "2026-08-10", "reconstruction", nowISO);
      addCost.run(job2.id, "material", "Cabinetry & drywall materials", 1, 6200, 6200, "Building Supply", "2026-08-08", "reconstruction", nowISO);
      addCost.run(job2.id, "labor", "Reconstruction crew – framing & finish", 40, 48, 1920, "In-house", "2026-08-12", "reconstruction", nowISO);
    }
  }
} catch (e) {
  console.error("[storage] phase demo backfill skipped:", e);
}

// ── Seed data ──────────────────────────────────────────────────────────────
function seed() {
  const count = sqlite.prepare("SELECT COUNT(*) as c FROM contacts").get() as { c: number };
  if (count.c > 0) return;

  const now = new Date().toISOString();

  // Contacts
  sqlite.prepare(`INSERT INTO contacts (name, type, email, phone, address, company, referral_rate, portal_pin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("Robert & Linda Hayes", "customer", "hayes@email.com", "706-555-0101", "1204 Riverwatch Pkwy, Augusta, GA 30901", null, null, "1234");
  sqlite.prepare(`INSERT INTO contacts (name, type, email, phone, address, company, referral_rate, portal_pin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("Marcus Thornton", "customer", "mthornton@email.com", "706-555-0202", "312 Columbia Rd, Martinez, GA 30907", null, null, "2345");
  sqlite.prepare(`INSERT INTO contacts (name, type, email, phone, address, company, referral_rate, portal_pin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("Brenda Simmons", "customer", "bsimmons@email.com", "706-555-0303", "5518 Wrightsboro Rd, Evans, GA 30809", null, null, "3456");
  sqlite.prepare(`INSERT INTO contacts (name, type, email, phone, address, company, referral_rate, portal_pin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("Peak Drying Solutions", "sub", "dispatch@peakdrying.com", "706-555-0401", "Augusta, GA", "Peak Drying Solutions", null, null);
  sqlite.prepare(`INSERT INTO contacts (name, type, email, phone, address, company, referral_rate, portal_pin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("All-Pro Flooring", "sub", "info@allproflooring.com", "706-555-0402", "Augusta, GA", "All-Pro Flooring", null, null);
  sqlite.prepare(`INSERT INTO contacts (name, type, email, phone, address, company, referral_rate, portal_pin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("Tom Bradley", "referral", "tbradley@statefarm.com", "706-555-0501", "Augusta, GA", "State Farm", 5, null);
  sqlite.prepare(`INSERT INTO contacts (name, type, email, phone, address, company, referral_rate, portal_pin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("Janet Wu", "referral", "jwu@nationwide.com", "706-555-0502", "Augusta, GA", "Nationwide", 4, null);

  // Jobs
  sqlite.prepare(`INSERT INTO jobs (job_number, contact_id, loss_type, status, address, description, assigned_tech, insurance_carrier, claim_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("TP-2026-001", 1, "water", "mitigation", "1204 Riverwatch Pkwy, Augusta, GA 30901", "Burst pipe in master bathroom – Category 2 water loss, approx 800 sq ft affected.", "John", "State Farm", "SF-2026-44821", now);
  sqlite.prepare(`INSERT INTO jobs (job_number, contact_id, loss_type, status, address, description, assigned_tech, insurance_carrier, claim_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("TP-2026-002", 2, "fire", "reconstruction", "312 Columbia Rd, Martinez, GA 30907", "Kitchen fire – smoke/soot damage to 3 rooms, structural damage to kitchen.", "Mason", "Nationwide", "NW-2026-11092", now);
  sqlite.prepare(`INSERT INTO jobs (job_number, contact_id, loss_type, status, address, description, assigned_tech, insurance_carrier, claim_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("TP-2026-003", 3, "storm", "new", "5518 Wrightsboro Rd, Evans, GA 30809", "Hail damage to roof, interior water intrusion through damaged flashing.", "Clint", "Allstate", "AL-2026-77345", now);

  // Estimates
  sqlite.prepare(`INSERT INTO estimates (job_id, title, status, line_items, subtotal, total, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(1, "Water Mitigation Estimate", "approved", JSON.stringify([{id:1,description:"Emergency Response/Mobilization",category:"mitigation",qty:1,unit:"LS",unitPrice:450,total:450},{id:2,description:"Water Extraction – Category 2",category:"extraction",qty:800,unit:"SF",unitPrice:0.45,total:360},{id:3,description:"Structural Drying – LGR Dehumidifier",category:"drying",qty:5,unit:"days",unitPrice:85,total:425},{id:4,description:"Air Mover – Commercial Grade",category:"drying",qty:8,unit:"days",unitPrice:25,total:200},{id:5,description:"Antimicrobial Application",category:"treatment",qty:800,unit:"SF",unitPrice:0.35,total:280}]), 1715, 1715, "mitigation", now);
  // Job 2 (fire) runs through BOTH phases: mitigation cleanup, then reconstruction rebuild.
  sqlite.prepare(`INSERT INTO estimates (job_id, title, status, line_items, subtotal, total, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(2, "Fire – Emergency Mitigation Estimate", "approved", JSON.stringify([{id:1,description:"Emergency Board-Up",category:"emergency",qty:1,unit:"LS",unitPrice:650,total:650},{id:2,description:"Smoke/Soot Cleaning – Walls",category:"cleaning",qty:1200,unit:"SF",unitPrice:1.25,total:1500},{id:3,description:"Odor Removal – Hydroxyl Treatment",category:"odor",qty:3,unit:"days",unitPrice:275,total:825},{id:4,description:"Contents Pack-Out",category:"contents",qty:1,unit:"LS",unitPrice:1200,total:1200}]), 4175, 4175, "mitigation", now);
  sqlite.prepare(`INSERT INTO estimates (job_id, title, status, line_items, subtotal, total, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(2, "Fire – Reconstruction Estimate", "sent", JSON.stringify([{id:1,description:"Kitchen Cabinetry – Rebuild",category:"reconstruction",qty:1,unit:"LS",unitPrice:8500,total:8500},{id:2,description:"Drywall Replacement & Finish",category:"reconstruction",qty:1400,unit:"SF",unitPrice:2.75,total:3850},{id:3,description:"Paint – 3 Rooms",category:"finish",qty:1,unit:"LS",unitPrice:2200,total:2200},{id:4,description:"Flooring – LVP Install",category:"flooring",qty:650,unit:"SF",unitPrice:6.5,total:4225}]), 18775, 18775, "reconstruction", now);

  // Invoices
  sqlite.prepare(`INSERT INTO invoices (job_id, contact_id, invoice_number, status, line_items, subtotal, total, due_date, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(1, 1, "INV-2026-001", "sent", JSON.stringify([{description:"Water Mitigation Services",qty:1,unitPrice:1715,total:1715}]), 1715, 1715, "2026-07-15", "mitigation", now);
  sqlite.prepare(`INSERT INTO invoices (job_id, contact_id, invoice_number, status, line_items, subtotal, total, due_date, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(2, 2, "INV-2026-002", "sent", JSON.stringify([{description:"Fire Damage Mitigation",qty:1,unitPrice:4175,total:4175}]), 4175, 4175, "2026-07-20", "mitigation", now);
  sqlite.prepare(`INSERT INTO invoices (job_id, contact_id, invoice_number, status, line_items, subtotal, total, due_date, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(2, 2, "INV-2026-003", "draft", JSON.stringify([{description:"Fire Reconstruction – Rebuild",qty:1,unitPrice:18775,total:18775}]), 18775, 18775, "2026-08-30", "reconstruction", now);

  // Job Costs (per phase, so profitability splits Mit vs Recon)
  sqlite.prepare(`INSERT INTO job_costs (job_id, category, description, quantity, unit_cost, total, vendor, cost_date, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(1, "labor", "Mitigation crew – 2 techs", 16, 45, 720, "In-house", "2026-07-02", "mitigation", now);
  sqlite.prepare(`INSERT INTO job_costs (job_id, category, description, quantity, unit_cost, total, vendor, cost_date, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(1, "equipment", "LGR Dehu + air movers rental", 5, 60, 300, "Peak Drying", "2026-07-02", "mitigation", now);
  sqlite.prepare(`INSERT INTO job_costs (job_id, category, description, quantity, unit_cost, total, vendor, cost_date, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(2, "labor", "Soot cleaning crew", 24, 45, 1080, "In-house", "2026-07-03", "mitigation", now);
  sqlite.prepare(`INSERT INTO job_costs (job_id, category, description, quantity, unit_cost, total, vendor, cost_date, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(2, "material", "Cleaning chemicals & PPE", 1, 420, 420, "Supply Co", "2026-07-03", "mitigation", now);
  sqlite.prepare(`INSERT INTO job_costs (job_id, category, description, quantity, unit_cost, total, vendor, cost_date, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(2, "subcontractor", "All-Pro Flooring – LVP install", 1, 2600, 2600, "All-Pro Flooring", "2026-08-10", "reconstruction", now);
  sqlite.prepare(`INSERT INTO job_costs (job_id, category, description, quantity, unit_cost, total, vendor, cost_date, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(2, "material", "Cabinetry & drywall materials", 1, 6200, 6200, "Building Supply", "2026-08-08", "reconstruction", now);
  sqlite.prepare(`INSERT INTO job_costs (job_id, category, description, quantity, unit_cost, total, vendor, cost_date, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(2, "labor", "Reconstruction crew – framing & finish", 40, 48, 1920, "In-house", "2026-08-12", "reconstruction", now);

  // Channels
  sqlite.prepare(`INSERT INTO channels (name, description, created_at) VALUES (?, ?, ?)`).run("general", "Company-wide announcements", now);
  sqlite.prepare(`INSERT INTO channels (name, description, created_at) VALUES (?, ?, ?)`).run("field-ops", "Field technician coordination", now);
  sqlite.prepare(`INSERT INTO channels (name, description, created_at) VALUES (?, ?, ?)`).run("estimating", "Estimate reviews and approvals", now);
  sqlite.prepare(`INSERT INTO channels (name, description, created_at) VALUES (?, ?, ?)`).run("insurance", "Insurance carrier negotiations", now);
  sqlite.prepare(`INSERT INTO channels (name, description, created_at) VALUES (?, ?, ?)`).run("aug", "Augusta, GA market — post new jobs here", now);
  sqlite.prepare(`INSERT INTO channels (name, description, created_at) VALUES (?, ?, ?)`).run("cola", "Columbia, SC market — post new jobs here", now);

  // Messages
  sqlite.prepare(`INSERT INTO messages (channel_id, author, body, created_at) VALUES (?, ?, ?, ?)`).run(1, "Cody Brantley", "Good morning team! Big week ahead — let's crush it.", now);
  sqlite.prepare(`INSERT INTO messages (channel_id, author, body, created_at) VALUES (?, ?, ?, ?)`).run(2, "John", "On site at Hayes job. Starting water extraction now.", now);
  sqlite.prepare(`INSERT INTO messages (channel_id, author, body, created_at) VALUES (?, ?, ?, ?)`).run(2, "Mason", "Heading to Thornton job for soot cleaning.", now);

  // Emails
  sqlite.prepare(`INSERT INTO emails (folder, "from", "to", subject, body, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run("inbox", "tbradley@statefarm.com", "cody@titanrestorationllc.com", "RE: Hayes Claim SF-2026-44821", "Hi Cody, I reviewed the estimate for the Hayes claim. The adjuster approved the mitigation scope. Please proceed and send the final invoice once complete.\n\nBest,\nTom Bradley\nState Farm Agent", 0, now);
  sqlite.prepare(`INSERT INTO emails (folder, "from", "to", subject, body, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run("inbox", "claims@nationwide.com", "cody@titanrestorationllc.com", "Supplement Request – NW-2026-11092", "Mr. Brantley,\n\nWe have reviewed your supplement request for the Thornton fire claim. Our adjuster is requesting additional documentation for the contents pack-out line item.\n\nPlease provide photos and itemized list.", 0, now);
  sqlite.prepare(`INSERT INTO emails (folder, "from", "to", subject, body, read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run("sent", "cody@titanrestorationllc.com", "tbradley@statefarm.com", "Titan Restoration – Referral Thank You", "Hi Tom,\n\nJust wanted to thank you for the referral on the Hayes job. We really appreciate your continued partnership.\n\nWe're also available for any emergency losses your clients may experience.\n\nBest,\nCody Brantley\nTitan Restoration LLC | 706-922-0154", 1, now);

  // Shifts
  sqlite.prepare(`INSERT INTO shifts (job_id, tech_name, shift_date, start_time, end_time, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(1, "John", "2026-07-01", "07:00", "15:00", "Water Extraction & Equipment Setup", now);
  sqlite.prepare(`INSERT INTO shifts (job_id, tech_name, shift_date, start_time, end_time, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(2, "Mason", "2026-07-01", "08:00", "16:00", "Soot Cleaning Day 1", now);
  sqlite.prepare(`INSERT INTO shifts (job_id, tech_name, shift_date, start_time, end_time, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(3, "Clint", "2026-07-02", "07:00", "15:00", "Storm Damage Assessment", now);

  // Employees
  sqlite.prepare(`INSERT INTO employees (name, role, phone, created_at) VALUES (?, ?, ?, ?)`).run("Cody Brantley", "owner", "706-922-0154", now);
  sqlite.prepare(`INSERT INTO employees (name, role, created_at) VALUES (?, ?, ?)`).run("John", "tech", now);
  sqlite.prepare(`INSERT INTO employees (name, role, created_at) VALUES (?, ?, ?)`).run("Mason", "tech", now);
  sqlite.prepare(`INSERT INTO employees (name, role, created_at) VALUES (?, ?, ?)`).run("Clint", "tech", now);
  sqlite.prepare(`INSERT INTO employees (name, role, created_at) VALUES (?, ?, ?)`).run("Blake", "tech", now);
  sqlite.prepare(`INSERT INTO employees (name, role, created_at) VALUES (?, ?, ?)`).run("Blake Foster", "tech", now);
}

seed();

// ── Storage interface ─────────────────────────────────────────────────────────
export interface IStorage {
  // Contacts
  getContacts(): schema.Contact[];
  getContact(id: number): schema.Contact | undefined;
  createContact(data: schema.InsertContact): schema.Contact;
  updateContact(id: number, data: Partial<schema.InsertContact>): schema.Contact | undefined;
  deleteContact(id: number): void;

  // Jobs — getJobs() excludes closed jobs by default. Use getClosedJobs() or
  // pass includeClosed=true when you need everything (e.g. financial history).
  getJobs(includeClosed?: boolean): schema.Job[];
  getClosedJobs(): schema.Job[];
  getJob(id: number): schema.Job | undefined;
  createJob(data: schema.InsertJob): schema.Job;
  updateJob(id: number, data: Partial<schema.InsertJob>): schema.Job | undefined;
  deleteJob(id: number): void;
  closeJob(id: number, closedBy: string, reason?: string): schema.Job | undefined;
  reopenJob(id: number, reopenedBy: string): schema.Job | undefined;

  // Estimates
  getEstimates(): schema.Estimate[];
  getEstimate(id: number): schema.Estimate | undefined;
  getEstimatesByJob(jobId: number): schema.Estimate[];
  createEstimate(data: schema.InsertEstimate): schema.Estimate;
  updateEstimate(id: number, data: Partial<schema.InsertEstimate>): schema.Estimate | undefined;
  deleteEstimate(id: number): void;

  // Invoices
  getInvoices(): schema.Invoice[];
  getInvoice(id: number): schema.Invoice | undefined;
  getInvoicesByJob(jobId: number): schema.Invoice[];
  createInvoice(data: schema.InsertInvoice): schema.Invoice;
  updateInvoice(id: number, data: Partial<schema.InsertInvoice>): schema.Invoice | undefined;
  deleteInvoice(id: number): void;

  // Payments
  getPayments(): schema.Payment[];
  createPayment(data: schema.InsertPayment): schema.Payment;

  // Photos
  getPhotos(): schema.Photo[];
  getPhotosByJob(jobId: number): schema.Photo[];
  createPhoto(data: schema.InsertPhoto): schema.Photo;
  deletePhoto(id: number): void;
  getPhoto(id: number): schema.Photo | undefined;
  updatePhoto(id: number, patch: Partial<schema.InsertPhoto>): schema.Photo;
  getFloorPlan(jobId: number): schema.FloorPlan | undefined;
  upsertFloorPlan(jobId: number, planJson: string, updatedBy?: string): schema.FloorPlan;
  createShareToken(row: schema.InsertPhotoShareToken): schema.PhotoShareToken;
  getShareToken(token: string): schema.PhotoShareToken | undefined;
  bumpShareTokenView(token: string): void;
  revokeShareToken(token: string): void;
  listShareTokensForJob(jobId: number): schema.PhotoShareToken[];

  // Channels & Messages
  getChannels(): schema.Channel[];
  getChannel(id: number): schema.Channel | undefined;
  createChannel(data: schema.InsertChannel): schema.Channel;
  getMessages(channelId: number): schema.Message[];
  createMessage(data: schema.InsertMessage): schema.Message;

  // Emails
  getEmails(folder?: string): schema.Email[];
  getEmail(id: number): schema.Email | undefined;
  createEmail(data: schema.InsertEmail): schema.Email;
  updateEmail(id: number, data: Partial<schema.InsertEmail>): schema.Email | undefined;

  // Shifts
  getShifts(): schema.Shift[];
  getShift(id: number): schema.Shift | undefined;
  createShift(data: schema.InsertShift): schema.Shift;
  updateShift(id: number, data: Partial<schema.InsertShift>): schema.Shift | undefined;
  deleteShift(id: number): void;

  // Payout Methods
  getPayoutMethods(contactId?: number): schema.PayoutMethod[];
  createPayoutMethod(data: schema.InsertPayoutMethod): schema.PayoutMethod;
  updatePayoutMethod(id: number, data: Partial<schema.InsertPayoutMethod>): schema.PayoutMethod | undefined;
  deletePayoutMethod(id: number): void;

  // Payout Requests
  getPayoutRequests(contactId?: number): schema.PayoutRequest[];
  getPayoutRequest(id: number): schema.PayoutRequest | undefined;
  createPayoutRequest(data: schema.InsertPayoutRequest): schema.PayoutRequest;
  updatePayoutRequest(id: number, data: Partial<schema.InsertPayoutRequest>): schema.PayoutRequest | undefined;

  // Drying Records
  getDryingRecords(jobId: number): schema.DryingRecord[];
  getDryingRecord(id: number): schema.DryingRecord | undefined;
  createDryingRecord(data: schema.InsertDryingRecord): schema.DryingRecord;
  updateDryingRecord(id: number, data: Partial<schema.InsertDryingRecord>): schema.DryingRecord | undefined;
  deleteDryingRecord(id: number): void;

  // Employees
  getEmployees(): schema.Employee[];
  getEmployeeByName(name: string): schema.Employee | undefined;
  createEmployee(data: schema.InsertEmployee): schema.Employee;
  updateEmployee(id: number, data: Partial<schema.InsertEmployee>): schema.Employee | undefined;

  // Portal
  createPortalSession(data: schema.InsertPortalSession): schema.PortalSession;
  getPortalSessionByToken(token: string): schema.PortalSession | undefined;

  // Job Documents
  getJobDocuments(jobId: number): schema.JobDocument[];
  getJobDocument(id: number): schema.JobDocument | undefined;
  createJobDocument(data: schema.InsertJobDocument): schema.JobDocument;
  updateJobDocument(id: number, data: Partial<schema.InsertJobDocument>): schema.JobDocument | undefined;
  deleteJobDocument(id: number): void;

  // BD Calendar Events
  getBdEvents(): schema.BdEvent[];
  getBdEvent(id: number): schema.BdEvent | undefined;
  createBdEvent(data: schema.InsertBdEvent): schema.BdEvent;
  updateBdEvent(id: number, data: Partial<schema.InsertBdEvent>): schema.BdEvent | undefined;
  deleteBdEvent(id: number): void;

  // Warranty Calls
  getWarrantyCalls(jobId?: number, partnerId?: number): schema.WarrantyCall[];
  getWarrantyCall(id: number): schema.WarrantyCall | undefined;
  createWarrantyCall(data: schema.InsertWarrantyCall): schema.WarrantyCall;
  updateWarrantyCall(id: number, data: Partial<schema.InsertWarrantyCall>): schema.WarrantyCall | undefined;
  deleteWarrantyCall(id: number): void;
}

function maskPayoutHandleForDisplay(handle: string, method: string): string {
  if (!handle) return "";
  if (method === "direct_deposit") {
    try {
      const obj = JSON.parse(handle);
      const last4acct = obj.account ? obj.account.slice(-4) : "••••";
      const last4route = obj.routing ? obj.routing.slice(-4) : "••••";
      return `${obj.bankName || "Bank"} ••••${last4acct} / Routing ••••${last4route}`;
    } catch { return maskField(handle); }
  }
  return maskField(handle, 4);
}

class SqliteStorage implements IStorage {
  // Contacts
  getContacts() { return db.select().from(schema.contacts).all(); }
  getContact(id: number) { return db.select().from(schema.contacts).where(eq(schema.contacts.id, id)).get(); }
  createContact(data: schema.InsertContact) { return db.insert(schema.contacts).values(data).returning().get(); }
  updateContact(id: number, data: Partial<schema.InsertContact>) {
    return db.update(schema.contacts).set(data).where(eq(schema.contacts.id, id)).returning().get();
  }
  deleteContact(id: number) { db.delete(schema.contacts).where(eq(schema.contacts.id, id)).run(); }

  // Jobs
  // Enrich a job row with the contact's name/phone/email so every screen that
  // reads /api/jobs (Scheduling dropdown, Jobs list, Dashboard KPIs, etc.)
  // gets the customer's name without having to fan out N extra requests to
  // /api/contacts/:id. `customerName` is the canonical field — aliased as
  // `customer` for legacy code paths that still expect that shape.
  private _hydrateJobCustomer(job: any): any {
    if (!job) return job;
    let contact: any = null;
    if (job.contactId != null) {
      contact = db.select().from(schema.contacts).where(eq(schema.contacts.id, job.contactId)).get();
    }
    return {
      ...job,
      customerName: contact?.name ?? null,
      customerPhone: contact?.phone ?? null,
      customerEmail: contact?.email ?? null,
      customer: contact?.name ?? null,
    };
  }
  getJobs(includeClosed = false) {
    const rows = db.select().from(schema.jobs).orderBy(desc(schema.jobs.id)).all();
    const hydrated = rows.map(r => this._hydrateJobCustomer(r));
    if (includeClosed) return hydrated;
    return hydrated.filter((j: any) => j.status !== "closed");
  }
  getClosedJobs() {
    const rows = db.select().from(schema.jobs).orderBy(desc(schema.jobs.id)).all();
    return rows.filter((j: any) => j.status === "closed").map(r => this._hydrateJobCustomer(r));
  }
  getJob(id: number) {
    const row = db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();
    return this._hydrateJobCustomer(row);
  }
  closeJob(id: number, closedBy: string, reason?: string) {
    const job = this.getJob(id);
    if (!job) return undefined;
    // Snapshot the current status so reopen can restore it exactly.
    const previousStatus = (job as any).status ?? null;
    const now = new Date().toISOString();
    return db.update(schema.jobs).set({
      status: "closed",
      previousStatus,
      closedAt: now,
      closedBy,
      closedReason: reason || null,
      // Clear any prior reopen stamps so the record reflects the current close.
      reopenedAt: null,
      reopenedBy: null,
    } as any).where(eq(schema.jobs.id, id)).returning().get();
  }
  reopenJob(id: number, reopenedBy: string) {
    const job = this.getJob(id);
    if (!job) return undefined;
    // Restore the pre-close phase; fall back to 'mitigation' if we don't have
    // a snapshot (legacy closed jobs from before this feature landed).
    const restore = (job as any).previousStatus || "mitigation";
    const now = new Date().toISOString();
    return db.update(schema.jobs).set({
      status: restore,
      previousStatus: null,
      closedAt: null,
      closedBy: null,
      closedReason: null,
      reopenedAt: now,
      reopenedBy,
    } as any).where(eq(schema.jobs.id, id)).returning().get();
  }
  createJob(data: schema.InsertJob) {
    const d: any = { ...data, createdAt: new Date().toISOString() };
    // Auto-generate a job number when one isn't supplied (e.g. blank/partial input),
    // so a valid job is still created instead of hitting a NOT NULL constraint.
    if (!d.jobNumber || String(d.jobNumber).trim() === "" || String(d.jobNumber).trim().endsWith("-")) {
      const year = new Date().getFullYear();
      const prefix = `TP-${year}-`;
      const existing = db.select().from(schema.jobs).all();
      let maxSeq = 0;
      for (const j of existing) {
        const m = String((j as any).jobNumber || "").match(new RegExp(`^TP-${year}-(\\d+)$`));
        if (m) { const n = parseInt(m[1], 10); if (n > maxSeq) maxSeq = n; }
      }
      d.jobNumber = `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
    }
    return db.insert(schema.jobs).values(d).returning().get();
  }
  updateJob(id: number, data: Partial<schema.InsertJob>) {
    return db.update(schema.jobs).set(data).where(eq(schema.jobs.id, id)).returning().get();
  }
  deleteJob(id: number) { db.delete(schema.jobs).where(eq(schema.jobs.id, id)).run(); }

  // Estimates
  getEstimates() { return db.select().from(schema.estimates).orderBy(desc(schema.estimates.id)).all(); }
  getEstimate(id: number) { return db.select().from(schema.estimates).where(eq(schema.estimates.id, id)).get(); }
  getEstimatesByJob(jobId: number) { return db.select().from(schema.estimates).where(eq(schema.estimates.jobId, jobId)).all(); }
  createEstimate(data: schema.InsertEstimate) {
    const d: any = { ...data, createdAt: new Date().toISOString() };
    // Provide a sensible default title if one wasn't supplied, so a blank field
    // doesn't cause a NOT NULL failure.
    if (!d.title || String(d.title).trim() === "") d.title = "Untitled Estimate";
    return db.insert(schema.estimates).values(d).returning().get();
  }
  updateEstimate(id: number, data: Partial<schema.InsertEstimate>) {
    return db.update(schema.estimates).set(data).where(eq(schema.estimates.id, id)).returning().get();
  }
  // Hard delete: estimates are a working document, not a compliance record,
  // so a full row removal is fine. Any downstream AI review / rebuttal state
  // lives on the row itself and is cleaned up automatically.
  deleteEstimate(id: number) {
    return db.delete(schema.estimates).where(eq(schema.estimates.id, id)).run();
  }

  // Invoices
  getInvoices() { return db.select().from(schema.invoices).orderBy(desc(schema.invoices.id)).all(); }
  getInvoice(id: number) { return db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).get(); }
  getInvoicesByJob(jobId: number) { return db.select().from(schema.invoices).where(eq(schema.invoices.jobId, jobId)).all(); }
  createInvoice(data: schema.InsertInvoice) {
    const d: any = { ...data, createdAt: new Date().toISOString() };
    // Auto-generate an invoice number when one isn't supplied (blank/partial),
    // following the INV-YYYY-NNN sequence, so a valid invoice is still created.
    if (!d.invoiceNumber || String(d.invoiceNumber).trim() === "" || String(d.invoiceNumber).trim().endsWith("-")) {
      const year = new Date().getFullYear();
      const prefix = `INV-${year}-`;
      const existing = db.select().from(schema.invoices).all();
      let maxSeq = 0;
      for (const inv of existing) {
        const m = String((inv as any).invoiceNumber || "").match(new RegExp(`^INV-${year}-(\\d+)$`));
        if (m) { const n = parseInt(m[1], 10); if (n > maxSeq) maxSeq = n; }
      }
      d.invoiceNumber = `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
    }
    return db.insert(schema.invoices).values(d).returning().get();
  }
  updateInvoice(id: number, data: Partial<schema.InsertInvoice>) {
    return db.update(schema.invoices).set(data).where(eq(schema.invoices.id, id)).returning().get();
  }
  // Full removal. Payments referencing this invoice are cleared out first so
  // the payments table doesn't hold dangling invoiceId references.
  deleteInvoice(id: number) {
    db.delete(schema.payments).where(eq(schema.payments.invoiceId, id)).run();
    return db.delete(schema.invoices).where(eq(schema.invoices.id, id)).run();
  }

  // Payments
  getPayments() { return db.select().from(schema.payments).orderBy(desc(schema.payments.id)).all(); }
  createPayment(data: schema.InsertPayment) {
    const d = { ...data, paidAt: new Date().toISOString() };
    return db.insert(schema.payments).values(d).returning().get();
  }

  // Photos
  getPhotos() { return db.select().from(schema.photos).orderBy(desc(schema.photos.id)).all(); }
  getPhotosByJob(jobId: number) { return db.select().from(schema.photos).where(eq(schema.photos.jobId, jobId)).all(); }
  createPhoto(data: schema.InsertPhoto) {
    // Preserve the client-supplied shutter timestamp when it is a valid ISO
    // date. This matters for offline-queued photos: a photo taken at 8:15 AM
    // that syncs at 2:30 PM must still show 8:15 AM. Only fall back to "now"
    // when the client didn't send takenAt or it's unparseable.
    let takenAt = new Date().toISOString();
    if (typeof data.takenAt === "string" && data.takenAt.trim()) {
      const parsed = new Date(data.takenAt);
      if (!isNaN(parsed.getTime())) takenAt = parsed.toISOString();
    }
    const d = { ...data, takenAt };
    return db.insert(schema.photos).values(d).returning().get();
  }
  deletePhoto(id: number) { db.delete(schema.photos).where(eq(schema.photos.id, id)).run(); }
  getPhoto(id: number) { return db.select().from(schema.photos).where(eq(schema.photos.id, id)).get(); }
  updatePhoto(id: number, patch: Partial<schema.InsertPhoto>) {
    return db.update(schema.photos).set(patch).where(eq(schema.photos.id, id)).returning().get();
  }

  // ── Floor plans ───────────────────────────────────────────────────────────
  // One row per job (UNIQUE(job_id)). Upsert semantics let the client just
  // PUT the plan without worrying about first-vs-subsequent save.
  getFloorPlan(jobId: number) {
    return db.select().from(schema.floorPlans).where(eq(schema.floorPlans.jobId, jobId)).get();
  }
  upsertFloorPlan(jobId: number, planJson: string, updatedBy?: string) {
    const existing = this.getFloorPlan(jobId);
    const now = new Date().toISOString();
    if (existing) {
      return db.update(schema.floorPlans)
        .set({ planJson, updatedAt: now, updatedBy: updatedBy || null })
        .where(eq(schema.floorPlans.jobId, jobId))
        .returning().get();
    }
    return db.insert(schema.floorPlans)
      .values({ jobId, planJson, updatedAt: now, updatedBy: updatedBy || null })
      .returning().get();
  }

  // ── Photo share tokens ───────────────────────────────────────────────────────
  createShareToken(row: schema.InsertPhotoShareToken) {
    const d = { ...row, createdAt: new Date().toISOString() };
    return db.insert(schema.photoShareTokens).values(d).returning().get();
  }
  getShareToken(token: string) {
    return db.select().from(schema.photoShareTokens).where(eq(schema.photoShareTokens.token, token)).get();
  }
  bumpShareTokenView(token: string) {
    sqlite.prepare(`UPDATE photo_share_tokens SET view_count = COALESCE(view_count,0) + 1, last_viewed_at = ? WHERE token = ?`)
      .run(new Date().toISOString(), token);
  }
  revokeShareToken(token: string) {
    sqlite.prepare(`UPDATE photo_share_tokens SET revoked = 1 WHERE token = ?`).run(token);
  }
  listShareTokensForJob(jobId: number) {
    return db.select().from(schema.photoShareTokens).where(eq(schema.photoShareTokens.jobId, jobId)).all();
  }

  // Channels & Messages
  getChannels() { return db.select().from(schema.channels).all(); }
  getChannel(id: number) { return db.select().from(schema.channels).where(eq(schema.channels.id, id)).get(); }
  createChannel(data: schema.InsertChannel) {
    const d = { ...data, createdAt: new Date().toISOString() };
    return db.insert(schema.channels).values(d).returning().get();
  }
  getMessages(channelId: number) { return db.select().from(schema.messages).where(eq(schema.messages.channelId, channelId)).all(); }
  createMessage(data: schema.InsertMessage) {
    const d = { ...data, createdAt: new Date().toISOString() };
    return db.insert(schema.messages).values(d).returning().get();
  }

  // Emails
  getEmails(folder?: string) {
    if (folder) return db.select().from(schema.emails).where(eq(schema.emails.folder, folder)).all();
    return db.select().from(schema.emails).all();
  }
  getEmail(id: number) { return db.select().from(schema.emails).where(eq(schema.emails.id, id)).get(); }
  createEmail(data: schema.InsertEmail) {
    const d = { ...data, createdAt: new Date().toISOString() };
    return db.insert(schema.emails).values(d).returning().get();
  }
  updateEmail(id: number, data: Partial<schema.InsertEmail>) {
    return db.update(schema.emails).set(data).where(eq(schema.emails.id, id)).returning().get();
  }

  // Shifts
  getShifts() { return db.select().from(schema.shifts).orderBy(schema.shifts.shiftDate).all(); }
  getShift(id: number) { return db.select().from(schema.shifts).where(eq(schema.shifts.id, id)).get(); }
  createShift(data: schema.InsertShift) {
    const d = { ...data, createdAt: new Date().toISOString() };
    return db.insert(schema.shifts).values(d).returning().get();
  }
  updateShift(id: number, data: Partial<schema.InsertShift>) {
    return db.update(schema.shifts).set(data).where(eq(schema.shifts.id, id)).returning().get();
  }
  deleteShift(id: number) { db.delete(schema.shifts).where(eq(schema.shifts.id, id)).run(); }

  // Payout Methods
  getPayoutMethods(contactId?: number) {
    const rows = contactId
      ? db.select().from(schema.payoutMethods).where(eq(schema.payoutMethods.contactId, contactId)).all()
      : db.select().from(schema.payoutMethods).all();
    // Decrypt handle for internal use; mask for safe display
    return rows.map((r: any) => ({
      ...r,
      handle: decryptField(r.handle),          // decrypted for internal use
      handleMasked: r.handle ? maskPayoutHandleForDisplay(decryptField(r.handle) || "", r.method) : "",
    }));
  }
  createPayoutMethod(data: schema.InsertPayoutMethod) {
    const d = { ...data, handle: encryptField(data.handle || ""), createdAt: new Date().toISOString() };
    const row: any = db.insert(schema.payoutMethods).values(d).returning().get();
    return { ...row, handle: decryptField(row.handle), handleMasked: maskPayoutHandleForDisplay(decryptField(row.handle) || "", row.method) };
  }
  updatePayoutMethod(id: number, data: Partial<schema.InsertPayoutMethod>) {
    const update: any = { ...data };
    if (data.handle !== undefined) update.handle = encryptField(data.handle || "");
    const row: any = db.update(schema.payoutMethods).set(update).where(eq(schema.payoutMethods.id, id)).returning().get();
    return row ? { ...row, handle: decryptField(row.handle), handleMasked: maskPayoutHandleForDisplay(decryptField(row.handle) || "", row.method) } : undefined;
  }
  deletePayoutMethod(id: number) { db.delete(schema.payoutMethods).where(eq(schema.payoutMethods.id, id)).run(); }

  // Payout Requests
  getPayoutRequests(contactId?: number) {
    if (contactId) return db.select().from(schema.payoutRequests).where(eq(schema.payoutRequests.contactId, contactId)).all();
    return db.select().from(schema.payoutRequests).orderBy(desc(schema.payoutRequests.id)).all();
  }
  getPayoutRequest(id: number) { return db.select().from(schema.payoutRequests).where(eq(schema.payoutRequests.id, id)).get(); }
  createPayoutRequest(data: schema.InsertPayoutRequest) {
    const d = { ...data, createdAt: new Date().toISOString() };
    return db.insert(schema.payoutRequests).values(d).returning().get();
  }
  updatePayoutRequest(id: number, data: Partial<schema.InsertPayoutRequest>) {
    return db.update(schema.payoutRequests).set(data).where(eq(schema.payoutRequests.id, id)).returning().get();
  }

  // Drying Records
  getDryingRecords(jobId: number) {
    return db.select().from(schema.dryingRecords).where(eq(schema.dryingRecords.jobId, jobId)).orderBy(schema.dryingRecords.dayNumber).all();
  }
  getDryingRecord(id: number) { return db.select().from(schema.dryingRecords).where(eq(schema.dryingRecords.id, id)).get(); }
  createDryingRecord(data: schema.InsertDryingRecord) {
    const d = { ...data, createdAt: new Date().toISOString() };
    return db.insert(schema.dryingRecords).values(d).returning().get();
  }
  updateDryingRecord(id: number, data: Partial<schema.InsertDryingRecord>) {
    return db.update(schema.dryingRecords).set(data).where(eq(schema.dryingRecords.id, id)).returning().get();
  }
  deleteDryingRecord(id: number) { db.delete(schema.dryingRecords).where(eq(schema.dryingRecords.id, id)).run(); }

  // Employees
  getEmployees() { return db.select().from(schema.employees).all(); }
  getEmployeeByName(name: string) {
    return db.select().from(schema.employees).where(eq(schema.employees.name, name)).get();
  }
  createEmployee(data: schema.InsertEmployee) {
    const d = { ...data, createdAt: new Date().toISOString() };
    return db.insert(schema.employees).values(d).returning().get();
  }
  updateEmployee(id: number, data: Partial<schema.InsertEmployee>) {
    return db.update(schema.employees).set(data).where(eq(schema.employees.id, id)).returning().get();
  }

  // Portal
  createPortalSession(data: schema.InsertPortalSession) {
    const d = { ...data, createdAt: new Date().toISOString() };
    return db.insert(schema.portalSessions).values(d).returning().get();
  }
  getPortalSessionByToken(token: string) {
    return db.select().from(schema.portalSessions).where(eq(schema.portalSessions.sessionToken, token)).get();
  }

  // Job Documents
  getJobDocuments(jobId: number) {
    return db.select().from(schema.jobDocuments).where(eq(schema.jobDocuments.jobId, jobId)).orderBy(desc(schema.jobDocuments.id)).all();
  }
  getJobDocument(id: number) {
    return db.select().from(schema.jobDocuments).where(eq(schema.jobDocuments.id, id)).get();
  }
  createJobDocument(data: schema.InsertJobDocument) {
    const d = { ...data, createdAt: new Date().toISOString() };
    return db.insert(schema.jobDocuments).values(d).returning().get();
  }
  updateJobDocument(id: number, data: Partial<schema.InsertJobDocument>) {
    return db.update(schema.jobDocuments).set(data).where(eq(schema.jobDocuments.id, id)).returning().get();
  }
  deleteJobDocument(id: number) {
    db.delete(schema.jobDocuments).where(eq(schema.jobDocuments.id, id)).run();
  }

  // BD Calendar Events
  getBdEvents() { return db.select().from(schema.bdEvents).orderBy(schema.bdEvents.date, schema.bdEvents.startTime).all(); }
  getBdEvent(id: number) { return db.select().from(schema.bdEvents).where(eq(schema.bdEvents.id, id)).get(); }
  createBdEvent(data: schema.InsertBdEvent) {
    const now = new Date().toISOString();
    return db.insert(schema.bdEvents).values({ ...data, createdAt: now, updatedAt: now }).returning().get();
  }
  updateBdEvent(id: number, data: Partial<schema.InsertBdEvent>) {
    return db.update(schema.bdEvents).set({ ...data, updatedAt: new Date().toISOString() }).where(eq(schema.bdEvents.id, id)).returning().get();
  }
  deleteBdEvent(id: number) { db.delete(schema.bdEvents).where(eq(schema.bdEvents.id, id)).run(); }

  // Warranty Calls
  getWarrantyCalls(jobId?: number, partnerId?: number) {
    if (jobId) return db.select().from(schema.warrantyCalls).where(eq(schema.warrantyCalls.jobId, jobId)).all();
    if (partnerId) return db.select().from(schema.warrantyCalls).where(eq(schema.warrantyCalls.partnerId, partnerId)).all();
    return db.select().from(schema.warrantyCalls).orderBy(desc(schema.warrantyCalls.visitDate)).all();
  }
  getWarrantyCall(id: number) { return db.select().from(schema.warrantyCalls).where(eq(schema.warrantyCalls.id, id)).get(); }
  createWarrantyCall(data: schema.InsertWarrantyCall) {
    const now = new Date().toISOString();
    const laborCost = (data.laborHours || 0) * (data.laborRate || 65);
    const total = laborCost + (data.materialCost || 0);
    return db.insert(schema.warrantyCalls).values({ ...data, totalCost: total, createdAt: now }).returning().get();
  }
  updateWarrantyCall(id: number, data: Partial<schema.InsertWarrantyCall>) {
    const existing = db.select().from(schema.warrantyCalls).where(eq(schema.warrantyCalls.id, id)).get();
    if (!existing) return undefined;
    const laborHours = data.laborHours ?? existing.laborHours ?? 0;
    const laborRate = data.laborRate ?? existing.laborRate ?? 65;
    const materialCost = data.materialCost ?? existing.materialCost ?? 0;
    const totalCost = laborHours * laborRate + materialCost;
    return db.update(schema.warrantyCalls).set({ ...data, totalCost }).where(eq(schema.warrantyCalls.id, id)).returning().get();
  }
  deleteWarrantyCall(id: number) { db.delete(schema.warrantyCalls).where(eq(schema.warrantyCalls.id, id)).run(); }

  // Line Item Library
  getLineItems(category?: string) {
    if (category) return db.select().from(schema.lineItemLibrary).where(eq(schema.lineItemLibrary.category, category)).all();
    return db.select().from(schema.lineItemLibrary).all();
  }
  getLineItem(id: number) { return db.select().from(schema.lineItemLibrary).where(eq(schema.lineItemLibrary.id, id)).get(); }
  createLineItem(data: schema.InsertLineItem) {
    return db.insert(schema.lineItemLibrary).values({ ...data, createdAt: new Date().toISOString() }).returning().get();
  }
  updateLineItem(id: number, data: Partial<schema.InsertLineItem>) {
    return db.update(schema.lineItemLibrary).set(data).where(eq(schema.lineItemLibrary.id, id)).returning().get();
  }
  deleteLineItem(id: number) { db.delete(schema.lineItemLibrary).where(eq(schema.lineItemLibrary.id, id)).run(); }

  // Adjusters
  getAdjusters() { return db.select().from(schema.adjusters).all(); }
  getAdjuster(id: number) { return db.select().from(schema.adjusters).where(eq(schema.adjusters.id, id)).get(); }
  createAdjuster(data: schema.InsertAdjuster) {
    return db.insert(schema.adjusters).values({ ...data, createdAt: new Date().toISOString() }).returning().get();
  }
  updateAdjuster(id: number, data: Partial<schema.InsertAdjuster>) {
    return db.update(schema.adjusters).set(data).where(eq(schema.adjusters.id, id)).returning().get();
  }
  deleteAdjuster(id: number) { db.delete(schema.adjusters).where(eq(schema.adjusters.id, id)).run(); }

  // Adjuster Meetings
  getAdjusterMeetings(jobId?: number) {
    if (jobId) return db.select().from(schema.adjusterMeetings).where(eq(schema.adjusterMeetings.jobId, jobId)).all();
    return db.select().from(schema.adjusterMeetings).orderBy(desc(schema.adjusterMeetings.id)).all();
  }
  createAdjusterMeeting(data: schema.InsertAdjusterMeeting) {
    return db.insert(schema.adjusterMeetings).values({ ...data, createdAt: new Date().toISOString() }).returning().get();
  }
  updateAdjusterMeeting(id: number, data: Partial<schema.InsertAdjusterMeeting>) {
    return db.update(schema.adjusterMeetings).set(data).where(eq(schema.adjusterMeetings.id, id)).returning().get();
  }
  deleteAdjusterMeeting(id: number) { db.delete(schema.adjusterMeetings).where(eq(schema.adjusterMeetings.id, id)).run(); }

  // Inspection Checklists
  getInspectionChecklists(jobId: number) {
    return db.select().from(schema.inspectionChecklists).where(eq(schema.inspectionChecklists.jobId, jobId)).all();
  }
  getInspectionChecklist(id: number) { return db.select().from(schema.inspectionChecklists).where(eq(schema.inspectionChecklists.id, id)).get(); }
  createInspectionChecklist(data: schema.InsertInspectionChecklist) {
    return db.insert(schema.inspectionChecklists).values({ ...data, createdAt: new Date().toISOString() }).returning().get();
  }
  updateInspectionChecklist(id: number, data: Partial<schema.InsertInspectionChecklist>) {
    return db.update(schema.inspectionChecklists).set(data).where(eq(schema.inspectionChecklists.id, id)).returning().get();
  }

  // Review Requests
  getReviewRequests(jobId?: number) {
    if (jobId) return db.select().from(schema.reviewRequests).where(eq(schema.reviewRequests.jobId, jobId)).all();
    return db.select().from(schema.reviewRequests).orderBy(desc(schema.reviewRequests.id)).all();
  }
  createReviewRequest(data: schema.InsertReviewRequest) {
    return db.insert(schema.reviewRequests).values({ ...data, createdAt: new Date().toISOString() }).returning().get();
  }
  updateReviewRequest(id: number, data: Partial<schema.InsertReviewRequest>) {
    return db.update(schema.reviewRequests).set(data).where(eq(schema.reviewRequests.id, id)).returning().get();
  }
  deleteReviewRequest(id: number) { db.delete(schema.reviewRequests).where(eq(schema.reviewRequests.id, id)).run(); }

  // Certifications
  getCertifications(employeeName?: string) {
    if (employeeName) return db.select().from(schema.certifications).where(eq(schema.certifications.employeeName, employeeName)).all();
    return db.select().from(schema.certifications).all();
  }
  getCertification(id: number) { return db.select().from(schema.certifications).where(eq(schema.certifications.id, id)).get(); }
  createCertification(data: schema.InsertCertification) {
    return db.insert(schema.certifications).values({ ...data, createdAt: new Date().toISOString() }).returning().get();
  }
  updateCertification(id: number, data: Partial<schema.InsertCertification>) {
    return db.update(schema.certifications).set(data).where(eq(schema.certifications.id, id)).returning().get();
  }
  deleteCertification(id: number) { db.delete(schema.certifications).where(eq(schema.certifications.id, id)).run(); }
}

export const storage = new SqliteStorage();

// ── Suite 3: New Tables ───────────────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    entity_type TEXT NOT NULL DEFAULT 'job',
    entity_id INTEGER,
    action TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'System',
    description TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS sms_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER,
    contact_id INTEGER,
    direction TEXT NOT NULL DEFAULT 'outbound',
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT DEFAULT 'sent',
    twilio_sid TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS job_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    loss_type TEXT NOT NULL,
    description TEXT,
    default_scope TEXT NOT NULL DEFAULT '[]',
    default_equipment TEXT NOT NULL DEFAULT '[]',
    iicrc_protocol TEXT,
    estimated_days INTEGER,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS adjuster_portal_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adjuster_id INTEGER,
    adjuster_name TEXT NOT NULL,
    carrier TEXT NOT NULL,
    access_token TEXT NOT NULL,
    job_ids TEXT NOT NULL DEFAULT '[]',
    expires_at TEXT NOT NULL,
    last_accessed_at TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS tech_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tech_name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'assignment',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    job_id INTEGER,
    read INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT '',
    -- Added for the app-wide notification bell: if set, this notification is
    -- targeted at a specific employee (by id) instead of / in addition to a
    -- named tech. Legacy tech-only notifications keep tech_name populated and
    -- leave employee_id NULL.
    employee_id INTEGER,
    link TEXT
  );

  CREATE TABLE IF NOT EXISTS consumables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sku TEXT,
    category TEXT DEFAULT 'general',
    unit TEXT DEFAULT 'each',
    on_hand REAL DEFAULT 0,
    reorder_point REAL DEFAULT 0,
    unit_cost REAL DEFAULT 0,
    vendor TEXT,
    location TEXT,
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS consumable_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    consumable_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_cost REAL DEFAULT 0,
    job_id INTEGER,
    job_cost_id INTEGER,
    source TEXT,
    reference TEXT,
    entered_by TEXT,
    balance_after REAL,
    created_at TEXT NOT NULL DEFAULT ''
  );
`);

// Seed job templates
const tmplCount = sqlite.prepare("SELECT COUNT(*) as c FROM job_templates").get() as { c: number };
if (tmplCount.c === 0) {
  const tnow = new Date().toISOString();
  const templates = [
    { name: "Cat 1 Water Loss – Standard", loss_type: "water", description: "Category 1 (clean water) residential water loss.", iicrc_protocol: "IICRC S500 Category 1, Class 2 — Structural drying using LGR dehumidifiers and air movers per ANSI/IICRC S500 Section 9.", estimated_days: 3, default_scope: JSON.stringify([{description:"Emergency Response/Mobilization",category:"mitigation",qty:1,unit:"LS",unitPrice:450},{description:"Water Extraction – Cat 1",category:"extraction",qty:800,unit:"SF",unitPrice:0.35},{description:"Structural Drying – LGR Dehumidifier",category:"drying",qty:3,unit:"days",unitPrice:85},{description:"Air Mover – Commercial Grade",category:"drying",qty:6,unit:"days",unitPrice:25},{description:"Moisture Monitoring Daily Log",category:"monitoring",qty:3,unit:"days",unitPrice:75}]), default_equipment: JSON.stringify([{type:"LGR Dehumidifier",qty:2},{type:"Air Mover",qty:6},{type:"Moisture Meter",qty:1}]) },
    { name: "Cat 2 Water Loss – Gray Water", loss_type: "water", description: "Category 2 (gray water) loss — washing machine overflow, dishwasher leak.", iicrc_protocol: "IICRC S500 Category 2, Class 2-3 — Antimicrobial treatment required per Section 12. PPE Level B minimum.", estimated_days: 4, default_scope: JSON.stringify([{description:"Emergency Response/Mobilization",category:"mitigation",qty:1,unit:"LS",unitPrice:450},{description:"Water Extraction – Cat 2",category:"extraction",qty:800,unit:"SF",unitPrice:0.45},{description:"Structural Drying – LGR Dehumidifier",category:"drying",qty:4,unit:"days",unitPrice:85},{description:"Air Mover – Commercial Grade",category:"drying",qty:8,unit:"days",unitPrice:25},{description:"Antimicrobial Application",category:"treatment",qty:800,unit:"SF",unitPrice:0.35},{description:"Containment Setup",category:"containment",qty:1,unit:"LS",unitPrice:275}]), default_equipment: JSON.stringify([{type:"LGR Dehumidifier",qty:2},{type:"Air Mover",qty:8},{type:"HEPA Air Scrubber",qty:1}]) },
    { name: "Mold Remediation – Standard", loss_type: "mold", description: "Standard mold remediation per IICRC S520.", iicrc_protocol: "IICRC S520 — Containment, HEPA vacuuming, antifungal treatment, clearance testing per Section 14.", estimated_days: 5, default_scope: JSON.stringify([{description:"Mold Assessment & Sampling",category:"assessment",qty:1,unit:"LS",unitPrice:650},{description:"Full Containment Setup",category:"containment",qty:1,unit:"LS",unitPrice:475},{description:"HEPA Vacuuming",category:"remediation",qty:400,unit:"SF",unitPrice:1.25},{description:"Antifungal Treatment",category:"treatment",qty:400,unit:"SF",unitPrice:0.85},{description:"HEPA Air Scrubber – Daily",category:"equipment",qty:5,unit:"days",unitPrice:125},{description:"Clearance Testing",category:"testing",qty:1,unit:"LS",unitPrice:450}]), default_equipment: JSON.stringify([{type:"HEPA Air Scrubber",qty:2},{type:"Negative Air Machine",qty:1}]) },
    { name: "Fire & Smoke Damage", loss_type: "fire", description: "Residential fire/smoke damage restoration.", iicrc_protocol: "IICRC S700 — Odor control, content cleaning, structural restoration. Document all char depth and smoke penetration.", estimated_days: 7, default_scope: JSON.stringify([{description:"Emergency Board-Up / Tarping",category:"emergency",qty:1,unit:"LS",unitPrice:650},{description:"Smoke/Soot Cleaning – Walls & Ceilings",category:"cleaning",qty:1200,unit:"SF",unitPrice:1.25},{description:"Odor Removal – Hydroxyl Treatment",category:"odor",qty:5,unit:"days",unitPrice:275},{description:"Contents Pack-Out",category:"contents",qty:1,unit:"LS",unitPrice:1200},{description:"Structural Cleaning – Detailed",category:"cleaning",qty:1,unit:"LS",unitPrice:850}]), default_equipment: JSON.stringify([{type:"Hydroxyl Generator",qty:2},{type:"Ozone Machine",qty:1}]) },
    { name: "Storm Damage – Water Intrusion", loss_type: "storm", description: "Storm-related water intrusion from roof damage.", iicrc_protocol: "IICRC S500 + S700 — Emergency stabilization then structural drying. Document all damage prior to repairs.", estimated_days: 5, default_scope: JSON.stringify([{description:"Emergency Tarping / Roof Stabilization",category:"emergency",qty:1,unit:"LS",unitPrice:750},{description:"Water Extraction",category:"extraction",qty:600,unit:"SF",unitPrice:0.40},{description:"Structural Drying",category:"drying",qty:4,unit:"days",unitPrice:85},{description:"Air Movers",category:"drying",qty:6,unit:"days",unitPrice:25},{description:"Debris Removal",category:"cleanup",qty:1,unit:"LS",unitPrice:350}]), default_equipment: JSON.stringify([{type:"LGR Dehumidifier",qty:2},{type:"Air Mover",qty:6}]) },
  ];
  for (const t of templates) {
    sqlite.prepare(`INSERT INTO job_templates (name, loss_type, description, default_scope, default_equipment, iicrc_protocol, estimated_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(t.name, t.loss_type, t.description, t.default_scope, t.default_equipment, t.iicrc_protocol, t.estimated_days, tnow);
  }
}

// Seed a few starter consumables
const consCount = sqlite.prepare("SELECT COUNT(*) as c FROM consumables").get() as { c: number };
if (consCount.c === 0) {
  const cnow = new Date().toISOString();
  const items = [
    { name: "Nitrile Gloves (L)", sku: "PPE-GLV-L", category: "ppe", unit: "box", on_hand: 24, reorder_point: 6, unit_cost: 8.5, vendor: "ULINE", location: "Shelf A1" },
    { name: "6-mil Poly Sheeting (10x100)", sku: "CON-POLY-6", category: "containment", unit: "roll", on_hand: 12, reorder_point: 4, unit_cost: 34.0, vendor: "Home Depot", location: "Shelf B2" },
    { name: "Antimicrobial (Benefect) 1 Gal", sku: "CLN-AM-1G", category: "cleaning", unit: "gallon", on_hand: 9, reorder_point: 3, unit_cost: 42.0, vendor: "Interlink", location: "Shelf C1" },
    { name: "HEPA Filter (Air Scrubber)", sku: "DRY-HEPA", category: "drying", unit: "each", on_hand: 8, reorder_point: 2, unit_cost: 65.0, vendor: "Dri-Eaz", location: "Shelf D3" },
    { name: "Contents Box (Large)", sku: "PKG-BOX-L", category: "packaging", unit: "each", on_hand: 40, reorder_point: 15, unit_cost: 2.25, vendor: "ULINE", location: "Shelf E1" },
    { name: "Tyvek Suit (XL)", sku: "PPE-TYV-XL", category: "ppe", unit: "each", on_hand: 5, reorder_point: 6, unit_cost: 11.0, vendor: "ULINE", location: "Shelf A2" },
  ];
  for (const it of items) {
    sqlite.prepare(`INSERT INTO consumables (name, sku, category, unit, on_hand, reorder_point, unit_cost, vendor, location, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)`)
      .run(it.name, it.sku, it.category, it.unit, it.on_hand, it.reorder_point, it.unit_cost, it.vendor, it.location, cnow);
  }
}

// ── Performance: auto-index all foreign-key (*_id) columns ───────────────────
// Runs on every startup. Idempotent (IF NOT EXISTS). This makes per-job /
// per-contact / per-invoice lookups use an index instead of a full table scan,
// which keeps the app fast as data grows. Also self-heals a fresh database
// that starts without the snapshotted indexes.
try {
  const idxTables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  for (const { name: table } of idxTables) {
    const cols = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
    for (const { name: col } of cols) {
      if (col === "id") continue;
      if (!col.endsWith("_id") && !col.endsWith("Id")) continue;
      const idxName = `idx_${table}_${col}`;
      try {
        sqlite.exec(`CREATE INDEX IF NOT EXISTS "${idxName}" ON "${table}" ("${col}")`);
      } catch {
        /* ignore individual index failures */
      }
    }
  }
  sqlite.exec("ANALYZE;");
} catch (e) {
  console.warn("[startup] index creation skipped:", (e as Error).message);
}
