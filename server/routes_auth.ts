import type { Express, Request, Response, NextFunction } from "express";
import type { Database } from "better-sqlite3";
import crypto from "crypto";
import bcrypt from "bcryptjs";

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
    "ramp", "route-planner", "business-dev", "finance",
    "weekly-billing", // owner-only executive report
    "ai-agent", // AI Agent Center (owner + general manager)
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
    "ramp", "route-planner", "business-dev", "finance",
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

  // Seed default passwords for existing employees (name-based PIN so they can change it)
  // Owner: "admin1234", Techs: "titan1234" — must be changed on first login
  const existing: any[] = sqlite.prepare("SELECT * FROM employees WHERE password_hash IS NULL").all();
  for (const emp of existing) {
    const defaultPw = emp.role === "owner" ? "admin1234" : "titan1234";
    const hash = hashPassword(defaultPw);
    sqlite.prepare("UPDATE employees SET password_hash = ?, pin = ? WHERE id = ?")
      .run(hash, hashPassword("1234"), emp.id);
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

    // Create session (8h — session timeout security)
    const token = crypto.randomBytes(40).toString("hex");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    sqlite.prepare(
      "INSERT INTO staff_sessions (employee_id, session_token, expires_at, created_at) VALUES (?, ?, ?, ?)"
    ).run(emp.id, token, expiresAt, now);
    sqlite.prepare("UPDATE employees SET last_login_at = ? WHERE id = ?").run(now, emp.id);
    sqlite.prepare("INSERT INTO login_attempts (employee_name, ip, success, attempted_at) VALUES (?, ?, 1, ?)").run(emp.name, ip, now);
    writeAudit(sqlite, emp.id, emp.name, "login_success", "auth", null, `Logged in via ${password ? "password" : "PIN"}`, ip);

    const permissions = Array.from(resolvePermissions(emp.role, emp.permissions || "[]"));

    res.json({
      token,
      employee: {
        id: emp.id, name: emp.name, role: emp.role, position: emp.position,
        gmailEmail: emp.gmail_email, phone: emp.phone,
        avatarInitials: emp.avatar_initials || emp.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2),
        permissions,
      },
    });
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
    res.json({
      id: emp.id, name: emp.name, role: emp.role, position: emp.position,
      gmailEmail: emp.gmail_email, phone: emp.phone,
      avatarInitials: emp.avatar_initials || emp.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2),
      permissions,
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

    const { currentPassword, newPassword, newPin } = req.body;
    const emp: any = sqlite.prepare("SELECT * FROM employees WHERE id = ?").get(session.employee_id);

    if (currentPassword && !verifyPassword(currentPassword, emp.password_hash || "")) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    if (newPassword) {
      const err = validatePasswordStrength(newPassword);
      if (err) return res.status(400).json({ error: err });
    }
    if (newPin && !/^\d{4,8}$/.test(String(newPin))) {
      return res.status(400).json({ error: "PIN must be 4–8 digits." });
    }

    const updates: any = {};
    if (newPassword) updates.password_hash = hashPassword(newPassword);
    if (newPin) updates.pin = hashPassword(newPin);

    if (Object.keys(updates).length > 0) {
      const setClause = Object.keys(updates).map(k => `${k} = ?`).join(", ");
      sqlite.prepare(`UPDATE employees SET ${setClause} WHERE id = ?`).run(...Object.values(updates), emp.id);
    }
    res.json({ ok: true });
  });

  // ── User Management (owner/admin only) ──────────────────────────────────

  // GET /api/staff — list all employees (owner/admin only)
  app.get("/api/staff", requireRole("owner", "admin"), (req, res) => {
    const rows: any[] = sqlite.prepare("SELECT id, name, role, position, gmail_email, phone, is_active, last_login_at, permissions, avatar_initials, created_at FROM employees ORDER BY id").all();
    res.json(rows.map(r => ({
      id: r.id, name: r.name, role: r.role, position: r.position,
      gmailEmail: r.gmail_email, phone: r.phone, isActive: !!r.is_active,
      lastLoginAt: r.last_login_at, permissions: r.permissions || "[]",
      avatarInitials: r.avatar_initials || r.name.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2),
      createdAt: r.created_at,
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
    const now = new Date().toISOString();
    const pw = password || "titan1234";
    const p = pin || "1234";
    const result = sqlite.prepare(`
      INSERT INTO employees (name, role, position, phone, gmail_email, password_hash, pin, permissions, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(name, role, position || null, phone || null, gmailEmail || null,
           hashPassword(pw), hashPassword(p),
           permissions || "[]", now);
    const emp: any = sqlite.prepare("SELECT * FROM employees WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json({ id: emp.id, name: emp.name, role: emp.role, position: emp.position });
  });

  // PATCH /api/staff/:id — update employee (owner/admin only)
  app.patch("/api/staff/:id", requireRole("owner", "admin"), (req, res) => {
    const id = Number(req.params.id);
    const { name, role, position, phone, gmailEmail, password, pin, permissions, isActive, avatarInitials } = req.body;
    const emp: any = sqlite.prepare("SELECT * FROM employees WHERE id = ?").get(id);
    if (!emp) return res.status(404).json({ error: "Employee not found" });

    sqlite.prepare(`
      UPDATE employees SET
        name = ?, role = ?, position = ?, phone = ?, gmail_email = ?,
        password_hash = ?, pin = ?, permissions = ?, is_active = ?, avatar_initials = ?
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
      id
    );
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
