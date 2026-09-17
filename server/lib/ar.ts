// Shared A/R math. Every server route that reports "outstanding" MUST use
// computeOutstanding() so the number agrees with /api/jobs/financials and the
// Dashboard. Direct sums of invoice.total for non-paid invoices are wrong —
// they ignore partial payments and credit-memo bill-downs.
//
// Formula (per invoice, applied in id order per job):
//   outstanding = max(0, total − collected_on_invoice − creditMemos_on_invoice)
// then any remaining job-level payments (payments with no invoice_id) are
// spread across that job's open invoices oldest-first (by id ascending).

export type InvoiceRow = {
  id: number;
  job_id: number;
  total: number | null;
  status?: string | null;
  created_at?: string | null;
  issue_date?: string | null;
};

export type PaymentRow = {
  id?: number;
  type?: string | null;
  amount?: number | null;
  invoice_id?: number | null;
  job_id?: number | null;
  credit_memo?: number | boolean | null; // SQLite stores 0/1, may arrive as boolean
};

/**
 * Return a Map<invoiceId, outstandingAmount> for the supplied invoices.
 * Non-open invoices (status paid | draft) are skipped and will not appear
 * in the map — callers should treat missing keys as "not open, outstanding
 * is zero". `openStatuses` optional override for the "open" definition.
 */
export function computeOutstanding(
  invoices: InvoiceRow[],
  payments: PaymentRow[],
  opts: { openStatuses?: Set<string> } = {},
): Map<number, number> {
  const openStatuses = opts.openStatuses;
  const isOpen = (i: InvoiceRow) => {
    const s = String(i.status || "sent").toLowerCase();
    if (openStatuses) return openStatuses.has(s);
    return s !== "paid" && s !== "draft";
  };

  const openInvoices = invoices.filter(isOpen);
  const invPay = new Map<number, { collected: number; credit: number }>();
  const jobPay = new Map<number, { collected: number; credit: number }>();

  for (const p of payments) {
    const amt = Number(p.amount || 0);
    if (!amt) continue;
    const isCredit = !!p.credit_memo;
    const isReceived = p.type === "received";
    if (!isCredit && !isReceived) continue;

    if (p.invoice_id != null) {
      const b = invPay.get(p.invoice_id) || { collected: 0, credit: 0 };
      if (isCredit) b.credit += amt; else b.collected += amt;
      invPay.set(p.invoice_id, b);
    } else if (p.job_id != null) {
      const b = jobPay.get(p.job_id) || { collected: 0, credit: 0 };
      if (isCredit) b.credit += amt; else b.collected += amt;
      jobPay.set(p.job_id, b);
    }
  }

  // Group open invoices by job, oldest first (by id — proxy for issue order).
  const openByJob = new Map<number, InvoiceRow[]>();
  for (const inv of openInvoices) {
    const arr = openByJob.get(inv.job_id) || [];
    arr.push(inv);
    openByJob.set(inv.job_id, arr);
  }
  for (const arr of openByJob.values()) arr.sort((a, b) => (a.id || 0) - (b.id || 0));

  const remainingJobPay = new Map<number, { collected: number; credit: number }>();
  for (const [k, v] of jobPay) remainingJobPay.set(k, { ...v });

  const out = new Map<number, number>();
  // Iterate in job-id-order so job-level payment spread is deterministic.
  const jobIds = Array.from(openByJob.keys()).sort((a, b) => a - b);
  for (const jobId of jobIds) {
    const arr = openByJob.get(jobId)!;
    for (const inv of arr) {
      const b = invPay.get(inv.id) || { collected: 0, credit: 0 };
      let remaining = Number(inv.total || 0) - b.collected - b.credit;
      const jr = remainingJobPay.get(inv.job_id);
      if (jr && remaining > 0) {
        const useColl = Math.min(jr.collected, remaining);
        remaining -= useColl; jr.collected -= useColl;
        const useCred = Math.min(jr.credit, Math.max(0, remaining));
        remaining -= useCred; jr.credit -= useCred;
      }
      out.set(inv.id, Math.max(0, remaining));
    }
  }
  return out;
}

/** Sum outstanding across all provided invoices. Convenience wrapper. */
export function sumOutstanding(invoices: InvoiceRow[], payments: PaymentRow[]): number {
  const m = computeOutstanding(invoices, payments);
  let t = 0;
  for (const v of m.values()) t += v;
  return t;
}
