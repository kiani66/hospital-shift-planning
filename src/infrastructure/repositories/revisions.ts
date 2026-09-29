import { and, asc, eq } from "drizzle-orm";

import type { IsoDate } from "../../domain/shared/dates";
import type { DbExecutor } from "../db/database";
import { scheduleRevisionDates, scheduleRevisions } from "../db/schema";
import { asIsoDate } from "./mappers";

export interface RevisionRecord {
  readonly id: string;
  readonly scheduleId: string;
  readonly reason: string;
  readonly status: "OPEN" | "APPROVED" | "DISCARDED";
  readonly startedBy: string;
  /** The explicit revision scope (D14), sorted. */
  readonly dates: readonly IsoDate[];
}

/** Opens a revision with an explicit date scope. One open revision per schedule (unique index). */
export async function startRevision(
  db: DbExecutor,
  input: {
    scheduleId: string;
    reason: string;
    startedBy: string;
    dates: readonly IsoDate[];
  },
): Promise<string> {
  const [row] = await db
    .insert(scheduleRevisions)
    .values({
      scheduleId: input.scheduleId,
      reason: input.reason,
      startedBy: input.startedBy,
    })
    .returning({ id: scheduleRevisions.id });
  await extendRevisionScope(db, {
    revisionId: row!.id,
    dates: input.dates,
    addedBy: input.startedBy,
  });
  return row!.id;
}

/** Adds dates to the scope; dates already in scope are ignored. Returns how many were added. */
export async function extendRevisionScope(
  db: DbExecutor,
  input: { revisionId: string; dates: readonly IsoDate[]; addedBy: string },
): Promise<number> {
  if (input.dates.length === 0) return 0;
  const rows = await db
    .insert(scheduleRevisionDates)
    .values(
      input.dates.map((date) => ({
        revisionId: input.revisionId,
        date,
        addedBy: input.addedBy,
      })),
    )
    .onConflictDoNothing()
    .returning({ date: scheduleRevisionDates.date });
  return rows.length;
}

export async function findOpenRevision(
  db: DbExecutor,
  scheduleId: string,
): Promise<RevisionRecord | null> {
  const [revision] = await db
    .select()
    .from(scheduleRevisions)
    .where(
      and(
        eq(scheduleRevisions.scheduleId, scheduleId),
        eq(scheduleRevisions.status, "OPEN"),
      ),
    );
  if (!revision) return null;
  const dates = await db
    .select({ date: scheduleRevisionDates.date })
    .from(scheduleRevisionDates)
    .where(eq(scheduleRevisionDates.revisionId, revision.id))
    .orderBy(asc(scheduleRevisionDates.date));
  return {
    id: revision.id,
    scheduleId: revision.scheduleId,
    reason: revision.reason,
    status: revision.status,
    startedBy: revision.startedBy,
    dates: dates.map((d) => asIsoDate(d.date)),
  };
}

export async function closeRevision(
  db: DbExecutor,
  input: { id: string; status: "APPROVED" | "DISCARDED"; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(scheduleRevisions)
    .set({ status: input.status, closedAt: input.now })
    .where(
      and(
        eq(scheduleRevisions.id, input.id),
        eq(scheduleRevisions.status, "OPEN"),
      ),
    )
    .returning({ id: scheduleRevisions.id });
  return rows.length > 0;
}
