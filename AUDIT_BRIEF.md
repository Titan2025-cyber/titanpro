# Titan Pro — Gap/Hole Audit Brief

You are auditing a production restoration-industry CRM for **holes/gaps**. Node v20, Express + SQLite (better-sqlite3, synchronous), Drizzle for core + raw SQL for many tables. React/Vite frontend. Project dir: `/home/user/workspace/titan-pro`.

## What's ALREADY CONFIRMED (do NOT re-report as holes)
- There IS a global default-deny auth gate at `server/routes.ts` ~line 430-465: `app.use("/api", ...)` runs `gateStaffAuth` on every `/api/*` route except an allowlist (health, auth login/logout/me/change-password, customer-portal/ prefix, adjuster-portal/ prefix, portal/login, qb oauth callback/start). So "no auth on route line" is NOT a hole — authentication is enforced globally.
- Adjuster portal validates access_token + expiry before returning data (line ~2813). Fine.
- Generic edit/delete registrar exists at `server/routes_crud_gaps.ts` for 34 raw-SQL tables; append-only logs (activity_log, audit_log, qb_sync_log, iot_readings, sms_messages) DELETE gated to owner/admin.

## YOUR JOB — find REAL holes in these categories. Be concrete with file:line.

1. **Authorization (role) gaps** — authentication != authorization. The global gate only checks "is staff logged in", NOT role. Find sensitive endpoints (financial writes, user management, payroll/HR, deleting/editing money records, QuickBooks, Ramp, changing permissions, viewing PII/SSN) that do NOT call `requireRole(...)`. List the most dangerous ones a low-privilege `tech`/`office` could hit. Roles: owner, admin, general_manager, tech, sales, office.

2. **Input validation gaps** — POST/PATCH handlers that pass `req.body` straight to storage/SQL with no Zod/type validation. Focus on ones that could corrupt data or crash (NaN from Number(), missing required fields, type coercion). Note any raw string interpolation into SQL (injection risk) vs parameterized queries.

3. **Error handling** — handlers with no try/catch that call SQL/external APIs (Stripe, Anthropic, QuickBooks, Ramp) and could throw → 500/crash. Async routes that don't catch rejections.

4. **Data integrity** — deletes that orphan children (e.g. delete job leaves estimates/invoices/photos/drying_records dangling), missing FK cascade, missing UNIQUE constraints that allow dupes.

5. **Money/financial correctness** — invoice/payment/estimate math, supplement approvals, payout requests — anywhere a rounding or sign error or missing status check could cause wrong dollar amounts.

6. **Frontend holes** — pages that create data but still have NO edit AND NO delete (after the recent CRUD pass). Forms that submit without validation. Note orphaned pages (imported nowhere) only briefly.

7. **Anything else genuinely broken** — dead routes, TODO/FIXME/HACK markers indicating known-incomplete features, endpoints referenced by frontend that don't exist on backend (or vice versa), hardcoded secrets/keys in source.

## Route files to cover (ALL of them)
- server/routes.ts (5599 lines, main)
- server/routes_auth.ts
- server/routes_hr.ts (HR/payroll — high sensitivity)
- server/routes_aiagent.ts
- server/routes_marketing_ai.ts
- server/routes_presence.ts
- server/routes_ramp.ts (financial)
- server/routes_routeplanner.ts
- server/routes_suite4.ts, routes_suite5.ts, routes_suite6.ts
- server/storage.ts
- server/routes_crud_gaps.ts
- client/src/pages/*.tsx (147 pages) — spot-check for missing CRUD & unvalidated forms

## Method
Use grep aggressively. For each category, produce a ranked list: **SEVERITY (BLOCK/HIGH/MED/LOW) — file:line — one-line description — concrete fix**. Do NOT run `npm run build`. Do NOT modify any files. Do NOT seed data. This is READ-ONLY analysis.

## Output
Write your full findings to `/home/user/workspace/AUDIT_FINDINGS.md` with the ranked lists per category, and a top-of-file "TOP 10 MOST IMPORTANT HOLES" summary. Then return a concise summary (the top 10) as your final message.
