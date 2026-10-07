import { pgEnum } from "drizzle-orm/pg-core";

import type { MembershipRole } from "../../../domain/authz/actor";
import {
  CHANGE_REQUEST_REJECTIONS,
  CHANGE_REQUEST_STATUSES,
  CHANGE_REQUEST_TYPES,
  SWAP_CONSENT_STATUSES,
} from "../../../domain/change-requests/model";
import { REASON_SCOPES } from "../../../domain/change-requests/reason";
import type { DateScopeKind } from "../../../domain/scope/date-scope";
import { SCHEDULE_STATUSES } from "../../../domain/schedule/status";
import {
  COVERAGE_PERIODS,
  PREFERENCE_VALUES,
} from "../../../domain/shifts/shift-type";
import {
  DAY_TYPES,
  RULE_SET_RETIRE_REASONS,
  RULE_SET_STATUSES,
} from "../../../domain/staffing-rules/model";

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

/** LEGACY: the Phase 2 request status (renamed by migration 0005; not used by the application). */
export const legacyChangeRequestStatus = pgEnum(
  "legacy_change_request_status",
  ["PENDING", "ACKNOWLEDGED", "DECLINED", "RESOLVED", "WITHDRAWN"],
);

export const changeRequestType = pgEnum(
  "change_request_type",
  CHANGE_REQUEST_TYPES,
);

/** Phase 9 request status (the Phase 2 enum is `legacy_change_request_status`). */
export const changeRequestStatus = pgEnum(
  "change_request_status",
  CHANGE_REQUEST_STATUSES,
);

export const swapConsentStatus = pgEnum(
  "swap_consent_status",
  SWAP_CONSENT_STATUSES,
);

export const changeRequestRejection = pgEnum(
  "change_request_rejection",
  CHANGE_REQUEST_REJECTIONS,
);

export const changeReasonScope = pgEnum("change_reason_scope", REASON_SCOPES);

/** An applied schedule change comes from a nurse's request or is a direct Head Nurse adjustment. */
export const SCHEDULE_CHANGE_KINDS = ["REQUEST", "ADJUSTMENT"] as const;

export type ScheduleChangeKind = (typeof SCHEDULE_CHANGE_KINDS)[number];

export const scheduleChangeKind = pgEnum(
  "schedule_change_kind",
  SCHEDULE_CHANGE_KINDS,
);

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
  "SWAP_CONSENT_REQUESTED",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationType = pgEnum("notification_type", NOTIFICATION_TYPES);

/** Staffing rule-set lifecycle (D105). */
export const staffingRuleSetStatus = pgEnum(
  "staffing_rule_set_status",
  RULE_SET_STATUSES,
);

export const staffingRuleSetRetireReason = pgEnum(
  "staffing_rule_set_retire_reason",
  RULE_SET_RETIRE_REASONS,
);

export const staffingDayType = pgEnum("staffing_day_type", DAY_TYPES);

/** The operational coverage buckets staffing is counted against (D42). */
export const coveragePeriod = pgEnum("coverage_period", COVERAGE_PERIODS);
