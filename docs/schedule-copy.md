# Smart Schedule Copy

The Head Nurse monthly schedule page offers **کپی برنامه** on editable schedules.
The current month is the target. A recent earlier schedule is suggested; every
visible schedule of the same department, including the target itself, is selectable.

## Supported operations

- **Whole month:** map the first period day to the first target period day, and
  so on. For monthly schedules this is the Jalali day number. Excess source days
  are reported as `TARGET_DATE_DOES_NOT_EXIST`, never rolled into the next month.
  The domain remains calendar agnostic; arbitrary schedule periods use their
  ordinal period day, consistent with the existing inclusive-period model.
- **Day:** map one explicitly selected source date to one target date.
- **Range:** map an inclusive source range positionally from a target start date.
  A range may overlap its source in the same schedule. Planning reads a stable
  source snapshot, so newly inserted cells never become source cells.
- **Selected personnel:** an optional source-roster selection restricts any mode.
  The application API also accepts selected composite source cells (`nurseId`,
  ISO `date`), matching the existing assignment primary key. There is no separate
  per-assignment UI selection engine.

Only assignments are considered. Source `H` leave is explicitly skipped
(`SOURCE_LEAVE_NOT_COPIED`), as confirmed for this phase: leave belongs to its
original date. OFF remains an explicit scheduling decision and can be copied.
No preferences, preference windows, roster rows, workflow metadata, statuses,
approvals, source history, staffing configuration or validation results are copied.

## Preview and validation

Preview runs in a read-only repeatable-read transaction. It returns source count,
per-source-cell outcomes and stable reason codes, proposed assignments, unchanged
and skipped counts, conflicts, affected personnel, target dates, rule assessments,
preference notes and coverage before/after under the target's pinned rule version.
Persian messages and shift labels are applied by the presentation layer.

Target roster membership is mandatory; nobody is added automatically. Active
accounts and effective department membership on each target date are also checked.
Every occupied destination cell is preserved, including H and OFF. An exact match
is unchanged; a different value is a visible conflict/exclusion. Missing target
roster members, invalid dates, ineligible memberships and source H are explicit skips.
Locked states and dates outside an open revision are excluded through the existing
`canEditAssignment` rule. Copy never opens or extends revisions.

The proposed batch is assessed together by `assessEdits`, using target staffing,
holiday/date exceptions, nursing-versus-secretary coverage and adjacent schedules'
boundary assignments. An introduced or worsened hard violation blocks **the whole
proposed batch**. The user can narrow the scope and preview again. Existing unrelated
or non-worsened findings retain the established assessment semantics. Structural
exclusions do not block otherwise valid proposed rows. Engine warnings remain
non-blocking. Current validators emit hard errors; there is no new soft rule.

There is no independent leave/unavailability store in this repository. Recorded
H occupies the target cell and is never overwritten. OFF wishes remain advisory
preferences under D35/D50, displayed as target-preference differences; copy does
not turn them into hard unavailability or couple to Shift Change Requests.

## Apply, authorization and concurrency

`previewScheduleCopy` and `applyScheduleCopy` are separate application operations,
exposed through thin authenticated Server Actions. The existing `assignment.edit`
and `schedule.viewDepartment` policies govern access. Hospital Admin, Supervisor,
Nurse and Secretary roles gain no new scheduling authority. Actor authority is
re-read inside preview/apply, including dated memberships and active-account state.

Preview supplies an actor/request-bound HMAC proof, using the existing `AUTH_SECRET`
convention from schedule import, valid for 15 minutes. It fingerprints the source
and target schedules/assignments, target roster, dated memberships/accounts,
preferences, revision, boundary assignments, resolved target staffing and the plan.
No preview table or migration is required.

Apply locks the target, its boundary schedules and the source in one global UUID
order, extending the existing assignment-writer lock protocol. It reuses the import
membership/account/department shared-lock helper, then reauthorizes and rebuilds the
plan. Any changed fingerprint or invalid/expired proof fails with
`SCHEDULE_COPY_STALE`; no alternative plan is silently substituted. Existing editor
roster/status/revision planning is checked again before persistence. Copy uses plain
insert-only assignment writes: even an unexpected writer outside the locking
protocol cannot cause an upsert to overwrite an occupied cell. All assignments,
ordinary `assignment.created` history, the aggregate `schedule.copied` event and the
single schedule revision bump commit or roll back together.

The aggregate audit records actor/time through the existing audit infrastructure,
source/target IDs, mode and dates, selection, target dates, inserted/excluded counts
and the reviewed fingerprint. Existing per-cell history is retained. Replay or
concurrent duplicate submission cannot create duplicates: locks and the changed
schedule revision invalidate the proof; the UI also guards the in-flight request.

Cancel discards the preview. After apply, normal authorized schedule editing is
available. The editor's local revert helper is not a persisted atomic/global undo;
copy adds no global undo framework.

## Verification

Automated coverage is in:

- `src/domain/schedule/copy.test.ts`: mapping, period lengths, selections, roster,
  occupancy, personal leave, target preferences, workflow/revision scopes,
  staffing/rest and same-schedule overlap.
- `tests/integration/schedule-copy.test.ts`: read-only preview, audited transactional
  apply, injected failure rollback, authorization/revocation, historical sources,
  eligibility, pinned holidays, stale dependencies and concurrent duplicate apply.
- `tests/e2e/schedule-copy.spec.ts`: the Head Nurse preview/apply flow with preserved
  target leave and advisory preferences, blocking rules/cancel, and overlapping
  same-schedule range copy with selected personnel. Screenshots use Playwright's
  per-test artifact directory.

Cross-department copying, templates, automatic generation/substitution, preference
copying, Shift Change Request integration and a global undo system remain outside
this phase. The official holiday adapter remains the existing injectable port;
copy uses the calendar configured by the application.

## Changed files

| Area           | Files                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain         | `src/domain/schedule/copy.ts`, `src/domain/schedule/copy.test.ts`                                                                                                 |
| Application    | `src/application/schedules/copy.ts`, `src/application/schedules/edit-assignments.ts` (opt-in insert-only persistence)                                             |
| Infrastructure | `src/infrastructure/repositories/schedules.ts` (ordered source locks), `src/infrastructure/repositories/assignments.ts` (insert-only writes)                      |
| Database       | No migrations, schema changes, preview tables or new enum values                                                                                                  |
| Frontend       | `src/features/schedule-copy/actions.ts`, `copy-dialog.tsx`, `preview-panel.tsx`, `presentation.ts`; `src/app/(app)/departments/[code]/schedule/page.tsx`          |
| Tests          | `src/features/calendar/schedule-copy.test.ts`, `tests/integration/schedule-copy.test.ts`, `tests/e2e/schedule-copy.spec.ts`, `tests/e2e/support/schedule-copy.ts` |
| Documentation  | `docs/decisions.md` (D131), `docs/schedule-copy.md`                                                                                                               |

## Final review and verification

The final review checked all changed files against the approved scope, the actual
assignment-writer lock protocol, dated authorization/membership rules, pinned
staffing resolution, source immutability and target roster snapshots. No schema,
workflow, permission, unrelated UI or deployment configuration changes are included.

The review added insert-only persistence for Copy without changing the ordinary
editor's replacement behavior. A regression test first reproduced a late external
leave decision being overwritten by the old upsert path; the fixed command returns
CONFLICT and preserves that leave, without audit or revision side effects. Blocked
preview rows are now labelled as blocked proposals, rather than transferable cells.

Tests also explicitly cover authority revocation with an active account, changed
staffing pins and holiday requirements, target date exceptions, and applying leap
Esfand into non-leap Esfand without rolling day 30 into Farvardin. Calendar tests
cover both directions between leap/non-leap Esfand and 31-day months.

Run the established checks before publishing:

```sh
pnpm check
pnpm test:coverage
pnpm test:integration
pnpm build
pnpm exec playwright test tests/e2e/schedule-copy.spec.ts --workers=2
```

Playwright captures preview, blocking-conflict and resulting-calendar screenshots
in its per-test artifact directory. All automated tests use isolated local/CI
databases. Preview deployment and CI status belong to the PR; no Production
operations are required by this feature.
