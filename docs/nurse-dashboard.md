# Nurse home dashboard

The nurse landing route remains `/my-shifts`; supervisor and Head Nurse landing
routes, the application layers, scheduling rules and request workflow are unchanged.
There are no database migrations or additional dependencies.

## Audit and implementation

- Existing month grid, day detail, publication notices, summary, shift tokens,
  Jalali adapter and shell are reused. The new week starts today and spans six
  further days; Saturday-first month layout remains unchanged.
- `getMyShiftsPeriods` is the shared own-assignment loader behind both the existing
  month query and dashboard. It authorizes against the server actor and reads
  each relevant schedule's own assignments once across the requested ranges.
- Own shifts retain D11/D98: temporary working assignments before first approval,
  then the approved snapshot, with revision dates flagged. Temporary totals and
  next shifts retain explicit warnings. Missing decisions never become OFF or H.
- Coworker visibility follows the existing request-partner boundary: current
  department membership, a rostered own working assignment, and FINALIZED or later.
  This narrow read does not grant nurses department-grid access. Only overlapping
  coworkers' display names are returned; self, OFF, H and inactive accounts are
  excluded. Approved revision edits are never used. Former members keep their
  own history, without coworker disclosure.
- Interval endpoints derive from `SHIFT_TYPES`, ISO day arithmetic and the
  department's IANA timezone. Endpoints are half-open, so M ending at 14:00 does
  not overlap E starting at 14:00. N ends on the following day. Selection uses
  actual start/end instants and prioritizes active shifts, including a prior
  month's night. The next-shift search includes every future rostered schedule,
  independently of the displayed week/month. The countdown rounds up to minutes
  and transitions to active/ended states while the page stays open.
- Dashboard queries use a read-only REPEATABLE READ snapshot. Query count depends
  on relevant schedules, not nurse count. Requests use the existing repository
  and ownership policy without loading each request's resolution context.
- Calendar view is a lightweight preference cookie (`hsp.nurse.calendar-view`,
  scoped to `/my-shifts`); explicit URL state takes precedence. Existing
  `?month=1405-08&day=...` links still open the monthly calendar. Blocked storage
  leaves URL navigation functional. No nurse identifier is accepted from the URL.

## Semantics and limitations

- Monthly figures describe the displayed Jalali month, with ME counted once,
  scheduled hours from catalog durations, and explicit upcoming OFF dates only.
  Leave stays separate. Figures are planning data, never attendance or payroll.
- The request section shows the three most recent visible requests, including
  swap requests naming the nurse, using existing statuses and consent labels.
  Full history and actions remain on `/requests`.
- Assignment changes refresh on navigation/reload, consistent with the existing
  calendar. The countdown updates locally; it does not poll for schedule edits.
  Account and department permissions are checked again on every server read.
- As elsewhere in the application, today's date and calendar defaults use
  Asia/Tehran. Shift instants use each department's stored timezone. The pilot
  has one department in that timezone.
- Coworker search, coworker month filters, rankings, recommendations and new
  approval workflows are outside this phase.

## Verification

Focused tests are in `src/domain/shifts/interval.test.ts`,
`src/infrastructure/time/zoned-time.test.ts`,
`src/features/my-shifts/dashboard-navigation.test.ts`,
`tests/integration/nurse-dashboard.test.ts` and
`tests/e2e/nurse-dashboard.spec.ts`. They cover boundaries, overnight shifts,
countdowns, overlap, privacy, publication/revision sources, summary and empty
states, week navigation, view persistence, keyboard selection and RTL layout at
320, 375, 768 and 1440 pixels. The desktop Chromium E2E test captures full-page
375px and 1440px screenshots in its Playwright output directory.

Run `pnpm check`, `pnpm test:integration`, then `pnpm build && pnpm test:e2e`
against local migrated/seeded PostgreSQL. Integration tests use the separate
`hsp_test` database; browser fixtures use `hsp_dev`. No production data is used.

## Verification results — 2026-10-19

- `pnpm check`: lint, type checking and formatting passed; 120 unit test files,
  2,498 tests passed.
- Full PostgreSQL integration suite: 57 files, 1,225 tests passed. After the final
  coworker-query refinement, the five relevant suites were rerun: 117 tests passed.
- `pnpm build`: production compilation, type checking and page generation passed.
- Existing nurse calendar, roles and shell tests plus the new dashboard tests on
  desktop Chromium and mobile Android: 56 passed, eight existing device-specific
  tests intentionally skipped. The new dashboard tests passed on both projects.
- The new interval domain helper has 100% statement, branch, function and line
  coverage (six tests).
- Mobile and desktop screenshots were visually reviewed. The browser tests verify
  no horizontal overflow at 320, 375, 768 and 1440 pixels.
- WebKit/iOS was not executed: this host lacks GTK4, Graphene, HarfBuzz ICU,
  Manette, Hyphen and GLES system libraries. No existing test was weakened.
- During rapid shell navigation the Next.js server logged “The destination stream
  closed early”; browser assertions passed. PostgreSQL also emitted its existing
  overlapping-query deprecation warning in integration fixtures.

## Changed files

- `src/app/(app)/my-shifts/page.tsx`
- `src/application/my-shifts/queries.ts`
- `src/application/my-shifts/dashboard.ts`
- `src/domain/shifts/interval.ts`
- `src/domain/shifts/interval.test.ts`
- `src/features/my-shifts/my-shifts-view.tsx`
- `src/features/my-shifts/calendar-view-switch.tsx`
- `src/features/my-shifts/dashboard-navigation.ts`
- `src/features/my-shifts/dashboard-navigation.test.ts`
- `src/features/my-shifts/dashboard-sections.tsx`
- `src/features/my-shifts/next-shift.tsx`
- `src/infrastructure/repositories/schedules.ts`
- `src/infrastructure/time/zoned-time.ts`
- `src/infrastructure/time/zoned-time.test.ts`
- `tests/integration/nurse-dashboard.test.ts`
- `tests/e2e/nurse-dashboard.spec.ts`
- `docs/nurse-dashboard.md`
- `docs/decisions.md`
