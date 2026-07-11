# Two-Factor Authentication (2FA)

Titan Pro requires TOTP-based two-factor authentication for **all password logins**,
compatible with Google Authenticator and Microsoft Authenticator (RFC 6238: 30s period,
SHA-1, 6 digits — the default both apps use).

## Scope

- **Required for everyone** — all roles (owner, general_manager, admin, tech, sales, office).
- **Password logins only.** Quick-PIN kiosk logins (field techs on shared tablets) skip 2FA
  and are unchanged.
- Existing sessions from before this deploy stay valid, but any user without 2FA configured
  hits a mandatory, non-dismissable enrollment screen before they can use the app.

## Login flow

1. **Credentials** — user enters email + password.
2. Server response branches:
   - No 2FA secret yet → `{ requires2FASetup, setupToken }` → **enrollment screen**
     (QR + secret + 6-digit verify). On success the 10 one-time backup codes are shown once.
   - 2FA enabled → `{ requires2FA, challengeToken }` → **code screen** (6-digit TOTP or a
     backup code), with a "Remember this device for 30 days" checkbox.
   - Valid trusted-device token present → full session immediately, no code prompt.
3. On verify, a full 8h staff session token is issued.

The trusted-device token is stored in `localStorage` under `titan_trusted_device` and sent
with future login POSTs so the code prompt is skipped for 30 days.

## Recovery

- **Backup codes** — 10 single-use codes (format `xxxx-xxxx`), bcrypt-hashed at rest. Shown
  once at enrollment; regenerate from the Security page (requires a current TOTP code).
- **Admin reset** — owners/admins can clear any user's 2FA from Staff Management
  ("Reset 2FA"), or via `POST /api/staff/:id/reset-2fa`. The user must re-enroll on next login.

## Security page (`/security`)

- Two-factor status, "Reset & re-enroll", "Regenerate backup codes", backup codes remaining.
- Trusted devices — list with label/IP/added/expires, per-row revoke, and "sign out of all".
- Change password / PIN.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/login` | none | Password/PIN; returns `requires2FA` / `requires2FASetup` / full session |
| POST | `/api/auth/2fa/setup/start` | setupToken | Generate secret + QR |
| POST | `/api/auth/2fa/setup/verify` | setupToken | Confirm code, enable 2FA, issue session + backup codes |
| POST | `/api/auth/2fa/verify` | challengeToken | Verify TOTP/backup code at login |
| POST | `/api/auth/2fa/enroll/token` | session | Mint setup token for forced enrollment gate |
| POST | `/api/auth/2fa/disable` | session | Disable (requires password + code) |
| POST | `/api/auth/2fa/backup-codes/regenerate` | session | New backup codes (requires code) |
| GET | `/api/auth/2fa/trusted-devices` | session | List trusted devices |
| DELETE | `/api/auth/2fa/trusted-devices/:id` | session | Revoke one |
| DELETE | `/api/auth/2fa/trusted-devices` | session | Revoke all |
| POST | `/api/staff/:id/reset-2fa` | owner/admin | Admin reset a user's 2FA |

All actions are written to `audit_log` (`2fa_enrolled`, `2fa_verified`,
`2fa_backup_code_used`, `2fa_disabled`, `2fa_admin_reset`, etc.). 2FA verification reuses the
password lockout (5 failed attempts in 15 minutes) and the auth rate limiter.

## Encryption at rest

TOTP secrets are encrypted with the existing AES-256-GCM helpers in `server/encryption.ts`.
The key is derived from the **`TITAN_ENCRYPT_KEY`** environment variable (a dev fallback is
used locally; production refuses to start without it). Set a long random value in production
(e.g. Railway Variables). Backup codes are stored as bcrypt hashes (rounds = 10).

> Note: the encryption key env var is `TITAN_ENCRYPT_KEY` (the pre-existing symmetric-field
> key), reused here rather than introducing a separate `TITAN_ENCRYPTION_KEY`.

## Setup after pulling

```bash
npm install    # installs otplib (qrcode is already a dependency)
```
