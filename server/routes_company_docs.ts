/**
 * routes_company_docs.ts — Titan's own internal document vault.
 *
 * Scope: OUTBOUND documents Titan sends to others — COI, business license,
 * IICRC certs, W-9, capability statements, safety manual, etc. Completely
 * separate from the SUBCONTRACTOR COI tracker (which is INBOUND compliance).
 *
 * Storage: base64 uploads via JSON (matches the rest of the app). If S3
 * (objectStorage) is configured, we hoist the payload out of SQLite into
 * the bucket and store just a storage_key. Reads return a signed URL.
 *
 * Access: owner + admin + general_manager have full CRUD. Everyone else
 * gets read-only (they can view/download but not upload, edit, or delete).
 *
 * Sharing: a doc can be shared via /api/company-documents/:id/share which
 * mints a random token good for N days (default 30). Public route
 * GET /api/company-doc-public/:token streams the file with no auth,
 * refuses after expiry. Recipient also gets an email with the link.
 *
 * Endpoints
 *   GET    /api/company-documents               list (any staff)
 *   GET    /api/company-documents/:id           metadata + signed URL (any staff)
 *   POST   /api/company-documents               create/upload (owner/admin/gm)
 *   PATCH  /api/company-documents/:id           update meta (owner/admin/gm)
 *   DELETE /api/company-documents/:id           delete (owner/admin/gm)
 *   POST   /api/company-documents/:id/share     mint share token + email (owner/admin/gm)
 *   GET    /api/company-documents/:id/shares    list live shares (owner/admin/gm)
 *   DELETE /api/company-doc-shares/:id          revoke a share (owner/admin/gm)
 *   GET    /api/company-documents/expiring      dashboard KPI (any staff)
 *   POST   /api/company-documents/scan-expirations   scheduler entry point
 *
 *   GET    /api/company-doc-public/:token       PUBLIC — no auth, honors expiry
 */
import type { Express, Request, Response } from "express";
import type Database from "better-sqlite3";
import crypto from "crypto";
import { makeAuthMiddleware } from "./routes_auth";
import { writeImageFieldSafe } from "./image_pipeline";
import * as objectStorage from "./storage_s3";
import { sendEmail } from "./notify";

// ─────────────────────────────────────────────────────────────────────────────
function ensureSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS company_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      tags TEXT NOT NULL DEFAULT '[]',              -- JSON array of strings
      issuer TEXT,                                   -- e.g. "State Farm", "IICRC", "SC LLR"
      document_number TEXT,                          -- policy #, license #, cert #
      issued_at TEXT,                                -- YYYY-MM-DD
      expires_at TEXT,                               -- YYYY-MM-DD (nullable)
      file_name TEXT,
      file_mime_type TEXT,
      file_data TEXT,                                -- base64 data URI (legacy / small)
      storage_key TEXT,                              -- S3 key (preferred)
      file_size_bytes INTEGER,
      uploaded_by INTEGER,                           -- employee.id
      uploaded_by_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      alert_sent_60 INTEGER NOT NULL DEFAULT 0,
      alert_sent_30 INTEGER NOT NULL DEFAULT 0,
      alert_sent_7 INTEGER NOT NULL DEFAULT 0,
      alert_sent_expired INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_company_docs_deleted ON company_documents(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_company_docs_expires ON company_documents(expires_at);

    CREATE TABLE IF NOT EXISTS company_document_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,                    -- URL-safe random
      recipient_email TEXT,                          -- who we sent it to (informational)
      recipient_name TEXT,
      note TEXT,
      expires_at TEXT NOT NULL,                      -- ISO datetime
      created_by INTEGER,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      view_count INTEGER NOT NULL DEFAULT 0,
      last_viewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_company_doc_shares_token ON company_document_shares(token);
    CREATE INDEX IF NOT EXISTS idx_company_doc_shares_doc ON company_document_shares(document_id);
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
const EDIT_ROLES = ["owner", "admin", "general_manager"];

function todayISO() { return new Date().toISOString().slice(0, 10); }
function nowISO() { return new Date().toISOString(); }

function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / 86_400_000);
}

function safeParseDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Row → API shape. Parses JSON, adds derived fields, hides raw storage
 * bookkeeping the client shouldn't care about.
 */
function shapeRow(row: any) {
  if (!row) return row;
  let tags: string[] = [];
  try { tags = JSON.parse(row.tags || "[]"); } catch {}
  let status: "ok" | "expiring_soon" | "expiring" | "expired" | "no_expiry" = "no_expiry";
  let daysUntilExpiry: number | null = null;
  if (row.expires_at) {
    const d = safeParseDate(row.expires_at);
    if (d) {
      daysUntilExpiry = daysBetween(d, new Date());
      if (daysUntilExpiry < 0) status = "expired";
      else if (daysUntilExpiry <= 7) status = "expiring";
      else if (daysUntilExpiry <= 60) status = "expiring_soon";
      else status = "ok";
    }
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    tags,
    issuer: row.issuer,
    document_number: row.document_number,
    issued_at: row.issued_at,
    expires_at: row.expires_at,
    file_name: row.file_name,
    file_mime_type: row.file_mime_type,
    file_size_bytes: row.file_size_bytes,
    uploaded_by: row.uploaded_by,
    uploaded_by_name: row.uploaded_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    has_file: !!(row.storage_key || row.file_data),
    status,
    days_until_expiry: daysUntilExpiry,
  };
}

/**
 * For a single doc, add a signed URL (S3) or raw data URI (SQLite fallback)
 * on the `file_url` field. Only call this on detail routes — list routes
 * skip it to keep responses lean.
 */
async function attachFileUrl(row: any): Promise<any> {
  if (!row) return row;
  const shaped = shapeRow(row);
  if (row.storage_key && objectStorage.isConfigured()) {
    try {
      const mime = row.file_mime_type || "application/octet-stream";
      const safeName = (row.file_name || `document-${row.id}`).replace(/"/g, "");
      const url = await objectStorage.getReadUrl(row.storage_key, undefined, {
        responseContentType: mime,
        responseContentDisposition: `inline; filename="${safeName}"`,
      });
      return { ...shaped, file_url: url };
    } catch (e) {
      console.error("[company-docs] signed-url failed", e);
    }
  }
  if (row.file_data) {
    return { ...shaped, file_url: row.file_data };
  }
  return shaped;
}

// ─────────────────────────────────────────────────────────────────────────────
export function registerCompanyDocsRoutes(app: Express, sqlite: Database.Database) {
  ensureSchema(sqlite);
  const { requireStaffAuth, requireRole } = makeAuthMiddleware(sqlite);
  const editorOnly = requireRole(...EDIT_ROLES);

  function getUser(req: Request): { id: number; name: string; role: string } | null {
    const e = (req as any).employee;
    if (!e) return null;
    return { id: e.id, name: e.name || "Titan Team", role: e.role || "tech" };
  }

  // ── List (all staff) ──────────────────────────────────────────────────────
  app.get("/api/company-documents", requireStaffAuth, (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    const tag = String(req.query.tag || "").trim().toLowerCase();
    const rows = sqlite.prepare(`
      SELECT * FROM company_documents WHERE deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT 500
    `).all() as any[];
    let filtered = rows.map(shapeRow);
    if (q) {
      filtered = filtered.filter(r =>
        (r.title || "").toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q) ||
        (r.issuer || "").toLowerCase().includes(q) ||
        (r.document_number || "").toLowerCase().includes(q) ||
        (r.tags || []).some((t: string) => t.toLowerCase().includes(q))
      );
    }
    if (tag) {
      filtered = filtered.filter(r => (r.tags || []).some((t: string) => t.toLowerCase() === tag));
    }
    // Collect all unique tags for the filter UI
    const allTags = Array.from(new Set(rows.flatMap(r => {
      try { return JSON.parse(r.tags || "[]"); } catch { return []; }
    }))).sort();
    res.json({ documents: filtered, tags: allTags });
  });

  // ── Expiring (dashboard KPI, all staff) ───────────────────────────────────
  app.get("/api/company-documents/expiring", requireStaffAuth, (_req, res) => {
    const rows = sqlite.prepare(`
      SELECT id, title, expires_at FROM company_documents
      WHERE deleted_at IS NULL AND expires_at IS NOT NULL
    `).all() as any[];
    const now = new Date();
    const buckets = { expired: [] as any[], expiring: [] as any[], expiring_soon: [] as any[] };
    for (const r of rows) {
      const d = safeParseDate(r.expires_at);
      if (!d) continue;
      const days = daysBetween(d, now);
      if (days < 0) buckets.expired.push({ ...r, days_until_expiry: days });
      else if (days <= 7) buckets.expiring.push({ ...r, days_until_expiry: days });
      else if (days <= 60) buckets.expiring_soon.push({ ...r, days_until_expiry: days });
    }
    res.json({
      counts: {
        expired: buckets.expired.length,
        expiring: buckets.expiring.length,
        expiring_soon: buckets.expiring_soon.length,
      },
      ...buckets,
    });
  });

  // ── Get one (all staff) — includes signed URL ─────────────────────────────
  app.get("/api/company-documents/:id", requireStaffAuth, async (req, res) => {
    const row = sqlite.prepare(`
      SELECT * FROM company_documents WHERE id = ? AND deleted_at IS NULL
    `).get(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json(await attachFileUrl(row));
  });

  // ── Create (editor roles) ─────────────────────────────────────────────────
  app.post("/api/company-documents", editorOnly, async (req, res) => {
    try {
      const u = getUser(req)!;
      const b = req.body || {};
      let title = String(b.title || "").trim();
      // If no title but a filename came in, use the filename (stripped of
      // extension and normalized) as a fallback so a well-formed upload never
      // 400s on this alone.
      if (!title && typeof b.file_name === "string") {
        title = b.file_name.replace(/\.[^.]+$/, "").replace(/[._-]+/g, " ").trim();
      }
      if (!title) return res.status(400).json({ error: "Please give this document a title." });

      let fileMime: string | null = b.file_mime_type || null;
      let fileName: string | null = b.file_name || null;
      let fileData: string | null = null;
      let storageKey: string | null = null;
      let fileSize = 0;

      if (b.file_data && typeof b.file_data === "string") {
        // Extract mime from data URI if not provided
        if (!fileMime) {
          const m = /^data:([^;,]+)(?:;[^;,]+=[^;,]+)*;base64,/s.exec(b.file_data);
          if (m) fileMime = m[1];
        }
        if (!fileName) {
          const ext = (fileMime || "application/pdf").split("/")[1] || "bin";
          fileName = `${title.replace(/[^\w.\-]+/g, "_")}.${ext}`;
        }
        // Estimate size from base64 payload
        const b64 = b.file_data.split(",")[1] || b.file_data;
        fileSize = Math.floor(b64.length * 0.75);
        // Hoist to S3 if configured, otherwise store inline
        const stored = await writeImageFieldSafe(b.file_data, "company-documents");
        fileData = stored.dataUrl || null;
        storageKey = stored.storageKey || null;
      }

      const now = nowISO();
      const tagsJson = JSON.stringify(Array.isArray(b.tags) ? b.tags.filter((t: any) => typeof t === "string" && t.trim()).map((t: string) => t.trim()) : []);
      const info = sqlite.prepare(`
        INSERT INTO company_documents (
          title, description, tags, issuer, document_number,
          issued_at, expires_at,
          file_name, file_mime_type, file_data, storage_key, file_size_bytes,
          uploaded_by, uploaded_by_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        title, b.description || null, tagsJson, b.issuer || null, b.document_number || null,
        b.issued_at || null, b.expires_at || null,
        fileName, fileMime, fileData, storageKey, fileSize,
        u.id, u.name, now, now,
      );
      const row = sqlite.prepare(`SELECT * FROM company_documents WHERE id = ?`).get(Number(info.lastInsertRowid));
      res.json(await attachFileUrl(row));
    } catch (e: any) {
      console.error("[company-docs] create", e);
      res.status(500).json({ error: e?.message || "Create failed" });
    }
  });

  // ── Update meta (editor roles) — file replacement supported via file_data ─
  app.patch("/api/company-documents/:id", editorOnly, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing: any = sqlite.prepare(`SELECT * FROM company_documents WHERE id = ? AND deleted_at IS NULL`).get(id);
      if (!existing) return res.status(404).json({ error: "Not found" });
      const b = req.body || {};

      const fields: string[] = [];
      const params: any[] = [];
      const set = (col: string, val: any) => { fields.push(`${col} = ?`); params.push(val); };

      if (typeof b.title === "string") set("title", b.title.trim() || existing.title);
      if ("description" in b) set("description", b.description ?? null);
      if (Array.isArray(b.tags)) set("tags", JSON.stringify(b.tags.filter((t: any) => typeof t === "string" && t.trim()).map((t: string) => t.trim())));
      if ("issuer" in b) set("issuer", b.issuer ?? null);
      if ("document_number" in b) set("document_number", b.document_number ?? null);
      if ("issued_at" in b) set("issued_at", b.issued_at ?? null);
      if ("expires_at" in b) {
        set("expires_at", b.expires_at ?? null);
        // Reset alert flags if expiry changed so a bumped date re-arms alerts
        if (b.expires_at !== existing.expires_at) {
          set("alert_sent_60", 0); set("alert_sent_30", 0); set("alert_sent_7", 0); set("alert_sent_expired", 0);
        }
      }

      if (b.file_data && typeof b.file_data === "string") {
        // Replace file
        let fileMime: string | null = b.file_mime_type || null;
        if (!fileMime) {
          const m = /^data:([^;,]+)(?:;[^;,]+=[^;,]+)*;base64,/s.exec(b.file_data);
          if (m) fileMime = m[1];
        }
        const fileName = b.file_name || existing.file_name || `document-${id}.pdf`;
        const b64 = b.file_data.split(",")[1] || b.file_data;
        const fileSize = Math.floor(b64.length * 0.75);
        const stored = await writeImageFieldSafe(b.file_data, "company-documents");
        set("file_data", stored.dataUrl || null);
        set("storage_key", stored.storageKey || null);
        set("file_name", fileName);
        set("file_mime_type", fileMime);
        set("file_size_bytes", fileSize);
      }

      set("updated_at", nowISO());
      if (fields.length === 0) return res.json(await attachFileUrl(existing));
      sqlite.prepare(`UPDATE company_documents SET ${fields.join(", ")} WHERE id = ?`).run(...params, id);
      const row = sqlite.prepare(`SELECT * FROM company_documents WHERE id = ?`).get(id);
      res.json(await attachFileUrl(row));
    } catch (e: any) {
      console.error("[company-docs] update", e);
      res.status(500).json({ error: e?.message || "Update failed" });
    }
  });

  // ── Delete (editor roles) — soft delete ───────────────────────────────────
  app.delete("/api/company-documents/:id", editorOnly, (req, res) => {
    const id = Number(req.params.id);
    sqlite.prepare(`UPDATE company_documents SET deleted_at = ? WHERE id = ?`).run(nowISO(), id);
    // Revoke any active shares
    sqlite.prepare(`UPDATE company_document_shares SET revoked_at = ? WHERE document_id = ? AND revoked_at IS NULL`).run(nowISO(), id);
    res.json({ ok: true });
  });

  // ── Create share + email (editor roles) ───────────────────────────────────
  app.post("/api/company-documents/:id/share", editorOnly, async (req, res) => {
    try {
      const u = getUser(req)!;
      const id = Number(req.params.id);
      const doc: any = sqlite.prepare(`SELECT * FROM company_documents WHERE id = ? AND deleted_at IS NULL`).get(id);
      if (!doc) return res.status(404).json({ error: "Not found" });

      const b = req.body || {};
      const recipientEmail = String(b.recipient_email || "").trim() || null;
      const recipientName = String(b.recipient_name || "").trim() || null;
      const note = String(b.note || "").trim() || null;
      const days = Math.max(1, Math.min(365, Number(b.expires_in_days) || 30));
      const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
      const token = crypto.randomBytes(24).toString("base64url");

      const info = sqlite.prepare(`
        INSERT INTO company_document_shares(
          document_id, token, recipient_email, recipient_name, note,
          expires_at, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, token, recipientEmail, recipientName, note, expiresAt, u.id, nowISO());

      // Build the public URL — respect Railway PUBLIC_URL or fall back to request host
      const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
      const shareUrl = `${baseUrl}/company-doc/${token}`;

      // Fire-and-forget email
      let emailSent = false;
      if (recipientEmail) {
        try {
          const subject = `${doc.title} — from Titan Restoration`;
          const bodyText = [
            recipientName ? `Hi ${recipientName},` : "Hello,",
            "",
            note || `Attached is a copy of our ${doc.title}${doc.expires_at ? ` (current through ${doc.expires_at})` : ""} for your records.`,
            "",
            `View or download here (link is good for ${days} days):`,
            shareUrl,
            "",
            "Please reach out if you need anything else.",
            "",
            "Thank you,",
            "Titan Restoration LLC",
          ].join("\n");
          await sendEmail({
            to: recipientEmail,
            subject,
            text: bodyText,
          });
          emailSent = true;
        } catch (e: any) {
          console.warn("[company-docs] share email failed:", e?.message || e);
        }
      }
      res.json({
        id: Number(info.lastInsertRowid),
        token,
        share_url: shareUrl,
        expires_at: expiresAt,
        email_sent: emailSent,
      });
    } catch (e: any) {
      console.error("[company-docs] share", e);
      res.status(500).json({ error: e?.message || "Share failed" });
    }
  });

  // ── List shares for a doc (editor roles) ──────────────────────────────────
  app.get("/api/company-documents/:id/shares", editorOnly, (req, res) => {
    const id = Number(req.params.id);
    const rows = sqlite.prepare(`
      SELECT id, token, recipient_email, recipient_name, note,
             expires_at, created_at, revoked_at, view_count, last_viewed_at
      FROM company_document_shares
      WHERE document_id = ?
      ORDER BY created_at DESC LIMIT 200
    `).all(id);
    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    res.json({ shares: rows.map((r: any) => ({
      ...r,
      share_url: `${baseUrl}/company-doc/${r.token}`,
      active: !r.revoked_at && new Date(r.expires_at) > new Date(),
    })) });
  });

  // ── Revoke a share ─────────────────────────────────────────────────────────
  app.delete("/api/company-doc-shares/:id", editorOnly, (req, res) => {
    sqlite.prepare(`UPDATE company_document_shares SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
      .run(nowISO(), Number(req.params.id));
    res.json({ ok: true });
  });

  // ── PUBLIC share view — no auth, honors expiry ────────────────────────────
  app.get("/api/company-doc-public/:token", async (req, res) => {
    try {
      const token = String(req.params.token || "");
      if (!token) return res.status(404).json({ error: "Not found" });
      const share: any = sqlite.prepare(`
        SELECT * FROM company_document_shares WHERE token = ?
      `).get(token);
      if (!share) return res.status(404).json({ error: "Not found or link expired" });
      if (share.revoked_at) return res.status(410).json({ error: "This link has been revoked." });
      if (new Date(share.expires_at) < new Date()) return res.status(410).json({ error: "This link has expired." });
      const doc: any = sqlite.prepare(`SELECT * FROM company_documents WHERE id = ? AND deleted_at IS NULL`).get(share.document_id);
      if (!doc) return res.status(404).json({ error: "Document no longer available." });

      // Bump view counters
      sqlite.prepare(`
        UPDATE company_document_shares SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ?
      `).run(nowISO(), share.id);

      // Return metadata + URL — the client renders a viewer
      const shaped = await attachFileUrl(doc);
      res.json({
        title: doc.title,
        description: doc.description,
        expires_at: doc.expires_at,
        issuer: doc.issuer,
        document_number: doc.document_number,
        file_name: doc.file_name,
        file_mime_type: doc.file_mime_type,
        file_url: shaped.file_url,
        share_expires_at: share.expires_at,
      });
    } catch (e: any) {
      console.error("[company-docs] public view", e);
      res.status(500).json({ error: "Failed to load document." });
    }
  });

  // ── Scheduler entrypoint — call from scheduler.ts nightly ─────────────────
  //     Sends email to owner + admin group when a doc crosses 60/30/7/expired.
  app.post("/api/company-documents/scan-expirations", editorOnly, async (_req, res) => {
    const result = await scanCompanyDocExpirations(sqlite);
    res.json(result);
  });
}

/**
 * Idempotent expiration scan. Sends an email to every owner/admin employee
 * with an email address when a doc crosses a threshold, records the flag
 * on the doc row so the same threshold isn't re-alerted, and returns a
 * summary the scheduler can log.
 */
export async function scanCompanyDocExpirations(sqlite: Database.Database) {
  const rows = sqlite.prepare(`
    SELECT id, title, expires_at, alert_sent_60, alert_sent_30, alert_sent_7, alert_sent_expired
    FROM company_documents
    WHERE deleted_at IS NULL AND expires_at IS NOT NULL
  `).all() as any[];

  const now = new Date();
  const admins: any[] = sqlite.prepare(`
    SELECT name, gmail_email, contact_email FROM employees
    WHERE is_active = 1 AND role IN ('owner', 'admin', 'general_manager')
  `).all() as any[];
  const to = admins.map(a => a.gmail_email || a.contact_email).filter(Boolean);

  let alertsSent = 0;
  const summary: string[] = [];

  for (const r of rows) {
    const d = safeParseDate(r.expires_at);
    if (!d) continue;
    const days = daysBetween(d, now);
    let threshold: number | "expired" | null = null;
    let alertCol: string | null = null;
    if (days < 0 && !r.alert_sent_expired) { threshold = "expired"; alertCol = "alert_sent_expired"; }
    else if (days >= 0 && days <= 7 && !r.alert_sent_7) { threshold = 7; alertCol = "alert_sent_7"; }
    else if (days > 7 && days <= 30 && !r.alert_sent_30) { threshold = 30; alertCol = "alert_sent_30"; }
    else if (days > 30 && days <= 60 && !r.alert_sent_60) { threshold = 60; alertCol = "alert_sent_60"; }
    if (!threshold) continue;

    const subject = threshold === "expired"
      ? `EXPIRED: ${r.title} — Titan company document`
      : `${r.title} expires in ${days} day${days === 1 ? "" : "s"} — Titan company document`;
    const body = [
      `Titan Restoration internal document alert.`,
      "",
      `Document: ${r.title}`,
      `Expires: ${r.expires_at}${threshold === "expired" ? " (EXPIRED)" : ` (${days} days from today)`}`,
      "",
      threshold === "expired"
        ? "This document is past its expiration. Renew and upload the new version in Titan Pro > Settings > Company Documents."
        : "Please renew and upload the new version in Titan Pro > Settings > Company Documents.",
    ].join("\n");

    try {
      if (to.length) {
        await sendEmail({ to, subject, text: body });
        alertsSent++;
      }
      sqlite.prepare(`UPDATE company_documents SET ${alertCol} = 1 WHERE id = ?`).run(r.id);
      summary.push(`${r.title}: ${threshold}`);
    } catch (e: any) {
      console.warn("[company-docs] alert email failed for doc", r.id, e?.message || e);
    }
  }
  return { checked: rows.length, alerts_sent: alertsSent, details: summary };
}
