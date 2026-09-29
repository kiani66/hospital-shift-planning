import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { Assignment } from "../../domain/shifts/assignment";
import type { DbExecutor } from "../db/database";
import {
  scheduleVersionAssignments,
  scheduleVersions,
  shiftAssignments,
} from "../db/schema";
import { asIsoDate, asShiftCode } from "./mappers";

/**
 * Approved schedule versions. This module deliberately has no update or delete
 * functions: a version is an immutable snapshot of what the Supervisor approved.
 */

export interface VersionRecord {
  readonly id: string;
  readonly scheduleId: string;
  readonly versionNo: number;
  readonly submissionId: string;
  readonly approvedBy: string;
  readonly approvedAt: Date;
}

/**
 * Snapshots the schedule's current working copy as the next version
 * (1, 2, …). Run inside the approving transaction, after locking the schedule.
 */
export async function createVersionFromWorkingCopy(
  db: DbExecutor,
  input: { scheduleId: string; submissionId: string; approvedBy: string },
): Promise<VersionRecord> {
  const [version] = await db
    .insert(scheduleVersions)
    .values({
      scheduleId: input.scheduleId,
      submissionId: input.submissionId,
      approvedBy: input.approvedBy,
      versionNo: sql`(select coalesce(max(${scheduleVersions.versionNo}), 0) + 1 from ${scheduleVersions} where ${scheduleVersions.scheduleId} = ${input.scheduleId})`,
    })
    .returning();

  await db.execute(sql`
    insert into ${scheduleVersionAssignments} (version_id, user_id, date, shift_code)
    select ${version!.id}, ${shiftAssignments.userId}, ${shiftAssignments.date}, ${shiftAssignments.shiftCode}
    from ${shiftAssignments}
    where ${shiftAssignments.scheduleId} = ${input.scheduleId}
  `);
  return version!;
}

export async function findVersionById(
  db: DbExecutor,
  id: string,
): Promise<VersionRecord | null> {
  const [row] = await db
    .select()
    .from(scheduleVersions)
    .where(eq(scheduleVersions.id, id));
  return row ?? null;
}

export async function findLatestVersion(
  db: DbExecutor,
  scheduleId: string,
): Promise<VersionRecord | null> {
  const [row] = await db
    .select()
    .from(scheduleVersions)
    .where(eq(scheduleVersions.scheduleId, scheduleId))
    .orderBy(desc(scheduleVersions.versionNo))
    .limit(1);
  return row ?? null;
}

export async function listVersions(
  db: DbExecutor,
  scheduleId: string,
): Promise<VersionRecord[]> {
  return db
    .select()
    .from(scheduleVersions)
    .where(eq(scheduleVersions.scheduleId, scheduleId))
    .orderBy(asc(scheduleVersions.versionNo));
}

export async function listVersionAssignments(
  db: DbExecutor,
  versionId: string,
  filter: { userId?: string } = {},
): Promise<Assignment[]> {
  const rows = await db
    .select({
      nurseId: scheduleVersionAssignments.userId,
      date: scheduleVersionAssignments.date,
      shift: scheduleVersionAssignments.shiftCode,
    })
    .from(scheduleVersionAssignments)
    .where(
      and(
        eq(scheduleVersionAssignments.versionId, versionId),
        filter.userId
          ? eq(scheduleVersionAssignments.userId, filter.userId)
          : undefined,
      ),
    )
    .orderBy(
      asc(scheduleVersionAssignments.date),
      asc(scheduleVersionAssignments.userId),
    );
  return rows.map((r) => ({
    nurseId: r.nurseId,
    date: asIsoDate(r.date),
    shift: asShiftCode(r.shift),
  }));
}
