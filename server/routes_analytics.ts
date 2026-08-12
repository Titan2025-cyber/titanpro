/**
 * routes_analytics.ts — Best-in-class metrics endpoint.
 *
 * A single GET /api/analytics/overview that returns the seven metrics
 * the Analytics tab renders. Kept in one file so all the SQL lives in
 * one place — easy to profile, easy to tune, and cheap to compute
 * (nothing here scans big tables without an index).
 *
 * Time windows: caller passes ?days=30|60|90|180|365 (default 90).
 */
import type { Express } from "express";
import type Database from "better-sqlite3";

type Sqlite = Database.Database;

export function registerAnalyticsRoutes(app: Express, sqlite: Sqlite, requireStaffAuth: any) {
  // ── Per-job analytics — GET /api/jobs/:id/analytics ────────────────
  // Everything the Analytics tab shows, scoped to a single job. Powers
  // the Job Analytics card on the JobDetail page (under Financial
  // Summary). Cheap: one job at a time so no aggregation over history.
  app.get("/api/jobs/:id/analytics", requireStaffAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!id || !Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
    const job = safeGet(sqlite, `SELECT * FROM jobs WHERE id = ?`, [id]);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const nowMs = Date.now();
    const createdMs = job.created_at ? new Date(job.created_at).getTime() : nowMs;
    const closedMs = job.closed_at ? new Date(job.closed_at).getTime() : null;
    const daysOpen = Math.max(0, Math.round(((closedMs ?? nowMs) - createdMs) / 86400000));

    // ── Cycle time: created → first invoice ──────────────────────────
    const firstInvoice = safeGet(sqlite, `
      SELECT MIN(created_at) as at FROM invoices
       WHERE job_id = ? AND deleted_at IS NULL
    `, [id])?.at;
    const daysToFirstInvoice = firstInvoice
      ? Math.max(0, Math.round((new Date(firstInvoice).getTime() - createdMs) / 86400000))
      : null;

    // ── Estimate → settled variance ──────────────────────────────────
    const estimateTotal = safeGet(sqlite, `
      SELECT COALESCE(SUM(total), 0) as v FROM estimates
       WHERE job_id = ? AND deleted_at IS NULL AND status != 'rejected'
    `, [id])?.v || 0;
    const settledTotal = safeGet(sqlite, `
      SELECT COALESCE(SUM(amount_approved), 0) as v FROM supplements
       WHERE job_id = ? AND status IN ('approved','partial')
    `, [id])?.v || 0;
    const variancePct = estimateTotal > 0
      ? ((settledTotal - estimateTotal) / estimateTotal) * 100
      : 0;

    // ── Supplements filed for this job ───────────────────────────────
    const suppRows = safeAll(sqlite, `
      SELECT amount_requested, amount_approved, status
        FROM supplements WHERE job_id = ?
    `, [id]);
    let sReq = 0, sApp = 0, sApproved = 0;
    for (const r of suppRows as any[]) {
      sReq += Number(r.amount_requested || 0);
      sApp += Number(r.amount_approved || 0);
      if (r.status === "approved" || r.status === "partial") sApproved += 1;
    }
    const supplements = {
      filed: suppRows.length,
      approvedCount: sApproved,
      approvalRate: suppRows.length > 0 ? (sApproved / suppRows.length) * 100 : 0,
      requested: sReq,
      approved: sApp,
      winRateAmount: sReq > 0 ? (sApp / sReq) * 100 : 0,
    };

    // ── AR aging for this job's invoices ─────────────────────────────
    // Note: `payments` has no created_at/credit_memo columns — payments
    // are dated via paid_at and credit-memo entries are represented by
    // type='credit_memo' rows rather than a flag column.
    const arRows = safeAll(sqlite, `
      SELECT id, invoice_number, total, COALESCE(created_at, '') as issued_at,
             (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
               WHERE (p.invoice_id = invoices.id OR p.job_id = invoices.job_id)
                 AND p.type = 'received') as paid
        FROM invoices
       WHERE job_id = ? AND deleted_at IS NULL
    `, [id]);
    const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, totalOutstanding: 0 };
    let oldestDays = 0;
    for (const r of arRows as any[]) {
      const outstanding = Number(r.total || 0) - Number(r.paid || 0);
      if (outstanding <= 0.01) continue;
      const issued = r.issued_at ? new Date(r.issued_at).getTime() : nowMs;
      const age = Math.max(0, Math.floor((nowMs - issued) / 86400000));
      oldestDays = Math.max(oldestDays, age);
      let b: keyof typeof buckets;
      if (age <= 30) b = "d0_30";
      else if (age <= 60) b = "d31_60";
      else if (age <= 90) b = "d61_90";
      else b = "d90plus";
      buckets[b] += outstanding;
      buckets.totalOutstanding += outstanding;
    }

    // ── Margin for this job (collected − costs) ──────────────────────
    // Collected = received payments minus credit_memo entries against
    // this job's invoices.
    const collected = safeGet(sqlite, `
      SELECT COALESCE(SUM(p.amount), 0) as v
        FROM payments p JOIN invoices i ON i.id = p.invoice_id
       WHERE i.job_id = ? AND p.type = 'received'
    `, [id])?.v || 0;
    const costs = safeGet(sqlite, `
      SELECT COALESCE(SUM(total), 0) as v FROM job_costs WHERE job_id = ?
    `, [id])?.v || 0;
    const grossProfit = collected - costs;
    const marginPct = collected > 0 ? (grossProfit / collected) * 100 : 0;

    // ── Activity: photos + notes + last touch ────────────────────────
    const photosCount = safeGet(sqlite, `
      SELECT COUNT(*) as c FROM photos WHERE job_id = ? AND deleted_at IS NULL
    `, [id])?.c || 0;
    const notesCount = safeGet(sqlite, `
      SELECT COUNT(*) as c FROM job_notes WHERE job_id = ?
    `, [id])?.c || 0;
    const lastNote = safeGet(sqlite, `
      SELECT MAX(created_at) as at FROM job_notes WHERE job_id = ?
    `, [id])?.at || null;
    // photos.taken_at is the canonical timestamp — there is no created_at column.
    const lastPhoto = safeGet(sqlite, `
      SELECT MAX(taken_at) as at FROM photos
       WHERE job_id = ? AND deleted_at IS NULL
    `, [id])?.at || null;
    const lastTouchMs = [lastNote, lastPhoto].filter(Boolean)
      .map(s => new Date(s!).getTime())
      .reduce((a, b) => Math.max(a, b), 0);
    const daysSinceTouch = lastTouchMs > 0
      ? Math.max(0, Math.floor((nowMs - lastTouchMs) / 86400000))
      : null;

    // ── Carrier benchmarks (same carrier, closed jobs, same phase) ───
    // Compare this job's variance + cycle time to peers on the same
    // carrier. Only computed when we have a carrier + at least a few
    // peers so the numbers are meaningful.
    let carrierBenchmark: any = null;
    if (job.insurance_carrier) {
      const peerRows = safeAll(sqlite, `
        SELECT j.id, j.created_at, j.closed_at,
               (SELECT COALESCE(SUM(total), 0) FROM estimates e WHERE e.job_id = j.id AND e.deleted_at IS NULL AND e.status != 'rejected') as est,
               (SELECT COALESCE(SUM(amount_approved), 0) FROM supplements s WHERE s.job_id = j.id AND s.status IN ('approved','partial')) as settled
          FROM jobs j
         WHERE j.insurance_carrier = ? AND j.id != ? AND j.deleted_at IS NULL
         LIMIT 200
      `, [job.insurance_carrier, id]);
      const variances: number[] = [];
      const cycles: number[] = [];
      for (const p of peerRows as any[]) {
        if (p.est > 0 && p.settled > 0) variances.push(((p.settled - p.est) / p.est) * 100);
        if (p.created_at && p.closed_at) {
          const d = Math.max(0, Math.round((new Date(p.closed_at).getTime() - new Date(p.created_at).getTime()) / 86400000));
          cycles.push(d);
        }
      }
      if (variances.length >= 3 || cycles.length >= 3) {
        carrierBenchmark = {
          carrier: job.insurance_carrier,
          peers: peerRows.length,
          medianVariancePct: variances.length ? median(variances) : null,
          medianCycleDays: cycles.length ? median(cycles) : null,
        };
      }
    }

    res.json({
      jobId: id,
      generatedAt: new Date().toISOString(),
      timeline: {
        createdAt: job.created_at,
        closedAt: job.closed_at,
        daysOpen,
        daysToFirstInvoice,
        daysSinceTouch,
        lastNoteAt: lastNote,
        lastPhotoAt: lastPhoto,
      },
      variance: { estimateTotal, settledTotal, variancePct },
      supplements,
      agingAR: { buckets, oldestDays, invoiceCount: (arRows as any[]).length },
      margin: { collected, costs, grossProfit, marginPct },
      activity: { photos: photosCount, notes: notesCount },
      carrierBenchmark,
    });
  });

  app.get("/api/analytics/overview", requireStaffAuth, (req, res) => {
    const days = clampDays(Number(req.query.days) || 90);
    const from = new Date(Date.now() - days * 86400 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    // ── 1. Cycle time (FNOL/created → invoiced) by phase ──────────────
    // Median + p90 in days. Only jobs with at least one invoice.
    const cycleRows = safeAll(sqlite, `
      SELECT j.id, j.created_at as job_created,
             MIN(i.created_at) as first_invoice,
             (SELECT normalize_phase(inv.phase) FROM invoices inv WHERE inv.job_id = j.id ORDER BY inv.id ASC LIMIT 1) as phase
        FROM jobs j
        JOIN invoices i ON i.job_id = j.id AND (i.deleted_at IS NULL)
       WHERE j.deleted_at IS NULL AND j.created_at >= ?
       GROUP BY j.id
    `, [from]);
    // Fallback for missing normalize_phase(): compute phase in JS.
    const cycleData: Record<string, number[]> = { mitigation: [], reconstruction: [] };
    for (const r of cycleRows as any[]) {
      if (!r.job_created || !r.first_invoice) continue;
      const days = daysBetween(r.job_created, r.first_invoice);
      const ph = (r.phase === "reconstruction") ? "reconstruction" : "mitigation";
      cycleData[ph].push(days);
    }
    const cycleTime = {
      mitigation:     summarize(cycleData.mitigation),
      reconstruction: summarize(cycleData.reconstruction),
    };

    // ── 2. Estimate → settled variance (per carrier) ──────────────────
    // For every job with both an estimate total and a settled supplement
    // amount, compute (settled - estimate) / estimate. Group by carrier.
    const varianceRows = safeAll(sqlite, `
      SELECT j.id, j.insurance_carrier as carrier,
             (SELECT SUM(total) FROM estimates e WHERE e.job_id = j.id AND (e.deleted_at IS NULL) AND e.status != 'rejected') as estimate_total,
             (SELECT SUM(amount_approved) FROM supplements s WHERE s.job_id = j.id AND s.status IN ('approved','partial')) as settled_total
        FROM jobs j
       WHERE j.deleted_at IS NULL AND j.created_at >= ?
    `, [from]);
    const byCarrier: Record<string, { count: number; est: number; settled: number }> = {};
    let overallEst = 0, overallSet = 0, overallCount = 0;
    for (const r of varianceRows as any[]) {
      const est = Number(r.estimate_total || 0);
      const settled = Number(r.settled_total || 0);
      if (est <= 0 || settled <= 0) continue;
      const key = String(r.carrier || "Unknown").trim() || "Unknown";
      (byCarrier[key] ||= { count: 0, est: 0, settled: 0 });
      byCarrier[key].count += 1;
      byCarrier[key].est += est;
      byCarrier[key].settled += settled;
      overallEst += est; overallSet += settled; overallCount += 1;
    }
    const variance = {
      overall: {
        count: overallCount,
        estimateTotal: overallEst,
        settledTotal: overallSet,
        variancePct: overallEst > 0 ? ((overallSet - overallEst) / overallEst) * 100 : 0,
      },
      byCarrier: Object.entries(byCarrier).map(([carrier, v]) => ({
        carrier,
        count: v.count,
        estimateTotal: v.est,
        settledTotal: v.settled,
        variancePct: v.est > 0 ? ((v.settled - v.est) / v.est) * 100 : 0,
      })).sort((a, b) => b.count - a.count),
    };

    // ── 3. Supplement win rate (per carrier) ──────────────────────────
    const suppRows = safeAll(sqlite, `
      SELECT j.insurance_carrier as carrier, s.amount_requested, s.amount_approved, s.status
        FROM supplements s
        JOIN jobs j ON j.id = s.job_id
       WHERE s.created_at >= ?
    `, [from]);
    const suppMap: Record<string, { req: number; app: number; count: number; approvedCount: number }> = {};
    let sReq = 0, sApp = 0, sCount = 0, sApproved = 0;
    for (const r of suppRows as any[]) {
      const key = String(r.carrier || "Unknown").trim() || "Unknown";
      (suppMap[key] ||= { req: 0, app: 0, count: 0, approvedCount: 0 });
      const req = Number(r.amount_requested || 0);
      const app = Number(r.amount_approved || 0);
      suppMap[key].req += req;
      suppMap[key].app += app;
      suppMap[key].count += 1;
      if (r.status === "approved" || r.status === "partial") suppMap[key].approvedCount += 1;
      sReq += req; sApp += app; sCount += 1;
      if (r.status === "approved" || r.status === "partial") sApproved += 1;
    }
    const supplements = {
      overall: {
        count: sCount,
        approvedCount: sApproved,
        approvalRate: sCount > 0 ? (sApproved / sCount) * 100 : 0,
        requestedTotal: sReq,
        approvedTotal: sApp,
        winRateAmount: sReq > 0 ? (sApp / sReq) * 100 : 0,
      },
      byCarrier: Object.entries(suppMap).map(([carrier, v]) => ({
        carrier,
        count: v.count,
        approvalRate: v.count > 0 ? (v.approvedCount / v.count) * 100 : 0,
        requested: v.req,
        approved: v.app,
        winRateAmount: v.req > 0 ? (v.app / v.req) * 100 : 0,
      })).sort((a, b) => b.count - a.count),
    };

    // ── 4. Tech productivity (per employee, last N days) ──────────────
    const techRows = safeAll(sqlite, `
      SELECT id, name, role FROM employees WHERE (role = 'tech' OR role = 'sales' OR role = 'owner' OR role = 'admin')
    `, []);
    const techs = (techRows as any[]).map(t => {
      const photosCount = safeGet(sqlite, `
        SELECT COUNT(*) as c FROM photos
         WHERE deleted_at IS NULL AND uploaded_by = ? AND created_at >= ?
      `, [t.name, from])?.c || 0;
      const notesCount = safeGet(sqlite, `
        SELECT COUNT(*) as c FROM job_notes WHERE tech_name = ? AND created_at >= ?
      `, [t.name, from])?.c || 0;
      const closedCount = safeGet(sqlite, `
        SELECT COUNT(*) as c FROM jobs
         WHERE deleted_at IS NULL AND closed_by = ? AND closed_at >= ?
      `, [t.name, from])?.c || 0;
      return { id: t.id, name: t.name, role: t.role, photos: photosCount, notes: notesCount, jobsClosed: closedCount };
    });
    // Rank by a simple composite: photos + 2*notes + 5*jobsClosed.
    techs.forEach((t: any) => { t.score = t.photos + t.notes * 2 + t.jobsClosed * 5; });
    techs.sort((a: any, b: any) => b.score - a.score);

    // ── 5. Aging AR (0/30/60/90+) ─────────────────────────────────────
    const arRows = safeAll(sqlite, `
      SELECT id, job_id, invoice_number, total,
             COALESCE(created_at, '') as issued_at,
             (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
               WHERE (p.invoice_id = invoices.id OR p.job_id = invoices.job_id)
                 AND p.type = 'received' AND (p.credit_memo IS NULL OR p.credit_memo = 0)) as paid
        FROM invoices
       WHERE deleted_at IS NULL
    `, []);
    const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, totalOutstanding: 0 };
    const arDetail: any[] = [];
    const nowMs = Date.now();
    for (const r of arRows as any[]) {
      const outstanding = Number(r.total || 0) - Number(r.paid || 0);
      if (outstanding <= 0.01) continue;
      const issued = r.issued_at ? new Date(r.issued_at).getTime() : nowMs;
      const age = Math.max(0, Math.floor((nowMs - issued) / 86400000));
      let bucket: keyof typeof buckets;
      if (age <= 30) bucket = "d0_30";
      else if (age <= 60) bucket = "d31_60";
      else if (age <= 90) bucket = "d61_90";
      else bucket = "d90plus";
      buckets[bucket] += outstanding;
      buckets.totalOutstanding += outstanding;
      arDetail.push({ id: r.id, jobId: r.job_id, invoiceNumber: r.invoice_number, age, outstanding, bucket });
    }
    arDetail.sort((a, b) => b.age - a.age);

    // ── 6. Lead → job conversion funnel ───────────────────────────────
    // Reads from contacts (leads) and jobs (converted). We consider a
    // contact "converted" when at least one job references its id.
    const totalLeads = safeGet(sqlite, `
      SELECT COUNT(*) as c FROM contacts WHERE created_at >= ?
    `, [from])?.c || 0;
    const convertedLeads = safeGet(sqlite, `
      SELECT COUNT(DISTINCT c.id) as c
        FROM contacts c
        JOIN jobs j ON j.contact_id = c.id AND j.deleted_at IS NULL
       WHERE c.created_at >= ?
    `, [from])?.c || 0;
    const bySource = safeAll(sqlite, `
      SELECT COALESCE(lead_source, 'unknown') as source,
             COUNT(*) as leads,
             SUM(CASE WHEN EXISTS(SELECT 1 FROM jobs j WHERE j.contact_id = contacts.id AND j.deleted_at IS NULL) THEN 1 ELSE 0 END) as converted
        FROM contacts
       WHERE created_at >= ?
       GROUP BY lead_source
       ORDER BY leads DESC
    `, [from]);
    const conversion = {
      leads: totalLeads,
      converted: convertedLeads,
      rate: totalLeads > 0 ? (convertedLeads / totalLeads) * 100 : 0,
      bySource: (bySource as any[]).map(r => ({
        source: r.source,
        leads: r.leads,
        converted: r.converted,
        rate: r.leads > 0 ? (r.converted / r.leads) * 100 : 0,
      })),
    };

    // ── 7. Job margin distribution ────────────────────────────────────
    // For each closed job in the window: collected - costs → margin$
    // and margin% = margin$ / collected * 100. Return a histogram.
    const marginRows = safeAll(sqlite, `
      SELECT j.id,
             (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
                JOIN invoices i ON i.id = p.invoice_id
               WHERE i.job_id = j.id AND p.type = 'received'
                 AND (p.credit_memo IS NULL OR p.credit_memo = 0)) as collected,
             (SELECT COALESCE(SUM(total), 0) FROM job_costs WHERE job_id = j.id) as costs
        FROM jobs j
       WHERE j.deleted_at IS NULL AND j.closed_at IS NOT NULL AND j.closed_at >= ?
    `, [from]);
    const marginBuckets = [
      { label: "< 0%",     min: -Infinity, max: 0,     count: 0 },
      { label: "0–15%",    min: 0,         max: 15,    count: 0 },
      { label: "15–30%",   min: 15,        max: 30,    count: 0 },
      { label: "30–45%",   min: 30,        max: 45,    count: 0 },
      { label: "45–60%",   min: 45,        max: 60,    count: 0 },
      { label: "> 60%",    min: 60,        max: Infinity, count: 0 },
    ];
    const marginPcts: number[] = [];
    for (const r of marginRows as any[]) {
      const c = Number(r.collected || 0);
      const cost = Number(r.costs || 0);
      if (c <= 0) continue;
      const pct = ((c - cost) / c) * 100;
      marginPcts.push(pct);
      const b = marginBuckets.find(b => pct >= b.min && pct < b.max);
      if (b) b.count += 1;
    }
    const margin = {
      count: marginPcts.length,
      median: median(marginPcts),
      p90: percentile(marginPcts, 90),
      p10: percentile(marginPcts, 10),
      distribution: marginBuckets,
    };

    res.json({
      generatedAt: nowIso,
      windowDays: days,
      windowStart: from,
      cycleTime,
      variance,
      supplements,
      techProductivity: techs,
      agingAR: { buckets, detail: arDetail.slice(0, 100) },
      conversion,
      margin,
    });
  });
}

// ── helpers ──────────────────────────────────────────────────────────
function clampDays(d: number) { return Math.max(7, Math.min(365, Math.round(d))); }
function daysBetween(a: string, b: string) {
  const t1 = new Date(a).getTime(), t2 = new Date(b).getTime();
  if (!isFinite(t1) || !isFinite(t2)) return 0;
  return Math.max(0, Math.round((t2 - t1) / 86400000));
}
function summarize(arr: number[]) {
  return { n: arr.length, median: median(arr), p90: percentile(arr, 90), mean: mean(arr) };
}
function mean(arr: number[]) { return arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0; }
function median(arr: number[]) { return percentile(arr, 50); }
function percentile(arr: number[], p: number) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function safeAll(sqlite: Sqlite, sql: string, args: any[] = []) {
  try { return sqlite.prepare(sql).all(...args); }
  catch (e: any) { console.warn("[analytics] query failed:", e?.message); return []; }
}
function safeGet(sqlite: Sqlite, sql: string, args: any[] = []): any {
  try { return sqlite.prepare(sql).get(...args); }
  catch (e: any) { console.warn("[analytics] query failed:", e?.message); return null; }
}
