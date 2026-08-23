// Quick-add library (org-wide) + remote e-signature requests.
// Injected into registerRoutes() by routes.ts. Follows the routes_suite4
// pattern: table create-if-not-exists on register, raw SQL, thin JSON API.

import { Express, RequestHandler } from "express";
import Database from "better-sqlite3";
import crypto from "crypto";
import { sendEmail } from "./notify";

type Auth = { requireRole: (...roles: string[]) => RequestHandler };
type SqliteDb = InstanceType<typeof Database>;

const passthrough: RequestHandler = (_req, _res, next) => next();

// Normalize a description so "Water Extraction – Cat 1" and
// "water extraction - cat 1" collapse to the same library entry.
function normalizeDesc(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-") // various dashes → hyphen
    .replace(/\s+/g, " ")
    .trim();
}

export function registerQuickAddAndESignRoutes(
  app: Express,
  sqlite: SqliteDb,
  auth?: Auth,
) {
  const requireAuth: RequestHandler = auth
    ? auth.requireRole(
        "owner",
        "admin",
        "office",
        "general_manager",
        "project_manager",
        "tech",
        "estimator",
      )
    : passthrough;

  // ── Quick-add library ──────────────────────────────────────────────────────
  // Shared org-wide. Deduped by normalized description. Latest unit_price wins
  // on upsert so techs get the freshest pricing they used.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS quick_add_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    description_normalized TEXT NOT NULL UNIQUE,
    category TEXT DEFAULT 'general',
    kind TEXT,                      -- labor | material | equipment | other
    unit TEXT DEFAULT 'EA',
    unit_price REAL DEFAULT 0,
    use_count INTEGER DEFAULT 1,
    last_used_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT ''
  )`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_quick_add_desc_norm ON quick_add_items(description_normalized)`);

  // List — most-used first, then most-recent.
  app.get("/api/quick-add", requireAuth, (_req, res) => {
    const rows = sqlite
      .prepare(
        `SELECT id, description, category, kind, unit, unit_price AS unitPrice,
                use_count AS useCount, last_used_at AS lastUsedAt
         FROM quick_add_items
         ORDER BY use_count DESC, COALESCE(last_used_at, created_at) DESC
         LIMIT 500`,
      )
      .all();
    res.json(rows);
  });

  // Upsert (called every time a line item is added/edited on an estimate).
  // Silent no-op for empty descriptions or $0 items so we don't pollute the
  // library with blank rows while a tech is still typing.
  app.post("/api/quick-add", requireAuth, (req, res) => {
    const description = String(req.body?.description || "").trim();
    const unitPrice = Number(req.body?.unitPrice) || 0;
    if (!description || unitPrice <= 0) return res.json({ ok: true, skipped: true });

    const norm = normalizeDesc(description);
    const now = new Date().toISOString();
    const category = String(req.body?.category || "general");
    const kind = req.body?.kind ? String(req.body.kind) : null;
    const unit = String(req.body?.unit || "EA");
    const createdBy = (req as any).user?.email || null;

    const existing = sqlite
      .prepare(`SELECT id, use_count FROM quick_add_items WHERE description_normalized = ?`)
      .get(norm) as { id: number; use_count: number } | undefined;

    if (existing) {
      sqlite
        .prepare(
          `UPDATE quick_add_items
             SET unit_price = ?, unit = ?, category = ?, kind = COALESCE(?, kind),
                 use_count = use_count + 1, last_used_at = ?
           WHERE id = ?`,
        )
        .run(unitPrice, unit, category, kind, now, existing.id);
      return res.json({ ok: true, id: existing.id, updated: true });
    }

    const info = sqlite
      .prepare(
        `INSERT INTO quick_add_items
           (description, description_normalized, category, kind, unit, unit_price,
            use_count, last_used_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(description, norm, category, kind, unit, unitPrice, now, createdBy, now);
    res.json({ ok: true, id: Number(info.lastInsertRowid), created: true });
  });

  // Delete (admin cleanup for typos/duplicates).
  app.delete("/api/quick-add/:id", requireAuth, (req, res) => {
    const id = Number(req.params.id);
    sqlite.prepare(`DELETE FROM quick_add_items WHERE id = ?`).run(id);
    res.json({ ok: true });
  });

  // ── Remote e-signature ─────────────────────────────────────────────────────
  // A signature_request is a signed-link ticket: it carries the job id, the
  // form doc type, the pre-filled form data (JSON), the recipient email, an
  // expiry, and a status. When the customer completes signing on the public
  // /sign/:token page, the browser generates the PDF (same engine we use
  // internally) and POSTs the finalized PDF + signature back — the server
  // then creates a job_documents row and marks the request completed.
  sqlite.exec(`CREATE TABLE IF NOT EXISTS signature_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    job_id INTEGER NOT NULL,
    doc_type TEXT NOT NULL,         -- matches job_documents.doc_type
    title TEXT NOT NULL,
    form_data TEXT,                 -- JSON blob of pre-filled fields
    recipient_email TEXT NOT NULL,
    recipient_name TEXT,
    recipient_role TEXT,            -- homeowner | insured | tenant | other
    sent_by TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | viewed | signed | expired | cancelled
    viewed_at TEXT,
    signed_at TEXT,
    completed_document_id INTEGER,  -- FK to job_documents once signed
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ''
  )`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_signature_requests_token ON signature_requests(token)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_signature_requests_job ON signature_requests(job_id)`);

  const APP_ORIGIN = process.env.APP_ORIGIN || "https://titanaugusta.pro";

  // List active/recent signature requests for a job (shown on JobDocuments so
  // ops can see what's out for signature and resend or cancel).
  app.get("/api/jobs/:jobId/signature-requests", requireAuth, (req, res) => {
    const jobId = Number(req.params.jobId);
    const rows = sqlite
      .prepare(
        `SELECT id, token, doc_type AS docType, title, recipient_email AS recipientEmail,
                recipient_name AS recipientName, recipient_role AS recipientRole,
                sent_by AS sentBy, status, viewed_at AS viewedAt, signed_at AS signedAt,
                completed_document_id AS completedDocumentId,
                expires_at AS expiresAt, created_at AS createdAt
         FROM signature_requests
         WHERE job_id = ?
         ORDER BY created_at DESC`,
      )
      .all(jobId);
    res.json(rows);
  });

  // Create a new signature request and email the link.
  // Body: { jobId, docType, title, formData, recipientEmail, recipientName, recipientRole }
  app.post("/api/signature-requests", requireAuth, async (req, res) => {
    const jobId = Number(req.body?.jobId);
    const docType = String(req.body?.docType || "").trim();
    const title = String(req.body?.title || "").trim();
    const formData = req.body?.formData ? JSON.stringify(req.body.formData) : null;
    const recipientEmail = String(req.body?.recipientEmail || "").trim();
    const recipientName = req.body?.recipientName ? String(req.body.recipientName) : null;
    const recipientRole = req.body?.recipientRole ? String(req.body.recipientRole) : "homeowner";
    const sentBy = (req as any).user?.email || null;

    if (!jobId || !docType || !title) return res.status(400).json({ error: "jobId, docType, and title required" });
    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return res.status(400).json({ error: "Valid recipientEmail required" });
    }

    const token = crypto.randomBytes(24).toString("base64url");
    const now = new Date();
    const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const info = sqlite
      .prepare(
        `INSERT INTO signature_requests
           (token, job_id, doc_type, title, form_data, recipient_email, recipient_name,
            recipient_role, sent_by, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        token,
        jobId,
        docType,
        title,
        formData,
        recipientEmail,
        recipientName,
        recipientRole,
        sentBy,
        expires.toISOString(),
        now.toISOString(),
      );

    // Best-effort email send. We don't fail the request if SMTP is down —
    // ops can copy the link from the UI and text it if needed.
    // Hash-routed SPA — the sign page mounts under /#/sign/:token.
    const link = `${APP_ORIGIN}/#/sign/${token}`;
    let emailSent = false;
    let emailError: string | null = null;
    try {
      const nameLine = recipientName ? `Hi ${recipientName},` : "Hello,";
      await sendEmail({
        to: recipientEmail,
        subject: `Titan Restoration — ${title} ready to sign`,
        text:
          `${nameLine}\n\n` +
          `Titan Restoration has prepared a document for your signature: ${title}.\n\n` +
          `Sign here (link expires in 7 days):\n${link}\n\n` +
          `If you didn't expect this, please ignore this email.\n\n` +
          `— Titan Restoration\n(803) 528-8683 · https://titanaugusta.pro`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111;line-height:1.5">
             <p>${nameLine}</p>
             <p>Titan Restoration has prepared a document for your signature: <strong>${escapeHtml(title)}</strong>.</p>
             <p style="text-align:center;margin:28px 0">
               <a href="${link}" style="background:#0A2540;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">Open & sign document</a>
             </p>
             <p style="font-size:13px;color:#555">Or paste this link into your browser (expires in 7 days):<br/><a href="${link}">${link}</a></p>
             <p style="font-size:13px;color:#555">If you didn't expect this email, you can ignore it.</p>
             <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
             <p style="font-size:12px;color:#888">Titan Restoration · (803) 528-8683 · <a href="https://titanaugusta.pro" style="color:#888">titanaugusta.pro</a></p>
           </div>`,
      });
      emailSent = true;
    } catch (e: any) {
      emailError = e?.message || "email send failed";
    }

    res.json({
      ok: true,
      id: Number(info.lastInsertRowid),
      token,
      link,
      expiresAt: expires.toISOString(),
      emailSent,
      emailError,
    });
  });

  // Resend the email for an existing pending request.
  app.post("/api/signature-requests/:id/resend", requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    const row = sqlite
      .prepare(`SELECT * FROM signature_requests WHERE id = ?`)
      .get(id) as any;
    if (!row) return res.status(404).json({ error: "not found" });
    if (row.status !== "pending" && row.status !== "viewed") {
      return res.status(400).json({ error: `cannot resend a ${row.status} request` });
    }

    const link = `${APP_ORIGIN}/#/sign/${row.token}`;
    try {
      await sendEmail({
        to: row.recipient_email,
        subject: `Titan Restoration — reminder: ${row.title}`,
        text:
          `Reminder: Titan Restoration is still waiting on your signature for ${row.title}.\n\n` +
          `Sign here:\n${link}\n\n— Titan Restoration`,
        html:
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111;line-height:1.5">
             <p>Just a reminder — Titan Restoration is waiting on your signature for <strong>${escapeHtml(row.title)}</strong>.</p>
             <p style="text-align:center;margin:24px 0">
               <a href="${link}" style="background:#0A2540;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">Open & sign document</a>
             </p>
             <p style="font-size:13px;color:#555"><a href="${link}">${link}</a></p>
           </div>`,
      });
      res.json({ ok: true, emailSent: true });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || "email failed" });
    }
  });

  // Cancel a request.
  app.post("/api/signature-requests/:id/cancel", requireAuth, (req, res) => {
    const id = Number(req.params.id);
    sqlite.prepare(`UPDATE signature_requests SET status='cancelled' WHERE id = ?`).run(id);
    res.json({ ok: true });
  });

  // ── PUBLIC signing endpoints (NO auth) ─────────────────────────────────────
  // These serve the customer-facing sign page. Rate-limiting is handled by
  // the token itself — invalid/expired tokens 404 quickly.

  // Fetch request payload + a slim job snapshot for the sign UI.
  app.get("/api/public/sign/:token", (req, res) => {
    const token = String(req.params.token || "");
    const row = sqlite
      .prepare(
        `SELECT id, token, job_id AS jobId, doc_type AS docType, title, form_data AS formData,
                recipient_email AS recipientEmail, recipient_name AS recipientName,
                recipient_role AS recipientRole, status, expires_at AS expiresAt,
                signed_at AS signedAt, completed_document_id AS completedDocumentId
         FROM signature_requests WHERE token = ?`,
      )
      .get(token) as any;
    if (!row) return res.status(404).json({ error: "Signing link not found." });

    if (row.status === "cancelled") return res.status(410).json({ error: "This signing link was cancelled." });
    if (row.status === "signed")
      return res.json({ ...row, alreadySigned: true, formData: row.formData ? JSON.parse(row.formData) : null });
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      sqlite.prepare(`UPDATE signature_requests SET status='expired' WHERE id = ?`).run(row.id);
      return res.status(410).json({ error: "This signing link has expired. Ask Titan Restoration to send a new one." });
    }

    // Mark viewed on first fetch (helpful for ops to see who opened it).
    if (row.status === "pending") {
      sqlite
        .prepare(`UPDATE signature_requests SET status='viewed', viewed_at=? WHERE id = ?`)
        .run(new Date().toISOString(), row.id);
      row.status = "viewed";
      row.viewedAt = new Date().toISOString();
    }

    // Attach a minimal job snapshot so the sign page can show address/customer.
    let job: any = null;
    try {
      job = sqlite.prepare(`SELECT id, job_number AS jobNumber, customer_name AS customerName,
                                   customer_email AS customerEmail, customer_phone AS customerPhone,
                                   address, city, state, zip
                              FROM jobs WHERE id = ?`).get(row.jobId);
    } catch {
      job = null;
    }

    res.json({
      ...row,
      formData: row.formData ? JSON.parse(row.formData) : null,
      job,
    });
  });

  // Submit signed PDF + signature back to the server. The client-side sign
  // page generates the PDF with the same generator functions used internally
  // (so the finished doc looks identical to a tech-signed one) and posts:
  //   { signerName, signerRole, signatureDataUrl, pdfDataUrl, updatedFormData? }
  app.post("/api/public/sign/:token", (req, res) => {
    const token = String(req.params.token || "");
    const row = sqlite
      .prepare(`SELECT * FROM signature_requests WHERE token = ?`)
      .get(token) as any;
    if (!row) return res.status(404).json({ error: "Signing link not found." });
    if (row.status === "signed") return res.status(409).json({ error: "This document has already been signed." });
    if (row.status === "cancelled") return res.status(410).json({ error: "This signing link was cancelled." });
    if (new Date(row.expires_at).getTime() < Date.now()) {
      sqlite.prepare(`UPDATE signature_requests SET status='expired' WHERE id = ?`).run(row.id);
      return res.status(410).json({ error: "This signing link has expired." });
    }

    const signerName = String(req.body?.signerName || "").trim();
    const signerRole = String(req.body?.signerRole || row.recipient_role || "homeowner");
    const signatureDataUrl = String(req.body?.signatureDataUrl || "");
    const pdfDataUrl = String(req.body?.pdfDataUrl || "");
    const updatedFormData = req.body?.updatedFormData
      ? JSON.stringify(req.body.updatedFormData)
      : row.form_data;

    if (!signerName) return res.status(400).json({ error: "Please type your full name." });
    if (!signatureDataUrl.startsWith("data:image/")) return res.status(400).json({ error: "Signature is required." });
    if (!pdfDataUrl.startsWith("data:application/pdf") && !pdfDataUrl.startsWith("data:application/octet-stream")) {
      return res.status(400).json({ error: "PDF payload missing." });
    }

    const now = new Date().toISOString();

    // Insert as a job_documents row exactly as the internal signing flow does.
    const docInfo = sqlite
      .prepare(
        `INSERT INTO job_documents
           (job_id, doc_type, title, form_data, signature_data, signer_name, signer_role,
            signed_at, file_data, file_name, file_mime_type, file_size, status, phase,
            created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'signed', 'mitigation', ?, ?)`,
      )
      .run(
        row.job_id,
        row.doc_type,
        row.title,
        updatedFormData,
        signatureDataUrl,
        signerName,
        signerRole,
        now,
        pdfDataUrl,
        `${row.title.replace(/[^\w.-]+/g, "_")}_signed.pdf`,
        "application/pdf",
        Math.floor((pdfDataUrl.length * 3) / 4), // rough size estimate
        `remote-sign:${row.recipient_email}`,
        now,
      );

    sqlite
      .prepare(
        `UPDATE signature_requests
           SET status='signed', signed_at=?, completed_document_id=?, form_data=?
         WHERE id = ?`,
      )
      .run(now, Number(docInfo.lastInsertRowid), updatedFormData, row.id);

    res.json({ ok: true, documentId: Number(docInfo.lastInsertRowid) });
  });

  // ── Send an already-generated PDF to a customer, optionally saving a copy
  // ── into the job's document library. Used by SendAndSavePanel for estimate
  // ── + invoice emails so we only have ONE server path for "send + archive".
  app.post("/api/send-document-email", requireAuth, async (req, res) => {
    const {
      jobId,
      docType,
      title,
      to,
      subject,
      body,
      pdfDataUri,
      saveToJob,
    } = req.body || {};

    if (!to || !pdfDataUri || !title) {
      return res.status(400).json({ error: "to, title, and pdfDataUri are required" });
    }

    // Strip the data URI header for the filename — body always keeps the URI
    // intact for both the email attachment path and the saved job document.
    const safeName = String(title).replace(/[^\w.\-]+/g, "_") + ".pdf";
    const textBody = String(body || "Please find your document attached.").trim();
    const htmlBody = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.55;color:#111">${escapeHtml(
      textBody,
    ).replace(/\n/g, "<br>")}</div>`;

    // Attempt to send — sendEmail auto-picks Gmail then falls back to SMTP.
    const results = await sendEmail({
      to: String(to).trim(),
      subject: String(subject || title).trim(),
      text: textBody,
      html: htmlBody,
      attachments: [{ filename: safeName, contentType: "application/pdf", content: pdfDataUri }],
    });

    // Optionally record a copy in the job's document library so ops can always
    // pull up "what did we send to whom, when?" without digging into email.
    let savedDocumentId: number | null = null;
    const jid = Number(jobId);
    if (saveToJob && Number.isFinite(jid) && jid > 0) {
      try {
        const now = new Date().toISOString();
        const info = sqlite
          .prepare(
            `INSERT INTO job_documents (
               job_id, doc_type, title, form_data, file_data,
               status, signer_name, created_by, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            jid,
            String(docType || "document"),
            String(title),
            JSON.stringify({ source: "emailed-to-customer", to: String(to).trim(), subject, sentAt: now }),
            pdfDataUri,
            "sent",
            null,
            `emailed-to:${String(to).trim()}`,
            now,
            now,
          );
        savedDocumentId = Number(info.lastInsertRowid) || null;
      } catch (e: any) {
        // Non-fatal — email still went. Log so ops can find the issue.
        // eslint-disable-next-line no-console
        console.warn("[send-document-email] job-file save failed:", e?.message || e);
      }
    }

    // Provider label for the toast: whichever transport actually delivered.
    const first = results[0];
    const provider = first?.simulated
      ? "simulated (no transport configured)"
      : first?.id?.includes("@")
        ? "SMTP"
        : "Gmail";

    res.json({ ok: true, email: results, provider, savedDocumentId });
  });
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
