import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, instant, isoDay } from "./columns";
import {
  coveragePeriod,
  staffingDayType,
  staffingRuleSetRetireReason,
  staffingRuleSetStatus,
} from "./enums";
import { departments, users } from "./identity";

/**
 * Fixed identities of the Hospital Default lineage and its legacy baseline
 * version (M/E/N min 1, no max), inserted by migration 0011. Existing
 * schedules and approved versions were pinned to the baseline, and the pin
 * columns default to it so an insert by the previous deployment during a
 * release keeps Production behavior (expand step, D105).
 */
export const HOSPITAL_RULE_SET_ID = "5ca1ab1e-0000-4000-8000-000000000001";
export const LEGACY_BASELINE_VERSION_ID =
  "5ca1ab1e-0000-4000-8000-000000000002";

/** The baseline's bounds as migration 0011 inserts them (checked by an integration test). */
export const LEGACY_BASELINE_BOUNDS = { min: 1, max: null } as const;
export const LEGACY_BASELINE_EFFECTIVE_FROM = "1900-01-01";

/** One lineage per scope: `department_id` null is the Hospital Default (singleton). */
export const staffingRuleSets = pgTable(
  "staffing_rule_sets",
  {
    id: id(),
    departmentId: uuid().references(() => departments.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("staffing_rule_sets_department_key")
      .on(t.departmentId)
      .where(sql`${t.departmentId} is not null`),
    uniqueIndex("staffing_rule_sets_hospital_key")
      .on(sql`(${t.departmentId} is null)`)
      .where(sql`${t.departmentId} is null`),
  ],
);

/**
 * Versions of a lineage. DRAFT rows are editable; PUBLISHED and RETIRED rows
 * are immutable (the application has no update path for their content) and
 * never deleted: schedules and approved versions reference them.
 */
export const staffingRuleSetVersions = pgTable(
  "staffing_rule_set_versions",
  {
    id: id(),
    ruleSetId: uuid()
      .notNull()
      .references(() => staffingRuleSets.id),
    versionNo: integer().notNull(),
    status: staffingRuleSetStatus().notNull().default("DRAFT"),
    /** The first Tehran day the version applies; set exactly when published. */
    effectiveFrom: isoDay(),
    basedOnVersionId: uuid().references(
      (): AnyPgColumn => staffingRuleSetVersions.id,
    ),
    note: text(),
    /** USER, or MIGRATION for the legacy baseline (which has no actor). */
    origin: text().notNull().default("USER"),
    /** Optimistic-concurrency counter for draft edits. */
    revision: integer().notNull().default(0),
    createdBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
    publishedBy: uuid().references(() => users.id),
    publishedAt: instant(),
    retiredBy: uuid().references(() => users.id),
    retiredAt: instant(),
    retiredReason: staffingRuleSetRetireReason(),
    replacedByVersionId: uuid().references(
      (): AnyPgColumn => staffingRuleSetVersions.id,
    ),
  },
  (t) => [
    uniqueIndex("staffing_rule_set_versions_no_key").on(
      t.ruleSetId,
      t.versionNo,
    ),
    // Unambiguous selection: never two published versions of a lineage from the same day.
    uniqueIndex("staffing_rule_set_versions_effective_key")
      .on(t.ruleSetId, t.effectiveFrom)
      .where(sql`${t.status} = 'PUBLISHED'`),
    uniqueIndex("staffing_rule_set_versions_one_draft_key")
      .on(t.ruleSetId)
      .where(sql`${t.status} = 'DRAFT'`),
    check("staffing_rule_set_versions_no_check", sql`${t.versionNo} >= 1`),
    check("staffing_rule_set_versions_revision_check", sql`${t.revision} >= 0`),
    check(
      "staffing_rule_set_versions_origin_check",
      sql`${t.origin} in ('USER', 'MIGRATION')`,
    ),
    check(
      "staffing_rule_set_versions_effective_check",
      sql`(${t.status} = 'DRAFT') = (${t.effectiveFrom} is null)`,
    ),
    check(
      "staffing_rule_set_versions_published_check",
      sql`(${t.status} = 'DRAFT') = (${t.publishedAt} is null)`,
    ),
    check(
      "staffing_rule_set_versions_retired_check",
      sql`(${t.status} = 'RETIRED') = (${t.retiredAt} is not null) and (${t.retiredAt} is null) = (${t.retiredReason} is null)`,
    ),
    check(
      "staffing_rule_set_versions_actor_check",
      sql`${t.origin} = 'MIGRATION' or (${t.createdBy} is not null and (${t.status} = 'DRAFT' or ${t.publishedBy} is not null))`,
    ),
  ],
);

/** Day-type bounds of a version: NORMAL for every bucket, HOLIDAY optional. */
export const staffingRuleSetRequirements = pgTable(
  "staffing_rule_set_requirements",
  {
    versionId: uuid()
      .notNull()
      .references(() => staffingRuleSetVersions.id, { onDelete: "cascade" }),
    dayType: staffingDayType().notNull(),
    coveragePeriod: coveragePeriod().notNull(),
    minStaff: integer().notNull(),
    /** Null: no maximum. */
    maxStaff: integer(),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.dayType, t.coveragePeriod] }),
    check(
      "staffing_rule_set_requirements_bounds_check",
      sql`${t.minStaff} between 0 and 99 and (${t.maxStaff} is null or ${t.maxStaff} between ${t.minStaff} and 99)`,
    ),
  ],
);

/** Specific-date exceptions of a version (D105, D106). */
export const staffingRuleSetDateExceptions = pgTable(
  "staffing_rule_set_date_exceptions",
  {
    versionId: uuid()
      .notNull()
      .references(() => staffingRuleSetVersions.id, { onDelete: "cascade" }),
    date: isoDay().notNull(),
    coveragePeriod: coveragePeriod().notNull(),
    minStaff: integer().notNull(),
    maxStaff: integer(),
    note: text(),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.date, t.coveragePeriod] }),
    check(
      "staffing_rule_set_date_exceptions_bounds_check",
      sql`${t.minStaff} between 0 and 99 and (${t.maxStaff} is null or ${t.maxStaff} between ${t.minStaff} and 99)`,
    ),
    index("staffing_rule_set_date_exceptions_date_idx").on(t.versionId, t.date),
  ],
);
