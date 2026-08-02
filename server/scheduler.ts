// In-process scheduler for Titan Pro. Runs every hour by default (env
// SCHEDULER_INTERVAL_MIN overrides). Each job is best-effort: exceptions are
// caught and logged so a broken checker never crashes the boot.
//
// Jobs (all create rows in escalation_drafts with dedupe_keys so re-runs on
// the same day never duplicate):
//   - adjuster_silence:  jobs with open claims + no adjuster_contacts within
//                        threshold days emit an escalation draft.
//   - ar_stalled:        overdue invoices with no invoice_touches in 7d emit
//                        a follow-up draft.
//   - ar_weekly_digest:  every Monday, produce a single "AR stalled digest"
//                        for the owner.
//   - coi_expiring:      COI or W9 within 30 days of expiration \u2192 nag draft
//                        addressed to the sub, and dispatch_blocked = 1 on
//                        expired docs.
//   - cert_expiring:     employee certs within 60 days of expiry \u2192 tech
//                        notification + owner draft.

import type Database from "better-sqlite3";

type Sqlite = Database.Database;

interface SchedulerContext {
  sqlite: Sqlite;
  now: () => Date;
}

const HOURS = 60 * 60 * 1000;

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / (24 * HOURS));
}

function safeParseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function upsertRun(sqlite: Sqlite, name: string, status: string, summary: string) {
  try {
    sqlite.prepare(
      `INSERT INTO scheduler_runs (job_name, last_run_at, last_status, last_summary)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(job_name) DO UPDATE SET last_run_at=excluded.last_run_at, last_status=excluded.last_status, last_summary=excluded.last_summary`
    ).run(name, new Date().toISOString(), status, summary);
  } catch {}
}

function insertDraft(sqlite: Sqlite, row: {
  type: string;
  subject: string;
  body: string;
  recipient_name?: string | null;
  recipient_email?: string | null;
  recipient_phone?: string | null;
  related_job_id?: number | null;
  related_invoice_id?: number | null;
  related_contact_id?: number | null;
  related_employee_id?: number | null;
  related_coi_id?: number | null;
  related_cert_id?: number | null;
  dedupe_key: string;
}): boolean {
  try {
    sqlite.prepare(
      `INSERT INTO escalation_drafts (type, subject, body, recipient_name, recipient_email, recipient_phone,
         related_job_id, related_invoice_id, related_contact_id, related_employee_id, related_coi_id, related_cert_id,
         status, dedupe_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
    ).run(
      row.type, row.subject, row.body,
      row.recipient_name ?? null, row.recipient_email ?? null, row.recipient_phone ?? null,
      row.related_job_id ?? null, row.related_invoice_id ?? null, row.related_contact_id ?? null,
      row.related_employee_id ?? null, row.related_coi_id ?? null, row.related_cert_id ?? null,
      row.dedupe_key, new Date().toISOString()
    );
    return true;
  } catch {
    // UNIQUE constraint on dedupe_key means we already sent this today. Skip.
    return false;
  }
}

// #1: Adjuster silence timer. Threshold: 5 days = FYI, 10 days = escalate,
// 20 days = supervisor. We produce one draft at each threshold cross per day.
function runAdjusterSilence(ctx: SchedulerContext): string {
  const { sqlite, now } = ctx;
  const day = today(now());
  const openJobs: any[] = sqlite.prepare(
    `SELECT j.id, j.job_number, j.contact_id, j.address, j.adjuster_name, j.adjuster_email, j.adjuster_phone,
            j.claim_number, j.sales_date, j.created_at, j.status
     FROM jobs j
     WHERE j.status IN ('new','mitigation','drying','reconstruction')
       AND (j.adjuster_name IS NOT NULL OR j.claim_number IS NOT NULL)`
  ).all() as any[];

  let drafts = 0;
  for (const j of openJobs) {
    const lastRow: any = sqlite.prepare(
      `SELECT MAX(contacted_at) AS last FROM adjuster_contacts WHERE job_id = ?`
    ).get(j.id);
    // If we've never logged a contact, use job creation as the baseline.
    const lastContact = safeParseDate(lastRow?.last) ?? safeParseDate(j.created_at);
    if (!lastContact) continue;
    const days = daysBetween(now(), lastContact);

    let threshold = 0;
    let severity = "";
    if (days >= 20)      { threshold = 20; severity = "supervisor"; }
    else if (days >= 10) { threshold = 10; severity = "escalate"; }
    else if (days >= 5)  { threshold = 5;  severity = "fyi"; }
    else continue;

    const subject = severity === "supervisor"
      ? `[${threshold}-day silence] Escalation to carrier supervisor \u2014 ${j.job_number}`
      : severity === "escalate"
      ? `[${threshold}-day silence] Escalation to adjuster \u2014 ${j.job_number}`
      : `[${threshold}-day silence] Follow-up needed \u2014 ${j.job_number}`;

    const claimLine = j.claim_number ? `Claim #${j.claim_number}. ` : "";
    const lossLine = j.sales_date ? `Loss reported: ${j.sales_date}. ` : "";
    const bodyIntro = severity === "supervisor"
      ? `Adjuster ${j.adjuster_name || "on file"} has been silent for ${days} days on ${j.job_number} at ${j.address}. Escalating to supervisor.`
      : severity === "escalate"
      ? `Following up on ${j.job_number} at ${j.address}. It has been ${days} days since our last contact.`
      : `Quick check-in on ${j.job_number} at ${j.address} \u2014 ${days} days since our last conversation.`;

    const body = [
      `Hi ${j.adjuster_name || "there"},`,
      "",
      bodyIntro,
      "",
      `${claimLine}${lossLine}Please let us know the current status of this claim so we can keep the file moving.`,
      "",
      "Thank you,",
      "Titan Restoration LLC"
    ].join("\n");

    const inserted = insertDraft(sqlite, {
      type: "adjuster_silence",
      subject,
      body,
      recipient_name: j.adjuster_name,
      recipient_email: j.adjuster_email,
      recipient_phone: j.adjuster_phone,
      related_job_id: j.id,
      dedupe_key: `adjuster_silence:job=${j.id}:threshold=${threshold}:day=${day}`,
    });
    if (inserted) drafts++;
  }
  return `checked=${openJobs.length}, drafts=${drafts}`;
}

// #2: AR stalled follow-up. Overdue invoices with no touch in 7+ days.
function runArStalled(ctx: SchedulerContext): string {
  const { sqlite, now } = ctx;
  const day = today(now());
  const overdue: any[] = sqlite.prepare(
    `SELECT i.id, i.invoice_number, i.total, i.due_date, i.status, i.contact_id, i.job_id,
            i.last_touched_at, i.followup_status, i.promise_to_pay_date,
            c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM invoices i
     LEFT JOIN contacts c ON c.id = i.contact_id
     WHERE (i.status = 'overdue' OR i.status = 'sent')
       AND i.due_date IS NOT NULL AND i.due_date < ?
       AND i.paid_at IS NULL`
  ).all(day) as any[];

  let drafts = 0;
  for (const inv of overdue) {
    // Skip if there's an active promise-to-pay in the future.
    if (inv.promise_to_pay_date && inv.promise_to_pay_date >= day) continue;
    const lastTouch = safeParseDate(inv.last_touched_at);
    // No touch in the last 7 days (or never touched)
    const daysSinceTouch = lastTouch ? daysBetween(now(), lastTouch) : Infinity;
    if (daysSinceTouch < 7) continue;

    const dueDate = safeParseDate(inv.due_date);
    const daysOverdue = dueDate ? daysBetween(now(), dueDate) : 0;
    if (daysOverdue < 7) continue; // avoid drafts on invoices barely past due

    const amt = Number(inv.total || 0).toFixed(2);
    const subject = `Payment follow-up \u2014 Invoice ${inv.invoice_number} ($${amt}, ${daysOverdue}d overdue)`;
    const body = [
      `Hi ${inv.customer_name || "there"},`,
      "",
      `We haven't received payment on invoice ${inv.invoice_number} for $${amt}, which is now ${daysOverdue} days past due.`,
      "",
      "Could you let us know when we can expect payment, or if there's anything we need to correct on our end?",
      "",
      "Thank you,",
      "Titan Restoration LLC"
    ].join("\n");

    const inserted = insertDraft(sqlite, {
      type: "ar_stalled",
      subject,
      body,
      recipient_name: inv.customer_name,
      recipient_email: inv.customer_email,
      recipient_phone: inv.customer_phone,
      related_invoice_id: inv.id,
      related_job_id: inv.job_id,
      related_contact_id: inv.contact_id,
      dedupe_key: `ar_stalled:inv=${inv.id}:day=${day}`,
    });
    if (inserted) {
      drafts++;
      // Bump the invoice's followup_status so the AR list surfaces it as stalled.
      try {
        sqlite.prepare(`UPDATE invoices SET followup_status = 'stalled' WHERE id = ? AND (followup_status IS NULL OR followup_status != 'promised')`).run(inv.id);
      } catch {}
    }
  }
  return `overdue=${overdue.length}, drafts=${drafts}`;
}

// #2: weekly stalled digest \u2014 every Monday only.
function runArWeeklyDigest(ctx: SchedulerContext): string {
  const { sqlite, now } = ctx;
  const dow = now().getUTCDay(); // 0=Sun,1=Mon
  if (dow !== 1) return "skipped (not Monday)";
  const day = today(now());
  const rows: any[] = sqlite.prepare(
    `SELECT i.id, i.invoice_number, i.total, i.due_date,
            c.name AS customer_name
     FROM invoices i
     LEFT JOIN contacts c ON c.id = i.contact_id
     WHERE (i.status = 'overdue' OR i.status = 'sent')
       AND i.due_date IS NOT NULL AND i.due_date < ?
       AND i.paid_at IS NULL
     ORDER BY i.due_date ASC`
  ).all(day) as any[];
  if (rows.length === 0) return "no stalled invoices";

  const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
  const lines = rows.slice(0, 25).map(r => {
    const dueDate = safeParseDate(r.due_date);
    const daysOverdue = dueDate ? daysBetween(now(), dueDate) : 0;
    return `  \u2022 ${r.invoice_number} \u2014 ${r.customer_name || "?"} \u2014 $${Number(r.total||0).toFixed(2)} \u2014 ${daysOverdue}d overdue`;
  }).join("\n");
  const body = [
    `Weekly AR digest \u2014 ${rows.length} invoices past due, totaling $${total.toFixed(2)}.`,
    "",
    lines,
    rows.length > 25 ? `  ... and ${rows.length - 25} more.` : "",
    "",
    "Review in Titan Pro \u2192 A/R Aging to log payments or dispositions.",
  ].filter(Boolean).join("\n");

  insertDraft(sqlite, {
    type: "weekly_ar_digest",
    subject: `Weekly AR digest \u2014 ${rows.length} invoices, $${total.toFixed(2)} outstanding`,
    body,
    dedupe_key: `weekly_ar_digest:day=${day}`,
  });
  return `digest_created=1, stalled=${rows.length}, total=$${total.toFixed(2)}`;
}

// #16: COI/W9 expiration nags. 30 and 7 days before expiration \u2192 draft.
// Expired \u2192 dispatch_blocked=1 on the sub.
function runCoiExpiring(ctx: SchedulerContext): string {
  const { sqlite, now } = ctx;
  const day = today(now());
  const rows: any[] = sqlite.prepare(
    `SELECT r.id, r.contact_id, r.document_type, r.expires_at, r.alert_sent_30, r.alert_sent_7,
            c.name AS contact_name, c.email AS contact_email, c.phone AS contact_phone, c.dispatch_blocked
     FROM coi_records r
     LEFT JOIN contacts c ON c.id = r.contact_id
     WHERE r.expires_at IS NOT NULL`
  ).all() as any[];

  let drafts = 0;
  let blocked = 0;
  for (const r of rows) {
    const exp = safeParseDate(r.expires_at);
    if (!exp) continue;
    const daysLeft = daysBetween(exp, now());

    // Auto-block expired
    if (daysLeft < 0) {
      if (!r.dispatch_blocked) {
        try {
          sqlite.prepare(`UPDATE contacts SET dispatch_blocked = 1, dispatch_block_reason = ? WHERE id = ?`)
            .run(`Expired ${r.document_type}`, r.contact_id);
          blocked++;
        } catch {}
      }
      continue;
    }

    const threshold = daysLeft <= 7 ? 7 : (daysLeft <= 30 ? 30 : 0);
    if (!threshold) continue;
    if (threshold === 30 && r.alert_sent_30) continue;
    if (threshold === 7 && r.alert_sent_7) continue;

    const docLabel = String(r.document_type || "document").toUpperCase();
    const subject = `${docLabel} expires in ${daysLeft} days \u2014 ${r.contact_name || "sub"}`;
    const body = [
      `Hi ${r.contact_name || "there"},`,
      "",
      `Your current ${docLabel} on file expires ${r.expires_at} (${daysLeft} days from today).`,
      "",
      threshold === 7
        ? "Please send an updated copy this week so we can keep you cleared for dispatch."
        : "Please send an updated copy at your earliest convenience so we keep you cleared for dispatch.",
      "",
      "Thank you,",
      "Titan Restoration LLC"
    ].join("\n");
    const inserted = insertDraft(sqlite, {
      type: "coi_expiring",
      subject,
      body,
      recipient_name: r.contact_name,
      recipient_email: r.contact_email,
      recipient_phone: r.contact_phone,
      related_contact_id: r.contact_id,
      related_coi_id: r.id,
      dedupe_key: `coi_expiring:doc=${r.id}:threshold=${threshold}`,
    });
    if (inserted) {
      drafts++;
      try {
        if (threshold === 30) sqlite.prepare(`UPDATE coi_records SET alert_sent_30 = 1 WHERE id = ?`).run(r.id);
        if (threshold === 7)  sqlite.prepare(`UPDATE coi_records SET alert_sent_7  = 1 WHERE id = ?`).run(r.id);
      } catch {}
    }
  }
  return `checked=${rows.length}, drafts=${drafts}, auto_blocked=${blocked}`;
}

// #18: cert expiration reminders. 60 and 30 days.
function runCertExpiring(ctx: SchedulerContext): string {
  const { sqlite, now } = ctx;
  const rows: any[] = sqlite.prepare(
    `SELECT id, employee_name, cert_type, expiration_date, alert_sent_60, alert_sent_30
     FROM certifications
     WHERE expiration_date IS NOT NULL`
  ).all() as any[];

  let drafts = 0;
  const notify = sqlite.prepare(
    `INSERT INTO tech_notifications (tech_name, type, title, body, created_at) VALUES (?, 'cert_expiring', ?, ?, ?)`
  );
  for (const r of rows) {
    const exp = safeParseDate(r.expiration_date);
    if (!exp) continue;
    const daysLeft = daysBetween(exp, now());
    if (daysLeft < 0) continue;
    const threshold = daysLeft <= 30 ? 30 : (daysLeft <= 60 ? 60 : 0);
    if (!threshold) continue;
    if (threshold === 60 && r.alert_sent_60) continue;
    if (threshold === 30 && r.alert_sent_30) continue;

    const subject = `${r.cert_type} expires in ${daysLeft} days \u2014 ${r.employee_name}`;
    const body = [
      `${r.employee_name}'s ${r.cert_type} certification expires ${r.expiration_date} (${daysLeft} days).`,
      "",
      "Time to schedule renewal or re-testing. Reply with the renewal plan.",
    ].join("\n");
    const inserted = insertDraft(sqlite, {
      type: "cert_expiring",
      subject,
      body,
      related_cert_id: r.id,
      dedupe_key: `cert_expiring:cert=${r.id}:threshold=${threshold}`,
    });
    if (inserted) {
      drafts++;
      // Also ping the tech directly (in-app)
      try {
        notify.run(r.employee_name, `Renew your ${r.cert_type} \u2014 ${daysLeft} days left`,
          `Your ${r.cert_type} certification expires ${r.expiration_date}. Please schedule renewal.`,
          new Date().toISOString());
      } catch {}
      try {
        if (threshold === 60) sqlite.prepare(`UPDATE certifications SET alert_sent_60 = 1 WHERE id = ?`).run(r.id);
        if (threshold === 30) sqlite.prepare(`UPDATE certifications SET alert_sent_30 = 1 WHERE id = ?`).run(r.id);
      } catch {}
    }
  }
  return `checked=${rows.length}, drafts=${drafts}`;
}

// #12: NOAA storm alert polling. If the alerts API returns severe alerts
// affecting our service-area FIPS codes, insert a storm_events row with
// origin='noaa' and let StormCAT.tsx surface it.
async function runNoaaCheck(ctx: SchedulerContext): Promise<string> {
  const { sqlite } = ctx;
  // Service area zones from storm_zips \u2014 if empty, fall back to Aiken/Augusta area.
  let zones: string[] = [];
  try {
    const cfg: any = sqlite.prepare(`SELECT value FROM system_settings WHERE key='noaa_zones'`).get();
    if (cfg?.value) zones = String(cfg.value).split(",").map(s => s.trim()).filter(Boolean);
  } catch {}
  if (zones.length === 0) {
    // Default: GA/SC counties around Augusta (Richmond, Columbia GA; Aiken, Edgefield SC).
    zones = ["GAC245", "GAC073", "SCC003", "SCC037"];
  }
  const url = `https://api.weather.gov/alerts/active?zone=${zones.join(",")}`;
  let events: any[] = [];
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "TitanPro/1.0 (ops@titanaugusta.com)", "Accept": "application/geo+json" },
    });
    if (!res.ok) return `noaa http ${res.status}`;
    const j: any = await res.json();
    events = Array.isArray(j?.features) ? j.features : [];
  } catch (e: any) {
    return `noaa error: ${e?.message || e}`;
  }
  let inserted = 0;
  for (const feat of events) {
    const p = feat?.properties || {};
    const id = String(feat?.id || p?.id || "");
    if (!id) continue;
    const severity = String(p.severity || "").toLowerCase();
    // Only ingest severe/extreme
    if (severity !== "severe" && severity !== "extreme") continue;
    // Dedupe on noaa_alert_id
    const existing: any = sqlite.prepare(`SELECT id FROM storm_events WHERE noaa_alert_id = ?`).get(id);
    if (existing) continue;
    try {
      sqlite.prepare(`INSERT INTO storm_events
          (name, event_type, event_date, severity, notes, origin, noaa_alert_id, noaa_severity, noaa_event, created_at)
          VALUES (?, ?, ?, ?, ?, 'noaa', ?, ?, ?, ?)`)
        .run(
          p.headline || p.event || "NOAA alert",
          "storm",
          (p.onset || p.effective || p.sent || new Date().toISOString()).slice(0, 10),
          severity,
          [p.description, p.instruction].filter(Boolean).join("\n\n").slice(0, 4000),
          id, severity, p.event || "", new Date().toISOString()
        );
      inserted++;
    } catch {}
  }
  return `noaa checked=${events.length}, new=${inserted}, zones=${zones.length}`;
}

async function runAllJobs(ctx: SchedulerContext) {
  const jobs: Array<[string, () => string | Promise<string>]> = [
    ["adjuster_silence", () => runAdjusterSilence(ctx)],
    ["ar_stalled",        () => runArStalled(ctx)],
    ["ar_weekly_digest",  () => runArWeeklyDigest(ctx)],
    ["coi_expiring",      () => runCoiExpiring(ctx)],
    ["cert_expiring",     () => runCertExpiring(ctx)],
    ["noaa_check",        () => runNoaaCheck(ctx)],
  ];
  for (const [name, fn] of jobs) {
    try {
      const summary = await Promise.resolve(fn());
      upsertRun(ctx.sqlite, name, "ok", String(summary));
      console.log(`[scheduler] ${name}: ${summary}`);
    } catch (e: any) {
      upsertRun(ctx.sqlite, name, "error", e?.message || String(e));
      console.error(`[scheduler] ${name} failed:`, e);
    }
  }
}

let started = false;

export function startScheduler(sqlite: Sqlite) {
  if (started) return;
  if (process.env.SCHEDULER_DISABLED === "1") {
    console.log("[scheduler] disabled by SCHEDULER_DISABLED=1");
    return;
  }
  started = true;
  const minutes = Math.max(5, parseInt(process.env.SCHEDULER_INTERVAL_MIN || "60", 10));
  const ctx: SchedulerContext = { sqlite, now: () => new Date() };
  console.log(`[scheduler] starting; interval=${minutes}min`);
  // Kick off first run 30 seconds after boot so DB is fully migrated.
  setTimeout(() => { runAllJobs(ctx).catch(err => console.error("[scheduler] initial run failed", err)); }, 30_000);
  setInterval(() => { runAllJobs(ctx).catch(err => console.error("[scheduler] tick failed", err)); }, minutes * 60_000);
}

// Exposed so a route can force a manual run for QA/smoke tests.
export async function runSchedulerNow(sqlite: Sqlite) {
  await runAllJobs({ sqlite, now: () => new Date() });
}
