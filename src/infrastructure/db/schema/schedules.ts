import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, instant, isoDay } from "./columns";
import {
  assignmentSource,
  dateScopeKind,
  membershipRole,
  preferenceValue,
  preferenceWindowKind,
  revisionStatus,
  scheduleStatus,
  submissionDecision,
} from "./enums";
import { departments, users } from "./identity";
import { shiftTypes } from "./reference";
import {
  LEGACY_BASELINE_VERSION_ID,
  staffingRuleSetVersions,
} from "./staffing-rules";

/**
 * One department's schedule for one period. The period is calendar agnostic
 * (a Jalali month is stored as its Gregorian start/end dates). Periods of one
 * department never overlap (D18): enforced by the exclusion constraint
 * `schedules_period_no_overlap` (migration 0003; Drizzle cannot model it).
 */
export const schedules = pgTable(
  "schedules",
  {
    id: id(),
    departmentId: uuid()
      .notNull()
      .references(() => departments.id),
    periodStart: isoDay().notNull(),
    periodEnd: isoDay().notNull(),
    /** Display label captured at creation (e.g. the Jalali month name). Not data. */
    label: text().notNull(),
    status: scheduleStatus().notNull().default("DRAFT"),
    /** Optimistic-concurrency counter, bumped on every mutation of the schedule. */
    revision: integer().notNull().default(0),
    /** Latest approved version; null until the first approval. */
    currentVersionId: uuid().references((): AnyPgColumn => scheduleVersions.id),
    /**
     * The one staffing rule-set version the schedule is validated against
     * (D106). Changed only by an explicit Apply (D107) or a revision discard.
     * The default (legacy baseline) only serves the expand step of 0011.
     */
    staffingRuleSetVersionId: uuid()
      .notNull()
      .default(LEGACY_BASELINE_VERSION_ID)
      .references(() => staffingRuleSetVersions.id),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
  },
  (t) => [
    unique("schedules_department_period_key").on(t.departmentId, t.periodStart),
    check("schedules_period_check", sql`${t.periodEnd} >= ${t.periodStart}`),
    check("schedules_revision_check", sql`${t.revision} >= 0`),
  ],
);

/**
 * Who belongs to a schedule, snapshotted when the schedule is created (and
 * edited explicitly). Membership changes later never rewrite it, so past
 * schedules keep their people (D16).
 */
export const scheduleRoster = pgTable(
  "schedule_roster",
  {
    scheduleId: uuid()
      .notNull()
      .references(() => schedules.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    /** Role in the department at snapshot time. */
    role: membershipRole().notNull(),
    addedBy: uuid()
      .notNull()
      .references(() => users.id),
    addedAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.scheduleId, t.userId] }),
    index("schedule_roster_user_idx").on(t.userId),
  ],
);

/** Preference-entry windows: INITIAL (whole period) or scoped REOPEN. */
export const preferenceWindows = pgTable(
  "preference_windows",
  {
    id: id(),
    scheduleId: uuid()
      .notNull()
      .references(() => schedules.id),
    kind: preferenceWindowKind().notNull(),
    scopeKind: dateScopeKind().notNull(),
    reason: text(),
    openedBy: uuid()
      .notNull()
      .references(() => users.id),
    openedAt: instant().notNull().defaultNow(),
    closesAt: instant(),
    closedBy: uuid().references(() => users.id),
    closedAt: instant(),
  },
  (t) => [
    index("preference_windows_schedule_idx").on(t.scheduleId),
    check(
      "preference_windows_closed_check",
      sql`(${t.closedBy} is null) = (${t.closedAt} is null)`,
    ),
  ],
);

export const preferenceWindowDates = pgTable(
  "preference_window_dates",
  {
    windowId: uuid()
      .notNull()
      .references(() => preferenceWindows.id, { onDelete: "cascade" }),
    date: isoDay().notNull(),
  },
  (t) => [primaryKey({ columns: [t.windowId, t.date] })],
);

/** Empty for a window means "whole roster". */
export const preferenceWindowNurses = pgTable(
  "preference_window_nurses",
  {
    windowId: uuid()
      .notNull()
      .references(() => preferenceWindows.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.windowId, t.userId] })],
);

/** One preference per nurse per day (only for rostered nurses). */
export const nursePreferences = pgTable(
  "nurse_preferences",
  {
    scheduleId: uuid().notNull(),
    userId: uuid().notNull(),
    date: isoDay().notNull(),
    value: preferenceValue().notNull(),
    updatedAt: instant().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.scheduleId, t.userId, t.date] }),
    foreignKey({
      name: "nurse_preferences_roster_fk",
      columns: [t.scheduleId, t.userId],
      foreignColumns: [scheduleRoster.scheduleId, scheduleRoster.userId],
    }),
  ],
);

/**
 * The working copy. One assignment per nurse per day (D15); ME is one row.
 * No row means the nurse is off.
 */
export const shiftAssignments = pgTable(
  "shift_assignments",
  {
    scheduleId: uuid().notNull(),
    userId: uuid().notNull(),
    date: isoDay().notNull(),
    shiftCode: text()
      .notNull()
      .references(() => shiftTypes.code),
    source: assignmentSource().notNull().default("MANUAL"),
    updatedBy: uuid()
      .notNull()
      .references(() => users.id),
    updatedAt: instant().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.scheduleId, t.userId, t.date] }),
    foreignKey({
      name: "shift_assignments_roster_fk",
      columns: [t.scheduleId, t.userId],
      foreignColumns: [scheduleRoster.scheduleId, scheduleRoster.userId],
    }),
    // Night-rest checks look up a nurse's neighbouring days across schedules.
    index("shift_assignments_user_date_idx").on(t.userId, t.date),
  ],
);

/** Post-approval change sets; dates are explicit (D14). */
export const scheduleRevisions = pgTable(
  "schedule_revisions",
  {
    id: id(),
    scheduleId: uuid()
      .notNull()
      .references(() => schedules.id),
    reason: text().notNull(),
    status: revisionStatus().notNull().default("OPEN"),
    startedBy: uuid()
      .notNull()
      .references(() => users.id),
    startedAt: instant().notNull().defaultNow(),
    closedAt: instant(),
  },
  (t) => [
    uniqueIndex("schedule_revisions_one_open_key")
      .on(t.scheduleId)
      .where(sql`${t.status} = 'OPEN'`),
    check(
      "schedule_revisions_closed_check",
      sql`(${t.status} = 'OPEN') = (${t.closedAt} is null)`,
    ),
  ],
);

/** Revision scope; extending the scope adds rows (who/when recorded per date). */
export const scheduleRevisionDates = pgTable(
  "schedule_revision_dates",
  {
    revisionId: uuid()
      .notNull()
      .references(() => scheduleRevisions.id, { onDelete: "cascade" }),
    date: isoDay().notNull(),
    addedBy: uuid()
      .notNull()
      .references(() => users.id),
    addedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.revisionId, t.date] })],
);

/** Submissions to the Supervisor; the decision is stored on the submission. */
export const scheduleSubmissions = pgTable(
  "schedule_submissions",
  {
    id: id(),
    scheduleId: uuid()
      .notNull()
      .references(() => schedules.id),
    /** Set when submitting a post-approval revision. */
    revisionId: uuid().references(() => scheduleRevisions.id),
    submittedBy: uuid()
      .notNull()
      .references(() => users.id),
    submittedAt: instant().notNull().defaultNow(),
    note: text(),
    decision: submissionDecision(),
    decidedBy: uuid().references(() => users.id),
    decidedAt: instant(),
    decisionComment: text(),
  },
  (t) => [
    uniqueIndex("schedule_submissions_one_pending_key")
      .on(t.scheduleId)
      .where(sql`${t.decision} is null`),
    check(
      "schedule_submissions_decided_check",
      sql`(${t.decision} is null) = (${t.decidedAt} is null) and (${t.decidedBy} is null) = (${t.decidedAt} is null)`,
    ),
  ],
);

/** Immutable approved snapshots. The application never updates or deletes them. */
export const scheduleVersions = pgTable(
  "schedule_versions",
  {
    id: id(),
    scheduleId: uuid()
      .notNull()
      .references(() => schedules.id),
    versionNo: integer().notNull(),
    submissionId: uuid()
      .notNull()
      .unique()
      .references(() => scheduleSubmissions.id),
    approvedBy: uuid()
      .notNull()
      .references(() => users.id),
    approvedAt: instant().notNull().defaultNow(),
    /** The rule-set version the schedule was pinned to when approved (D106). */
    staffingRuleSetVersionId: uuid()
      .notNull()
      .default(LEGACY_BASELINE_VERSION_ID)
      .references(() => staffingRuleSetVersions.id),
  },
  (t) => [
    unique("schedule_versions_schedule_version_key").on(
      t.scheduleId,
      t.versionNo,
    ),
    check("schedule_versions_version_no_check", sql`${t.versionNo} >= 1`),
  ],
);

export const scheduleVersionAssignments = pgTable(
  "schedule_version_assignments",
  {
    versionId: uuid()
      .notNull()
      .references(() => scheduleVersions.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    date: isoDay().notNull(),
    shiftCode: text()
      .notNull()
      .references(() => shiftTypes.code),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.userId, t.date] }),
    index("schedule_version_assignments_user_date_idx").on(t.userId, t.date),
  ],
);

/**
 * Every explicit Apply of a rule-set version to a schedule (D107, D110),
 * with its before/after impact. Append-only.
 */
export const scheduleRuleSetApplications = pgTable(
  "schedule_rule_set_applications",
  {
    id: id(),
    scheduleId: uuid()
      .notNull()
      .references(() => schedules.id),
    fromVersionId: uuid()
      .notNull()
      .references(() => staffingRuleSetVersions.id),
    toVersionId: uuid()
      .notNull()
      .references(() => staffingRuleSetVersions.id),
    /** The open revision the Apply belongs to (an approved schedule, D109). */
    revisionId: uuid().references(() => scheduleRevisions.id),
    rollback: boolean().notNull().default(false),
    appliedBy: uuid()
      .notNull()
      .references(() => users.id),
    appliedAt: createdAt(),
    /** Before/after category counts, introduced problems, added scope days, assignmentsChanged: 0. */
    impact: jsonb().$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    index("schedule_rule_set_applications_schedule_idx").on(
      t.scheduleId,
      t.appliedAt,
    ),
    check(
      "schedule_rule_set_applications_change_check",
      sql`${t.fromVersionId} <> ${t.toVersionId}`,
    ),
  ],
);
