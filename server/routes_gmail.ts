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
export async function sendGmailAsEmployee(
  sqlite: Database,
  senderEmployeeId: number,
  args: {
    to: string | string[];
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
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
  const boundary = "----titanpro_" + crypto.randomBytes(8).toString("hex");

  // Multipart alternative so the recipient's client renders HTML but plain-text
  // clients still get a readable fallback.
  const textPart = args.text || (args.html ? args.html.replace(/<[^>]+>/g, "") : "");
  const htmlPart = args.html || `<pre style="font-family:inherit">${textPart}</pre>`;

  const headers = [
    `To: ${toList}`,
    from ? `From: ${from}` : "",
    args.replyTo ? `Reply-To: ${args.replyTo}` : "",
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);

  const body = [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    textPart,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    htmlPart,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const raw = Buffer.from(body)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  try {
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const sent = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
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

      const list = await gmail.users.messages.list({ userId: "me", labelIds, maxResults, q });
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
        return {
          id: msg.data.id,
          threadId: msg.data.threadId,
          snippet: msg.data.snippet,
          from: headers.from || "",
          to: headers.to || "",
          subject: headers.subject || "(no subject)",
          date: headers.date || "",
          unread: (msg.data.labelIds || []).includes("UNREAD"),
        };
      }));
      res.json({ messages });
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
      // Extract a text/plain or text/html body from the payload tree.
      const decode = (data?: string | null) => data ? Buffer.from(data, "base64").toString("utf8") : "";
      let body = "";
      const walk = (part: any): void => {
        if (!part) return;
        if (part.mimeType === "text/plain" && part.body?.data && !body) body = decode(part.body.data);
        else if (part.mimeType === "text/html" && part.body?.data && !body) body = decode(part.body.data);
        (part.parts || []).forEach(walk);
      };
      walk(msg.data.payload);
      res.json({
        id: msg.data.id, threadId: msg.data.threadId,
        from: headers.from || "", to: headers.to || "",
        subject: headers.subject || "(no subject)", date: headers.date || "",
        body,
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to load message." });
    }
  });

  // ── SEND: send a real email as the current employee ────────────────────────
  // body: { to, subject, body, cc?, bcc? }
  app.post("/api/gmail/send", requireStaffAuth, async (req: any, res) => {
    if (!gmailConfigured()) return res.status(400).json({ error: "Gmail not configured.", configured: false });
    const oauth2 = await getAuthedClientForEmployee(req, req.employee.id);
    if (!oauth2) return res.status(409).json({ error: "Gmail not connected for this user.", connected: false });

    const { to, subject, body, cc, bcc } = req.body || {};
    if (!to || !String(to).trim()) return res.status(400).json({ error: "Recipient (to) is required." });

    try {
      const from = (sqlite.prepare("SELECT gmail_email FROM employees WHERE id = ?").get(req.employee.id) as any)?.gmail_email || "";
      // Build a raw RFC-2822 message.
      const lines = [
        `To: ${to}`,
        cc ? `Cc: ${cc}` : "",
        bcc ? `Bcc: ${bcc}` : "",
        from ? `From: ${from}` : "",
        `Subject: ${subject || "(no subject)"}`,
        "Content-Type: text/plain; charset=UTF-8",
        "MIME-Version: 1.0",
        "",
        body || "",
      ].filter(Boolean);
      const raw = Buffer.from(lines.join("\r\n"))
        .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const sent = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
      res.json({ success: true, id: sent.data.id, threadId: sent.data.threadId });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "Failed to send email." });
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
}
