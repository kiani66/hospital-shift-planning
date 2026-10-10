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

`pnpm db:provision-user` creates one real account and its department membership without manual
SQL, or performs one explicit operator recovery/backfill. It is **production-safe** and is not the
demo seed:

|              | `db:provision-user`                                  | `db:seed`                                |
| ------------ | ---------------------------------------------------- | ---------------------------------------- |
| Purpose      | One real account + membership, or explicit recovery  | Reset to fictional demo data             |
| Data effect  | Inserts/updates only the rows it names; never resets | Truncates every application table        |
| Production   | Allowed                                              | Refused (`assertSeedAllowed`), unchanged |
| When it runs | Only when you invoke it; never during a deploy/build | Only when invoked, dev/preview only      |

Inputs are environment variables (nothing is hard-coded or committed). `PROVISION_MODE` selects
the operation (default `create`, decision D93):

| Variable                         | `create`                                | `reset-password`                  | `assign-personnel-number`            |
| -------------------------------- | --------------------------------------- | --------------------------------- | ------------------------------------ |
| `PROVISION_PERSONNEL_NUMBER`     | required (1–20 digits)                  | this or e-mail identifies account | required (the genuine number)        |
| `PROVISION_EMAIL`                | optional                                | this or number identifies account | required (identifies legacy account) |
| `PROVISION_DISPLAY_NAME`         | required                                | —                                 | —                                    |
| `PROVISION_MOBILE`               | optional                                | —                                 | —                                    |
| `PROVISION_PASSWORD`             | required to create (temporary)          | required (temporary)              | —                                    |
| `PROVISION_DEPARTMENT_CODE`      | required                                | —                                 | —                                    |
| `PROVISION_ROLE`                 | `HEAD_NURSE` or `NURSE`                 | —                                 | —                                    |
| `PROVISION_DEPARTMENT_NAME`      | only to create the department           | —                                 | —                                    |
| `PROVISION_ALLOW_NEW_MEMBERSHIP` | `yes` to add one to an existing account | —                                 | —                                    |
| `PROVISION_CONFIRM`              | —                                       | `RESET_PASSWORD`                  | `ASSIGN_PERSONNEL_NUMBER`            |

The database is `DATABASE_URL_UNPOOLED`, falling back to `DATABASE_URL` (same as `db:migrate`).
PowerShell (placeholders only):

```powershell
$env:DATABASE_URL_UNPOOLED="<production direct connection string>"
$env:PROVISION_PERSONNEL_NUMBER="<genuine personnel number>"
$env:PROVISION_DISPLAY_NAME="<full name>"
$env:PROVISION_PASSWORD="<strong temporary password>"
$env:PROVISION_DEPARTMENT_CODE="nicu"
$env:PROVISION_ROLE="HEAD_NURSE"

pnpm db:provision-user

# Clear the secrets from the session afterwards.
Remove-Item Env:PROVISION_PASSWORD, Env:DATABASE_URL_UNPOOLED
```

Behavior:

- **Never silent:** re-running `create` with the same identity changes nothing (output
  `user: unchanged`, `password: unchanged`). A supplied password is never applied to an existing
  account; a different name, e-mail, mobile or number is an error; a disabled account is never
  reactivated; an existing account gets a new membership only with
  `PROVISION_ALLOW_NEW_MEMBERSHIP=yes`. Role changes are refused (use the personnel screens).
- **Passwords are temporary:** the created account (and `reset-password`) must choose its own
  password at the first sign-in. `reset-password` also ends every session of that account; it does
  not reactivate.
- **Department:** an existing active department is reused as is (never renamed); an inactive one is
  an error; a missing one is created only with `PROVISION_DEPARTMENT_NAME`. Concurrent runs are
  serialized.
- **Transaction and audit:** each run is one transaction under the administration lock; any failure
  leaves nothing behind. Every write is audited (`user.created`, `membership.added`,
  `user.temporaryCredentialIssued`, `user.personnelNumberAssigned`; actor = the target account,
  `source: operatorCli`). Input is validated before the database is contacted.
- **Output:** personnel number, department, role and what changed. The password, its hash and the
  connection string are never printed; only the database host and name are.

## NICU pilot runbook (personnel identity, import, roster)

Requires explicit authorization for the Production release; nothing below runs automatically
except migration 0009 in `vercel-build`.

1. **Release** the change through the normal process. Migration `0009_personnel_identity` is
   additive; existing users keep e-mail sign-in and their sessions (version 0).
2. **Your Hospital Admin account:** sign in with your e-mail, open your person page and use
   «ثبت شماره پرسنلی» to record your genuine personnel number (audited). Alternatively
   `PROVISION_MODE=assign-personnel-number`. Your admin authority is unchanged.
3. **Provision the NICU Head Nurse:** «ایجاد کاربر» with personnel number and name (temporary
   password shown once), then «افزودن عضویت» `HEAD_NURSE` in NICU from today. (Or
   `db:provision-user` in `create` mode.)
4. **Hand over your Head Nurse membership (audited):** on your own person page, end your current
   NICU `HEAD_NURSE` membership (today or a chosen last day) with «پایان عضویت». Do this after the
   new Head Nurse's membership exists. Your Hospital Admin authority and history stay. Note: your
   entry in an existing draft roster stays (roster removal is out of scope); you simply receive
   no shifts.
5. **Import NICU nurses:** `/admin/personnel/import` with the CSV (personnel numbers as Text in
   Excel), NICU, start date; review the preview; confirm; then «ساخت رمز موقت برای حساب‌های جدید»
   and hand each one-time password to its owner.
6. **Existing draft schedule:** the new Head Nurse opens the NICU schedule and uses «افزودن پرسنل
   به برنامه» to add themselves and the imported nurses (DRAFT/PLANNING only). No shifts are
   created; existing assignments stay.
7. **Backfill check:** `pnpm db:personnel-inventory` against Production. When it reports zero and
   you authorize it, promote the strict stage (docs/database.md, "Personnel number stages").

## Versioned staffing rules: release and NICU 3–6 pilot runbook

Decisions D102–D110. Requires explicit authorization for the Production release; nothing below
runs automatically except migration 0011 in `vercel-build`.

1. **Release** through the normal process. Migration `0011_staffing_rule_sets` is additive
   (docs/database.md, "Staffing rule sets"): it creates the rule-set tables and only the legacy
   Hospital Default v1 (M/E/N min 1, no max), and pins every existing schedule and approved
   version to it. Coverage results are unchanged until a Hospital Admin publishes and applies
   another version. It does **not** create or publish any NICU rule.
2. **Verify after release:** `/admin/staffing-rules` shows «پیش‌فرض بیمارستان · نسخه ۱»,
   effective, and the NICU schedule page shows the same pinned rules with unchanged day results.
3. **Create the NICU override (Hospital Admin):** on `/admin/staffing-rules`, in the NICU card,
   «تعریف قوانین ویژه این بخش» (a complete copy of the Hospital Default, D106). Edit the draft:
   NORMAL M/E/N min 3, max 6 (add HOLIDAY rows or date exceptions only if decided), a note, then
   «ذخیره پیش‌نویس». No other department is affected.
4. **Publish:** «انتشار نسخه» with the effective date (the current NICU period start or today,
   never in the past); «بررسی تداخل» must report no conflict. Publishing does not change any
   existing schedule (D108); only NICU schedules created afterwards for periods starting on or
   after that date pin it.
5. **Apply to the current NICU schedule (Supervisor of NICU or Hospital Admin):**
   - If the schedule is `APPROVED`, the NICU Head Nurse first uses «شروع بازنگری» with a reason
     (D109). `SUBMITTED` must be withdrawn or decided first.
   - On `/departments/nicu/coverage-rules`, select the NICU v1 override under «اعمال نسخه دیگر»,
     «پیش‌نمایش», read the impact (shortages/overstaffing per period, days to repair), tick the
     confirmation and «اعمال نسخه بر این برنامه». Shifts are unchanged; coverage is re-evaluated
     and the change is audited (`schedule.ruleSetApplied`). In a revision, the dates the new rule
     breaks are added to the revision scope.
   - The Head Nurse fixes the coverage problems, finalizes/resubmits as usual; the Supervisor
     re-approves. The previous approved version keeps its own pinned rules.
   - If the preview reports past days it can no longer repair (a FINALIZED schedule or a revision
     whose period has started, D109), Apply is refused: the override then reaches NICU through
     the next period's schedule, which pins it at creation.
6. **Rollback (if needed):** same page, select the version to return to (the Hospital Default v1,
   or an earlier published/retired NICU version, which is recorded as a rollback, D107), preview,
   confirm, apply; the same revision rule applies to an `APPROVED` schedule. Drafts are never
   applicable.
7. **Contract step (later, separate authorization):** drop the pin column defaults once no older
   deployment runs (docs/database.md).

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
   `db:provision-user` operator workflow first (`create`, or `reset-password` for explicit
   recovery; it never reactivates an account), so check its documented effects before running it.
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
cannot remove the last active credential-provisioned admin; passwordless legacy admin flags do
not count as replacements. New grants require an active account with credentials, and reactivating
stored admin authority requires credentials provisioned through the explicit operator workflow.
Bootstrap has no HTTP endpoint or UI adapter; no automatic
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

## Phase 14 delivery boundary

Migration `0013_reset_operations.sql` is additive and contains no pilot-data deletion. Existing
`AUTH_SECRET` also signs reset previews; secret rotation expires pending confirmations. Code,
preview generation and isolated tests do not authorize a reset of current NICU/pilot data. Apply
migrations, push/merge/deploy and execute any existing-pilot reset only after explicit owner approval.
Review [Phase 14 runbook](phase-14-reset.md), including conservative freshness checks, brief write
locks and explicit recreation requirements when optional master data/departments are removed.

Phase 14 business readiness adds no further migration. The reset page provides admin-only,
read-only preview and explicitly confirmed transactional restoration of missing migration-defined
shift/reason defaults and the original legacy staffing baseline only for an empty hospital lineage.
Existing rows, inactive reasons, personnel credentials and policies are never overwritten.
See [personnel readiness and controlled recovery](phase-14-reset.md#controlled-default-recovery)
for conflict resolution and the approved-value department operator procedure. Do not replay old
migrations or seed demo data as a pilot recovery mechanism.
