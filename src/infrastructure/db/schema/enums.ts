import { pgEnum } from "drizzle-orm/pg-core";

import type { MembershipRole } from "../../../domain/authz/actor";
import type { DateScopeKind } from "../../../domain/scope/date-scope";
import { SCHEDULE_STATUSES } from "../../../domain/schedule/status";
import { PREFERENCE_VALUES } from "../../../domain/shifts/shift-type";

// Enum values come from (or are checked against) the domain so they cannot drift.

export const membershipRole = pgEnum("membership_role", [
  "NURSE",
  "HEAD_NURSE",
] as const satisfies readonly MembershipRole[]);

export const scheduleStatus = pgEnum("schedule_status", SCHEDULE_STATUSES);

export const preferenceValue = pgEnum("preference_value", PREFERENCE_VALUES);

export const preferenceWindowKind = pgEnum("preference_window_kind", [
  "INITIAL",
  "REOPEN",
]);

export const dateScopeKind = pgEnum("date_scope_kind", [
  "DAY",
  "DAYS",
  "RANGE",
  "WEEK",
  "PERIOD",
] as const satisfies readonly DateScopeKind[]);

export const assignmentSource = pgEnum("assignment_source", [
  "MANUAL",
  "PREFILL",
]);

export const submissionDecision = pgEnum("submission_decision", [
  "APPROVED",
  "RETURNED",
  "WITHDRAWN",
]);

export const revisionStatus = pgEnum("revision_status", [
  "OPEN",
  "APPROVED",
  "DISCARDED",
]);

export const changeRequestStatus = pgEnum("change_request_status", [
  "PENDING",
  "ACKNOWLEDGED",
  "DECLINED",
  "RESOLVED",
  "WITHDRAWN",
]);

export const NOTIFICATION_TYPES = [
  "PREFERENCES_OPENED",
  "DATES_REOPENED",
  "SCHEDULE_FINALIZED",
  "SCHEDULE_SUBMITTED",
  "SCHEDULE_APPROVED",
  "SCHEDULE_RETURNED",
  "REVISION_STARTED",
  "CHANGE_REQUEST_SUBMITTED",
  "CHANGE_REQUEST_REVIEWED",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationType = pgEnum("notification_type", NOTIFICATION_TYPES);
