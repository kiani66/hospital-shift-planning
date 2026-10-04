import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, instant, isoDay } from "./columns";
import { membershipRole } from "./enums";

export const users = pgTable(
  "users",
  {
    id: id(),
    /** Optional for personnel created from migration 0009 on; a login identifier when set. */
    email: text(),
    /**
     * Digits only (1–20), stored as text so leading zeros survive; unique.
     * Required for every account created from migration 0009 on. Legacy rows
     * are backfilled through the audited correction workflow; NOT NULL is the
     * separate, explicitly authorized stage (docs/database.md).
     */
    personnelNumber: text(),
    /** Optional Iranian mobile `09xxxxxxxxx`; not unique, never a login identifier. */
    mobile: text(),
    displayName: text().notNull(),
    /** argon2id hash; set in Phase 3. Never written to audit or notifications. */
    passwordHash: text(),
    /** Set with a temporary password; the user must choose their own before using the app. */
    mustChangePassword: boolean().notNull().default(false),
    /**
     * Bumped whenever the password changes or is reset. Sessions carry the
     * value they were issued with; a mismatch invalidates them server-side.
     */
    sessionVersion: integer().notNull().default(0),
    passwordChangedAt: instant(),
    isActive: boolean().notNull().default(true),
    /** System-level Phase 10 authority; existing users default to no authority. */
    isHospitalAdmin: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_lower_key").on(sql`lower(${t.email})`),
    uniqueIndex("users_personnel_number_key").on(t.personnelNumber),
    check(
      "users_personnel_number_format_check",
      sql`${t.personnelNumber} ~ '^[0-9]{1,20}$'`,
    ),
    check("users_mobile_format_check", sql`${t.mobile} ~ '^09[0-9]{9}$'`),
    check(
      "users_login_identifier_check",
      sql`${t.email} is not null or ${t.personnelNumber} is not null`,
    ),
  ],
);

export const departments = pgTable("departments", {
  id: id(),
  /** Short stable slug, e.g. "icu". */
  code: text().notNull().unique(),
  name: text().notNull(),
  timezone: text().notNull().default("Asia/Tehran"),
  isActive: boolean().notNull().default(true),
  createdAt: createdAt(),
});

/**
 * Department-scoped roles. A HEAD_NURSE is also a nurse of the department.
 * Effective-dated (D19): active on D when `started_on <= D` and (`ended_on` is
 * null or `ended_on >= D`); either bound may be in the future. Leaving sets
 * `ended_on`; rows are never deleted, so history survives (D16).
 * Overlapping ranges per user and department are rejected by the exclusion
 * constraint `department_memberships_no_overlap` (migration 0003; Drizzle
 * cannot model it). The partial unique index keeps at most one open-ended row.
 */
export const departmentMemberships = pgTable(
  "department_memberships",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    departmentId: uuid()
      .notNull()
      .references(() => departments.id),
    role: membershipRole().notNull(),
    startedOn: isoDay().notNull(),
    endedOn: isoDay(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("department_memberships_active_key")
      .on(t.userId, t.departmentId)
      .where(sql`${t.endedOn} is null`),
    index("department_memberships_department_idx").on(t.departmentId),
    check(
      "department_memberships_dates_check",
      sql`${t.endedOn} is null or ${t.endedOn} >= ${t.startedOn}`,
    ),
  ],
);

/**
 * Supervisors review departments without being members (not rostered).
 * Effective-dated like memberships; overlaps are rejected by
 * `supervisor_assignments_no_overlap` (migration 0003).
 */
export const supervisorAssignments = pgTable(
  "supervisor_assignments",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    departmentId: uuid()
      .notNull()
      .references(() => departments.id),
    startedOn: isoDay().notNull(),
    endedOn: isoDay(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("supervisor_assignments_active_key")
      .on(t.userId, t.departmentId)
      .where(sql`${t.endedOn} is null`),
    index("supervisor_assignments_department_idx").on(t.departmentId),
    check(
      "supervisor_assignments_dates_check",
      sql`${t.endedOn} is null or ${t.endedOn} >= ${t.startedOn}`,
    ),
  ],
);
