// ── Central Notification Service ─────────────────────────────────────────────
// Real Email (SMTP via nodemailer) + SMS (Twilio REST via fetch) for internal ops.
// Both are ENV-gated with a graceful "logged only" fallback so the app is fully
// testable without credentials (mirrors the Stripe live/simulated pattern).
//
// Email env:  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE
//   (or)      SENDGRID_API_KEY  (uses SMTP relay smtp.sendgrid.net / apikey user)
// SMS env:    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (E.164, e.g. +1706...)
//
// Recipients / preferences for internal alerts are stored in the `integrations`
// table under key 'notify_settings' (JSON) and can be edited from Settings UI.

import nodemailer from "nodemailer";
import type Database from "better-sqlite3";

export type NotifyChannel = "email" | "sms";

export interface NotifySettings {
  // internal recipients for ops alerts (low-stock, etc.)
  emailRecipients: string[];   // ["cody@titanaugusta.com", ...]
  smsRecipients: string[];     // ["+17069220154", ...]
  lowStockEmail: boolean;
  lowStockSms: boolean;
}

const DEFAULT_SETTINGS: NotifySettings = {
  emailRecipients: [],
  smsRecipients: [],
  lowStockEmail: true,
  lowStockSms: false,
};

// ── Provider availability ────────────────────────────────────────────────────
const SENDGRID_KEY = process.env.SENDGRID_API_KEY || "";
const SMTP_HOST = process.env.SMTP_HOST || (SENDGRID_KEY ? "smtp.sendgrid.net" : "");
const SMTP_PORT = Number(process.env.SMTP_PORT || (SENDGRID_KEY ? 587 : 587));
const SMTP_USER = process.env.SMTP_USER || (SENDGRID_KEY ? "apikey" : "");
const SMTP_PASS = process.env.SMTP_PASS || SENDGRID_KEY || "";
const SMTP_FROM =
  process.env.SMTP_FROM ||
  process.env.SMTP_USER ||
  "Titan Restoration <no-reply@titanaugusta.com>";
const SMTP_SECURE = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM = process.env.TWILIO_FROM || "";

export const emailLive = !!(SMTP_HOST && SMTP_PASS);
export const smsLive = !!(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM);

let _transport: nodemailer.Transporter | null = null;
function transport() {
  if (!emailLive) return null;
  if (!_transport) {
    _transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE || SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return _transport;
}

export interface SendResult {
  channel: NotifyChannel;
  to: string;
  status: "sent" | "logged" | "error";
  simulated: boolean;
  error?: string;
  id?: string;
}

// ── Email ────────────────────────────────────────────────────────────────────
export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}): Promise<SendResult[]> {
  const tos = (Array.isArray(opts.to) ? opts.to : [opts.to]).filter(Boolean);
  if (!tos.length) return [];
  const t = transport();
  if (!t) {
    // Fallback: log only (simulated) so the flow is testable without SMTP creds.
    for (const to of tos) {
      // eslint-disable-next-line no-console
      console.log(`[notify:email SIMULATED] to=${to} subject="${opts.subject}"`);
    }
    return tos.map((to) => ({ channel: "email" as const, to, status: "logged" as const, simulated: true }));
  }
  const out: SendResult[] = [];
  for (const to of tos) {
    try {
      const info = await t.sendMail({
        from: SMTP_FROM,
        to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html || (opts.text ? `<pre style="font-family:inherit">${escapeHtml(opts.text)}</pre>` : undefined),
      });
      out.push({ channel: "email", to, status: "sent", simulated: false, id: info.messageId });
    } catch (e: any) {
      out.push({ channel: "email", to, status: "error", simulated: false, error: e?.message || String(e) });
    }
  }
  return out;
}

// ── SMS (Twilio REST) ────────────────────────────────────────────────────────
export async function sendSms(opts: {
  to: string | string[];
  body: string;
}): Promise<SendResult[]> {
  const tos = (Array.isArray(opts.to) ? opts.to : [opts.to]).filter(Boolean);
  if (!tos.length) return [];
  if (!smsLive) {
    for (const to of tos) {
      // eslint-disable-next-line no-console
      console.log(`[notify:sms SIMULATED] to=${to} body="${opts.body.slice(0, 80)}"`);
    }
    return tos.map((to) => ({ channel: "sms" as const, to, status: "logged" as const, simulated: true }));
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const auth = "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
  const out: SendResult[] = [];
  for (const to of tos) {
    try {
      const params = new URLSearchParams();
      params.append("To", to);
      params.append("From", TWILIO_FROM);
      params.append("Body", opts.body);
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const data: any = await resp.json();
      if (!resp.ok || data.error_message) {
        out.push({ channel: "sms", to, status: "error", simulated: false, error: data.error_message || `HTTP ${resp.status}` });
      } else {
        out.push({ channel: "sms", to, status: "sent", simulated: false, id: data.sid });
      }
    } catch (e: any) {
      out.push({ channel: "sms", to, status: "error", simulated: false, error: e?.message || String(e) });
    }
  }
  return out;
}

// ── Settings persistence (integrations kv table) ─────────────────────────────
export function getNotifySettings(sqlite: Database.Database): NotifySettings {
  try {
    sqlite.exec("CREATE TABLE IF NOT EXISTS integrations (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
    const row: any = sqlite.prepare("SELECT value FROM integrations WHERE key='notify_settings'").get();
    if (row?.value) return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
  } catch (_) {}
  return { ...DEFAULT_SETTINGS };
}

export function saveNotifySettings(sqlite: Database.Database, patch: Partial<NotifySettings>): NotifySettings {
  const current = getNotifySettings(sqlite);
  const next: NotifySettings = { ...current, ...patch };
  sqlite.exec("CREATE TABLE IF NOT EXISTS integrations (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
  sqlite.prepare(
    "INSERT INTO integrations (key, value, updated_at) VALUES ('notify_settings', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
  ).run(JSON.stringify(next), new Date().toISOString());
  return next;
}

export function providerStatus() {
  return {
    email: { live: emailLive, provider: emailLive ? (SENDGRID_KEY ? "sendgrid-smtp" : "smtp") : "simulated" },
    sms: { live: smsLive, provider: smsLive ? "twilio" : "simulated" },
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
