# Titan Pro — Audit Report

**Date:** 2026-09-17
**Author:** Perplexity Computer (engineering audit for Cody Brantley)
**Scope:** Full production codebase — `titanpro` on Railway (titanaugusta.pro)
**Reference commit:** `9af3ed5` on `origin/main`

---

## Executive summary

Titan Pro is a **large single-tenant restoration operations platform** — 155 client pages, 20 server modules, ~697 API endpoints, roughly 11k lines in `server/routes.ts` alone. The product is functionally deep (jobs, estimates, invoices, portals, HR, QuickBooks, Gmail, calendar, AI agent, subcontractors, marketing, reporting) and structurally healthy in the parts that matter most for revenue and legal defense: a **default-deny API gate**, per-route rate limits on the auth surface, encrypted-at-rest OAuth credentials, and a role/permission matrix with additive/subtractive overrides. Recent pushes closed the FullCalendar break, the mobile lead-entry gap, and the QuickBooks OAuth loop.

The debt that is worth investing in — before commercialization or attorney handoff — is mostly **structural**, not user-facing:

1. **Type safety is soft in several hot paths** (86 `error TS` in `check`, ~522 `as any` in server, ~464 in client). None are known runtime bugs; they weaken refactor safety.
2. **`server/routes.ts` is 10,484 lines** — this makes cross-cutting security review, permission changes, and multi-tenancy retrofit slow and error-prone.
3. **Six orphan client pages** are being compiled and shipped in the bundle but not routed. Dead weight and a legal/IP-review distraction.
4. **A handful of missing frontend routes** to real backend features (Conversion Rate, Reconciliation, Payment Reminders, Referral Nurture) — the backend exists, the UI is either half-wired or missing entirely.
5. **Bundle size** — top three JS chunks are 636k / 516k / 436k. Splittable.
6. **Multi-tenancy is not present** — a hard blocker for any commercial sale of Titan Pro as a product to other restoration companies.

Nothing in this audit implies a production emergency. Everything below is prioritized by business impact.

---

## Codebase at a glance

| Surface | Count |
| --- | --- |
| Client pages (`client/src/pages/*.tsx`) | 155 |
| Client routes registered in `App.tsx` | 149 |
| Server route modules | 20 (`server/routes.ts` + 19 `routes_*.ts`) |
| API endpoints across all modules | 697 |
| Endpoints in the monolithic `routes.ts` | ~379 |
| Lines in `server/routes.ts` | 10,484 |
| Client `as any` casts | 464 |
| Server `as any` casts | 522 |
| TypeScript errors under `npm run check` | 86 (see §Type-safety) |
| Largest bundle chunk | `pdf-*.js` @ 636 KB |
| ESLint / lint config | None found |

---

## Security posture

### What is right

**Central default-deny API gate.**
`server/routes.ts` mounts `gateStaffAuth` on every `/api` request. Only an explicit `PUBLIC_API` allowlist (health check, public config, staff auth endpoints, customer/adjuster portals, e-sign, QuickBooks/Gmail OAuth callbacks) bypasses it. This is the correct model — every future endpoint is protected by default. `PUBLIC_API` is short, reviewable, and each entry has an inline justification.

**Rate limiting on high-value auth endpoints.**
`server/index.ts` applies dedicated limiters to `/api/auth/login`, `/api/auth/change-password`, `/api/auth/2fa/verify`, `/api/auth/2fa/setup/verify`, and `/api/auth/pin-users`. A general `apiLimiter` covers everything else under `/api/`.

**2FA is real, not decorative.**
`server/twofactor.ts` implements TOTP with backup codes, hashed with `hashBackupCodes`. Enrollment and verification endpoints are rate-limited.

**Encrypted at rest.**
`server/encryption.ts` provides `encryptField` / `decryptField` — used in the QuickBooks and Gmail OAuth token stores.

**Role/permission matrix with per-employee overrides.**
`ROLE_PERMISSIONS` in `server/routes_auth.ts` grants baseline permissions per role, and each employee's `permissions` JSON supports additive (`+key`) and subtractive (`-key`) overrides. Owner and general_manager have the broadest grants; tech is scoped to field-facing keys only.

**Public portals use scoped bearer tokens.**
Customer portal, adjuster portal, `/sign/:token`, and `/company-doc/:token` all authenticate via a **single-purpose token** stored in the record they unlock — no session, no cross-portal escalation surface. Signing tokens rotate on send, are single-use, 7-day expiry, and revocable.

### What to tighten

- **PIN policy** — verify current PINs are 6-digit minimum, no repeats (`111111`), no straight runs (`123456`), and locked after N wrong attempts within a window. If not, `routes_auth.ts` is the right place.
- **`req.employee` type discipline** — `Express.Request` has been augmented with an optional `employee` object (`server/types-express.d.ts`), but many handlers still cast `(req as any).employee`. Migrate to `req.employee` and let TypeScript catch missing auth checks.
- **CSP / security headers** — verify `helmet` is applied with a strict Content-Security-Policy that covers Google Maps, Gmail iframe, and Stripe embeds. If not present, add.
- **QuickBooks credentials** — confirm encryption keys are provided via env vars only, never committed. `git log --all -- .env` should return nothing sensitive.
- **Portal token entropy** — audit the token generator (`crypto.randomBytes` should be ≥ 32 bytes, base64url encoded). Signing tokens must not be predictable from the record ID.

---

## Type safety

`npm run check` reports **86 TypeScript errors** on `main`. None are known runtime bugs (the app builds and runs), but each represents a place where TS is *not* helping you refactor safely.

The remaining errors cluster in three known areas from prior sweeps:

- `server/property_lookup.ts` — 3 errors from `geo` being possibly `null` and destructured `{ lat, lon }` binding to implicit `any`. Trivial fix (~5 minutes): add `if (!geo) return { ... }` guard and type the destructure.
- `client/src/pages/JobPhotos.tsx`, `PredictiveModel.tsx`, portal pages — the balance. These are pre-existing and safe to defer; none block the build.

**`as any` volume.** 986 total (`464` client, `522` server). This is the single biggest structural debt. Recommend a rolling policy:

- **New code:** no new `as any` accepted at PR time.
- **Existing code:** reduce by 5% per month, starting with hot paths (`storage.ts`, `routes.ts` job/estimate/invoice handlers).

---

## Architecture: `server/routes.ts` at 10,484 lines

This one file holds ~379 endpoints — contacts, jobs, estimates, invoices, line items, calendar mapping, notifications, QuickBooks sync, dashboard aggregates, and more. It is the single largest security-critical surface in the codebase.

**Why it matters:**

- Any change requires reading a large file to understand what else the change might affect.
- Merge conflicts on a solo repo are rare, but multi-contributor work would be painful.
- Multi-tenancy retrofit requires touching every handler in this file to add `WHERE tenant_id = ?` clauses. Splitting the file first makes that project tractable.

**Suggested split (no logic changes, just moves):**

| New file | Approx endpoints |
| --- | --- |
| `server/routes_contacts.ts` | 12 |
| `server/routes_jobs.ts` | 76 |
| `server/routes_estimates.ts` | 11 |
| `server/routes_invoices.ts` | 10 |
| `server/routes_line_items.ts` | 10 |
| `server/routes_reports.ts` | 18 |
| `server/routes_qb.ts` | 12 |
| `server/routes_photos.ts` | 6 |
| `server/routes_notifications.ts` | 6 |
| `server/routes_calendar.ts` | (currently in `routes_suite5.ts` — leave) |
| Everything else remains in `routes.ts` | ~218 |

This is a mechanical refactor. It can be done in one sitting with no behavior change. It **must** land before the multi-tenancy retrofit.

---

## Dead code and misrouted pages

### Orphan pages compiled but never routed

Six pages exist under `client/src/pages/` but are not referenced in `App.tsx`:

| File | Recommendation |
| --- | --- |
| `Consumables.tsx` | Verify `/consumables` route missing — the backend has 14 endpoints under `/api/consumables`. Add the route OR delete the page. |
| `ConversionRate.tsx` | Delete OR wire to sales reporting. |
| `CustomerPortalParts.tsx` | Likely a partial extraction. Delete if `CustomerPortal.tsx` covers it. |
| `PaymentReminders.tsx` | Wire to `/api/reminders` (6 backend endpoints) or delete. |
| `Reconciliation.tsx` | Wire to QuickBooks/AR reconciliation OR delete. |
| `ReferralNurture.tsx` | Wire to marketing OR delete. |

Every orphan is currently being compiled, chunked, and shipped to the browser. Removing or wiring them is a **five-minute win** that reduces bundle size and clarifies scope.

### Confirmed orphan UI components

Seven shadcn primitives are unused in the codebase:

- `slider`, `input-otp`, `toaster`, `aspect-ratio`, `breadcrumb`, `radio-group`, `resizable`

Safe to delete. Save ~3–5 KB.

### Prior backlog items to retire

- `client/src/pages/CommsHub.tsx` — the shared-assets audit flagged this for deletion. Confirm and delete.

---

## Frontend / UX debt

### High-impact, low-effort

- **Bundle chunking.** `pdf-*.js` @ 636 KB is loaded on every page even though PDF generation is only used by ~15% of pages. Convert `import` → `React.lazy()` on `pdfEngine.ts` imports at the page level. Expected savings: initial page load ~600 KB smaller.
- **Data-testid coverage.** Push 2 added `data-testid` to the New Job and Emergency Intake dialogs. Roll the pattern to Jobs list actions, Estimates create flow, Invoice send. Enables Playwright E2E without brittle selectors.
- **Dev banner.** The prominent red "non-production, do not enter customer data" banner is scheduled for Push 4. Do not remove it until commercialization + multi-tenancy ship — it is a legal safeguard.

### Mobile polish (in progress)

- **Calendar** — Push 2 hotfix landed listMonth as mobile default, ±60-day fetch, empty-state banners. Verify with real user session on iPhone.
- **Dispatch flow** — Emergency Intake and New Job are now Sheet-on-mobile with tap-tile loss types and formatted phone inputs. Roll the same pattern to Estimates → New Estimate and Invoices → New Invoice.
- **StormMap / RoutePlanner** — flagged for Leaflet migration (from whatever they use today). Deferred.

### Deferred UI features

- Per-recipient signature variants for e-sign
- Lead queue UI (backend exists, no page)
- GPS tech-tracking map
- Tech-overlay pulsing CSS
- Titan Assistant re-enable (currently disabled; confirmation gate ready)
- Delete `CommsHub.tsx`

---

## Backend and integrations

### QuickBooks

Recent OAuth encryption + customer-sync + diagnostics work is in place. Verify:

- **Manual "Sync now" button** — deferred item. Add so operators aren't dependent on the background scheduler.
- **Encrypted-token rotation** — confirm refresh tokens are re-encrypted with the current key on every rotation.
- **Sync failure surfacing** — background failures should raise a bell notification for owners, not just log.

### Gmail

43 endpoints under `/api/gmail`. OAuth callback is in the public allowlist (correct). Confirm token expiry handling: refreshed silently on request, or does the user see a "reconnect" prompt?

### Calendar

FullCalendar plugin mismatch fixed in Push 1. Push 2 hotfix (commit `9af3ed5`) fixed mobile default view + empty-state clarity. `calendar_events` table has `completed_at` / `completed_by` migrations that are guarded — safe on re-deploy.

### Ramp

Confirmed removed in prior segment. No live integration.

---

## Data integrity

### Closed-job record loss

**Not resolved.** A prior report indicated closed jobs losing records under some circumstance. Recommended next step:

1. Reproduce with a scratch job in staging OR add a background sanity-check that snapshots the closed-job payload before status transition.
2. Add an audit-log write on every `PATCH /api/jobs/:id/close` (or equivalent) recording the full row.
3. Consider soft-delete only for closed jobs — never `DELETE FROM jobs` in the close handler.

### Contact delete

`DELETE /api/contacts/:id` is now handled by `registerContactAdminRoutes()` per the inline comment in `routes.ts` — the old naive handler was removed because it orphaned jobs, invoices, portal sessions, and payout requests. Verify the new handler either **blocks** delete when references exist, or **cascades safely** and audits every dependent row it touches.

### Migrations

Migrations are guarded by `PRAGMA table_info(...)` checks. Correct pattern. Every new column addition should follow it — never assume a fresh database.

---

## Commercialization blockers

The single largest gap between "Titan's internal tool" and "Titan Pro as a product" is **multi-tenancy**.

Every table that stores customer, job, employee, or financial data needs a `tenant_id` column. Every query needs a `WHERE tenant_id = ?` clause. Every session needs to carry a tenant scope. Every OAuth integration (QuickBooks, Gmail, Stripe) needs to be re-tokenized per tenant.

**Prerequisite work in order:**

1. Split `server/routes.ts` per the plan in §Architecture.
2. Add a `tenants` table + `tenant_id` to every domain table.
3. Attach the tenant scope during login and enforce in `gateStaffAuth`.
4. Retrofit every SELECT/UPDATE/DELETE with the tenant guard.
5. Regression test with two seeded tenants and a shared employee email.

Also blocking commercialization (per prior planning):

- Hardened admin controls
- Onboarding flow
- Pricing / billing (Stripe subscriptions per tenant)
- Uptime evidence (status page or SLO reporting)
- Decide whether to re-enable the disabled, confirmation-gated in-app assistant

Commercial name has not been chosen. Continue the domain/trademark/entity screening thread separately from the audit.

---

## Legal / attorney-handoff readiness

Cody is preparing Titan Pro's capabilities, data boundaries, and integration model for attorney review. The attorney will want to see:

1. **Data flow diagram** — where customer PII, payment info, and photos live; who has access; what leaves the sandbox (QuickBooks, Gmail, Stripe, insurance carrier portals).
2. **Encryption inventory** — TLS in transit (Railway default), what is encrypted at rest (currently OAuth tokens via `encryption.ts`), what is not.
3. **Third-party processors** — QuickBooks, Gmail, Stripe (if used), Google Maps, any AI provider used by the AI agent.
4. **Retention** — how long closed-job records, invoices, e-sign PDFs, and inbound emails are kept.
5. **Backup and disaster recovery** — Railway persistent volume snapshots; where they go; how to restore.
6. **Repository ownership** — GitHub `Titan2025-cyber/titanpro` — commit history, contributors, license (currently no `LICENSE` file), CLA if any.

These are already reflected in the pending attorney-synopsis and legal-protection playbook. The audit reinforces that all six items are answerable today from the codebase — the attorney can act.

---

## Recommendations, ranked

1. **Fix the 3 easy `check` errors** in `property_lookup.ts` — 5 minutes.
2. **Delete or wire the 6 orphan pages + 7 orphan UI primitives + `CommsHub.tsx`** — 30 minutes.
3. **Lazy-load `pdfEngine.ts`** at every page-level import site — 2 hours, ~600 KB win on first paint.
4. **Split `server/routes.ts`** into the domain files listed in §Architecture — one focused sitting.
5. **Adopt a no-new-`as any` policy** for future PRs; start the burn-down on `storage.ts` and `routes.ts` handlers.
6. **Add manual QuickBooks "Sync now" button** — deferred backlog item, low-risk.
7. **Investigate closed-job record loss** — reproduce, add audit-log guard, soft-delete only.
8. **Design multi-tenancy** on paper before writing code; land the routes.ts split first.
9. **Verify PIN policy** matches your stated preference (6-digit min, no repeats, no runs, lockout).
10. **Move the dev banner removal to Push 4** as planned — only after multi-tenancy + commercialization ship.

---

## Appendix — signals I did *not* find (green flags)

- No `TODO` / `FIXME` / `HACK` / `XXX` markers in the codebase. Prior authors documented instead.
- No `@ts-ignore` / `@ts-expect-error` — the tech-debt vector is `as any`, not error suppression.
- No hardcoded secrets in the tree (based on grep of common patterns; a formal secrets scan is a separate step).
- Migrations are guarded (`PRAGMA table_info`), not blindly issued.
- The auth gate is default-deny, not default-allow. This is a rare and correct choice.

---

*End of report.*
