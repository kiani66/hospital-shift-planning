# Daily preference assistant — Stage 2 / PR 2

`src/application/schedules/daily-preferences.ts` adds the authorized preview and
acceptance use cases on top of the merged [domain planner](daily-preferences-domain.md).
There are no Server Actions, UI, schema changes or migrations in this slice.

## Preview contract

`readDailyPreferences(ctx, { scheduleId, date })` returns a consistent, read-only
REPEATABLE READ snapshot. It requires the department's current, active Head Nurse
and a DRAFT/PLANNING schedule in an active department. Preference windows are not
an access gate. Like other application queries, malformed/denied/missing/locked
requests throw typed errors; a later adapter can use `toActionError` to present
them without exposing infrastructure failures.

The result contains schedule/date/revision, the domain plan, a signed `proof`,
named M/E/N/ME suggestion rows, informational OFF rows and per-group `bulkEligible`.
Row status and assessment expose already-assigned nurses, different existing
decisions, eligibility denials and structured hard-rule findings. Domain coverage
distinguishes actual current coverage/shortages from projected bulk coverage.

The use case loads the actual pinned version, dated memberships/accounts, the
complete working copy and roster, the selected day's preferences and official
holiday dates. It loads both external boundary days for the entire roster,
including nurses with no assignment this month. No preview, audit or rejection
record is written.

## Acceptance contract

```ts
acceptDailyPreferences(ctx, {
  scheduleId,
  date,
  expectedRevision,
  proof,
  operation: { kind: "ONE", nurseId },
  // Or: operation: { kind: "BULK", excludedNurseIds: [] }
});
```

The command returns the existing `ActionResult` envelope. The client supplies
identity and intent; the server derives the shift from its current preference.
Unknown authoritative-looking fields are stripped by the input schema. Exclusion
arrays are bounded to 500 UUIDs and interpreted as a set; they persist nowhere.
UUID inputs are canonicalized before identity comparisons and proof binding.

ONE may deliberately choose an individually eligible nurse from a contended
group. A matching assignment is a no-op with an already-assigned outcome. Any
different assignment, including OFF/H, or an informational/ineligible preference
is refused. New/worsened hard findings return `RULE_VIOLATION` with violations.
Below-minimum coverage is allowed to improve progressively; its error severity
and Finalize/Submit/Approve gates are unchanged.

BULK rebuilds the full domain plan. Session exclusions never reduce contention
demand. Every contributing group in M/ME or E/ME contention is skipped without
choosing a subset; safe independent groups proceed. Existing and informational
rows stay visible in the result. A no-preference/no-change batch succeeds with
zero creations and no audit/revision mutation.

All accepted rows form one atomic batch, reassessed with `assessEdits` and planned
with `planAssignmentEdits`. Persistence uses the existing
`writeAssignmentChanges({ insertOnly: true, source: "PREFILL" })`. Each creation
has the standard `assignment.created` audit. A nonempty acceptance also records
`schedule.dailyPreferencesAccepted` (date, operation, count) and bumps the schedule
revision once. A failed write/audit rolls back assignments, audits and revision;
the response is an error, never partial success.

Successful results contain:

- `scheduleId`, `date`, `revision`, `createdAssignmentCount`, `alreadyAssignedCount`.
- `outcomes`, with nurse/name/preference/previous decision, CREATED /
  ALREADY_ASSIGNED / INFORMATIONAL / SKIPPED, reason and blocking violations.
  ONE outcomes concern the selected person; BULK outcomes concern every daily row.
- `skippedSuggestions`, including informational rows, and execution-time
  `skippedGroups` for BULK.
- `groupsRequiringManualSelection` in the resulting current plan and per-person
  `hardRuleConflicts` for skipped rows.
- Actual post-command `coverage`: bucket/source, covered/minimum/maximum,
  available capacity and `remainingShortage`. These counts never include a later
  hypothetical acceptance. They do not declare the schedule ready to publish.

Single business refusals return VALIDATION plus a stable reason such as
EXISTING_ASSIGNMENT / OFF_PREFERENCE / NON_NURSING_PREFERENCE /
INACTIVE_OR_NOT_MEMBER / NO_PREFERENCE, or RULE_VIOLATION plus findings.
Authorization, missing resources and lifecycle have their existing error codes.
Unexpected infrastructure failures return INTERNAL through `defineCommand`.

## Freshness and locking

The proof follows Schedule Copy's namespaced SHA-256 fingerprint / HMAC pattern,
using AUTH_SECRET, actor + schedule/date binding and a 15-minute lifetime. It binds
the lifecycle/revision/pin, working assignments, boundary decisions, preferences,
roster, dated eligibility and pinned staffing/holiday inputs. A data-identical
preference edit cycle is not treated as a semantic change. No durable preview or
new revision column is required. The proof intentionally permits either ONE or
BULK intent against the same reviewed data; it is not assignment authorization.

Acceptance first acquires the existing globally UUID-ordered target/boundary
schedule locks. It then takes the existing short shared eligibility table locks,
reloads authority and lifecycle, checks expectedRevision and the signature/expiry,
loads and fingerprints current inputs, and reassesses the exact intended batch.
Preference saves take a shared schedule lock, so they serialize with acceptance
despite not bumping schedule revision. Roster/account/membership protections and
boundary locks remain held through commit. Snapshot mismatch/expiry returns
CONFLICT / DAILY_PREFERENCES_STALE; revision mismatch returns CONFLICT. No stale
operation is automatically retried or translated to a changed wish.

The broad eligibility locks match monthly application and Copy. Reads are batched,
not per nurse; post-command coverage is computed from the loaded context in memory.
The existing holiday port is used unchanged (currently no holiday data in the
default request context); wiring protected calendar data remains separate work.

## Aggregate conflict review

No planner correction is needed for today's rules. A valid input has one
preference per nurse/day; night rest is personal and is filtered per person.
Staffing is the only current cross-person aggregate conflict and contended groups
are removed before batch assembly. Thus the aggregate refusal guard does not
suppress independent eligible groups. Integration tests exercise safe E/N groups
beside M/ME contention, safe Night beside two-bucket contention, and safe rows
beside individual rest conflicts. Domain tests already cover symmetric E/ME
behavior. An application test injects an aggregate finding to retain fail-closed
behavior if a future shared rule appears; no processing-order salvage is added.

## Verification scope

Application tests cover the read-only transaction boundary, lock/write order,
insertion-only persistence, malformed input, signing configuration, infrastructure
errors and aggregate refusal. PostgreSQL tests exercise real persistence/audits,
atomic rollback, revision/no-op behavior, capacity, same-period/boundary rest,
stale proofs and changed preferences, authority/eligibility, window independence
and concurrent acceptance/manual/monthly/preference/membership/account/boundary
writes. Existing monthly application, manual editing, candidate, Copy and
publication tests remain regression gates.
