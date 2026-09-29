import { and, asc, eq, isNull } from "drizzle-orm";

import type { DbExecutor } from "../db/database";
import { scheduleSubmissions } from "../db/schema";

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
