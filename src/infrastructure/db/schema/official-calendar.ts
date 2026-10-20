import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  CalendarActorSnapshot,
  CalendarSource,
  HolidayCompleteness,
  OfficialDayStatus,
} from "../../../domain/calendar/official-calendar";
import { createdAt, id, instant, isoDay } from "./columns";

/** Protected global reference data. No relationship to operational data or user accounts. */
export const officialCalendarYears = pgTable(
  "official_calendar_years",
  {
    year: integer().primaryKey(),
    periodStart: isoDay().notNull(),
    periodEnd: isoDay().notNull(),
    confirmationStatus: text()
      .$type<"UNCONFIRMED" | "CONFIRMED">()
      .notNull()
      .default("UNCONFIRMED"),
    activeVersionId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "official_calendar_years_year_check",
      sql`${t.year} between 1300 and 1500`,
    ),
    check(
      "official_calendar_years_period_check",
      sql`${t.periodEnd} - ${t.periodStart} in (364,365)`,
    ),
    check(
      "official_calendar_years_confirmation_check",
      sql`(${t.confirmationStatus} = 'UNCONFIRMED' and ${t.activeVersionId} is null) or (${t.confirmationStatus} = 'CONFIRMED' and ${t.activeVersionId} is not null)`,
    ),
    foreignKey({
      columns: [t.year, t.activeVersionId],
      foreignColumns: [
        officialCalendarVersions.year,
        officialCalendarVersions.id,
      ],
      name: "official_calendar_years_active_version_fk",
    }),
  ],
);

/** Content is append-only, including unconfirmed snapshots. Confirmation is a one-way metadata change. */
export const officialCalendarVersions = pgTable(
  "official_calendar_versions",
  {
    id: id(),
    year: integer()
      .notNull()
      .references((): AnyPgColumn => officialCalendarYears.year),
    versionNo: integer().notNull(),
    basedOnVersionId: uuid(),
    origin: text().$type<"GENERATED" | "IMPORT">().notNull(),
    completeness: text().$type<HolidayCompleteness>().notNull(),
    source: jsonb().$type<CalendarSource>(),
    reason: text().notNull(),
    createdBy: jsonb().$type<CalendarActorSnapshot>().notNull(),
    createdAt: createdAt(),
    confirmedBy: jsonb().$type<CalendarActorSnapshot>(),
    confirmedAt: instant(),
  },
  (t) => [
    unique("official_calendar_versions_year_id_key").on(t.year, t.id),
    uniqueIndex("official_calendar_versions_no_key").on(t.year, t.versionNo),
    foreignKey({
      columns: [t.year, t.basedOnVersionId],
      foreignColumns: [t.year, t.id],
      name: "official_calendar_versions_base_fk",
    }),
    check("official_calendar_versions_no_check", sql`${t.versionNo} >= 1`),
    check(
      "official_calendar_versions_content_check",
      sql`(${t.origin} = 'GENERATED' and ${t.completeness} = 'UNKNOWN' and ${t.source} is null) or (${t.origin} = 'IMPORT' and ${t.completeness} in ('PARTIAL','COMPLETE') and ${t.source} is not null)`,
    ),
    check(
      "official_calendar_versions_confirmation_check",
      sql`(${t.confirmedAt} is null) = (${t.confirmedBy} is null) and (${t.confirmedAt} is null or (${t.completeness} = 'COMPLETE' and ${t.source}->>'verified' = 'true'))`,
    ),
  ],
);

export const officialCalendarVersionDays = pgTable(
  "official_calendar_version_days",
  {
    versionId: uuid()
      .notNull()
      .references(() => officialCalendarVersions.id),
    date: isoDay().notNull(),
    isFriday: boolean().notNull(),
    officialStatus: text().$type<OfficialDayStatus>().notNull(),
    holidayNames: jsonb().$type<readonly string[]>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.date] }),
    check(
      "official_calendar_version_days_status_check",
      sql`${t.officialStatus} in ('UNKNOWN','NONE','OFFICIAL','PROVISIONAL')`,
    ),
    check(
      "official_calendar_version_days_names_check",
      sql`jsonb_typeof(${t.holidayNames}) = 'array' and ((${t.officialStatus} in ('UNKNOWN','NONE') and jsonb_array_length(${t.holidayNames}) = 0) or (${t.officialStatus} in ('OFFICIAL','PROVISIONAL') and jsonb_array_length(${t.holidayNames}) > 0))`,
    ),
    check(
      "official_calendar_version_days_friday_check",
      sql`${t.isFriday} = (extract(dow from ${t.date}) = 5)`,
    ),
  ],
);

/** Independent, append-only audit evidence: never part of audit_events or a reset category. */
export const officialCalendarAuditEvents = pgTable(
  "official_calendar_audit_events",
  {
    id: id(),
    versionId: uuid()
      .notNull()
      .references(() => officialCalendarVersions.id),
    action: text().$type<"GENERATED" | "IMPORTED" | "CONFIRMED">().notNull(),
    actor: jsonb().$type<CalendarActorSnapshot>().notNull(),
    occurredAt: instant().notNull(),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    check(
      "official_calendar_audit_events_action_check",
      sql`${t.action} in ('GENERATED','IMPORTED','CONFIRMED')`,
    ),
  ],
);
