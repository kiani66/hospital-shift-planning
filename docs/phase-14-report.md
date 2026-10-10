# Phase 14 implementation report

Branch: `codex/phase-14-controlled-data-reset`.

## A. Architecture and design decisions

The repository uses pure domain rules, transactional application commands, Drizzle repositories,
and thin Next.js Server Actions. The reset inventory was derived from migrations 0000–0012,
Drizzle primary/foreign keys, the schedule state machine, membership authorization, assignment
writer locks, approval snapshots, legacy requests, staffing-rule pins and audit references.

Slice A defines 14 product categories over 30 existing tables and a pure record dependency planner.
Slice B implements Monthly Reset. Slices C/D implement the read-only Full Reset preview and
transactional executor. Slice E adds regression coverage, missing-reference empty states and
operational documentation. Business hardening adds complete survivor/import readiness and
controlled master-default recovery. Decisions D113–D116 document the retention exception and concurrency
protocol. See [the architecture and runbook](phase-14-reset.md).

## B. Files changed

New implementation files:

- `src/domain/reset/{categories,plan,plan.test,survivors}.ts`
- `src/application/schedules/reset-planning.ts`
- `src/application/reset/{preview,execute,recovery}.ts`
- `src/infrastructure/repositories/{monthly-reset,reset-inventory,reset-execution,master-recovery}.ts`
- `src/infrastructure/db/schema/reset-operations.ts`
- `src/infrastructure/db/migrations/0013_reset_operations.sql`, its snapshot and journal entry
- `src/features/reset/{monthly-actions,monthly-control,full-actions,full-control,personnel-readiness,recovery-actions,recovery-control}`
- `src/app/(app)/admin/reset/page.tsx`
- `src/features/shifts/missing-reference.tsx`
- `tests/integration/{monthly-reset,full-reset-preview,full-reset-execution,reset-business-readiness}.test.ts`
- `tests/e2e/{monthly-reset,full-reset}.spec.ts`
- `docs/phase-14-reset.md` and this report

Existing files updated: authorization policies, schema exports, admin navigation, the monthly
schedule page, shift-label loading, login/branding, and reference-dependent pages for preferences,
my shifts, requests, review and staffing/coverage rules. Migration-history and legacy-schema usage
tests now recognize the additive migration and explicit pilot-history exception. README, database,
security, deployment and decision documentation are updated. CSV import query/actions/preview UI now
link actual matched accounts and email conflict owners; importer write behavior is unchanged.

Exact file manifest (57 files):

| File                                                         | Change   |
| ------------------------------------------------------------ | -------- |
| `README.md`                                                  | Modified |
| `docs/database.md`                                           | Modified |
| `docs/decisions.md`                                          | Modified |
| `docs/deployment.md`                                         | Modified |
| `docs/phase-14-report.md`                                    | New      |
| `docs/phase-14-reset.md`                                     | New      |
| `docs/security.md`                                           | Modified |
| `src/app/(app)/admin/reset/page.tsx`                         | New      |
| `src/app/(app)/admin/staffing-rules/page.tsx`                | Modified |
| `src/app/(app)/departments/[code]/coverage-rules/page.tsx`   | Modified |
| `src/app/(app)/departments/[code]/requests/page.tsx`         | Modified |
| `src/app/(app)/departments/[code]/schedule/page.tsx`         | Modified |
| `src/app/(app)/my-shifts/page.tsx`                           | Modified |
| `src/app/(app)/preferences/page.tsx`                         | Modified |
| `src/app/(app)/requests/page.tsx`                            | Modified |
| `src/app/(app)/review/[scheduleId]/page.tsx`                 | Modified |
| `src/app/login/page.tsx`                                     | Modified |
| `src/application/personnel-import/import.ts`                 | Modified |
| `src/application/reset/execute.ts`                           | New      |
| `src/application/reset/preview.ts`                           | New      |
| `src/application/reset/recovery.ts`                          | New      |
| `src/application/schedules/reset-planning.ts`                | New      |
| `src/domain/authz/policies.ts`                               | Modified |
| `src/domain/reset/categories.ts`                             | New      |
| `src/domain/reset/plan.test.ts`                              | New      |
| `src/domain/reset/plan.ts`                                   | New      |
| `src/domain/reset/survivors.ts`                              | New      |
| `src/features/auth/login-brand-panel.tsx`                    | Modified |
| `src/features/personnel-import/actions.ts`                   | Modified |
| `src/features/personnel-import/import-wizard.tsx`            | Modified |
| `src/features/reset/full-actions.ts`                         | New      |
| `src/features/reset/full-control.tsx`                        | New      |
| `src/features/reset/monthly-actions.ts`                      | New      |
| `src/features/reset/monthly-control.tsx`                     | New      |
| `src/features/reset/personnel-readiness.tsx`                 | New      |
| `src/features/reset/recovery-actions.ts`                     | New      |
| `src/features/reset/recovery-control.tsx`                    | New      |
| `src/features/shell/navigation.ts`                           | Modified |
| `src/features/shifts/labels.ts`                              | Modified |
| `src/features/shifts/missing-reference.tsx`                  | New      |
| `src/infrastructure/db/migrations/0013_reset_operations.sql` | New      |
| `src/infrastructure/db/migrations/meta/0013_snapshot.json`   | New      |
| `src/infrastructure/db/migrations/meta/_journal.json`        | Modified |
| `src/infrastructure/db/schema/index.ts`                      | Modified |
| `src/infrastructure/db/schema/reset-operations.ts`           | New      |
| `src/infrastructure/repositories/master-recovery.ts`         | New      |
| `src/infrastructure/repositories/monthly-reset.ts`           | New      |
| `src/infrastructure/repositories/reset-execution.ts`         | New      |
| `src/infrastructure/repositories/reset-inventory.ts`         | New      |
| `tests/e2e/full-reset.spec.ts`                               | New      |
| `tests/e2e/monthly-reset.spec.ts`                            | New      |
| `tests/integration/full-reset-execution.test.ts`             | New      |
| `tests/integration/full-reset-preview.test.ts`               | New      |
| `tests/integration/migrations.test.ts`                       | Modified |
| `tests/integration/monthly-reset.test.ts`                    | New      |
| `tests/integration/reset-business-readiness.test.ts`         | New      |
| `tests/unit/legacy-schema-usage.test.ts`                     | Modified |

## C. Monthly Reset implementation

A current Head Nurse can preview and reset their department's DRAFT or PLANNING schedule.
The dialog displays actual assignment/change/cell and retained-preference counts. Cleanup deletes
all working assignments, including OFF and PREFILL, and dependent planning change/cell records.
The Schedule ID/status/month/department, preferences, windows, roster, memberships and staffing pin
remain. Existing coverage calculations refresh from the empty working copy.

A changed plan increments the revision and writes a count-only audit event. An empty eligible plan
is a successful no-op. Other lifecycle states and approval/request/revision history are rejected.
No reason, typed confirmation or preference-window transition is introduced.

## D. Full / Selective Reset implementation

Hospital Admin gets department or application scope, operational presets, optional explicit master
categories, dependency selections with explanations, actual delete/preserve table counts, affected
entities, **all** surviving personnel (outside scope, inactive and orphan accounts included),
blockers, specific capability warnings and recreation requirements. Survivors show name/number,
activity, email, memberships and retained FK reasons, import reservation behavior and profile links.
Deleted identities are separate. The actual CSV preview distinguishes new accounts from existing
account reuse and links identity/email conflicts to profiles. Reset/CSV never changes credentials,
activity or identifiers silently; conflicting identities block all rows until explicit resolution.

Recovery on the same admin page adds only missing standard shifts/reasons. When the hospital
lineage has no versions it restores the original migration 0011 published baseline (fixed ID,
M/E/N min 1/no max, effective 1900-01-01, MIGRATION origin), explicitly disclosed in confirmation.
This is a historical default, not a hospital staffing policy. All existing reference rows, inactive
reasons and staffing versions stay unchanged. Departments and clinical/local bounds are never
invented: the UI and runbook guide approved-value operator provision and normal staffing publication.

Preview runs in a read-only repeatable snapshot. It returns a signed, actor/scope/category-bound
15-minute proof and inventory fingerprint; it stores nothing. A simple impact dialog provides
explicit confirmation. Execution revalidates authorization, freshness, dependencies and scope,
then deletes only approved primary keys in dependency order. Known schedule/version and staffing
version self-links are broken only on rows already selected for deletion. No foreign-key disabling
or unrestricted TRUNCATE CASCADE is used. Survivor equality, foreign keys, counts and administrator
preservation are checked before commit. Repeated resets remain available.

## E. Database migrations

`0013_reset_operations.sql` creates only the independent administrative evidence table. It has no
operational foreign keys and stores administrator UUID, scope/category IDs, timestamp, result,
counts and generic failure code. It stores no personnel names, notes, credentials or preferences.
Completed evidence commits with the deletion; authorized valid failed attempts may record evidence
in a separate transaction after rollback. Invalid/unauthorized previews write nothing.

The migration was applied only to disposable local test databases. Existing pilot data and its
migration history were not changed. Apply this additive migration through the normal approved
deployment process before enabling the new server code. Hardening requires no additional migration.

## F. Authorization and concurrency protections

Full Reset rechecks current stored admin authority under the existing administration advisory lock,
then obtains EXCLUSIVE NOWAIT locks on registered tables. This excludes assignment row lockers and
concurrent inserts/updates. Busy operations return a retry conflict. Signed proof verification,
locked inventory comparison, category/scope recomputation and catalog FK checks all precede deletion.
The executing admin and at least one active credentialed admin survive. Shared personnel with
out-of-scope or retained master/history references are preserved. Cross-scope dependencies and
unregistered FKs block execution.

Monthly Reset uses the existing ordered target/adjacent schedule locks, expected revision and
current membership/account/department locks. It rechecks effective Head Nurse membership using
the repository's Tehran date. Competing assignment/reset writes cannot both succeed at one revision.

Recovery uses the same administration/table locks, plus purpose-bound proofs, fresh snapshot
comparison, schema checks, validated baseline content, exact inserted counts and byte-for-byte
existing-row checks. Both additions and the count-only recovery audit commit together; audit
failure rolls everything back. Repeated fresh confirmations are no-ops. Recovery and deletion
proofs cannot authorize each other.

## G. Historical implementation and hardening test results

All writes used disposable PostgreSQL databases on localhost port 55414. Hardening E2E used a fresh
`hsp_phase14_e2e_test_hardening` database, migrated and fictionally seeded once before verification.
Full Reset browser tests require localhost plus a `phase14_e2e_test` database name and run serially,
separately from other browser suites. Current NICU/pilot/production data was never reset or changed.
Production build succeeded. Lint, typecheck, formatting and unit checks passed.

| Executed verification                             | Passed | Failed | Skipped | Scope                                                                                            |
| ------------------------------------------------- | -----: | -----: | ------: | ------------------------------------------------------------------------------------------------ |
| `pnpm check` unit suite                           |  1,878 |      0 |       0 | 89 files; lint/typecheck/format also pass                                                        |
| Full integration regression suite                 |    984 |      0 |       0 | 46 files, including 15 new business-readiness cases                                              |
| Strengthened business-readiness integration rerun |     15 |      0 |       0 | Included orphan retention assertions; overlaps full suite                                        |
| Selected desktop + Android browser regressions    |     74 |      0 |       2 | Login, personnel identity/mutations, staffing rules, monthly reset, schedule review/creation     |
| Final Full Reset desktop business flows           |      3 |      0 |       0 | Scoped/stale reset, conflict resolution + CSV create/reuse, master reset + recovery + scheduling |
| Full Reset Android business flows                 |      3 |      0 |       0 | Same three complete transitions                                                                  |
| iOS/WebKit Full Reset + Monthly Reset             |      4 |      0 |       0 | Three business transitions plus empty planning/coverage refresh                                  |

Latest browser verification is **84 passed, 0 failed, 2 intentional skips**. Skips are the Android
hardware-keyboard login test and the desktop-only multi-role staffing journey. Desktop Full Reset
was also executed once before strengthening the empty-state page-heading assertions (3 passed);
the final rerun replaces those results and is not double-counted. These are selected affected
browser suites, not the entire E2E repository. No test is reported as passed without execution.

New integration cases verify complete survivor accounting (outside scope, inactive, orphan,
protected and master-referenced identities), conflict detection after reset, explicit personnel
number correction followed by new CSV identity creation, reserved email ownership/profile links,
matching-account reuse without credential overwrite, read-only recovery counts, exact defaults,
valid published baseline and schedule creation following explicit department/membership provision,
no-overwrite custom/inactive policy handling, repeated no-op, current/revoked authorization,
explicit confirmation, cross-purpose proof rejection, stale inventory, invalid shift semantics,
late audit-failure rollback, concurrent writer rejection and racing recovery requests.

The full existing integration suite also checks Monthly Reset states/current membership/revisions,
OFF/PREFILL/change-cell cleanup, retained preferences/windows/roster/pin, protected/full snapshot
history, shared personnel, unknown FKs, last usable admin, concurrent resets/assignment writers,
independent reset evidence, failed deletion rollback and repeatability.

Development checks initially caught mistakes in new test fixtures: wrong ER nurse fixture key
(11 pass/4 fail), then unsupported camel-case CSV headers (12 pass/3 fail). Correcting these to
actual repository fixtures/header names gave 15 passes. An early typecheck rejected a credential
assertion against the deliberately credential-free fixture DTO; the assertion now compares the
isolated database row directly. Earlier pre-hardening test failures are documented in prior review
history and are superseded by the successful complete regression results above.

## H. Known limitations and unresolved risks

- Department creation remains an approved-value operator step; no hospital-specific department is
  generated and no department/shift/reason management form is added. Hospital/department staffing
  forms and personnel correction/membership/CSV forms already exist.
- The restored staffing baseline is the repository's historical min 1/no max. Hospital owners must
  review/publish actual clinical staffing requirements and local exceptions before operational use.
  Existing versions/customizations/inactive reasons are preserved; a missing applicable published
  version must be resolved through existing staffing forms. Inconsistent shift semantics or fixed-ID
  collisions require explicit operator correction and block automatic recovery.
- Protected administrators and users with retained master/global/other-department references remain.
  All identities are visible; inactive accounts still reserve unique numbers/emails. A test account
  with no legitimate replacement number must have its dependencies explicitly resolved/deleted,
  rather than receiving a made-up number. Broader Full Reset selection remains explicit.
- Full Reset/recovery briefly block application-wide writes and fingerprint all registered data,
  even for scoped deletion. Unrelated changes may require another preview. Inventory is in memory
  and suitable for pilot-sized data; large deployments need measured performance validation.
- No backup/history restore is implemented. Failed-attempt evidence is best effort if the database
  is unavailable. Completed reset evidence is atomic and independent of operational foreign keys.
- Browser coverage is selected, not every repository E2E specification. Existing pg client-query
  deprecation warnings remain in regression output and did not fail tests. Desktop-only rapid
  navigation also emitted Next.js `The destination stream closed early` diagnostics; all actual
  page-heading, login, recovery and scheduling assertions passed. Android/iOS did not reproduce
  that diagnostic. Its underlying framework cause is not resolved by this change.

## I. Manual verification steps

Use isolated fictional data only. Detailed steps are in [the runbook](phase-14-reset.md#manual-verification-isolated-environment-only).

1. Preview/reset a partly planned DRAFT and PLANNING month, including OFF, PREFILL and a direct swap.
   Check retained identity/status/preferences/windows/roster/pin, empty cells and zero coverage.
2. Try protected statuses, a nurse, another department's head and a stale tab; expect refusal.
3. Preview one test department as admin. Inspect counts, dependencies, protected/shared people and
   master categories unselected. Modify a cell or hold a writer lock, then confirm; expect conflict.
4. Preview again and confirm. Verify scoped deletion, unaffected departments and independent evidence.
   Repeat on empty data and import new personnel into a retained department.
5. In another disposable database only, explicitly select all master categories/departments. Verify
   zero-department login/admin navigation and capability warnings; cancel deletion and recovery once.
   Restore missing defaults, repeat as a no-op, provision an approved fictional department/membership,
   and create a schedule in the normal UI.
6. Inspect outside-scope/inactive/orphan survivors and their profile links. Import a deliberately
   conflicting number/email: expect whole-file refusal and linked owners. Explicitly correct the
   fixture's incorrectly stored number to its approved actual number, re-preview, import a new
   identity plus reuse a matching existing account, and verify preserved credentials.

## J. PR/merge/deployment readiness

The published feature branch is `codex/phase-14-controlled-data-reset`, Draft PR #26,
reviewed at `fa028f549b9647fd6a564b8e138a5daedd172346`. GitHub Actions
[CI #68](https://github.com/kiani66/hospital-shift-planning/actions/runs/38047506237)
passed all four jobs at that commit on 2026-10-10: lint/typecheck/unit coverage, PostgreSQL
integration, ordinary build/E2E, and isolated reset E2E.

The final read-only review subsequently found a MEDIUM personnel-retention defect and
an invalid regression fixture. The local correction and its verification are recorded
below; CI #68 predates this correction and does not validate these uncommitted changes.
A new authorized commit/push and fresh CI/review are required before merge. Deployment,
applying migration 0013 to the pilot, and any NICU/pilot reset remain unauthorized.

### Historical pre-commit verification

This subsection describes the earlier state before the coverage, AUTH_SECRET and isolated
E2E fixes. Its failures and configuration findings are superseded by the follow-up verification
and successful remote CI #68 below.

The fresh `pnpm check` passed lint, typecheck, formatting and all 1,878 unit tests
(89 files; zero failures or skips). The separately executed CI command
`pnpm test:coverage` ran the same 1,878 passing tests but exited unsuccessfully:
statements 94.55%, branches 90.73%, functions 91.58% and lines 94.47%, against
required 100% thresholds. Integration coverage does not satisfy the unit coverage gate.
The previously recorded integration, selected E2E and production-build results in
section G were verified from their execution logs; they were not rerun at this stage.

Static inspection also identified two CI configuration gaps. The integration job does
not supply the `AUTH_SECRET` required by signed reset previews. Full Reset E2E tests
require a separately isolated database whose host is `127.0.0.1` and name contains
`phase14_e2e_test`; CI currently uses `localhost/hsp_test` and runs all browser tests
together. Configure a separate serial Full Reset E2E job/database without weakening
its destructive-test guard. Remote CI results must be reviewed before merge.

Commit, feature-branch push and draft PR publication are explicitly authorized by the
owner. No production/pilot reset or deployment was performed during verification.
Merge/deployment, applying migration 0013 to the pilot, actual pilot reset and
approved-value operator recovery still require explicit owner approval. Before
clinical use, the owner must supply approved departments/personnel and review/publish
actual staffing requirements; restoration does not invent those business values.

### Follow-up CI hardening and database isolation verification

The Integration AUTH_SECRET fix is preserved. Domain coverage remediation added 17
meaningful reset unit cases and simplified proven unreachable dependency guards.
Fresh full unit coverage now passes: 1,916 tests in 91 files, zero failures/skips;
statements 100% (1,313/1,313), branches 100% (1,027/1,027), functions 100%
(309/309), lines 100% (1,168/1,168). Thresholds and exclusions are unchanged.
The full 984-test integration regression passed during the preceding coverage fix;
it was not rerun for the test-infrastructure-only isolation change.

Full Reset and Monthly Reset browser tests now use `pnpm test:e2e:reset`, a separate
configuration and CI job/service. The runner creates a unique local database, applies
all migrations, seeds only fictional demo data, generates temporary authentication,
starts an independent production server, runs one worker without retries or server
reuse, and drops its owned database in finally. Original database guards remain and
are strengthened by explicit local maintenance, deployment, URL equality, random
name, query-override and external-server checks. Ordinary E2E discovery excludes
these reset specifications while retaining its existing database setup.

Final isolated browser verification: **12 passed, 0 failed/skipped** across desktop,
Android and iOS (9 Full Reset and 3 Monthly Reset cases). Selected ordinary regression:
**72 passed, 0 failed, 2 intentional skips** across desktop and Android for login,
personnel identity/mutations, staffing rules and schedule review. This is selected
regression coverage, not the entire 502-test ordinary browser inventory. Fresh lint,
typecheck, formatting and production build pass. Twenty-one isolation-guard unit
cases pass and are included in the 1,916-test full unit result.

Initial local browser attempts failed because binaries/libraries were outside the
default cache. A subsequent run exposed an existing `networkidle` timeout during
reset sign-in; reset-only readiness now asserts the authenticated URL and account
menu instead. Ordinary authentication helpers remain unchanged. Final iOS verification
used temporary runtime libraries and skipped only Playwright's ldconfig-cache check
because that cache does not see temporary libraries; actual libraries were loaded
and all WebKit browser assertions ran. CI installs normal browser/system dependencies
with `--with-deps`; no validation bypass is committed. Existing Next.js stream-close
log diagnostics remain despite passing assertions.

A deliberate no-matching-test invocation returned failure and still dropped its
generated database, confirming cleanup on test failure. SIGINT/SIGTERM are handled;
SIGKILL/runner loss may leave a local test database requiring exact-name operator
cleanup. CI service destruction removes its disposable databases when the job ends.
No existing NICU/pilot data was changed. These fixes were subsequently committed and
pushed as `6faf5b77750ca2410f4772aeccd685dc3f45643d`. The build-environment fix
was published as `fa028f549b9647fd6a564b8e138a5daedd172346`; CI #68 then
passed all four jobs at that HEAD. The new personnel-retention correction below remains
local and uncommitted.

Additional files: `.github/workflows/ci.yml`, `package.json`, `playwright.config.ts`,
`playwright.reset.config.ts`, `scripts/test-e2e-reset.ts`,
`scripts/support/reset-e2e-safety.ts`, `tests/unit/reset-coverage.test.ts`,
`tests/unit/reset-e2e-safety.test.ts`, and `tests/e2e/support/reset-auth.ts`, plus
updates to existing reset browser specs and this report/runbook.

### Personnel retention correction after the final review

Root cause: the planner treated any out-of-department FK as a retention dependency even
when that global record was explicitly selected for deletion. Its account survived with
a reserved personnel number/email and a generic explanation despite having no remaining
reference. The unit fixture for that case also removed local staffing versions still
referenced by schedules, requirements and date exceptions.

The correction excludes already-selected deletion rows from personnel-retention checks.
Protected administrators, genuine other-department/global references and retained master
data remain protected; scope expansion, proof validation, FK checks and transaction locks
are unchanged. Survivor explanations use the actual protection/category/scope or remaining
FK cause; the obsolete generic fallback is removed. The replacement unit fixture keeps
all referenced versions and asserts that its populated FK relationships resolve.

Two real PostgreSQL regressions create a hospital draft through the existing command,
explicitly clear its global operational audit through an application-scoped test reset,
and then perform a department-scoped reset with hospital rules selected or retained.
They verify deletion and subsequent CSV reuse of both unique identifiers, credential-free
new-account creation, specific retained-rule explanations, conflict refusal when a dependency
survives, unchanged other-department memberships, and byte-for-byte protection of the executing
administrator. Before the fix: 1 passed, 1 failed, 15 filtered skips; the failure demonstrated
the reviewed defect against valid migrated data. After the fix: all 17 business-readiness
integration cases passed, with no failures or skips.

Verification uses a newly created disposable PostgreSQL 17 container and database
`hsp_phase14_retention_test`, bound only to 127.0.0.1 on a dynamically allocated port.
Tests run from a separate copy without local environment files or build artifacts, so
integration setup cannot override the disposable URL from `.env.local`. No existing test,
NICU, pilot or production database is used. Temporary authentication is generated per run.

Full unit coverage: 1,916 passed in 91 files, zero failures/skips; statements 100%
(1,311/1,311), branches 100% (1,025/1,025), functions 100% (309/309), lines 100%
(1,167/1,167). Coverage thresholds/exclusions and the AUTH_SECRET/E2E isolation fixes
are unchanged. Full integration regression passed: **986 tests in 46 files, zero failures
or skips**, including the 17 business-readiness cases above (not additional tests to sum).
Lint, Next.js route type generation/TypeScript typecheck, and the repository-wide Prettier
formatting check passed.

This workspace runs Node 24.19.0 / pnpm 11.19.0 rather than the repository's Node 22 /
pnpm 10.33.0 CI toolchain. Commands used `--config.verify-deps-before-run=false` to
prevent pnpm 11 from attempting an automatic dependency reinstall in the verification
copy; dependencies and lockfile were not changed. The first invocation aborted before
test execution because of that reinstall behavior. Existing pg concurrent-query
deprecation warnings occurred without failures. Fresh CI on the declared toolchain
is still required; no build or E2E rerun is claimed for this domain-only correction.
No schema migration, UI authorization change, identifier rewrite, commit, push, merge or
deployment is part of this correction. Existing operational limitations in section H remain.
