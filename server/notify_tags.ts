// ─────────────────────────────────────────────────────────────────────────────
// TAG / ASSIGNMENT EMAIL NOTIFICATIONS
//
// When someone is assigned to a shift or tagged as an attendee on a calendar
// event, we send them a real email so they see it without having to log into
// Titan Pro. Best-effort: silent no-op if no email provider is configured or
// the recipient has no email on file. Never throws into a route handler.
//
// Uses `sendEmail` from ./notify which is Gmail-first with SMTP fallback,
// unlike ./notify_email (which requires the author's connected Gmail — that
// pattern is right for note @-mentions, but shifts/events are system-driven
// and don't have a human "author" to send from).
// ─────────────────────────────────────────────────────────────────────────────
import type { Database } from "better-sqlite3";
import { sendEmail, emailLive } from "./notify";

function appOrigin(): string {
  return (process.env.APP_ORIGIN || process.env.PUBLIC_ORIGIN || "https://titanaugusta.pro").replace(/\/+$/, "");
}

function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Look up email addresses for a list of names. Names not found in the
// employees table are silently dropped — this matches the "anyone can be
// tagged (homeowner, sub)" behavior of the attendee picker.
function resolveEmails(sqlite: Database, names: string[]): { name: string; email: string }[] {
  const clean = Array.from(new Set(names.map(n => String(n || "").trim()).filter(Boolean)));
  if (clean.length === 0) return [];
  const placeholders = clean.map(() => "?").join(",");
  const rows: any[] = sqlite.prepare(
    `SELECT name, gmail_email FROM employees WHERE is_active = 1 AND name IN (${placeholders})`
  ).all(...clean);
  const out: { name: string; email: string }[] = [];
  for (const r of rows) {
    if (r.gmail_email && String(r.gmail_email).includes("@")) {
      out.push({ name: r.name, email: r.gmail_email });
    }
  }
  return out;
}

interface ShiftAssignmentInput {
  techName: string;
  shiftDate: string;
  startTime?: string | null;
  endTime?: string | null;
  title?: string | null;
  notes?: string | null;
  job?: {
    id?: number;
    jobNumber?: string | null;
    address?: string | null;
    lossType?: string | null;
    customerName?: string | null;
  } | null;
}

/**
 * Send a "you've been assigned" email to a tech. Called after shift create or
 * reassignment. Silent no-op if email provider not configured or tech has no
 * gmail_email on file.
 */
export async function sendShiftAssignmentEmail(sqlite: Database, input: ShiftAssignmentInput): Promise<void> {
  try {
    if (!emailLive) return; // No SMTP/Gmail configured — bail cleanly.
    const [rec] = resolveEmails(sqlite, [input.techName]);
    if (!rec) return;
    // Respect per-user notification preferences.
    const { isNotifEnabledForName } = await import("./notify_prefs");
    if (!isNotifEnabledForName(sqlite, input.techName, "email", "shift_assigned")) return;

    const origin = appOrigin();
    const jobLabel = input.job?.jobNumber ? `Job ${input.job.jobNumber}` : "a job";
    const jobLink = input.job?.id ? `${origin}/#/jobs/${input.job.id}` : origin;
    const timeStr = input.startTime ? `${input.startTime}${input.endTime ? ` – ${input.endTime}` : ""}` : "TBD";

    const subject = input.job?.jobNumber
      ? `[Titan Pro] Assigned: ${input.job.jobNumber} on ${input.shiftDate}`
      : `[Titan Pro] Shift assigned for ${input.shiftDate}`;

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#111;max-width:560px">
        <h2 style="margin:0 0 12px">You've been assigned</h2>
        <p style="margin:0 0 16px">Hi ${esc(input.techName)}, you have a new assignment in Titan Pro.</p>
        <table style="border-collapse:collapse;font-size:14px;margin:0 0 20px">
          ${input.job?.jobNumber ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Job</td><td style="padding:4px 0"><a href="${esc(jobLink)}" style="color:#B91C1C;text-decoration:none">${esc(input.job.jobNumber)}${input.job.customerName ? " — " + esc(input.job.customerName) : ""}</a></td></tr>` : ""}
          ${input.job?.address ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Address</td><td style="padding:4px 0">${esc(input.job.address)}</td></tr>` : ""}
          ${input.job?.lossType ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Loss Type</td><td style="padding:4px 0;text-transform:capitalize">${esc(input.job.lossType)}</td></tr>` : ""}
          <tr><td style="padding:4px 12px 4px 0;color:#666">Date</td><td style="padding:4px 0">${esc(input.shiftDate)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666">Time</td><td style="padding:4px 0">${esc(timeStr)}</td></tr>
          ${input.title ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Shift</td><td style="padding:4px 0">${esc(input.title)}</td></tr>` : ""}
          ${input.notes ? `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Notes</td><td style="padding:4px 0;white-space:pre-wrap">${esc(input.notes)}</td></tr>` : ""}
        </table>
        <p style="margin:0 0 8px"><a href="${esc(jobLink)}" style="display:inline-block;background:#B91C1C;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600">Open in Titan Pro</a></p>
        <p style="margin:16px 0 0;font-size:12px;color:#888">Titan Restoration LLC · 706-922-0154</p>
      </div>`;

    const text =
`You've been assigned in Titan Pro.

${input.job?.jobNumber ? `Job:      ${input.job.jobNumber}${input.job.customerName ? " — " + input.job.customerName : ""}\n` : ""}${input.job?.address ? `Address:  ${input.job.address}\n` : ""}${input.job?.lossType ? `Loss:     ${input.job.lossType}\n` : ""}Date:     ${input.shiftDate}
Time:     ${timeStr}
${input.title ? `Shift:    ${input.title}\n` : ""}${input.notes ? `Notes:    ${input.notes}\n` : ""}
Open in Titan Pro: ${jobLink}
Titan Restoration LLC · 706-922-0154`;

    await sendEmail({ to: rec.email, subject, html, text });
  } catch (err: any) {
    console.warn("[notify_tags] shift assignment email failed:", err?.message || err);
  }
}

interface EventAttendeeInput {
  eventId: number;
  title: string;
  eventDate: string;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  attendeeNames: string[];
}

/**
 * Send "you're tagged on an event" emails. `attendeeNames` should be JUST
 * the new names (for updates: pass the diff, not the full list). Silent
 * no-op if email provider not configured.
 */
export async function sendEventTagEmails(sqlite: Database, input: EventAttendeeInput): Promise<void> {
  try {
    if (!emailLive) return;
    if (input.attendeeNames.length === 0) return;
    // Respect per-user preferences — filter attendee list first, then
    // resolve emails. This keeps the audit-neutral behavior: users who
    // opted out simply don't get a copy; other attendees still do.
    const { isNotifEnabledForName } = await import("./notify_prefs");
    const optedInNames = input.attendeeNames.filter((n) =>
      isNotifEnabledForName(sqlite, n, "email", "event_tagged"));
    if (optedInNames.length === 0) return;
    const recs = resolveEmails(sqlite, optedInNames);
    if (recs.length === 0) return;

    const origin = appOrigin();
    const scheduleLink = `${origin}/#/scheduling`;
    const timeStr = input.startTime ? `${input.startTime}${input.endTime ? ` – ${input.endTime}` : ""}` : "All day";
    const subject = `[Titan Pro] Event: ${input.title} on ${input.eventDate}`;

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#111;max-width:560px">
        <h2 style="margin:0 0 12px">You've been tagged on an event</h2>
        <p style="margin:0 0 16px">${input.createdBy ? esc(input.createdBy) + " tagged you on a calendar event in Titan Pro." : "You've been tagged on a calendar event in Titan Pro."}</p>
        <table style="border-collapse:collapse;font-size:14px;margin:0 0 20px">
          <tr><td style="padding:4px 12px 4px 0;color:#666">Event</td><td style="padding:4px 0;font-weight:600">${esc(input.title)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666">Date</td><td style="padding:4px 0">${esc(input.eventDate)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#666">Time</td><td style="padding:4px 0">${esc(timeStr)}</td></tr>
          ${input.location ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Location</td><td style="padding:4px 0">${esc(input.location)}</td></tr>` : ""}
          ${input.notes ? `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Notes</td><td style="padding:4px 0;white-space:pre-wrap">${esc(input.notes)}</td></tr>` : ""}
        </table>
        <p style="margin:0 0 8px"><a href="${esc(scheduleLink)}" style="display:inline-block;background:#B91C1C;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600">Open Schedule</a></p>
        <p style="margin:16px 0 0;font-size:12px;color:#888">Titan Restoration LLC · 706-922-0154</p>
      </div>`;

    const text =
`You've been tagged on a Titan Pro event.

Event:    ${input.title}
Date:     ${input.eventDate}
Time:     ${timeStr}
${input.location ? `Location: ${input.location}\n` : ""}${input.notes ? `Notes:    ${input.notes}\n` : ""}
Open Schedule: ${scheduleLink}
Titan Restoration LLC · 706-922-0154`;

    // One email per recipient so each shows their own address in "To".
    for (const r of recs) {
      await sendEmail({ to: r.email, subject, html, text });
    }
  } catch (err: any) {
    console.warn("[notify_tags] event tag email failed:", err?.message || err);
  }
}

/**
 * Diff two attendee lists and return names in `next` that weren't in `prev`.
 * Used by the event PATCH route so we only email newly added attendees.
 */
export function newlyAddedAttendees(prev: string[], next: string[]): string[] {
  const prevSet = new Set(prev.map(s => s.trim().toLowerCase()).filter(Boolean));
  return next.map(s => s.trim()).filter(s => s && !prevSet.has(s.toLowerCase()));
}
