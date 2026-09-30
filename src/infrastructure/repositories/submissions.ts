import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { DatePeriod } from "../../domain/shared/period";
import type { ScheduleStatus } from "../../domain/schedule/status";
import type { DbExecutor } from "../db/database";
import {
  departments,
  schedules,
  scheduleSubmissions,
  users,
} from "../db/schema";
import { asIsoDate } from "./mappers";

export type SubmissionDecision = "APPROVED" | "RETURNED" | "WITHDRAWN";

export interface SubmissionRecord {
  readonly id: string;
  readonly scheduleId: string;
  readonly revisionId: string | null;
  readonly submittedBy: string;
  readonly submittedAt: Date;
  readonly note: string | null;
  readonly decision: SubmissionDecision | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly decisionComment: string | null;
}

/** At most one pending (undecided) submission per schedule; a second one violates a unique index. */
export async function createSubmission(
  db: DbExecutor,
  input: {
    scheduleId: string;
    submittedBy: string;
    revisionId?: string | null;
    note?: string | null;
    /** The use case's clock; the column defaults to the database's now(). */
    submittedAt?: Date;
  },
): Promise<SubmissionRecord> {
  const [row] = await db.insert(scheduleSubmissions).values(input).returning();
  return row!;
}

export async function findPendingSubmission(
  db: DbExecutor,
  scheduleId: string,
): Promise<SubmissionRecord | null> {
  const [row] = await db
    .select()
    .from(scheduleSubmissions)
    .where(
      and(
        eq(scheduleSubmissions.scheduleId, scheduleId),
        isNull(scheduleSubmissions.decision),
      ),
    );
  return row ?? null;
}

/** Records the decision on a still-pending submission; null if it was already decided. */
export async function decideSubmission(
  db: DbExecutor,
  input: {
    id: string;
    decision: SubmissionDecision;
    decidedBy: string;
    comment?: string | null;
    now: Date;
  },
): Promise<SubmissionRecord | null> {
  const [row] = await db
    .update(scheduleSubmissions)
    .set({
      decision: input.decision,
      decidedBy: input.decidedBy,
      decidedAt: input.now,
      decisionComment: input.comment ?? null,
    })
    .where(
      and(
        eq(scheduleSubmissions.id, input.id),
        isNull(scheduleSubmissions.decision),
      ),
    )
    .returning();
  return row ?? null;
}

export async function listSubmissions(
  db: DbExecutor,
  scheduleId: string,
): Promise<SubmissionRecord[]> {
  return db
    .select()
    .from(scheduleSubmissions)
    .where(eq(scheduleSubmissions.scheduleId, scheduleId))
    .orderBy(asc(scheduleSubmissions.submittedAt));
}

/** A schedule as the Supervisor's review list shows it, with its latest submission. */
export interface ReviewListRow {
  readonly scheduleId: string;
  readonly departmentId: string;
  readonly departmentCode: string;
  readonly departmentName: string;
  readonly period: DatePeriod;
  readonly label: string;
  readonly status: ScheduleStatus;
  /** The most recent submission of the schedule, whatever its decision. */
  readonly latest: {
    readonly id: string;
    readonly submittedBy: string;
    readonly submittedByName: string;
    readonly submittedAt: Date;
    readonly decision: SubmissionDecision | null;
    readonly decidedByName: string | null;
    readonly decidedAt: Date | null;
  } | null;
}

/**
 * The review list of a set of departments in one query (no query per row):
 * each schedule in `statuses` with its department and its latest submission
 * (`DISTINCT ON`), the submitter's and decider's names joined in. Most
 * recent period first.
 */
export async function listSchedulesForReview(
  db: DbExecutor,
  input: {
    departmentIds: readonly string[];
    statuses: readonly ScheduleStatus[];
  },
): Promise<ReviewListRow[]> {
  if (input.departmentIds.length === 0 || input.statuses.length === 0)
    return [];
  const latest = db
    .selectDistinctOn([scheduleSubmissions.scheduleId], {
      scheduleId: scheduleSubmissions.scheduleId,
      submissionId: scheduleSubmissions.id,
      submittedBy: scheduleSubmissions.submittedBy,
      submittedAt: scheduleSubmissions.submittedAt,
      decision: scheduleSubmissions.decision,
      decidedBy: scheduleSubmissions.decidedBy,
      decidedAt: scheduleSubmissions.decidedAt,
    })
    .from(scheduleSubmissions)
    .innerJoin(schedules, eq(schedules.id, scheduleSubmissions.scheduleId))
    .where(inArray(schedules.departmentId, [...input.departmentIds]))
    .orderBy(
      scheduleSubmissions.scheduleId,
      desc(scheduleSubmissions.submittedAt),
      desc(scheduleSubmissions.id),
    )
    .as("latest_submission");
  const submitter = alias(users, "submitter");
  const decider = alias(users, "decider");

  const rows = await db
    .select({
      scheduleId: schedules.id,
      departmentId: schedules.departmentId,
      departmentCode: departments.code,
      departmentName: departments.name,
      periodStart: schedules.periodStart,
      periodEnd: schedules.periodEnd,
      label: schedules.label,
      status: schedules.status,
      submissionId: latest.submissionId,
      submittedBy: latest.submittedBy,
      submittedByName: submitter.displayName,
      submittedAt: latest.submittedAt,
      decision: latest.decision,
      decidedByName: decider.displayName,
      decidedAt: latest.decidedAt,
    })
    .from(schedules)
    .innerJoin(departments, eq(departments.id, schedules.departmentId))
    .leftJoin(latest, eq(latest.scheduleId, schedules.id))
    .leftJoin(submitter, eq(submitter.id, latest.submittedBy))
    .leftJoin(decider, eq(decider.id, latest.decidedBy))
    .where(
      and(
        inArray(schedules.departmentId, [...input.departmentIds]),
        inArray(schedules.status, [...input.statuses]),
      ),
    )
    .orderBy(desc(schedules.periodStart), asc(departments.code));

  return rows.map((r) => ({
    scheduleId: r.scheduleId,
    departmentId: r.departmentId,
    departmentCode: r.departmentCode,
    departmentName: r.departmentName,
    period: { start: asIsoDate(r.periodStart), end: asIsoDate(r.periodEnd) },
    label: r.label,
    status: r.status,
    latest:
      r.submissionId && r.submittedBy && r.submittedAt
        ? {
            id: r.submissionId,
            submittedBy: r.submittedBy,
            submittedByName: r.submittedByName ?? "—",
            submittedAt: r.submittedAt,
            decision: r.decision,
            decidedByName: r.decidedByName,
            decidedAt: r.decidedAt,
          }
        : null,
  }));
}
