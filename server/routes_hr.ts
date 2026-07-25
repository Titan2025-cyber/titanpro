import type { Express, Request, Response } from "express";
import type Database from "better-sqlite3";
import Anthropic from "@anthropic-ai/sdk";
import { makeAuthMiddleware, writeAudit } from "./routes_auth";

// ─────────────────────────────────────────────────────────────────────────────
// Titan Pro — HR Management Module + AI HR Assistant
//
// Self-contained module: creates its own SQLite tables on registration (additive,
// raw CREATE TABLE IF NOT EXISTS — never touches existing tables), seeds a dated,
// citable SC/GA/federal employment-law knowledge base, and exposes CRUD routes for
// employee records, the handbook, trainings, write-ups, and reviews.
//
// The AI HR Assistant is RETRIEVAL-GROUNDED: it answers only from the curated
// knowledge base (kb entries are injected into the prompt) and always cites the
// statute + source. High-risk document types (termination, discipline, FMLA/leave,
// discrimination/harassment) carry a legal-review disclaimer footer — the one
// guardrail that protects the company if a document is ever reviewed by the EEOC,
// SC LLR, GA DOL, or a plaintiff's attorney. Everything else is fully autonomous.
//
// Degrades gracefully: if ANTHROPIC_API_KEY is absent (e.g. published preview),
// a deterministic template engine produces a usable draft so nothing hard-fails.
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const nowISO = () => new Date().toISOString();
const todayISO = () => new Date().toISOString().slice(0, 10);
// Inclusive count of Mon-Fri business days between two ISO dates (min 1).
function businessDaysBetween(startISO: string, endISO: string): number {
  const s = new Date(startISO + "T00:00:00");
  const e = new Date(endISO + "T00:00:00");
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 1;
  let count = 0;
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return Math.max(count, 1);
}

function llmAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

async function askLLM(system: string, user: string, maxTokens = 2500): Promise<string> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  return msg.content.map((c: any) => (c.type === "text" ? c.text : "")).join("").trim();
}

// ─── High-risk doc classification ───────────────────────────────────────────
const HIGH_RISK = ["termination", "discipline", "writeup", "write-up", "leave", "fmla", "discrimination", "harassment", "layoff", "wage_dispute", "eeoc", "retaliation"];
function isHighRisk(topic: string): boolean {
  const t = (topic || "").toLowerCase();
  return HIGH_RISK.some(k => t.includes(k));
}
const DISCLAIMER =
  "\n\n———\nLEGAL REVIEW NOTICE: This document addresses a high-liability employment matter " +
  "(termination, discipline, leave, or discrimination). It reflects South Carolina, Georgia, and federal " +
  "requirements current as of the knowledge-base dates cited above, but employment law changes frequently. " +
  "Have counsel or a licensed HR professional review before you act on or deliver this document. " +
  "Titan Pro provides HR information, not legal advice.";

// ─────────────────────────────────────────────────────────────────────────────
// Schema (additive, self-contained)
// ─────────────────────────────────────────────────────────────────────────────
function ensureSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS hr_employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      job_title TEXT,
      department TEXT,
      employment_type TEXT DEFAULT 'full_time',   -- full_time, part_time, seasonal, contractor
      status TEXT DEFAULT 'active',                -- active, on_leave, terminated
      work_state TEXT DEFAULT 'SC',                -- SC or GA (drives applicable law)
      hire_date TEXT,
      termination_date TEXT,
      pay_type TEXT DEFAULT 'hourly',              -- hourly, salary
      pay_rate REAL DEFAULT 0,
      emergency_contact TEXT,
      emergency_phone TEXT,
      notes TEXT,
      i9_on_file INTEGER DEFAULT 0,
      w4_on_file INTEGER DEFAULT 0,
      everify_done INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hr_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER,
      doc_type TEXT,          -- i9, w4, offer_letter, certification, other
      title TEXT NOT NULL,
      file_ref TEXT,          -- storage key/url (optional)
      body TEXT,              -- text content for generated docs
      expires_on TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hr_handbook (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,     -- markdown
      status TEXT DEFAULT 'draft',   -- draft, published, archived
      effective_date TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hr_acknowledgments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handbook_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      acknowledged_at TEXT,
      signature_name TEXT,
      status TEXT DEFAULT 'pending',  -- pending, acknowledged
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hr_trainings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,          -- safety, iicrc, osha, compliance, onboarding, other
      description TEXT,
      recurrence_months INTEGER DEFAULT 0,  -- 0 = one-time; 12 = annual, etc.
      required INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hr_training_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      training_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      status TEXT DEFAULT 'assigned',  -- assigned, in_progress, completed
      assigned_on TEXT DEFAULT (datetime('now')),
      completed_on TEXT,
      expires_on TEXT,
      score TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hr_writeups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      type TEXT DEFAULT 'verbal',   -- verbal, written, final_warning, pip, termination
      severity TEXT DEFAULT 'minor',
      incident_date TEXT,
      subject TEXT,
      body TEXT,              -- full text of the write-up
      corrective_action TEXT,
      issued_by TEXT,
      employee_ack INTEGER DEFAULT 0,
      employee_ack_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hr_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      period TEXT,            -- e.g. "2026 Annual", "Q2 2026"
      review_date TEXT,
      overall_rating TEXT,    -- exceeds, meets, needs_improvement, unsatisfactory
      strengths TEXT,
      areas_for_growth TEXT,
      goals TEXT,
      reviewer TEXT,
      status TEXT DEFAULT 'draft',   -- draft, final, acknowledged
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hr_law_kb (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jurisdiction TEXT NOT NULL,   -- federal, SC, GA
      topic TEXT NOT NULL,          -- minimum_wage, final_pay, at_will, discrimination, workers_comp, everify, non_compete, leave, overtime, i9
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      citation TEXT,                -- statute / regulation
      source_name TEXT,
      source_url TEXT,
      as_of_date TEXT,              -- when this fact was verified
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hr_ai_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT,              -- assistant, draft
      topic TEXT,
      prompt TEXT,
      response TEXT,
      high_risk INTEGER DEFAULT 0,
      used_llm INTEGER DEFAULT 0,
      run_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- PTO / time-off requests (approval workflow)
    CREATE TABLE IF NOT EXISTS hr_timeoff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      category TEXT DEFAULT 'pto',    -- pto, sick, unpaid, bereavement, jury_duty, holiday, other
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      hours REAL DEFAULT 0,           -- total requested hours (8 = 1 day)
      reason TEXT,
      status TEXT DEFAULT 'pending',  -- pending, approved, denied, cancelled
      requested_by TEXT,
      decided_by TEXT,
      decided_at TEXT,
      decision_note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Annual time-off allotments per employee (drives balances)
    CREATE TABLE IF NOT EXISTS hr_timeoff_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      year INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'pto',   -- pto, sick
      allotted_hours REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(employee_id, year, category)
    );
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge-base seed — dated, citable SC / GA / federal employment law.
// Verified July 2026. Facts a SC-based restoration contractor with GA operations
// most needs. Each entry is quotable by the AI with its citation + source.
// ─────────────────────────────────────────────────────────────────────────────
const KB_SEED: Array<{
  jurisdiction: string; topic: string; title: string; summary: string;
  citation: string; source_name: string; source_url: string; as_of_date: string;
}> = [
  // ── FEDERAL ──
  {
    jurisdiction: "federal", topic: "minimum_wage", title: "Federal minimum wage — $7.25/hr",
    summary: "The federal minimum wage is $7.25/hour, unchanged since July 24, 2009. Tipped employees may be paid a $2.13/hr cash wage if tips bring total pay to at least $7.25. Employers must pay whichever is higher between state and federal.",
    citation: "FLSA, 29 U.S.C. § 206", source_name: "U.S. Dept. of Labor / FLSA", source_url: "https://www.dol.gov/agencies/whd/minimum-wage", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "federal", topic: "overtime", title: "FLSA overtime & exempt salary threshold",
    summary: "Non-exempt employees must receive 1.5x their regular rate for hours over 40 in a workweek. The exempt-employee salary threshold is $684/week ($35,568/year); the 2024 DOL rule raising it was vacated, so $684/week remains operative in 2026.",
    citation: "FLSA, 29 U.S.C. § 207; 29 CFR Part 541", source_name: "U.S. Dept. of Labor", source_url: "https://www.dol.gov/agencies/whd/overtime", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "federal", topic: "i9", title: "Form I-9 required for every new hire",
    summary: "Every U.S. employer must complete Form I-9 to verify identity and work authorization for each employee hired, regardless of company size, within 3 business days of the start date.",
    citation: "8 CFR § 274a.2", source_name: "USCIS", source_url: "https://www.uscis.gov/i-9", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "federal", topic: "discrimination", title: "Title VII / ADA / ADEA coverage thresholds",
    summary: "Title VII (race, color, religion, sex incl. pregnancy/sexual orientation/gender identity per Bostock 2020), the ADA (disability), and GINA apply to employers with 15+ employees. The ADEA (age 40+) applies at 20+ employees. The federal Equal Pay Act applies to nearly all employers (1+).",
    citation: "42 U.S.C. § 2000e (Title VII); 42 U.S.C. § 12111 (ADA); 29 U.S.C. § 631 (ADEA)", source_name: "U.S. EEOC", source_url: "https://www.eeoc.gov/employers/small-business/small-business-requirements", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "federal", topic: "leave", title: "FMLA coverage — 50+ employees",
    summary: "The Family and Medical Leave Act applies to employers with 50+ employees within a 75-mile radius. Eligible employees (12+ months, 1,250+ hours) get up to 12 weeks of unpaid, job-protected leave. Titan is below this threshold at under 25 employees, so FMLA does not currently apply — but track headcount.",
    citation: "29 U.S.C. § 2611", source_name: "U.S. Dept. of Labor", source_url: "https://www.dol.gov/agencies/whd/fmla", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "federal", topic: "eeo_reporting", title: "EEO-1 reporting — 100+ employees",
    summary: "EEO-1 demographic reporting is required for private employers with 100+ employees (or federal contractors with 50+ and a $50,000+ contract). Employers with 15+ must keep employment records under 29 CFR 1602.14.",
    citation: "29 CFR 1602", source_name: "U.S. EEOC", source_url: "https://www.eeoc.gov/employers/eeo-1-data-collection", as_of_date: "2026-07-17",
  },
  // ── SOUTH CAROLINA ──
  {
    jurisdiction: "SC", topic: "minimum_wage", title: "South Carolina — no state minimum wage",
    summary: "South Carolina has no state minimum wage (repealed 1997), so the federal $7.25/hr floor applies to all FLSA-covered employers. NOTE: SC Bill H.3226 (2025-2026 session) proposed a phased state minimum wage starting at $8.75 on Jan 1, 2026 — confirm current enactment status before relying on it; as of this entry the operative rate is $7.25.",
    citation: "S.C. Code (former § 41-10); FLSA controls", source_name: "SC Statehouse / Expert-Zoom SC Guide", source_url: "https://www.scstatehouse.gov/sess126_2025-2026/bills/3226.htm", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "SC", topic: "final_pay", title: "SC final paycheck — 48 hours, TREBLE DAMAGES risk",
    summary: "South Carolina requires final wages be paid within 48 hours of separation OR by the next regular payday, not to exceed 30 days — applies to both termination and resignation. CRITICAL: SC allows TREBLE (3x) damages plus costs and attorney fees for late or withheld final pay under the SC Payment of Wages Act. Pay final wages promptly and document it.",
    citation: "S.C. Code § 41-10-10 et seq. (Payment of Wages Act)", source_name: "Paycom / SC Payment of Wages Act", source_url: "https://www.paycom.com/resources/blog/final-paycheck-laws-by-state/", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "SC", topic: "at_will", title: "South Carolina at-will employment",
    summary: "South Carolina is a strict at-will state: employers may terminate for any reason or no reason. Three exceptions: (1) public policy (e.g. firing for filing a workers' comp claim), (2) implied contract (handbook language or oral promises), (3) the narrow good-faith covenant. Keep handbook disclaimers clear to preserve at-will status.",
    citation: "S.C. Code § 41-1-10", source_name: "Expert-Zoom SC Labor Law Guide", source_url: "https://expert-zoom.com/us/magazine/lawyers/labor-law/south-carolina-labor-law", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "SC", topic: "discrimination", title: "SC Human Affairs Law — 15+ employees",
    summary: "The SC Human Affairs Law (SCHAL) covers employers with 15+ employees for 20+ calendar weeks. Protected classes: race, color, religion, sex (incl. pregnancy/childbirth/lactation per 2018 Pregnancy Accommodations Act), age 40+, national origin, disability. SC state law does not add sexual-orientation/gender-identity coverage, but federal Bostock does at 15+. File within 180 days with SCHAC (300 under EEOC worksharing).",
    citation: "S.C. Code §§ 1-13-10 to 1-13-110", source_name: "SC Human Affairs Commission / SC Statehouse", source_url: "https://www.scstatehouse.gov/code/t01c013.php", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "SC", topic: "workers_comp", title: "SC workers' comp — 4+ employees",
    summary: "South Carolina requires workers' compensation coverage once an employer regularly employs 4+ employees AND has annual payroll of $3,000+. Part-time, seasonal, and family-member employees all count. Enforced by the SC Workers' Compensation Commission; penalties include stop-work orders and personal liability.",
    citation: "S.C. Code § 42-1-10 et seq.", source_name: "SC Workers' Compensation Commission", source_url: "https://wcc.sc.gov/employer-faqs", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "SC", topic: "everify", title: "SC E-Verify — mandatory for ALL private employers",
    summary: "South Carolina requires E-Verify for EVERY private employer regardless of size. Employers must verify all new hires through E-Verify within the required window. Violations can lead to license suspension. This is stricter than most states — do not skip it.",
    citation: "S.C. Code § 41-8-20", source_name: "FirstHR SC Compliance Guide", source_url: "https://firsthr.app/compliance-hub/south-carolina/south-carolina-hr-compliance-guide", as_of_date: "2026-07-17",
  },
  // ── GEORGIA ──
  {
    jurisdiction: "GA", topic: "minimum_wage", title: "Georgia minimum wage — federal $7.25 controls",
    summary: "Georgia's statutory minimum wage is $5.15/hr (O.C.G.A. § 34-4-3), but the higher federal $7.25 controls for virtually all FLSA-covered employers. Use $7.25 in practice and in the handbook — the $5.15 figure applies only to the narrow set of employers not covered by FLSA.",
    citation: "O.C.G.A. § 34-4-3", source_name: "Georgia Labor Laws 2026 Guide", source_url: "https://www.allvoices.co/blog/georgia-labor-laws", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "GA", topic: "final_pay", title: "Georgia final paycheck — next regular payday",
    summary: "Georgia has no statute setting a strict final-pay deadline and no waiting-time penalty. Final wages are due by the next regularly scheduled payday, consistent with federal FLSA. (Narrow exception: on employee death, up to $2,500 may be paid to a beneficiary/spouse.)",
    citation: "O.C.G.A. § 34-7-2", source_name: "Business Executive Group / Connecteam", source_url: "https://connecteam.com/state-labor-laws/georgia/", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "GA", topic: "at_will", title: "Georgia at-will employment",
    summary: "Georgia is an at-will employment state. Recognized exceptions are narrow: public-policy (retaliation for lawful conduct), implied contract (handbook/verbal commitments), and a narrowly applied good-faith standard. Georgia's own wage-and-hour statute technically applies to employers of 6+ employees.",
    citation: "O.C.G.A. Title 34", source_name: "Business Executive Group GA Guide", source_url: "https://www.beghr.com/blog/hr-outsourcing/terminations/georgia-termination-final-paycheck-rules", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "GA", topic: "workers_comp", title: "Georgia workers' comp — 3+ employees (lowered 2026)",
    summary: "Georgia requires workers' compensation for any employer with 3+ employees, INCLUDING part-time and seasonal workers — the threshold was LOWERED from 5 to 3 effective January 1, 2026. No payroll threshold, no industry exemption. Corporate officers/LLC members count toward the 3 even if they file Form WC-10 to reject personal coverage. Independent contractors don't count, but misclassification creates liability.",
    citation: "O.C.G.A. § 34-9-2", source_name: "GA State Board of Workers' Compensation", source_url: "https://sbwc.georgia.gov/employer-information", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "GA", topic: "discrimination", title: "Georgia — federal EEO thresholds govern private employers",
    summary: "Georgia's Fair Employment Practices Act (O.C.G.A. § 45-19-29) covers only PUBLIC employers with 15+. For private employers like Titan, federal law governs: Title VII/ADA at 15+, ADEA at 20+. Georgia has no broad private-sector state anti-discrimination statute.",
    citation: "O.C.G.A. § 45-19-29 (public); federal Title VII/ADA/ADEA for private", source_name: "Baker Donelson GA Guide", source_url: "https://www.bakerdonelson.com/easy-guide-georgia", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "GA", topic: "everify", title: "Georgia E-Verify — 11+ full-time employees",
    summary: "Georgia requires E-Verify for private employers with 11+ full-time employees. Below that threshold GA E-Verify is not mandated (but note SC requires it for ALL employers — apply the stricter rule for cross-state staff).",
    citation: "O.C.G.A. § 13-10-90", source_name: "FirstHR GA Compliance Guide", source_url: "https://firsthr.app/compliance-hub/georgia/georgia-hr-compliance-guide", as_of_date: "2026-07-17",
  },
  {
    jurisdiction: "GA", topic: "non_compete", title: "Georgia non-competes — enforceable up to 2 years",
    summary: "Under the Georgia Restrictive Covenants Act (2011), non-competes are enforceable and presumptively reasonable up to 2 years for employees; courts may 'blue-pencil' overbroad terms. (SC enforces non-competes too but more narrowly and will not blue-pencil — draft SC and GA agreements separately.)",
    citation: "O.C.G.A. § 13-8-50 et seq. (GRCA 2011)", source_name: "FirstHR GA Compliance Guide", source_url: "https://firsthr.app/compliance-hub/georgia/georgia-hr-compliance-guide", as_of_date: "2026-07-17",
  },
];

function seedKB(sqlite: Database.Database) {
  const count = (sqlite.prepare("SELECT COUNT(*) AS n FROM hr_law_kb").get() as any).n as number;
  if (count > 0) return;
  const ins = sqlite.prepare(
    `INSERT INTO hr_law_kb (jurisdiction, topic, title, summary, citation, source_name, source_url, as_of_date)
     VALUES (@jurisdiction, @topic, @title, @summary, @citation, @source_name, @source_url, @as_of_date)`
  );
  const tx = sqlite.transaction((rows: typeof KB_SEED) => { for (const r of rows) ins.run(r); });
  tx(KB_SEED);
}

// Seed a couple of default trainings relevant to restoration.
function seedTrainings(sqlite: Database.Database) {
  const count = (sqlite.prepare("SELECT COUNT(*) AS n FROM hr_trainings").get() as any).n as number;
  if (count > 0) return;
  const ins = sqlite.prepare(
    `INSERT INTO hr_trainings (name, category, description, recurrence_months, required) VALUES (?, ?, ?, ?, 1)`
  );
  const defaults: Array<[string, string, string, number]> = [
    ["OSHA 10-Hour General Industry", "osha", "Baseline OSHA safety training for field crews.", 0],
    ["Bloodborne Pathogens / Biohazard Safety", "safety", "Required for sewage/trauma/biohazard remediation work.", 12],
    ["IICRC WRT — Water Damage Restoration", "iicrc", "Water Restoration Technician certification.", 48],
    ["Respirator Fit Test & Use", "safety", "Annual respirator fit test and use training (mold/asbestos).", 12],
    ["Harassment & Anti-Discrimination", "compliance", "Workplace conduct, harassment prevention, reporting.", 12],
    ["New-Hire Orientation & Handbook Review", "onboarding", "Company policies, safety, handbook acknowledgment.", 0],
  ];
  const tx = sqlite.transaction(() => { for (const d of defaults) ins.run(...d); });
  tx();
}

// ─────────────────────────────────────────────────────────────────────────────
// Mappers (snake → camel)
// ─────────────────────────────────────────────────────────────────────────────
const camel = (row: any): any => {
  if (!row) return row;
  const out: any = {};
  for (const k of Object.keys(row)) {
    const ck = k.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
    out[ck] = row[k];
  }
  return out;
};
const camelAll = (rows: any[]) => rows.map(camel);

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic fallbacks (when LLM unavailable)
// ─────────────────────────────────────────────────────────────────────────────
function deterministicAnswer(question: string, kb: any[]): string {
  const q = question.toLowerCase();
  const hits = kb.filter(k =>
    q.includes(k.topic.replace(/_/g, " ")) ||
    (k.title && q.split(/\s+/).some((w: string) => w.length > 4 && k.title.toLowerCase().includes(w)))
  ).slice(0, 4);
  const use = hits.length ? hits : kb.slice(0, 4);
  let out = "HR Assistant (Rules mode — AI model unavailable in this environment):\n\n";
  out += "Based on the applicable knowledge base:\n\n";
  for (const k of use) {
    out += `• [${k.jurisdiction.toUpperCase()}] ${k.title}\n  ${k.summary}\n  Cite: ${k.citation} — ${k.source_name} (verified ${k.as_of_date})\n\n`;
  }
  return out.trim();
}

function deterministicWriteup(d: any): string {
  return [
    `EMPLOYEE CORRECTIVE ACTION — ${(d.type || "Written Warning").toUpperCase()}`,
    ``,
    `Employee: ${d.employeeName || "________"}`,
    `Date of incident: ${d.incidentDate || todayISO()}`,
    `Issued by: ${d.issuedBy || "________"}`,
    ``,
    `Subject: ${d.subject || "Policy / performance concern"}`,
    ``,
    `Description of issue:`,
    `${d.details || "Describe the specific behavior, dates, and impact."}`,
    ``,
    `Expected standard / policy:`,
    `Reference the handbook policy and the expected conduct.`,
    ``,
    `Corrective action & next steps:`,
    `${d.correctiveAction || "State the required corrective action and the timeline for improvement. Note that continued issues may result in further discipline up to and including termination."}`,
    ``,
    `Employee acknowledgment: signing confirms receipt, not necessarily agreement.`,
    ``,
    `Employee signature: ____________________   Date: __________`,
    `Supervisor signature: __________________   Date: __________`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Route registration
// ─────────────────────────────────────────────────────────────────────────────
export function registerHRRoutes(app: Express, sqlite: Database.Database) {
  ensureSchema(sqlite);
  seedKB(sqlite);
  seedTrainings(sqlite);

  const { requireStaffAuth, requireRole } = makeAuthMiddleware(sqlite);
  // HR is sensitive — restrict to owner + admin (and general_manager where present).
  const hrAuth = requireRole("owner", "admin", "general_manager");

  const wrap = (fn: (req: Request, res: Response) => any) => (req: Request, res: Response) => {
    Promise.resolve(fn(req, res)).catch((e: any) => {
      console.error("[HR] route error:", e?.message || e);
      if (!res.headersSent) res.status(500).json({ error: e?.message || "HR route error" });
    });
  };
  const actor = (req: any) => (req.employee?.name || "system");

  // ── Employees ──
  app.get("/api/hr/employees", hrAuth, wrap((req, res) => {
    const rows = sqlite.prepare("SELECT * FROM hr_employees ORDER BY status='terminated', last_name, first_name").all();
    res.json(camelAll(rows));
  }));
  app.get("/api/hr/employees/:id", hrAuth, wrap((req, res) => {
    const row = sqlite.prepare("SELECT * FROM hr_employees WHERE id=?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Not found" });
    const docs = sqlite.prepare("SELECT * FROM hr_documents WHERE employee_id=? ORDER BY created_at DESC").all(req.params.id);
    const writeups = sqlite.prepare("SELECT * FROM hr_writeups WHERE employee_id=? ORDER BY created_at DESC").all(req.params.id);
    const reviews = sqlite.prepare("SELECT * FROM hr_reviews WHERE employee_id=? ORDER BY created_at DESC").all(req.params.id);
    const trainings = sqlite.prepare(
      `SELECT ta.*, t.name AS training_name, t.category AS training_category
       FROM hr_training_assignments ta JOIN hr_trainings t ON t.id=ta.training_id
       WHERE ta.employee_id=? ORDER BY ta.assigned_on DESC`).all(req.params.id);
    res.json({ ...camel(row), documents: camelAll(docs), writeups: camelAll(writeups), reviews: camelAll(reviews), trainings: camelAll(trainings) });
  }));
  app.post("/api/hr/employees", hrAuth, wrap((req, res) => {
    const b = req.body || {};
    if (!b.firstName || !b.lastName) return res.status(400).json({ error: "First and last name required" });
    const info = sqlite.prepare(
      `INSERT INTO hr_employees (first_name, last_name, email, phone, job_title, department, employment_type, status, work_state, hire_date, pay_type, pay_rate, emergency_contact, emergency_phone, notes, i9_on_file, w4_on_file, everify_done)
       VALUES (@firstName,@lastName,@email,@phone,@jobTitle,@department,@employmentType,@status,@workState,@hireDate,@payType,@payRate,@emergencyContact,@emergencyPhone,@notes,@i9,@w4,@everify)`
    ).run({
      firstName: b.firstName, lastName: b.lastName, email: b.email || null, phone: b.phone || null,
      jobTitle: b.jobTitle || null, department: b.department || null, employmentType: b.employmentType || "full_time",
      status: b.status || "active", workState: b.workState || "SC", hireDate: b.hireDate || null,
      payType: b.payType || "hourly", payRate: Number(b.payRate) || 0, emergencyContact: b.emergencyContact || null,
      emergencyPhone: b.emergencyPhone || null, notes: b.notes || null,
      i9: b.i9OnFile ? 1 : 0, w4: b.w4OnFile ? 1 : 0, everify: b.everifyDone ? 1 : 0,
    });
    writeAudit(sqlite, req.employee?.id ?? null, actor(req), "hr_employee_create", "hr_employee", info.lastInsertRowid, `${b.firstName} ${b.lastName}`);
    res.json(camel(sqlite.prepare("SELECT * FROM hr_employees WHERE id=?").get(info.lastInsertRowid)));
  }));
  app.patch("/api/hr/employees/:id", hrAuth, wrap((req, res) => {
    const b = req.body || {};
    const map: Record<string, string> = {
      firstName: "first_name", lastName: "last_name", email: "email", phone: "phone", jobTitle: "job_title",
      department: "department", employmentType: "employment_type", status: "status", workState: "work_state",
      hireDate: "hire_date", terminationDate: "termination_date", payType: "pay_type", payRate: "pay_rate",
      emergencyContact: "emergency_contact", emergencyPhone: "emergency_phone", notes: "notes",
    };
    const bools: Record<string, string> = { i9OnFile: "i9_on_file", w4OnFile: "w4_on_file", everifyDone: "everify_done" };
    const sets: string[] = []; const vals: any[] = [];
    for (const [k, col] of Object.entries(map)) if (k in b) { sets.push(`${col}=?`); vals.push(b[k]); }
    for (const [k, col] of Object.entries(bools)) if (k in b) { sets.push(`${col}=?`); vals.push(b[k] ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ error: "No fields" });
    sets.push("updated_at=datetime('now')");
    vals.push(req.params.id);
    sqlite.prepare(`UPDATE hr_employees SET ${sets.join(", ")} WHERE id=?`).run(...vals);
    res.json(camel(sqlite.prepare("SELECT * FROM hr_employees WHERE id=?").get(req.params.id)));
  }));
  app.delete("/api/hr/employees/:id", hrAuth, wrap((req, res) => {
    sqlite.prepare("DELETE FROM hr_employees WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  }));

  // ── Documents ──
  app.post("/api/hr/documents", hrAuth, wrap((req, res) => {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ error: "Title required" });
    const info = sqlite.prepare(
      `INSERT INTO hr_documents (employee_id, doc_type, title, file_ref, body, expires_on, created_by)
       VALUES (?,?,?,?,?,?,?)`
    ).run(b.employeeId || null, b.docType || "other", b.title, b.fileRef || null, b.body || null, b.expiresOn || null, actor(req));
    res.json(camel(sqlite.prepare("SELECT * FROM hr_documents WHERE id=?").get(info.lastInsertRowid)));
  }));
  app.delete("/api/hr/documents/:id", hrAuth, wrap((req, res) => {
    sqlite.prepare("DELETE FROM hr_documents WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  }));

  // ── Handbook ──
  app.get("/api/hr/handbook", hrAuth, wrap((req, res) => {
    res.json(camelAll(sqlite.prepare("SELECT * FROM hr_handbook ORDER BY created_at DESC").all()));
  }));
  app.post("/api/hr/handbook", hrAuth, wrap((req, res) => {
    const b = req.body || {};
    if (!b.title || !b.body) return res.status(400).json({ error: "Title and body required" });
    const info = sqlite.prepare(
      `INSERT INTO hr_handbook (version, title, body, status, effective_date, created_by)
       VALUES (?,?,?,?,?,?)`
    ).run(b.version || "1.0", b.title, b.body, b.status || "draft", b.effectiveDate || null, actor(req));
    res.json(camel(sqlite.prepare("SELECT * FROM hr_handbook WHERE id=?").get(info.lastInsertRowid)));
  }));
  app.patch("/api/hr/handbook/:id", hrAuth, wrap((req, res) => {
    const b = req.body || {};
    const map: Record<string, string> = { version: "version", title: "title", body: "body", status: "status", effectiveDate: "effective_date" };
    const sets: string[] = []; const vals: any[] = [];
    for (const [k, col] of Object.entries(map)) if (k in b) { sets.push(`${col}=?`); vals.push(b[k]); }
    if (!sets.length) return res.status(400).json({ error: "No fields" });
    sets.push("updated_at=datetime('now')"); vals.push(req.params.id);
    sqlite.prepare(`UPDATE hr_handbook SET ${sets.join(", ")} WHERE id=?`).run(...vals);
    res.json(camel(sqlite.prepare("SELECT * FROM hr_handbook WHERE id=?").get(req.params.id)));
  }));
  app.delete("/api/hr/handbook/:id", hrAuth, wrap((req, res) => {
    sqlite.prepare("DELETE FROM hr_handbook WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  }));

  // ── Acknowledgments ──
  app.get("/api/hr/handbook/:id/acknowledgments", hrAuth, wrap((req, res) => {
    const rows = sqlite.prepare(
      `SELECT a.*, e.first_name, e.last_name FROM hr_acknowledgments a
       JOIN hr_employees e ON e.id=a.employee_id WHERE a.handbook_id=? ORDER BY a.created_at DESC`).all(req.params.id);
    res.json(camelAll(rows));
  }));
  app.post("/api/hr/handbook/:id/assign", hrAuth, wrap((req, res) => {
    // Assign acknowledgment tasks to all active employees (or a provided list).
    const ids: number[] = Array.isArray(req.body?.employeeIds) && req.body.employeeIds.length
      ? req.body.employeeIds
      : (sqlite.prepare("SELECT id FROM hr_employees WHERE status='active'").all() as any[]).map(r => r.id);
    const ins = sqlite.prepare("INSERT INTO hr_acknowledgments (handbook_id, employee_id, status) VALUES (?,?, 'pending')");
    const tx = sqlite.transaction(() => { for (const eid of ids) ins.run(req.params.id, eid); });
    tx();
    res.json({ ok: true, assigned: ids.length });
  }));
  app.patch("/api/hr/acknowledgments/:id", hrAuth, wrap((req, res) => {
    sqlite.prepare("UPDATE hr_acknowledgments SET status='acknowledged', acknowledged_at=datetime('now'), signature_name=? WHERE id=?")
      .run(req.body?.signatureName || null, req.params.id);
    res.json({ ok: true });
  }));

  // ── Trainings ──
  app.get("/api/hr/trainings", hrAuth, wrap((req, res) => {
    res.json(camelAll(sqlite.prepare("SELECT * FROM hr_trainings ORDER BY category, name").all()));
  }));
  app.post("/api/hr/trainings", hrAuth, wrap((req, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: "Name required" });
    const info = sqlite.prepare(
      `INSERT INTO hr_trainings (name, category, description, recurrence_months, required) VALUES (?,?,?,?,?)`
    ).run(b.name, b.category || "other", b.description || null, Number(b.recurrenceMonths) || 0, b.required === false ? 0 : 1);
    res.json(camel(sqlite.prepare("SELECT * FROM hr_trainings WHERE id=?").get(info.lastInsertRowid)));
  }));
  app.delete("/api/hr/trainings/:id", hrAuth, wrap((req, res) => {
    sqlite.prepare("DELETE FROM hr_trainings WHERE id=?").run(req.params.id);
    sqlite.prepare("DELETE FROM hr_training_assignments WHERE training_id=?").run(req.params.id);
    res.json({ ok: true });
  }));
  app.get("/api/hr/training-assignments", hrAuth, wrap((req, res) => {
    const rows = sqlite.prepare(
      `SELECT ta.*, t.name AS training_name, t.category AS training_category, e.first_name, e.last_name
       FROM hr_training_assignments ta
       JOIN hr_trainings t ON t.id=ta.training_id
       JOIN hr_employees e ON e.id=ta.employee_id
       ORDER BY (ta.expires_on IS NOT NULL AND ta.expires_on < date('now')) DESC, ta.assigned_on DESC`).all();
    res.json(camelAll(rows));
  }));
  app.post("/api/hr/training-assignments", hrAuth, wrap((req, res) => {
    const b = req.body || {};
    if (!b.trainingId || !b.employeeId) return res.status(400).json({ error: "trainingId and employeeId required" });
    const info = sqlite.prepare(
      `INSERT INTO hr_training_assignments (training_id, employee_id, status, expires_on) VALUES (?,?,?,?)`
    ).run(b.trainingId, b.employeeId, b.status || "assigned", b.expiresOn || null);
    res.json(camel(sqlite.prepare("SELECT * FROM hr_training_assignments WHERE id=?").get(info.lastInsertRowid)));
  }));
  app.patch("/api/hr/training-assignments/:id", hrAuth, wrap((req, res) => {
    const b = req.body || {};
    // Completing a recurring training auto-computes the next expiry.
    if (b.status === "completed") {
      const asg = sqlite.prepare("SELECT * FROM hr_training_assignments WHERE id=?").get(req.params.id) as any;
      let expires = b.expiresOn || null;
      if (!expires && asg) {
        const tr = sqlite.prepare("SELECT recurrence_months FROM hr_trainings WHERE id=?").get(asg.training_id) as any;
        if (tr && tr.recurrence_months > 0) {
          const d = new Date(); d.setMonth(d.getMonth() + tr.recurrence_months);
          expires = d.toISOString().slice(0, 10);
        }
      }
      sqlite.prepare("UPDATE hr_training_assignments SET status='completed', completed_on=date('now'), score=?, expires_on=? WHERE id=?")
        .run(b.score || null, expires, req.params.id);
    } else {
      sqlite.prepare("UPDATE hr_training_assignments SET status=? WHERE id=?").run(b.status || "assigned", req.params.id);
    }
    res.json(camel(sqlite.prepare("SELECT * FROM hr_training_assignments WHERE id=?").get(req.params.id)));
  }));

  // ── Write-ups ──
  app.get("/api/hr/writeups", hrAuth, wrap((req, res) => {
    const rows = sqlite.prepare(
      `SELECT w.*, e.first_name, e.last_name FROM hr_writeups w
       JOIN hr_employees e ON e.id=w.employee_id ORDER BY w.created_at DESC`).all();
    res.json(camelAll(rows));
  }));
  app.post("/api/hr/writeups", hrAuth, wrap((req, res) => {
    const b = req.body || {};
    if (!b.employeeId) return res.status(400).json({ error: "employeeId required" });
    const info = sqlite.prepare(
      `INSERT INTO hr_writeups (employee_id, type, severity, incident_date, subject, body, corrective_action, issued_by)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(b.employeeId, b.type || "verbal", b.severity || "minor", b.incidentDate || todayISO(),
      b.subject || null, b.body || null, b.correctiveAction || null, b.issuedBy || actor(req));
    writeAudit(sqlite, req.employee?.id ?? null, actor(req), "hr_writeup_create", "hr_writeup", info.lastInsertRowid, b.subject || "");
    res.json(camel(sqlite.prepare("SELECT * FROM hr_writeups WHERE id=?").get(info.lastInsertRowid)));
  }));
  app.patch("/api/hr/writeups/:id", hrAuth, wrap((req, res) => {
    const b = req.body || {};
    const map: Record<string, string> = { type: "type", severity: "severity", incidentDate: "incident_date", subject: "subject", body: "body", correctiveAction: "corrective_action" };
    const sets: string[] = []; const vals: any[] = [];
    for (const [k, col] of Object.entries(map)) if (k in b) { sets.push(`${col}=?`); vals.push(b[k]); }
    if ("employeeAck" in b) { sets.push("employee_ack=?", "employee_ack_at=datetime('now')"); vals.push(b.employeeAck ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ error: "No fields" });
    vals.push(req.params.id);
    sqlite.prepare(`UPDATE hr_writeups SET ${sets.join(", ")} WHERE id=?`).run(...vals);
    res.json(camel(sqlite.prepare("SELECT * FROM hr_writeups WHERE id=?").get(req.params.id)));
  }));
  app.delete("/api/hr/writeups/:id", hrAuth, wrap((req, res) => {
    sqlite.prepare("DELETE FROM hr_writeups WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  }));

  // ── Reviews ──
  app.get("/api/hr/reviews", hrAuth, wrap((req, res) => {
    const rows = sqlite.prepare(
      `SELECT r.*, e.first_name, e.last_name FROM hr_reviews r
       JOIN hr_employees e ON e.id=r.employee_id ORDER BY r.created_at DESC`).all();
    res.json(camelAll(rows));
  }));
  app.post("/api/hr/reviews", hrAuth, wrap((req, res) => {
    const b = req.body || {};
    if (!b.employeeId) return res.status(400).json({ error: "employeeId required" });
    const info = sqlite.prepare(
      `INSERT INTO hr_reviews (employee_id, period, review_date, overall_rating, strengths, areas_for_growth, goals, reviewer, status)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(b.employeeId, b.period || null, b.reviewDate || todayISO(), b.overallRating || null,
      b.strengths || null, b.areasForGrowth || null, b.goals || null, b.reviewer || actor(req), b.status || "draft");
    res.json(camel(sqlite.prepare("SELECT * FROM hr_reviews WHERE id=?").get(info.lastInsertRowid)));
  }));
  app.patch("/api/hr/reviews/:id", hrAuth, wrap((req, res) => {
    const b = req.body || {};
    const map: Record<string, string> = { period: "period", reviewDate: "review_date", overallRating: "overall_rating", strengths: "strengths", areasForGrowth: "areas_for_growth", goals: "goals", reviewer: "reviewer", status: "status" };
    const sets: string[] = []; const vals: any[] = [];
    for (const [k, col] of Object.entries(map)) if (k in b) { sets.push(`${col}=?`); vals.push(b[k]); }
    if (!sets.length) return res.status(400).json({ error: "No fields" });
    vals.push(req.params.id);
    sqlite.prepare(`UPDATE hr_reviews SET ${sets.join(", ")} WHERE id=?`).run(...vals);
    res.json(camel(sqlite.prepare("SELECT * FROM hr_reviews WHERE id=?").get(req.params.id)));
  }));
  app.delete("/api/hr/reviews/:id", hrAuth, wrap((req, res) => {
    sqlite.prepare("DELETE FROM hr_reviews WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  }));

  // ── PTO / Time-off requests ──────────────────────────────────────────────
  app.get("/api/hr/timeoff", hrAuth, wrap((req, res) => {
    const emp = req.query.employeeId;
    const status = req.query.status;
    let sql = `SELECT t.*, e.first_name, e.last_name FROM hr_timeoff t
               JOIN hr_employees e ON e.id=t.employee_id`;
    const where: string[] = []; const vals: any[] = [];
    if (emp) { where.push("t.employee_id=?"); vals.push(emp); }
    if (status) { where.push("t.status=?"); vals.push(status); }
    if (where.length) sql += " WHERE " + where.join(" AND ");
    sql += " ORDER BY t.start_date DESC";
    res.json(camelAll(sqlite.prepare(sql).all(...vals)));
  }));
  app.post("/api/hr/timeoff", hrAuth, wrap((req, res) => {
    const b = req.body || {};
    if (!b.employeeId) return res.status(400).json({ error: "employeeId required" });
    if (!b.startDate || !b.endDate) return res.status(400).json({ error: "startDate and endDate required" });
    // auto-compute hours from date span if not provided (8h/business day, inclusive)
    let hours = Number(b.hours);
    if (!hours || hours <= 0) hours = businessDaysBetween(b.startDate, b.endDate) * 8;
    const info = sqlite.prepare(
      `INSERT INTO hr_timeoff (employee_id, category, start_date, end_date, hours, reason, status, requested_by)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(b.employeeId, b.category || "pto", b.startDate, b.endDate, hours,
      b.reason || null, b.status || "pending", b.requestedBy || actor(req));
    writeAudit(sqlite, req.employee?.id ?? null, actor(req), "hr_timeoff_create", "hr_timeoff", info.lastInsertRowid, `${b.category || "pto"} ${b.startDate}→${b.endDate}`);
    res.json(camel(sqlite.prepare("SELECT * FROM hr_timeoff WHERE id=?").get(info.lastInsertRowid)));
  }));
  app.patch("/api/hr/timeoff/:id", hrAuth, wrap((req, res) => {
    const b = req.body || {};
    const existing: any = sqlite.prepare("SELECT * FROM hr_timeoff WHERE id=?").get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const map: Record<string, string> = { category: "category", startDate: "start_date", endDate: "end_date", hours: "hours", reason: "reason", decisionNote: "decision_note" };
    const sets: string[] = []; const vals: any[] = [];
    for (const [k, col] of Object.entries(map)) if (k in b) { sets.push(`${col}=?`); vals.push(b[k]); }
    // status change = approval decision; stamp decider + time
    if ("status" in b && b.status !== existing.status) {
      sets.push("status=?", "decided_by=?", "decided_at=datetime('now')");
      vals.push(b.status, b.decidedBy || actor(req));
      writeAudit(sqlite, req.employee?.id ?? null, actor(req), `hr_timeoff_${b.status}`, "hr_timeoff", req.params.id, existing.category);
    }
    if (!sets.length) return res.status(400).json({ error: "No fields" });
    vals.push(req.params.id);
    sqlite.prepare(`UPDATE hr_timeoff SET ${sets.join(", ")} WHERE id=?`).run(...vals);
    res.json(camel(sqlite.prepare("SELECT * FROM hr_timeoff WHERE id=?").get(req.params.id)));
  }));
  app.delete("/api/hr/timeoff/:id", hrAuth, wrap((req, res) => {
    sqlite.prepare("DELETE FROM hr_timeoff WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  }));

  // Dispatch-facing calendar overlay: APPROVED time-off overlapping a date range.
  // Intentionally NOT gated by hrAuth (any authenticated staff can view who is out
  // for scheduling), and returns only name/category/dates — no reason, no balances.
  app.get("/api/hr/timeoff/calendar", wrap((req, res) => {
    const start = String(req.query.start || "");
    const end = String(req.query.end || "");
    const where: string[] = ["t.status='approved'"]; const vals: any[] = [];
    // overlap test: request starts on/before range end AND ends on/after range start
    if (start) { where.push("t.end_date>=?"); vals.push(start); }
    if (end) { where.push("t.start_date<=?"); vals.push(end); }
    const rows: any[] = sqlite.prepare(
      `SELECT t.id, t.employee_id, t.category, t.start_date, t.end_date, t.hours,
              e.first_name, e.last_name
       FROM hr_timeoff t JOIN hr_employees e ON e.id=t.employee_id
       WHERE ${where.join(" AND ")}
       ORDER BY t.start_date`
    ).all(...vals);
    res.json(rows.map((r: any) => ({
      id: r.id,
      employeeId: r.employee_id,
      name: `${r.first_name} ${r.last_name}`.trim(),
      category: r.category,
      startDate: r.start_date,
      endDate: r.end_date,
      hours: r.hours,
    })));
  }));

  // Balances: per-employee allotment vs. approved usage for a given year
  app.get("/api/hr/timeoff-balances", hrAuth, wrap((req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const emps: any[] = sqlite.prepare("SELECT id, first_name, last_name, work_state FROM hr_employees WHERE status != 'terminated' ORDER BY first_name").all();
    const out = emps.map((e) => {
      const balRows: any[] = sqlite.prepare("SELECT category, allotted_hours FROM hr_timeoff_balances WHERE employee_id=? AND year=?").all(e.id, year);
      const alloc: Record<string, number> = {};
      for (const r of balRows) alloc[r.category] = r.allotted_hours;
      // approved + pending usage in that year, per category
      const usageRows: any[] = sqlite.prepare(
        `SELECT category, status, SUM(hours) AS h FROM hr_timeoff
         WHERE employee_id=? AND substr(start_date,1,4)=? AND status IN ('approved','pending')
         GROUP BY category, status`).all(e.id, String(year));
      const used: Record<string, number> = {}; const pending: Record<string, number> = {};
      for (const r of usageRows) {
        if (r.status === "approved") used[r.category] = (used[r.category] || 0) + r.h;
        else pending[r.category] = (pending[r.category] || 0) + r.h;
      }
      const cats = Array.from(new Set(["pto", "sick", ...Object.keys(alloc), ...Object.keys(used), ...Object.keys(pending)]));
      const categories = cats.map((c) => {
        const allotted = alloc[c] || 0; const u = used[c] || 0; const p = pending[c] || 0;
        return { category: c, allottedHours: allotted, usedHours: u, pendingHours: p, remainingHours: Math.round((allotted - u) * 100) / 100 };
      });
      return { employeeId: e.id, name: `${e.first_name} ${e.last_name}`, workState: e.work_state, year, categories };
    });
    res.json(out);
  }));
  app.post("/api/hr/timeoff-balances", hrAuth, wrap((req, res) => {
    const b = req.body || {};
    if (!b.employeeId || !b.category) return res.status(400).json({ error: "employeeId and category required" });
    const year = Number(b.year) || new Date().getFullYear();
    sqlite.prepare(
      `INSERT INTO hr_timeoff_balances (employee_id, year, category, allotted_hours)
       VALUES (?,?,?,?)
       ON CONFLICT(employee_id, year, category) DO UPDATE SET allotted_hours=excluded.allotted_hours`
    ).run(b.employeeId, year, b.category, Number(b.allottedHours) || 0);
    res.json({ ok: true });
  }));

  // ── Knowledge base (read + compliance snapshot) ──
  app.get("/api/hr/law-kb", hrAuth, wrap((req, res) => {
    const j = req.query.jurisdiction as string | undefined;
    const rows = j
      ? sqlite.prepare("SELECT * FROM hr_law_kb WHERE jurisdiction=? ORDER BY topic").all(j)
      : sqlite.prepare("SELECT * FROM hr_law_kb ORDER BY jurisdiction, topic").all();
    res.json(camelAll(rows));
  }));

  // Compliance snapshot for the dashboard: headcount-driven flags for SC + GA.
  app.get("/api/hr/compliance-snapshot", hrAuth, wrap((req, res) => {
    const emps = sqlite.prepare("SELECT work_state, status, i9_on_file, everify_done FROM hr_employees WHERE status='active'").all() as any[];
    const total = emps.length;
    const sc = emps.filter(e => (e.work_state || "SC") === "SC").length;
    const ga = emps.filter(e => e.work_state === "GA").length;
    const missingI9 = emps.filter(e => !e.i9_on_file).length;
    const missingEverify = emps.filter(e => !e.everify_done).length;
    const flags: Array<{ level: string; text: string }> = [];
    // Workers' comp
    if (sc >= 4) flags.push({ level: "info", text: `SC workers' comp required (${sc} SC employees ≥ 4 threshold).` });
    if (ga >= 3) flags.push({ level: "info", text: `GA workers' comp required (${ga} GA employees ≥ 3 threshold, lowered Jan 2026).` });
    // Discrimination
    if (total >= 15) flags.push({ level: "info", text: `Title VII / ADA & SCHAL apply (${total} employees ≥ 15).` });
    if (total >= 20) flags.push({ level: "info", text: `ADEA (age 40+) applies (${total} employees ≥ 20).` });
    if (total >= 50) flags.push({ level: "warn", text: `FMLA may apply (${total} employees ≥ 50 within 75 miles). Confirm eligibility.` });
    // E-Verify
    if (sc > 0 && missingEverify > 0) flags.push({ level: "warn", text: `SC mandates E-Verify for ALL private employers — ${missingEverify} active employee(s) missing E-Verify.` });
    if (missingI9 > 0) flags.push({ level: "warn", text: `${missingI9} active employee(s) missing Form I-9 on file (required for every hire).` });
    if (!flags.length) flags.push({ level: "ok", text: "No headcount-based compliance triggers flagged." });
    res.json({ total, sc, ga, missingI9, missingEverify, flags, asOf: todayISO() });
  }));

  // ── AI HR Assistant ──
  // mode = "assistant" (Q&A) | "draft" (generate a document)
  app.post("/api/hr/ai", hrAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const mode = b.mode === "draft" ? "draft" : "assistant";
    const topic = String(b.topic || b.docType || "").trim();
    const question = String(b.question || b.prompt || "").trim();
    const state = (b.workState || "").toUpperCase(); // optional focus: SC or GA
    if (!question && mode === "assistant") return res.status(400).json({ error: "question required" });

    // Retrieval: pull the applicable KB (federal always + requested state, or all).
    const kb = state === "SC" || state === "GA"
      ? sqlite.prepare("SELECT * FROM hr_law_kb WHERE jurisdiction IN ('federal', ?) ORDER BY jurisdiction, topic").all(state) as any[]
      : sqlite.prepare("SELECT * FROM hr_law_kb ORDER BY jurisdiction, topic").all() as any[];

    const highRisk = isHighRisk(topic) || isHighRisk(question);
    const kbCamel = camelAll(kb);

    let text = "";
    let usedLlm = false;

    if (llmAvailable()) {
      try {
        const kbBlock = kb.map(k =>
          `[${k.jurisdiction.toUpperCase()} · ${k.topic}] ${k.title}\n${k.summary}\nCitation: ${k.citation} | Source: ${k.source_name} (${k.source_url}) | Verified: ${k.as_of_date}`
        ).join("\n\n");

        const system =
          "You are the Titan Pro HR Assistant for Titan Restoration LLC, a restoration contractor operating in " +
          "South Carolina (HQ) and Georgia. You help the owner with HR: handbook policies, employee documents, " +
          "trainings, write-ups, performance reviews, and employment-law questions.\n\n" +
          "GROUNDING RULES (critical):\n" +
          "1. Answer ONLY from the KNOWLEDGE BASE provided below. If the KB does not cover something, say so plainly " +
          "and recommend confirming with counsel — never invent a statute, number, deadline, or citation.\n" +
          "2. Always cite the specific statute and source name for any legal claim, e.g. '(S.C. Code § 41-10-10)'.\n" +
          "3. Distinguish South Carolina vs Georgia vs federal clearly — the two states differ (e.g. SC workers' comp " +
          "at 4 employees vs GA at 3; SC E-Verify for ALL employers vs GA at 11+; SC treble damages on late final pay).\n" +
          "4. When rules differ across the states where Titan operates, apply the STRICTER rule for multi-state staff and say so.\n" +
          "5. Be direct and practical — write ready-to-use policies and documents, not hedged essays. " +
          "You may produce complete, final documents.\n" +
          (highRisk
            ? "6. This request touches a HIGH-LIABILITY area (termination, discipline, leave, or discrimination). " +
              "Produce the complete document, but keep it factual, behavior-based, and legally defensible. Do NOT add your own disclaimer — the system appends the required legal-review notice."
            : "6. Produce a complete, final, professional result.");

        const userMsg = mode === "draft"
          ? `Generate a complete, ready-to-use ${topic || "HR document"} for Titan Restoration LLC.\n` +
            (state ? `Applicable state: ${state}.\n` : `Cover both SC and GA where relevant.\n`) +
            `Details / context:\n${question || "(use sensible restoration-industry defaults)"}\n\n` +
            `Format it cleanly with headers. Cite the specific statutes from the KB where the document relies on a legal requirement.\n\n` +
            `KNOWLEDGE BASE:\n${kbBlock}`
          : `Question: ${question}\n` +
            (state ? `Focus state: ${state}.\n` : ``) +
            `Answer using only the KNOWLEDGE BASE below, citing statutes and sources.\n\n` +
            `KNOWLEDGE BASE:\n${kbBlock}`;

        text = await askLLM(system, userMsg, mode === "draft" ? 3000 : 1800);
        usedLlm = true;
      } catch (e: any) {
        console.error("[HR AI] LLM error, falling back:", e?.message || e);
      }
    }

    if (!text) {
      // Deterministic fallback.
      text = mode === "draft" && isHighRisk(topic)
        ? deterministicWriteup({ type: topic, ...b })
        : deterministicAnswer(question || topic, kb);
    }

    if (highRisk) text += DISCLAIMER;

    sqlite.prepare(
      `INSERT INTO hr_ai_logs (mode, topic, prompt, response, high_risk, used_llm, run_by)
       VALUES (?,?,?,?,?,?,?)`
    ).run(mode, topic || null, question || null, text, highRisk ? 1 : 0, usedLlm ? 1 : 0, actor(req));

    res.json({
      mode, topic, highRisk, usedLlm,
      simulated: !usedLlm,
      answer: text,
      sourcesUsed: kbCamel.map((k: any) => ({ jurisdiction: k.jurisdiction, title: k.title, citation: k.citation, sourceUrl: k.sourceUrl, asOfDate: k.asOfDate })),
    });
  }));
}
