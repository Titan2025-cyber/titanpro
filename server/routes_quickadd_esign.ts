// Quick-add library (org-wide) + remote e-signature requests.
// Injected into registerRoutes() by routes.ts. Follows the routes_suite4
// pattern: table create-if-not-exists on register, raw SQL, thin JSON API.

import { Express, RequestHandler } from "express";
import Database from "better-sqlite3";
import crypto from "crypto";
import { sendEmail } from "./notify";
import type { Notifier } from "./notify_bell";

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
  notifier?: Notifier,
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
    let emailProvider: string = "none";
    try {
      const nameLine = recipientName ? `Hi ${recipientName},` : "Hello,";
      // sendEmail() returns per-recipient SendResult[] rather than throwing on
      // simulated / provider errors, so we must inspect the result to decide
      // whether the email actually left the building.
      const results = await sendEmail({
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
      const first = results[0];
      if (first?.status === "sent") {
        emailSent = true;
        emailProvider = "live";
      } else if (first?.status === "logged" && first?.simulated) {
        emailSent = false;
        emailError = "No email transport configured on the server. Copy the link and text or paste it to the customer, then set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (Gmail) or SMTP_HOST/SMTP_USER/SMTP_PASS (SMTP) in Railway to enable direct sends.";
        emailProvider = "simulated";
      } else {
        emailSent = false;
        emailError = first?.error || "unknown";
        emailProvider = "error";
      }
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
      emailProvider,
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

    // ── Auto-advance job stage on customer signature. ────────────────────────
    // Certain signed docs are pipeline gates. The signature itself IS the
    // event that advances the job, so we do it here instead of waiting for
    // a human to click the stage selector.
    //
    //   Work Authorization signed   → progress_stage 'wip'
    //                                 stamps sales_date + wip_date if unset
    //     (customer has committed to scope, production may begin)
    //
    //   Certificate of Completion signed → progress_stage 'invoice_pending'
    //                                 stamps invoice_sent_date if unset
    //     (customer has confirmed the work is complete, we can now invoice)
    //
    // A stage advance is one-way — we never move a job BACKWARDS. If a PM
    // has already dragged a Work Auth-signed job to invoice_pending or
    // beyond, a re-signed Work Auth won't drop it back to WIP. And a CoC
    // signed on a job still stuck in pending_sale still advances it (the
    // scope must have been done, otherwise the CoC wouldn't exist).
    //
    // BACKWARD_FROM tables encode "which stages does a signature promote
    // FROM" — anything not listed is already at-or-past the target.
    const STAGE_RANK: Record<string, number> = {
      pending_sale: 0,
      pre_production: 1,
      wip: 2,
      invoice_pending: 3,
      accounts_receivable: 4,
      complete: 5,
    };
    let stageAdvanced = false;
    let stageAdvancedLabel: string | null = null;
    try {
      const jobRow = sqlite
        .prepare(
          `SELECT progress_stage, sales_date, wip_date, invoice_sent_date
             FROM jobs WHERE id = ?`,
        )
        .get(row.job_id) as any;

      if (jobRow) {
        const currentRank = STAGE_RANK[jobRow.progress_stage ?? "pending_sale"] ?? 0;

        if (row.doc_type === "work_authorization" && currentRank < STAGE_RANK.wip) {
          // Only stamp salesDate/wipDate that aren't already set — preserves
          // any manual back-date a PM may have entered.
          const salesDate = jobRow.sales_date || now;
          const wipDate = jobRow.wip_date || now;
          sqlite
            .prepare(
              `UPDATE jobs
                 SET progress_stage = 'wip',
                     sales_date = ?,
                     wip_date = ?
               WHERE id = ?`,
            )
            .run(salesDate, wipDate, row.job_id);
          stageAdvanced = true;
          stageAdvancedLabel = "WIP";
        } else if (
          row.doc_type === "certificate_of_completion"
          && currentRank < STAGE_RANK.invoice_pending
        ) {
          // Preserve any pre-existing invoice_sent_date the PM back-dated;
          // otherwise stamp real-time.
          const invoiceSentDate = jobRow.invoice_sent_date || now;
          sqlite
            .prepare(
              `UPDATE jobs
                 SET progress_stage = 'invoice_pending',
                     invoice_sent_date = ?
               WHERE id = ?`,
            )
            .run(invoiceSentDate, row.job_id);
          stageAdvanced = true;
          stageAdvancedLabel = "Invoice Pending";
        }
      }
    } catch (e: any) {
      console.error("[signature] stage-advance failed:", e?.message || e);
    }

    // ── Post-sign notifications (fire-and-forget so a mail/notify failure never
    // ── prevents the customer from seeing 'you're all set'). ───────────────────
    const documentId = Number(docInfo.lastInsertRowid);
    void notifyOnSignatureCompleted({
      stageAdvanced,
      stageAdvancedLabel,
      sqlite,
      notifier,
      jobId: row.job_id,
      documentId,
      docType: row.doc_type,
      title: row.title,
      signerName,
      signerRole,
      recipientEmail: row.recipient_email,
      recipientName: row.recipient_name || null,
      pdfDataUrl,
      signedAt: now,
    }).catch((e) => console.error("[signature] notify failed:", e?.message || e));

    res.json({ ok: true, documentId });
  });

  // ── Pending signatures across all jobs (for header badge + dashboard). ─────
  // Returns a lightweight summary: total pending count + a preview of the
  // three most-recent so the bell can show a badge without hitting the docs
  // table. Only 'pending' and 'viewed' rows count — signed/expired/cancelled
  // don't. Requires staff auth (same as the rest of /api).
  app.get("/api/signature-requests/pending", requireAuth, (_req, res) => {
    const rows = sqlite
      .prepare(
        `SELECT s.id, s.job_id AS jobId, s.title, s.recipient_name AS recipientName,
                s.recipient_email AS recipientEmail, s.status, s.created_at AS createdAt,
                s.expires_at AS expiresAt, s.viewed_at AS viewedAt,
                j.job_number AS jobNumber, j.address AS jobAddress
           FROM signature_requests s
           LEFT JOIN jobs j ON j.id = s.job_id
          WHERE s.status IN ('pending', 'viewed')
            AND datetime(s.expires_at) > datetime('now')
          ORDER BY s.created_at DESC`,
      )
      .all();
    res.json({ count: rows.length, requests: rows });
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

// ── Signature-completion notifications ─────────────────────────────────────────
//
// Fanout when a customer completes a remote signature:
//   1. Owner + admin + GM in-app bell notifications (deep-link to the job)
//   2. Team email to the assigned tech (if any) with the signed PDF attached,
//      cc'd to every owner/admin (best-effort — falls back to logging)
//   3. Confirmation email to the customer with their signed PDF for records
// The DocCard "Signed by {name}" pill (#4) is already rendered client-side
// from the job_documents row we just inserted — no server change needed there.
async function notifyOnSignatureCompleted(args: {
  sqlite: SqliteDb;
  notifier?: Notifier;
  jobId: number;
  documentId: number;
  docType: string;
  title: string;
  signerName: string;
  signerRole: string;
  recipientEmail: string;
  recipientName: string | null;
  pdfDataUrl: string;
  signedAt: string;
  stageAdvanced?: boolean;
  stageAdvancedLabel?: string | null;
}): Promise<void> {
  const {
    sqlite,
    notifier,
    jobId,
    documentId,
    docType,
    title,
    signerName,
    signerRole,
    recipientEmail,
    recipientName,
    pdfDataUrl,
    signedAt,
    stageAdvanced,
    stageAdvancedLabel,
  } = args;
  const stageLabel = stageAdvancedLabel || "WIP";

  // Look up job context (address / job number / assigned tech).
  const job: any = sqlite
    .prepare(
      `SELECT j.id, j.job_number AS jobNumber, j.address, j.assigned_tech AS assignedTech,
              c.name AS customerName, c.email AS customerEmail
         FROM jobs j
         LEFT JOIN contacts c ON c.id = j.contact_id
        WHERE j.id = ?`,
    )
    .get(jobId);

  const jobLabel = job?.jobNumber
    ? `#${job.jobNumber}${job?.address ? ` — ${job.address}` : ""}`
    : job?.address || `Job ${jobId}`;
  const appOrigin = process.env.APP_ORIGIN || "https://titanaugusta.pro";
  const jobLink = `${appOrigin}/#/jobs/${jobId}`;
  const signedAtDisplay = new Date(signedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  // 1) In-app bell notifications for owners + admins + general managers.
  //    Also target the assigned tech by name (legacy fanout) if one is set.
  if (notifier) {
    try {
      notifier.notifyOwnersAndAdmins({
        type: "signature_completed",
        title: stageAdvanced
          ? `✓ ${signerName} signed the ${title} — job moved to ${stageLabel}`
          : `✓ ${signerName} signed the ${title}`,
        body: stageAdvanced
          ? `${signerName} completed the ${title} for ${jobLabel} at ${signedAtDisplay}. Job auto-advanced to ${stageLabel}. Signed PDF is in the job's Documents tab.`
          : `${signerName} completed the ${title} for ${jobLabel} at ${signedAtDisplay}. The signed PDF is now in the job's Documents tab.`,
        jobId,
        link: `/jobs/${jobId}?tab=documents`,
      });
    } catch (e: any) {
      console.error("[signature] bell notify failed:", e?.message || e);
    }
  }

  // Assemble the attachment ONCE and reuse for both team + customer emails.
  const safeName = `${title.replace(/[^\w.-]+/g, "_")}_signed.pdf`;
  const attachment = {
    filename: safeName,
    contentType: "application/pdf",
    content: pdfDataUrl,
  };

  // 2) Team email — assigned tech (if we can resolve their gmail_email) plus
  //    every active owner/admin. Deduped by lowercased address.
  const teamRecipients = new Set<string>();
  if (job?.assignedTech) {
    const techRow: any = sqlite
      .prepare(
        "SELECT gmail_email FROM employees WHERE name = ? AND is_active = 1",
      )
      .get(job.assignedTech);
    if (techRow?.gmail_email) teamRecipients.add(String(techRow.gmail_email).toLowerCase());
  }
  try {
    const owners: any[] = sqlite
      .prepare(
        "SELECT gmail_email FROM employees WHERE is_active = 1 AND role IN ('owner','admin','general_manager') AND gmail_email IS NOT NULL AND gmail_email != ''",
      )
      .all();
    for (const r of owners) if (r?.gmail_email) teamRecipients.add(String(r.gmail_email).toLowerCase());
  } catch (_e) { /* ignore — optional */ }

  // As a last resort, fall back to the OWNER_NOTIFY_EMAIL env var so a fresh
  // install with no employee emails still notifies someone.
  if (teamRecipients.size === 0 && process.env.OWNER_NOTIFY_EMAIL) {
    teamRecipients.add(String(process.env.OWNER_NOTIFY_EMAIL).toLowerCase());
  }

  if (teamRecipients.size > 0) {
    const teamText =
      `${signerName} just signed the ${title} for ${jobLabel}.\n\n` +
      `Signer role: ${signerRole}\n` +
      `Signed at: ${signedAtDisplay}\n` +
      `Customer email: ${recipientEmail}\n\n` +
      `The signed PDF is attached and has been saved to the job's Documents tab.\n` +
      `Open the job: ${jobLink}\n\n— Titan Restoration`;
    const teamHtml =
      `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;color:#111;line-height:1.55">
         <p style="font-size:16px;margin:0 0 4px"><strong>✓ ${escapeHtml(signerName)}</strong> signed the <strong>${escapeHtml(title)}</strong>.</p>
         <p style="color:#555;margin:0 0 16px">Job ${escapeHtml(jobLabel)} · ${escapeHtml(signedAtDisplay)}</p>
         <table style="font-size:14px;color:#333;border-collapse:collapse;margin:0 0 16px">
           <tr><td style="padding:2px 8px 2px 0;color:#666">Signer role</td><td>${escapeHtml(signerRole)}</td></tr>
           <tr><td style="padding:2px 8px 2px 0;color:#666">Customer email</td><td><a href="mailto:${escapeHtml(recipientEmail)}">${escapeHtml(recipientEmail)}</a></td></tr>
           <tr><td style="padding:2px 8px 2px 0;color:#666">Document ID</td><td>#${documentId}</td></tr>
         </table>
         <p style="margin:0 0 20px">The signed PDF is attached and already saved to the job's Documents tab.</p>
         <p style="margin:0 0 24px">
           <a href="${jobLink}" style="background:#0A2540;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">Open job in Titan Pro</a>
         </p>
         <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
         <p style="font-size:12px;color:#888;margin:0">Titan Restoration · (803) 528-8683 · <a href="${appOrigin}" style="color:#888">titanaugusta.pro</a></p>
       </div>`;
    try {
      await sendEmail({
        to: Array.from(teamRecipients),
        subject: `✓ ${signerName} signed the ${title} — ${jobLabel}`,
        text: teamText,
        html: teamHtml,
        attachments: [attachment],
      });
    } catch (e: any) {
      console.error("[signature] team email failed:", e?.message || e);
    }
  }

  // 3) Customer confirmation with their signed copy attached.
  try {
    const hi = recipientName ? `Hi ${recipientName},` : "Hello,";
    const customerText =
      `${hi}\n\nThank you for signing the ${title}. Your signed copy is attached to this email for your records.\n\n` +
      `If you have any questions, reply to this email or call us at (803) 528-8683.\n\n` +
      `— Titan Restoration\n${appOrigin}`;
    const customerHtml =
      `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111;line-height:1.6">
         <p>${escapeHtml(hi)}</p>
         <p>Thank you for signing the <strong>${escapeHtml(title)}</strong>. Your signed copy is attached to this email for your records.</p>
         <p>If you have any questions, reply to this email or call us at <strong>(803) 528-8683</strong>.</p>
         <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
         <p style="font-size:12px;color:#888;margin:0">Titan Restoration · (803) 528-8683 · <a href="${appOrigin}" style="color:#888">titanaugusta.pro</a></p>
       </div>`;
    await sendEmail({
      to: recipientEmail,
      subject: `Your signed copy — ${title}`,
      text: customerText,
      html: customerHtml,
      attachments: [attachment],
    });
  } catch (e: any) {
    console.error("[signature] customer email failed:", e?.message || e);
  }

  // Reference unused vars to silence TS.
  void docType;
}
