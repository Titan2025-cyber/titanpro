// ─────────────────────────────────────────────────────────────────────────────
// EMAIL NOTIFICATION FAN-OUT
//
// Sends real emails via Gmail (server-side) when an employee is @-mentioned in
// a job note (or any other tag-worthy event). Emails go out FROM the author's
// connected Gmail account so the recipient sees a real Titan person in their
// inbox, not a no-reply.
//
// Every call is best-effort — if Gmail isn't configured, the author isn't
// connected, or the recipient has no email on file, we log and move on. This
// module must NEVER throw into a route handler.
// ─────────────────────────────────────────────────────────────────────────────
import type { Database } from "better-sqlite3";
import { sendGmailAsEmployee } from "./routes_gmail";

function appOrigin(): string {
  return (process.env.APP_ORIGIN || process.env.PUBLIC_ORIGIN || "https://titanaugusta.pro").replace(/\/+$/, "");
}

// Very small HTML escape — the note body and job fields can contain arbitrary
// user text, so we must not paste it raw into the HTML template.
function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

interface MentionEmailInput {
  // The person who wrote the note (the "from" identity for the email).
  authorEmployeeId: number;
  authorName: string;
  // Employees who were tagged in the note.
  recipientEmployeeIds: number[];
  // Job the note lives on.
  jobId: number;
  jobNumber?: string | null;
  jobAddress?: string | null;
  customerName?: string | null;
  // The note body itself.
  noteBody: string;
  noteIsPublic?: boolean;
  noteTag?: string | null;
}

/**
 * Fire off "you were mentioned" emails to every recipient who has an address
 * on file. Sender is the author's Gmail if they've connected it, otherwise
 * we skip (bell notification already fired separately).
 *
 * This function is fire-and-forget from the caller's point of view — it
 * returns a promise but the note-write route does NOT await it. Failures are
 * logged and never bubble up.
 */
export async function sendMentionEmails(
  sqlite: Database,
  input: MentionEmailInput,
): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const result = { sent: 0, skipped: 0, errors: [] as string[] };

  try {
    if (input.recipientEmployeeIds.length === 0) return result;

    // Look up each recipient's email address. We prefer `gmail_email` because
    // it's the address they explicitly linked; some employees may not have one
    // (in which case we skip — they still got the bell notification).
    const placeholders = input.recipientEmployeeIds.map(() => "?").join(",");
    const rows: any[] = sqlite
      .prepare(
        `SELECT id, name, gmail_email
           FROM employees
          WHERE id IN (${placeholders}) AND is_active = 1`,
      )
      .all(...input.recipientEmployeeIds);

    // Respect per-user notification preferences before we even look at
    // email addresses — an opted-out user should never appear as a
    // recipient regardless of whether they have a linked Gmail address.
    const { isNotifEnabled } = await import("./notify_prefs");
    const recipients = rows
      .filter(r => r.gmail_email && String(r.gmail_email).includes("@"))
      .filter(r => isNotifEnabled(sqlite, r.id, "email", "mentioned"))
      .map(r => ({ id: r.id, name: r.name as string, email: r.gmail_email as string }));

    result.skipped = input.recipientEmployeeIds.length - recipients.length;
    if (recipients.length === 0) return result;

    // Build the email once — subject/body are the same for every recipient.
    const origin = appOrigin();
    const jobLabel = input.jobNumber ? `Job ${input.jobNumber}` : `Job #${input.jobId}`;
    const jobLink = `${origin}/#/jobs/${input.jobId}`;
    // Use ASCII hyphen (not em dash) as the separator. The Gmail send path
    // now RFC-2047-encodes non-ASCII subject headers, but keeping the subject
    // plain ASCII makes it render identically in every mail client search,
    // preview snippet, and mobile notification without depending on the
    // recipient's client decoding the encoded-word correctly.
    const subject = `${input.authorName} tagged you on ${jobLabel}${input.customerName ? " - " + input.customerName : ""}`;
    const html = renderMentionEmail({
      authorName: input.authorName,
      jobLabel,
      jobLink,
      jobAddress: input.jobAddress || null,
      customerName: input.customerName || null,
      noteBody: input.noteBody,
      noteTag: input.noteTag || null,
      noteIsPublic: input.noteIsPublic !== false,
    });
    const text = renderMentionEmailText({
      authorName: input.authorName,
      jobLabel,
      jobLink,
      jobAddress: input.jobAddress || null,
      customerName: input.customerName || null,
      noteBody: input.noteBody,
    });

    // Send one email per recipient so each person sees themselves in the "To"
    // line (rather than a BCC blob), and so a single failure doesn't nuke
    // deliveries to the rest of the team.
    for (const r of recipients) {
      const sendResult = await sendGmailAsEmployee(sqlite, input.authorEmployeeId, {
        to: r.email,
        subject,
        html,
        text,
      });
      if (sendResult.ok) {
        result.sent += 1;
      } else {
        result.errors.push(`${r.name}: ${sendResult.reason}`);
        // If the AUTHOR hasn't connected Gmail, no point retrying for the rest.
        if (sendResult.reason === "sender_not_connected" || sendResult.reason === "not_configured") break;
      }
    }
  } catch (e: any) {
    result.errors.push("unexpected: " + (e?.message || String(e)));
  }

  if (result.sent > 0 || result.errors.length > 0) {
    console.log(
      `[notify_email] mentions: sent=${result.sent} skipped=${result.skipped} errors=${result.errors.length}`,
      result.errors.length > 0 ? result.errors : "",
    );
  }
  return result;
}

// ── HTML template ───────────────────────────────────────────────────────────
// Kept intentionally simple: inline styles only (email clients strip <style>),
// max-width 600px, one accent color (Titan blue), one CTA button. No images
// so the message renders instantly and won't be blocked by image-loading
// defaults in Outlook/Gmail.
interface MentionTplArgs {
  authorName: string;
  jobLabel: string;
  jobLink: string;
  jobAddress: string | null;
  customerName: string | null;
  noteBody: string;
  noteTag: string | null;
  noteIsPublic: boolean;
}

function renderMentionEmail(a: MentionTplArgs): string {
  // Preserve line breaks in the note body but keep everything HTML-safe.
  const bodyHtml = esc(a.noteBody).replaceAll("\n", "<br>");
  const tagChip = a.noteTag
    ? `<span style="display:inline-block;padding:2px 8px;background:#F58220;color:#fff;border-radius:10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;margin-left:8px">${esc(a.noteTag)}</span>`
    : "";
  const privateChip = !a.noteIsPublic
    ? `<span style="display:inline-block;padding:2px 8px;background:#6B7280;color:#fff;border-radius:10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;margin-left:8px">Internal</span>`
    : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1A1A1A">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3F4F6;padding:24px 12px">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
            <!-- Header strip -->
            <tr>
              <td style="background:#0B4F8B;padding:16px 24px">
                <div style="color:#ffffff;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase">Titan Pro</div>
                <div style="color:#ffffff;font-size:11px;opacity:0.75;margin-top:2px">You were tagged in a job note</div>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:24px">
                <p style="margin:0 0 12px;font-size:16px;line-height:1.4">
                  <strong>${esc(a.authorName)}</strong> tagged you in a note on
                  <strong>${esc(a.jobLabel)}</strong>${tagChip}${privateChip}
                </p>

                ${a.customerName || a.jobAddress ? `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0 20px;border-collapse:collapse">
                  ${a.customerName ? `<tr>
                    <td style="padding:6px 0;font-size:13px;color:#6B7280;width:110px">Customer</td>
                    <td style="padding:6px 0;font-size:13px;color:#1A1A1A;font-weight:500">${esc(a.customerName)}</td>
                  </tr>` : ""}
                  ${a.jobAddress ? `<tr>
                    <td style="padding:6px 0;font-size:13px;color:#6B7280;width:110px">Address</td>
                    <td style="padding:6px 0;font-size:13px;color:#1A1A1A;font-weight:500">${esc(a.jobAddress)}</td>
                  </tr>` : ""}
                </table>` : ""}

                <div style="background:#F9FAFB;border-left:3px solid #F58220;padding:14px 16px;margin:16px 0;border-radius:0 4px 4px 0">
                  <div style="font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">The note</div>
                  <div style="font-size:14px;line-height:1.55;color:#1A1A1A;white-space:pre-wrap">${bodyHtml}</div>
                </div>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px">
                  <tr>
                    <td style="background:#0B4F8B;border-radius:6px">
                      <a href="${esc(a.jobLink)}"
                         style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:0.2px">
                        Open ${esc(a.jobLabel)} in Titan Pro
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:20px 0 0;font-size:12px;color:#6B7280;line-height:1.5">
                  You received this because <strong>${esc(a.authorName)}</strong> typed <code style="background:#F3F4F6;padding:1px 4px;border-radius:3px">@your name</code> in a Titan Pro job note.
                  Reply directly to this email to respond to ${esc(a.authorName)} in Gmail — replies do not flow back into Titan Pro.
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:16px 24px;background:#F9FAFB;border-top:1px solid #E5E7EB;text-align:center">
                <div style="font-size:11px;color:#6B7280">Titan Restoration LLC · Sent from Titan Pro</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderMentionEmailText(a: {
  authorName: string;
  jobLabel: string;
  jobLink: string;
  jobAddress: string | null;
  customerName: string | null;
  noteBody: string;
}): string {
  const parts = [
    `${a.authorName} tagged you in a note on ${a.jobLabel}.`,
    "",
  ];
  if (a.customerName) parts.push(`Customer: ${a.customerName}`);
  if (a.jobAddress) parts.push(`Address: ${a.jobAddress}`);
  if (a.customerName || a.jobAddress) parts.push("");
  parts.push("The note:");
  parts.push(a.noteBody);
  parts.push("");
  parts.push(`Open in Titan Pro: ${a.jobLink}`);
  parts.push("");
  parts.push(`— Titan Pro · sent because ${a.authorName} typed @your name`);
  return parts.join("\n");
}
