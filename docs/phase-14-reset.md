# Phase 14: Controlled pilot reset and monthly planning reset

These are independent features. Implementation and validation use disposable local databases;
never run a reset on the current NICU/pilot database as part of development. Push, merge,
deployment, migrations on the pilot database, and actual pilot resets need owner approval.

## Architecture

`domain/reset/categories.ts` is the product-category registry. `domain/reset/plan.ts` calculates
record-level dependency closure and protected/preserved entities without database access.
`infrastructure/repositories/reset-inventory.ts` derives primary/foreign keys from the actual
Drizzle definitions with the repository's snake-case mapping and compares incoming foreign keys
against PostgreSQL's catalog. Unknown dependents block execution. Table names never come from
client input. Application queries/commands authorize; Persian RTL adapters provide previews and
simple confirmation dialogs.

| Feature                    | Full / Selective Reset                                                          | Monthly Planning Reset                                                                     |
| -------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Authority                  | Active Hospital Admin, rechecked under administration lock                      | Current Head Nurse membership of the schedule's own department                             |
| Scope                      | Selected departments, or application-wide                                       | Exactly one schedule                                                                       |
| Status                     | Any, including explicitly confirmed approved pilot schedules                    | DRAFT or PLANNING only, with no approval/request/revision history                          |
| Schedule identity          | May be deleted when selected or required                                        | ID, period, department and current status stay unchanged                                   |
| Preferences/windows/roster | May be deleted as selected/required                                             | Preserved byte-for-byte                                                                    |
| Reference data             | Optional explicit master selection                                              | Preserved, including the staffing-rule pin                                                 |
| History                    | Explicit pilot-retention exception; minimal independent reset evidence survives | Existing operational audit stays; one lightweight count-only reset event for a real change |

## Categories and scope

Full Operational Reset selects schedules/initialization, assignments, preferences, requests,
planning changes, memberships/supervisor assignments, personnel, notifications and operational
audit by default. Departments, shifts, change reasons, department staffing rules and Hospital
Default staffing rules start unselected. Shift types, change reasons and Hospital Default rules
are labelled global. Selecting global data never grants permission to delete dependencies in an
unselected department: those references block a departmental plan.

Removing a department requires its local schedules, dated access relations and departmental
configuration. Dependencies are shown with table-to-table explanations, automatically checked
and locked in the UI. Automatically selecting a category uses the same scope as manually
selecting it, including all of its rows inside that scope. Only rows within the approved scope
are added. Personnel eligible in a
department scope come from its memberships, supervisor assignments and historical rosters.
Shared personnel or personnel referenced by retained master data/global history are preserved.
Unscoped notifications and unscoped audit are preserved in departmental resets. Inconsistent
explicit department/schedule attribution also cannot be treated as department-local.

The executing administrator is always excluded from deletion. If that account lacks credentials,
a deterministic additional active credentialed admin is protected; no usable admin blocks the
plan. Execution verifies the current account and the usable-admin count again. Security login
throttles, migration history and independent reset records are not reset categories.

## Read-only preview and concurrency

A REPEATABLE READ / READ ONLY transaction produces actual table/category delete/preserve counts,
entity summaries, automatic dependencies, protected/shared users, blockers, warnings and master
data requiring recreation. Preview writes no audit, operation or preview rows. Password hashes
are excluded at the SQL boundary; an internal credential digest participates in freshness and
is never returned in the preview or operation record.

The response has a random preview ID, timestamp, SHA-256 inventory/selection fingerprint and
HMAC proof bound to actor, scope, categories and fingerprint using the existing `AUTH_SECRET`.
Proofs expire after 15 minutes. Rotating `AUTH_SECRET` invalidates pending previews. Explicit
confirmation is a boolean sent only from the impact dialog; no typed phrase or mandatory reason.
A used preview ID cannot execute again.

Full Reset uses `defineCommand`, the existing administration advisory lock and current stored
admin authority. It acquires EXCLUSIVE NOWAIT locks on the registered reset tables and independent
operation table. EXCLUSIVE also excludes row lockers, unlike SHARE ROW EXCLUSIVE; NOWAIT avoids
waiting in conflicting lock orders. Plain SELECT readers continue. An active writer/locker returns
`RESET_BUSY`; obtain a fresh preview and retry. These brief locks temporarily prevent writes in
other departments too, but deletion predicates never expand their scope.

The plan and catalog are rebuilt under locks. The fingerprint includes the entire registered
inventory conservatively, so even unrelated registered-data changes invalidate a preview. Locks,
not the digest, prevent inserts/updates while deletion and integrity checks execute.

Deleted schedules' current-version links and deleted staffing versions' self-links are nulled
only on rows already approved for deletion. Dependency-safe, primary-key-constrained DELETEs then
remove selected rows, including approved snapshots and legacy requests. Foreign keys stay enabled;
there is no TRUNCATE CASCADE. Before commit, the command checks every remaining registered FK,
all expected survivors, exact delete counts and admin preservation. Any failure rolls the whole
business deletion back.

## Independent reset evidence and migration

Migration `0013_reset_operations.sql` only creates `reset_operations`; it neither resets data nor
rewrites existing relationships. The table has no operational foreign keys. It holds the preview
ID, executing administrator UUID, scope IDs, selected/automatic category names, timestamp, result,
per-table counts and a generic error code for a failed attempt. It holds no personnel names,
preferences, assignment snapshots, reasons, credentials or proof. Successful evidence commits with
the deletion. After rollback, authorized valid attempts may record a minimal FAILED row in a
separate transaction; a database outage can prevent that failure record. Invalid/unauthorized
previews write nothing. Independent records are excluded from every reset category and retained
across repeated resets.

## Monthly cleanup

The scheduling header offers Reset Planning only for DRAFT/PLANNING. Preview shows department,
month, status, assignments, planning changes/cells and retained preference count. Execution uses
the assignment writers' ordered target/adjacent schedule lock protocol, locks the current user's
account and department membership rows, and rechecks current effective membership on the Tehran
day. Stale revisions are refused before cleanup, including empty requests.

It removes `shift_assignments` (MANUAL/PREFILL, including OFF), `schedule_change_cells` followed by
`schedule_changes`. Direct swaps can create those reason/note-bearing records during planning;
there are no separate assignment-note or planning-override tables. Approved versions, submissions,
revisions or nurse/legacy requests on an otherwise eligible status block cleanup rather than
using Full Reset's exceptions. The staffing-rule application history/pin remains. A real cleanup
bumps the schedule revision and records counts; an already empty eligible schedule succeeds
without a revision bump. DRAFT remains DRAFT; PLANNING remains PLANNING because moving it to DRAFT
would disable nurse preference editing. Windows are never changed. Normal page refresh recomputes
coverage and calendar cells from the empty working copy.

## Recovery and limitations

Operational reset preserves departments and master definitions. Before importing real staff, inspect
**every** retained identity in Full Reset preview, including inactive, outside-scope and orphan
accounts. It shows name, personnel number, email, effective-dated memberships (and whether each
will remain), specific retained FK references and profile links. Deleted identities are separate.
No uploaded CSV is assumed: the preview describes potential reservations, not invented conflicts.
The existing CSV preview shows actual CREATE / ADD_MEMBERSHIP / UNCHANGED / ERROR results, with
profile links for matched personnel numbers and email owners.

The importer matches **personnel number only**. Active matching identity may reuse an account
without changing its credentials; incompatible name, supplied email/mobile, membership dates/role
or an inactive account blocks the entire file. A new number cannot claim another account's email.
Deactivation does not release either unique identifier. Resolve wrong stored identity using the
existing audited profile controls, or explicitly broaden a subsequent reset to the dependencies
preventing deletion. A personnel number cannot be cleared: correcting it requires the account's
actual approved unique number, never an invented placeholder. Do not relabel a different test
person as a real employee. Email may be explicitly corrected/cleared if a personnel number remains.
Preview the CSV again before committing. Existing accounts' passwords are never reset by import.
If an unwanted test account has no legitimate alternative number and must remain referenced,
resolve the retained dependencies and explicitly delete it; do not invent a replacement identity.

### Controlled default recovery

Hospital Admin uses the recovery section of `/admin/reset`: read-only snapshot, actual missing and
preserved counts, explicit confirmation, then one transaction under the administration advisory lock
and EXCLUSIVE NOWAIT table locks. The 15-minute signed proof binds the actor and **recovery purpose**;
it cannot authorize Full Reset. Changed inventory or an active writer refuses execution. Existing
rows must remain byte-for-byte unchanged; inserted counts are verified before a count-only
`masterData.defaultsRestored` audit. A failure (including audit failure) rolls back every insert.
Fresh repeated previews/execution return a no-op once defaults exist; an old changed preview is stale.

Only missing shift codes M/E/N/ME/OFF and seven reason codes are added, with the exact current
migration defaults (0002/0007/0010/0012, ME label «طولانی», OTHER note mandatory). Existing customized
labels, inactive reasons and other codes are retained, never silently reactivated or replaced.
An incompatible existing shift's coverage/night semantics blocks recovery and requires separately
reviewed operator correction. No runtime shift-label fallback is added.

If the Hospital Default lineage has **no versions**, restore migration 0011's original published
legacy baseline identity: M/E/N NORMAL min 1, max null, no holiday overrides/date exceptions,
effective 1900-01-01, origin MIGRATION. This preserves compatibility FK defaults; it restores the
repository's historical baseline, **not a newly invented clinical staffing policy**. The preview
and confirmation explicitly state its bounds and require hospital review before clinical use.
The operation is separately attributed to its executing admin in the audit. If _any_ hospital
version exists, preserve the entire lineage/policy; do not introduce another baseline or overwrite
DRAFT/PUBLISHED/RETIRED content. Publish/recover an applicable version through existing staffing
forms. Fixed-ID collisions or unknown FK schema changes block execution.

### Department recovery (operator procedure)

There is no department creation UI. Automatic recovery deliberately creates **zero departments**.
Minimum steps after deletion:

1. Owner authorizes the target environment and supplies each actual department's unique stable
   code, official name, and supported timezone (the application uses Asia/Tehran). No fictional
   NICU/ICU rows or demo seed may be used to recover real data.
2. An authorized database operator connects to the intended environment and creates only those
   explicitly approved departments. Example **parameterized psql procedure** below; values are
   requested, not embedded defaults. Run separately per approved department. The unique code
   and transaction prevent replacement of an existing department. A new UUID is assigned.
3. Admin previews/confirms missing reference recovery; this may also be done before step 2.
4. Admin previews CSV, resolves identity conflicts, imports staff into the active department,
   and establishes an effective HEAD_NURSE membership using the personnel profile form.
   New imported accounts need an explicitly issued temporary password before sign-in.
5. Admin reviews and publishes actual hospital staffing requirements at `/admin/staffing-rules`;
   the Head Nurse can publish approved department overrides at
   `/departments/{approved-code}/coverage-rules`. The published effective day must cover the
   intended month start. Recreate any hospital-specific holidays/exceptions, shifts or reasons
   through a separately approved operator/configuration procedure; these are never guessed.
6. That department's Head Nurse creates the month in the normal scheduling UI. Creation pins an
   applicable published rule and initializes the roster. Missing departments/memberships/applicable
   versions prevent creation; nothing is silently synthesized.

```sql
-- psql connected by the authorized operator to the approved target. No reset or seed here.
\prompt 'Approved unique department code: ' recovery_department_code
\prompt 'Approved official department name: ' recovery_department_name
BEGIN;
INSERT INTO departments (code, name, timezone, is_active)
VALUES (:'recovery_department_code', :'recovery_department_name', 'Asia/Tehran', true)
RETURNING id, code, name, timezone;
COMMIT;
\unset recovery_department_code
\unset recovery_department_name
```

Reject blank/unapproved inputs before running this procedure. A duplicate code fails without
changing the existing row. There is no ON CONFLICT update, no identity/history reattachment and
no credential modification. Supported timezone is explicitly verified by the operator. This is a
runbook, not authorization to run it against current pilot data during development.

Capability losses are displayed in both selection preview and deletion confirmation: departments
remove department access/import destinations; shift definitions remove operational calendars,
preferences/my shifts/requests and assignment entry; active reasons enable reasoned requests and
adjustments; local rule deletion falls back to an applicable hospital rule, and no applicable rule
blocks month creation. Existing administrator navigation and recovery work with zero departments
or shift definitions. Staffing forms already exist; shift/reason/department management forms do not.

The planner loads registered pilot data in memory and performs conservative FK closure and
integrity checks. This suits the pilot; large installations need measured scaling and potentially
batched inventory/hash queries. Full Reset takes brief application-wide write locks even for a
department scope. Cross-department/global blockers require a broader explicitly selected scope or
retention of the referenced entity, never silent widening. No automatic backup/restore is added.

## Manual verification (isolated environment only)

1. Apply migration 0013 to an empty disposable test database and provision fictional accounts.
2. As a Head Nurse, assign M, OFF and prefilled decisions; optionally make a direct swap. Open
   preferences and save a nurse preference. Preview/reset the planning: confirm unchanged schedule
   ID/status/roster/windows/pin and preference, empty cells and recomputed coverage.
3. Try another department's head, a nurse, a stale tab and all protected statuses. Confirm refusal.
4. As an admin, open `/admin/reset`, select one test department and operational categories. Check
   table counts, auto selections, shared-personnel preservation and master categories unchecked.
5. Change a cell after preview: confirmation must refuse the stale plan. Keep a test row lock or
   uncommitted insert open: reset must return busy without partial deletion.
6. Preview again and explicitly confirm. Check target rows removed, unrelated rows unchanged,
   current admin login working and one COMPLETED independent record. Repeat on empty data.
7. Import new personnel into a retained department. Separately verify a full master/department
   reset only in another disposable database: zero-department page and login remain usable,
   reference-dependent pages explain the need for recreation.

8. In isolated data, retain an outside-scope account's number/email. Confirm the reset preview lists
   it and the CSV preview links its conflict. Explicitly correct the erroneous stored number to
   that fixture's approved actual number; re-preview CSV and verify new-account creation and
   matching-account reuse without a credential change.
9. Explicitly select all master categories, inspect capability warnings, cancel once, then confirm.
   Verify login and admin personnel/import/staffing/profile/reset navigation with zero departments.
   Preview recovery, cancel once, confirm, and repeat as a no-op. Provision an approved fictional
   department and effective Head Nurse membership using the operator procedure, then create a month.
