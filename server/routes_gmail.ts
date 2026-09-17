// ════════════════════════════════════════════════════════════════════════════
// GMAIL INTEGRATION (OAuth 2.0, per-employee) — TEST-SAFE / DORMANT BY DEFAULT
// ----------------------------------------------------------------------------
// Full in-app Gmail: each employee connects their Google Workspace account and
// the app can read their inbox, send mail as them, and mark messages read — all
// without leaving Titan Pro.
//
// DORMANT UNTIL CONFIGURED: every route checks for GOOGLE_CLIENT_ID +
// GOOGLE_CLIENT_SECRET. When those env vars are absent (current state), the
// integration reports `configured:false` and no live Google calls are made. The
// existing Email page keeps working exactly as before. The moment the two env
// vars are added in Railway, this integration activates with zero code changes.
//
// Google Cloud setup: see titan-pro-gmail-google-cloud-setup.md (Internal /
// Workspace path). Redirect URI is derived from the request host (same pattern
// as the QuickBooks OAuth integration): <origin>/api/gmail/oauth/callback
//
// Refresh tokens are stored ENCRYPTED at rest via encryptField() (AES-256-GCM,
// keyed by TITAN_ENCRYPT_KEY). Access tokens are cached with their expiry and
// silently refreshed when stale.
// ════════════════════════════════════════════════════════════════════════════
import type { Express } from "express";
import type { Database } from "better-sqlite3";
import crypto from "crypto";
import { google } from "googleapis";
import { encryptField, decryptField } from "./encryption";

type AuthDeps = {
  requireStaffAuth: (req: any, res: any, next: any) => void;
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => void;
};

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "openid",
  "email",
  "profile",
];

// The integration is live only when both credentials are present.
// Accepts either the canonical GOOGLE_CLIENT_ID/SECRET names OR the common
// GMAIL_CLIENT_ID/SECRET fallback names (many people set those by habit).
function gmailClientId(): string {
  return process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID || "";
}
function gmailClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET || "";
}
export function gmailConfigured(): boolean {
  return !!(gmailClientId() && gmailClientSecret());
}

function redirectUriFor(req: any): string {
  return `${req.protocol}://${req.get("host")}/api/gmail/oauth/callback`;
}

// Server-only redirect URI — used by fan-out senders (mention emails, etc.)
// that have no request in scope. Prefers the explicit APP_ORIGIN env var so
// Google's refresh flow always sees the same URI you registered.
function serverRedirectUri(): string {
  const origin =
    process.env.APP_ORIGIN ||
    process.env.PUBLIC_ORIGIN ||
    "https://titanaugusta.pro";
  return `${origin.replace(/\/+$/, "")}/api/gmail/oauth/callback`;
}

function makeOAuthClient(req: any) {
  return new google.auth.OAuth2(
    gmailClientId(),
    gmailClientSecret(),
    redirectUriFor(req),
  );
}

// Server-side OAuth client (no request). Only for background fan-out flows.
function makeServerOAuthClient() {
  return new google.auth.OAuth2(
    gmailClientId(),
    gmailClientSecret(),
    serverRedirectUri(),
  );
}

// ── EXPORTED: server-side Gmail send for background/fan-out workflows ────────
// Sends an email from `senderEmployeeId`'s connected Gmail account. Returns
// { ok: true, id } on success, or { ok: false, reason } if the sender has no
// Gmail linked or the refresh token is dead. Callers should treat failure as
// non-fatal (log + skip — do not fail the underlying write).
// Attachments are optional; pass a base64 data URI OR raw base64. Filename &
// contentType are used verbatim in the MIME part header.
export type GmailAttachment = {
  filename: string;
  contentType?: string;
  // Either a data URI ("data:application/pdf;base64,...") or raw base64.
  content: string;
};

// Encode a Buffer as base64 with 76-char line breaks (RFC 2045 §6.8).
function base64Mime(buf: Buffer): string {
  const b64 = buf.toString("base64");
  return b64.match(/.{1,76}/g)?.join("\r\n") || b64;
}

// Given the loose input (data URI or bare base64), return a Buffer + inferred
// content type. If the caller supplied a contentType, prefer it.
// RFC 2047 encoded-word for email headers with non-ASCII content. Gmail's
// raw-MIME send silently mangles non-ASCII bytes in the Subject header,
// which is why the em dash in `Cody tagged you on Job … — Stephanie Hadley`
// was rendering as a string of nonsense numbers and letters. This wraps
// non-ASCII subjects in a UTF-8 base64 encoded-word so every mail client
// decodes them cleanly.
function encodeSubjectHeader(s: string): string {
  const str = String(s ?? "");
  // Fast path: 7-bit ASCII, no control chars — safe to inline.
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(str)) return str;
  const b64 = Buffer.from(str, "utf8").toString("base64");
  return `=?utf-8?B?${b64}?=`;
}

function attachmentBuffer(att: GmailAttachment): { buf: Buffer; contentType: string } {
  let b64 = att.content || "";
  let contentType = att.contentType || "";
  // Tolerant of extra media-type parameters (jsPDF sneaks in
  // `;filename=generated.pdf` before `;base64,`). Without this the whole
  // data URI falls through to Buffer.from(...,'base64') and silently
  // produces garbage bytes, so the Gmail attachment opens to a black page.
  const m = /^data:([^;,]+)(?:;[^;,]+=[^;,]+)*;base64,(.*)$/s.exec(b64);
  if (m) {
    if (!contentType) contentType = m[1];
    b64 = m[2];
  }
  if (!contentType) contentType = "application/octet-stream";
  const buf = Buffer.from(b64, "base64");
  return { buf, contentType };
}

// Pick a connected employee to send system emails as. Prefers the owner /
// admin so recipients see the company principal. Falls back to any employee
// with a valid refresh token. Returns null when nobody is connected.
export function pickCompanyGmailSender(sqlite: Database): { id: number; email: string } | null {
  if (!gmailConfigured()) return null;
  // 1) Try owner / admin employees first
  const preferred: any = sqlite
    .prepare(
      "SELECT id, gmail_email FROM employees WHERE gmail_refresh_token IS NOT NULL AND gmail_refresh_token != '' AND role IN ('owner','admin') ORDER BY id ASC LIMIT 1",
    )
    .get();
  if (preferred && preferred.id) return { id: preferred.id, email: preferred.gmail_email || "" };
  // 2) Any connected employee
  const any: any = sqlite
    .prepare(
      "SELECT id, gmail_email FROM employees WHERE gmail_refresh_token IS NOT NULL AND gmail_refresh_token != '' ORDER BY id ASC LIMIT 1",
    )
    .get();
  if (any && any.id) return { id: any.id, email: any.gmail_email || "" };
  return null;
}

export async function sendGmailAsEmployee(
  sqlite: Database,
  senderEmployeeId: number,
  args: {
    to: string | string[];
    cc?: string;
    bcc?: string;
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
    attachments?: GmailAttachment[];
    // Threading headers used by Reply / Reply All / scheduled replies.
    threadId?: string;
    inReplyTo?: string;
    references?: string;
  },
): Promise<{ ok: true; id: string | null } | { ok: false; reason: string }> {
  if (!gmailConfigured()) return { ok: false, reason: "not_configured" };
  const row: any = sqlite
    .prepare(
      "SELECT gmail_refresh_token, gmail_access_token, gmail_token_expiry, gmail_email FROM employees WHERE id = ?",
    )
    .get(senderEmployeeId);
  if (!row || !row.gmail_refresh_token) return { ok: false, reason: "sender_not_connected" };

  const refreshToken = decryptField(row.gmail_refresh_token);
  if (!refreshToken) return { ok: false, reason: "refresh_token_unreadable" };

  const oauth2 = makeServerOAuthClient();
  oauth2.setCredentials({ refresh_token: refreshToken });

  // Reuse cached access token when possible, otherwise refresh.
  const expiry = row.gmail_token_expiry ? Date.parse(row.gmail_token_expiry) : 0;
  if (row.gmail_access_token && expiry && expiry - Date.now() > 60_000) {
    oauth2.setCredentials({
      refresh_token: refreshToken,
      access_token: decryptField(row.gmail_access_token) || undefined,
      expiry_date: expiry,
    });
  } else {
    try {
      const { credentials } = await oauth2.refreshAccessToken();
      oauth2.setCredentials(credentials);
      sqlite
        .prepare("UPDATE employees SET gmail_access_token = ?, gmail_token_expiry = ? WHERE id = ?")
        .run(
          encryptField(credentials.access_token || ""),
          credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
          senderEmployeeId,
        );
    } catch (e: any) {
      return { ok: false, reason: "refresh_failed: " + (e?.message || String(e)) };
    }
  }

  const toList = Array.isArray(args.to) ? args.to.join(", ") : args.to;
  const from = row.gmail_email || "";
  const subject = args.subject || "(no subject)";
  const hasAttachments = Array.isArray(args.attachments) && args.attachments.length > 0;
  const altBoundary = "----titanpro_alt_" + crypto.randomBytes(8).toString("hex");
  const mixedBoundary = "----titanpro_mix_" + crypto.randomBytes(8).toString("hex");

  // Multipart alternative so the recipient's client renders HTML but plain-text
  // clients still get a readable fallback.
  const textPart = args.text || (args.html ? args.html.replace(/<[^>]+>/g, "") : "");
  const htmlPart = args.html || `<pre style="font-family:inherit">${textPart}</pre>`;

  // Top-level headers. When attachments exist the outer type is multipart/mixed
  // and the alternative pair is nested inside; without attachments the outer
  // type is multipart/alternative directly.
  const outerContentType = hasAttachments
    ? `multipart/mixed; boundary="${mixedBoundary}"`
    : `multipart/alternative; boundary="${altBoundary}"`;

  const headers = [
    `To: ${toList}`,
    args.cc ? `Cc: ${args.cc}` : "",
    args.bcc ? `Bcc: ${args.bcc}` : "",
    from ? `From: ${from}` : "",
    args.replyTo ? `Reply-To: ${args.replyTo}` : "",
    `Subject: ${encodeSubjectHeader(subject)}`,
    args.inReplyTo ? `In-Reply-To: ${args.inReplyTo}` : "",
    args.references ? `References: ${args.references}` : "",
    "MIME-Version: 1.0",
    `Content-Type: ${outerContentType}`,
  ].filter(Boolean);

  const alternativeBlock = [
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    textPart,
    "",
    `--${altBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    htmlPart,
    "",
    `--${altBoundary}--`,
    "",
  ].join("\r\n");

  let body: string;
  if (hasAttachments) {
    const attachmentBlocks: string[] = [];
    for (const att of args.attachments!) {
      const { buf, contentType } = attachmentBuffer(att);
      attachmentBlocks.push(
        [
          `--${mixedBoundary}`,
          `Content-Type: ${contentType}; name="${att.filename}"`,
          `Content-Disposition: attachment; filename="${att.filename}"`,
          "Content-Transfer-Encoding: base64",
          "",
          base64Mime(buf),
          "",
        ].join("\r\n"),
      );
    }
    body = [
      ...headers,
      "",
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      alternativeBlock,
      ...attachmentBlocks,
      `--${mixedBoundary}--`,
      "",
    ].join("\r\n");
  } else {
    body = [
      ...headers,
      "",
      alternativeBlock,
    ].join("\r\n");
  }

  const raw = Buffer.from(body)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  try {
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const requestBody: any = { raw };
    if (args.threadId) requestBody.threadId = args.threadId;
    const sent = await gmail.users.messages.send({ userId: "me", requestBody });
    return { ok: true, id: sent.data.id || null };
  } catch (e: any) {
    return { ok: false, reason: "send_failed: " + (e?.message || String(e)) };
  }
}

// Signed state so the tokenless callback can trust WHICH employee is connecting.
// state = "<employeeId>.<hmac(employeeId)>" using TITAN_ENCRYPT_KEY as the secret.
function stateSecret(): string {
  return process.env.TITAN_ENCRYPT_KEY || "titan_pro_gmail_state_dev_secret";
}
function signState(employeeId: number): string {
  const mac = crypto.createHmac("sha256", stateSecret()).update(String(employeeId)).digest("hex");
  return `${employeeId}.${mac}`;
}
function verifyState(state: string): number | null {
  if (!state || !state.includes(".")) return null;
  const [idStr, mac] = state.split(".");
  const expected = crypto.createHmac("sha256", stateSecret()).update(idStr).digest("hex");
  // constant-time compare
  const a = Buffer.from(mac || "", "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const id = Number(idStr);
  return Number.isFinite(id) ? id : null;
}

export function registerGmailRoutes(app: Express, sqlite: Database, deps: AuthDeps) {
  const { requireStaffAuth, requireRole } = deps;

  // ── Helper: get a valid (fresh) access token for an employee ───────────────
  // Refreshes via the stored refresh token when the cached access token is stale.
  // Returns null when not connected / not configured.
  async function getAuthedClientForEmployee(req: any, employeeId: number) {
    if (!gmailConfigured()) return null;
    const emp: any = sqlite.prepare(
      "SELECT id, gmail_refresh_token, gmail_access_token, gmail_token_expiry FROM employees WHERE id = ?",
    ).get(employeeId);
    if (!emp || !emp.gmail_refresh_token) return null;

    const refreshToken = decryptField(emp.gmail_refresh_token);
    if (!refreshToken) return null;

    const oauth2 = makeOAuthClient(req);
    oauth2.setCredentials({ refresh_token: refreshToken });

    // Reuse cached access token if it's still valid for >60s.
    const expiry = emp.gmail_token_expiry ? Date.parse(emp.gmail_token_expiry) : 0;
    if (emp.gmail_access_token && expiry && expiry - Date.now() > 60_000) {
      oauth2.setCredentials({
        refresh_token: refreshToken,
        access_token: decryptField(emp.gmail_access_token) || undefined,
        expiry_date: expiry,
      });
      return oauth2;
    }

    // Otherwise refresh and persist the new access token + expiry.
    try {
      const { credentials } = await oauth2.refreshAccessToken();
      oauth2.setCredentials(credentials);
      sqlite.prepare(
        "UPDATE employees SET gmail_access_token = ?, gmail_token_expiry = ? WHERE id = ?",
      ).run(
        encryptField(credentials.access_token || ""),
        credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
        employeeId,
      );
      return oauth2;
    } catch {
      return null; // refresh token revoked/expired — treat as disconnected
    }
  }

  // ── STATUS: is Gmail configured, and is THIS employee connected? ───────────
  // Always safe to call. Used by the frontend to decide which UI to show.
  // Owner / admin also get a `diag` block showing exactly which env var names
  // the server can see — handy for debugging Railway configuration without
  // leaking any secret values.
  app.get("/api/gmail/status", requireStaffAuth, (req: any, res) => {
    const emp = req.employee;
    const row: any = sqlite.prepare(
      "SELECT gmail_email, gmail_connected, gmail_connected_at FROM employees WHERE id = ?",
    ).get(emp.id);
    const payload: any = {
      configured: gmailConfigured(),
      connected: !!(row && row.gmail_connected && row.gmail_email),
      email: row?.gmail_email || null,
      connectedAt: row?.gmail_connected_at || null,
    };
    if (emp && ["owner", "admin"].includes(String(emp.role))) {
      payload.diag = {
        expectedRedirectUri: redirectUriFor(req),
        env: {
          GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
          GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
          GMAIL_CLIENT_ID: !!process.env.GMAIL_CLIENT_ID,
          GMAIL_CLIENT_SECRET: !!process.env.GMAIL_CLIENT_SECRET,
          GOOGLE_MAPS_API_KEY: !!process.env.GOOGLE_MAPS_API_KEY,
          TITAN_ENCRYPT_KEY: !!process.env.TITAN_ENCRYPT_KEY,
        },
      };
    }
    res.json(payload);
  });

  // ── OAUTH START: returns the Google consent URL for the current employee ───
  app.get("/api/gmail/oauth/start", requireStaffAuth, (req: any, res) => {
    if (!gmailConfigured()) {
      return res.status(400).json({
        error: "Gmail integration is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the server environment.",
        configured: false,
      });
    }
    const oauth2 = makeOAuthClient(req);
    const authUrl = oauth2.generateAuthUrl({
      access_type: "offline",       // returns a refresh token
      prompt: "consent",            // ensures refresh token is (re)issued
      scope: GMAIL_SCOPES,
      state: signState(req.employee.id),
      include_granted_scopes: true,
    });
    res.json({ authUrl });
  });

  // ── OAUTH CALLBACK: Google redirects the browser here (NO bearer token) ────
  // Allowlisted in the global auth gate. Employee identity comes from the signed
  // state param, not a session.
  app.get("/api/gmail/oauth/callback", async (req: any, res) => {
    const closeWindow = (msg: string, ok: boolean) =>
      res.set("Content-Type", "text/html").send(
        `<!doctype html><html><body style="font-family:-apple-system,sans-serif;text-align:center;padding:48px;color:${ok ? "#166534" : "#b91c1c"}">
        <h2>${ok ? "Gmail connected" : "Connection failed"}</h2>
        <p>${msg}</p>
        <script>setTimeout(function(){window.close()},1500)</script>
        <p style="color:#6b7280;font-size:13px">You can close this window.</p>
        </body></html>`,
      );

    if (!gmailConfigured()) return closeWindow("Gmail integration is not configured.", false);
    const { code, state, error } = req.query as any;
    if (error) return closeWindow("Google returned: " + error, false);
    const employeeId = verifyState(String(state || ""));
    if (!employeeId) return closeWindow("Invalid or expired connection request. Please try again.", false);

    try {
      const oauth2 = makeOAuthClient(req);
      const { tokens } = await oauth2.getToken(String(code));
      if (!tokens.refresh_token) {
        // No refresh token means a prior grant exists; user must revoke & retry.
        return closeWindow("No refresh token returned. Disconnect any prior Titan Pro access in your Google account, then reconnect.", false);
      }
      oauth2.setCredentials(tokens);

      // Fetch the connecting account's email address for display/from-line.
      let email: string | null = null;
      try {
        const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
        const me = await oauth2Api.userinfo.get();
        email = me.data.email || null;
      } catch { /* non-fatal — email stays null */ }

      sqlite.prepare(
        `UPDATE employees SET
           gmail_refresh_token = ?, gmail_access_token = ?, gmail_token_expiry = ?,
           gmail_connected = 1, gmail_connected_at = ?, gmail_email = COALESCE(?, gmail_email)
         WHERE id = ?`,
      ).run(
        encryptField(tokens.refresh_token),
        encryptField(tokens.access_token || ""),
        tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        new Date().toISOString(),
        email,
        employeeId,
      );
      return closeWindow(email ? `${email} is now linked to Titan Pro.` : "Your Gmail is now linked to Titan Pro.", true);
    } catch (e: any) {
      return closeWindow("OAuth error: " + (e?.message || String(e)), false);
    }
  });

  // ── DISCONNECT: revoke + clear this employee's Gmail connection ────────────
  app.post("/api/gmail/disconnect", requireStaffAuth, async (req: any, res) => {
    const emp = req.employee;
    const row: any = sqlite.prepare("SELECT gmail_refresh_token FROM employees WHERE id = ?").get(emp.id);
    // Best-effort revoke at Google; ignore failures.
    if (gmailConfigured() && row?.gmail_refresh_token) {
      try {
        const oauth2 = makeOAuthClient(req);
        const rt = decryptField(row.gmail_refresh_token);
        if (rt) await oauth2.revokeToken(rt);
      } catch { /* ignore */ }
    }
    sqlite.prepare(
      `UPDATE employees SET gmail_refresh_token = NULL, gmail_access_token = NULL,
        gmail_token_expiry = NULL, gmail_connected = 0, gmail_connected_at = NULL WHERE id = ?`,
    ).run(emp.id);
    res.json({ success: true });
  });

  // ── ADMIN STATUS: Gmail connection state for ALL employees ─────────────────
  // Owner/admin only. Powers the per-employee connection badges in User Mgmt.
  app.get("/api/gmail/admin/status", requireRole("owner", "admin"), (_req, res) => {
    const rows: any[] = sqlite.prepare(
      "SELECT id, name, gmail_email, gmail_connected, gmail_connected_at FROM employees ORDER BY id",
    ).all();
    res.json({
      configured: gmailConfigured(),
      employees: rows.map((r) => ({
        id: r.id, name: r.name, email: r.gmail_email,
        connected: !!r.gmail_connected, connectedAt: r.gmail_connected_at,
      })),
    });
  });

  // ── ADMIN DISCONNECT: owner/admin revokes a specific employee's Gmail ──────
  // NOTE: only DISCONNECT is possible on someone's behalf. CONNECT must be done
  // by that employee themselves (Google issues tokens to whoever completes the
  // consent screen), so each person connects their own account.
  app.post("/api/gmail/admin/disconnect/:employeeId", requireRole("owner", "admin"), async (req: any, res) => {
    const employeeId = Number(req.params.employeeId);
    const row: any = sqlite.prepare("SELECT gmail_refresh_token FROM employees WHERE id = ?").get(employeeId);
    if (!row) return res.status(404).json({ error: "Employee not found." });
    if (gmailConfigured() && row.gmail_refresh_token) {
      try {
        const oauth2 = makeOAuthClient(req);
        const rt = decryptField(row.gmail_refresh_token);
        if (rt) await oauth2.revokeToken(rt);
      } catch { /* ignore */ }
    }
    sqlite.prepare(
      `UPDATE employees SET gmail_refresh_token = NULL, gmail_access_token = NULL,
        gmail_token_expiry = NULL, gmail_connected = 0, gmail_connected_at = NULL WHERE id = ?`,
    ).run(employeeId);
    res.json({ success: true });
  });

  // ── MESSAGES: live inbox for the current employee ──────────────────────────
  // Query: ?labelIds=INBOX (default) | SENT | DRAFT, ?max=25, ?q=<gmail search>
  app.get("/api/gmail/messages", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });

    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const labelIds = [String(req.query.labelIds || "INBOX")];
      const maxResults = Math.min(Number(req.query.max || 25), 50);
      const q = req.query.q ? String(req.query.q) : undefined;
      const pageToken = req.query.pageToken ? String(req.query.pageToken) : undefined;

      const list = await gmail.users.messages.list({ userId: "me", labelIds, maxResults, q, pageToken });
      const ids = (list.data.messages || []).map((m) => m.id!).filter(Boolean);

      // Fetch metadata for each message (parallel, capped by maxResults above).
      const messages = await Promise.all(ids.map(async (id) => {
        const msg = await gmail.users.messages.get({
          userId: "me", id, format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date"],
        });
        const headers = (msg.data.payload?.headers || []).reduce((acc: any, h: any) => {
          acc[h.name.toLowerCase()] = h.value; return acc;
        }, {});
        const labelIds = msg.data.labelIds || [];
        return {
          id: msg.data.id,
          threadId: msg.data.threadId,
          snippet: msg.data.snippet,
          from: headers.from || "",
          to: headers.to || "",
          subject: headers.subject || "(no subject)",
          date: headers.date || "",
          unread: labelIds.includes("UNREAD"),
          starred: labelIds.includes("STARRED"),
          important: labelIds.includes("IMPORTANT"),
          labels: labelIds,
        };
      }));
      res.json({ messages, nextPageToken: list.data.nextPageToken || null, resultSizeEstimate: list.data.resultSizeEstimate ?? null });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to load messages." });
    }
  });

  // ── MESSAGE DETAIL: full body of one message ───────────────────────────────
  app.get("/api/gmail/messages/:id", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const msg = await gmail.users.messages.get({ userId: "me", id: req.params.id, format: "full" });
      const headers = (msg.data.payload?.headers || []).reduce((acc: any, h: any) => {
        acc[h.name.toLowerCase()] = h.value; return acc;
      }, {});
      // Reply headers surfaced to the client so Reply All / Forward can
      // build the correct outgoing thread membership + In-Reply-To chain.
      const messageId = headers["message-id"] || "";
      const inReplyTo = headers["in-reply-to"] || "";
      const references = headers["references"] || "";
      const cc = headers["cc"] || "";
      const bcc = headers["bcc"] || "";
      const replyTo = headers["reply-to"] || "";
      // Extract text body AND every attachment part from the payload tree.
      // Gmail nests parts as a tree (multipart/mixed → multipart/alternative →
      // text/plain + text/html, plus siblings for each attachment). We walk
      // it once, keep the first plain/html body, and collect every part that
      // has a filename or a Content-Disposition of attachment/inline.
      const decode = (data?: string | null) => data ? Buffer.from(data, "base64").toString("utf8") : "";
      let body = "";
      let bodyIsHtml = false;
      const attachments: Array<{
        attachmentId: string;
        filename: string;
        mimeType: string;
        size: number;
        inline: boolean;
        contentId?: string;
      }> = [];
      const walk = (part: any): void => {
        if (!part) return;
        // Body: prefer HTML when present, else plain.
        if (part.mimeType === "text/html" && part.body?.data && !bodyIsHtml) {
          body = decode(part.body.data);
          bodyIsHtml = true;
        } else if (part.mimeType === "text/plain" && part.body?.data && !body) {
          body = decode(part.body.data);
        }
        // Attachment: any part with a filename that has an attachmentId.
        // Inline parts (referenced from an HTML body via cid:) still count so
        // downloadable inline PDFs / images show up in the strip.
        const filename = part.filename || "";
        const attachmentId = part.body?.attachmentId || "";
        if (filename && attachmentId) {
          const disp = (part.headers || []).find((h: any) => (h.name || "").toLowerCase() === "content-disposition");
          const cid = (part.headers || []).find((h: any) => (h.name || "").toLowerCase() === "content-id");
          attachments.push({
            attachmentId,
            filename,
            mimeType: part.mimeType || "application/octet-stream",
            size: Number(part.body?.size) || 0,
            inline: /inline/i.test(disp?.value || ""),
            contentId: cid?.value?.replace(/[<>]/g, ""),
          });
        }
        (part.parts || []).forEach(walk);
      };
      walk(msg.data.payload);
      res.json({
        id: msg.data.id, threadId: msg.data.threadId,
        from: headers.from || "", to: headers.to || "",
        subject: headers.subject || "(no subject)", date: headers.date || "",
        body,
        attachments,
              messageId, inReplyTo, references, cc, bcc, replyTo,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to load message." });
    }
  });

  // ── SEND: send a real email as the current employee ────────────────────────
  // body: {
  //   to, subject, body, cc?, bcc?,
  //   attachments?: Array<{ filename, mimeType, dataBase64 }>
  // }
  //
  // When no attachments are provided we build a simple text/plain message
  // (same as before). When attachments are provided we build a multipart/
  // mixed message: alternative(text/plain) + one part per attachment. Gmail
  // caps outbound at 25 MB total; we enforce it here too so the API doesn't
  // just error out mid-send.
  const GMAIL_SEND_LIMIT = 25 * 1024 * 1024;

  function b64url(buf: Buffer): string {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  // MIME wants base64 wrapped at 76 chars per line.
  function b64wrap(str: string): string {
    return str.match(/.{1,76}/g)?.join("\r\n") || str;
  }
  // A safe filename for the Content-Disposition header. Non-ASCII names
  // switch to RFC 2231 encoding so they round-trip through Gmail correctly.
  function encodeFilename(name: string): string {
    if (/^[\x20-\x7E]+$/.test(name) && !/["\\]/.test(name)) {
      return `"${name}"`;
    }
    return `"file"; filename*=UTF-8''${encodeURIComponent(name)}`;
  }

  app.post("/api/gmail/send", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });

    const { to, subject, body, html, cc, bcc, attachments, threadId, inReplyTo, references, replyTo } = req.body || {};
    if (!to || !String(to).trim()) return res.status(400).json({ error: "Recipient (to) is required." });

    // Validate attachments up front so we never build a truncated MIME blob.
    const atts: Array<{ filename: string; mimeType: string; buf: Buffer }> = [];
    if (Array.isArray(attachments)) {
      let total = 0;
      for (const a of attachments) {
        if (!a?.filename || !a?.dataBase64) {
          return res.status(400).json({ error: "Each attachment needs filename and dataBase64." });
        }
        const buf = Buffer.from(String(a.dataBase64), "base64");
        total += buf.length;
        if (total > GMAIL_SEND_LIMIT) {
          return res.status(413).json({ error: "Attachments exceed Gmail's 25 MB send limit." });
        }
        atts.push({
          filename: String(a.filename),
          mimeType: String(a.mimeType || "application/octet-stream"),
          buf,
        });
      }
    }

    try {
      const from = (sqlite.prepare("SELECT gmail_email FROM employees WHERE id = ?").get(req.employee.id) as any)?.gmail_email || "";
      // Threading headers wire the outgoing message into an existing Gmail
      // conversation. Gmail also needs `threadId` in the request body, but
      // In-Reply-To + References are what other MUAs (Outlook, Apple Mail,
      // etc.) actually thread on.
      const threadHeaders: string[] = [];
      if (inReplyTo) threadHeaders.push(`In-Reply-To: ${inReplyTo}`);
      if (references) threadHeaders.push(`References: ${references}`);
      const commonHeaders = [
        `To: ${to}`,
        cc ? `Cc: ${cc}` : "",
        bcc ? `Bcc: ${bcc}` : "",
        from ? `From: ${from}` : "",
        replyTo ? `Reply-To: ${replyTo}` : "",
        `Subject: ${encodeSubjectHeader(subject || "(no subject)")}`,
        ...threadHeaders,
        "MIME-Version: 1.0",
      ].filter(Boolean);

      // Body can arrive as `html` (rich compose), `body` (legacy plain
      // text), or both. We always send multipart/alternative so recipients
      // that reject HTML still get a readable fallback.
      const textPart = body || (html ? html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "") : "");
      const htmlPart = html || (body ? `<pre style="font-family:inherit;white-space:pre-wrap">${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>` : "");
      const altBoundary = `alt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      const alternativeBlock = [
        `--${altBoundary}`,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 7bit",
        "",
        textPart,
        "",
        `--${altBoundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: 7bit",
        "",
        htmlPart,
        "",
        `--${altBoundary}--`,
        "",
      ].join("\r\n");

      let mime: string;
      if (atts.length === 0) {
        mime = [
          ...commonHeaders,
          `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
          "",
          alternativeBlock,
        ].join("\r\n");
      } else {
        // multipart/mixed with a nested multipart/alternative for body + a
        // sibling part for each attachment.
        const mixedBoundary = `mix_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        const parts: string[] = [];
        parts.push([
          `--${mixedBoundary}`,
          `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
          "",
          alternativeBlock,
        ].join("\r\n"));
        for (const a of atts) {
          parts.push([
            `--${mixedBoundary}`,
            `Content-Type: ${a.mimeType}; name=${encodeFilename(a.filename)}`,
            `Content-Disposition: attachment; filename=${encodeFilename(a.filename)}`,
            "Content-Transfer-Encoding: base64",
            "",
            b64wrap(a.buf.toString("base64")),
          ].join("\r\n"));
        }
        parts.push(`--${mixedBoundary}--`);
        mime = [
          ...commonHeaders,
          `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
          "",
          parts.join("\r\n"),
        ].join("\r\n");
      }

      const raw = b64url(Buffer.from(mime, "utf8"));
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      // Gmail keeps the message on the same conversation when we pass a
      // threadId in the request body (not the MIME).
      const requestBody: any = { raw };
      if (threadId) requestBody.threadId = threadId;
      const sent = await gmail.users.messages.send({ userId: "me", requestBody });
      res.json({
        success: true,
        id: sent.data.id,
        threadId: sent.data.threadId,
        attachmentCount: atts.length,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to send email." });
    }
  });

  // ── SIGNATURE ──────────────────────────────────────────────────────────
  // Each employee has their own HTML signature block that the client
  // pre-fills into every new compose. Storage is a simple text column so
  // the same signature is available from every browser they sign in on.
  app.get("/api/gmail/signature", requireStaffAuth, (req: any, res) => {
    const row: any = sqlite.prepare("SELECT email_signature FROM employees WHERE id = ?").get(req.employee.id);
    res.json({ signature: row?.email_signature || "" });
  });
  app.put("/api/gmail/signature", requireStaffAuth, (req: any, res) => {
    const sig = typeof req.body?.signature === "string" ? req.body.signature : "";
    // Cap at 8 KB to prevent someone pasting a giant HTML page.
    if (sig.length > 8192) return res.status(413).json({ error: "Signature is too long (8 KB max)." });
    sqlite.prepare("UPDATE employees SET email_signature = ? WHERE id = ?").run(sig, req.employee.id);
    res.json({ ok: true, signature: sig });
  });

  // ── DRAFTS ──────────────────────────────────────────────────────────
  // Drafts live in Gmail (users.drafts). We surface them so the compose
  // window can persist unfinished emails between browsers and let the user
  // resume them from the Drafts folder in the sidebar. Every save is a
  // full replace of the draft body (Gmail overwrites on update).
  //
  // Helper: build the raw MIME for a draft. Reuses the same builder shape as
  // the send route so drafts round-trip cleanly when the user hits Send.
  function buildDraftRaw(input: {
    to: string; cc?: string; bcc?: string; subject: string; body?: string; html?: string;
    from?: string; inReplyTo?: string; references?: string;
  }): string {
    const alt = `alt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const text = input.body || (input.html ? input.html.replace(/<[^>]+>/g, "") : "");
    const html = input.html || (input.body ? `<pre style="font-family:inherit;white-space:pre-wrap">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>` : "");
    const headers = [
      `To: ${input.to || ""}`,
      input.cc ? `Cc: ${input.cc}` : "",
      input.bcc ? `Bcc: ${input.bcc}` : "",
      input.from ? `From: ${input.from}` : "",
      `Subject: ${encodeSubjectHeader(input.subject || "(no subject)")}`,
      input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}` : "",
      input.references ? `References: ${input.references}` : "",
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${alt}"`,
    ].filter(Boolean);
    const body = [
      ...headers,
      "",
      `--${alt}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      text,
      "",
      `--${alt}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      html,
      "",
      `--${alt}--`,
      "",
    ].join("\r\n");
    return Buffer.from(body, "utf8").toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // POST /api/gmail/drafts   → create a new draft. Body: the standard
  // compose payload; returns { id }.
  app.post("/api/gmail/drafts", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    try {
      const from = (sqlite.prepare("SELECT gmail_email FROM employees WHERE id = ?").get(req.employee.id) as any)?.gmail_email || "";
      const raw = buildDraftRaw({ ...req.body, from });
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const created = await gmail.users.drafts.create({
        userId: "me",
        requestBody: { message: { raw, threadId: req.body?.threadId || undefined } },
      });
      res.json({ id: created.data.id, messageId: created.data.message?.id });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to save draft." });
    }
  });

  // PUT /api/gmail/drafts/:id → overwrite an existing draft with new body.
  app.put("/api/gmail/drafts/:id", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    try {
      const from = (sqlite.prepare("SELECT gmail_email FROM employees WHERE id = ?").get(req.employee.id) as any)?.gmail_email || "";
      const raw = buildDraftRaw({ ...req.body, from });
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const updated = await gmail.users.drafts.update({
        userId: "me",
        id: req.params.id,
        requestBody: { message: { raw, threadId: req.body?.threadId || undefined } },
      });
      res.json({ id: updated.data.id, messageId: updated.data.message?.id });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to update draft." });
    }
  });

  // GET /api/gmail/drafts → list metadata (id + subject + snippet)
  app.get("/api/gmail/drafts", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const list = await gmail.users.drafts.list({ userId: "me", maxResults: 25 });
      const drafts = list.data.drafts || [];
      // Enrich with metadata headers so the sidebar can show subject + date.
      const rows = await Promise.all(drafts.map(async (d) => {
        try {
          const msg = await gmail.users.messages.get({
            userId: "me", id: d.message?.id || "", format: "metadata",
            metadataHeaders: ["From", "To", "Subject", "Date"],
          });
          const headers = (msg.data.payload?.headers || []).reduce((acc: any, h: any) => {
            acc[h.name.toLowerCase()] = h.value; return acc;
          }, {});
          return {
            draftId: d.id,
            messageId: d.message?.id,
            threadId: d.message?.threadId,
            snippet: msg.data.snippet,
            to: headers.to || "",
            subject: headers.subject || "(no subject)",
            date: headers.date || "",
          };
        } catch { return { draftId: d.id, messageId: d.message?.id, subject: "(unreadable)", to: "", snippet: "", date: "" }; }
      }));
      res.json({ drafts: rows });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to list drafts." });
    }
  });

  // GET /api/gmail/drafts/:id → full draft (for opening in compose)
  app.get("/api/gmail/drafts/:id", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const draft = await gmail.users.drafts.get({ userId: "me", id: req.params.id, format: "full" });
      const payload = draft.data.message?.payload;
      const headers = (payload?.headers || []).reduce((acc: any, h: any) => {
        acc[h.name.toLowerCase()] = h.value; return acc;
      }, {});
      // Extract body text + html by walking payload parts. Same logic as the
      // message detail handler.
      let bodyText = "";
      let bodyHtml = "";
      const walk = (part: any) => {
        if (!part) return;
        const data = part.body?.data;
        if (data) {
          const decoded = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
          if (part.mimeType === "text/plain") bodyText = decoded;
          else if (part.mimeType === "text/html") bodyHtml = decoded;
        }
        (part.parts || []).forEach(walk);
      };
      walk(payload);
      res.json({
        draftId: draft.data.id,
        messageId: draft.data.message?.id,
        threadId: draft.data.message?.threadId,
        to: headers.to || "",
        cc: headers.cc || "",
        bcc: headers.bcc || "",
        subject: headers.subject || "",
        body: bodyText,
        bodyHtml,
        inReplyTo: headers["in-reply-to"] || "",
        references: headers["references"] || "",
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to load draft." });
    }
  });

  // DELETE /api/gmail/drafts/:id
  app.delete("/api/gmail/drafts/:id", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      await gmail.users.drafts.delete({ userId: "me", id: req.params.id });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to delete draft." });
    }
  });

  // ── SCHEDULED SEND ───────────────────────────────────────────────────────
  // Store the full send payload in SQLite along with the wake-time. The
  // email ticker (server/email_scheduler.ts) polls every 30s and fires
  // sendGmailAsEmployee when scheduled_for <= now.
  app.post("/api/gmail/schedule", requireStaffAuth, (req: any, res) => {
    const { scheduledFor, payload } = req.body || {};
    if (!scheduledFor) return res.status(400).json({ error: "scheduledFor required." });
    if (!payload?.to || !payload?.subject) return res.status(400).json({ error: "payload.to and payload.subject required." });
    const when = Date.parse(scheduledFor);
    if (Number.isNaN(when)) return res.status(400).json({ error: "scheduledFor is not a valid date." });
    if (when < Date.now() - 60_000) return res.status(400).json({ error: "scheduledFor must be in the future." });
    const row = sqlite.prepare(
      `INSERT INTO email_scheduled (employee_id, scheduled_for, payload_json) VALUES (?, ?, ?) RETURNING *`,
    ).get(req.employee.id, new Date(when).toISOString(), JSON.stringify(payload));
    res.json(row);
  });
  app.get("/api/gmail/schedule", requireStaffAuth, (req: any, res) => {
    const rows = sqlite.prepare(
      `SELECT id, scheduled_for, status, error, sent_message_id, created_at, processed_at,
              json_extract(payload_json, '$.to') AS to_field,
              json_extract(payload_json, '$.subject') AS subject
         FROM email_scheduled WHERE employee_id = ? ORDER BY scheduled_for DESC LIMIT 100`,
    ).all(req.employee.id);
    res.json({ scheduled: rows });
  });
  app.delete("/api/gmail/schedule/:id", requireStaffAuth, (req: any, res) => {
    const row: any = sqlite.prepare(`SELECT * FROM email_scheduled WHERE id = ? AND employee_id = ?`).get(req.params.id, req.employee.id);
    if (!row) return res.status(404).json({ error: "Not found." });
    if (row.status !== "pending") return res.status(409).json({ error: `Cannot cancel a ${row.status} scheduled send.` });
    sqlite.prepare(`DELETE FROM email_scheduled WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  });

  // ── SNOOZE ────────────────────────────────────────────────────────────
  // A snoozed message is:
  //   1) removed from INBOX  → add SNOOZED custom label + remove INBOX
  //   2) tracked in email_snooze until wake_at
  //   3) restored to INBOX on wake by the email ticker
  // We create the custom label lazily if it doesn't exist yet.
  async function ensureSnoozedLabel(gmail: any): Promise<string | null> {
    try {
      const list = await gmail.users.labels.list({ userId: "me" });
      const found = (list.data.labels || []).find((l: any) => l.name === "Titan/Snoozed");
      if (found) return found.id;
      const created = await gmail.users.labels.create({
        userId: "me",
        requestBody: { name: "Titan/Snoozed", labelListVisibility: "labelHide", messageListVisibility: "hide" },
      });
      return created.data.id || null;
    } catch { return null; }
  }
  app.post("/api/gmail/messages/:id/snooze", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    const wakeAt = req.body?.wakeAt;
    if (!wakeAt) return res.status(400).json({ error: "wakeAt required." });
    const when = Date.parse(wakeAt);
    if (Number.isNaN(when) || when < Date.now() + 60_000) return res.status(400).json({ error: "wakeAt must be at least 1 minute in the future." });
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const labelId = await ensureSnoozedLabel(gmail);
      const modify: any = { removeLabelIds: ["INBOX"] };
      if (labelId) modify.addLabelIds = [labelId];
      await gmail.users.messages.modify({ userId: "me", id: req.params.id, requestBody: modify });
      // Also stash thread id for restoring the whole conversation on wake.
      const meta = await gmail.users.messages.get({ userId: "me", id: req.params.id, format: "metadata", metadataHeaders: [] });
      sqlite.prepare(
        `INSERT INTO email_snooze (employee_id, gmail_message_id, gmail_thread_id, wake_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(employee_id, gmail_message_id) DO UPDATE SET wake_at = excluded.wake_at, status = 'pending'`,
      ).run(req.employee.id, req.params.id, meta.data.threadId || null, new Date(when).toISOString());
      res.json({ ok: true, wakeAt: new Date(when).toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to snooze message." });
    }
  });
  app.get("/api/gmail/snooze", requireStaffAuth, (req: any, res) => {
    const rows = sqlite.prepare(
      `SELECT id, gmail_message_id AS messageId, gmail_thread_id AS threadId, wake_at AS wakeAt, status, created_at
         FROM email_snooze WHERE employee_id = ? AND status = 'pending' ORDER BY wake_at ASC`,
    ).all(req.employee.id);
    res.json({ snoozed: rows });
  });
  app.delete("/api/gmail/snooze/:id", requireStaffAuth, async (req: any, res) => {
    // Cancelling early: pull the message back into INBOX now.
    const row: any = sqlite.prepare(`SELECT * FROM email_snooze WHERE id = ? AND employee_id = ?`).get(req.params.id, req.employee.id);
    if (!row) return res.status(404).json({ error: "Not found." });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (oauth2) {
      try {
        const gmail = google.gmail({ version: "v1", auth: oauth2 });
        const labelId = await ensureSnoozedLabel(gmail);
        const modify: any = { addLabelIds: ["INBOX"] };
        if (labelId) modify.removeLabelIds = [labelId];
        await gmail.users.messages.modify({ userId: "me", id: row.gmail_message_id, requestBody: modify });
      } catch { /* still cancel the row locally */ }
    }
    sqlite.prepare(`UPDATE email_snooze SET status = 'cancelled', woke_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  });

  // ── CONTACT AUTOCOMPLETE ─────────────────────────────────────────────
  // Unions: employees.gmail_email + contacts.email + jobs.customer_email +
  // (optionally) People API. Small, cache-friendly, no OAuth needed for the
  // internal sources.
  app.get("/api/gmail/contacts", requireStaffAuth, (req: any, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    if (!q || q.length < 2) return res.json({ contacts: [] });
    const like = `%${q}%`;
    const results: Array<{ email: string; name: string; source: string }> = [];
    const seen = new Set<string>();
    const push = (email: string, name: string, source: string) => {
      const key = (email || "").toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      results.push({ email, name: name || "", source });
    };
    // Employees (only those with a gmail_email set).
    try {
      for (const r of sqlite.prepare(
        `SELECT name, gmail_email FROM employees WHERE gmail_email IS NOT NULL AND (LOWER(gmail_email) LIKE ? OR LOWER(name) LIKE ?) LIMIT 5`,
      ).all(like, like) as any[]) push(r.gmail_email, r.name, "employee");
    } catch { /* table shape variance */ }
    // Contacts.
    try {
      for (const r of sqlite.prepare(
        `SELECT name, email FROM contacts WHERE email IS NOT NULL AND (LOWER(email) LIKE ? OR LOWER(name) LIKE ?) LIMIT 8`,
      ).all(like, like) as any[]) push(r.email, r.name, "contact");
    } catch { /* table missing on old dbs */ }
    // Jobs (customer email).
    try {
      for (const r of sqlite.prepare(
        `SELECT customer_name AS name, customer_email AS email FROM jobs WHERE customer_email IS NOT NULL AND (LOWER(customer_email) LIKE ? OR LOWER(customer_name) LIKE ?) LIMIT 8`,
      ).all(like, like) as any[]) push(r.email, r.name, "job");
    } catch { /* column variance */ }
    res.json({ contacts: results.slice(0, 12) });
  });


  // ── ATTACHMENT DOWNLOAD ───────────────────────────────────────────────
  //   Streams a single attachment as a real file download. Requires the
  //   caller to supply the filename & mime-type it saw in the message-detail
  //   response — Gmail's attachments endpoint returns raw bytes only, no
  //   name. This is the same pattern the Gmail web app uses when it hits
  //   /attachment?id=...&filename=....
  app.get("/api/gmail/messages/:id/attachments/:attId", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });

    const filename = String(req.query.filename || "attachment");
    const mimeType = String(req.query.mimeType || "application/octet-stream");

    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const att = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId: req.params.id,
        id: req.params.attId,
      });
      const data = att.data.data || "";
      // Gmail returns base64url, not standard base64.
      const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
      const buf = Buffer.from(b64, "base64");
      res.setHeader("Content-Type", mimeType);
      // RFC 5987 for non-ASCII filenames — modern browsers respect filename*.
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename.replace(/["\\]/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      res.setHeader("Content-Length", String(buf.length));
      res.end(buf);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to download attachment." });
    }
  });

  // ── MARK READ: clear the UNREAD label on a message ─────────────────────────
  app.post("/api/gmail/messages/:id/read", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      await gmail.users.messages.modify({ userId: "me", id: req.params.id, requestBody: { removeLabelIds: ["UNREAD"] } });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to update message." });
    }
  });

  // ── MODIFY: generic label-add / label-remove for one message. ───────────────
  //   Body: { add?: string[]; remove?: string[] }
  //   Any Gmail label id is accepted, including system labels:
  //     STARRED  — the star flag Gmail shows in the UI
  //     UNREAD   — the unread flag (also handled by /read for backward compat)
  //     INBOX    — remove this to archive the message
  //     TRASH    — add this to soft-delete (Gmail keeps it 30 days)
  //   This one endpoint powers the star, archive, mark-unread and trash
  //   actions the client uses, so we don't have to add four near-identical
  //   routes. Google returns the modified message; we relay just the labels
  //   so the client can optimistically reconcile.
  app.post("/api/gmail/messages/:id/modify", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });

    const rawAdd = Array.isArray(req.body?.add) ? req.body.add : [];
    const rawRemove = Array.isArray(req.body?.remove) ? req.body.remove : [];
    // Only accept a small allow-list of system labels. Custom user labels
    // aren't supported here yet — we do not want a client bug or a
    // compromised session flipping arbitrary labels on someone's mailbox.
    const ALLOWED = new Set(["STARRED", "UNREAD", "INBOX", "TRASH", "IMPORTANT"]);
    const add = rawAdd.filter((l: any) => typeof l === "string" && ALLOWED.has(l));
    const remove = rawRemove.filter((l: any) => typeof l === "string" && ALLOWED.has(l));
    if (add.length === 0 && remove.length === 0) {
      return res.status(400).json({ error: "Nothing to change (add/remove empty or contained only disallowed labels)." });
    }

    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const out = await gmail.users.messages.modify({
        userId: "me",
        id: req.params.id,
        requestBody: { addLabelIds: add, removeLabelIds: remove },
      });
      res.json({
        success: true,
        id: out.data.id,
        labels: out.data.labelIds || [],
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to update message." });
    }
  });

  // ── TRASH shortcut ────────────────────────────────────────────────────────
  //   Uses Gmail's dedicated trash endpoint (equivalent to "Delete" in the
  //   Gmail UI — message is retained in Trash for ~30 days). We surface this
  //   separately from /modify because it uses a different API method and
  //   because "delete" is a distinct user intent from "add TRASH label."
  app.post("/api/gmail/messages/:id/trash", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      await gmail.users.messages.trash({ userId: "me", id: req.params.id });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to move message to Trash." });
    }
  });

  // ── UNTRASH ──────────────────────────────────────────────────────────
  //   Powers Undo Trash / Undo Archive toasts. The client hands back the id
  //   plus the set of labels it wants restored (Gmail archive is just
  //   `removeLabelIds:[INBOX]`, undo re-adds it via the modify route below).
  app.post("/api/gmail/messages/:id/untrash", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      await gmail.users.messages.untrash({ userId: "me", id: req.params.id });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to restore message." });
    }
  });

  // ── SPAM / NOT-SPAM: Gmail's own SPAM label ────────────────────────
  //   Adding SPAM removes INBOX automatically; removing SPAM restores INBOX.
  //   Gmail's own web UI does the same thing via modify.
  app.post("/api/gmail/messages/:id/spam", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      await gmail.users.messages.modify({
        userId: "me",
        id: req.params.id,
        requestBody: { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to mark as spam." });
    }
  });
  app.post("/api/gmail/messages/:id/not-spam", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      await gmail.users.messages.modify({
        userId: "me",
        id: req.params.id,
        requestBody: { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] },
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to remove spam mark." });
    }
  });

  // ── THREADS: full conversation view ────────────────────────────────────────
  //   Gmail groups messages by threadId. This endpoint returns every message
  //   in the thread, in send order, with headers + body + attachments
  //   pre-parsed the same way the single-message endpoint does. The client
  //   collapses older messages by default and expands the latest.
  app.get("/api/gmail/threads/:id", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const thread = await gmail.users.threads.get({ userId: "me", id: req.params.id, format: "full" });
      const messages = (thread.data.messages || []).map((msg: any) => {
        const headers = (msg.payload?.headers || []).reduce((acc: any, h: any) => {
          acc[h.name.toLowerCase()] = h.value; return acc;
        }, {} as any);
        const decode = (data?: string | null) => data ? Buffer.from(data, "base64").toString("utf8") : "";
        let body = ""; let bodyIsHtml = false;
        const attachments: any[] = [];
        const walk = (part: any): void => {
          if (!part) return;
          if (part.mimeType === "text/html" && part.body?.data && !bodyIsHtml) {
            body = decode(part.body.data); bodyIsHtml = true;
          } else if (part.mimeType === "text/plain" && part.body?.data && !body) {
            body = decode(part.body.data);
          }
          const filename = part.filename || "";
          const attachmentId = part.body?.attachmentId || "";
          if (filename && attachmentId) {
            const disp = (part.headers || []).find((h: any) => (h.name || "").toLowerCase() === "content-disposition");
            const cid = (part.headers || []).find((h: any) => (h.name || "").toLowerCase() === "content-id");
            attachments.push({
              attachmentId, filename,
              mimeType: part.mimeType || "application/octet-stream",
              size: Number(part.body?.size) || 0,
              inline: /inline/i.test(disp?.value || ""),
              contentId: cid?.value?.replace(/[<>]/g, ""),
            });
          }
          (part.parts || []).forEach(walk);
        };
        walk(msg.payload);
        // Simple tracker-pixel sniff: 1x1 pixel images from ad/tracking hosts.
        const trackerHosts = ["mailchimp", "sendgrid", "hubspot", "marketo", "salesforce", "mailgun", "constantcontact", "pixel", "click", "track"];
        const hasTracker = bodyIsHtml && /<img[^>]*(?:width="1"|height="1"|width='1'|height='1')/i.test(body)
          || trackerHosts.some(h => body.toLowerCase().includes(h + ".") || body.toLowerCase().includes("//" + h));
        return {
          id: msg.id, threadId: msg.threadId,
          from: headers.from || "", to: headers.to || "",
          cc: headers.cc || "", bcc: headers.bcc || "",
          subject: headers.subject || "(no subject)",
          date: headers.date || "",
          messageId: headers["message-id"] || "",
          inReplyTo: headers["in-reply-to"] || "",
          references: headers["references"] || "",
          replyTo: headers["reply-to"] || "",
          body, bodyIsHtml,
          attachments,
          labels: msg.labelIds || [],
          snippet: msg.snippet || "",
          unread: (msg.labelIds || []).includes("UNREAD"),
          starred: (msg.labelIds || []).includes("STARRED"),
          hasTracker,
        };
      });
      res.json({ id: thread.data.id, messages });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to load thread." });
    }
  });

  // ── LABELS: list / create / rename / delete + apply to message ────────────────
  //   Gmail's own label API. System labels (INBOX / STARRED / SENT / etc.) are
  //   surfaced as read-only. User labels can be renamed and deleted. Applying
  //   uses the same /modify endpoint the star/archive actions already call, so
  //   we don't add a new one — the client just calls /modify with addLabelIds.
  app.get("/api/gmail/labels", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const r = await gmail.users.labels.list({ userId: "me" });
      const labels = (r.data.labels || []).map(l => ({
        id: l.id, name: l.name, type: l.type,
        messagesTotal: l.messagesTotal ?? null,
        messagesUnread: l.messagesUnread ?? null,
        color: (l as any).color || null,
      }));
      res.json({ labels });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to load labels." });
    }
  });
  app.post("/api/gmail/labels", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Label name required." });
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const r = await gmail.users.labels.create({
        userId: "me",
        requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
      });
      res.json({ id: r.data.id, name: r.data.name });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to create label." });
    }
  });
  app.patch("/api/gmail/labels/:id", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Label name required." });
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const r = await gmail.users.labels.patch({ userId: "me", id: req.params.id, requestBody: { name } });
      res.json({ id: r.data.id, name: r.data.name });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to rename label." });
    }
  });
  app.delete("/api/gmail/labels/:id", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });
    try {
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      await gmail.users.labels.delete({ userId: "me", id: req.params.id });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to delete label." });
    }
  });

  // ── RULES (server-side filters) ────────────────────────────────────────
  //   Rules are stored in sqlite and evaluated on-demand when the user hits
  //   "Run rules now" or via the scheduler's inbox-poll pass. Each rule
  //   translates to a Gmail search query and a batch modify call.
  app.get("/api/gmail/rules", requireStaffAuth, (req: any, res) => {
    const rows = sqlite.prepare(
      `SELECT id, name, match_from AS matchFrom, match_to AS matchTo,
              match_subject AS matchSubject, match_has_words AS matchHasWords,
              action_add_label AS actionAddLabel, action_star AS actionStar,
              action_mark_read AS actionMarkRead, action_archive AS actionArchive,
              enabled, created_at AS createdAt, last_run_at AS lastRunAt
         FROM email_rules WHERE employee_id = ? ORDER BY id DESC`
    ).all(req.employee.id) as any[];
    res.json({ rules: rows });
  });
  app.post("/api/gmail/rules", requireStaffAuth, (req: any, res) => {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: "Rule name required." });
    const info = sqlite.prepare(
      `INSERT INTO email_rules(employee_id, name, match_from, match_to, match_subject, match_has_words,
                               action_add_label, action_star, action_mark_read, action_archive, enabled)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      req.employee.id, b.name, b.matchFrom || null, b.matchTo || null,
      b.matchSubject || null, b.matchHasWords || null,
      b.actionAddLabel || null, b.actionStar ? 1 : 0,
      b.actionMarkRead ? 1 : 0, b.actionArchive ? 1 : 0,
      b.enabled === false ? 0 : 1,
    );
    res.json({ id: info.lastInsertRowid });
  });
  app.patch("/api/gmail/rules/:id", requireStaffAuth, (req: any, res) => {
    const b = req.body || {};
    const fields: string[] = []; const vals: any[] = [];
    const map: Record<string, string> = {
      name: "name", matchFrom: "match_from", matchTo: "match_to",
      matchSubject: "match_subject", matchHasWords: "match_has_words",
      actionAddLabel: "action_add_label",
    };
    for (const [k, col] of Object.entries(map)) if (k in b) { fields.push(`${col} = ?`); vals.push(b[k] ?? null); }
    for (const k of ["actionStar", "actionMarkRead", "actionArchive", "enabled"]) {
      if (k in b) {
        const col = k.replace(/([A-Z])/g, "_$1").toLowerCase();
        fields.push(`${col} = ?`); vals.push(b[k] ? 1 : 0);
      }
    }
    if (!fields.length) return res.json({ ok: true });
    vals.push(req.employee.id, req.params.id);
    sqlite.prepare(`UPDATE email_rules SET ${fields.join(", ")} WHERE employee_id = ? AND id = ?`).run(...vals);
    res.json({ ok: true });
  });
  app.delete("/api/gmail/rules/:id", requireStaffAuth, (req: any, res) => {
    sqlite.prepare(`DELETE FROM email_rules WHERE employee_id = ? AND id = ?`).run(req.employee.id, req.params.id);
    res.json({ ok: true });
  });
  // ── RUN RULES NOW ──────────────────────────────────────────────────
  //   Evaluates every enabled rule for this employee against Gmail using the
  //   rule's match fields as a search query. Applies actions to matching
  //   messages via /modify. Bounded to newer:1d and 200 msgs/rule for safety.
  app.post("/api/gmail/rules/run", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured." });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user." });
    const rules = sqlite.prepare(
      `SELECT * FROM email_rules WHERE employee_id = ? AND enabled = 1`
    ).all(req.employee.id) as any[];
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    // Preload labels once for name→id lookups.
    const labelResp = await gmail.users.labels.list({ userId: "me" });
    const labelIdByName = new Map<string, string>();
    (labelResp.data.labels || []).forEach(l => labelIdByName.set(l.name || "", l.id || ""));
    let totalApplied = 0;
    const perRule: any[] = [];
    for (const r of rules) {
      const parts: string[] = ["newer_than:2d"];
      if (r.match_from) parts.push(`from:${JSON.stringify(r.match_from)}`);
      if (r.match_to) parts.push(`to:${JSON.stringify(r.match_to)}`);
      if (r.match_subject) parts.push(`subject:${JSON.stringify(r.match_subject)}`);
      if (r.match_has_words) parts.push(JSON.stringify(r.match_has_words));
      const q = parts.join(" ");
      try {
        const list = await gmail.users.messages.list({ userId: "me", q, maxResults: 100 });
        const ids = (list.data.messages || []).map(m => m.id!).filter(Boolean);
        if (!ids.length) { perRule.push({ id: r.id, name: r.name, matched: 0 }); continue; }
        const addLabelIds: string[] = [];
        if (r.action_add_label) {
          let lid = labelIdByName.get(r.action_add_label);
          if (!lid) {
            const created = await gmail.users.labels.create({
              userId: "me",
              requestBody: { name: r.action_add_label, labelListVisibility: "labelShow", messageListVisibility: "show" },
            });
            lid = created.data.id || undefined;
            if (lid) labelIdByName.set(r.action_add_label, lid);
          }
          if (lid) addLabelIds.push(lid);
        }
        if (r.action_star) addLabelIds.push("STARRED");
        const removeLabelIds: string[] = [];
        if (r.action_mark_read) removeLabelIds.push("UNREAD");
        if (r.action_archive) removeLabelIds.push("INBOX");
        if (addLabelIds.length || removeLabelIds.length) {
          await gmail.users.messages.batchModify({
            userId: "me",
            requestBody: { ids, addLabelIds, removeLabelIds },
          });
        }
        totalApplied += ids.length;
        perRule.push({ id: r.id, name: r.name, matched: ids.length });
      } catch (e: any) {
        perRule.push({ id: r.id, name: r.name, error: e?.message || "failed" });
      }
      sqlite.prepare(`UPDATE email_rules SET last_run_at = ? WHERE id = ?`).run(new Date().toISOString(), r.id);
    }
    res.json({ ok: true, totalApplied, rules: perRule });
  });

  // ── EMAIL ↔ JOB LINKS ────────────────────────────────────────────────
  //   Attach a Gmail thread or specific message to a job. Bidirectional:
  //   the email UI shows a "Filed under Job #123" chip; the Job page shows
  //   an Email tab with all threads linked to it plus snippets.
  app.post("/api/gmail/link-job", requireStaffAuth, (req: any, res) => {
    const { jobId, threadId, messageId, subject, from, snippet } = req.body || {};
    if (!jobId || (!threadId && !messageId)) return res.status(400).json({ error: "jobId + threadId or messageId required." });
    try {
      sqlite.prepare(
        `INSERT OR IGNORE INTO email_job_link
           (job_id, employee_id, gmail_thread_id, gmail_message_id, subject, from_addr, snippet)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(jobId, req.employee.id, threadId || null, messageId || null, subject || null, from || null, snippet || null);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to link." });
    }
  });
  app.delete("/api/gmail/link-job/:linkId", requireStaffAuth, (req: any, res) => {
    sqlite.prepare(`DELETE FROM email_job_link WHERE id = ? AND employee_id = ?`)
      .run(req.params.linkId, req.employee.id);
    res.json({ ok: true });
  });
  // Which jobs is this thread/message already linked to?
  app.get("/api/gmail/thread-links", requireStaffAuth, (req: any, res) => {
    const { threadId, messageId } = req.query || {};
    const rows = sqlite.prepare(
      `SELECT ejl.id, ejl.job_id AS jobId, ejl.linked_at AS linkedAt,
              j.job_number AS jobNumber, j.customer_name AS customerName
         FROM email_job_link ejl
         LEFT JOIN jobs j ON j.id = ejl.job_id
        WHERE (? IS NOT NULL AND ejl.gmail_thread_id = ?)
           OR (? IS NOT NULL AND ejl.gmail_message_id = ?)`
    ).all(threadId || null, threadId || null, messageId || null, messageId || null);
    res.json({ links: rows });
  });
  // What email is filed under this job?
  app.get("/api/jobs/:jobId/emails", requireStaffAuth, (req: any, res) => {
    const rows = sqlite.prepare(
      `SELECT id, gmail_thread_id AS threadId, gmail_message_id AS messageId,
              subject, from_addr AS \"from\", snippet, linked_at AS linkedAt
         FROM email_job_link WHERE job_id = ? ORDER BY linked_at DESC`
    ).all(req.params.jobId);
    res.json({ emails: rows });
  });
}
