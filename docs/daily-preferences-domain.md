# Daily preference assistant — Stage 2 / PR 1

`src/domain/preferences/daily-assistant.ts` is the pure planning engine. It does
not authorize, query, save, audit, change lifecycle state or persist rejection.
Monthly preference application, the manual editor, and Finalize/Submit/Approve
validation are unchanged.

## Contract

`planDailyPreferences(input: DailyPreferencePlanInput): DailyPreferencePlan`
accepts a selected ISO date within a schedule period, registered preferences,
working assignments, the complete roster with snapshot roles, active-account and
effective-dated department membership records, the schedule's pinned rule-set ID
and content, official holiday dates, and external boundary assignments. Other
days' preferences may be supplied; only the selected day's preferences are shown.

The caller must provide the actual pinned content, valid rule-set data, and both
external boundary days for **every suggested nurse**, including nurses with no
working assignment anywhere in this schedule. Same-period neighboring decisions
belong in `assignments`. The shared assessor handles both directions of night
rest. It does not invent an OFF decision on the following day.

Output contains:

- Four groups, always ordered M/E/N/ME, with identity-sorted suggestions and a
  `manualSelectionRequired` flag. Working preferences from non-nursing members
  remain visible in their exact-code group as informational rows.
- `offPreferences`, informational rows that never propose an OFF assignment.
- Row status (`ELIGIBLE`, `ALREADY_ASSIGNED`, `CONFLICT`, `INFORMATIONAL`), the
  existing assignment, translation reason code and hypothetical insertion's
  `ChangeAssessment`, where applicable. `ELIGIBLE` means individually acceptable;
  it does not promise bulk eligibility.
- `proposed`, an insertion-only batch; `skippedGroups`, structured group reasons;
  and the batch's shared `ChangeAssessment`.
- M/E/N coverage: `current`, `minimum`, nullable `maximum`, `eligibleDemand`,
  nullable `availableCapacity`, `contention`, `currentShortage`, projected
  `proposed` coverage and `remainingShortage`, with the resolved rule source.

Rows already matching a working preference are `ALREADY_ASSIGNED`; a different
existing working/OFF/H decision is `CONFLICT / EXISTING_ASSIGNMENT`. Neither is
rewritten. OFF preferences and non-nursing preferences are informational. A
secretary role in the roster or qualifying dated membership prevents a nursing
suggestion. Current coverage uses the nursing roster subset, as the existing
validator does; historical decisions are not reclassified by membership changes.
Head Nurses remain nursing members. New suggestions require roster membership,
an active account and membership effective on the selected date (inclusive ends).

Malformed structure throws the existing `ValidationError`: target outside the
period, duplicate selected-day preferences, duplicate roster identities, duplicate
working assignment cells or out-of-period working assignments. Other existing
rule findings remain assessment context.

## Capacity and bulk policy

`resolveRequirements` and `resolveDay` retain Exception > Holiday > Normal
precedence inside the supplied pinned version. Coverage comes from `countByShift`
and `coverageOf`: ME is one decision contributing one unit to each of M and E.
There is no separate ME bound. A null maximum is unlimited, not zero.

`eligibleDemand` means new nursing demand **before capacity limits and session
exclusions**: empty cells that pass eligibility and all non-capacity hard rules.
It includes suggestions refused solely because a maximum is already reached;
their individual rows still carry the blocking STAFFING findings and cannot be
accepted. Matching, different-existing, informational and rest-blocked rows add
no new demand. Already assigned nurses count only through current coverage.

For each bounded bucket, contention is present when demand is positive and
current coverage plus demand exceeds the maximum. Every group contributing
demand to a contended bucket is left unchanged. Thus M and ME both require manual
selection when they compete for insufficient M capacity; E/ME work the same way.
Independent safe groups can proceed. A full/zero-capacity bucket still reports
contention, but no individual acceptance can exceed that bound. The policy is
conservative: it does not solve dependencies or salvage combinations of competing
groups to maximize acceptance.

Optional `excludedNurseIds` is stateless input from a future open assistant session.
It suppresses proposed rows only **after** demand and contention are determined.
Excluding a nurse cannot make an oversubscribed group bulk-eligible. Removing the
input restores the same suggestions; the planner retains no rejection state.

All remaining individually eligible, nonexcluded rows from safe groups form one
batch, assessed together through `assessEdits`. No new/worsened attributable hard
finding may pass. Remaining shortages are allowed because insertion improves or
preserves them under the existing before/after assessment; their error severity
and publication gates remain intact. Existing unrelated findings do not block.
If the final aggregate assessment blocks, the entire attempted batch is refused:
`proposed` is empty, its contributing groups receive `BATCH_RULE_CONFLICT`, and
`assessment` retains the attempted batch's findings. No ordered subset is chosen.
Coverage then reflects the unchanged assignments.

All collections in valid equivalent inputs may be reordered without changing the
result. Identity ordering is presentation/reproducibility only. No nurse score,
priority, first-N selection or persisted proposal exists.

## Translation keys and later integration

Reason keys stay language-independent. Future Persian presentation can map
`EXISTING_ASSIGNMENT` to «برای این فرد تصمیم دیگری ثبت شده است؛ پذیرش مستقیم ممکن
نیست», `CAPACITY_CONTENTION` to «ظرفیت کافی نیست؛ افراد را دستی انتخاب کنید», and
`RULE_VIOLATION` to the existing structured finding presentation. OFF and secretary
rows remain explicit informational entries, not silently discarded preferences.

The later application command must authorize Head Nurse access, enforce
DRAFT/PLANNING independently of preference-window state, protect fresh schedule,
preference and membership inputs under the existing locks, rebuild the plan,
check stale proofs/revisions, and persist with the shared insertion-only writer.
A returned domain plan is advice, not write authorization. This PR adds none of
those application or UI paths and requires no migration.

## Tests

The adjacent domain tests cover grouping and preservation, informational rows,
eligibility and roles, limits and shared ME capacity, session exclusions, pinned
resolution precedence, rest within/across periods, unrelated findings, shortages,
aggregate assessment, order independence and frozen inputs. The aggregate failure
guard has an injected hard finding because today's cross-nurse batch conflicts
are capacity conflicts already excluded before batch assembly; this tests refusal
without inventing a new production rule.
