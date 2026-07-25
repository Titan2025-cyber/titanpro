# PIN Authentication Hardening

Quick-PIN kiosk login (field techs on shared tablets) stays available but is now
much harder to guess from the public internet. Full-password login, TOTP 2FA, and
trusted-device behavior are unchanged.

## PIN rules

- **Length:** 6–8 digits (was 4–8). Digits only.
- **Rejected patterns** (enforced by `validatePinStrength` in `server/routes_auth.ts`):
  - A small blocklist of lazy PINs: `121212`, `123123`, `112233`, `101010`,
    `123321`, `696969`, `420420`, `654321`.
  - Any single repeated digit — `000000`, `1111111`, … (`/^(\d)\1+$/`).
  - Any repeated 1–4 digit block that divides the length — `121212`, `123123`,
    `12341234`, …
  - Any purely sequential run, step 1, ascending or descending, wrapping 0↔9 —
    `123456`, `654321`, `012345`, `098765`, `01234567`, …
- On failure the user sees: *"PIN cannot be a repeated or sequential pattern.
  Please choose a less predictable PIN."*

The same rules are enforced client-side (Login, Security page, force-change gates)
for instant feedback, but the **server is the source of truth**.

## `must_change_pin` flag

A new `employees.must_change_pin` column (INTEGER, default 0) marks a PIN that must
be replaced before the account can be used.

An account is flagged when:
- **Migration backfill** — the moment the column is first created, every account
  that already has a PIN is flagged (`UPDATE ... WHERE pin IS NOT NULL`). All
  pre-existing PINs are legacy sub-6-digit defaults (e.g. `1234`), so they are all
  treated as stale. This backfill runs **once**, only in the code path that just
  created the column.
- **Seeded accounts** — each seeded employee gets a unique random compliant PIN and
  is flagged (see below).
- **Admin create/update** — any PIN an owner/admin sets via Staff Management is
  treated as temporary and the target is flagged.

## Login flow for a flagged PIN

1. User signs in with their (stale) PIN — this one login is accepted.
2. Server returns `{ requiresPinChange: true, pinChangeToken }` instead of a session
   (10-minute token stored in the existing `pending_2fa` table with `type = 'pin_change'`).
3. Client shows the **"Update your PIN"** screen (new PIN + confirm).
4. `POST /api/auth/pin/change-forced` validates the token + new PIN, updates the PIN,
   clears `must_change_pin`, and issues a full session.

A defensive full-screen gate (`ForcePinChange`, in `AuthGate`) also catches any
already-authenticated session flagged for change but that skipped the login step.
It runs **after** the 2FA enrollment gate (2FA takes priority) and submits through
the normal `/api/auth/change-password` endpoint.

Rate-limiting and the 5-fails-in-15-minutes lockout on the PIN login path are
**unchanged**.

## Distributing seeded / admin-generated default PINs

Seeded accounts and admin-created accounts (when no PIN is supplied) get a unique
random 6-digit compliant PIN. The plaintext is written **once** to the audit log so
an owner can look it up and hand it to the employee:

- Audit action: `pin_default_generated`
- Detail: `Initial PIN for <name>: <plaintext PIN>`

An owner/admin can read these from the Activity Log / `GET /api/audit-log?action=pin_default_generated`.
The employee is forced to change this PIN on first login.

## New endpoint

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/pin/change-forced` | pinChangeToken | Set a new compliant PIN after a stale-PIN login; issues a session |

`/api/auth/me` now also returns `mustChangePin: boolean`.
