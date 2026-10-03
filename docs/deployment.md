# Deployment (Vercel + Neon)

```
GitHub ──PR──▶ Vercel Preview ──▶ Neon branch (one per preview, created by the integration)
       └main─▶ Vercel Production ──▶ Neon main branch
```

The Vercel build runs `pnpm vercel-build`: it applies database migrations
(`scripts/db-migrate.ts`, using `DATABASE_URL_UNPOOLED`) and then runs `next build`.
A deployment therefore never goes live on an older schema, and a build fails fast if
the database variables are missing.

## One-time setup (manual)

1. **Neon project**: create one at <https://console.neon.tech> (free tier is fine to start).
   Pick a region close to your users and note it (for example `aws-eu-central-1`, Frankfurt).
   PostgreSQL 17.
2. **Vercel project**: at <https://vercel.com/new>, import `kiani66/hospital-shift-planning`.
   The framework (Next.js), package manager (pnpm) and Node 22 (`engines`) are detected.
   Leave the build command at its default; Vercel runs `vercel-build` automatically.
3. **Connect Neon to Vercel**: Vercel project → Storage (or Integrations) → Neon →
   connect the existing Neon project. Enable **Create a database branch for each preview
   deployment**. The integration sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED` per
   environment.
   - Without preview branching, preview builds would run their migrations against the
     production database. Do not skip this, or give Preview its own database URLs.
4. **Function region**: Vercel project → Settings → Functions → Function Region. Pick the
   region matching the Neon region (for example `fra1` for Frankfurt).
5. **Deploy**: push to `main` (or open a PR for a preview). Then check
   `https://<deployment>/api/health`, which should return
   `{"status":"ok","checks":{"database":"ok"}}`.

## Environment variables

| Variable                | Where                            | Purpose                                                  |
| ----------------------- | -------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`          | Vercel (Neon integration), CI    | Pooled connection for the running app                    |
| `DATABASE_URL_UNPOOLED` | Vercel (Neon integration), CI    | Direct connection for migrations                         |
| `SKIP_DB_MIGRATIONS`    | Vercel (optional)                | `1` skips migrations in `vercel-build` (emergency only)  |
| `AUTH_SECRET`           | Vercel (Production, Preview), CI | Session encryption (`openssl rand -base64 32`); required |
| `AUTH_TRUST_HOST`       | Local and CI only                | `true`; not needed on Vercel (trusted automatically)     |

Never prefix secrets with `NEXT_PUBLIC_`. Local values go in `.env.local` (gitignored); see
`.env.example`.

## Auth setup (manual, once)

1. Vercel project → Settings → Environment Variables → add `AUTH_SECRET` for **Production**
   and **Preview**, each a different value from `openssl rand -base64 32`. Redeploy.
2. Check `/api/health`: `checks.auth` must be `"ok"` (it reports `"misconfigured"`, and HTTP
   503, while the secret is missing or shorter than 32 characters).
3. Production has no accounts until they are provisioned (see
   [Provisioning the first production user](#provisioning-the-first-production-user)); the demo
   seed never runs there. To
   try a preview, seed its Neon branch by hand: `DATABASE_URL_UNPOOLED=<preview branch URL>
pnpm db:seed` (resets that branch to demo data).

## Provisioning the first production user

`pnpm db:provision-user` creates or updates one real user and their department membership
without manual SQL. It is **production-safe** and is not the demo seed:

|              | `db:provision-user`                                  | `db:seed`                                |
| ------------ | ---------------------------------------------------- | ---------------------------------------- |
| Purpose      | One real user + membership                           | Reset to fictional demo data             |
| Data effect  | Inserts/updates only the rows it names; never resets | Truncates every application table        |
| Production   | Allowed                                              | Refused (`assertSeedAllowed`), unchanged |
| When it runs | Only when you invoke it; never during a deploy/build | Only when invoked, dev/preview only      |

It can also create the initial department, but only deliberately: see `PROVISION_DEPARTMENT_NAME`
below. It is meant for the minimal first production bootstrap (department, user, membership).

Inputs (environment variables; nothing is hard-coded or committed):

| Variable                    | Required | Notes                                                                                 |
| --------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `PROVISION_EMAIL`           | yes      | Normalized like sign-in (trim, lowercase)                                             |
| `PROVISION_PASSWORD`        | yes      | 12 to 256 characters; hashed with the same Argon2id function as the login path        |
| `PROVISION_DEPARTMENT_CODE` | yes      | `departments.code` (exact match, else a unique case-insensitive match)                |
| `PROVISION_ROLE`            | yes      | `HEAD_NURSE` or `NURSE`                                                               |
| `PROVISION_DISPLAY_NAME`    | no       | Used only when the user is created; defaults to the part of the e-mail before the `@` |

The database is `DATABASE_URL_UNPOOLED`, falling back to `DATABASE_URL` (same as `db:migrate`),
e.g. from the Neon production connection string. PowerShell (placeholders only):

```powershell
$env:DATABASE_URL_UNPOOLED="<production direct connection string>"
$env:PROVISION_EMAIL="head@example.com"
$env:PROVISION_PASSWORD="<strong-password>"
$env:PROVISION_DEPARTMENT_CODE="icu"
$env:PROVISION_DEPARTMENT_NAME="ICU"
$env:PROVISION_ROLE="HEAD_NURSE"

pnpm db:provision-user

# Clear the secrets from the session afterwards.
Remove-Item Env:PROVISION_PASSWORD, Env:DATABASE_URL_UNPOOLED
```

Behavior:

- **Department:** an existing active department is reused as is: it is never renamed and
  `PROVISION_DEPARTMENT_NAME` is ignored. An existing inactive one is an error (it is not
  reactivated). If it does not exist, `PROVISION_DEPARTMENT_NAME` is required, otherwise the
  command fails and writes nothing (no default name is ever used); with a name, the department is
  created active with exactly the given code and name. Concurrent runs are serialized per code, so
  a race cannot create two.
- **Transaction:** the department, user and membership are written in one transaction; any
  failure leaves no department, user, membership or password change behind. Input is validated before the database is contacted.
- **New user:** created active, with a generated id and the normalized e-mail.
- **Existing user** (matched on `lower(email)`, like sign-in): the password hash is replaced and
  `is_active` set to true; the e-mail spelling, display name and all other data are kept.
- **Membership** (effective today in Tehran: `started_on <= today` and `ended_on` null or `>= today`):
  - none: an open-ended membership starting today is created;
  - current one with the same role: left unchanged;
  - current one with another role, or one starting in the future: the command stops with a
    conflict error and changes nothing (it never rewrites history; end the old membership
    deliberately first). Ended memberships are kept and a new one is added.
- **Idempotent:** re-running with the same values adds no department, user or membership. It only refreshes
  the password hash (new salt) and `is_active`, so a repeat run also resets the password.
- **Output:** e-mail, department code, department status (`created` or `existing`), role and
  status only. The password, its hash and the
  connection string are never printed; only the database host and name are.

## Before real hospital use

- Move Neon to a paid plan for longer point-in-time restore and no cold starts.
- Confirm data-residency and retention requirements for staff data.

## Phase 10 production upgrade and first Hospital Admin

Phase 10 supplies application commands and the completed personnel management UI. Production
migration/deployment must be performed separately through the normal release process; local
review and tests do not migrate production or establish its first Hospital Admin.

1. Review migration `0008_hospital_admin`: one additive default-false boolean column, no grants,
   no deletes, no membership-role changes. The previous deployment remains compatible.
2. Through the normal production release process, apply migrations before the new application
   starts (the existing `vercel-build` path does this). Do not run the demo seed in production.
3. Choose an existing active password-provisioned account deliberately. If needed, use the
   existing `db:provision-user` operator workflow first; it refreshes an existing password and
   reactivates that account, so check its documented effects before running it.
4. In a secure operator shell with the intended direct database connection configured, set
   `BOOTSTRAP_ADMIN_EMAIL` to that exact account and `BOOTSTRAP_ADMIN_CONFIRM` to
   `ESTABLISH_FIRST_HOSPITAL_ADMIN`, then explicitly run `pnpm db:bootstrap-admin`.
5. Clear operator inputs afterward. Verify that the selected account is the sole initially
   granted admin and that `user.hospitalAdminBootstrapped` exists. No credentials are printed or
   audited. The selected user's next request loads system authority from the database.

Bootstrap refuses unknown, inactive or passwordless accounts and any pre-existing admin,
including inactive ones; simultaneous attempts establish only one. It cannot be used to promote
additional accounts. Subsequent grants/removals use `setHospitalAdmin` as an authenticated admin
command through the Hospital Admin person-detail UI. Account deactivation/authority removal
cannot remove the last active admin. Bootstrap has no HTTP endpoint or UI adapter; no automatic
admin grant goes to the seed, deployer, first user, Head Nurse or Supervisor.

### Migration ordering and rollback

`0008_hospital_admin` is an additive, non-null boolean with a constant false default. Existing
accounts keep their identity, status, credentials and relations; the migration performs no data
backfill or promotion. Apply it before any Phase 10 server starts: the new request actor reads
the flag. The previous application can run against the expanded schema. Vercel's existing
`vercel-build` migration-before-build ordering satisfies this; do not set `SKIP_DB_MIGRATIONS=1`
on an unmigrated target. Confirm Preview URLs point to an isolated Neon branch.

PostgreSQL still takes a table lock for `ALTER TABLE`; use the normal release window and inspect
long-running transactions before release. Verify the migration journal and health endpoint,
then deliberately bootstrap the selected account and smoke-test its management access. Verify
Head Nurse/Supervisor scope and Nurse denial, and that existing schedules remain readable.

For application rollback, retain the additive column and all audit/relation history and redeploy
the previous application. The old app has no management UI; it does not undo completed account
or relation changes, including deactivations. Do not drop the column while Phase 10 servers are
running, or clear admin flags as a rollback shortcut. There is no automatic down migration or
general recovery command; any data correction needs a separately reviewed operator procedure.
