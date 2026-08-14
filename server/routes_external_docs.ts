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
  app.get("/api/estimates/:id/external-file", requireStaffAuth, async (req: any, res: Response) => {
    try {
      const id = Number(req.params.id);
      const row: any = sqlite.prepare(
        "SELECT id, external_file_url, external_file_key, external_file_mime, external_file_name FROM estimates WHERE id = ?"
      ).get(id);
      if (!row) return res.status(404).json({ error: "Not found" });
      const url = await readImageField({ dataUrl: row.external_file_url, storageKey: row.external_file_key });
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

  app.get("/api/invoices/:id/external-file", requireStaffAuth, async (req: any, res: Response) => {
    try {
      const id = Number(req.params.id);
      const row: any = sqlite.prepare(
        "SELECT id, external_file_url, external_file_key, external_file_mime, external_file_name FROM invoices WHERE id = ?"
      ).get(id);
      if (!row) return res.status(404).json({ error: "Not found" });
      const url = await readImageField({ dataUrl: row.external_file_url, storageKey: row.external_file_key });
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
