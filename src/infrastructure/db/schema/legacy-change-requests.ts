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

import { createdAt, instant, isoDay } from "./columns";
import { legacyChangeRequestStatus } from "./enums";
import { users } from "./identity";
import { shiftTypes } from "./reference";
import { scheduleRevisions, scheduleRoster, schedules } from "./schedules";

/**
 * LEGACY (compatibility / history storage only). The Phase 2 change-request
 * tables, renamed by migration 0005 so any rows they may hold are kept with
 * their constraints. Phase 9 replaced the model (see `change-requests.ts`);
 * no application code reads or writes these tables, and their rows are not
 * Phase 9 requests. Dropping them is a future, explicit cleanup decision
 * (docs/database.md).
 */
export const legacyShiftChangeRequests = pgTable(
  "legacy_shift_change_requests",
  {
    id: uuid().primaryKey().defaultRandom(),
    scheduleId: uuid().notNull(),
    requesterId: uuid().notNull(),
    counterpartUserId: uuid(),
    reason: text().notNull(),
    status: legacyChangeRequestStatus().notNull().default("PENDING"),
    createdAt: createdAt(),
    reviewedBy: uuid(),
    reviewedAt: instant(),
    reviewNote: text(),
    resolvedRevisionId: uuid(),
  },
  (t) => [
    foreignKey({
      name: "legacy_shift_change_requests_schedule_fk",
      columns: [t.scheduleId],
      foreignColumns: [schedules.id],
    }),
    foreignKey({
      name: "legacy_shift_change_requests_requester_fk",
      columns: [t.requesterId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: "legacy_shift_change_requests_counterpart_fk",
      columns: [t.counterpartUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: "legacy_shift_change_requests_reviewed_by_fk",
      columns: [t.reviewedBy],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: "legacy_shift_change_requests_resolved_revision_fk",
      columns: [t.resolvedRevisionId],
      foreignColumns: [scheduleRevisions.id],
    }),
    foreignKey({
      name: "legacy_shift_change_requests_roster_fk",
      columns: [t.scheduleId, t.requesterId],
      foreignColumns: [scheduleRoster.scheduleId, scheduleRoster.userId],
    }),
    index("legacy_shift_change_requests_schedule_idx").on(
      t.scheduleId,
      t.status,
    ),
    index("legacy_shift_change_requests_requester_idx").on(
      t.requesterId,
      t.createdAt,
    ),
    check(
      "legacy_shift_change_requests_counterpart_check",
      sql`${t.counterpartUserId} is null or ${t.counterpartUserId} <> ${t.requesterId}`,
    ),
    check(
      "legacy_shift_change_requests_reviewed_check",
      sql`(${t.reviewedBy} is null) = (${t.reviewedAt} is null)`,
    ),
  ],
);

/** LEGACY: the per-day items of a Phase 2 request (see above). */
export const legacyShiftChangeRequestItems = pgTable(
  "legacy_shift_change_request_items",
  {
    requestId: uuid().notNull(),
    date: isoDay().notNull(),
    currentShiftCode: text(),
    desiredShiftCode: text(),
  },
  (t) => [
    primaryKey({
      name: "legacy_shift_change_request_items_pk",
      columns: [t.requestId, t.date],
    }),
    foreignKey({
      name: "legacy_shift_change_request_items_request_fk",
      columns: [t.requestId],
      foreignColumns: [legacyShiftChangeRequests.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "legacy_shift_change_request_items_current_shift_fk",
      columns: [t.currentShiftCode],
      foreignColumns: [shiftTypes.code],
    }),
    foreignKey({
      name: "legacy_shift_change_request_items_desired_shift_fk",
      columns: [t.desiredShiftCode],
      foreignColumns: [shiftTypes.code],
    }),
  ],
);
