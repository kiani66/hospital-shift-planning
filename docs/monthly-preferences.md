# Monthly preference application — Stage 1

## Architecture audit and replacement contract

Preferences are single values keyed by `(schedule_id, user_id, date)`; absence
means no preference. Values are M/E/N/ME/OFF, never H. Assignments have the same
cell key, a roster FK and MANUAL/PREFILL source metadata. Manual edits replace
that source; there is no durable preference-to-assignment ownership or import
cursor. The smallest safe replacement scope is therefore **current preference
cells**, never all monthly assignments or all historical PREFILL rows.

Every execution reads the complete current preference set under the schedule
lock. Eligible preference cells replace M/E/N/ME/OFF decisions, including manual
changes and decisions from a prior application. ME stays one decision covering
M and E; OFF becomes explicit rest. H leave is preserved and reported as skipped.
Cells without a current preference remain untouched, including previously
applied cells whose preference was subsequently cleared. Equal values count as
unchanged, not newly applied; no source/audit rewrite occurs for equal values.
Applied count means inserted or changed assignments. No preferences is a no-op.

Roster membership, active accounts and department membership effective on the
assignment date are required. Ineligible cells are skipped with a date, person
and reason; eligible cells commit together. Preferences, windows, roster,
approved history, other schedules and unrelated cells are never modified.

## Approved workflow scope

The operation requires DRAFT or PLANNING at execution time and ignores window
state. Existing OPEN_PREFERENCES transitions DRAFT to PLANNING; closing keeps
PLANNING, and nurses cannot register preferences in DRAFT. The product owner
explicitly approved including PLANNING during Stage 1 implementation so the normal
collection workflow can use this action. Both statuses remain unchanged on apply;
FINALIZED and all later workflow states are refused. Collection transitions and
window permissions are unchanged. Tests cover actual nurse registration with an
open window and application both before and after closing it.

## Integrity, validation and concurrency

The command uses defineCommand's transaction, existing assignment/boundary locks,
shared eligibility locks, fresh server authorization and expectedRevision. Preference
writes take a shared schedule lock, so an application sees all saves committed
before its exclusive lock; later saves wait and are included in the next run.
Assignment changes and their audit, aggregate application audit and revision bump
commit atomically. A stale revision fails even when there would be no changes.

The ordinary assignment planner/writer enforce cell, roster and period integrity.
Changed rows use the existing PREFILL source. The existing working-copy validator
evaluates the final result against pinned staffing and adjacent boundary days.
NIGHT_REST, STAFFING and UNDECIDED remain draft findings with their existing error
severity; they still block FINALIZE/SUBMIT/APPROVE. Structural/unknown findings
abort and roll back. No rule is weakened and no staffing numbers are invented.

## UI

The existing monthly toolbar and confirmation dialog show «اعمال ترجیحات ماه».
Confirmation explains replacement, H preservation, incomplete coverage, excess
and rule violations. Success reports changed/unchanged counts and individual
skips in Persian; the actual schedule refreshes with its existing diagnostics
and normal editing controls. No proposal, daily suggestion or Stage 2 flow exists.

## Changed components

- `src/domain/preferences/apply-monthly.ts`: deterministic current-cell replacement
  plan, exclusions and unchanged count, reusing `planAssignmentEdits`.
- `src/application/schedules/apply-preferences.ts`: DRAFT/PLANNING gate, authorization,
  eligibility, locking, persistence, validation and aggregate audit.
- `src/application/schedules/edit-assignments.ts`: optional existing PREFILL source
  for the shared assignment writer; ordinary callers retain MANUAL behavior.
- `src/features/schedule/{actions,preference-application,schedule-overview,
confirm-action}.ts(x)`: thin action adapter, Persian messages, confirmation and
  accessible result/skip details.
- Monthly schedule page and toolbar CSS: action placement and constrained result
  layout using the existing RTL layout.
- Domain unit tests, database integration tests and browser fixtures/specs cover
  replacement, eligibility, rule findings, failure, concurrency and normal editing.

No schema, migration, dependency, new role or workflow state is introduced.

## Verification

Verified locally with Node 22.23.3, pnpm 10.33.0, PostgreSQL 17 and a production
Next.js build:

| Check                                            | Result                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `pnpm check`                                     | Lint, typecheck, format and all 2,537 unit tests passed                         |
| `pnpm test:coverage` (isolated report directory) | 2,537 tests passed; domain statements, branches, functions and lines all 100%   |
| `pnpm test:integration`                          | All 1,267 tests across 59 files passed on the final implementation              |
| Final preference integration suite               | All 23 cases passed, including actual open/closed-window collection in PLANNING |
| `pnpm build`                                     | Passed                                                                          |
| Feature browser flows                            | All 12 cases passed across desktop Chromium, Android Chromium and iOS WebKit    |

All 21 existing toolbar cases also passed across the final matrix and focused
reruns, giving 33 relevant passing browser cases overall.

Browser flows cover cancellation, persisted replacement, skipped H, continued
editing, reapplication, real nurse updates in PLANNING, open and closed windows,
empty preferences, locked states and stale confirmations. Existing toolbar tests
check eight widths from 320px through 2560px, RTL geometry, focus, disclosure,
workflow states and denied Nurse access. They caught and verified the fix for a
dropdown overlapping a multi-row primary action group.

The initial combined browser matrix passed 30 cases; three existing revision
toolbar cases failed before UI assertions while dynamically loading ExcelJS's
`generator-function` dependency (`request for './index.js' is from a module not
been linked`). All three passed on rerun with
`NODE_OPTIONS="${NODE_OPTIONS:-} --no-experimental-require-module"`, using the
dependency's CommonJS path. No assertion, application code, dependency or CI
configuration was changed for that local Node compatibility issue. Earlier
parallel CLI test timeouts were resolved by serial execution. Local WebKit used
the environment's installed runtime libraries; all browser assertions remained
enabled. One iOS revision-toolbar rerun reached its viewport-interaction timing
limit; an isolated trace-enabled rerun passed without changes. The 33 browser
cases passed across the final runs, rather than in one combined command.

## Screenshots

| View    | Confirmation                                                        | Applied result                                                                |
| ------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Desktop | [Confirmation](screenshots/monthly-preferences/desktop-confirm.png) | [Summary and skip reason](screenshots/monthly-preferences/desktop-result.png) |
| Android | [Confirmation](screenshots/monthly-preferences/android-confirm.png) | [Summary and skip reason](screenshots/monthly-preferences/android-result.png) |
| iOS     | [Confirmation](screenshots/monthly-preferences/ios-confirm.png)     | [Summary and skip reason](screenshots/monthly-preferences/ios-result.png)     |

[Normal PLANNING workflow after nurse updates and window closure](screenshots/monthly-preferences/desktop-planning-result.png).

## Remaining limits

- Clearing a preference does not revoke an earlier assignment. Durable ownership
  is unavailable; broader cleanup would need a separately agreed data model.
- H preservation is deliberate: cancelling personal leave remains a manual
  decision, even when a current shift/rest preference differs.
- Large rosters retain the existing per-cell writer and shared eligibility locks;
  this delivery does not introduce a new large-scale performance guarantee.
- Stage 2 daily suggestions are outside this implementation.
