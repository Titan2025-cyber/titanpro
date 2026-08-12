/**
 * routes_subcontractors.ts
 *
 * Subcontractor Compliance Vault
 * --------------------------------
 * One record per sub, holding all their compliance artifacts in one place:
 *   - Certificate of Insurance (COI)
 *   - Workers Comp Certificate (or exempt reason)
 *   - W-9 form
 *   - Optional extras: business license, contractor license, bond, MSA, etc.
 *
 * Each document is a row in `subcontractor_documents` referencing a file
 * uploaded through the existing S3 pipeline (storage_key). We don't store
 * base64 in the primary DB — this keeps SQLite lean and matches the same
 * pattern used by job_documents.
 *
 * Tax ID handling
 * ---------------
 * We deliberately never store the full EIN/SSN in cleartext. On write we
 * capture just the last 4 digits (`tax_id_last4`) plus a SHA-256 hash of
 * the full number (`tax_id_hash`) so future writes can detect duplicates
 * or verify a re-entered value without ever having to reveal the original.
 *
 * Job history
 * -----------
 * Job history is computed on demand by fuzzy-matching `job_costs.vendor`
 * against the subcontractor's business name / dba (case-insensitive). No
 * back-reference column needed — this keeps legacy job_costs entries
 * automatically linked once a sub is added.
 */
import type { Express, Request, Response } from "express";
import type Database from "better-sqlite3";
import * as crypto from "crypto";
import { writeImageFieldSafe } from "./image_pipeline";
import * as objectStorage from "./storage_s3";

type Handler = (req: Request, res: Response, next?: any) => any;
const wrap = (fn: Handler): Handler => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e: any) {
    console.error("[subcontractors]", e);
    res.status(500).json({ error: e?.message || "Server error" });
  }
};

// SHA-256 of full tax id; used only to compare re-entered values against
// a previously captured one. Cannot recover the original from the hash.
const hashTaxId = (raw: string) =>
  crypto.createHash("sha256").update(String(raw).replace(/\D/g, "")).digest("hex");

const last4 = (raw: string) => {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.slice(-4);
};

const nowIso = () => new Date().toISOString();

// Trades most common in Titan's world. Free-text is still allowed via "other".
export const SUB_TRADES = [
  "General Contractor", "Framing", "Drywall", "Painting", "Flooring",
  "Roofing", "Plumbing", "Electrical", "HVAC", "Cabinetry", "Countertops",
  "Tile", "Cleaning", "Demolition", "Debris Hauling", "Content Cleaning",
  "Mold Remediation", "Asbestos", "Lead", "Other",
];

// Doc types we support in the vault. The 3 "core" ones drive the
// compliance badge; everything else is bonus.
export const SUB_DOC_TYPES = [
  { value: "coi",           label: "Certificate of Insurance (COI)", core: true },
  { value: "workers_comp",  label: "Workers Comp",                   core: true },
  { value: "w9",            label: "W-9",                            core: true },
  { value: "business_license", label: "Business License",            core: false },
  { value: "contractor_license", label: "Contractor License",        core: false },
  { value: "bond",          label: "Bond",                           core: false },
  { value: "msa",           label: "Subcontract / MSA",              core: false },
  { value: "other",         label: "Other Document",                 core: false },
];

export function registerSubcontractorRoutes(
  app: Express,
  sqlite: Database.Database,
  requireStaffAuth: any
) {
  // ── Schema ─────────────────────────────────────────────────────────────
  // Defensive CREATE — matches the pattern used elsewhere in routes.ts so
  // the endpoint stays functional on fresh DBs or older backups.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS subcontractors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_name TEXT NOT NULL,
      dba TEXT,
      trade TEXT,
      contact_name TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,

      -- Tax reporting
      tax_id_type TEXT DEFAULT 'ein',      -- 'ein' | 'ssn'
      tax_id_last4 TEXT,                    -- displayed as \u2022\u2022\u2022-1234
      tax_id_hash TEXT,                     -- SHA-256 of full digits, never reversible
      is_1099_eligible INTEGER DEFAULT 1,

      -- Ratings + status
      rating INTEGER,                       -- 1-5 stars, nullable
      preferred INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',         -- 'active' | 'inactive' | 'blocked'
      notes TEXT,

      -- Workers comp exemption (some solo subs are legally exempt in GA/SC)
      wc_exempt INTEGER DEFAULT 0,
      wc_exempt_reason TEXT,

      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS subcontractor_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subcontractor_id INTEGER NOT NULL,
      doc_type TEXT NOT NULL,               -- 'coi' | 'workers_comp' | 'w9' | ...
      title TEXT,                            -- optional display label
      -- File storage \u2014 identical convention to job_documents
      file_name TEXT,
      file_mime_type TEXT,
      file_size INTEGER,
      storage_key TEXT,                     -- S3 key when bucket is configured
      file_data TEXT,                       -- legacy inline base64 fallback

      -- COI / WC fields
      carrier TEXT,
      policy_number TEXT,
      effective_date TEXT,
      expiration_date TEXT,
      gl_each_occurrence REAL,
      gl_aggregate REAL,
      auto_limit REAL,
      umbrella_limit REAL,
      additional_insured INTEGER DEFAULT 0,
      waiver_of_subrogation INTEGER DEFAULT 0,

      -- Freeform notes / verifier
      verified_by TEXT,
      verified_at TEXT,
      notes TEXT,

      -- Follow-ups already sent (dedupe expiration reminders)
      alert_sent_60 INTEGER DEFAULT 0,
      alert_sent_30 INTEGER DEFAULT 0,
      alert_sent_7 INTEGER DEFAULT 0,

      created_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(subcontractor_id) REFERENCES subcontractors(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_subdocs_sub ON subcontractor_documents(subcontractor_id);
    CREATE INDEX IF NOT EXISTS idx_subdocs_type ON subcontractor_documents(doc_type);
    CREATE INDEX IF NOT EXISTS idx_subdocs_exp ON subcontractor_documents(expiration_date);
  `);

  // ── Helpers ────────────────────────────────────────────────────────────
  /**
   * Compute a compliance snapshot for a sub: which of the three core docs
   * are present, when the earliest one expires, and an overall status.
   *   - "compliant"      \u2192 all 3 core docs present, none expired
   *   - "expiring_soon"  \u2192 all present but at least one within 30 days
   *   - "expired"        \u2192 at least one core doc past expiration
   *   - "incomplete"     \u2192 missing one or more core docs
   * WC-exempt subs get a pass on the workers_comp requirement.
   */
  function complianceFor(subId: number) {
    const sub = sqlite.prepare("SELECT wc_exempt FROM subcontractors WHERE id = ?").get(subId) as any;
    const wcExempt = !!(sub && sub.wc_exempt);

    const docs = sqlite.prepare(
      "SELECT doc_type, expiration_date FROM subcontractor_documents WHERE subcontractor_id = ?"
    ).all(subId) as any[];

    const required = ["coi", "w9", ...(wcExempt ? [] : ["workers_comp"])];
    const now = Date.now();
    const DAY = 86_400_000;
    const status: Record<string, any> = {};
    let overall: "compliant" | "expiring_soon" | "expired" | "incomplete" = "compliant";
    let nextExpiration: string | null = null;

    for (const t of required) {
      const rows = docs.filter(d => d.doc_type === t);
      if (!rows.length) {
        status[t] = { present: false };
        overall = "incomplete";
        continue;
      }
      // Take the most recent one with the furthest-out expiration.
      const latest = rows
        .filter(r => r.expiration_date)
        .sort((a, b) => (b.expiration_date || "").localeCompare(a.expiration_date || ""))[0] || rows[0];
      const exp = latest.expiration_date ? new Date(latest.expiration_date).getTime() : null;
      const daysLeft = exp != null ? Math.floor((exp - now) / DAY) : null;

      status[t] = {
        present: true,
        expiration_date: latest.expiration_date || null,
        days_left: daysLeft,
      };

      if (exp != null) {
        if (!nextExpiration || latest.expiration_date < nextExpiration) {
          nextExpiration = latest.expiration_date;
        }
      }

      // W-9 has no expiration \u2014 skip freshness check for it.
      if (t !== "w9" && exp != null) {
        if (daysLeft! < 0 && overall !== "incomplete") overall = "expired";
        else if (daysLeft! <= 30 && overall === "compliant") overall = "expiring_soon";
      }
    }

    if (wcExempt) status["workers_comp"] = { exempt: true };

    return { overall, next_expiration: nextExpiration, docs: status };
  }

  /**
   * Auto-linked job history \u2014 fuzzy-match on vendor name against the sub's
   * business_name / dba. Case-insensitive substring on either side.
   */
  function jobHistoryFor(sub: any) {
    const names = [sub.business_name, sub.dba].filter(Boolean).map((n: string) => n.toLowerCase());
    if (!names.length) return { total_paid: 0, job_count: 0, last_job_date: null, ytd_paid: 0, jobs: [] };
    const like = names.map(n => `%${n}%`);
    const placeholders = like.map(() => "LOWER(vendor) LIKE ?").join(" OR ");

    const rows = sqlite.prepare(`
      SELECT job_id, cost_date, total, description
        FROM job_costs
       WHERE (${placeholders}) AND category = 'subcontractor'
       ORDER BY cost_date DESC
    `).all(...like) as any[];

    const yearStart = `${new Date().getFullYear()}-01-01`;
    let total = 0, ytd = 0;
    for (const r of rows) {
      total += r.total || 0;
      if ((r.cost_date || "") >= yearStart) ytd += r.total || 0;
    }
    const jobIds = Array.from(new Set(rows.map(r => r.job_id))).slice(0, 25);
    return {
      total_paid: total,
      ytd_paid: ytd,
      job_count: new Set(rows.map(r => r.job_id)).size,
      last_job_date: rows[0]?.cost_date || null,
      recent: rows.slice(0, 10),
      job_ids: jobIds,
    };
  }

  // Hydrate a document row: turn storage_key into a signed S3 URL for the client.
  async function hydrateDoc(d: any) {
    if (!d) return d;
    if (d.storage_key && objectStorage.isConfigured()) {
      try { d.file_url = await objectStorage.getReadUrl(d.storage_key); }
      catch { d.file_url = null; }
    } else if (d.file_data) {
      d.file_url = d.file_data;   // legacy base64 fallback
    }
    return d;
  }

  // ── Routes ─────────────────────────────────────────────────────────────

  // List all subs + summary stats for the dashboard.
  app.get("/api/subcontractors", requireStaffAuth, wrap(async (_req, res) => {
    const rows = sqlite.prepare(`
      SELECT * FROM subcontractors ORDER BY status ASC, business_name COLLATE NOCASE ASC
    `).all() as any[];

    for (const s of rows) {
      s.compliance = complianceFor(s.id);
      // Cheap counts for the list \u2014 full job history is available on detail.
      const totals = sqlite.prepare(`
        SELECT COALESCE(SUM(total),0) as total, COUNT(DISTINCT job_id) as jobs
          FROM job_costs
         WHERE category = 'subcontractor'
           AND (LOWER(vendor) LIKE ? OR LOWER(vendor) LIKE ?)
      `).get(
        `%${(s.business_name || "").toLowerCase()}%`,
        `%${(s.dba || s.business_name || "").toLowerCase()}%`,
      ) as any;
      s.total_paid = totals?.total || 0;
      s.job_count  = totals?.jobs  || 0;
    }
    res.json(rows);
  }));

  // Detail: sub + all docs (hydrated) + job history.
  app.get("/api/subcontractors/:id", requireStaffAuth, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const sub = sqlite.prepare("SELECT * FROM subcontractors WHERE id = ?").get(id) as any;
    if (!sub) return res.status(404).json({ error: "Not found" });

    const docs = sqlite.prepare(
      "SELECT * FROM subcontractor_documents WHERE subcontractor_id = ? ORDER BY doc_type, created_at DESC"
    ).all(id) as any[];
    for (const d of docs) await hydrateDoc(d);

    sub.documents = docs;
    sub.compliance = complianceFor(id);
    sub.job_history = jobHistoryFor(sub);
    res.json(sub);
  }));

  // Create a sub. Tax ID handling: take the raw value once, split into
  // last4 + hash, then throw away the full number.
  app.post("/api/subcontractors", requireStaffAuth, wrap(async (req: any, res) => {
    const b = req.body || {};
    const rawTaxId = b.tax_id || b.taxId || "";
    const tax_id_last4 = rawTaxId ? last4(rawTaxId) : null;
    const tax_id_hash  = rawTaxId ? hashTaxId(rawTaxId) : null;

    const created_by = req.user?.name || req.staff?.name || "unknown";
    const now = nowIso();

    const stmt = sqlite.prepare(`
      INSERT INTO subcontractors (
        business_name, dba, trade, contact_name, phone, email,
        address, city, state, zip,
        tax_id_type, tax_id_last4, tax_id_hash, is_1099_eligible,
        rating, preferred, status, notes,
        wc_exempt, wc_exempt_reason,
        created_by, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      RETURNING *
    `);
    const row = stmt.get(
      b.business_name, b.dba || null, b.trade || null, b.contact_name || null,
      b.phone || null, b.email || null,
      b.address || null, b.city || null, b.state || null, b.zip || null,
      b.tax_id_type || "ein", tax_id_last4, tax_id_hash,
      b.is_1099_eligible === false ? 0 : 1,
      b.rating || null, b.preferred ? 1 : 0, b.status || "active", b.notes || null,
      b.wc_exempt ? 1 : 0, b.wc_exempt_reason || null,
      created_by, now, now,
    );
    res.json(row);
  }));

  // Update. Tax ID is only re-hashed if a new raw value comes in.
  app.patch("/api/subcontractors/:id", requireStaffAuth, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const existing = sqlite.prepare("SELECT * FROM subcontractors WHERE id = ?").get(id) as any;
    if (!existing) return res.status(404).json({ error: "Not found" });

    const b = req.body || {};
    const patch: any = {};
    const fields = [
      "business_name","dba","trade","contact_name","phone","email",
      "address","city","state","zip","tax_id_type","is_1099_eligible",
      "rating","preferred","status","notes","wc_exempt","wc_exempt_reason",
    ];
    for (const f of fields) if (f in b) patch[f] = b[f];

    if (b.tax_id) {
      patch.tax_id_last4 = last4(b.tax_id);
      patch.tax_id_hash  = hashTaxId(b.tax_id);
    }
    patch.updated_at = nowIso();

    const keys = Object.keys(patch);
    if (!keys.length) return res.json(existing);
    const setClause = keys.map(k => `${k} = ?`).join(", ");
    const vals = keys.map(k => {
      const v = (patch as any)[k];
      // Coerce booleans to 0/1 for the flag columns.
      if (typeof v === "boolean") return v ? 1 : 0;
      return v;
    });
    sqlite.prepare(`UPDATE subcontractors SET ${setClause} WHERE id = ?`).run(...vals, id);

    const updated = sqlite.prepare("SELECT * FROM subcontractors WHERE id = ?").get(id);
    res.json(updated);
  }));

  app.delete("/api/subcontractors/:id", requireStaffAuth, wrap(async (req, res) => {
    const id = Number(req.params.id);
    sqlite.prepare("DELETE FROM subcontractor_documents WHERE subcontractor_id = ?").run(id);
    sqlite.prepare("DELETE FROM subcontractors WHERE id = ?").run(id);
    res.json({ success: true });
  }));

  // ── Documents ───────────────────────────────────────────────────────────
  // Uploads accept either a data URL in `fileData` (browser \u2192 base64) or
  // an already-uploaded storage_key. writeImageFieldSafe handles both.
  app.get("/api/subcontractors/:id/documents", requireStaffAuth, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const docs = sqlite.prepare(
      "SELECT * FROM subcontractor_documents WHERE subcontractor_id = ? ORDER BY doc_type, created_at DESC"
    ).all(id) as any[];
    for (const d of docs) await hydrateDoc(d);
    res.json(docs);
  }));

  app.post("/api/subcontractors/:id/documents", requireStaffAuth, wrap(async (req, res) => {
    const id = Number(req.params.id);
    const exists = sqlite.prepare("SELECT id FROM subcontractors WHERE id = ?").get(id);
    if (!exists) return res.status(404).json({ error: "Subcontractor not found" });

    const b = req.body || {};
    if (!b.doc_type) return res.status(400).json({ error: "doc_type is required" });

    // Push binary payload to the bucket if configured. writeImageFieldSafe
    // is used across the app for photos, signatures, and job_documents \u2014
    // it accepts application/pdf and other MIME types just fine.
    let storage_key: string | null = null;
    let file_data: string | null = null;
    if (b.file_data || b.fileData) {
      const stored = await writeImageFieldSafe(b.file_data ?? b.fileData, "subcontractor-docs");
      storage_key = stored.storageKey || null;
      file_data   = stored.storageKey ? null : (stored.dataUrl || null);
    }

    const now = nowIso();
    const row = sqlite.prepare(`
      INSERT INTO subcontractor_documents (
        subcontractor_id, doc_type, title,
        file_name, file_mime_type, file_size, storage_key, file_data,
        carrier, policy_number, effective_date, expiration_date,
        gl_each_occurrence, gl_aggregate, auto_limit, umbrella_limit,
        additional_insured, waiver_of_subrogation,
        verified_by, verified_at, notes, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      RETURNING *
    `).get(
      id, b.doc_type, b.title || null,
      b.file_name || null, b.file_mime_type || null, b.file_size || null,
      storage_key, file_data,
      b.carrier || null, b.policy_number || null,
      b.effective_date || null, b.expiration_date || null,
      b.gl_each_occurrence || null, b.gl_aggregate || null,
      b.auto_limit || null, b.umbrella_limit || null,
      b.additional_insured ? 1 : 0, b.waiver_of_subrogation ? 1 : 0,
      b.verified_by || null, b.verified_at || null,
      b.notes || null, now,
    );
    await hydrateDoc(row);
    res.json(row);
  }));

  app.patch("/api/subcontractors/:subId/documents/:docId", requireStaffAuth, wrap(async (req, res) => {
    const subId = Number(req.params.subId);
    const docId = Number(req.params.docId);
    const b = req.body || {};

    // Replace the file only if a new blob was posted.
    let storageUpdate: string[] = [];
    let storageVals: any[] = [];
    if (b.file_data || b.fileData) {
      const stored = await writeImageFieldSafe(b.file_data ?? b.fileData, "subcontractor-docs");
      if (stored.storageKey) {
        storageUpdate.push("storage_key = ?", "file_data = ?");
        storageVals.push(stored.storageKey, null);
      } else if (stored.dataUrl) {
        storageUpdate.push("file_data = ?", "storage_key = ?");
        storageVals.push(stored.dataUrl, null);
      }
    }

    const scalarFields = [
      "doc_type","title","file_name","file_mime_type","file_size",
      "carrier","policy_number","effective_date","expiration_date",
      "gl_each_occurrence","gl_aggregate","auto_limit","umbrella_limit",
      "verified_by","verified_at","notes",
    ];
    const setParts: string[] = [];
    const vals: any[] = [];
    for (const f of scalarFields) {
      if (f in b) { setParts.push(`${f} = ?`); vals.push(b[f]); }
    }
    for (const boolField of ["additional_insured","waiver_of_subrogation"]) {
      if (boolField in b) { setParts.push(`${boolField} = ?`); vals.push(b[boolField] ? 1 : 0); }
    }
    setParts.push(...storageUpdate);
    vals.push(...storageVals);

    if (!setParts.length) {
      const cur = sqlite.prepare("SELECT * FROM subcontractor_documents WHERE id = ? AND subcontractor_id = ?").get(docId, subId);
      return res.json(cur);
    }

    sqlite.prepare(
      `UPDATE subcontractor_documents SET ${setParts.join(", ")} WHERE id = ? AND subcontractor_id = ?`
    ).run(...vals, docId, subId);

    const updated = sqlite.prepare(
      "SELECT * FROM subcontractor_documents WHERE id = ? AND subcontractor_id = ?"
    ).get(docId, subId) as any;
    await hydrateDoc(updated);
    res.json(updated);
  }));

  app.delete("/api/subcontractors/:subId/documents/:docId", requireStaffAuth, wrap(async (req, res) => {
    sqlite.prepare(
      "DELETE FROM subcontractor_documents WHERE id = ? AND subcontractor_id = ?"
    ).run(Number(req.params.docId), Number(req.params.subId));
    res.json({ success: true });
  }));

  // ── 1099 prep view ─────────────────────────────────────────────────────
  // Given a year, return every 1099-eligible sub with YTD payments so an
  // accountant can generate 1099-NEC forms without a December scramble.
  app.get("/api/subcontractors/reports/1099", requireStaffAuth, wrap(async (req, res) => {
    const year = Number(req.query.year || new Date().getFullYear());
    const yStart = `${year}-01-01`;
    const yEnd   = `${year + 1}-01-01`;
    const subs = sqlite.prepare(
      "SELECT * FROM subcontractors WHERE is_1099_eligible = 1 AND status != 'inactive'"
    ).all() as any[];

    const out: any[] = [];
    for (const s of subs) {
      const names = [s.business_name, s.dba].filter(Boolean).map((n: string) => n.toLowerCase());
      if (!names.length) continue;
      const placeholders = names.map(() => "LOWER(vendor) LIKE ?").join(" OR ");
      const likes = names.map(n => `%${n}%`);
      const paid = sqlite.prepare(`
        SELECT COALESCE(SUM(total), 0) as total
          FROM job_costs
         WHERE category = 'subcontractor'
           AND cost_date >= ? AND cost_date < ?
           AND (${placeholders})
      `).get(yStart, yEnd, ...likes) as any;

      const total = paid?.total || 0;
      if (total > 0) {
        out.push({
          subcontractor_id: s.id,
          business_name: s.business_name,
          dba: s.dba,
          tax_id_last4: s.tax_id_last4,
          tax_id_type: s.tax_id_type,
          has_w9: !!sqlite.prepare(
            "SELECT id FROM subcontractor_documents WHERE subcontractor_id = ? AND doc_type = 'w9' LIMIT 1"
          ).get(s.id),
          address: [s.address, s.city, s.state, s.zip].filter(Boolean).join(", "),
          total_paid: total,
          threshold_met: total >= 600, // IRS 1099-NEC threshold
        });
      }
    }
    out.sort((a, b) => b.total_paid - a.total_paid);
    res.json({ year, count: out.length, subs: out });
  }));
}
