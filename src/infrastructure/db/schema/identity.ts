import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
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
    email: text().notNull(),
    displayName: text().notNull(),
    /** argon2id hash; set in Phase 3. Never written to audit or notifications. */
    passwordHash: text(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_lower_key").on(sql`lower(${t.email})`)],
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
 * Leaving sets `ended_on`; rows are never deleted, so history survives (D16).
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

/** Supervisors review departments without being members (not rostered). */
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
