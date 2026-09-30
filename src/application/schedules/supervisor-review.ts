import { decide } from "../../domain/authz/policies";
import { isSupervisorOf } from "../../domain/authz/actor";
import type { ScheduleStatus } from "../../domain/schedule/status";
import type { DatePeriod } from "../../domain/shared/period";
import { findDepartmentById } from "../../infrastructure/repositories/departments";
import { findScheduleById } from "../../infrastructure/repositories/schedules";
import {
  listSchedulesForReview,
  type SubmissionDecision,
} from "../../infrastructure/repositories/submissions";
import { NotFoundError } from "../errors";
import type { AppContext } from "../use-case";
import type { DepartmentSummary } from "../workspace/queries";
import {
  getScheduleReview,
  type ReviewSources,
  type ScheduleReview,
} from "./review";

/**
 * The Supervisor's side of the workflow (Phase 8): the review list of the
 * departments they currently supervise (D19) and one schedule read-only.
 * Supervisors see a department's schedules from FINALIZED on (D12); approve
 * and return are only offered in SUBMITTED, and never on their own
 * submission (D60).
 */

/** Statuses a Supervisor may see (D12); DRAFT and PLANNING stay the Head Nurse's. */
const VISIBLE_TO_SUPERVISOR: readonly ScheduleStatus[] = [
  "FINALIZED",
  "SUBMITTED",
  "RETURNED",
  "APPROVED",
  "REVISING",
];

export interface ReviewQueueItem {
  readonly scheduleId: string;
  readonly department: DepartmentSummary;
  readonly period: DatePeriod;
  readonly label: string;
  readonly status: ScheduleStatus;
  /** The latest submission: who sent it, when, and what became of it. */
  readonly submission: {
    readonly submittedByName: string;
    readonly submittedAt: Date;
    readonly decision: SubmissionDecision | null;
    readonly decidedByName: string | null;
    readonly decidedAt: Date | null;
  } | null;
  /** SUBMITTED by the actor themselves: visible, but not theirs to decide. */
  readonly ownSubmission: boolean;
}

export interface ReviewQueue {
  /** SUBMITTED, waiting for a decision; longest waiting first. */
  readonly awaiting: readonly ReviewQueueItem[];
  /** Everything else visible (finalized, returned, approved), newest period first. */
  readonly others: readonly ReviewQueueItem[];
}

/** How many non-pending schedules the list shows (most recent periods). */
export const REVIEW_QUEUE_OTHERS_LIMIT = 24;

/**
 * One query for the whole list, whatever the number of schedules or
 * departments (the latest submission and names are joined in). A user who
 * supervises nothing today gets NotFoundError (the page answers 404).
 */
export async function getReviewQueue(ctx: AppContext): Promise<ReviewQueue> {
  const { db, actor } = ctx;
  if (!actor.isActive || actor.supervisedDepartmentIds.length === 0)
    throw new NotFoundError("Review");
  const rows = await listSchedulesForReview(db, {
    departmentIds: actor.supervisedDepartmentIds,
    statuses: VISIBLE_TO_SUPERVISOR,
  });

  const items = rows
    // Defense in depth: the same policy as the review page itself.
    .filter(
      (r) =>
        decide(actor, "schedule.viewDepartment", {
          departmentId: r.departmentId,
          status: r.status,
        }).allowed,
    )
    .map((r): ReviewQueueItem => {
      const pending = r.status === "SUBMITTED" && r.latest?.decision === null;
      return {
        scheduleId: r.scheduleId,
        department: {
          id: r.departmentId,
          code: r.departmentCode,
          name: r.departmentName,
        },
        period: r.period,
        label: r.label,
        status: r.status,
        submission: r.latest && {
          submittedByName: r.latest.submittedByName,
          submittedAt: r.latest.submittedAt,
          decision: r.latest.decision,
          decidedByName: r.latest.decidedByName,
          decidedAt: r.latest.decidedAt,
        },
        ownSubmission: pending && r.latest?.submittedBy === actor.userId,
      };
    });

  return {
    awaiting: items
      .filter((i) => i.status === "SUBMITTED")
      .sort(
        (a, b) =>
          (a.submission?.submittedAt.getTime() ?? 0) -
          (b.submission?.submittedAt.getTime() ?? 0),
      ),
    others: items
      .filter((i) => i.status !== "SUBMITTED")
      .slice(0, REVIEW_QUEUE_OTHERS_LIMIT),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SupervisorScheduleReview extends ScheduleReview {
  readonly department: DepartmentSummary;
}

/**
 * One schedule for the Supervisor, read-only: the Phase 7a review model
 * (month, day, findings) and the workflow. Only for a Supervisor of the
 * schedule's department and from FINALIZED on (`getScheduleReview` checks
 * `schedule.viewDepartment`); anything else, an unknown or malformed id
 * included, is the same NotFoundError (404).
 */
export async function getSupervisorScheduleReview(
  ctx: AppContext,
  input: { scheduleId: string; day?: string },
  sources: ReviewSources = {},
): Promise<SupervisorScheduleReview> {
  const schedule = UUID.test(input.scheduleId)
    ? await findScheduleById(ctx.db, input.scheduleId)
    : null;
  if (!schedule || !isSupervisorOf(ctx.actor, schedule.departmentId))
    throw new NotFoundError("Schedule");
  const [department, review] = await Promise.all([
    findDepartmentById(ctx.db, schedule.departmentId),
    getScheduleReview(
      ctx,
      {
        departmentId: schedule.departmentId,
        scheduleId: schedule.id,
        day: input.day,
      },
      sources,
    ),
  ]);
  if (!department) throw new NotFoundError("Schedule");
  return {
    ...review,
    department: {
      id: department.id,
      code: department.code,
      name: department.name,
    },
  };
}
