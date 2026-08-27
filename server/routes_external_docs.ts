/**
 * routes_external_docs.ts
 *
 * Upload an outside-authored estimate or invoice (a PDF/JPG produced in
 * Xactimate, Symbility, a subcontractor's template, a carrier's approval,
 * whatever) directly into the job's estimate/invoice list. The resulting
 * row is a first-class Estimate/Invoice — it shows up in the same tabs and
 * counts toward the job's financial rollups — but has `source = 'external'`
 * and an attached file instead of line items.
 *
 * Endpoints (mounted under /api):
 *   POST   /api/jobs/:id/estimates/external
 *   POST   /api/jobs/:id/invoices/external
 *   GET    /api/estimates/:id/external-file    → 302 redirect to signed URL
 *   GET    /api/invoices/:id/external-file     → 302 redirect to signed URL
 *   PATCH  /api/estimates/:id/external         → edit vendor/title/total/status/notes
 *   PATCH  /api/invoices/:id/external          → edit vendor/number/total/status/notes/due
 *
 * The file itself is uploaded as a `data:` URL in the request body and gets
 * offloaded to S3 via writeImageFieldSafe (the helper is content-type aware,
 * so PDFs work fine — the name is historical). If S3 isn't configured we
 * keep the base64 inline as a dev-only fallback.
 */
import type { Express, Request, Response } from "express";
import type BetterSqlite3 from "better-sqlite3";
import { writeImageFieldSafe, readImageField } from "./image_pipeline";
import * as s3 from "./storage_s3";

// Resolve an external file row to a URL the browser can open, preserving the
// stored MIME and forcing an inline disposition so PDFs render in the tab
// instead of showing up as a blank black screen (which is what Chrome does
// when a signed S3 URL comes back as application/octet-stream).
// Guess a MIME from a filename when the DB row didn't store one (legacy
// uploads). Covers the file types Titan actually gets: PDFs from Xactimate/
// Symbility/carriers, and phone-camera JPG/PNG/HEIC estimates.
function guessMimeFromName(name: string | null | undefined): string | undefined {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".heic")) return "image/heic";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".gif")) return "image/gif";
  return undefined;
}

async function externalFileViewUrl(row: {
  external_file_url?: string | null;
  external_file_key?: string | null;
  external_file_mime?: string | null;
  external_file_name?: string | null;
}): Promise<string> {
  const key = row.external_file_key || "";
  if (key && s3.isConfigured()) {
    // Prefer the DB-stored MIME; fall back to a filename-based guess so
    // legacy rows that never captured MIME still render (before this route
    // was hardened, a null MIME made Chrome treat the S3 response as
    // application/octet-stream and paint a blank/black tab).
    const mime = row.external_file_mime || guessMimeFromName(row.external_file_name) || "application/octet-stream";
    const safeName = (row.external_file_name || "file").replace(/"/g, "");
    return s3.getReadUrl(key, undefined, {
      responseContentType: mime,
      responseContentDisposition: `inline; filename="${safeName}"`,
    });
  }
  // Legacy / non-S3 fallback — hand back whatever readImageField returns.
  return readImageField({ dataUrl: row.external_file_url, storageKey: row.external_file_key });
}

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB — keeps SQLite fallback path sane

function nowIso() { return new Date().toISOString(); }

/**
 * Estimate the byte size of a data URL without fully decoding it. base64 payloads
 * are (length * 3/4) bytes; the header (~50 chars) is negligible.
 */
function dataUrlBytes(u: string): number {
  const i = u.indexOf(",");
  if (i < 0) return 0;
  return Math.floor((u.length - i - 1) * 0.75);
}

export function registerExternalDocRoutes(
  app: Express,
  sqlite: BetterSqlite3.Database,
  requireStaffAuth: (req: any, res: any, next: any) => void,
) {
  // ── Upload external estimate ──────────────────────────────────────────
  app.post("/api/jobs/:id/estimates/external", requireStaffAuth, async (req: any, res: Response) => {
    try {
      const jobId = Number(req.params.id);
      if (!Number.isFinite(jobId)) return res.status(400).json({ error: "Invalid job id" });

      const job = sqlite.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId);
      if (!job) return res.status(404).json({ error: "Job not found" });

      const {
        title, vendor, total, notes, status, phase, dataUrl, fileName, fileMime,
      } = req.body ?? {};

      if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
        return res.status(400).json({ error: "dataUrl (base64 file) is required" });
      }
      if (dataUrlBytes(dataUrl) > MAX_FILE_BYTES) {
        return res.status(413).json({ error: `File too large. Max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.` });
      }

      const stored = await writeImageFieldSafe(dataUrl, "external-estimates");
      const size = dataUrlBytes(dataUrl);

      const totalNum = Number(total) || 0;
      const cleanTitle = String(title || "").trim() || (vendor ? `${vendor} — external estimate` : "External estimate");
      const cleanStatus = String(status || "sent").trim();
      const cleanPhase = String(phase || "mitigation").trim();
      const uploader = req.employee?.name || "unknown";

      const result = sqlite.prepare(`
        INSERT INTO estimates (
          job_id, title, status, line_items, subtotal, tax, total,
          notes, phase, source,
          external_file_url, external_file_key, external_file_name, external_file_mime, external_file_size,
          external_vendor, uploaded_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'external', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        jobId, cleanTitle, cleanStatus, "[]", 0, 0, totalNum,
        notes || null, cleanPhase,
        stored.dataUrl || null, stored.storageKey || null,
        fileName || null, fileMime || null, size,
        vendor || null, uploader, nowIso(),
      );

      const row = sqlite.prepare("SELECT * FROM estimates WHERE id = ?").get(result.lastInsertRowid);
      return res.json(row);
    } catch (err: any) {
      console.error("[external-doc] estimate upload failed", err);
      return res.status(500).json({ error: err?.message || "Upload failed" });
    }
  });

  // ── Upload external invoice ───────────────────────────────────────────
  app.post("/api/jobs/:id/invoices/external", requireStaffAuth, async (req: any, res: Response) => {
    try {
      const jobId = Number(req.params.id);
      if (!Number.isFinite(jobId)) return res.status(400).json({ error: "Invalid job id" });

      const job = sqlite.prepare("SELECT id FROM jobs WHERE id = ?").get(jobId);
      if (!job) return res.status(404).json({ error: "Job not found" });

      const {
        invoiceNumber, vendor, total, notes, status, phase, dueDate,
        dataUrl, fileName, fileMime, contactId,
      } = req.body ?? {};

      if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
        return res.status(400).json({ error: "dataUrl (base64 file) is required" });
      }
      if (dataUrlBytes(dataUrl) > MAX_FILE_BYTES) {
        return res.status(413).json({ error: `File too large. Max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.` });
      }

      const stored = await writeImageFieldSafe(dataUrl, "external-invoices");
      const size = dataUrlBytes(dataUrl);

      // Auto-number if not supplied: EXT-<jobId>-<timestamp>
      const invNum = String(invoiceNumber || `EXT-${jobId}-${Date.now().toString(36).toUpperCase()}`).trim();
      const totalNum = Number(total) || 0;
      const cleanStatus = String(status || "sent").trim();
      const cleanPhase = String(phase || "mitigation").trim();
      const uploader = req.employee?.name || "unknown";

      const result = sqlite.prepare(`
        INSERT INTO invoices (
          job_id, contact_id, invoice_number, status, line_items,
          subtotal, tax, total,
          due_date, notes, phase, source,
          external_file_url, external_file_key, external_file_name, external_file_mime, external_file_size,
          external_vendor, uploaded_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'external', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        jobId, contactId ?? null, invNum, cleanStatus, "[]",
        0, 0, totalNum,
        dueDate || null, notes || null, cleanPhase,
        stored.dataUrl || null, stored.storageKey || null,
        fileName || null, fileMime || null, size,
        vendor || null, uploader, nowIso(),
      );

      const row = sqlite.prepare("SELECT * FROM invoices WHERE id = ?").get(result.lastInsertRowid);
      return res.json(row);
    } catch (err: any) {
      console.error("[external-doc] invoice upload failed", err);
      return res.status(500).json({ error: err?.message || "Upload failed" });
    }
  });

  // ── Serve external files (redirect to signed URL) ─────────────────────
  // Uses readImageField, which hands back a signed URL if the row has a
  // storageKey, or the inline data URL otherwise. Same helper used
  // everywhere else in the app so behavior is consistent.
  //
  // These two GET routes are triggered by plain `<a target="_blank">` clicks
  // in the Estimates / Invoices tab, so the browser cannot attach the
  // `Authorization: Bearer <token>` header the rest of the API expects.
  // Without a fallback, requireStaffAuth returns 401 and the new tab shows
  // a black "Authentication required" screen. To keep the click-to-view UX
  // and still enforce auth, we accept the same session token via the `?t=`
  // query parameter and hoist it into the Authorization header before the
  // real middleware runs. Tokens are the caller's own 8h session token, so
  // no new secrets/state are introduced.
  const acceptQueryToken = (req: any, _res: any, next: any) => {
    if (!req.headers.authorization && typeof req.query?.t === "string" && req.query.t) {
      req.headers.authorization = `Bearer ${req.query.t}`;
    }
    next();
  };

  app.get("/api/estimates/:id/external-file", acceptQueryToken, requireStaffAuth, async (req: any, res: Response) => {
    try {
      const id = Number(req.params.id);
      const row: any = sqlite.prepare(
        "SELECT id, external_file_url, external_file_key, external_file_mime, external_file_name FROM estimates WHERE id = ?"
      ).get(id);
      if (!row) return res.status(404).json({ error: "Not found" });
      const url = await externalFileViewUrl(row);
      if (!url) return res.status(404).json({ error: "No file attached" });
      // If it's a data URL we can't redirect the browser to it directly for
      // download-friendly behavior; stream it back with the right headers.
      if (url.startsWith("data:")) {
        const m = /^data:([^;]+);base64,(.+)$/.exec(url);
        if (!m) return res.status(500).json({ error: "Malformed inline file" });
        const buf = Buffer.from(m[2], "base64");
        res.setHeader("Content-Type", row.external_file_mime || m[1] || "application/octet-stream");
        if (row.external_file_name) {
          res.setHeader("Content-Disposition", `inline; filename="${row.external_file_name.replace(/"/g, "")}"`);
        }
        return res.send(buf);
      }
      return res.redirect(url);
    } catch (err: any) {
      console.error("[external-doc] estimate file fetch failed", err);
      return res.status(500).json({ error: err?.message || "Fetch failed" });
    }
  });

  app.get("/api/invoices/:id/external-file", acceptQueryToken, requireStaffAuth, async (req: any, res: Response) => {
    try {
      const id = Number(req.params.id);
      const row: any = sqlite.prepare(
        "SELECT id, external_file_url, external_file_key, external_file_mime, external_file_name FROM invoices WHERE id = ?"
      ).get(id);
      if (!row) return res.status(404).json({ error: "Not found" });
      const url = await externalFileViewUrl(row);
      if (!url) return res.status(404).json({ error: "No file attached" });
      if (url.startsWith("data:")) {
        const m = /^data:([^;]+);base64,(.+)$/.exec(url);
        if (!m) return res.status(500).json({ error: "Malformed inline file" });
        const buf = Buffer.from(m[2], "base64");
        res.setHeader("Content-Type", row.external_file_mime || m[1] || "application/octet-stream");
        if (row.external_file_name) {
          res.setHeader("Content-Disposition", `inline; filename="${row.external_file_name.replace(/"/g, "")}"`);
        }
        return res.send(buf);
      }
      return res.redirect(url);
    } catch (err: any) {
      console.error("[external-doc] invoice file fetch failed", err);
      return res.status(500).json({ error: err?.message || "Fetch failed" });
    }
  });

  // ── Patch external estimate/invoice metadata (no file re-upload) ─────
  app.patch("/api/estimates/:id/external", requireStaffAuth, (req: any, res: Response) => {
    const id = Number(req.params.id);
    const row: any = sqlite.prepare("SELECT source FROM estimates WHERE id = ?").get(id);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.source !== "external") return res.status(400).json({ error: "Not an external estimate" });

    const { title, vendor, total, status, notes, phase } = req.body ?? {};
    const fields: string[] = [];
    const values: any[] = [];
    if (title !== undefined) { fields.push("title = ?"); values.push(String(title)); }
    if (vendor !== undefined) { fields.push("external_vendor = ?"); values.push(vendor || null); }
    if (total !== undefined) { fields.push("total = ?"); values.push(Number(total) || 0); }
    if (status !== undefined) { fields.push("status = ?"); values.push(String(status)); }
    if (notes !== undefined) { fields.push("notes = ?"); values.push(notes || null); }
    if (phase !== undefined) { fields.push("phase = ?"); values.push(String(phase)); }
    if (fields.length === 0) return res.json(sqlite.prepare("SELECT * FROM estimates WHERE id = ?").get(id));
    sqlite.prepare(`UPDATE estimates SET ${fields.join(", ")} WHERE id = ?`).run(...values, id);
    return res.json(sqlite.prepare("SELECT * FROM estimates WHERE id = ?").get(id));
  });

  app.patch("/api/invoices/:id/external", requireStaffAuth, (req: any, res: Response) => {
    const id = Number(req.params.id);
    const row: any = sqlite.prepare("SELECT source FROM invoices WHERE id = ?").get(id);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (row.source !== "external") return res.status(400).json({ error: "Not an external invoice" });

    const { invoiceNumber, vendor, total, status, notes, phase, dueDate } = req.body ?? {};
    const fields: string[] = [];
    const values: any[] = [];
    if (invoiceNumber !== undefined) { fields.push("invoice_number = ?"); values.push(String(invoiceNumber)); }
    if (vendor !== undefined) { fields.push("external_vendor = ?"); values.push(vendor || null); }
    if (total !== undefined) { fields.push("total = ?"); values.push(Number(total) || 0); }
    if (status !== undefined) { fields.push("status = ?"); values.push(String(status)); }
    if (notes !== undefined) { fields.push("notes = ?"); values.push(notes || null); }
    if (phase !== undefined) { fields.push("phase = ?"); values.push(String(phase)); }
    if (dueDate !== undefined) { fields.push("due_date = ?"); values.push(dueDate || null); }
    if (fields.length === 0) return res.json(sqlite.prepare("SELECT * FROM invoices WHERE id = ?").get(id));
    sqlite.prepare(`UPDATE invoices SET ${fields.join(", ")} WHERE id = ?`).run(...values, id);
    return res.json(sqlite.prepare("SELECT * FROM invoices WHERE id = ?").get(id));
  });
}
