import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, id, instant, isoDay } from "./columns";
import { changeRequestStatus } from "./enums";
import { users } from "./identity";
import { shiftTypes } from "./reference";
import { scheduleRevisions, scheduleRoster, schedules } from "./schedules";

/**
 * A nurse's request to change shifts. Stored independently of assignments:
 * submitting or reviewing it never changes the schedule (no automatic swaps).
 */
export const shiftChangeRequests = pgTable(
  "shift_change_requests",
  {
    id: id(),
    scheduleId: uuid()
      .notNull()
      .references(() => schedules.id),
    requesterId: uuid()
      .notNull()
      .references(() => users.id),
    /** "I coordinated with X": informational only. */
    counterpartUserId: uuid().references(() => users.id),
    reason: text().notNull(),
    status: changeRequestStatus().notNull().default("PENDING"),
    createdAt: createdAt(),
    reviewedBy: uuid().references(() => users.id),
    reviewedAt: instant(),
    reviewNote: text(),
    resolvedRevisionId: uuid().references(() => scheduleRevisions.id),
  },
  (t) => [
    // Only rostered nurses can request changes to that schedule.
    foreignKey({
      name: "shift_change_requests_roster_fk",
      columns: [t.scheduleId, t.requesterId],
      foreignColumns: [scheduleRoster.scheduleId, scheduleRoster.userId],
    }),
    index("shift_change_requests_schedule_idx").on(t.scheduleId, t.status),
    index("shift_change_requests_requester_idx").on(t.requesterId, t.createdAt),
    check(
      "shift_change_requests_counterpart_check",
      sql`${t.counterpartUserId} is null or ${t.counterpartUserId} <> ${t.requesterId}`,
    ),
    check(
      "shift_change_requests_reviewed_check",
      sql`(${t.reviewedBy} is null) = (${t.reviewedAt} is null)`,
    ),
  ],
);

export const shiftChangeRequestItems = pgTable(
  "shift_change_request_items",
  {
    requestId: uuid()
      .notNull()
      .references(() => shiftChangeRequests.id, { onDelete: "cascade" }),
    date: isoDay().notNull(),
    /** The shift the nurse saw when requesting (snapshot). */
    currentShiftCode: text().references(() => shiftTypes.code),
    /** Null means "cannot work this day". */
    desiredShiftCode: text().references(() => shiftTypes.code),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.date] })],
);
