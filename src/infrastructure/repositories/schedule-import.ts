import { and, asc, eq, gte, lte, sql } from "drizzle-orm";

import type { MembershipRole } from "../../domain/authz/actor";
import { addDays, type IsoDate } from "../../domain/shared/dates";
import type { DatePeriod } from "../../domain/shared/period";
import type { Assignment } from "../../domain/shifts/assignment";
import type { DbExecutor, Transaction } from "../db/database";
import {
  departmentMemberships,
  schedules,
  shiftAssignments,
  users,
} from "../db/schema";

/** Period eligibility uses original membership dates, never the import execution day. */
export async function listImportPeriodMembers(
  db: DbExecutor,
  departmentId: string,
  period: DatePeriod,
) {
  const rows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      personnelNumber: users.personnelNumber,
      isActive: users.isActive,
      role: departmentMemberships.role,
      startedOn: departmentMemberships.startedOn,
      endedOn: departmentMemberships.endedOn,
    })
    .from(departmentMemberships)
    .innerJoin(users, eq(users.id, departmentMemberships.userId))
    .where(
      and(
        eq(departmentMemberships.departmentId, departmentId),
        lte(departmentMemberships.startedOn, period.end),
        sql`(${departmentMemberships.endedOn} is null or ${departmentMemberships.endedOn} >= ${period.start})`,
      ),
    )
    .orderBy(asc(users.id), asc(departmentMemberships.startedOn));
  return rows.map((r) => ({
    ...r,
    startedOn: r.startedOn as IsoDate,
    endedOn: r.endedOn as IsoDate | null,
  }));
}

/** Same global UUID order as other assignment writers, including both boundary schedules. */
export async function lockImportSchedules(
  tx: Transaction,
  departmentId: string,
  period: DatePeriod,
) {
  await tx
    .select({ id: schedules.id })
    .from(schedules)
    .where(
      and(
        eq(schedules.departmentId, departmentId),
        lte(schedules.periodStart, addDays(period.end, 1)),
        gte(schedules.periodEnd, addDays(period.start, -1)),
      ),
    )
    .orderBy(asc(schedules.id))
    .for("update");
}

/** Short shared locks protect authority, identity and membership rows AND new eligibility rows. */
export async function lockImportMemberships(tx: Transaction) {
  await tx.execute(
    sql`lock table departments, users, department_memberships in share mode`,
  );
}

/** Plain inserts only: the existing primary key rejects duplicates, never overwrites. */
export async function insertImportedAssignments(
  tx: Transaction,
  scheduleId: string,
  actorId: string,
  assignments: readonly Assignment[],
) {
  for (let offset = 0; offset < assignments.length; offset += 500) {
    await tx.insert(shiftAssignments).values(
      assignments.slice(offset, offset + 500).map((a) => ({
        scheduleId,
        userId: a.nurseId,
        date: a.date,
        shiftCode: a.shift,
        source: "MANUAL" as const,
        updatedBy: actorId,
      })),
    );
  }
}

export function importRoster(
  members: readonly {
    userId: string;
    displayName: string;
    isActive: boolean;
    role: MembershipRole;
  }[],
) {
  const latest = new Map<
    string,
    { userId: string; displayName: string; role: MembershipRole }
  >();
  for (const m of members)
    if (m.isActive)
      latest.set(m.userId, {
        userId: m.userId,
        displayName: m.displayName,
        role: m.role,
      });
  return [...latest.values()].sort((a, b) => a.userId.localeCompare(b.userId));
}
