// ════════════════════════════════════════════════════════════════════════════
// EMAIL SCHEDULER — dedicated fast ticker for Gmail scheduled-send & snooze
// ----------------------------------------------------------------------------
// Runs on its own 30s interval, independent of scheduler.ts (which is hourly).
//
// Two responsibilities:
//   1) Scheduled send  — email_scheduled rows where status='pending' and
//                        scheduled_for <= now get sent through
//                        sendGmailAsEmployee, then marked sent/failed.
//   2) Snooze wake     — email_snooze rows where status='pending' and
//                        wake_at <= now get their Gmail message moved back
//                        into INBOX and are marked woken.
//
// Dormant when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are absent.
// ════════════════════════════════════════════════════════════════════════════
import type { Database } from "better-sqlite3";
import { google } from "googleapis";
import { gmailConfigured, sendGmailAsEmployee } from "./routes_gmail";
import { decryptField, encryptField } from "./encryption";

let started = false;

async function refreshOauthForEmployee(sqlite: Database, employeeId: number) {
  const row: any = sqlite
    .prepare("SELECT gmail_refresh_token, gmail_access_token, gmail_token_expiry FROM employees WHERE id = ?")
    .get(employeeId);
  if (!row?.gmail_refresh_token) return null;
  const refreshToken = decryptField(row.gmail_refresh_token);
  if (!refreshToken) return null;
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) return null;
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
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
          employeeId,
        );
    } catch {
      return null;
    }
  }
  return oauth2;
}

async function processScheduledSends(sqlite: Database) {
  const nowIso = new Date().toISOString();
  const due: any[] = sqlite
    .prepare(
      `SELECT * FROM email_scheduled WHERE status = 'pending' AND scheduled_for <= ? ORDER BY scheduled_for ASC LIMIT 10`,
    )
    .all(nowIso);
  for (const row of due) {
    let payload: any = {};
    try { payload = JSON.parse(row.payload_json); } catch { payload = {}; }
    try {
      const result = await sendGmailAsEmployee(sqlite, row.employee_id, payload);
      if (result.ok) {
        sqlite
          .prepare("UPDATE email_scheduled SET status = 'sent', sent_message_id = ?, processed_at = ? WHERE id = ?")
          .run(result.id || null, new Date().toISOString(), row.id);
      } else {
        sqlite
          .prepare("UPDATE email_scheduled SET status = 'failed', error = ?, processed_at = ? WHERE id = ?")
          .run(result.reason || "unknown", new Date().toISOString(), row.id);
      }
    } catch (e: any) {
      sqlite
        .prepare("UPDATE email_scheduled SET status = 'failed', error = ?, processed_at = ? WHERE id = ?")
        .run(String(e?.message || e), new Date().toISOString(), row.id);
    }
  }
}

async function ensureSnoozedLabelForOauth(oauth2: any): Promise<string | null> {
  try {
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const list = await gmail.users.labels.list({ userId: "me" });
    const found = (list.data.labels || []).find((l: any) => l.name === "Titan/Snoozed");
    if (found) return found.id || null;
    const created = await gmail.users.labels.create({
      userId: "me",
      requestBody: { name: "Titan/Snoozed", labelListVisibility: "labelHide", messageListVisibility: "hide" },
    });
    return created.data.id || null;
  } catch {
    return null;
  }
}

async function processSnoozeWakes(sqlite: Database) {
  const nowIso = new Date().toISOString();
  const due: any[] = sqlite
    .prepare(
      `SELECT * FROM email_snooze WHERE status = 'pending' AND wake_at <= ? ORDER BY wake_at ASC LIMIT 10`,
    )
    .all(nowIso);
  for (const row of due) {
    try {
      const oauth2 = await refreshOauthForEmployee(sqlite, row.employee_id);
      if (!oauth2) {
        sqlite.prepare("UPDATE email_snooze SET status = 'failed', woke_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
        continue;
      }
      const gmail = google.gmail({ version: "v1", auth: oauth2 });
      const labelId = await ensureSnoozedLabelForOauth(oauth2);
      const modify: any = { addLabelIds: ["INBOX"] };
      if (labelId) modify.removeLabelIds = [labelId];
      await gmail.users.messages.modify({ userId: "me", id: row.gmail_message_id, requestBody: modify });
      sqlite.prepare("UPDATE email_snooze SET status = 'woken', woke_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
    } catch {
      sqlite.prepare("UPDATE email_snooze SET status = 'failed', woke_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
    }
  }
}

async function tick(sqlite: Database) {
  if (!gmailConfigured()) return;
  try { await processScheduledSends(sqlite); } catch (e) { console.error("[email-scheduler] scheduled sends failed", e); }
  try { await processSnoozeWakes(sqlite); } catch (e) { console.error("[email-scheduler] snooze wakes failed", e); }
}

export function startEmailScheduler(sqlite: Database) {
  if (started) return;
  if (process.env.SCHEDULER_DISABLED === "1") return;
  started = true;
  const seconds = Math.max(15, parseInt(process.env.EMAIL_SCHEDULER_INTERVAL_SEC || "30", 10));
  console.log(`[email-scheduler] starting; interval=${seconds}s`);
  setTimeout(() => { tick(sqlite).catch(err => console.error("[email-scheduler] initial tick failed", err)); }, 15_000);
  setInterval(() => { tick(sqlite).catch(err => console.error("[email-scheduler] tick failed", err)); }, seconds * 1000);
}

export async function runEmailSchedulerNow(sqlite: Database) {
  await tick(sqlite);
}
