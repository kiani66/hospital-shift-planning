# Feature 19 — Stage 1: official Iranian calendar infrastructure

## Audit and scope

Audited `main` at `8a385171cd3d5b9e3b0e5e7814b67dfa61ad2681` before implementation.
Existing `features/calendar/jalali.ts` uses ICU's Persian calendar; `domain/shared/dates.ts`
provides ISO civil-day arithmetic. `HolidayCalendar` currently defaults to `NO_HOLIDAY_DATA`.
There were no official calendar tables or verified holiday seed files. Excel uses
`holidayKindOf` for Friday/official highlighting; staffing resolves date exception > official
holiday > normal and does not treat Friday as an official staffing holiday.
Drizzle migrations, `defineCommand`, explicit Hospital Admin policies and append-only
version/audit repositories are reused.

The approved retention decision makes the calendar protected global reference data,
independent of operational resets and account retention. Calendar lineage years are a
narrow exception to D4: schedules and every stored calendar day still use ISO dates.
The existing ICU conversion was extracted into `infrastructure/calendar/jalali.ts`;
the original feature module re-exports its API, preserving existing consumers.

This stage adds no calendar UI, operational holiday overrides, staffing integration,
notifications, schedule warnings, finalization enforcement or runtime external API calls.
Existing holiday consumers/defaults remain unchanged.

`vercel.json` disables automatic Git deployment for this feature branch only, so pushing
the implementation and opening its PR do not authorize a Preview deployment. GitHub CI
continues to run. Other branches keep their existing deployment behavior.

## Schema

Migration `0020_official_calendar` adds four tables only; no existing business rows are
changed and no holiday data is inserted by the migration.

| Table                            | Purpose                                                                                                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `official_calendar_years`        | Jalali lineage key, inclusive ISO year bounds, explicit UNCONFIRMED/CONFIRMED status and nullable active confirmed version pointer.                                                                                                            |
| `official_calendar_versions`     | UUID version ID, year-local sequence, active predecessor ID, GENERATED/IMPORT origin, UNKNOWN/PARTIAL/COMPLETE holiday completeness, publication provenance, correction reason, immutable creator snapshot and one-time confirmation metadata. |
| `official_calendar_version_days` | Full ISO-day snapshot per version; deterministic Friday flag; UNKNOWN/NONE/OFFICIAL/PROVISIONAL status; multiple holiday names for a date.                                                                                                     |
| `official_calendar_audit_events` | Append-only GENERATED/IMPORTED/CONFIRMED events with actor snapshots and the prior active version on confirmation.                                                                                                                             |

Composite foreign keys prevent active/predecessor references to another year. All calendar
foreign keys stay inside these four tables, with no delete cascades. Attribution snapshots
store the user's UUID, display name and personnel number as recorded when acting; these
are historical evidence, not foreign keys or live display-name lookups. Calendar evidence
is independent of the operational `audit_events` table, which retains its existing reset
behavior. No passwords, credentials or session tokens enter snapshots.

Following D17's existing repository convention, content and audit history have insert/read
paths only. Unconfirmed imports are also immutable: correction always appends a fresh full
snapshot. Confirmation may set `confirmed_by`/`confirmed_at` once. Previously confirmed
versions keep their content and confirmation metadata when superseded. There are no new
database triggers or cleanup/delete commands for calendar history.

## Application entry points

All commands use the existing `defineCommand` transaction/error contract and authorize
`officialCalendar.manage`, which requires an active Hospital Admin (the existing system
administrator role). Reads use the same policy; no department role gains calendar-management
authority. Actor metadata comes from the database, never a caller-supplied snapshot.

- `initializeOfficialCalendar(ctx, {})`: derive the current Jalali year from the injectable
  clock's **Asia/Tehran day**, then initialize five previous years, the current year and
  four future years. The horizon is calculated on each call, never hardcoded.
- `initializeOfficialCalendar(ctx, { year })`: create a missing supported year, including
  years outside the initial horizon. Repeat calls do not change any existing records.
- `importOfficialCalendar(ctx, input)`: automatically initialize a missing year's base and
  append an imported snapshot, checking `expectedActiveVersionId`. Supply the full intended
  holiday list for that snapshot; omitted dates remain UNKNOWN for PARTIAL data and become
  NONE only when the administrator declares a verified COMPLETE publication.
- `confirmOfficialCalendar(ctx, { versionId, expectedActiveVersionId })`: lock the year,
  re-read the candidate, reject an already-confirmed or stale candidate, require complete
  verified nonprovisional data and every date of the year, then write confirmation metadata,
  switch the active pointer/status and append audit evidence in **one transaction**.
- `getOfficialCalendarYear(ctx, year)`: coherent read-only repeatable-read metadata/history;
  an uninitialized year returns `null` rather than claiming no holidays.
- `getOfficialCalendarVersion(ctx, versionId)`: coherent explicit historical snapshot with
  days, provenance, confirmation metadata and audit events.

A year's row serializes concurrent initialization, import and confirmation. Version numbers
are allocated under that lock. A candidate's predecessor must still be active at confirmation;
two competing confirmations cannot both replace the same active version. The previously
confirmed version remains active while an imported replacement is unconfirmed. Confirmation
is immediate; scheduled activation and implicit historical rollback are not introduced.

## Source verification and provisional dates

No official holiday dataset ships in this change. Generated days have UNKNOWN official
status, no holiday names and no confirmation. Friday is recorded independently.

Import is an explicit administrator workflow accepting already-reviewed publication data;
it does not claim to independently authenticate a URL or verify document contents. The
operator must retain the reviewed publication and provide its publisher, title, HTTPS URL,
SHA-256, retrieval date, verification note and verification attestation. The stored hash
identifies that document; it is not a remote-download or signature-validation service.
Verified provenance is required for OFFICIAL entries. Unverified future lunar dates can be
imported only as PROVISIONAL in a PARTIAL version. COMPLETE imports and confirmation reject
unverified or provisional data. Source evidence and correction reasons remain with every
version. Synthetic `.invalid` publications in tests are fixtures only, not holiday seed data.

## Reset and seed safety

Calendar tables never enter `DATA_TABLES`, a reset category, a deletion plan or the operational
audit table. Demo seeding therefore preserves years, every version, all days and their audit
evidence byte-for-byte. User deletion cannot affect them, and calendar attribution cannot
retain a user account. Existing reset personnel protection rules remain unchanged.

`PROTECTED_CALENDAR_TABLES` registers the four tables separately from `RESET_TABLES`.
The existing Full Reset FK guard now inspects relationships involving protected tables too.
Unknown relationships still block reset; a protected table referencing an operational table
or using a cascading internal FK also blocks reset. No relationship is ignored or whitelisted
around an existing safety check. Demo `resetData` runs that same guard **before** its existing
TRUNCATE CASCADE, so future unsafe FK additions fail before touching any data.

Initialization inserts missing lineages and their base snapshots only. It never truncates,
updates or replaces existing confirmed/unconfirmed data. It is deliberately separate from
the destructive demo seed. Migration and initialization must be run only against an explicitly
selected development/test/preview database; this task does not execute them on Production.

## Stage 2 and Stage 3 integration contracts

Stage 2 can resolve the years intersecting an ISO period through the shared calendar adapter,
then load specific version IDs and expose source/completeness/confirmation warnings. Preserve
the distinction between Friday, official holiday, provisional and unknown. Snapshot version
IDs for all intersecting years, including periods crossing Nowruz. Any operational exceptions
belong to their own later scope and must not mutate official reference snapshots.

Stage 3 can require confirmed versions during FINALIZE, within the schedule command's own
transaction and concurrency protocol, and persist explicit version IDs for reproducible
approved schedules. Do not infer confirmation from the existence of generated dates or the
absence of listed holidays. Do not wire this database into the old `HolidayCalendar` port
without adding version/completeness handling: its date/name-only response loses provenance
and unknown/provisional status and would change staffing/Excel behavior prematurely.
When schedule-version pins add foreign keys to these protected tables, register those
relationships and extend reset integrity reads to resolve the retained targets without
making calendar tables deletable. The current guard deliberately rejects unregistered FKs.

## Validation

Unit tests cover ICU conversions, leap/year boundaries, complete date generation, Friday
classification, Tehran Nowruz rollover, source validation and provisional/confirmation rules.
Integration tests exercise real PostgreSQL migrations, missing-year generation, idempotence,
replacement/history, authorization, concurrency, atomic rollback and protected retention across
demo seed, Full Reset and direct account deletion. Existing reset, scheduling and Excel suites
remain regression checks. See the PR for executed commands and results.
