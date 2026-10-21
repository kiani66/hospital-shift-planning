# Daily preference assistant UI

The Head Nurse's existing day detail offers «پیشنهاد بر اساس ترجیحات» in
DRAFT and PLANNING, using the existing scheduling permission. Preference-window
state does not affect availability. There is no new route or dialog.

## Boundaries and refresh

- `src/features/daily-preferences/actions.ts` validates the existing application
  schemas, obtains trusted request context and delegates to `readDailyPreferences`
  / `acceptDailyPreferences`. Application authorization, snapshot verification,
  locking, pinned staffing rules and insertion-only persistence remain unchanged.
  Client shift codes, capacity and identity claims are stripped by those schemas.
- Preview returns the existing named groups, eligibility and proof. Acceptance
  sends schedule/date, the displayed revision/proof and ONE nurse ID or BULK
  session exclusions. The proof is opaque; signing code remains server-side.
- Success calls Next `refresh()` for the schedule and reloads the assistant's
  preview. The selected URL day, expanded assistant, result and local exclusions
  remain. Coverage renders `current` and `currentShortage`, never projected
  coverage from the next proposed batch. ME has no independent coverage card.
- A synchronous busy guard and transition disable submissions during requests.
  Every write attempt discards its proof and reloads. Stale/rule rejections refresh
  the route, display a Persian explanation and require another explicit click.
  Writes are never retried automatically. An uncertain network result disables
  acceptance until a successful fresh preview, rather than claiming rollback or
  success.
- A schedule/date key and unmount guard discard responses from a closed or
  previous day's session. Incoming newer schedule revisions trigger read-only
  reloads. Next also serializes Server Actions and navigation on the client.

## Interaction

M/E/N/ME groups display all preferences, existing decisions, eligibility and
shared rule diagnostics. OFF and non-nursing preferences remain informational.
Existing decisions have disabled acceptance with visible, associated explanations.
Contended groups explain manual selection; individual acceptance is explicit,
and the server decides its eligibility. No client capacity selection or ranking
is performed. Bulk eligibility comes from the server's proposed batch; local
exclusions only remove intended submissions, never recalculate capacity demand.

Rejection is component state keyed by nurse/preference. Closing the assistant,
closing the day or changing days unmounts that state. Reopening reads again.
A changed preference has a different rejection identity. Nothing is persisted.

The actual acceptance result supplies the count summary, manual-selection groups,
expandable outcomes, skipped-group explanations and hard-rule details. Existing
shift chips, staffing bounds labels, rule findings, Jalali formatting and logical
RTL utility classes are reused. Opening focuses the heading, closing restores
trigger focus, status changes are announced, and buttons retain 44px targets.

## Verification

`actions.test.ts` covers trusted context, input stripping, malformed input,
authentication redirects, successful refresh, safe errors and no write retries.
`tests/e2e/daily-preferences.spec.ts` uses fresh isolated departments and verifies
immediate persistence, grouping, already-assigned state, OFF/H preservation,
night rest findings, local rejection/reopening, partial bulk with shared ME
capacity, actual coverage, stale preference recovery, lifecycle/window visibility,
empty/no-write behavior, delayed reads, keyboard focus and RTL overflow at
320/768/1280px. Browser runs include desktop and mobile Chromium; existing monthly
application and daily candidate flows provide browser regressions for manual
editing as well. PostgreSQL suites retain command concurrency/rollback/audit
coverage without UI-specific database changes.

Preview is a snapshot, not a live subscription: changes to preferences without a
schedule revision are detected on explicit refresh or acceptance. The interface
makes no success claim until the command returns one, and stale acceptance always
requires another user decision. No business-rule, schema or workflow changes.

## Review evidence

- `pnpm check`: lint, type checking, formatting and 2,620 unit tests passed.
- PostgreSQL: 204 tests passed across daily acceptance (78), monthly application,
  coverage queries, manual assignment editing and candidate assignment suites.
- Production build passed with explicit isolated local PostgreSQL URLs.
- Desktop/mobile Chromium: all 16 daily UI test cases passed, with monthly,
  candidate and manual-edit browser regressions also passing. Existing manual
  tests skip their opposite platform intentionally. The native day dialog and
  assistant both fit 320/768/1280px; screenshot regeneration checks also passed.
- No production data, domain/application rules, schema, dependencies or migrations
  changed. Browser testing covers Chromium desktop/Android emulation; this PR
  does not claim a WebKit/iOS run.

Screenshots use synthetic data in isolated test departments:

[Desktop](screenshots/daily-preferences/desktop.png) ·
[Mobile overview](screenshots/daily-preferences/mobile.png) ·
[Mobile shared-capacity group](screenshots/daily-preferences/mobile-group.png)
