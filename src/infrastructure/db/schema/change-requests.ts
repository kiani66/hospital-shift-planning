import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
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
  changeReasonScope,
  changeRequestRejection,
  changeRequestStatus,
  changeRequestType,
  scheduleChangeKind,
  swapConsentStatus,
} from "./enums";
import { users } from "./identity";
import { shiftTypes } from "./reference";
import {
  scheduleRevisions,
  scheduleRoster,
  schedules,
  scheduleVersions,
} from "./schedules";

/**
 * Change reasons (master data, inserted by migration 0007; reportable by
 * code). Never deleted once in use: `is_active = false` retires a reason.
 * "OTHER" always requires a note.
 */
export const changeReasons = pgTable(
  "change_reasons",
  {
    code: text().primaryKey(),
    label: text().notNull(),
    scope: changeReasonScope().notNull(),
    requiresNote: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull(),
  },
  (t) => [
    check("change_reasons_code_check", sql`${t.code} ~ '^[A-Z][A-Z0-9_]*$'`),
    check(
      "change_reasons_other_note_check",
      sql`${t.code} <> 'OTHER' or ${t.requiresNote}`,
    ),
  ],
);

/**
 * A nurse's Shift Change Request (Phase 9). Creating, cancelling, consenting
 * to or rejecting it never touches assignments; only the Head Nurse applying
 * it changes the schedule, recorded separately in `schedule_changes`.
 * Never deleted: closed requests stay as history.
 */
export const shiftChangeRequests = pgTable(
  "shift_change_requests",
  {
    id: id(),
    scheduleId: uuid()
      .notNull()
      .references(() => schedules.id),
    /** The approved version the requester saw; null when they saw the working copy (D11). */
    versionId: uuid().references(() => scheduleVersions.id),
    requesterId: uuid()
      .notNull()
      .references(() => users.id),
    type: changeRequestType().notNull(),
    date: isoDay().notNull(),
    /** Snapshot: the requester's shift that day when asking (or at the last swap refresh). */
    requesterShiftCode: text()
      .notNull()
      .references(() => shiftTypes.code),
    /** CHANGE_SHIFT only. */
    targetShiftCode: text().references(() => shiftTypes.code),
    /** SWAP only: the partner. */
    counterpartId: uuid().references(() => users.id),
    /** SWAP only. Snapshot of the partner's shift that day; null = off. */
    counterpartShiftCode: text(),
    reasonCode: text()
      .notNull()
      .references(() => changeReasons.code),
    note: text(),
    status: changeRequestStatus().notNull().default("PENDING"),
    /** SWAP only: the partner's answer, when and by whom (always the partner). */
    consentStatus: swapConsentStatus(),
    consentAt: instant(),
    consentBy: uuid().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: instant().notNull().defaultNow(),
    cancelledAt: instant(),
    cancelledBy: uuid().references(() => users.id),
    rejectedAt: instant(),
    rejectedBy: uuid().references(() => users.id),
    rejection: changeRequestRejection(),
    rejectionNote: text(),
    appliedAt: instant(),
    appliedBy: uuid().references(() => users.id),
  },
  (t) => [
    // Only rostered nurses ask, and a swap partner must be on the same roster.
    foreignKey({
      name: "shift_change_requests_roster_fk",
      columns: [t.scheduleId, t.requesterId],
      foreignColumns: [scheduleRoster.scheduleId, scheduleRoster.userId],
    }),
    // Named explicitly: the generated name would exceed PostgreSQL's 63 characters.
    foreignKey({
      name: "shift_change_requests_counterpart_shift_fk",
      columns: [t.counterpartShiftCode],
      foreignColumns: [shiftTypes.code],
    }),
    foreignKey({
      name: "shift_change_requests_counterpart_roster_fk",
      columns: [t.scheduleId, t.counterpartId],
      foreignColumns: [scheduleRoster.scheduleId, scheduleRoster.userId],
    }),
    // One active request per nurse, schedule and day; closed ones stay as history.
    uniqueIndex("shift_change_requests_one_active_key")
      .on(t.scheduleId, t.requesterId, t.date)
      .where(sql`${t.status} = 'PENDING'`),
    index("shift_change_requests_queue_idx").on(
      t.scheduleId,
      t.status,
      t.createdAt,
    ),
    index("shift_change_requests_requester_idx").on(t.requesterId, t.createdAt),
    index("shift_change_requests_counterpart_idx").on(
      t.counterpartId,
      t.createdAt,
    ),
    check(
      "shift_change_requests_type_check",
      sql`(${t.type} = 'CHANGE_SHIFT') = (${t.targetShiftCode} is not null)
        and (${t.type} = 'SWAP') = (${t.counterpartId} is not null)
        and (${t.type} = 'SWAP') = (${t.consentStatus} is not null)
        and (${t.counterpartId} is not null or ${t.counterpartShiftCode} is null)`,
    ),
    check(
      "shift_change_requests_counterpart_check",
      sql`${t.counterpartId} is null or ${t.counterpartId} <> ${t.requesterId}`,
    ),
    check(
      "shift_change_requests_target_check",
      sql`${t.targetShiftCode} is null or ${t.targetShiftCode} <> ${t.requesterShiftCode}`,
    ),
    check(
      "shift_change_requests_consent_check",
      sql`(${t.consentAt} is null) = (${t.consentStatus} is null or ${t.consentStatus} = 'PENDING')
        and (${t.consentBy} is null) = (${t.consentAt} is null)
        and (${t.consentBy} is null or ${t.consentBy} = ${t.counterpartId})`,
    ),
    check(
      "shift_change_requests_cancelled_check",
      sql`(${t.status} = 'CANCELLED') = (${t.cancelledAt} is not null)
        and (${t.cancelledBy} is null) = (${t.cancelledAt} is null)
        and (${t.cancelledBy} is null or ${t.cancelledBy} = ${t.requesterId})`,
    ),
    check(
      "shift_change_requests_rejected_check",
      sql`(${t.status} = 'REJECTED') = (${t.rejectedAt} is not null)
        and (${t.rejectedBy} is null) = (${t.rejectedAt} is null)
        and (${t.rejection} is null) = (${t.rejectedAt} is null)`,
    ),
    check(
      "shift_change_requests_applied_check",
      sql`(${t.status} = 'APPLIED') = (${t.appliedAt} is not null)
        and (${t.appliedBy} is null) = (${t.appliedAt} is null)`,
    ),
  ],
);

/**
 * A change actually applied to a schedule by the Head Nurse: from a nurse's
 * request (`request_id`) or a direct operational adjustment. Always with a
 * reason; with the revision it went into when the schedule had been
 * approved. Insert-only, like the audit trail.
 */
export const scheduleChanges = pgTable(
  "schedule_changes",
  {
    id: id(),
    scheduleId: uuid()
      .notNull()
      .references(() => schedules.id),
    kind: scheduleChangeKind().notNull(),
    /** At most one applied change per request. */
    requestId: uuid()
      .unique("schedule_changes_request_key")
      .references(() => shiftChangeRequests.id),
    /** The revision the change went into; null when it changed a never-approved working copy. */
    revisionId: uuid().references(() => scheduleRevisions.id),
    reasonCode: text()
      .notNull()
      .references(() => changeReasons.code),
    note: text(),
    appliedBy: uuid()
      .notNull()
      .references(() => users.id),
    appliedAt: instant().notNull().defaultNow(),
  },
  (t) => [
    index("schedule_changes_schedule_idx").on(t.scheduleId, t.appliedAt),
    check(
      "schedule_changes_kind_check",
      sql`(${t.kind} = 'REQUEST') = (${t.requestId} is not null)`,
    ),
  ],
);

/** The cells of an applied change: before and after (null = no shift). */
export const scheduleChangeCells = pgTable(
  "schedule_change_cells",
  {
    changeId: uuid()
      .notNull()
      .references(() => scheduleChanges.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    date: isoDay().notNull(),
    beforeShiftCode: text().references(() => shiftTypes.code),
    afterShiftCode: text().references(() => shiftTypes.code),
  },
  (t) => [
    primaryKey({ columns: [t.changeId, t.userId, t.date] }),
    check(
      "schedule_change_cells_changed_check",
      sql`${t.beforeShiftCode} is distinct from ${t.afterShiftCode}`,
    ),
  ],
);
