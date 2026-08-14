import type { Express, Request, Response, NextFunction } from "express";
import type { Database } from "better-sqlite3";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { encryptField, decryptField } from "./encryption";
import {
  generateSecret, buildOtpauthUrl, buildQrDataUrl, verifyTotp,
  generateBackupCodes, hashBackupCodes, matchBackupCode,
} from "./twofactor";

// ── Role Permission Matrix ────────────────────────────────────────────────────
// Each role has a set of permission keys it grants by default.
// The employee's `permissions` JSON can add extra grants (+key) or deny (-key).

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: [
    // Owner sees and does everything
    "dashboard", "jobs", "jobs:write", "estimates", "estimates:write",
    "invoices", "invoices:write", "payments", "payments:write",
    "contacts", "contacts:write", "photos", "scheduling", "scheduling:write",
    "technician", "messaging", "email", "marketing", "marketing:write",
    "equipment", "equipment:write", "job-costing", "supplements",
    "partner-portal", "partner-portal:write", "customer-portal",
    "safety", "certifications", "follow-ups", "reports", "reports:advanced",
    "activity-log", "sms", "time-clock", "settings", "user-management",
    "route-planner", "business-dev", "finance",
    "weekly-billing", // owner-only executive report
    "ai-agent", // AI Agent Center (owner + general manager)
    "hr", // HR Management Module + AI HR Assistant
  ],
  general_manager: [
    // General Manager — operational oversight + AI Agent Center
    "dashboard", "jobs", "jobs:write", "estimates", "estimates:write",
    "invoices", "payments", "contacts", "contacts:write", "photos",
    "scheduling", "scheduling:write", "technician", "messaging", "email",
    "marketing", "equipment", "job-costing", "supplements",
    "partner-portal", "customer-portal", "safety", "certifications",
    "follow-ups", "reports", "reports:advanced", "activity-log", "sms",
    "time-clock", "route-planner", "business-dev",
    "ai-agent", // AI Agent Center
    "hr", // HR Management Module + AI HR Assistant
  ],
  admin: [
    "dashboard", "jobs", "jobs:write", "estimates", "estimates:write",
    "invoices", "invoices:write", "payments", "payments:write",
    "contacts", "contacts:write", "photos", "scheduling", "scheduling:write",
    "technician", "messaging", "email", "marketing",
    "equipment", "equipment:write", "job-costing", "supplements",
    "partner-portal", "customer-portal",
    "safety", "certifications", "follow-ups", "reports", "reports:advanced",
    "activity-log", "sms", "time-clock",
    "route-planner", "business-dev", "finance",
    "hr", // HR Management Module + AI HR Assistant
  ],
  tech: [
    // Field technicians — job/field data + field estimating
    "jobs", "photos", "technician", "scheduling", "messaging",
    "equipment", "safety", "time-clock", "certifications",
    "customer-portal",
    // Field estimating: techs can build/write estimates on site
    "estimates", "estimates:write",
  ],
  sales: [
    // Sales / Business Development
    "dashboard", "jobs", "jobs:write", "estimates", "estimates:write",
    "contacts", "contacts:write", "photos", "scheduling",
    "marketing", "marketing:write", "follow-ups",
    "partner-portal", "customer-portal",
    "route-planner", "business-dev", "activity-log", "sms", "messaging",
    "reports",
  ],
  office: [
    // Office / Finance staff
    "dashboard", "jobs", "estimates", "invoices", "invoices:write",
    "payments", "payments:write", "contacts", "contacts:write",
    "partner-portal", "customer-portal", "follow-ups",
    "reports", "reports:advanced", "finance", "job-costing",
    "messaging", "email", "activity-log",
  ],
};

// ── Password hashing ──────────────────────────────────────────────────────────
// Passwords are hashed with bcrypt (per-user salt, adaptive work factor). This is
// the modern standard: slow-by-design so stolen hashes can't be brute-forced.
//
// Backward compatibility: earlier builds stored an unsalted SHA-256 hash. We keep
// a legacy verifier so existing accounts still log in, then transparently upgrade
// their stored hash to bcrypt on the next successful login (see maybeUpgradeHash).
const BCRYPT_ROUNDS = 12;
const LEGACY_SALT = "titan_pro_salt_2026";

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

function legacySha256(password: string): string {
  return crypto.createHash("sha256").update(password + LEGACY_SALT).digest("hex");
}

function isBcryptHash(hash: string): boolean {
  return typeof hash === "string" && /^\$2[aby]\$/.test(hash);
}

function verifyPassword(password: string, hash: string): boolean {
  if (!hash) return false;
  if (isBcryptHash(hash)) {
    try { return bcrypt.compareSync(password, hash); } catch { return false; }
  }
  // Legacy SHA-256 hash — constant-time compare to avoid timing leaks.
  const a = Buffer.from(legacySha256(password));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// If a user authenticated against a legacy SHA-256 hash, silently re-store it as
// bcrypt so the weak hash disappears from the database over time.
function maybeUpgradeHash(sqlite: any, column: "password_hash" | "pin", empId: number, plaintext: string, currentHash: string) {
  if (currentHash && !isBcryptHash(currentHash)) {
    try {
      sqlite.prepare(`UPDATE employees SET ${column} = ? WHERE id = ?`).run(hashPassword(plaintext), empId);
    } catch { /* non-fatal */ }
  }
}

// ── Password strength policy ────────────────────────────────────────────────
// Enforced server-side on every password change / create. Min 8 chars with a
// mix of letters and numbers. (PINs are exempt — they are short numeric codes.)
export function validatePasswordStrength(pw: string): string | null {
  if (typeof pw !== "string" || pw.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(pw)) return "Password must contain at least one letter.";
  if (!/[0-9]/.test(pw)) return "Password must contain at least one number.";
  if (pw.length > 200) return "Password is too long.";
  return null;
}

// ── PIN strength policy ───────────────────────────────────────────────────
// PINs guard the fast field-tech login on shared tablets. To keep them hard to
// guess from the public internet we require 6–8 digits and reject obvious
// patterns (repeats, sequences, and a small blocklist of lazy PINs).
const WEAK_PIN_BLOCKLIST = new Set([
  "121212", "123123", "112233", "101010", "123321", "696969", "420420", "654321",
]);

export function validatePinStrength(pin: string): string | null {
  const s = (pin ?? "").toString();
  if (!/^\d+$/.test(s)) return "PIN must contain digits only.";
  if (s.length < 6) return "PIN must be at least 6 digits.";
  if (s.length > 8) return "PIN must be at most 8 digits.";

  const generic = "PIN cannot be a repeated or sequential pattern. Please choose a less predictable PIN.";

  if (WEAK_PIN_BLOCKLIST.has(s)) return generic;

  // Single repeated digit: 000000, 1111111, …
  if (/^(\d)\1+$/.test(s)) return generic;

  // Repeated block of length 1–4 that evenly divides the PIN: 121212, 123123, 12341234…
  const n = s.length;
  for (let blk = 1; blk <= 4; blk++) {
    if (blk < n && n % blk === 0 && s.slice(0, blk).repeat(n / blk) === s) return generic;
  }

  // Purely sequential ascending or descending, step 1, wrapping 0↔9.
  const isSequential = (dir: number) => {
    for (let i = 1; i < n; i++) {
      const prev = s.charCodeAt(i - 1) - 48;
      const cur = s.charCodeAt(i) - 48;
      if (cur !== (prev + dir + 10) % 10) return false;
    }
    return true;
  };
  if (isSequential(1) || isSequential(-1)) return generic;

  return null;
}

// Generate a random 6-digit PIN that passes validatePinStrength. Used for
// seeded/admin-created accounts so no two accounts share a predictable default.
function generateCompliantPin(): string {
  for (let i = 0; i < 1000; i++) {
    const pin = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    if (validatePinStrength(pin) === null) return pin;
  }
  return "529174"; // known-compliant fallback (should never be reached)
}

// ── Session auth middleware ─────────────────────────────────────────────────
// requireStaffAuth: any valid, non-expired staff session. Attaches req.employee.
// requireRole(...roles): must also hold one of the given roles.
export function makeAuthMiddleware(sqlite: Database) {
  function requireStaffAuth(req: Request, res: Response, next: NextFunction) {
    const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ error: "Authentication required." });
    const session: any = sqlite.prepare(
      "SELECT * FROM staff_sessions WHERE session_token = ? AND expires_at > ?"
    ).get(token, new Date().toISOString());
    if (!session) return res.status(401).json({ error: "Session expired. Please sign in again." });
    const emp: any = sqlite.prepare("SELECT id, name, role, permissions FROM employees WHERE id = ? AND is_active = 1").get(session.employee_id);
    if (!emp) return res.status(401).json({ error: "Account disabled." });
    (req as any).employee = emp;
    next();
  }
  function requireRole(...roles: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
      requireStaffAuth(req, res, () => {
        const emp = (req as any).employee;
        if (!emp || !roles.includes(emp.role)) return res.status(403).json({ error: "You do not have permission to do this." });
        next();
      });
    };
  }
  return { requireStaffAuth, requireRole };
}

// ── Audit log helper ─────────────────────────────────────────────────────────
export function writeAudit(sqlite: any, employeeId: number | null, employeeName: string | null, action: string, entity: string | null, entityId: string | number | null, detail?: string, ip?: string) {
  try {
    sqlite.prepare(
      "INSERT INTO audit_log (employee_id, employee_name, action, entity, entity_id, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(employeeId, employeeName, action, entity, entityId !== undefined ? String(entityId) : null, detail || null, ip || null, new Date().toISOString());
  } catch (_) { /* never let audit log crash the request */ }
}

function resolvePermissions(role: string, extraJson: string): Set<string> {
  const base = new Set(ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.tech);
  try {
    const extra: string[] = JSON.parse(extraJson || "[]");
    for (const p of extra) {
      if (p.startsWith("-")) base.delete(p.slice(1));
      else base.add(p);
    }
  } catch { /* ignore */ }
  return base;
}

export function registerAuthRoutes(app: Express, sqlite: Database) {
  const { requireStaffAuth, requireRole } = makeAuthMiddleware(sqlite);

  // ── Ensure tables exist ───────────────────────────────────────────────────
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS staff_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      session_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT ''
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_name TEXT NOT NULL,
      ip TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      attempted_at TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER,
      employee_name TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      detail TEXT,
      ip TEXT,
      created_at TEXT NOT NULL
    )
  `);

  // Add new auth columns to employees if they don't exist (safe migration)
  const cols = (sqlite.prepare("PRAGMA table_info(employees)").all() as any[]).map(c => c.name);
  if (!cols.includes("password_hash")) sqlite.exec("ALTER TABLE employees ADD COLUMN password_hash TEXT");
  if (!cols.includes("pin")) sqlite.exec("ALTER TABLE employees ADD COLUMN pin TEXT");
  if (!cols.includes("permissions")) sqlite.exec("ALTER TABLE employees ADD COLUMN permissions TEXT DEFAULT '[]'");
  if (!cols.includes("is_active")) sqlite.exec("ALTER TABLE employees ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
  if (!cols.includes("last_login_at")) sqlite.exec("ALTER TABLE employees ADD COLUMN last_login_at TEXT");
  if (!cols.includes("position")) sqlite.exec("ALTER TABLE employees ADD COLUMN position TEXT");
  if (!cols.includes("avatar_initials")) sqlite.exec("ALTER TABLE employees ADD COLUMN avatar_initials TEXT");
  // Gmail OAuth integration columns (per-employee live Gmail connection).
  if (!cols.includes("gmail_refresh_token")) sqlite.exec("ALTER TABLE employees ADD COLUMN gmail_refresh_token TEXT");
  if (!cols.includes("gmail_access_token")) sqlite.exec("ALTER TABLE employees ADD COLUMN gmail_access_token TEXT");
  if (!cols.includes("gmail_token_expiry")) sqlite.exec("ALTER TABLE employees ADD COLUMN gmail_token_expiry TEXT");
  if (!cols.includes("gmail_connected")) sqlite.exec("ALTER TABLE employees ADD COLUMN gmail_connected INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("gmail_connected_at")) sqlite.exec("ALTER TABLE employees ADD COLUMN gmail_connected_at TEXT");
  // ── Two-factor authentication columns ──
  if (!cols.includes("totp_secret")) sqlite.exec("ALTER TABLE employees ADD COLUMN totp_secret TEXT");
  if (!cols.includes("totp_enabled")) sqlite.exec("ALTER TABLE employees ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("totp_enrolled_at")) sqlite.exec("ALTER TABLE employees ADD COLUMN totp_enrolled_at TEXT");
  if (!cols.includes("backup_codes")) sqlite.exec("ALTER TABLE employees ADD COLUMN backup_codes TEXT");
  // ── PIN hardening ──
  // must_change_pin forces a compliant-PIN reset on next PIN login. When the
  // column is first created we backfill every account that has a PIN, because
  // all pre-existing PINs are legacy sub-6-digit defaults (e.g. "1234").
  if (!cols.includes("must_change_pin")) {
    sqlite.exec("ALTER TABLE employees ADD COLUMN must_change_pin INTEGER NOT NULL DEFAULT 0");
    sqlite.prepare("UPDATE employees SET must_change_pin = 1 WHERE pin IS NOT NULL").run();
  }

  // Trusted devices — "remember this device for 30 days" tokens
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS trusted_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      device_token TEXT NOT NULL UNIQUE,
      label TEXT,
      ip TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);

  // Short-lived tokens issued between login steps.
  // type = 'setup' (forced 2FA enrollment, 10 min), 'challenge' (2FA code entry,
  // 5 min), or 'pin_change' (forced PIN reset after a stale-PIN login, 10 min).
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS pending_2fa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // ── Ensure canonical roster exists (idempotent, every boot) ──────────────
  // On some deployments the wider `seed()` in storage.ts is skipped because it
  // guards on the contacts table — which is populated — leaving `employees`
  // empty. That makes /api/auth/pin-users return [] and the Quick PIN kiosk
  // shows "no one is available." Insert only rows that don't already exist,
  // so this stays safe against a populated DB.
  //
  // Insert uses ONLY base columns (name, role, created_at) — the ones the
  // very first storage.ts CREATE TABLE guarantees. Everything else is set
  // via separate UPDATEs so a schema mismatch on any one column doesn't
  // abort the whole row. is_active defaults to 1 (from the ALTER TABLE
  // default) so newly inserted rows are already visible to the Quick PIN
  // picker.
  const CANONICAL_ROSTER: { name: string; role: string; position?: string | null; phone?: string | null; email?: string | null; }[] = [
    { name: "Cody Brantley",    role: "owner", position: "Owner",         phone: "706-922-0154", email: "cody@titanaugusta.com" },
    { name: "John",             role: "tech",  position: "Field Tech" },
    { name: "Clint",            role: "tech",  position: "Field Tech" },
    { name: "Blake",            role: "admin", position: "Admin" },
    { name: "Miranda Brantley", role: "sales", position: "Sales / BDM" },
  ];
  const rosterCheck = sqlite.prepare("SELECT id, is_active FROM employees WHERE LOWER(name) = LOWER(?)");
  const rosterNow = new Date().toISOString();

  // Diagnostic snapshot of the employees schema so we can see, in the logs,
  // exactly which columns exist when this block runs.
  try {
    const schemaCols = (sqlite.prepare("PRAGMA table_info(employees)").all() as any[]).map(c => c.name);
    const preCount: any = sqlite.prepare("SELECT COUNT(*) AS n FROM employees WHERE is_active = 1").get();
    console.log(`[auth] roster ensure starting — employees columns: ${schemaCols.join(",")}; active count: ${preCount?.n ?? "?"}`);
  } catch (e: any) {
    console.warn(`[auth] roster ensure — could not read schema: ${e?.message || e}`);
  }

  const trySetColumn = (id: number, name: string, col: string, val: any) => {
    try {
      sqlite.prepare(`UPDATE employees SET ${col} = ? WHERE id = ?`).run(val, id);
    } catch (e: any) {
      console.warn(`[auth] roster ${name}: could not set ${col}: ${e?.message || e}`);
    }
  };

  let insertedCount = 0;
  let reactivatedCount = 0;
  for (const r of CANONICAL_ROSTER) {
    try {
      const found: any = rosterCheck.get(r.name);
      if (!found) {
        // Minimal INSERT that only relies on the base CREATE TABLE columns
        // in storage.ts (name, role, created_at). All other fields go via
        // best-effort UPDATEs so one bad column can't break the row.
        let insertedId: number | null = null;
        try {
          const info = sqlite.prepare(
            "INSERT INTO employees (name, role, created_at) VALUES (?, ?, ?)"
          ).run(r.name, r.role, rosterNow);
          insertedId = Number(info.lastInsertRowid);
          insertedCount++;
          console.log(`[auth] roster inserted ${r.name} (id=${insertedId})`);
        } catch (e: any) {
          console.error(`[auth] roster INSERT FAILED for ${r.name}: ${e?.message || e}`);
          continue;
        }
        // Best-effort fill in the extra columns individually.
        trySetColumn(insertedId, r.name, "is_active", 1);
        if (r.position != null) trySetColumn(insertedId, r.name, "position", r.position);
        if (r.phone != null)    trySetColumn(insertedId, r.name, "phone", r.phone);
        if (r.email != null)    trySetColumn(insertedId, r.name, "gmail_email", r.email);
        // Precompute avatar_initials so the picker renders even before the
        // first login. (buildEmployeePayload falls back to name letters, but
        // pin-users reads avatar_initials directly.)
        const initials = r.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
        trySetColumn(insertedId, r.name, "avatar_initials", initials);
        try {
          writeAudit(sqlite, null, r.name, "roster_ensured", "employee", insertedId, `Canonical roster row inserted for ${r.name}`);
        } catch { /* audit is best-effort */ }
      } else if (!found.is_active) {
        try {
          sqlite.prepare("UPDATE employees SET is_active = 1 WHERE id = ?").run(found.id);
          reactivatedCount++;
          console.log(`[auth] roster reactivated ${r.name} (id=${found.id})`);
          writeAudit(sqlite, found.id, r.name, "roster_reactivated", "employee", found.id, `Reactivated ${r.name} via roster ensure`);
        } catch (e: any) {
          console.warn(`[auth] roster reactivate failed for ${r.name}: ${e?.message || e}`);
        }
      }
    } catch (e: any) {
      console.warn(`[auth] roster loop error for ${r.name}: ${e?.message || e}`);
    }
  }

  try {
    const postCount: any = sqlite.prepare("SELECT COUNT(*) AS n FROM employees WHERE is_active = 1").get();
    console.log(`[auth] roster ensure done — inserted=${insertedCount} reactivated=${reactivatedCount} active_now=${postCount?.n ?? "?"}`);
  } catch { /* logging only */ }

  // Seed default credentials for existing employees.
  // Owner: "admin1234", Techs: "titan1234" — must be changed on first login.
  // PINs: a unique random compliant PIN per user, recorded to the audit log
  // (action "pin_default_generated") so an owner can look it up and distribute
  // it. Every seeded account is flagged must_change_pin = 1.
  const existing: any[] = sqlite.prepare("SELECT * FROM employees WHERE password_hash IS NULL").all();
  for (const emp of existing) {
    const defaultPw = emp.role === "owner" ? "admin1234" : "titan1234";
    const hash = hashPassword(defaultPw);
    const initialPin = generateCompliantPin();
    sqlite.prepare("UPDATE employees SET password_hash = ?, pin = ?, must_change_pin = 1 WHERE id = ?")
      .run(hash, hashPassword(initialPin), emp.id);
    writeAudit(sqlite, emp.id, emp.name, "pin_default_generated", "employee", emp.id,
      `Initial PIN for ${emp.name}: ${initialPin}`, null);
  }

  // ── 2FA / session helpers ─────────────────────────────────────────────────
  const clientIp = (req: Request) =>
    ((req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "").toString();

  function buildEmployeePayload(emp: any) {
    return {
      id: emp.id, name: emp.name, role: emp.role, position: emp.position,
      gmailEmail: emp.gmail_email, phone: emp.phone,
      avatarInitials: emp.avatar_initials || emp.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2),
      permissions: Array.from(resolvePermissions(emp.role, emp.permissions || "[]")),
    };
  }

  // Issue a full 8h staff session and return the token + employee payload.
  function issueSession(emp: any, ip: string, method: string) {
    const now = new Date().toISOString();
    const token = crypto.randomBytes(40).toString("hex");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    sqlite.prepare(
      "INSERT INTO staff_sessions (employee_id, session_token, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).run(emp.id, token, expiresAt, now);
    sqlite.prepare("UPDATE employees SET last_login_at = ? WHERE id = ?").run(now, emp.id);
    sqlite.prepare("DELETE FROM login_attempts WHERE employee_name = ? AND success = 0").run(emp.name);
    sqlite.prepare("INSERT INTO login_attempts (employee_name, ip, success, attempted_at) VALUES (?, ?, 1, ?)").run(emp.name, ip, now);
    writeAudit(sqlite, emp.id, emp.name, "login_success", "auth", null, `Logged in via ${method}`, ip);
    return { token, employee: buildEmployeePayload(emp) };
  }

  // 5-in-15-minutes lockout, shared by password and 2FA-code verification.
  function isLockedOut(employeeName: string): boolean {
    const window = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const row: any = sqlite.prepare(
      "SELECT COUNT(*) as cnt FROM login_attempts WHERE employee_name = ? AND success = 0 AND attempted_at > ?"
    ).get(employeeName, window);
    return (row?.cnt || 0) >= 5;
  }
  function recordFail(employeeName: string, ip: string) {
    sqlite.prepare("INSERT INTO login_attempts (employee_name, ip, success, attempted_at) VALUES (?, ?, 0, ?)")
      .run(employeeName, ip, new Date().toISOString());
  }

  // Short-lived tokens between login steps. Prunes expired rows on each call.
  function makePendingToken(employeeId: number, type: "setup" | "challenge" | "pin_change", minutes: number): string {
    const now = new Date().toISOString();
    sqlite.prepare("DELETE FROM pending_2fa WHERE expires_at < ?").run(now);
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    sqlite.prepare(
      "INSERT INTO pending_2fa (employee_id, token, type, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(employeeId, token, type, expiresAt, now);
    return token;
  }
  function resolvePending(token: string, type: "setup" | "challenge" | "pin_change"): any {
    if (!token) return null;
    return sqlite.prepare(
      "SELECT * FROM pending_2fa WHERE token = ? AND type = ? AND expires_at > ?"
    ).get(token, type, new Date().toISOString());
  }

  function findTrustedDevice(employeeId: number, token: string): any {
    if (!token) return null;
    return sqlite.prepare(
      "SELECT * FROM trusted_devices WHERE employee_id = ? AND device_token = ? AND expires_at > ?"
    ).get(employeeId, token, new Date().toISOString());
  }
  function createTrustedDevice(employeeId: number, ip: string, userAgent: string): string {
    const now = new Date().toISOString();
    const token = crypto.randomBytes(40).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const label = (userAgent || "Unknown device").toString().slice(0, 120);
    sqlite.prepare(
      "INSERT INTO trusted_devices (employee_id, device_token, label, ip, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(employeeId, token, label, ip, now, expiresAt);
    return token;
  }

  // Resolve the caller's employee from their session token (for authenticated 2FA routes).
  function sessionEmployee(req: Request): any {
    const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
    if (!token) return null;
    const session: any = sqlite.prepare(
      "SELECT * FROM staff_sessions WHERE session_token = ? AND expires_at > ?"
    ).get(token, new Date().toISOString());
    if (!session) return null;
    return sqlite.prepare("SELECT * FROM employees WHERE id = ? AND is_active = 1").get(session.employee_id);
  }

  // ── POST /api/auth/login ─────────────────────────────────────────────────
  app.post("/api/auth/login", (req, res) => {
    const { name, email, identifier, password, pin } = req.body;
    // Accept a single web-login "identifier" (email or name), or the legacy `name`/`email` fields.
    const rawId = (identifier || email || name || "").toString().trim();
    if (!rawId) return res.status(400).json({ error: "Email or name is required" });
    const ip = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "").toString();
    const now = new Date().toISOString();
    const lockoutWindow = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    // Look up by email (gmail_email) first, then fall back to full name.
    let emp: any = sqlite.prepare(
      "SELECT * FROM employees WHERE LOWER(gmail_email) = LOWER(?) AND is_active = 1"
    ).get(rawId);
    if (!emp) {
      emp = sqlite.prepare(
        "SELECT * FROM employees WHERE LOWER(name) = LOWER(?) AND is_active = 1"
      ).get(rawId);
    }

    if (!emp) {
      sqlite.prepare("INSERT INTO login_attempts (employee_name, ip, success, attempted_at) VALUES (?, ?, 0, ?)").run(rawId, ip, now);
      writeAudit(sqlite, null, rawId, "login_failed", "auth", null, `Employee not found: ${rawId}`, ip);
      return res.status(401).json({ error: "No account found for that email or name." });
    }

    // Lockout check: 5+ failed attempts in last 15 minutes
    const recentFails: any = sqlite.prepare(
      "SELECT COUNT(*) as cnt FROM login_attempts WHERE employee_name = ? AND success = 0 AND attempted_at > ?"
    ).get(emp.name, lockoutWindow);
    if ((recentFails?.cnt || 0) >= 5) {
      writeAudit(sqlite, emp.id, emp.name, "login_locked", "auth", null, `Account locked after 5 failed attempts`, ip);
      return res.status(429).json({ error: "Account temporarily locked. Too many failed attempts. Try again in 15 minutes." });
    }

    // Accept either password or PIN
    let authenticated = false;
    if (password) {
      authenticated = verifyPassword(password, emp.password_hash || "");
      if (authenticated) maybeUpgradeHash(sqlite, "password_hash", emp.id, password, emp.password_hash || "");
    } else if (pin) {
      authenticated = verifyPassword(pin, emp.pin || "");
      if (authenticated) maybeUpgradeHash(sqlite, "pin", emp.id, pin, emp.pin || "");
    }

    if (!authenticated) {
      sqlite.prepare("INSERT INTO login_attempts (employee_name, ip, success, attempted_at) VALUES (?, ?, 0, ?)").run(emp.name, ip, now);
      const failCount = ((recentFails?.cnt || 0) + 1);
      const remaining = 5 - failCount;
      writeAudit(sqlite, emp.id, emp.name, "login_failed", "auth", null, `Wrong credential. ${remaining} attempt(s) left before lockout.`, ip);
      return res.status(401).json({ error: `Incorrect password or PIN. ${remaining > 0 ? remaining + " attempt(s) remaining." : "Account will be locked."}` });
    }

    // Clear failed attempts on success
    sqlite.prepare("DELETE FROM login_attempts WHERE employee_name = ? AND success = 0").run(emp.name);

    // PIN logins (field techs on shared tablets) skip 2FA entirely — unchanged behavior.
    if (!password && pin) {
      // Stale/weak PIN → allow this one login but force a compliant reset before
      // issuing a real session. No full session token is returned yet.
      if (emp.must_change_pin) {
        const pinChangeToken = makePendingToken(emp.id, "pin_change", 10);
        writeAudit(sqlite, emp.id, emp.name, "pin_change_required", "auth", null, "PIN OK; forced PIN update required", ip);
        return res.json({ requiresPinChange: true, pinChangeToken });
      }
      return res.json(issueSession(emp, ip, "PIN"));
    }

    // ── Password login: enforce 2FA ──
    // No secret configured yet → force enrollment. Issue a 10-min setup token only.
    if (!emp.totp_enabled || !emp.totp_secret) {
      const setupToken = makePendingToken(emp.id, "setup", 10);
      writeAudit(sqlite, emp.id, emp.name, "2fa_setup_required", "auth", null, "Password OK; forced 2FA enrollment", ip);
      return res.json({ requires2FASetup: true, setupToken });
    }

    // 2FA enabled → honor a valid trusted-device token, otherwise challenge.
    const trustedToken = (req.body.trustedDeviceToken || req.headers["x-trusted-device"] || "").toString();
    if (trustedToken && findTrustedDevice(emp.id, trustedToken)) {
      writeAudit(sqlite, emp.id, emp.name, "login_trusted_device", "auth", null, "Skipped 2FA via trusted device", ip);
      return res.json(issueSession(emp, ip, "password + trusted device"));
    }

    const challengeToken = makePendingToken(emp.id, "challenge", 5);
    return res.json({ requires2FA: true, challengeToken });
  });

  // ── GET /api/auth/me ─────────────────────────────────────────────────────
  app.get("/api/auth/me", (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "No token" });

    const session: any = sqlite.prepare(
      "SELECT * FROM staff_sessions WHERE session_token = ? AND expires_at > ?"
    ).get(token, new Date().toISOString());
    if (!session) return res.status(401).json({ error: "Session expired" });

    const emp: any = sqlite.prepare("SELECT * FROM employees WHERE id = ? AND is_active = 1").get(session.employee_id);
    if (!emp) return res.status(401).json({ error: "Account disabled" });

    const permissions = Array.from(resolvePermissions(emp.role, emp.permissions || "[]"));
    let backupCodesRemaining = 0;
    try { backupCodesRemaining = (JSON.parse(emp.backup_codes || "[]") as string[]).length; } catch { /* ignore */ }
    res.json({
      id: emp.id, name: emp.name, role: emp.role, position: emp.position,
      gmailEmail: emp.gmail_email, phone: emp.phone,
      avatarInitials: emp.avatar_initials || emp.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2),
      permissions,
      twoFactorEnabled: !!emp.totp_enabled,
      twoFactorEnrolledAt: emp.totp_enrolled_at || null,
      backupCodesRemaining,
      mustChangePin: !!emp.must_change_pin,
    });
  });

  // ── POST /api/auth/logout ────────────────────────────────────────────────
  app.post("/api/auth/logout", (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (token) sqlite.prepare("DELETE FROM staff_sessions WHERE session_token = ?").run(token);
    res.json({ ok: true });
  });

  // ── POST /api/auth/change-password ───────────────────────────────────────
  app.post("/api/auth/change-password", (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const session: any = sqlite.prepare(
      "SELECT * FROM staff_sessions WHERE session_token = ? AND expires_at > ?"
    ).get(token, new Date().toISOString());
    if (!session) return res.status(401).json({ error: "Not authenticated" });

    const { currentPassword, newPassword, newPin, newEmail } = req.body;
    const emp: any = sqlite.prepare("SELECT * FROM employees WHERE id = ?").get(session.employee_id);

    if (currentPassword && !verifyPassword(currentPassword, emp.password_hash || "")) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    if (newPassword) {
      const err = validatePasswordStrength(newPassword);
      if (err) return res.status(400).json({ error: err });
    }
    if (newPin) {
      if (!/^\d{6,8}$/.test(String(newPin))) return res.status(400).json({ error: "PIN must be 6–8 digits." });
      const perr = validatePinStrength(String(newPin));
      if (perr) return res.status(400).json({ error: perr });
    }
    if (newEmail !== undefined && newEmail !== null && String(newEmail).trim() !== "") {
      const em = String(newEmail).trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
        return res.status(400).json({ error: "Enter a valid email address." });
      }
      const clash: any = sqlite.prepare(
        "SELECT id FROM employees WHERE LOWER(gmail_email) = LOWER(?) AND id != ?"
      ).get(em, emp.id);
      if (clash) return res.status(400).json({ error: "That email is already used by another account." });
    }

    const updates: any = {};
    if (newPassword) updates.password_hash = hashPassword(newPassword);
    if (newPin) updates.pin = hashPassword(newPin);
    if (newEmail !== undefined && newEmail !== null && String(newEmail).trim() !== "") {
      updates.gmail_email = String(newEmail).trim();
    }
    if (newPin) { updates.pin = hashPassword(newPin); updates.must_change_pin = 0; }

    if (Object.keys(updates).length > 0) {
      const setClause = Object.keys(updates).map(k => `${k} = ?`).join(", ");
      sqlite.prepare(`UPDATE employees SET ${setClause} WHERE id = ?`).run(...Object.values(updates), emp.id);
      writeAudit(sqlite, emp.id, emp.name, "self_credential_change", "auth", null,
        `Self-service update: ${Object.keys(updates).join(", ")}`, req.ip || "");
    }
    res.json({ ok: true });
  });

  // ── POST /api/auth/pin/change-forced ─────────────────────────────────────
  // Completes the forced-PIN-change step from a stale-PIN login. Validates the
  // short-lived token, enforces the new PIN rules, clears must_change_pin, and
  // issues a full session — no existing session required.
  app.post("/api/auth/pin/change-forced", (req, res) => {
    const ip = clientIp(req);
    const pending = resolvePending((req.body.pinChangeToken || "").toString(), "pin_change");
    if (!pending) return res.status(401).json({ error: "PIN change session expired. Please sign in again." });
    const emp: any = sqlite.prepare("SELECT * FROM employees WHERE id = ? AND is_active = 1").get(pending.employee_id);
    if (!emp) return res.status(401).json({ error: "Account disabled." });

    const newPin = (req.body.newPin || "").toString();
    if (!/^\d{6,8}$/.test(newPin)) return res.status(400).json({ error: "PIN must be 6–8 digits." });
    const perr = validatePinStrength(newPin);
    if (perr) return res.status(400).json({ error: perr });

    sqlite.prepare("UPDATE employees SET pin = ?, must_change_pin = 0 WHERE id = ?").run(hashPassword(newPin), emp.id);
    sqlite.prepare("DELETE FROM pending_2fa WHERE employee_id = ? AND type = 'pin_change'").run(emp.id);
    writeAudit(sqlite, emp.id, emp.name, "pin_changed_forced", "auth", null, "Set a new compliant PIN (forced)", ip);
    res.json(issueSession(emp, ip, "PIN (forced change)"));
  });

  // ══ Two-Factor Authentication ═════════════════════════════════════════════

  // POST /api/auth/2fa/enroll/token — authenticated; mints a setup token for the
  // logged-in user. Used by the force-enrollment gate for users with a cached
  // session (from before 2FA was required) who have no 2FA configured yet.
  app.post("/api/auth/2fa/enroll/token", (req, res) => {
    const emp = sessionEmployee(req);
    if (!emp) return res.status(401).json({ error: "Not authenticated" });
    if (emp.totp_enabled) return res.status(400).json({ error: "2FA is already enabled." });
    const setupToken = makePendingToken(emp.id, "setup", 10);
    res.json({ setupToken });
  });

  // POST /api/auth/2fa/setup/start — generate a secret + QR for the enrollment screen.
  app.post("/api/auth/2fa/setup/start", async (req, res) => {
    const pending = resolvePending((req.body.setupToken || "").toString(), "setup");
    if (!pending) return res.status(401).json({ error: "Setup session expired. Please sign in again." });
    const emp: any = sqlite.prepare("SELECT * FROM employees WHERE id = ? AND is_active = 1").get(pending.employee_id);
    if (!emp) return res.status(401).json({ error: "Account disabled." });

    const secret = generateSecret();
    // Store encrypted, but keep totp_enabled = 0 until the code is verified.
    sqlite.prepare("UPDATE employees SET totp_secret = ?, totp_enabled = 0 WHERE id = ?")
      .run(encryptField(secret), emp.id);

    const accountName = emp.gmail_email || emp.name;
    const otpauthUrl = buildOtpauthUrl(accountName, secret);
    const qrDataUrl = await buildQrDataUrl(otpauthUrl);
    res.json({ secret, otpauthUrl, qrDataUrl });
  });

  // POST /api/auth/2fa/setup/verify — confirm the first code, enable 2FA, issue session + backup codes.
  app.post("/api/auth/2fa/setup/verify", (req, res) => {
    const ip = clientIp(req);
    const pending = resolvePending((req.body.setupToken || "").toString(), "setup");
    if (!pending) return res.status(401).json({ error: "Setup session expired. Please sign in again." });
    const emp: any = sqlite.prepare("SELECT * FROM employees WHERE id = ? AND is_active = 1").get(pending.employee_id);
    if (!emp) return res.status(401).json({ error: "Account disabled." });

    const secret = decryptField(emp.totp_secret);
    if (!secret) return res.status(400).json({ error: "No pending secret. Restart setup." });
    if (!verifyTotp((req.body.code || "").toString(), secret)) {
      return res.status(400).json({ error: "That code is incorrect. Check your authenticator app and try again." });
    }

    const backupCodes = generateBackupCodes();
    const now = new Date().toISOString();
    sqlite.prepare("UPDATE employees SET totp_enabled = 1, totp_enrolled_at = ?, backup_codes = ? WHERE id = ?")
      .run(now, JSON.stringify(hashBackupCodes(backupCodes)), emp.id);
    sqlite.prepare("DELETE FROM pending_2fa WHERE employee_id = ?").run(emp.id);
    writeAudit(sqlite, emp.id, emp.name, "2fa_enrolled", "auth", null, "Completed 2FA enrollment", ip);

    const session = issueSession(emp, ip, "password + 2FA enrollment");
    res.json({ ...session, backupCodes });
  });

  // POST /api/auth/2fa/verify — verify a TOTP or backup code at login.
  app.post("/api/auth/2fa/verify", (req, res) => {
    const ip = clientIp(req);
    const pending = resolvePending((req.body.challengeToken || "").toString(), "challenge");
    if (!pending) return res.status(401).json({ error: "Verification session expired. Please sign in again." });
    const emp: any = sqlite.prepare("SELECT * FROM employees WHERE id = ? AND is_active = 1").get(pending.employee_id);
    if (!emp) return res.status(401).json({ error: "Account disabled." });

    if (isLockedOut(emp.name)) {
      writeAudit(sqlite, emp.id, emp.name, "login_locked", "auth", null, "2FA lockout after 5 failed attempts", ip);
      return res.status(429).json({ error: "Too many failed attempts. Try again in 15 minutes." });
    }

    const code = (req.body.code || "").toString();
    const secret = decryptField(emp.totp_secret);
    let ok = false;
    let usedBackup = false;

    if (secret && verifyTotp(code, secret)) {
      ok = true;
    } else {
      // Fall back to a single-use backup code.
      let hashes: string[] = [];
      try { hashes = JSON.parse(emp.backup_codes || "[]"); } catch { hashes = []; }
      const idx = matchBackupCode(code, hashes);
      if (idx >= 0) {
        ok = true;
        usedBackup = true;
        hashes.splice(idx, 1); // consume the code
        sqlite.prepare("UPDATE employees SET backup_codes = ? WHERE id = ?").run(JSON.stringify(hashes), emp.id);
      }
    }

    if (!ok) {
      recordFail(emp.name, ip);
      writeAudit(sqlite, emp.id, emp.name, "2fa_failed", "auth", null, "Invalid 2FA code", ip);
      return res.status(401).json({ error: "Invalid code. Please try again." });
    }

    sqlite.prepare("DELETE FROM pending_2fa WHERE employee_id = ?").run(emp.id);
    writeAudit(sqlite, emp.id, emp.name, usedBackup ? "2fa_backup_code_used" : "2fa_verified", "auth", null,
      usedBackup ? "Logged in with a backup code" : "Passed 2FA challenge", ip);

    const session = issueSession(emp, ip, usedBackup ? "password + backup code" : "password + 2FA");
    let trustedDeviceToken: string | undefined;
    if (req.body.rememberDevice) {
      trustedDeviceToken = createTrustedDevice(emp.id, ip, (req.headers["user-agent"] || "").toString());
    }
    res.json({ ...session, trustedDeviceToken, usedBackup });
  });

  // POST /api/auth/2fa/disable — authenticated; requires current password + a valid TOTP code.
  app.post("/api/auth/2fa/disable", (req, res) => {
    const emp = sessionEmployee(req);
    if (!emp) return res.status(401).json({ error: "Not authenticated" });
    const ip = clientIp(req);
    const { currentPassword, code } = req.body;
    if (!verifyPassword((currentPassword || "").toString(), emp.password_hash || "")) {
      return res.status(400).json({ error: "Current password is incorrect." });
    }
    const secret = decryptField(emp.totp_secret);
    if (!emp.totp_enabled || !secret || !verifyTotp((code || "").toString(), secret)) {
      return res.status(400).json({ error: "A valid authenticator code is required." });
    }
    sqlite.prepare("UPDATE employees SET totp_secret = NULL, totp_enabled = 0, totp_enrolled_at = NULL, backup_codes = NULL WHERE id = ?").run(emp.id);
    sqlite.prepare("DELETE FROM trusted_devices WHERE employee_id = ?").run(emp.id);
    writeAudit(sqlite, emp.id, emp.name, "2fa_disabled", "auth", null, "User disabled 2FA (re-enrollment required)", ip);
    res.json({ ok: true });
  });

  // POST /api/auth/2fa/backup-codes/regenerate — authenticated; requires a current TOTP code.
  app.post("/api/auth/2fa/backup-codes/regenerate", (req, res) => {
    const emp = sessionEmployee(req);
    if (!emp) return res.status(401).json({ error: "Not authenticated" });
    const ip = clientIp(req);
    const secret = decryptField(emp.totp_secret);
    if (!emp.totp_enabled || !secret || !verifyTotp((req.body.code || "").toString(), secret)) {
      return res.status(400).json({ error: "A valid authenticator code is required." });
    }
    const backupCodes = generateBackupCodes();
    sqlite.prepare("UPDATE employees SET backup_codes = ? WHERE id = ?")
      .run(JSON.stringify(hashBackupCodes(backupCodes)), emp.id);
    writeAudit(sqlite, emp.id, emp.name, "2fa_backup_codes_regenerated", "auth", null, "Regenerated backup codes", ip);
    res.json({ backupCodes });
  });

  // GET /api/auth/2fa/trusted-devices — list the caller's trusted devices.
  app.get("/api/auth/2fa/trusted-devices", (req, res) => {
    const emp = sessionEmployee(req);
    if (!emp) return res.status(401).json({ error: "Not authenticated" });
    const rows: any[] = sqlite.prepare(
      "SELECT id, label, ip, created_at, expires_at FROM trusted_devices WHERE employee_id = ? AND expires_at > ? ORDER BY created_at DESC"
    ).all(emp.id, new Date().toISOString());
    res.json(rows.map(r => ({
      id: r.id, label: r.label, ip: r.ip, createdAt: r.created_at, expiresAt: r.expires_at,
    })));
  });

  // DELETE /api/auth/2fa/trusted-devices/:id — revoke one trusted device.
  app.delete("/api/auth/2fa/trusted-devices/:id", (req, res) => {
    const emp = sessionEmployee(req);
    if (!emp) return res.status(401).json({ error: "Not authenticated" });
    sqlite.prepare("DELETE FROM trusted_devices WHERE id = ? AND employee_id = ?").run(Number(req.params.id), emp.id);
    writeAudit(sqlite, emp.id, emp.name, "2fa_trusted_device_revoked", "auth", req.params.id, "Revoked a trusted device", clientIp(req));
    res.json({ ok: true });
  });

  // DELETE /api/auth/2fa/trusted-devices — revoke all of the caller's trusted devices.
  app.delete("/api/auth/2fa/trusted-devices", (req, res) => {
    const emp = sessionEmployee(req);
    if (!emp) return res.status(401).json({ error: "Not authenticated" });
    sqlite.prepare("DELETE FROM trusted_devices WHERE employee_id = ?").run(emp.id);
    writeAudit(sqlite, emp.id, emp.name, "2fa_trusted_devices_cleared", "auth", null, "Signed out of all trusted devices", clientIp(req));
    res.json({ ok: true });
  });

  // ── User Management (owner/admin only) ──────────────────────────────────

  // GET /api/auth/pin-users — UNAUTHENTICATED. Powers the Quick PIN login
  // kiosk on the sign-in page. Returns ONLY {name, avatarInitials} for active
  // employees so the picker mirrors User Management in real time; role, email,
  // phone, and 2FA state are intentionally omitted. Deactivating or deleting a
  // user in User Management removes them from this list instantly (both pages
  // share the invalidation).
  // Last-mile safety net: if the DB comes up with zero active employees
  // (a scenario we've hit on the hosted preview when a stale empty data.db is
  // preserved across redeploys), inline-seed the canonical roster on the FIRST
  // pin-users request so the kiosk never renders "no one is available." Every
  // subsequent request short-circuits normally.
  const inlineRosterSeed = () => {
    const roster: { name: string; role: string; position?: string; phone?: string; email?: string; }[] = [
      { name: "Cody Brantley",    role: "owner", position: "Owner",         phone: "706-922-0154", email: "cody@titanaugusta.com" },
      { name: "John",             role: "tech",  position: "Field Tech" },
      { name: "Clint",            role: "tech",  position: "Field Tech" },
      { name: "Blake",            role: "admin", position: "Admin" },
      { name: "Miranda Brantley", role: "sales", position: "Sales / BDM" },
    ];
    const now = new Date().toISOString();
    let inserted = 0;
    for (const r of roster) {
      try {
        const found: any = sqlite.prepare("SELECT id FROM employees WHERE LOWER(name) = LOWER(?)").get(r.name);
        let id: number;
        if (found) {
          id = found.id;
          try { sqlite.prepare("UPDATE employees SET is_active = 1 WHERE id = ?").run(id); } catch {}
        } else {
          const info = sqlite.prepare("INSERT INTO employees (name, role, created_at) VALUES (?, ?, ?)").run(r.name, r.role, now);
          id = Number(info.lastInsertRowid);
          inserted++;
        }
        try { sqlite.prepare("UPDATE employees SET is_active = 1 WHERE id = ?").run(id); } catch {}
        if (r.position) { try { sqlite.prepare("UPDATE employees SET position = ? WHERE id = ?").run(r.position, id); } catch {} }
        if (r.phone)    { try { sqlite.prepare("UPDATE employees SET phone = ? WHERE id = ?").run(r.phone, id); } catch {} }
        if (r.email)    { try { sqlite.prepare("UPDATE employees SET gmail_email = ? WHERE id = ?").run(r.email, id); } catch {} }
        const initials = r.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
        try { sqlite.prepare("UPDATE employees SET avatar_initials = ? WHERE id = ?").run(initials, id); } catch {}
      } catch (e: any) {
        console.warn(`[auth] inline roster seed failed for ${r.name}: ${e?.message || e}`);
      }
    }
    return inserted;
  };

  app.get("/api/auth/pin-users", (_req, res) => {
    let rows: any[] = sqlite.prepare(
      "SELECT name, avatar_initials FROM employees WHERE is_active = 1 ORDER BY name"
    ).all();
    if (rows.length === 0) {
      const inserted = inlineRosterSeed();
      console.log(`[auth] pin-users returned 0 rows — inline seeded ${inserted} row(s)`);
      rows = sqlite.prepare(
        "SELECT name, avatar_initials FROM employees WHERE is_active = 1 ORDER BY name"
      ).all();
    }
    res.json(rows.map(r => ({
      name: r.name,
      avatarInitials: r.avatar_initials || r.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2),
    })));
  });

  // GET /api/staff/assignable — lightweight list of ACTIVE users for assignment
  // dropdowns throughout the app. Any authenticated staff member may read it
  // (techs need it to see who's assignable too). Returns only non-sensitive
  // fields. Optional ?role=tech,sales filter (comma-separated) narrows by role.
  // The User Management "Active" toggle is the single control: inactive users
  // never appear here, so deactivating a user hides them app-wide instantly.
  app.get("/api/staff/assignable", requireStaffAuth, (req, res) => {
    const roleParam = String(req.query.role || "").trim();
    const rows: any[] = sqlite.prepare(
      "SELECT id, name, role, position, avatar_initials FROM employees WHERE is_active = 1 ORDER BY name"
    ).all();
    let list = rows.map(r => ({
      id: r.id,
      name: r.name,
      role: r.role,
      position: r.position || null,
      avatarInitials: r.avatar_initials || r.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2),
    }));
    if (roleParam) {
      const wanted = new Set(roleParam.split(",").map(s => s.trim()).filter(Boolean));
      // Owner and admin are always assignable regardless of the role filter,
      // since they can act in any capacity.
      list = list.filter(u => wanted.has(u.role) || u.role === "owner" || u.role === "admin");
    }
    res.json(list);
  });

  // GET /api/staff — list all employees (owner/admin only)
  app.get("/api/staff", requireRole("owner", "admin"), (req, res) => {
    const rows: any[] = sqlite.prepare("SELECT id, name, role, position, gmail_email, gmail_connected, gmail_connected_at, phone, is_active, last_login_at, permissions, avatar_initials, created_at, totp_enabled FROM employees ORDER BY id").all();
    res.json(rows.map(r => ({
      id: r.id, name: r.name, role: r.role, position: r.position,
      gmailEmail: r.gmail_email, gmailConnected: !!r.gmail_connected, gmailConnectedAt: r.gmail_connected_at,
      phone: r.phone, isActive: !!r.is_active,
      lastLoginAt: r.last_login_at, permissions: r.permissions || "[]",
      avatarInitials: r.avatar_initials || r.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2),
      createdAt: r.created_at,
      twoFactorEnabled: !!r.totp_enabled,
    })));
  });

  // POST /api/staff — create new employee (owner/admin only)
  app.post("/api/staff", requireRole("owner", "admin"), (req, res) => {
    const { name, role, position, phone, gmailEmail, password, pin, permissions } = req.body;
    if (!name || !role) return res.status(400).json({ error: "name and role are required" });
    if (!ROLE_PERMISSIONS[role]) return res.status(400).json({ error: "Invalid role." });
    if (password) {
      const err = validatePasswordStrength(password);
      if (err) return res.status(400).json({ error: err });
    }
    if (pin && !/^\d{4,8}$/.test(String(pin))) return res.status(400).json({ error: "PIN must be 4–8 digits." });
    if (gmailEmail && String(gmailEmail).trim()) {
      const em = String(gmailEmail).trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return res.status(400).json({ error: "Enter a valid email address." });
      const clash: any = sqlite.prepare("SELECT id FROM employees WHERE LOWER(gmail_email) = LOWER(?)").get(em);
      if (clash) return res.status(400).json({ error: "That email is already used by another account." });
    }
    if (pin) {
      if (!/^\d{6,8}$/.test(String(pin))) return res.status(400).json({ error: "PIN must be 6–8 digits." });
      const perr = validatePinStrength(String(pin));
      if (perr) return res.status(400).json({ error: perr });
    }
    const ip = clientIp(req);
    const requester = (req as any).employee;
    const now = new Date().toISOString();
    const pw = password || "titan1234";
    // Admin-set PINs are always temporary; if none is provided, generate a unique
    // compliant one and record it to the audit log so the owner can distribute it.
    const generatedPin = pin ? null : generateCompliantPin();
    const p = pin || generatedPin!;
    const result = sqlite.prepare(`
      INSERT INTO employees (name, role, position, phone, gmail_email, password_hash, pin, permissions, is_active, must_change_pin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
    `).run(name, role, position || null, phone || null, gmailEmail || null,
           hashPassword(pw), hashPassword(p),
           permissions || "[]", now);
    const emp: any = sqlite.prepare("SELECT * FROM employees WHERE id = ?").get(result.lastInsertRowid);
    if (generatedPin) {
      writeAudit(sqlite, requester?.id ?? null, requester?.name ?? null, "pin_default_generated", "employee", emp.id,
        `Initial PIN for ${emp.name}: ${generatedPin}`, ip);
    }
    res.status(201).json({ id: emp.id, name: emp.name, role: emp.role, position: emp.position });
  });

  // PATCH /api/staff/:id — update employee (owner/admin only)
  app.patch("/api/staff/:id", requireRole("owner", "admin"), (req, res) => {
    const id = Number(req.params.id);
    const { name, role, position, phone, gmailEmail, password, pin, permissions, isActive, avatarInitials } = req.body;
    const emp: any = sqlite.prepare("SELECT * FROM employees WHERE id = ?").get(id);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    if (password) {
      const err = validatePasswordStrength(password);
      if (err) return res.status(400).json({ error: err });
    }
    if (pin && !/^\d{4,8}$/.test(String(pin))) return res.status(400).json({ error: "PIN must be 4–8 digits." });
    if (gmailEmail && String(gmailEmail).trim()) {
      const em = String(gmailEmail).trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return res.status(400).json({ error: "Enter a valid email address." });
      const clash: any = sqlite.prepare("SELECT id FROM employees WHERE LOWER(gmail_email) = LOWER(?) AND id != ?").get(em, id);
      if (clash) return res.status(400).json({ error: "That email is already used by another account." });
    }

    if (pin) {
      if (!/^\d{6,8}$/.test(String(pin))) return res.status(400).json({ error: "PIN must be 6–8 digits." });
      const perr = validatePinStrength(String(pin));
      if (perr) return res.status(400).json({ error: perr });
    }

    sqlite.prepare(`
      UPDATE employees SET
        name = ?, role = ?, position = ?, phone = ?, gmail_email = ?,
        password_hash = ?, pin = ?, permissions = ?, is_active = ?, avatar_initials = ?, must_change_pin = ?
      WHERE id = ?
    `).run(
      name ?? emp.name,
      role ?? emp.role,
      position ?? emp.position,
      phone ?? emp.phone,
      gmailEmail ?? emp.gmail_email,
      password ? hashPassword(password) : emp.password_hash,
      pin ? hashPassword(pin) : emp.pin,
      permissions ?? emp.permissions,
      isActive !== undefined ? (isActive ? 1 : 0) : emp.is_active,
      avatarInitials ?? emp.avatar_initials,
      pin ? 1 : emp.must_change_pin,
      id
    );

    // If the update flipped is_active from true → false, revoke every live
    // session token for that employee. requireStaffAuth already rejects them
    // on the next request (it re-checks is_active), but wiping the row makes
    // the intent explicit and forces an immediate re-login attempt to fail.
    if (isActive === false && !!emp.is_active) {
      sqlite.prepare("DELETE FROM staff_sessions WHERE employee_id = ?").run(id);
      const ip = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "").toString();
      const requester = (req as any).employee;
      writeAudit(sqlite, requester?.id ?? null, requester?.name ?? null, "staff_deactivated", "employee", id, `Deactivated ${emp.name} via PATCH — sessions revoked`, ip);
    }

    const updated: any = sqlite.prepare("SELECT * FROM employees WHERE id = ?").get(id);
    res.json({ id: updated.id, name: updated.name, role: updated.role, position: updated.position, isActive: !!updated.is_active });
  });

  // DELETE /api/staff/:id — deactivate (soft delete) OR permanently delete with ?hard=true (owner/admin only)
  app.delete("/api/staff/:id", requireRole("owner", "admin"), (req, res) => {
    const id = Number(req.params.id);
    const hard = req.query.hard === "true" || req.query.hard === "1";
    const ip = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "").toString();

    const emp: any = sqlite.prepare("SELECT * FROM employees WHERE id = ?").get(id);
    if (!emp) return res.status(404).json({ error: "Employee not found" });

    // Identify the requesting user (from session token) for guards + audit
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const session: any = sqlite.prepare("SELECT * FROM staff_sessions WHERE session_token = ? AND expires_at > ?").get(token, new Date().toISOString());
    const requester: any = session ? sqlite.prepare("SELECT id, name, role FROM employees WHERE id = ?").get(session.employee_id) : null;

    if (hard) {
      // Safety guards: never permanently delete an owner, or the last owner, or yourself
      if (emp.role === "owner") {
        return res.status(400).json({ error: "Owner accounts cannot be permanently deleted. Change their role first if needed." });
      }
      if (requester && requester.id === id) {
        return res.status(400).json({ error: "You cannot delete your own account." });
      }
      // Remove any active sessions and login history for this employee, then delete the record
      sqlite.prepare("DELETE FROM staff_sessions WHERE employee_id = ?").run(id);
      sqlite.prepare("DELETE FROM login_attempts WHERE employee_name = ?").run(emp.name);
      sqlite.prepare("DELETE FROM employees WHERE id = ?").run(id);
      writeAudit(sqlite, requester?.id ?? null, requester?.name ?? null, "staff_deleted", "employee", id, `Permanently deleted ${emp.name} (${emp.role})`, ip);
      return res.json({ ok: true, deleted: "permanent" });
    }

    // Soft delete (deactivate) — default behavior
    sqlite.prepare("UPDATE employees SET is_active = 0 WHERE id = ?").run(id);
    // End any active sessions so a deactivated user is logged out
    sqlite.prepare("DELETE FROM staff_sessions WHERE employee_id = ?").run(id);
    writeAudit(sqlite, requester?.id ?? null, requester?.name ?? null, "staff_deactivated", "employee", id, `Deactivated ${emp.name}`, ip);
    res.json({ ok: true, deleted: "soft" });
  });

  // POST /api/staff/:id/reset-2fa — owner/admin clears a user's 2FA; forces re-enrollment.
  app.post("/api/staff/:id/reset-2fa", requireRole("owner", "admin"), (req, res) => {
    const id = Number(req.params.id);
    const ip = clientIp(req);
    const emp: any = sqlite.prepare("SELECT * FROM employees WHERE id = ?").get(id);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    const requester = (req as any).employee;

    sqlite.prepare("UPDATE employees SET totp_secret = NULL, totp_enabled = 0, totp_enrolled_at = NULL, backup_codes = NULL WHERE id = ?").run(id);
    sqlite.prepare("DELETE FROM trusted_devices WHERE employee_id = ?").run(id);
    sqlite.prepare("DELETE FROM pending_2fa WHERE employee_id = ?").run(id);
    writeAudit(sqlite, requester?.id ?? null, requester?.name ?? null, "2fa_admin_reset", "employee", id,
      `Reset 2FA for ${emp.name} — re-enrollment required on next login`, ip);
    res.json({ ok: true });
  });

  // ── GET /api/audit-log — owner only ──────────────────────────────────────
  app.get("/api/audit-log", (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const session: any = sqlite.prepare("SELECT * FROM staff_sessions WHERE session_token = ? AND expires_at > ?").get(token, new Date().toISOString());
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    const emp: any = sqlite.prepare("SELECT role FROM employees WHERE id = ?").get(session.employee_id);
    if (!emp || !["owner", "admin"].includes(emp.role)) return res.status(403).json({ error: "Forbidden" });

    const limit = parseInt(req.query.limit as string || "200");
    const action = req.query.action as string | undefined;
    let query = "SELECT * FROM audit_log";
    const params: any[] = [];
    if (action) { query += " WHERE action = ?"; params.push(action); }
    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);
    res.json(sqlite.prepare(query).all(...params));
  });

  // ── GET /api/login-attempts — owner only ─────────────────────────────────
  app.get("/api/login-attempts", (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const session: any = sqlite.prepare("SELECT * FROM staff_sessions WHERE session_token = ? AND expires_at > ?").get(token, new Date().toISOString());
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    const emp: any = sqlite.prepare("SELECT role FROM employees WHERE id = ?").get(session.employee_id);
    if (!emp || emp.role !== "owner") return res.status(403).json({ error: "Owner only" });
    const rows = sqlite.prepare("SELECT * FROM login_attempts ORDER BY attempted_at DESC LIMIT 100").all();
    res.json(rows);
  });

  // ── POST /api/audit-log — write from frontend actions ────────────────────
  app.post("/api/audit-log", (req, res) => {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const session: any = sqlite.prepare("SELECT * FROM staff_sessions WHERE session_token = ? AND expires_at > ?").get(token, new Date().toISOString());
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    const emp: any = sqlite.prepare("SELECT id, name FROM employees WHERE id = ?").get(session.employee_id);
    const { action, entity, entityId, detail } = req.body;
    const ip = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "").toString();
    writeAudit(sqlite, emp?.id, emp?.name, action, entity, entityId, detail, ip);
    res.json({ ok: true });
  });

  // Periodic cleanup: remove expired sessions (runs on startup)
  try {
    sqlite.prepare("DELETE FROM staff_sessions WHERE expires_at < ?").run(new Date().toISOString());
  } catch (_) {}
}
