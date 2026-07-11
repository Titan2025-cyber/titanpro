// ─────────────────────────────────────────────────────────────────────────────
// Team Presence & Activity Tracking (OWNER-ONLY reporting)
//
// Additive module. Every signed-in staff member's browser sends a lightweight
// heartbeat every ~30s while the Titan Pro tab is open. Each heartbeat reports:
//   - whether the tab is currently open + focused ("open" time), and
//   - whether the user has interacted recently ("active" time).
//
// The server accumulates two independent second-counters per session:
//   - open_seconds:   time the app tab was open & focused
//   - active_seconds: time the user was actually interacting (click/type/nav)
//
// Reporting endpoints (/live and /totals) are gated to role === "owner" ONLY.
// General managers, admins, and techs CANNOT see this data at all — by design.
// The heartbeat endpoint itself is open to any authenticated staff member so
// their own activity can be recorded.
// ─────────────────────────────────────────────────────────────────────────────
import type { Express, Request, Response, NextFunction } from "express";
import type Database from "better-sqlite3";
import { makeAuthMiddleware } from "./routes_auth";

// A heartbeat is considered "continuous" with the previous one if it arrives
// within this many seconds. Larger gaps mean the tab was closed/asleep, so we
// do NOT credit the gap as open/active time — we start a fresh accounting point.
const MAX_GAP_SECONDS = 90;

// If the client hasn't reported interaction within this window, we treat the
// user as merely "open" (idle), not "active".
const LIVE_ONLINE_WINDOW_SECONDS = 75;   // seen within this window => online
const LIVE_ACTIVE_WINDOW_SECONDS = 120;  // interacted within this window => active

function todayKey(d = new Date()): string {
  // Local calendar day in ISO (YYYY-MM-DD). Server runs in the deploy TZ; totals
  // are grouped by this day string.
  return d.toISOString().slice(0, 10);
}

export function registerPresenceRoutes(app: Express, sqlite: Database.Database) {
  const { requireStaffAuth, requireRole } = makeAuthMiddleware(sqlite);

  // ── Tables (additive; safe to run repeatedly) ─────────────────────────────
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS presence_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      employee_name TEXT,
      day TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_active_at TEXT,
      open_seconds INTEGER NOT NULL DEFAULT 0,
      active_seconds INTEGER NOT NULL DEFAULT 0
    )
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_presence_emp_day ON presence_sessions(employee_id, day)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_presence_lastseen ON presence_sessions(last_seen_at)`);

  // ── Heartbeat (any authenticated staff) ───────────────────────────────────
  // Body: { active: boolean, focused: boolean }
  //   active  = user interacted since the last heartbeat (click/keypress/nav)
  //   focused = the tab is currently open & focused (counts toward open time)
  // Strategy: find the employee's most recent OPEN session for today. If its
  // last_seen is within MAX_GAP_SECONDS, extend it (credit the elapsed time).
  // Otherwise open a new session row.
  app.post("/api/presence/heartbeat", requireStaffAuth, (req: Request, res: Response) => {
    try {
      const emp = (req as any).employee;
      const now = new Date();
      const nowIso = now.toISOString();
      const day = todayKey(now);
      const focused = req.body?.focused !== false; // default true
      const active = req.body?.active === true;

      const last: any = sqlite.prepare(
        `SELECT * FROM presence_sessions WHERE employee_id = ? AND day = ? ORDER BY last_seen_at DESC LIMIT 1`
      ).get(emp.id, day);

      if (last) {
        const gapSec = Math.round((now.getTime() - new Date(last.last_seen_at).getTime()) / 1000);
        if (gapSec >= 0 && gapSec <= MAX_GAP_SECONDS) {
          // Continuous with previous heartbeat — credit the elapsed gap.
          const addOpen = focused ? gapSec : 0;
          // Active time is only credited when the user is BOTH focused and had
          // recent interaction for this interval.
          const addActive = focused && active ? gapSec : 0;
          sqlite.prepare(
            `UPDATE presence_sessions
             SET last_seen_at = ?, last_active_at = ?, open_seconds = open_seconds + ?, active_seconds = active_seconds + ?
             WHERE id = ?`
          ).run(
            nowIso,
            active ? nowIso : last.last_active_at,
            addOpen,
            addActive,
            last.id
          );
          return res.json({ ok: true, sessionId: last.id });
        }
      }

      // No recent session — start a new one.
      const info = sqlite.prepare(
        `INSERT INTO presence_sessions (employee_id, employee_name, day, started_at, last_seen_at, last_active_at, open_seconds, active_seconds)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0)`
      ).run(emp.id, emp.name, day, nowIso, nowIso, active ? nowIso : null);
      return res.json({ ok: true, sessionId: info.lastInsertRowid });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // ── OWNER-ONLY: live presence — who is online / active right now ──────────
  app.get("/api/presence/live", requireRole("owner"), (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      // Consider all active employees; join their most recent heartbeat.
      const rows: any[] = sqlite.prepare(`
        SELECT e.id, e.name, e.role, e.position,
               p.last_seen_at, p.last_active_at, p.open_seconds, p.active_seconds, p.started_at
        FROM employees e
        LEFT JOIN (
          SELECT ps.* FROM presence_sessions ps
          INNER JOIN (
            SELECT employee_id, MAX(last_seen_at) AS mx
            FROM presence_sessions GROUP BY employee_id
          ) latest ON latest.employee_id = ps.employee_id AND latest.mx = ps.last_seen_at
        ) p ON p.employee_id = e.id
        WHERE e.is_active = 1
        ORDER BY (p.last_seen_at IS NULL), p.last_seen_at DESC, e.name ASC
      `).all();

      const people = rows.map(r => {
        const lastSeenMs = r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0;
        const lastActiveMs = r.last_active_at ? new Date(r.last_active_at).getTime() : 0;
        const secSinceSeen = lastSeenMs ? Math.round((now - lastSeenMs) / 1000) : null;
        const secSinceActive = lastActiveMs ? Math.round((now - lastActiveMs) / 1000) : null;
        let status: "active" | "idle" | "offline" = "offline";
        if (secSinceSeen !== null && secSinceSeen <= LIVE_ONLINE_WINDOW_SECONDS) {
          status = (secSinceActive !== null && secSinceActive <= LIVE_ACTIVE_WINDOW_SECONDS)
            ? "active" : "idle";
        }
        return {
          id: r.id,
          name: r.name,
          role: r.role,
          position: r.position || null,
          status,
          lastSeenAt: r.last_seen_at || null,
          secondsSinceSeen: secSinceSeen,
          // Current session running totals (today's most recent session)
          currentSessionOpenSeconds: r.open_seconds || 0,
          currentSessionActiveSeconds: r.active_seconds || 0,
          currentSessionStartedAt: r.started_at || null,
        };
      });
      return res.json({ now: new Date().toISOString(), people });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // ── OWNER-ONLY: daily + weekly totals per user ────────────────────────────
  // Returns, for each active employee: today's totals and the last-7-days totals
  // (open + active seconds), plus a per-day breakdown for the past 7 days.
  app.get("/api/presence/totals", requireRole("owner"), (_req: Request, res: Response) => {
    try {
      const now = new Date();
      const today = todayKey(now);
      // Week window: last 7 calendar days including today.
      const weekStart = new Date(now.getTime() - 6 * 24 * 3600 * 1000);
      const weekStartKey = todayKey(weekStart);

      const emps: any[] = sqlite.prepare(
        `SELECT id, name, role, position FROM employees WHERE is_active = 1 ORDER BY name ASC`
      ).all();

      const todayAgg = sqlite.prepare(
        `SELECT employee_id, SUM(open_seconds) AS open_s, SUM(active_seconds) AS active_s
         FROM presence_sessions WHERE day = ? GROUP BY employee_id`
      ).all(today) as any[];
      const todayMap = new Map(todayAgg.map(r => [r.employee_id, r]));

      const weekAgg = sqlite.prepare(
        `SELECT employee_id, SUM(open_seconds) AS open_s, SUM(active_seconds) AS active_s
         FROM presence_sessions WHERE day >= ? GROUP BY employee_id`
      ).all(weekStartKey) as any[];
      const weekMap = new Map(weekAgg.map(r => [r.employee_id, r]));

      // Per-day breakdown for the week.
      const perDay = sqlite.prepare(
        `SELECT employee_id, day, SUM(open_seconds) AS open_s, SUM(active_seconds) AS active_s
         FROM presence_sessions WHERE day >= ? GROUP BY employee_id, day`
      ).all(weekStartKey) as any[];
      const perDayMap = new Map<number, Record<string, { open: number; active: number }>>();
      for (const r of perDay) {
        if (!perDayMap.has(r.employee_id)) perDayMap.set(r.employee_id, {});
        perDayMap.get(r.employee_id)![r.day] = { open: r.open_s || 0, active: r.active_s || 0 };
      }

      // Build ordered list of the 7 day keys.
      const days: string[] = [];
      for (let i = 6; i >= 0; i--) {
        days.push(todayKey(new Date(now.getTime() - i * 24 * 3600 * 1000)));
      }

      const people = emps.map(e => {
        const t = todayMap.get(e.id);
        const w = weekMap.get(e.id);
        const pd = perDayMap.get(e.id) || {};
        return {
          id: e.id,
          name: e.name,
          role: e.role,
          position: e.position || null,
          today: { openSeconds: t?.open_s || 0, activeSeconds: t?.active_s || 0 },
          week: { openSeconds: w?.open_s || 0, activeSeconds: w?.active_s || 0 },
          perDay: days.map(d => ({ day: d, openSeconds: pd[d]?.open || 0, activeSeconds: pd[d]?.active || 0 })),
        };
      });

      return res.json({ today, weekStart: weekStartKey, days, people });
    } catch (e: any) {
      return res.status(500).json({ error: String(e?.message || e) });
    }
  });
}
