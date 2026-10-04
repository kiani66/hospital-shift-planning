# Authentication and access (Phase 3)

## Sign-in

- **Auth.js v5**, Credentials provider (personnel number **or** e-mail + password, D96). No
  registration, self-service recovery, magic links, OAuth or SSO. Accounts are provisioned
  explicitly by the production CLI or authorized Hospital Admin commands (demo accounts by the
  seed); first passwords are one-time temporary passwords (D89).
- **Passwords**: Argon2id via `@node-rs/argon2` (prebuilt, no native build step), 19 MiB memory,
  2 iterations, 1 lane (OWASP minimum). Stored in `users.password_hash`; the parameters live in
  each hash, so they can be raised later. Verification runs only on the server
  (`src/infrastructure/auth/credentials.ts`); hashes never leave the server.
- **Identifier**: containing `@` → e-mail (trimmed, lower-cased); otherwise Persian/Arabic digits
  are converted, invisible characters removed and 1–20 digits are a personnel number (exact text
  match: leading zeros count). Anything else matches no account but takes the same path.
- **One generic failure**: an unknown identifier, a wrong password, a user without a password and
  a deactivated user all get "شماره پرسنلی/ایمیل یا رمز عبور نادرست است.". When there is no hash
  to check, a dummy Argon2 verification runs so response time does not reveal whether the account
  exists.
- Input is capped (identifier 320, password 256 characters) to bound the hashing work per request.
- Auth.js logs nothing about failed sign-ins; other auth errors are logged by name only.
- After signing in, the user returns to `callbackUrl` only if it is a same-site path
  (`safeRedirectPath`); otherwise `/`.

## Session

- Strategy: Auth.js **JWT** session (encrypted cookie, `HttpOnly`, `SameSite=Lax`, `Secure` on
  HTTPS), **absolute** 12 hours from sign-in (not sliding: the proxy only reads the cookie and
  never re-issues it, so a request in flight during sign-out cannot restore the session). No session tables: Credentials sign-in does not support database
  sessions, and the session carries nothing that needs revoking server-side (see below).
- Content: **the user id** (`sub`) and the **session version** it was issued with (`sv`, D90).
  The default name/e-mail/picture claims are dropped; roles, Hospital Admin authority,
  memberships, supervisor assignments and active status are never stored in it.
- Sign-out (`خروج`) clears the cookie. A copied cookie stays cryptographically valid until it
  expires, but it grants nothing once the user is deactivated or the password has been changed or
  reset since it was issued (next section).

## Password changes, temporary passwords and session invalidation

- `users.session_version` is incremented by every self-service change, admin-issued temporary
  password and operator reset. `getActor()` compares it with the session's `sv`; a mismatch is
  "not signed in" on the next request, on every device. Sessions from before this feature carry
  no `sv` and count as version 0 (the default), so existing users stay signed in until their first
  change.
- A temporary password sets `users.must_change_password`. Such a session resolves to
  `passwordChangeRequired`: no actor is produced, so every protected page and Server Action
  (`requireRequestContext`) redirects to `/account/password`, and use cases cannot run.
- `/account/password` requires the current password (wrong attempts count against the account
  throttle), a 12–256 character new password, confirmation, and a different value. On success
  the action signs the user in again with the new password, so the new session carries the new
  version.
- Temporary passwords: CSPRNG (`crypto.randomInt`), 4×4 unambiguous characters (~91 bits); only
  the Argon2id hash is stored; the plaintext is returned once to the issuing admin's browser and
  never logged, audited, persisted or returned again; the UI shows it once and discards it.
  Issuing never reactivates an account and clears an existing lockout. Audit events
  (`user.temporaryCredentialIssued`, `user.credentialsChanged`) contain no credential material.

## `getActor()`: the trusted boundary

`src/infrastructure/auth/session.ts` → `actorFromSession` (`actor.ts`), on every request
(cached per request):

1. Read the session; take `user.id` only (must be a UUID). No session → `null`.
2. Load the user from PostgreSQL. Unknown user → `null`.
3. `users.is_active = false` → `null`, even though the cookie is still valid.
4. Load memberships and supervisor assignments **effective today** (Asia/Tehran):
   `started_on <= today AND (ended_on IS NULL OR ended_on >= today)` (D19, `loadActor`).
5. Load system-level `users.is_hospital_admin` as well; ignore any client/session admin claim.
6. Return the trusted `Actor`. Nothing else in the session is read.

`null` means "not signed in": pages redirect to `/login`. Use cases additionally deny an inactive
actor (`ACTOR_INACTIVE`) as defense in depth.

## Route protection

1. **`src/proxy.ts`** (convenience): requests without a valid session cookie are redirected to
   `/login?callbackUrl=…`. It verifies the cookie read-only (`getToken`), never writes cookies, and
   never decides access to data.
2. **Server-side** (the boundary): every protected page calls `requireRequestContext()` itself
   (layouts are not relied on), and department pages authorize through the domain policy
   (`department.manage` for the schedule page, `audit.view` for history; supervisors' `/review`
   needs a current supervisor assignment).
3. A denied department URL answers **404**, identical to a department that does not exist, so
   guessing codes reveals nothing. The page shows no department details.
4. Server Actions and use cases get the actor from `getRequestContext()` and authorize in the
   application layer (`defineCommand` → `uow.authorize`), never from hidden buttons or the UI.

## Login throttling

Database-backed, **per account** (`login_throttles`, migration 0004; D96 supersedes the per-e-mail
key of D28):

| Rule               | Value                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------- |
| Key (known)        | SHA-256 of `account:<user id>`: e-mail, personnel number and a corrected number share it |
| Key (unknown)      | SHA-256 of `unknown:<identifier kind>:<normalized value>` (the identifier is not stored) |
| Limit              | 5 failed attempts within 15 minutes (sign-in, or a wrong current password when changing) |
| Lockout            | 15 minutes after the 5th failure; all attempts refused, even correct passwords           |
| Reset              | A successful sign-in or password change deletes the row; a temporary password clears it  |
| Unknown identifier | Throttled exactly like a real one (no enumeration)                                       |
| Concurrency        | One atomic `INSERT … ON CONFLICT DO UPDATE` per failure                                  |

While locked, the form says sign-in to this account is temporarily blocked. Not covered (known
MVP limits): per-IP limiting, and an attacker can deliberately lock a known account for 15
minutes. Rows keyed by e-mail from before D96 simply expire. Rows are not pruned automatically.

## Environment

| Variable          | Required                | Notes                                                   |
| ----------------- | ----------------------- | ------------------------------------------------------- |
| `AUTH_SECRET`     | Yes, per environment    | `openssl rand -base64 32`; `/api/health` reports `auth` |
| `AUTH_TRUST_HOST` | Outside Vercel (`true`) | Vercel is trusted automatically                         |

## Demo accounts (never in production)

`pnpm db:seed` (refuses to run in production) sets every demo account's password to
`demo-only-password`. The UI never shows it.

| Account                   | Access                                          |
| ------------------------- | ----------------------------------------------- |
| `nurse1.icu@demo.invalid` | Nurse, ICU                                      |
| `head.icu@demo.invalid`   | Head Nurse, ICU (also a nurse)                  |
| `head.er@demo.invalid`    | Head Nurse, ER                                  |
| `supervisor@demo.invalid` | Supervisor of ICU and ER                        |
| `transfer@demo.invalid`   | Nurse, ER until 2026-09-22, ICU from 2026-09-23 |
| `inactive@demo.invalid`   | Deactivated former ICU nurse: cannot sign in    |

## User and membership management (Phase 10)

`is_hospital_admin` is system-level authority, independent of department roles and Supervisor
assignments. Administrative policies deny Head Nurses, Supervisors, Nurses and inactive admins.
Head Nurses/Supervisors may read only relevant department personnel; no global identity/admin
projection is exposed to them. Admins receive no implicit scheduling or approval privilege.

All management writes use authenticated application commands, one transaction and safe audit
projections. They serialize on the administration advisory lock and re-read the caller's database
active/admin flags after locking. Removing authority or deactivating the last usable admin
(active, system authority present, credentials provisioned) is
refused, including concurrent attempts. Bootstrap is an explicit operator-only first-admin action
with privileged database access; it cannot be invoked repeatedly to grant more admins. See
`docs/deployment.md`. Direct privileged database writes bypass application invariants and are not
part of the supported administration workflow.

Account creation hashes the initial password with the existing Argon2id implementation; returned
records, list/search results and audit metadata omit credentials. No public registration,
self-service password recovery, password reset UI or bulk invitations are added. Existing JWT
expiration behavior is unchanged; authority changes and deactivation are enforced on the next
request with the same cookie. Email/profile edits do not revoke an existing cookie.

Inactive accounts cannot receive new or changed non-null scheduling assignments. New roster
snapshots/additions and swap/replacement candidates exclude them. Historical rosters, memberships, assignments
and approved versions remain intact; clearing a shift and restoring a prior approved version are
still possible. Membership ending and account deactivation are distinct actions.

The Phase 10 read-only directory/detail queries authorize `user.list` and reload the caller's
stored authority before selecting explicit safe DTOs. Only Hospital Admin receives email,
system authority and full access histories. Department people queries authorize `personnel.view`
against both the request actor and freshly loaded effective relations, and expose only current
local personnel names/roles/account status, including current Supervisors. They never expose
global identity fields or links to global user detail. Unknown/denied management pages answer
the same 404; inactive sessions still redirect to sign-in. Filter/pagination values confer no
authority. Read DTOs include no audit metadata or credentials. Hospital Admin write adapters are
described below; scoped department people screens remain read-only.

Phase 10 Slice 3 adds ordinary Hospital Admin Server Actions for account creation/profile/status
and membership add/end/transition only. Every action selects its allowed fields, validates dates
through the Jalali presentation adapter, gets the trusted request context and invokes the existing
command, which authorizes again under the administration lock. Extra submitted admin authority,
Supervisor, password-hash/token and other security fields are discarded. Successful action DTOs
contain fixed Persian feedback and, for creation only, a validated destination user id; submitted
values and command records are not echoed. Password inputs are cleared immediately after the
browser captures the submission. Public provisioning/recovery or a CLI bridge is not added.

Expected profile and membership end values are captured when dialogs open. Status actions require
the optional command-level expected active flag, rejecting stale forms under the same lock.
Deactivation has explicit confirmation and preserves relations/old rosters. Last-active-admin
protection applies to these UI calls too; deliberate self-deactivation redirects to sign-in after
commit. Elevated authority and Supervisor mutation adapters, delivered in Slice 4, are described below.

Phase 10 Slice 4 exposes only authenticated Hospital Admin adapters for system authority changes
and Supervisor assignment/end commands. The person detail separates these from account status
and department membership roles. Authority forms require frozen expected admin and active flags;
the command checks these after caller reauthorization under the existing shared administration
lock. Stale changes fail before idempotent handling. Last-active-admin removal/deactivation remains
refused under that lock, including simultaneous self-removal, mutual revocation and mixed writes.

New Hospital Admin grants require an active, credential-provisioned account. Passwordless legacy
admins never count as replacements for the last usable admin. Inactive accounts may retain stored
admin authority but cannot use it or sign in until explicit reactivation; reactivation of stored
admin authority is rejected until credentials are provisioned. Credential queries return only
booleans/counts; hashes are not added to DTOs or audit events. Specific Persian errors explain
blocked grants/activations without exposing database details. Granting authority never activates
an account or provisions credentials. Removal has a confirmation, and
self-demotion additionally warns and redirects through the trusted default-page route after commit
and shell revalidation. Admin navigation/access is derived again on the next request, using the
same cookie; old loaded controls cannot authorize a write after revocation. Supervisor periods
remain separate effective-dated relations, with current-only inclusive ending and expected-end
stale checks. No secrets, bootstrap/recovery adapter or extra audit metadata are introduced.

## Personnel identity and bulk import (D87–D97)

- Personnel numbers, mobile numbers and e-mails are validated and normalized on the server (domain
  parsers), with database checks as the final guard. Only Hospital Admins see e-mail, mobile,
  personnel number and credential state (`hasCredentials`, `mustChangePassword` booleans); scoped
  Head Nurse/Supervisor views are unchanged.
- The CSV import runs only as authenticated Hospital Admin Server Actions (Next.js origin checks),
  re-authorizes against the database, caps size (256 KB) and rows (500), decodes strict UTF-8,
  rejects any credential-like column, never trusts the previewed rows on commit (re-validation and
  plan fingerprint), and holds the administration advisory lock while committing. Imported
  accounts have no password; existing accounts are never modified, reset or reactivated.
- Personnel-number corrections change only the sign-in identifier (audited before/after); the
  user id, sessions and throttle state are unaffected.
- Roster additions are Head Nurse use cases (`schedule.editRoster`) with server-side membership,
  account, status and revision checks; no assignment is created.
